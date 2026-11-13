import { DEFAULT_FILTERS, DEFAULT_SOURCES, isValidSource, sourceKey, type DiscoverFilters, type DiscoveredJob, type FitFlag, type JobSource } from "@internova/core";

/** Stored in public.discovery_settings.data */
export interface DiscoverySettings {
  /** Boards the user added (on top of the defaults) */
  sources: JobSource[];
  /** sourceKey()s of default boards the user switched off */
  hidden: string[];
  filters: DiscoverFilters;
}

export const EMPTY_SETTINGS: DiscoverySettings = { sources: [], hidden: [], filters: DEFAULT_FILTERS };

const strList = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, max);

/** Accept anything stored or sent by a client; return a safe, complete settings object. */
export function normalizeSettings(raw: unknown): DiscoverySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const f = (r.filters && typeof r.filters === "object" ? r.filters : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const sources = (Array.isArray(r.sources) ? r.sources : [])
    .filter((s) => isValidSource(s as JobSource))
    .map((s) => {
      const src = s as JobSource;
      return { ats: src.ats, slug: src.slug, company: String(src.company || src.slug).slice(0, 80) };
    })
    .filter((s) => !seen.has(sourceKey(s)) && seen.add(sourceKey(s)))
    .slice(0, 60);
  return {
    sources,
    hidden: strList(r.hidden, 100),
    filters: {
      keywords: Array.isArray(f.keywords) ? strList(f.keywords, 30) : DEFAULT_FILTERS.keywords,
      locations: Array.isArray(f.locations) ? strList(f.locations, 30) : DEFAULT_FILTERS.locations,
      includeRemote: typeof f.includeRemote === "boolean" ? f.includeRemote : DEFAULT_FILTERS.includeRemote,
      earlyCareerOnly: typeof f.earlyCareerOnly === "boolean" ? f.earlyCareerOnly : DEFAULT_FILTERS.earlyCareerOnly,
      postedWithinDays: Math.min(365, Math.max(0, Number(f.postedWithinDays ?? DEFAULT_FILTERS.postedWithinDays) || 0)),
      searchDescription: !!f.searchDescription,
    },
  };
}

/** Default boards (minus hidden ones) plus the user's own, without duplicates. */
export function activeSources(s: DiscoverySettings): JobSource[] {
  const hidden = new Set(s.hidden);
  const out = new Map<string, JobSource>();
  for (const src of [...DEFAULT_SOURCES.filter((d) => !hidden.has(sourceKey(d))), ...s.sources]) out.set(sourceKey(src), src);
  return [...out.values()];
}

export interface RankedJob extends Omit<DiscoveredJob, "text"> {
  /** Description, shortened for transfer */
  text: string;
  /** Alignment with your best-matching resume, 0–100 (null: no description or no resume) */
  score: number | null;
  resumeName: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  flags: FitFlag[];
  deadline: string | null;
  /** Recruiter contacts you have at this company */
  contacts: number;
}

export interface DiscoverResponse {
  jobs: RankedJob[];
  /** Jobs that passed the filters (before the display cap) */
  matched: number;
  scanned: number;
  boards: { company: string; ats: string; slug: string; jobs: number; error: string | null }[];
  hasResume: boolean;
}
