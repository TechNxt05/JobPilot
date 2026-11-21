/**
 * Find a company's job board from its name: "JPMorgan", "Mastercard", "Zepto".
 * Checks the boards JobPilot already knows, then guesses addresses on every job system Discover reads
 * (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Breezy, Eightfold) and the usual
 * careers / jobs sites (careers.{name}.com, jobs.{name}.com) read through their sitemaps.
 * Only boards with open jobs are returned, each with a few titles so a wrong guess is easy to spot.
 */
import { companyKey } from "./contacts";
import { DEFAULT_SOURCES, fetchBoards, sourceKey, type DiscoveredJob, type FetchBoardOptions, type JobSource } from "./discover";
import { slugCandidates } from "./jobpost";

export interface FoundBoard {
  source: JobSource;
  jobs: number;
  /** A few open roles ("Software Engineer · Bengaluru") */
  sample: string[];
}

/** Companies whose board can't be guessed from the name (checked live, Nov 2026). */
export const KNOWN_BOARDS: { names: string[]; source: JobSource }[] = [
  { names: ["jpmorgan", "jp morgan", "jpmorgan chase", "jpmc", "chase"], source: { ats: "oracle", slug: "jpmc.fa.oraclecloud.com/CX_1001", company: "JPMorgan Chase" } },
];

/** Boards that share a name with a different company (checked): never offered for that name. */
const NOT_THEIRS: Record<string, string[]> = {
  pylon: ["ashby:pylon"], lindy: ["recruitee:lindy"], tcs: ["greenhouse:tcs"], linkedin: ["lever:linkedin"], navi: ["ashby:navi"],
  slice: ["greenhouse:slice"], pine: ["greenhouse:pine"], nucleussoftware: ["greenhouse:nucleus"], nucleus: ["greenhouse:nucleus"],
  analogdevices: ["ashby:analog"], nousresearch: ["ashby:nous"], graviton: ["smartrecruiters:graviton"],
};

/** Boards worth trying for a company name, best guesses first. */
export function boardGuesses(company: string): JobSource[] {
  const key = companyKey(company);
  const named = (s: JobSource) => companyKey(s.company) === key || s.slug.toLowerCase().split(/[/.]/)[0] === key;
  const known = [...DEFAULT_SOURCES.filter(named), ...KNOWN_BOARDS.filter((k) => k.names.some((n) => companyKey(n) === key)).map((k) => k.source)];
  if (known.length) return known;
  const slugs = slugCandidates(company);
  const title = company.trim().replace(/\s+/g, "");
  const out: JobSource[] = [];
  for (const slug of slugs) {
    for (const ats of ["greenhouse", "lever", "ashby", "workable", "recruitee", "breezy"] as const) out.push({ ats, slug, company });
  }
  // SmartRecruiters ids are case-sensitive and usually the brand as written ("Visa", "ServiceNow")
  for (const slug of new Set([title, title.charAt(0).toUpperCase() + title.slice(1), slugs[0]])) if (slug) out.push({ ats: "smartrecruiters", slug, company });
  if (slugs[0]) {
    out.push({ ats: "eightfold", slug: `${slugs[0]}/${slugs[0]}.com`, company });
    for (const host of [`careers.${slugs[0]}.com`, `jobs.${slugs[0]}.com`]) out.push({ ats: "sitemap", slug: host, company });
  }
  // SmartRecruiters ignores case when reading ("Swiggy" = "swiggy"): one try per spelling
  const seen = new Set<string>(NOT_THEIRS[key] ?? []);
  return out.filter((s) => { const k = sourceKey(s).toLowerCase(); return !seen.has(k) && !!seen.add(k); });
}

/** A board of test postings ("Test UAT", "jobReq 3 - public"), not real openings. */
const TEST_TITLE = /\b(test|testing only|dummy|sample|do not apply|jobreq|uat)\b|^bo prim/i;
const looksLikeTestBoard = (jobs: DiscoveredJob[]) => jobs.filter((j) => TEST_TITLE.test(j.title)).length >= Math.max(1, jobs.length / 3);

const sampleOf = (jobs: DiscoveredJob[]) =>
  jobs.slice(0, 3).map((j) => [j.title, j.location.split(/\s*[/;]\s*/)[0]].filter(Boolean).join(" · "));

/** Boards with open jobs for this company name, most jobs first. */
export async function findCompanyBoards(company: string, opts: Pick<FetchBoardOptions, "fetchImpl" | "signal" | "filters"> = {}): Promise<FoundBoard[]> {
  if (!company.trim()) return [];
  const results = await fetchBoards(boardGuesses(company), { ...opts, timeoutMs: 10_000, concurrency: 12, maxPages: 3 });
  return results
    .filter((r) => !r.error && r.jobs.length && !looksLikeTestBoard(r.jobs))
    .map((r) => ({ source: { ...r.source, company: company.trim() || r.source.company }, jobs: r.jobs.length, sample: sampleOf(r.jobs) }))
    .sort((a, b) => b.jobs - a.jobs);
}
