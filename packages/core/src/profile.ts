import { analyzeResume, estimateExperienceMonths, parseCGPA } from "./resume";
import { findSkills, skillCategory } from "./skills";

/* ------------------------------------------------------------------ */
/* Rich candidate profile (v2). Everything the user can edit in the    */
/* Profile tab; autofill and AI answers draw only from this + resume.  */
/* ------------------------------------------------------------------ */

export interface EducationEntry {
  school: string;
  degree: string;
  major: string;
  startYear: string;
  endYear: string;
  cgpa: string;
  cgpaScale: string;
}

export interface ExperienceEntry {
  title: string;
  company: string;
  location: string;
  start: string;
  end: string;
  description: string;
}

export interface ProjectEntry {
  name: string;
  link: string;
  tech: string;
  description: string;
}

export interface PublicationEntry {
  title: string;
  venue: string;
  year: string;
  link: string;
}

export interface CandidateProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  headline: string;
  summary: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: string[];
  publications: PublicationEntry[];
  certifications: string[];
  achievements: string[];
  /** Free text the user wants autofill / AI to know (availability, interests, tools used, ...) */
  additionalInfo: string;
  /** Common-question id → the user's own answer (see questions.ts) */
  answers: Record<string, string>;
  updatedAt: number;
}

export const EMPTY_EDUCATION: EducationEntry = { school: "", degree: "", major: "", startYear: "", endYear: "", cgpa: "", cgpaScale: "" };
export const EMPTY_EXPERIENCE: ExperienceEntry = { title: "", company: "", location: "", start: "", end: "", description: "" };
export const EMPTY_PROJECT: ProjectEntry = { name: "", link: "", tech: "", description: "" };
export const EMPTY_PUBLICATION: PublicationEntry = { title: "", venue: "", year: "", link: "" };

export const EMPTY_PROFILE: CandidateProfile = {
  firstName: "", lastName: "", email: "", phone: "", city: "", country: "",
  linkedin: "", github: "", portfolio: "", headline: "", summary: "",
  education: [], experience: [], projects: [], skills: [], publications: [], certifications: [], achievements: [],
  additionalInfo: "", answers: {}, updatedAt: 0,
};

/** Flat view used by form-field matching. */
export interface FlatProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  headline: string;
  summary: string;
  college: string;
  degree: string;
  major: string;
  graduationYear: string;
  cgpa: string;
  cgpaScale: string;
  currentCompany: string;
  currentTitle: string;
  skills: string;
}

const isCurrent = (end: string) => !end.trim() || /present|current|now|ongoing/i.test(end);

export function flatProfile(p: CandidateProfile): FlatProfile {
  const edu = p.education[0] ?? EMPTY_EDUCATION;
  const current = p.experience.find((e) => isCurrent(e.end) && (e.company || e.title));
  return {
    firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone, city: p.city, country: p.country,
    linkedin: p.linkedin, github: p.github, portfolio: p.portfolio, headline: p.headline, summary: p.summary,
    college: edu.school, degree: edu.degree, major: edu.major, graduationYear: edu.endYear, cgpa: edu.cgpa, cgpaScale: edu.cgpaScale,
    currentCompany: current?.company ?? "", currentTitle: current?.title ?? "",
    skills: p.skills.join(", "),
  };
}

/**
 * Accepts anything previously stored (including the flat v0.2 profile) and returns a complete v2 profile.
 */
