import {
  analyzeJobLocal,
  analyzeResume,
  contactsForCompany,
  dedupeJobs,
  fetchBoards,
  fitFlags,
  matchesFilters,
  type Contact,
  type DiscoveredJob,
} from "@internova/core";
import { json, requireUser } from "@/lib/ai";
import { activeSources, normalizeSettings, type DiscoverResponse, type RankedJob } from "@/lib/discoverTypes";
import { loadUserData } from "@/lib/userData";

export const maxDuration = 60;

const MAX_RESULTS = 150;

/**
 * POST { settings? } → DiscoverResponse
 * Fetches every watched company's public job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee),
 * filters, dedupes, and scores each job against the user's resumes in code (no AI, so no quota is used).
 * `settings` lets the page try unsaved filters; otherwise the saved discovery_settings row is used.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Sign in first" }, 401);
  const body = (await req.json().catch(() => ({}))) as { settings?: unknown };

  const [{ data: saved }, { profile, resumes }, { data: contactRows }] = await Promise.all([
    auth.supabase.from("discovery_settings").select("data").maybeSingle(),
    loadUserData(auth.supabase),
    auth.supabase.from("contacts").select("company, email, status, department, title").limit(20000),
  ]);
  const settings = normalizeSettings(body.settings ?? saved?.data ?? {});
  const sources = activeSources(settings);
  if (!sources.length) return json({ error: "No company boards selected. Add a company or turn some defaults back on." }, 400);

  const filters = settings.filters;
  // Board responses are shared between users and cached for 30 minutes (job boards change slowly)
  const cachedFetch: typeof fetch = (url, init) => fetch(url, { ...init, next: { revalidate: 1800 } } as RequestInit);
  const boards = await fetchBoards(sources, {
    fetchImpl: cachedFetch,
    concurrency: 10,
    timeoutMs: 25_000,
    signal: AbortSignal.timeout(50_000),
    needsDetail: (j) => matchesFilters(j, filters),
  });

  const all = boards.flatMap((b) => b.jobs);
  const kept = dedupeJobs(all.filter((j) => matchesFilters(j, filters)));

  // Candidate facts for the fit flags (from the newest resume; unknowns never raise a flag)
  const latest = resumes[0] ? analyzeResume(resumes[0].text) : null;
  const gradYear = Number(profile.education[0]?.endYear) || latest?.graduationYear || null;
  const graduated = gradYear ? gradYear < new Date().getFullYear() || (gradYear === new Date().getFullYear() && new Date().getMonth() >= 6) : null;
  const contacts = (contactRows ?? []) as Pick<Contact, "company" | "email" | "status" | "department" | "title">[];
  const contactCount = new Map<string, number>();

  const ranked: RankedJob[] = kept.map((j: DiscoveredJob) => {
    const posting = { title: j.title, company: j.company, location: j.location, url: j.url, text: j.text, source: `ats:${j.ats}` };
    const analysis = j.text.length >= 80 && resumes.length ? analyzeJobLocal(posting, resumes) : null;
    const best = analysis?.results[0] ?? null;
    const req = analysis?.requirements ?? null;
    const skills = best?.alignment.dimensions.find((d) => d.id === "required_skills");
    if (!contactCount.has(j.company)) contactCount.set(j.company, contactsForCompany(j.company, contacts).length);
    return {
      ...j,
      text: j.text.slice(0, 6000),
      score: best?.alignment.overall ?? null,
      resumeName: best?.resumeName ?? null,
      matchedSkills: skills?.matched.map((m) => m.requirement).slice(0, 8) ?? [],
      missingSkills: skills?.missing.slice(0, 8) ?? [],
      deadline: req?.deadline ?? null,
      flags: fitFlags(j, {
        minYearsExperience: req?.minYearsExperience ?? null,
        candidateMonths: latest?.experienceMonths ?? null,
        eligibilityNotMet: best?.alignment.eligibility.filter((e) => e.status === "not_met").map((e) => `${e.label} (${e.detail})`) ?? [],
        candidateCountry: profile.country,
        graduated,
      }),
      contacts: contactCount.get(j.company)!,
    };
  });

  const blockers = (r: RankedJob) => r.flags.filter((f) => f.severity === "blocker").length;
  ranked.sort((a, b) =>
    blockers(a) - blockers(b) ||
    (b.score ?? -1) - (a.score ?? -1) ||
    (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));

  const res: DiscoverResponse = {
    jobs: ranked.slice(0, MAX_RESULTS),
    matched: ranked.length,
    scanned: all.length,
    boards: boards.map((b) => ({ company: b.source.company, ats: b.source.ats, slug: b.source.slug, jobs: b.jobs.length, error: b.error })),
    hasResume: resumes.length > 0,
  };
  return json(res);
}
