import { canonicalSkill, findSkills } from "./skills";
import { detectDegreeLevels, type CGPA, type DegreeLevel } from "./resume";

export interface JobPosting {
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  /** Plain-text job description */
  text: string;
  /** How the posting was extracted: json-ld | site:<name> | selection | generic */
  source: string;
  /** ISO date from structured data, if any */
  validThrough?: string | null;
}

export interface JobRequirements {
  requiredSkills: string[];
  preferredSkills: string[];
  minYearsExperience: number | null;
  degreeLevels: DegreeLevel[];
  minCgpa: CGPA | null;
  graduationYears: number[];
  deadline: string | null;
  origin: "heuristic" | "ai";
}

const PREFERRED_HEADER =
  /(preferred|nice[\s-]to[\s-]have|good[\s-]to[\s-]have|bonus|plus\b|desirable|optional|not\s+required|added\s+advantage)/i;
const REQUIRED_HEADER =
  /(requirements?|required|qualifications?|must[\s-]have|what\s+you('|’)?ll\s+need|who\s+you\s+are|minimum|basic|eligibility|skills)/i;
// Sections that describe the company/benefits, where skill words are noise
const IGNORE_HEADER = /(about\s+(us|the\s+company|company)|benefits|perks|what\s+we\s+offer|equal\s+opportunity|our\s+culture)/i;

function isHeaderLike(line: string): boolean {
  if (/^([•\-*▪●◦‣–·]|\d+[.)])\s/.test(line)) return false; // bullets are content, not headers
  return line.length <= 70 && (/:$/.test(line) || line.split(" ").length <= 7) && !/[.!?]$/.test(line);
}

/** Pull the smallest "N years" figure from lines that talk about experience. */
export function parseMinYears(text: string): number | null {
  const values: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/experience|exp\b/i.test(line)) continue;
    for (const m of line.matchAll(/(\d{1,2})(?:\s*(?:-|–|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)/gi)) {
      values.push(parseInt(m[1], 10));
    }
    if (/\b(no\s+(prior\s+)?experience|freshers?|0\s*years?)\b/i.test(line)) values.push(0);
  }
  return values.length ? Math.min(...values) : null;
}

export function parseMinCgpa(text: string): CGPA | null {
  const m = text.match(
    /(?:c\.?g\.?p\.?a|g\.?p\.?a|cpi)[^0-9\n]{0,30}?(\d(?:\.\d{1,2})?)\s*(?:\/\s*(10|4)(?:\.0+)?)?/i,
  ) ?? text.match(/(\d(?:\.\d{1,2})?)\s*(?:\/\s*(10|4)(?:\.0+)?)?\s*(?:c\.?g\.?p\.?a|g\.?p\.?a)\s*(?:or\s+)?(?:above|and\s+above|minimum)/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const scale = m[2] ? parseFloat(m[2]) : value <= 4 ? 4 : 10;
  return value > 0 && value <= scale ? { value, scale } : null;
}

export function parseGraduationYears(text: string): number[] {
  const years = new Set<number>();
  for (const line of text.split(/\r?\n/)) {
    if (!/(batch|graduat|class\s+of|passing\s*out|pass[\s-]?out|expected\s+to\s+graduate|final[\s-]year)/i.test(line)) continue;
    for (const m of line.matchAll(/\b(20[2-4]\d)\b/g)) years.add(parseInt(m[1], 10));
  }
  return [...years].sort();
}

export function parseDeadline(text: string): string | null {
  const m = text.match(
    /(?:deadline|apply\s+by|last\s+date(?:\s+to\s+apply)?|applications?\s+close)[^\n0-9a-z]{0,10}(?:is\s+|on\s+)?((?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4})|(?:[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}))/i,
  );
  return m ? m[1] : null;
}

/** Deterministic requirement extraction. Used when no AI provider is configured, and as a fallback. */
export function extractRequirementsHeuristic(job: JobPosting): JobRequirements {
  const required = new Set<string>();
  const preferred = new Set<string>();
  let mode: "required" | "preferred" | "ignore" | "neutral" = "neutral";

  for (const raw of job.text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeaderLike(line)) {
      if (IGNORE_HEADER.test(line)) mode = "ignore";
      else if (PREFERRED_HEADER.test(line)) mode = "preferred";
      else if (REQUIRED_HEADER.test(line)) mode = "required";
      else if (/(responsibilit|what\s+you('|’)?ll\s+do|role|about\s+the\s+(role|job)|description)/i.test(line)) mode = "neutral";
    }
    if (mode === "ignore") continue;
    const lineIsPreferred = mode === "preferred" || PREFERRED_HEADER.test(line);
    for (const name of findSkills(line).keys()) {
      (lineIsPreferred ? preferred : required).add(name);
    }
  }
  for (const s of required) preferred.delete(s);

  return {
    requiredSkills: [...required],
    preferredSkills: [...preferred],
    minYearsExperience: parseMinYears(job.text),
    degreeLevels: detectDegreeLevels(job.text),
    minCgpa: parseMinCgpa(job.text),
    graduationYears: parseGraduationYears(job.text),
    deadline: parseDeadline(job.text) ?? (job.validThrough ? job.validThrough.slice(0, 10) : null),
    origin: "heuristic",
  };
}

export function normalizeSkillList(list: string[]): string[] {
  const out = new Map<string, string>();
  for (const s of list) {
    if (!s || !s.trim()) continue;
    const c = canonicalSkill(s);
    out.set(c.toLowerCase(), c);
  }
  return [...out.values()];
}