export function normalizeProfile(raw: unknown): CandidateProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const arr = <T>(v: unknown, empty: T): T[] =>
    Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => ({ ...empty, ...Object.fromEntries(Object.entries(x).map(([k, val]) => [k, str(val)])) }) as T) : [];
  const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).map((s) => s.trim()).filter(Boolean) : []);
  const p: CandidateProfile = {
    ...EMPTY_PROFILE,
    firstName: str(r.firstName), lastName: str(r.lastName), email: str(r.email), phone: str(r.phone),
    city: str(r.city), country: str(r.country), linkedin: str(r.linkedin), github: str(r.github), portfolio: str(r.portfolio),
    headline: str(r.headline), summary: str(r.summary),
    education: arr(r.education, EMPTY_EDUCATION),
    experience: arr(r.experience, EMPTY_EXPERIENCE),
    projects: arr(r.projects, EMPTY_PROJECT),
    skills: strs(r.skills),
    publications: arr(r.publications, EMPTY_PUBLICATION),
    certifications: strs(r.certifications),
    achievements: strs(r.achievements),
    additionalInfo: str(r.additionalInfo),
    answers: r.answers && typeof r.answers === "object" ? Object.fromEntries(Object.entries(r.answers as object).map(([k, v]) => [k, str(v)])) : {},
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
  };
  // v0.2 flat profile → first education / experience entry
  if (!p.education.length && (r.college || r.degree || r.major || r.graduationYear || r.cgpa)) {
    p.education = [{ ...EMPTY_EDUCATION, school: str(r.college), degree: str(r.degree), major: str(r.major), endYear: str(r.graduationYear), cgpa: str(r.cgpa), cgpaScale: str(r.cgpaScale) }];
  }
  if (!p.experience.length && r.currentCompany) {
    p.experience = [{ ...EMPTY_EXPERIENCE, company: str(r.currentCompany), end: "Present" }];
  }
  return p;
}

/**
 * Fill only what's empty in `base` from `incoming`. Never overwrites the user's own values.
 * Skills are unioned; lists are taken only when the base list is empty.
 */
export function mergeProfile(base: CandidateProfile, incoming: Partial<CandidateProfile>): CandidateProfile {
  const out: CandidateProfile = { ...base, answers: { ...base.answers } };
  const scalars = ["firstName", "lastName", "email", "phone", "city", "country", "linkedin", "github", "portfolio", "headline", "summary", "additionalInfo"] as const;
  for (const k of scalars) if (!out[k].trim() && incoming[k]?.trim()) out[k] = incoming[k]!.trim();
  const lists = ["education", "experience", "projects", "publications"] as const;
  for (const k of lists) if (!out[k].length && incoming[k]?.length) (out[k] as unknown[]) = incoming[k]!.map((e) => ({ ...e }));
  for (const k of ["certifications", "achievements"] as const) if (!out[k].length && incoming[k]?.length) out[k] = [...incoming[k]!];
  if (incoming.skills?.length) {
    const seen = new Set(out.skills.map((s) => s.toLowerCase()));
    for (const s of incoming.skills) if (s.trim() && !seen.has(s.toLowerCase())) { out.skills.push(s.trim()); seen.add(s.toLowerCase()); }
  }
  for (const [id, a] of Object.entries(incoming.answers ?? {})) if (!out.answers[id]?.trim() && a.trim()) out.answers[id] = a;
  return out;
}

export function isProfileEmpty(p: CandidateProfile): boolean {
  return !p.firstName && !p.email && !p.education.length && !p.experience.length && !p.skills.length;
}

/* ------------------------------ Resume → profile (rules) ------------------------------ */

const withScheme = (url: string | null | undefined) => (url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : "");
const BULLET = /^([•\-*▪●◦‣–·]|\d+[.)])\s+/;
const stripBullet = (l: string) => l.replace(BULLET, "").trim();
const URL_RE = /(https?:\/\/[^\s|,)]+|(?:github\.com|gitlab\.com|[a-z0-9-]+\.(?:vercel\.app|netlify\.app|github\.io))\/?[^\s|,)]*)/i;

const DEGREE_TOKEN =
  /\b(B\.?\s?Tech|B\.?\s?E\.?|B\.?\s?Sc|B\.?\s?S\.?|BCA|BBA|B\.?\s?Com|M\.?\s?Tech|M\.?\s?S\.?|M\.?\s?Sc|MCA|MBA|Ph\.?\s?D|Bachelor(?:'s)?(?:\s+of\s+[A-Z][a-z]+)?|Master(?:'s)?(?:\s+of\s+[A-Z][a-z]+)?|Diploma|Class\s+(?:XII|X|12|10)(?:th)?)\b/;
