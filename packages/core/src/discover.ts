/**
 * Job discovery from public ATS job-board APIs (no scraping, no API keys).
 * Greenhouse, Lever, Ashby, SmartRecruiters, Workable and Recruitee publish every open role of a company
 * as JSON. Endpoints and field names follow https://github.com/Mersetti/ats-job-board-apis.
 *
 * Pure parsing is separate from fetching, so it is testable offline.
 */
import { jobKey } from "./sync";

export type AtsId = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "recruitee";

export const ATS_LABELS: Record<AtsId, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  recruitee: "Recruitee",
};

export interface JobSource {
  ats: AtsId;
  /** Board identifier in the ATS (case-sensitive for SmartRecruiters) */
  slug: string;
  /** Display name */
  company: string;
}

export interface DiscoveredJob {
  /** Stable id: ats:slug:jobId */
  id: string;
  ats: AtsId;
  slug: string;
  company: string;
  title: string;
  location: string;
  /** true remote, false on-site/hybrid, null unknown */
  remote: boolean | null;
  department: string;
  url: string;
  applyUrl: string;
  /** ISO date, or null when the ATS doesn't say */
  postedAt: string | null;
  /** Plain-text description ("" when the list endpoint has none) */
  text: string;
}

/** Companies verified to have a public board (Nov 2026). Users can add more by pasting a careers URL. */
export const DEFAULT_SOURCES: JobSource[] = [
  // AI labs and AI-first companies
  { ats: "ashby", slug: "openai", company: "OpenAI" },
  { ats: "greenhouse", slug: "anthropic", company: "Anthropic" },
  { ats: "ashby", slug: "sarvam", company: "Sarvam AI" },
  { ats: "ashby", slug: "cohere", company: "Cohere" },
  { ats: "ashby", slug: "perplexity", company: "Perplexity" },
  { ats: "ashby", slug: "elevenlabs", company: "ElevenLabs" },
  { ats: "workable", slug: "huggingface", company: "Hugging Face" },
  { ats: "greenhouse", slug: "databricks", company: "Databricks" },
  // India product companies
  { ats: "greenhouse", slug: "razorpaysoftwareprivatelimited", company: "Razorpay" },
  { ats: "greenhouse", slug: "groww", company: "Groww" },
  { ats: "lever", slug: "meesho", company: "Meesho" },
  { ats: "lever", slug: "cred", company: "CRED" },
  { ats: "lever", slug: "zeta", company: "Zeta" },
  { ats: "lever", slug: "paytm", company: "Paytm" },
  { ats: "greenhouse", slug: "inmobi", company: "InMobi" },
  { ats: "greenhouse", slug: "druva", company: "Druva" },
  { ats: "ashby", slug: "atlan", company: "Atlan" },
  // Global tech with India / remote roles
  { ats: "greenhouse", slug: "mongodb", company: "MongoDB" },
  { ats: "greenhouse", slug: "gitlab", company: "GitLab" },
  { ats: "greenhouse", slug: "rubrik", company: "Rubrik" },
  { ats: "ashby", slug: "supabase", company: "Supabase" },
  { ats: "greenhouse", slug: "stripe", company: "Stripe" },
  { ats: "greenhouse", slug: "coinbase", company: "Coinbase" },
  { ats: "greenhouse", slug: "cloudflare", company: "Cloudflare" },
  { ats: "greenhouse", slug: "figma", company: "Figma" },
  { ats: "ashby", slug: "notion", company: "Notion" },
  { ats: "ashby", slug: "ramp", company: "Ramp" },
  { ats: "ashby", slug: "linear", company: "Linear" },
  { ats: "lever", slug: "palantir", company: "Palantir" },
  { ats: "lever", slug: "spotify", company: "Spotify" },
  { ats: "smartrecruiters", slug: "BoschGroup", company: "Bosch" },
];

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isValidSource(s: Partial<JobSource> | null | undefined): s is JobSource {
  return !!s && typeof s.slug === "string" && SLUG.test(s.slug) && typeof s.ats === "string" && s.ats in ATS_LABELS;
}

export function sourceKey(s: Pick<JobSource, "ats" | "slug">): string {
  return `${s.ats}:${s.ats === "smartrecruiters" ? s.slug : s.slug.toLowerCase()}`;
}

const titleCase = (slug: string) => slug.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Recognise a careers / job URL and return its board, e.g.
 * boards.greenhouse.io/acme, job-boards.eu.greenhouse.io/acme/jobs/1, jobs.lever.co/acme, jobs.ashbyhq.com/acme,
 * jobs.smartrecruiters.com/Acme, apply.workable.com/acme, acme.recruitee.com. Also accepts the API URLs.
 */
