import { findSkills, type SkillHit } from "./skills";

export type SectionName =
  | "summary"
  | "education"
  | "experience"
  | "projects"
  | "skills"
  | "certifications"
  | "achievements"
  | "leadership"
  | "publications";

const SECTION_HEADERS: [SectionName, RegExp][] = [
  ["summary", /^(professional\s+)?(summary|objective|profile|about\s+me)$/i],
  ["education", /^(education|academics?|academic\s+(background|details|qualifications?)|educational\s+qualifications?)$/i],
  ["experience", /^((work|professional|industry|relevant)\s+)?(experience|employment(\s+history)?|internships?|work\s+history)$/i],
  ["projects", /^((academic|personal|key|technical|selected)\s+)?projects?$/i],
  ["skills", /^((technical|core|key)\s+)?(skills|competencies|technologies|tech\s+stack|skills\s*(&|and)\s*\w+)$/i],
  ["certifications", /^(certifications?|licenses?(\s*(&|and)\s*certifications?)?|courses?(\s*(&|and)\s*certifications?)?)$/i],
  ["achievements", /^(achievements?|awards?(\s*(&|and)\s*\w+)?|honou?rs?(\s*(&|and)\s*awards?)?|accomplishments)$/i],
  ["leadership", /^(leadership|positions?\s+of\s+responsibility|extra[-\s]?curricular(\s+activities)?|volunteering|activities)$/i],
  ["publications", /^((research|selected|academic|conference|journal)\s+)?(publications?|papers?)(\s*(&|and)\s*\w+)?$|^research(\s+(work|experience|papers?))?$|^papers?\s*(&|and)\s*publications?$/i],
];

export interface CGPA {
  value: number;
  scale: number;
}

export type DegreeLevel = "diploma" | "bachelor" | "master" | "phd";

export interface ResumeAnalysis {
  text: string;
  lines: string[];
  wordCount: number;
  sections: Partial<Record<SectionName, string[]>>;
  /** Which section each line sits in (lines before the first heading are absent) */
  lineSection: Map<string, SectionName>;
  contact: { email: string | null; phone: string | null; linkedin: string | null; github: string | null };
  skills: Map<string, SkillHit>;
  cgpa: CGPA | null;
  graduationYear: number | null;
  degreeLevels: DegreeLevel[];
  /** Estimated months of experience from date ranges in the experience section (null if none found) */
  experienceMonths: number | null;
  bullets: string[];
  quantifiedBullets: string[];
  actionVerbBullets: string[];
}

const ACTION_VERBS = new Set(
  (
    "achieved analyzed architected automated built collaborated conducted created debugged deployed designed developed " +
    "drove engineered enhanced established evaluated executed implemented improved increased integrated launched led " +
    "maintained managed mentored migrated optimized orchestrated organized owned pioneered prototyped published reduced " +
    "refactored researched resolved scaled shipped spearheaded streamlined tested trained transformed wrote coordinated " +
    "delivered devised facilitated formulated generated initiated modeled modelled programmed redesigned revamped " +
    "simplified accelerated authored contributed fine-tuned benchmarked containerized"
  ).split(/\s+/),
);

const BULLET_RE = /^([•\-*▪●◦‣–·]|\d+[.)])\s+/;