const SCHOOL_RE = /(universit|institut|college|school|academy|iit\b|nit\b|iiit|bits\b|vidyalaya)/i;
const DATE_RANGE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*'?\d{2,4}|\d{1,2}\/\d{4}|\d{4})\s*(?:-|–|—|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*'?\d{2,4}|\d{1,2}\/\d{4}|\d{4}|present|current|now|ongoing)/i;

function parseEducation(lines: string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];
  // Widened explicitly: TS can't see the closure below reassigning it
  let cur = null as EducationEntry | null;
  const start = (): EducationEntry => { const e = { ...EMPTY_EDUCATION }; cur = e; entries.push(e); return e; };
  for (const raw of lines) {
    const l = stripBullet(raw);
    if (SCHOOL_RE.test(l) && !DEGREE_TOKEN.test(l)) {
      const e = cur && !cur.school ? cur : start();
      e.school = l.split(/\s[|–—]\s|\s-\s|,\s*(?=\d)/)[0].replace(/\s*\(.*?\)\s*$/, "").trim();
    }
    const deg = l.match(DEGREE_TOKEN);
    if (deg) {
      const e: EducationEntry = cur && !cur.degree ? cur : start();
      e.degree = deg[0].replace(/\s+/g, " ");
      const major = l.match(/\b(?:in|of)\s+([A-Z][A-Za-z&,\s]+?)(?:\s*[,|(–—-]|\s+\d|$)/);
      if (major && !/^(Technology|Science|Engineering|Arts|Commerce)$/i.test(major[1].trim())) e.major = major[1].trim();
      if (SCHOOL_RE.test(l) && !e.school) e.school = l.replace(deg[0], "").replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, "").split(/,\s*(?=\d)/)[0].trim();
    }
    const years = [...l.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) => m[1]);
    if (years.length && cur) {
      const e = cur as EducationEntry;
      if (years.length >= 2) { e.startYear ||= years[0]; e.endYear ||= years[years.length - 1]; }
      else e.endYear ||= years[0];
    }
    const g = parseCGPA(l);
    if (g && cur) { (cur as EducationEntry).cgpa ||= String(g.value); (cur as EducationEntry).cgpaScale ||= String(g.scale); }
  }
  return entries.filter((e) => e.school || e.degree);
}

function splitTitleCompany(header: string): { title: string; company: string } {
  const noDates = header.replace(DATE_RANGE, "").replace(/[|,–—-]\s*$/, "").trim();
  const at = noDates.match(/^(.+?)\s+at\s+(.+)$/i);
  if (at) return { title: at[1].trim(), company: at[2].trim() };
  const parts = noDates.split(/\s[|–—-]\s|,\s/).map((s) => s.trim()).filter(Boolean);
  return { title: parts[0] ?? "", company: parts[1] ?? "" };
}

function parseExperience(lines: string[]): ExperienceEntry[] {
  const out: ExperienceEntry[] = [];
  let cur: ExperienceEntry | null = null;
  for (const raw of lines) {
    if (BULLET.test(raw)) {
      if (cur) cur.description += (cur.description ? "\n" : "") + stripBullet(raw);
      continue;
    }
    const range = raw.match(DATE_RANGE);
    if (range || !cur) {
      const { title, company } = splitTitleCompany(raw);
      cur = { ...EMPTY_EXPERIENCE, title, company, start: range?.[1] ?? "", end: range ? (/^(current|now|ongoing)$/i.test(range[2]) ? "Present" : range[2].replace(/^present$/i, "Present")) : "" };
      out.push(cur);
    } else if (cur && !cur.company) {
      cur.company = raw.trim();
    } else if (cur) {
      cur.description += (cur.description ? "\n" : "") + raw.trim();
    }
  }
  return out.filter((e) => e.title || e.company);
}