export function sourceFromUrl(input: string): JobSource | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const make = (ats: AtsId, slug: string | undefined): JobSource | null =>
    slug && SLUG.test(slug) ? { ats, slug, company: titleCase(slug) } : null;

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (host.startsWith("boards-api.")) return make("greenhouse", parts[2]); // /v1/boards/{slug}/jobs
    const forParam = u.searchParams.get("for"); // boards.greenhouse.io/embed/job_board?for=acme
    return make("greenhouse", forParam ?? (parts[0] === "embed" ? undefined : parts[0]));
  }
  if (/(^|\.)lever\.co$/.test(host)) return make("lever", host.startsWith("api.") ? parts[2] : parts[0]);
  if (host === "jobs.ashbyhq.com") return make("ashby", parts[0]);
  if (host === "api.ashbyhq.com") return make("ashby", parts[2]);
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") return make("smartrecruiters", parts[0]);
  if (host === "api.smartrecruiters.com") return make("smartrecruiters", parts[2]);
  if (host === "apply.workable.com") {
    if (parts[0] === "api") return make("workable", parts[4]);
    return parts[0] === "j" ? null : make("workable", parts[0]);
  }
  const rec = host.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (rec) return make("recruitee", rec[1]);
  return null;
}

/** Public list endpoint for a board. */
export function boardApiUrl(s: JobSource, page = 0): string {
  const slug = encodeURIComponent(s.slug);
  switch (s.ats) {
    case "greenhouse": return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    case "lever": return `https://api.lever.co/v0/postings/${slug}?mode=json`;
    case "ashby": return `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
    case "smartrecruiters": return `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${page * 100}`;
    case "workable": return `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
    case "recruitee": return `https://${slug.toLowerCase()}.recruitee.com/api/offers/`;
  }
}

