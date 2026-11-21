import "server-only";
import {
  analyzeJobLocal,
  analyzeResume,
  contactsForCompany,
  dedupeJobs,
  fetchBoards,
  fitFlags,
  inspectCareersPage,
  matchesFilters,
  type CandidateProfile,
  type Contact,
  type DiscoveredJob,
  type StoredResume,
} from "@internova/core";
import { activeSources, type DiscoverResponse, type DiscoverySettings, type RankedJob } from "@/lib/discoverTypes";
import { fetchPublicHtml } from "@/lib/fetchPage";

type ContactLite = Pick<Contact, "company" | "email" | "status" | "department" | "title">;

/**
 * Fetch every watched board and careers page, filter, dedupe, and score each job against the user's resumes
 * in code (no AI). Shared by Discover and the daily agent. Ranked: fewest blockers, best match, newest.
 */
export async function scanJobs(input: {
  settings: DiscoverySettings;
  profile: CandidateProfile;
  resumes: StoredResume[];
  contacts: ContactLite[];
  timeoutMs?: number;
}): Promise<Omit<DiscoverResponse, "jobs"> & { jobs: RankedJob[] }> {
  const { settings, profile, resumes, contacts } = input;
  const filters = settings.filters;
  // Board responses are shared between users and cached for 30 minutes (job boards change slowly)
  const cachedFetch: typeof fetch = (url, init) => fetch(url, { ...init, next: { revalidate: 1800 } } as RequestInit);
  const [boards, pages] = await Promise.all([
    fetchBoards(activeSources(settings), {
      fetchImpl: cachedFetch,
      concurrency: 16,
      timeoutMs: 25_000,
      signal: AbortSignal.timeout(input.timeoutMs ?? 50_000),
      needsDetail: (j) => matchesFilters(j, filters),
      filters,
      maxPages: 12,
    }),
    // Careers pages not on a supported ATS: jobs they publish as schema.org JobPosting data
    Promise.all(settings.pages.map(async (p) => {
      try {
        const { html, finalUrl } = await fetchPublicHtml(p.url, 15_000);
        const jobs = inspectCareersPage(html, finalUrl).jobs.map((j) => ({ ...j, company: p.company || j.company }));
        return { page: p, jobs, error: jobs.length ? null : "No jobs found in the page's data" };
      } catch (e) {
        return { page: p, jobs: [] as DiscoveredJob[], error: (e as Error).message };
      }
    })),
  ]);

  const all = [...boards.flatMap((b) => b.jobs), ...pages.flatMap((p) => p.jobs)];
  const kept = dedupeJobs(all.filter((j) => matchesFilters(j, filters)));

  // Candidate facts for the fit flags (from the newest resume; unknowns never raise a flag)
  const latest = resumes[0] ? analyzeResume(resumes[0].text) : null;
  const gradYear = Number(profile.education[0]?.endYear) || latest?.graduationYear || null;
  const now = new Date();
  const graduated = gradYear ? gradYear < now.getFullYear() || (gradYear === now.getFullYear() && now.getMonth() >= 6) : null;
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

  return {
    jobs: ranked,
    matched: ranked.length,
    scanned: all.length,
    boards: [
      ...boards.map((b) => ({ company: b.source.company, ats: b.source.ats, slug: b.source.slug, jobs: b.jobs.length, error: b.error })),
      ...pages.map((p) => ({ company: p.page.company, ats: "page", slug: p.page.url, jobs: p.jobs.length, error: p.error })),
    ],
    hasResume: resumes.length > 0,
  };
}