function parseProjects(lines: string[]): ProjectEntry[] {
  const out: ProjectEntry[] = [];
  let cur: ProjectEntry | null = null;
  for (const raw of lines) {
    const url = raw.match(URL_RE)?.[0];
    if (!BULLET.test(raw) || !cur) {
      const [name, ...rest] = stripBullet(raw).split(/\s[|–—-]\s/);
      cur = { ...EMPTY_PROJECT, name: name.replace(URL_RE, "").trim(), description: rest.join(" — ").replace(URL_RE, "").trim() };
      out.push(cur);
    } else {
      cur.description += (cur.description ? "\n" : "") + stripBullet(raw);
    }
    if (url && cur && !cur.link) cur.link = withScheme(url);
  }
  for (const p of out) p.tech = [...findSkills(`${p.name}\n${p.description}`).keys()].join(", ");
  return out.filter((p) => p.name);
}

function parseSkillsSection(lines: string[]): string[] {
  const items: string[] = [];
  for (const raw of lines) {
    const body = stripBullet(raw).replace(/^[A-Za-z /&]{2,30}:\s*/, "");
    for (const part of body.split(/[,|•;]/)) {
      const s = part.trim().replace(/\.$/, "");
      if (s && s.length <= 40 && s.split(" ").length <= 4) items.push(s);
    }
  }
  return items;
}

/**
 * Best-effort profile from resume text, using rules only (instant, no network).
 * The user reviews and edits it; an optional AI pass can fill what's still empty.
 */
export function profileFromResume(text: string): CandidateProfile {
  const r = analyzeResume(text);
  const p: CandidateProfile = { ...EMPTY_PROFILE, answers: {} };

  const nameLine = r.lines.slice(0, 4).find((l) => /^[A-Za-z][A-Za-z.'-]*(\s+[A-Za-z][A-Za-z.'-]*){1,3}$/.test(l) && !/@|resume|curriculum/i.test(l));
  if (nameLine) {
    const parts = nameLine.split(/\s+/);
    p.firstName = parts[0];
    p.lastName = parts.slice(1).join(" ");
  }
  p.email = r.contact.email ?? "";
  p.phone = r.contact.phone ?? "";
  p.linkedin = withScheme(r.contact.linkedin);
  p.github = withScheme(r.contact.github);
  const site = text.match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:dev|me|io|vercel\.app|netlify\.app|github\.io)\b\/?\S*/i)?.[0];
  if (site && !/linkedin|github\.com/i.test(site)) p.portfolio = withScheme(site);

  p.education = parseEducation(r.sections.education ?? r.lines.filter((l) => DEGREE_TOKEN.test(l) || SCHOOL_RE.test(l)));
  p.experience = parseExperience(r.sections.experience ?? []);
  p.projects = parseProjects(r.sections.projects ?? []);
  p.summary = (r.sections.summary ?? []).map(stripBullet).join(" ").trim();
  p.publications = (r.sections.publications ?? []).filter((l) => l.length > 10).map((l) => {
    const t = stripBullet(l);
    return { ...EMPTY_PUBLICATION, title: t.replace(URL_RE, "").trim(), year: t.match(/\b(19|20)\d{2}\b/)?.[0] ?? "", link: withScheme(t.match(URL_RE)?.[0]) };
  });
  p.certifications = (r.sections.certifications ?? []).map(stripBullet).filter(Boolean);
  p.achievements = (r.sections.achievements ?? []).map(stripBullet).filter(Boolean);

  // Skills: recognised taxonomy skills first, then anything else listed in the Skills section
  const seen = new Set<string>();
  for (const s of [...r.skills.keys(), ...parseSkillsSection(r.sections.skills ?? [])]) {
    if (!seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); p.skills.push(s); }
  }

  const edu = p.education[0];
  if (edu && (edu.degree || edu.school)) {
    p.headline = [edu.degree && edu.major ? `${edu.degree} ${edu.major}` : edu.degree || edu.major, "student", edu.school ? `at ${edu.school}` : ""]
      .filter(Boolean).join(" ").replace(/^student/, "Student");
  }
  return p;
}

/* ------------------------------ Profile → text (AI context) ------------------------------ */