/* ------------------------------ HTML → text ------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", bull: "•" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Job-description HTML to readable plain text with line breaks and bullets kept. */
export function htmlToText(html: string): string {
  let s = html;
  // Greenhouse double-encodes: "&lt;div&gt;" → "<div>"
  if (/&lt;\/?[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------ parsing ------------------------------ */

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const iso = (v: unknown): string | null => {
  if (typeof v === "number") return new Date(v).toISOString();
  const str = s(v).trim();
  if (!str) return null;
  const d = new Date(str.replace(/ UTC$/, "Z").replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const REMOTE_WORD = /\bremote\b|work from home|\bwfh\b|anywhere/i;
const remoteFrom = (flag: unknown, ...texts: string[]): boolean | null =>
  flag === true ? true : texts.some((t) => REMOTE_WORD.test(t)) ? true : flag === false ? false : null;

/** Normalise one board's JSON into jobs. Unknown or malformed shapes yield []. */
export function parseBoard(src: JobSource, data: unknown): DiscoveredJob[] {
  const base = { ats: src.ats, slug: src.slug, company: src.company };
  const make = (id: string, j: Omit<DiscoveredJob, "id" | "ats" | "slug" | "company">): DiscoveredJob | null =>
    id && j.title && j.url ? { id: `${src.ats}:${src.slug}:${id}`, ...base, ...j } : null;
  const out: (DiscoveredJob | null)[] = [];

  switch (src.ats) {
    case "greenhouse":
      for (const raw of arr(o(data).jobs)) {
        const j = o(raw);
        const location = s(o(j.location).name);
        out.push(make(s(j.id), {
          title: s(j.title).trim(), location, remote: remoteFrom(null, location),
          department: s(o(arr(j.departments)[0]).name), url: s(j.absolute_url), applyUrl: s(j.absolute_url),
          postedAt: iso(j.first_published) ?? iso(j.updated_at), text: htmlToText(s(j.content)),
        }));
      }
      break;
    case "lever":
      for (const raw of arr(data)) {
        const j = o(raw);
        const c = o(j.categories);
        const location = [s(c.location), ...arr(c.allLocations).map(s)].filter((v, i, a) => v && a.indexOf(v) === i).join(" / ");
        const lists = arr(j.lists).map((l) => `${s(o(l).text)}\n${htmlToText(s(o(l).content))}`).join("\n\n");
        out.push(make(s(j.id), {
          title: s(j.text).trim(), location, remote: j.workplaceType === "remote" ? true : j.workplaceType === "onsite" || j.workplaceType === "hybrid" ? false : remoteFrom(null, location),
          department: s(c.team) || s(c.department), url: s(j.hostedUrl), applyUrl: s(j.applyUrl) || s(j.hostedUrl),
          postedAt: iso(j.createdAt), text: [s(j.descriptionPlain) || htmlToText(s(j.description)), lists, s(j.additionalPlain)].filter(Boolean).join("\n\n").trim(),
        }));
      }
      break;
    case "ashby":
      for (const raw of arr(o(data).jobs)) {
        const j = o(raw);
        if (j.isListed === false) continue;
        const location = [s(j.location), ...arr(j.secondaryLocations).map((l) => s(o(l).location))].filter(Boolean).join(" / ");
        out.push(make(s(j.id), {
          // workplaceType wins: Ashby sets isRemote=true on hybrid roles too
          title: s(j.title).trim(), location,
          remote: j.workplaceType === "Remote" ? true : j.workplaceType === "Hybrid" || j.workplaceType === "OnSite" ? false : remoteFrom(j.isRemote, location),
          department: s(j.team) || s(j.department), url: s(j.jobUrl), applyUrl: s(j.applyUrl) || s(j.jobUrl),
          postedAt: iso(j.publishedAt), text: s(j.descriptionPlain) || htmlToText(s(j.descriptionHtml)),
        }));
      }
      break;
    case "smartrecruiters":
      for (const raw of arr(o(data).content)) {
        const j = o(raw);
        const loc = o(j.location);
        const location = s(loc.fullLocation) || [s(loc.city), s(loc.country).toUpperCase()].filter(Boolean).join(", ");
        const id = s(j.id);
        const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(src.slug)}/${encodeURIComponent(id)}`;
        out.push(make(id, {
          title: s(j.name).trim(), location, remote: remoteFrom(loc.remote, location),
          department: s(o(j.department).label) || s(o(j.function).label), url, applyUrl: url,
          postedAt: iso(j.releasedDate),
          // The list has no description; fetchBoard fills it from the detail endpoint for jobs that pass the filters
          text: "",
        }));
      }
      break;
    case "workable":
      for (const raw of arr(o(data).jobs)) {
        const j = o(raw);
        const location = [s(j.city), s(j.state), s(j.country)].filter(Boolean).join(", ");
        out.push(make(s(j.shortcode), {
          title: s(j.title).trim(), location, remote: remoteFrom(j.telecommuting, location, s(j.title)),
          department: s(j.department), url: s(j.url) || s(j.shortlink), applyUrl: s(j.application_url) || s(j.url),
          postedAt: iso(j.published_on) ?? iso(j.created_at), text: htmlToText(s(j.description)),
        }));
      }
      break;
    case "recruitee":
      for (const raw of arr(o(data).offers)) {
        const j = o(raw);
        const location = s(j.location) || [s(j.city), s(j.country_code)].filter(Boolean).join(", ");
        out.push(make(s(j.id), {
          title: s(j.title).trim(), location, remote: remoteFrom(j.remote, location),
          department: s(j.department), url: s(j.careers_url), applyUrl: s(j.careers_apply_url) || s(j.careers_url),
          postedAt: iso(j.published_at), text: [htmlToText(s(j.description)), htmlToText(s(j.requirements))].filter(Boolean).join("\n\n"),
        }));
      }
      break;
  }
  return out.filter((j): j is DiscoveredJob => !!j);
}

/** Description text from a SmartRecruiters posting detail. */
export function parseSmartRecruitersDetail(data: unknown): string {
  const sections = o(o(o(data).jobAd).sections);
  return ["jobDescription", "qualifications", "additionalInformation"]
    .map((k) => {
      const sec = o(sections[k]);
      const body = htmlToText(s(sec.text));
      return body ? `${s(sec.title)}\n${body}`.trim() : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------ filtering ------------------------------ */

export interface DiscoverFilters {
  /** Any of these must appear in the title (or the description when `searchDescription`). Empty = everything. */
  keywords: string[];
  /** Any of these must appear in the location. Empty = anywhere. */
  locations: string[];
  /** Also keep remote jobs whose location doesn't match */
  includeRemote: boolean;
  /** Hide senior / staff / lead / manager / director roles */
  earlyCareerOnly: boolean;
  /** Only jobs posted in the last N days (jobs without a date are kept). 0 = any time. */
  postedWithinDays: number;
  searchDescription?: boolean;
}

export const DEFAULT_FILTERS: DiscoverFilters = {
  keywords: ["engineer", "developer", "intern", "ai", "ml", "machine learning", "data", "backend", "software"],
  locations: ["india", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "chennai"],
  includeRemote: true,
  earlyCareerOnly: true,
  postedWithinDays: 60,
};

export const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|leader|head|director|manager|vp|vice president|chief|architect|distinguished|fellow|partner|avp|gm)\b|\b(iii|iv|v)\s*$/i;
export const EARLY_TITLE = /\b(intern(ship)?|new grad|graduate|entry[\s-]level|junior|jr\.?|fresher|trainee|apprentice|associate|early[\s-]career|university|campus|engineer i|sde[\s-]?(i|1)|swe[\s-]?(i|1)|level 1|l1)\b/i;

const TOP_ROLE = /\b(director|vp|vice president|head|chief|principal|manager)\b/i;
/** Senior roles, unless the title is clearly early-career ("Associate Software Engineer", "Lead Generation Intern"). */
export function isSeniorTitle(title: string): boolean {
  return SENIOR_TITLE.test(title) && !(EARLY_TITLE.test(title) && !TOP_ROLE.test(title));
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Word-boundary match so "ai" doesn't hit "maintain" and "ml" doesn't hit "html". */
function containsTerm(haystack: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(t.toLowerCase())}([^a-z0-9]|$)`, "i").test(haystack.toLowerCase());
}

const GLOBAL_REMOTE = /\b(anywhere|global(ly)?|worldwide|world[\s-]?wide|international|apac|asia)\b/i;
/**
 * A remote job is open to you only if it isn't tied to another place: "Remote" or "Remote, Global" pass,
 * "Remote, United States" or "Remote-Friendly | San Francisco" don't (unless that place is in your locations).
 */
export function remoteOpenToAnyone(location: string): boolean {
  if (GLOBAL_REMOTE.test(location)) return true;
  const rest = location
    .replace(/remote[\s-]*(friendly|first|ok)?|work from home|wfh|hybrid|\(travel required\)|distributed|flexible/gi, " ")
    .replace(/[^a-z]+/gi, " ")
    .trim();
  return rest.length === 0;
}

export function matchesFilters(job: DiscoveredJob, f: DiscoverFilters, now = Date.now()): boolean {
  if (f.earlyCareerOnly && isSeniorTitle(job.title)) return false;
  if (f.keywords.length) {
    const hay = f.searchDescription ? `${job.title}\n${job.department}\n${job.text}` : `${job.title} ${job.department}`;
    if (!f.keywords.some((k) => containsTerm(hay, k))) return false;
  }
  if (f.locations.length) {
    const here = f.locations.some((l) => containsTerm(job.location, l));
    if (!here && !(f.includeRemote && job.remote && remoteOpenToAnyone(job.location))) return false;
  }
  if (f.postedWithinDays > 0 && job.postedAt) {
    const age = (now - new Date(job.postedAt).getTime()) / 86_400_000;
    if (age > f.postedWithinDays) return false;
  }
  return true;
}

/** Drop repeats: same URL, or the same company + title + location (multi-board / re-posted roles). */
export function dedupeJobs(jobs: DiscoveredJob[]): DiscoveredJob[] {
  const seen = new Set<string>();
  const out: DiscoveredJob[] = [];
  for (const j of jobs) {
    const keys = [jobKey(j.url), `${j.company}|${j.title}|${j.location}`.toLowerCase().replace(/\s+/g, " ")];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(j);
  }
  return out;
}

/* ------------------------------ fit flags ------------------------------ */

export type FitFlagKind = "eligibility" | "experience" | "work_authorization" | "location" | "seniority" | "student_only";

export interface FitFlag {
  kind: FitFlagKind;
  /** blocker: you likely can't be considered; caution: worth checking before applying */
  severity: "blocker" | "caution";
  message: string;
}

const WORK_AUTH = /(must be (legally )?authori[sz]ed to work in (the )?(us|u\.s\.|united states|uk|canada|eu|europe|australia)|(no|not able to|unable to|cannot|can't|does not|do not|will not) (provide |offer )?(visa )?sponsor|without (the need for )?(visa )?sponsorship|(us|u\.s\.) citizen(ship)? (is )?required|security clearance|green card)/i;
const STUDENT_ONLY = /(currently enrolled|must be (a )?(current )?(student|enrolled)|pursuing (a|an|your) (bachelor|master|degree)|returning to (school|university)|final[- ]year students? only)/i;

/**
 * Reasons a technically relevant job may still be a poor use of an application, kept separate from the score.
 * `candidate` facts come from the user's profile/resume; unknown facts never produce a flag.
 */
export function fitFlags(
  job: Pick<DiscoveredJob, "title" | "location" | "remote" | "text">,
  ctx: {
    minYearsExperience: number | null;
    candidateMonths: number | null;
    eligibilityNotMet: string[];
    candidateCountry: string;
    /** The candidate has already graduated (graduation year in the past) */
    graduated: boolean | null;
  },
): FitFlag[] {
  const flags: FitFlag[] = [];
  for (const e of ctx.eligibilityNotMet) flags.push({ kind: "eligibility", severity: "blocker", message: e });
  if (ctx.minYearsExperience && ctx.minYearsExperience > 0 && ctx.candidateMonths !== null) {
    const have = ctx.candidateMonths / 12;
    if (have + 0.1 < ctx.minYearsExperience) {
      flags.push({
        kind: "experience",
        severity: ctx.minYearsExperience - have >= 2 ? "blocker" : "caution",
        message: `Asks for ${ctx.minYearsExperience}+ years; your resume shows about ${have.toFixed(1)}`,
      });
    }
  }
  if (isSeniorTitle(job.title)) {
    flags.push({ kind: "seniority", severity: "caution", message: "Senior-level title" });
  }
  const auth = job.text.match(WORK_AUTH);
  if (auth && !/united states|usa|\bus\b|u\.s\./i.test(ctx.candidateCountry)) {
    flags.push({ kind: "work_authorization", severity: "blocker", message: `Work authorization: “${auth[0]}”` });
  }
  if (ctx.graduated === true && STUDENT_ONLY.test(job.text)) {
    flags.push({ kind: "student_only", severity: "blocker", message: "Open to current students only" });
  }
  const country = ctx.candidateCountry.trim().toLowerCase();
  if (country && job.location && !job.remote && !containsTerm(job.location, country) && !(country === "india" && /bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad/i.test(job.location))) {
    flags.push({ kind: "location", severity: "caution", message: `On-site in ${job.location}; check relocation` });
  }
  return flags;
}

/* ------------------------------ fetching ------------------------------ */

export interface FetchBoardOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** SmartRecruiters only: fetch descriptions for jobs passing this test (detail call per job) */
  needsDetail?: (job: DiscoveredJob) => boolean;
  maxDetails?: number;
}

async function getJson(url: string, opts: FetchBoardOptions): Promise<unknown> {
  const f = opts.fetchImpl ?? fetch;
  const timer = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timer]) : timer;
  const res = await f(url, { signal, headers: { Accept: "application/json" } });
  if (res.status === 404) throw new Error("Board not found (check the company's slug)");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Every open job on one board. Throws on network errors or an unknown board. */
export async function fetchBoard(src: JobSource, opts: FetchBoardOptions = {}): Promise<DiscoveredJob[]> {
  if (!isValidSource(src)) throw new Error("Invalid board");
  if (src.ats !== "smartrecruiters") return parseBoard(src, await getJson(boardApiUrl(src), opts));

  // SmartRecruiters pages 100 at a time; cap at 3 pages to stay fast
  const jobs: DiscoveredJob[] = [];
  for (let page = 0; page < 3; page++) {
    const data = await getJson(boardApiUrl(src, page), opts);
    const batch = parseBoard(src, data);
    jobs.push(...batch);
    const total = Number(o(data).totalFound) || 0;
    if (batch.length < 100 || jobs.length >= total) break;
  }
  if (opts.needsDetail) {
    const want = jobs.filter(opts.needsDetail).slice(0, opts.maxDetails ?? 20);
    await Promise.all(want.map(async (j) => {
      const id = j.id.split(":").pop()!;
      try {
        const detail = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(src.slug)}/postings/${encodeURIComponent(id)}`, opts);
        j.text = parseSmartRecruitersDetail(detail);
      } catch { /* keep the job without a description */ }
    }));
  }
  return jobs;
}

export interface BoardResult {
  source: JobSource;
  jobs: DiscoveredJob[];
  error: string | null;
}

/** Fetch many boards with limited concurrency; one failing board never fails the rest. */
export async function fetchBoards(sources: JobSource[], opts: FetchBoardOptions & { concurrency?: number } = {}): Promise<BoardResult[]> {
  const results: BoardResult[] = new Array(sources.length);
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const i = next++;
      try {
        results[i] = { source: sources[i], jobs: await fetchBoard(sources[i], opts), error: null };
      } catch (e) {
        if ((e as Error)?.name === "AbortError" && opts.signal?.aborted) throw e;
        const msg = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" ? "Timed out" : (e as Error).message;
        results[i] = { source: sources[i], jobs: [], error: msg };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, sources.length) }, worker));
  return results;
}