const DEGREE_PATTERNS: [DegreeLevel, RegExp][] = [
  ["phd", /\b(ph\.?\s?d|doctorate)\b/i],
  ["master", /\b(m\.?\s?tech|m\.?\s?e\b|m\.?\s?s\b|m\.?\s?sc|mca|mba|master'?s?|m\.?\s?eng)\b/i],
  ["bachelor", /\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?s\b|b\.?\s?sc|bca|bba|b\.?\s?com|bachelor'?s?|b\.?\s?eng|undergraduate)\b/i],
  ["diploma", /\bdiploma\b/i],
];

export function detectDegreeLevels(text: string): DegreeLevel[] {
  return DEGREE_PATTERNS.filter(([, re]) => re.test(text)).map(([level]) => level);
}

export function parseCGPA(text: string): CGPA | null {
  const patterns = [
    /(?:c\.?g\.?p\.?a|g\.?p\.?a|cpi|sgpa)\s*(?:of|:|-|–)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/\s*(10|4)(?:\.0+)?)?/i,
    /(\d{1,2}(?:\.\d{1,2})?)\s*\/\s*(10|4)(?:\.0+)?\s*(?:c\.?g\.?p\.?a|g\.?p\.?a|cpi)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const value = parseFloat(m[1]);
    const scale = m[2] ? parseFloat(m[2]) : value <= 4 ? 4 : 10;
    if (value > 0 && value <= scale) return { value, scale };
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

const DATE_TOKEN = String.raw`(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*'?\d{2,4}|\d{1,2}\/\d{4}|\d{4})`;
const RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(${DATE_TOKEN}|present|current|now|ongoing|till\\s+date)`,
  "gi",
);

function parseDateToken(tok: string, now: Date, isEnd: boolean): number | null {
  const t = tok.trim().toLowerCase();
  if (/^(present|current|now|ongoing|till\s+date)$/.test(t)) return now.getFullYear() * 12 + now.getMonth();
  let m = t.match(/^([a-z]+)\.?\s*'?(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[1].slice(0, 4)] ?? MONTHS[m[1].slice(0, 3)];
    let year = parseInt(m[2], 10);
    if (year < 100) year += 2000;
    return month === undefined ? null : year * 12 + month;
  }
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return parseInt(m[2], 10) * 12 + (parseInt(m[1], 10) - 1);
  m = t.match(/^(\d{4})$/);
  // A bare year: start of year for range start, end of year for range end
  if (m) return parseInt(m[1], 10) * 12 + (isEnd ? 11 : 0);
  return null;
}

/** Sum of (merged) date ranges in the given lines, in months. Null when no ranges are found. */
export function estimateExperienceMonths(lines: string[], now = new Date()): number | null {
  const intervals: [number, number][] = [];
  for (const line of lines) {
    for (const match of line.matchAll(RANGE_RE)) {
      const start = parseDateToken(match[1], now, false);
      const end = parseDateToken(match[2], now, true);
      if (start !== null && end !== null && end >= start && end - start < 12 * 15) {
        intervals.push([start, end + 1]); // inclusive end month
      }
    }
  }
  if (!intervals.length) return null;
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = intervals[0];
  for (const [s, e] of intervals.slice(1)) {
    if (s <= curEnd) curEnd = Math.max(curEnd, e);
    else {
      total += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  return total + (curEnd - curStart);
}

function splitSections(lines: string[]): Partial<Record<SectionName, string[]>> {
  const sections: Partial<Record<SectionName, string[]>> = {};
  let current: SectionName | null = null;
  for (const line of lines) {
    const header = line.replace(/[:|_=\-–—]+$/g, "").trim();
    const match = header.length <= 45 ? SECTION_HEADERS.find(([, re]) => re.test(header)) : undefined;
    if (match) {
      current = match[0];
      sections[current] ??= [];
      continue;
    }
    if (current) sections[current]!.push(line);
  }
  return sections;
}

export function analyzeResume(text: string, now = new Date()): ResumeAnalysis {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const sections = splitSections(lines);
  const lineSection = new Map<string, SectionName>();
  for (const [name, sectionLines] of Object.entries(sections) as [SectionName, string[]][]) {
    for (const l of sectionLines) if (!lineSection.has(l)) lineSection.set(l, name);
  }

  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? null;
  // Require 10–15 digits so year ranges ("2021-2025") aren't mistaken for phone numbers
  const phone =
    [...text.matchAll(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{4,5}/g)]
      .map((m) => m[0].trim())
      .find((p) => {
        const digits = p.replace(/\D/g, "").length;
        return digits >= 10 && digits <= 15;
      }) ?? null;
  const linkedin = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i)?.[0] ?? null;
  const github = text.match(/(?:https?:\/\/)?github\.com\/[A-Za-z0-9_-]+/i)?.[0] ?? null;

  const eduLines = sections.education ?? lines.filter((l) => detectDegreeLevels(l).length > 0);
  const eduText = eduLines.join("\n");
  const years = [...eduText.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) => parseInt(m[1], 10));
  const graduationYear = years.length ? Math.max(...years) : null;

  const expLines = sections.experience ?? [];
  const bullets = lines.filter((l) => BULLET_RE.test(l)).map((l) => l.replace(BULLET_RE, ""));
  // Resumes without bullet glyphs: treat sentence-like lines inside experience/projects as bullets
  const bulletPool = bullets.length
    ? bullets
    : [...(sections.experience ?? []), ...(sections.projects ?? [])].filter((l) => l.split(" ").length >= 6);

  return {
    text,
    lines,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    sections,
    lineSection,
    contact: { email, phone, linkedin, github },
    skills: findSkills(text),
    cgpa: parseCGPA(eduText) ?? parseCGPA(text),
    graduationYear,
    degreeLevels: detectDegreeLevels(eduText || text),
    experienceMonths: estimateExperienceMonths(expLines, now),
    bullets: bulletPool,
    quantifiedBullets: bulletPool.filter((b) => /\d|%|\$|₹|\bx\b/i.test(b)),
    actionVerbBullets: bulletPool.filter((b) => ACTION_VERBS.has(b.split(/[\s,]/)[0].toLowerCase())),
  };
}