/** Plain-text dossier for AI prompts: only what the user has provided. */
export function profileToContext(p: CandidateProfile, resumeText = ""): string {
  const lines: string[] = [];
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  if (name) lines.push(`Name: ${name}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.city || p.country) lines.push(`Location: ${[p.city, p.country].filter(Boolean).join(", ")}`);
  const links = [p.linkedin && `LinkedIn ${p.linkedin}`, p.github && `GitHub ${p.github}`, p.portfolio && `Portfolio ${p.portfolio}`].filter(Boolean);
  if (links.length) lines.push(`Links: ${links.join(" · ")}`);
  if (p.summary) lines.push(`\nSUMMARY\n${p.summary}`);
  if (p.education.length) {
    lines.push("\nEDUCATION");
    for (const e of p.education) lines.push(`- ${[e.degree, e.major].filter(Boolean).join(" in ")}, ${e.school} ${[e.startYear, e.endYear].filter(Boolean).join("–")}${e.cgpa ? `, CGPA ${e.cgpa}${e.cgpaScale ? `/${e.cgpaScale}` : ""}` : ""}`);
  }
  if (p.experience.length) {
    lines.push("\nEXPERIENCE");
    for (const e of p.experience) lines.push(`- ${e.title}${e.company ? ` at ${e.company}` : ""} (${[e.start, e.end].filter(Boolean).join(" – ")})\n${e.description}`);
  }
  if (p.projects.length) {
    lines.push("\nPROJECTS");
    for (const pr of p.projects) lines.push(`- ${pr.name}${pr.link ? ` (${pr.link})` : ""}${pr.tech ? ` [${pr.tech}]` : ""}\n${pr.description}`);
  }
  if (p.skills.length) lines.push(`\nSKILLS: ${p.skills.join(", ")}`);
  if (p.publications.length) lines.push(`\nPUBLICATIONS\n${p.publications.map((x) => `- ${x.title}${x.venue ? `, ${x.venue}` : ""}${x.year ? ` (${x.year})` : ""}`).join("\n")}`);
  if (p.certifications.length) lines.push(`\nCERTIFICATIONS\n${p.certifications.map((c) => `- ${c}`).join("\n")}`);
  if (p.achievements.length) lines.push(`\nACHIEVEMENTS\n${p.achievements.map((c) => `- ${c}`).join("\n")}`);
  if (p.additionalInfo.trim()) lines.push(`\nADDITIONAL INFORMATION (from the candidate)\n${p.additionalInfo.trim()}`);
  const answered = Object.entries(p.answers).filter(([, a]) => a.trim());
  if (answered.length) lines.push(`\nTHE CANDIDATE'S OWN ANSWERS\n${answered.map(([id, a]) => `- [${id}] ${a}`).join("\n")}`);
  if (resumeText.trim()) lines.push(`\nRESUME TEXT\n${resumeText.slice(0, 8000)}`);
  return lines.join("\n");
}

/** Programming languages from the profile's skills (taxonomy category "language"). */
export function profileLanguages(p: CandidateProfile): string[] {
  return p.skills.filter((s) => skillCategory(s) === "language" || s === "SQL");
}

/** Months of experience across entries, when dates parse. */
export function profileExperienceMonths(p: CandidateProfile, now = new Date()): number | null {
  return estimateExperienceMonths(p.experience.map((e) => `${e.start} - ${e.end || "Present"}`), now);
}

/** Field list for the Basics editor. */
export const BASIC_FIELDS: { key: keyof Pick<CandidateProfile, "firstName" | "lastName" | "email" | "phone" | "city" | "country" | "linkedin" | "github" | "portfolio">; label: string; wide?: boolean; placeholder?: string }[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City", placeholder: "e.g. Bengaluru" },
  { key: "country", label: "Country", placeholder: "e.g. India" },
  { key: "linkedin", label: "LinkedIn URL", wide: true },
  { key: "github", label: "GitHub URL", wide: true },
  { key: "portfolio", label: "Portfolio / website / deployed app", wide: true },
];
