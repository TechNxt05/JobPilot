import { z } from "zod";
import { computeAlignment, findEvidence } from "./alignment";
import { scoreATS } from "./ats";
import { extractRequirementsHeuristic, type JobPosting } from "./job";
import { escapeLatex, escapeUrl, latexPreamble, latexToText } from "./latex";
import { profileToContext, type CandidateProfile } from "./profile";
import { completeParsed, looseArray, looseStrings, looseText, parseJSONLoose, ProviderError, type AIConfig, type CompleteOptions } from "./providers";
import { analyzeResume } from "./resume";
import { canonicalSkill, findSkills, skillCategory, skillPatterns, type SkillCategory } from "./skills";

/* ------------------------------ Grounding checks ------------------------------ */

const NUM_RE = /(?:\$|₹|\brs\.?\s?)?\d+(?:[.,]\d+)*\s?(?:%|\+|x\b|k\b|m\b|cr\b|lpa\b)?/gi;
const normNum = (n: string) => n.toLowerCase().replace(/[\s$₹,+]|rs\.?/g, "").replace(/(k|m|cr|lpa|x)$/, "$1");

/** Numbers / metrics in `text` that never appear in `source` (invented metrics). */
export function ungroundedNumbers(text: string, source: string): string[] {
  const have = new Set((source.match(NUM_RE) ?? []).map(normNum));
  const bare = new Set([...have].map((n) => n.replace(/[^\d.]/g, "")));
  const out = new Set<string>();
  for (const m of text.match(NUM_RE) ?? []) {
    const n = normNum(m);
    if (!n.replace(/[^\d]/g, "")) continue;
    if (!have.has(n) && !bare.has(n.replace(/[^\d.]/g, ""))) out.add(m.trim());
  }
  return [...out];
}

/** Taxonomy skills mentioned in `text` that the candidate's `source` never mentions. */
export function ungroundedSkills(text: string, source: string): string[] {
  const src = findSkills(source);
  return [...findSkills(text).keys()].filter((s) => !src.has(s));
}

/** Bullet opening verbs used more than twice, and bullets repeated almost verbatim. */
export function repetitionReport(bullets: string[]): { verb: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of bullets) {
    const v = b.replace(/^[•\-*\s]+/, "").split(/\s+/)[0]?.toLowerCase().replace(/[^a-z-]/g, "");
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, c]) => c > 2).map(([verb, count]) => ({ verb, count })).sort((a, b) => b.count - a.count);
}

/* ------------------------------ Structured resume ------------------------------ */

export interface TailoredResume {
  name: string;
  headline: string;
  contact: { email: string; phone: string; location: string; linkedin: string; github: string; portfolio: string };
  summary: string;
  education: { school: string; degree: string; dates: string; details: string }[];
  experience: { title: string; company: string; location: string; dates: string; bullets: string[] }[];
  projects: { name: string; link: string; tech: string; bullets: string[] }[];
  skills: { category: string; items: string[] }[];
  extras: { heading: string; items: string[] }[];
}

export interface TailorReport {
  /** Bullets or items removed because they contained facts not in the profile */
  removed: { text: string; reason: string }[];
  /** Job skills the candidate doesn't show and didn't approve; not added to the resume */
  skillGaps: string[];
  /** Skills put into the Skills section for this job (approved by the candidate or already in the profile) */
  addedSkills: string[];
  /** Less relevant skills taken out of the Skills section to keep each row on one line */
  droppedSkills: string[];
  repeatedVerbs: { verb: string; count: number }[];
  atsBefore: number;
  atsAfter: number;
  alignmentBefore: number | null;
  alignmentAfter: number | null;
  words: number;
  notes: string[];
}

const s = looseText(" ");
const index = z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().int());
const TailorSchema = z.object({
  headline: s,
  summary: s,
  experience: looseArray(z.object({ source_index: index, bullets: looseStrings(/\n/) })),
  projects: looseArray(z.object({ source_index: index, bullets: looseStrings(/\n/) })),
  skills: looseArray(z.object({ category: s, items: looseStrings(/,/) })),
  extras: looseArray(z.object({ heading: s, items: looseStrings(/\n/) })),
  notes: looseStrings(/\n/),
});

const TAILOR_PROMPT = `You tailor a candidate's resume to one job, as an expert resume writer and ATS specialist.

Hard rules (violations are automatically removed):
- Use ONLY facts in the CANDIDATE PROFILE. Never invent employers, titles, dates, tools, skills, metrics or results.
- Numbers: only use numbers that already appear in the profile. If a bullet has no metric, describe scope/impact in words.
- Skills: list only skills present in the profile or in SKILLS TO ADD. Prefer the job's wording when the candidate
  genuinely has the skill (e.g. profile "ReactJS" and job "React" → "React"). Group them into at most 6 rows
  (e.g. Languages, AI / ML, Backend & Cloud, Frontend, Developer Tools), most job-relevant first in each row.
- One page: at most 3 bullets per role, 2 per project, 4 projects. Leave "summary" empty.
- Bullet length: a printed line holds about 125 characters. Each bullet either fits ONE line (90-125 characters) or
  fills TWO (210-245 characters). Never a second line with only a few words: tighten the wording instead.
- Order bullets and projects by relevance to the job. Keep every experience role (fewer bullets for less relevant ones);
  drop irrelevant projects rather than padding.
- Start every bullet with a strong, specific past-tense verb; don't reuse the same verb more than twice.
- No first person, no buzzword stuffing, no exaggeration ("revolutionized", "world-class").

Return JSON only:
{
  "headline": string,   // the job's title + 3-5 of the candidate's matching skills, e.g. "AI Engineer · Python, RAG, FastAPI"
  "summary": string,
  "experience": [{ "source_index": number (index in PROFILE EXPERIENCE), "bullets": string[] }],
  "projects":   [{ "source_index": number (index in PROFILE PROJECTS), "bullets": string[] }],
  "skills":     [{ "category": string, "items": string[] }],
  "extras":     [{ "heading": "Achievements" | "Publications" | "Certifications", "items": string[] }],
  "notes": string[]   // short honest notes for the candidate, e.g. gaps the job wants that the profile doesn't show
}`;

function indexedProfile(p: CandidateProfile): string {
  const exp = p.experience.map((e, i) => `[${i}] ${e.title} at ${e.company} (${e.start} – ${e.end})\n${e.description}`).join("\n");
  const prj = p.projects.map((x, i) => `[${i}] ${x.name}${x.tech ? ` [${x.tech}]` : ""}\n${x.description}`).join("\n");
  return `PROFILE EXPERIENCE\n${exp || "(none)"}\n\nPROFILE PROJECTS\n${prj || "(none)"}`;
}

const dates = (a: string, b: string) => [a, b].filter(Boolean).join(" – ");

/** Build the structured resume from AI output, taking every factual field from the profile itself. */
function assemble(
  p: CandidateProfile,
  out: z.infer<typeof TailorSchema>,
  source: string,
  jobText: string,
  approved: string[] = [],
  workText = source,
  jobTitle = "",
): { resume: TailoredResume; report: Pick<TailorReport, "removed" | "skillGaps" | "notes" | "addedSkills" | "droppedSkills"> } {
  const removed: TailorReport["removed"] = [];
  // Approved skills the candidate's experience/projects don't show: fine in Skills, never claimed in a bullet
  const workSkills = findSkills(workText);
  const listOnly = new Set(approved.map(canonicalSkill).filter((k) => !workSkills.has(k) && !workText.toLowerCase().includes(k.toLowerCase())));
  const keepBullet = (b: string) => {
    const nums = ungroundedNumbers(b, source);
    if (nums.length) { removed.push({ text: b, reason: `uses ${nums.join(", ")}, which isn't in your profile` }); return false; }
    const skills = [...ungroundedSkills(b, source), ...[...findSkills(b).keys()].filter((k) => listOnly.has(k))];
    if (skills.length) { removed.push({ text: b, reason: `claims ${skills.join(", ")}, which isn't in your profile` }); return false; }
    return b.trim().length > 0;
  };
  const clip = (b: string) => b.replace(/^[•\-*\s]+/, "").trim();

  // Every role stays (dropping one shrinks the experience a recruiter or ATS counts); the ones the model left out
  // keep their first two original bullets, and one-page trimming shortens bullets, never removes a role
  const rewritten = new Map(out.experience.filter((e) => p.experience[e.source_index]).map((e) => [e.source_index, e]));
  const experience = p.experience
    .map((src, i) => ({ src, e: rewritten.get(i) }))
    .filter(({ src }) => src.title.trim() || src.company.trim())
    .slice(0, 6)
    .map(({ src, e }) => {
      let bullets = e ? e.bullets.map(clip).filter(keepBullet).slice(0, 3) : [];
      if (!bullets.length) bullets = src.description.split("\n").map(clip).filter(Boolean).slice(0, e ? 3 : 2); // the original
      return { title: src.title, company: src.company, location: src.location, dates: dates(src.start, src.end), bullets };
    });
  const projects = out.projects
    .filter((x) => p.projects[x.source_index])
    .slice(0, 4)
    .map((x) => {
      const src = p.projects[x.source_index];
      let bullets = x.bullets.map(clip).filter(keepBullet).slice(0, 2);
      if (!bullets.length) bullets = src.description.split("\n").map(clip).filter(Boolean).slice(0, 2);
      return { name: src.name, link: src.link, tech: src.tech, bullets };
    });

  const sourceLower = `${source}\n${approved.join("\n")}`.toLowerCase();
  const sourceSkills = findSkills(`${source}\n${approved.join("\n")}`);
  const skills = out.skills
    .map((g) => ({
      category: g.category || "Skills",
      items: g.items.map((i) => i.trim()).filter((i) => {
        if (!i) return false;
        const known = [...findSkills(i).keys()];
        const ok = sourceLower.includes(i.toLowerCase()) || (known.length > 0 && known.every((k) => sourceSkills.has(k)));
        if (!ok) removed.push({ text: i, reason: "skill not in your profile" });
        return ok;
      }),
    }))
    .filter((g) => g.items.length)
    .slice(0, MAX_SKILL_ROWS);

  const extras = out.extras
    .map((x) => ({ heading: x.heading || "Achievements", items: x.items.map(clip).filter(keepBullet).slice(0, 4) }))
    .filter((x) => x.items.length);

  // The resume template has no summary section; the space goes to projects and skills
  const summary = "";

  const jobSkills = [...findSkills(jobText).keys()];
  const skillGaps = jobSkills.filter((k) => !sourceSkills.has(k));

  // Job skills the candidate genuinely has (anywhere in the profile: skills, project tech, bullets) must be on the page.
  // The model sometimes drops them, so add any it left out to the best-fitting skills group.
  const finalSkills = skills.length ? skills : [{ category: "Skills", items: p.skills.slice(0, 20) }];
  // Checked against the Skills section only: recruiters and ATS keyword filters look there first, and a tool that
  // appears only in a project's tech line is easy to miss.
  const onPage = findSkills(finalSkills.flatMap((g) => g.items).join("\n"));
  const onPageLower = new Set(finalSkills.flatMap((g) => g.items.map((i) => i.toLowerCase())));
  const added = jobSkills.filter((k) => sourceSkills.has(k) && !onPage.has(k));
  // Approved skills outside the taxonomy ("Computer Networks") are added as written
  for (const a of approved.map(canonicalSkill)) if (!added.includes(a) && !onPage.has(a) && !onPageLower.has(a.toLowerCase())) added.push(a);
  for (const k of added) insertSkill(finalSkills, k);
  const must = new Set([...jobSkills.filter((k) => sourceSkills.has(k)), ...approved.map(canonicalSkill)]);
  const { groups: fittedSkills, dropped } = fitSkillRows(finalSkills, must);
  const notes = [...out.notes];

  // Title line under the name: the job's own title (recruiters search the ATS by title) + job skills the work shows
  const shown = jobSkills.filter((k) => workSkills.has(k));
  const lineSkills = [...shown, ...jobSkills.filter((k) => must.has(k) && !shown.includes(k))];
  const aiHeadline = out.headline && !ungroundedSkills(out.headline, source).length && !ungroundedNumbers(out.headline, source).length ? out.headline : "";
  const headline = titleLine(jobTitle, lineSkills) || aiHeadline || p.headline;

  return {
    resume: {
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
      headline,
      contact: { email: p.email, phone: p.phone, location: [p.city, p.country].filter(Boolean).join(", "), linkedin: p.linkedin, github: p.github, portfolio: p.portfolio },
      summary,
      education: p.education.map((e) => ({
        school: e.school,
        degree: [e.degree, e.major].filter(Boolean).join(", "),
        dates: dates(e.startYear, e.endYear),
        details: e.cgpa ? `CGPA: ${e.cgpa}${e.cgpaScale ? `/${e.cgpaScale}` : ""}` : "",
      })),
      experience,
      projects,
      skills: fittedSkills,
      extras,
    },
    report: { removed, skillGaps, notes, addedSkills: added, droppedSkills: dropped },
  };
}

const CATEGORY_WORDS: [RegExp, SkillCategory[]][] = [
  [/language/i, ["language"]],
  [/front|web|\bui\b/i, ["frontend"]],
  [/back|server|\bapi/i, ["backend"]],
  [/test|\bqa\b|automation/i, ["testing"]],
  [/data|database|\bdb/i, ["database", "data"]],
  [/\b(ml|ai|llm|genai)\b|machine|deep|learning|intelligence/i, ["ml"]],
  [/cloud|devops|infra|deploy/i, ["cloud", "devops"]],
];

/** Put a canonical skill in the group that already holds skills of its kind, else a tools-like group, else a new one. */
function insertSkill(groups: { category: string; items: string[] }[], skill: string) {
  const cat = skillCategory(skill);
  const byItems = cat === "other" ? undefined : groups.find((g) => g.items.some((i) => skillCategory(i) === cat));
  const byName = groups.find((g) => CATEGORY_WORDS.some(([re, cats]) => re.test(g.category) && cats.includes(cat)));
  const target = byItems ?? byName ?? groups.find((g) => /tool|framework|librar|technolog|platform|other|^skills$/i.test(g.category));
  if (target) target.items.push(skill);
  else if (groups.length < MAX_SKILL_ROWS) groups.push({ category: "Tools", items: [skill] });
  else groups[groups.length - 1].items.push(skill);
}

/**
 * The job title as a resume headline: "Senior AI Engineer - Remote (m/f/d) #4521" → "Senior AI Engineer".
 * Location, work mode, requisition ids and gender tags are listing noise, not part of the title.
 */
export function cleanJobTitle(title: string): string {
  return title
    .replace(/\((?:m|f|w|d|x|all genders?)(?:\s*\/\s*(?:m|f|w|d|x))*\)/gi, "")
    .replace(/\s+[-–—|:]\s+.*$/, "")
    .replace(/\s*\((?:remote|hybrid|on-?site|contract|full[- ]time|part[- ]time)[^)]*\)/gi, "")
    .replace(/\s*(?:#|req\.?\s*(?:id)?\s*:?\s*|job\s*id\s*:?\s*)[A-Z0-9-]{3,}\b.*$/i, "")
    .replace(/[,;]\s*(?:remote|hybrid|on-?site)\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "AI Engineer · Python, RAG, FastAPI, Docker": one line, at most `max` characters. */
export function titleLine(jobTitle: string, skills: string[], max = 95): string {
  const title = cleanJobTitle(jobTitle);
  if (!title || title.length > 60) return "";
  const picked: string[] = [];
  for (const s of skills) {
    if (picked.length >= 5) break;
    if (`${title} · ${[...picked, s].join(", ")}`.length <= max) picked.push(s);
  }
  return picked.length ? `${title} · ${picked.join(", ")}` : title;
}

export const MAX_SKILL_ROWS = 6;
/** Characters that fit on one skills row of the resume template ("Category: a, b, c") */
export const SKILL_ROW_CHARS = 118;

const rowLength = (g: { category: string; items: string[] }) => g.category.length + 2 + g.items.join(", ").length;

/**
 * Keep every skills row on one line. When a row is too long (usually because job skills were just added), the
 * skills in it that this job doesn't ask for are dropped, last first. Skills in `keep` are never dropped.
 */
export function fitSkillRows(
  groups: { category: string; items: string[] }[],
  keep: Set<string>,
  maxChars = SKILL_ROW_CHARS,
): { groups: { category: string; items: string[] }[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept = (item: string) => keep.has(item) || keep.has(canonicalSkill(item)) || [...findSkills(item).keys()].some((k) => keep.has(k));
  const out = groups.map((g) => {
    // Dedupe ("React" and "React.js" in one row)
    const seen = new Set<string>();
    const items = g.items.filter((i) => {
      const k = canonicalSkill(i).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Job-relevant skills first, so ATS and recruiters see them
    const row = { category: g.category, items: [...items.filter(kept), ...items.filter((i) => !kept(i))] };
    while (rowLength(row) > maxChars) {
      const i = row.items.map((x, j) => [x, j] as const).reverse().find(([x]) => !kept(x))?.[1];
      if (i === undefined) break;
      dropped.push(...row.items.splice(i, 1));
    }
    return row;
  });
  return { groups: out.filter((g) => g.items.length), dropped };
}

/** Job skills the candidate's profile already shows (they must appear on the tailored resume). */
export function jobSkillsYouHave(jobText: string, source: string): string[] {
  const have = findSkills(source);
  return [...findSkills(jobText).keys()].filter((k) => have.has(k));
}

const mustInclude = (skills: string[]) =>
  skills.length
    ? `\nJOB SKILLS THE CANDIDATE HAS (the profile shows each one). Every one MUST appear in the resume: in Skills and, where true, in the bullet that used it:\n${skills.join(", ")}`
    : "";

const toAdd = (skills: string[] = []) =>
  skills.length
    ? `\nSKILLS TO ADD (the candidate confirmed they have these). Put every one in the Skills section, in the row it fits; if a row gets too long, drop the skills in it this job doesn't need. Mention one in a bullet only when that experience or project text already shows it:\n${skills.join(", ")}`
    : "";

/**
 * Skills the job asks for that a resume doesn't show. `inProfile` = the candidate's profile (skills list, projects,
 * experience) already has it, so it's safe to add; otherwise only the candidate can say whether they have it.
 */
export function missingJobSkills(
  jobText: string,
  resumeText: string,
  profile?: CandidateProfile | null,
  /** Skills the job analysis extracted (AI or rules), so this list matches the Analyze breakdown */
  jobSkills: string[] = [],
): { skill: string; inProfile: boolean }[] {
  const onResume = findSkills(resumeText);
  const resumeLower = resumeText.toLowerCase();
  return markInProfile(
    jobSkillList(jobText, jobSkills).filter((k) => !onResume.has(k) && !resumeLower.includes(k.toLowerCase())),
    profile,
  );
}

/** Tag each skill with whether the candidate's profile already shows it; profile skills first. */
export function markInProfile(skills: string[], profile?: CandidateProfile | null): { skill: string; inProfile: boolean }[] {
  const profText = profile ? profileToContext(profile) : "";
  const prof = profile ? findSkills(profText) : new Map();
  const listed = new Set((profile?.skills ?? []).map((x) => canonicalSkill(x).toLowerCase()));
  // Word-boundary match, so "Go" isn't found inside "Google"
  const inText = (skill: string) => !!profText && skillPatterns(skill).some((p) => p.test(profText));
  return dedupeSkills(skills)
    .map((skill) => ({ skill, inProfile: prof.has(skill) || listed.has(skill.toLowerCase()) || inText(skill) }))
    .sort((a, b) => Number(b.inProfile) - Number(a.inProfile));
}

/**
 * Every skill a job asks for, canonical names, no duplicates. The job analysis's list when there is one (so it matches
 * the Analyze breakdown); dictionary hits in the posting otherwise.
 */
export function jobSkillList(jobText: string, jobSkills: string[] = []): string[] {
  const fromAnalysis = dedupeSkills(jobSkills);
  return fromAnalysis.length ? fromAnalysis : dedupeSkills([...findSkills(jobText).keys()]);
}

function dedupeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skills) {
    const k = canonicalSkill(String(raw));
    if (!k || k.length > 60 || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

/** Add skills to a profile's Skills list (canonical names, no duplicates). Returns the same object when nothing changes. */
export function addSkillsToProfile(p: CandidateProfile, skills: string[]): CandidateProfile {
  const have = new Set(p.skills.map((x) => canonicalSkill(x).toLowerCase()));
  const fresh: string[] = [];
  for (const raw of skills) {
    const k = canonicalSkill(raw);
    if (k && !have.has(k.toLowerCase())) { have.add(k.toLowerCase()); fresh.push(k); }
  }
  return fresh.length ? { ...p, skills: [...p.skills, ...fresh] } : p;
}

/** Plain text of a structured resume (for scoring and word counts). */
export function resumeText(r: TailoredResume): string {
  return [
    r.name, r.headline, [r.contact.email, r.contact.phone, r.contact.location, r.contact.linkedin, r.contact.github].filter(Boolean).join(" | "),
    r.summary ? `SUMMARY\n${r.summary}` : "",
    `EDUCATION\n${r.education.map((e) => `${e.school}\n${e.degree} ${e.dates}\n${e.details}`).join("\n")}`,
    r.experience.length ? `EXPERIENCE\n${r.experience.map((e) => `${e.title}, ${e.company} ${e.dates}\n${e.bullets.map((b) => `• ${b}`).join("\n")}`).join("\n")}` : "",
    r.projects.length ? `PROJECTS\n${r.projects.map((x) => `${x.name} ${x.tech}\n${x.bullets.map((b) => `• ${b}`).join("\n")}`).join("\n")}` : "",
    `SKILLS\n${r.skills.map((g) => `${g.category}: ${g.items.join(", ")}`).join("\n")}`,
    ...r.extras.map((x) => `${x.heading.toUpperCase()}\n${x.items.map((i) => `• ${i}`).join("\n")}`),
  ].filter(Boolean).join("\n");
}

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;
/** ~ what fits one A4 page in the resume template (the reference resume fills it at ~640 words) */
export const ONE_PAGE_WORDS = 620;

/**
 * Characters a bullet line holds in the resume template (A4, 0.48in margins, Source Sans Pro 10pt). Measured: a bullet
 * wraps at about 130 characters; 125 leaves room for wide letters and digits.
 */
export const BULLET_LINE_CHARS = 125;

/** Printed lines a bullet takes. */
export const bulletLines = (b: string) => Math.max(1, Math.ceil(b.trim().length / BULLET_LINE_CHARS));

/** Same meaning, fewer characters. Applied in order, only as far as needed. */
const TIGHTEN: [RegExp, string][] = [
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bfor the purpose of\b/gi, "for"],
  [/\bwith the help of\b/gi, "with"],
  [/\bas well as\b/gi, "and"],
  [/\ba number of\b/gi, "several"],
  [/\bon a (daily|weekly|monthly) basis\b/gi, "$1"],
  [/\bsuccessfully\s+/gi, ""],
  [/\b(effectively|efficiently|seamlessly)\s+/gi, ""],
  [/\b(a\s+)?(wide\s+)?variety of\s+/gi, ""],
  [/\bvarious\s+/gi, ""],
  [/\butili[sz](e|es|ed|ing)\b/gi, "us$1"],
  [/\bleverag(e|es|ed|ing)\b/gi, "us$1"],
  [/\bapproximately\s+/gi, "~"],
  [/(\d)\s*percent\b/gi, "$1%"],
  [/\b(that|which) (is|are|was|were) (used|built|designed|developed) (to|for)\b/gi, "$3 $4"],
];

/**
 * A bullet whose last line holds only a few words, rewritten to take one line fewer using the safe swaps above, or null
 * when that isn't possible (the bullet is then left as it is).
 */
export function tightenBullet(b: string): string | null {
  const lines = bulletLines(b);
  if (lines < 2) return null;
  const spill = b.trim().length - (lines - 1) * BULLET_LINE_CHARS;
  if (spill > BULLET_LINE_CHARS * 0.35) return null; // a real second line, not a few stray words
  let t = b.trim();
  for (const [re, to] of TIGHTEN) {
    t = t.replace(re, to).replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
    if (bulletLines(t) < lines) return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return null;
}

/** Tighten every bullet that spills a few words onto an extra line. Null when none could be tightened. */
function tightenAll(c: TailoredResume): TailoredResume | null {
  let changed = false;
  for (const list of [...c.experience.map((e) => e.bullets), ...c.projects.map((x) => x.bullets)]) {
    list.forEach((b, i) => {
      const t = tightenBullet(b);
      if (t) { list[i] = t; changed = true; }
    });
  }
  return changed ? c : null;
}

/**
 * How much each bullet / project matters for the job: the job skills it shows in use. A skill no other bullet shows
 * counts triple, so the only proof of a job skill is the last thing to go.
 */
function relevance(r: TailoredResume, jobSkills: string[]) {
  const patterns = jobSkills.map((s) => skillPatterns(s));
  const hits = (text: string) => patterns.map((ps, i) => (ps.some((p) => p.test(text)) ? i : -1)).filter((i) => i >= 0);
  const texts = [...r.experience.flatMap((e) => e.bullets), ...r.projects.flatMap((x) => [x.tech, ...x.bullets])];
  const shownIn = new Map<number, number>();
  for (const t of texts) for (const i of hits(t)) shownIn.set(i, (shownIn.get(i) ?? 0) + 1);
  // A measured result (a number) is worth keeping too: ATS and recruiters weigh quantified bullets
  const value = (text: string) => hits(text).reduce((sum, i) => sum + (shownIn.get(i) === 1 ? 3 : 1), 0) + (/\d/.test(text) ? 0.5 : 0);
  return {
    /** Index of the bullet to drop: the least relevant, the later one on a tie */
    bullet: (bullets: string[]) => bullets.reduce((best, b, i) => (value(b) <= value(bullets[best]) ? i : best), 0),
    /** Index of the project to drop: the least relevant, the later one on a tie */
    project: (projects: TailoredResume["projects"]) => {
      const score = (x: TailoredResume["projects"][number]) => value(x.tech) + x.bullets.reduce((s, b) => s + value(b), 0);
      return projects.reduce((best, x, i) => (score(x) <= score(projects[best]) ? i : best), 0);
    },
  };
}

/**
 * Remove the least important content (one step) until the resume fits. With the job's skills, the bullets and projects
 * that show them are kept and the least job-relevant ones go first. Returns null when nothing more can go.
 */
export function shrinkResume(r: TailoredResume, jobSkills: string[] = []): TailoredResume | null {
  const c: TailoredResume = JSON.parse(JSON.stringify(r));
  // First win space without losing anything: bullets with a few stray words on their last line lose that line
  const tighter = tightenAll(c);
  if (tighter) return tighter;
  const rel = relevance(c, jobSkills);
  const dropBullet = (bullets: string[]) => bullets.splice(rel.bullet(bullets), 1);
  const dropProject = () => c.projects.splice(rel.project(c.projects), 1);
  const longest = <T extends { bullets: string[] }>(xs: T[], min: number) =>
    xs.map((x, i) => [i, x.bullets.length] as const).filter(([, n]) => n > min).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  if (c.extras.some((x) => x.items.length > 3)) { const x = c.extras.find((e) => e.items.length > 3)!; x.items.pop(); return c; }
  if (c.projects.length > 4) { dropProject(); return c; }
  let i = longest(c.projects, 2);
  if (i !== undefined) { dropBullet(c.projects[i].bullets); return c; }
  if (c.projects.length > 3) { dropProject(); return c; }
  if (c.extras.some((x) => x.items.length > 2)) { const x = c.extras.find((e) => e.items.length > 2)!; x.items.pop(); return c; }
  i = longest(c.experience, 3);
  if (i !== undefined) { dropBullet(c.experience[i].bullets); return c; }
  if (c.projects.length > 2) { dropProject(); return c; }
  i = longest(c.projects, 2);
  if (i !== undefined) { dropBullet(c.projects[i].bullets); return c; }
  i = longest(c.experience, 3);
  if (i !== undefined) { dropBullet(c.experience[i].bullets); return c; }
  if (c.extras.length) { c.extras.pop(); return c; }
  if (c.summary) { c.summary = ""; return c; }
  i = longest(c.projects, 1);
  if (i !== undefined) { dropBullet(c.projects[i].bullets); return c; }
  i = longest(c.experience, 2);
  if (i !== undefined) { dropBullet(c.experience[i].bullets); return c; }
  if (c.projects.length > 1) { dropProject(); return c; }
  return null;
}

export function fitToWords(r: TailoredResume, budget = ONE_PAGE_WORDS, jobSkills: string[] = []): TailoredResume {
  let cur = r;
  while (wordCount(resumeText(cur)) > budget) {
    const next = shrinkResume(cur, jobSkills);
    if (!next) break;
    cur = next;
  }
  return cur;
}

/**
 * Put back proof the rewrite lost: for each job skill the original resume showed in use (an experience / project bullet)
 * but the tailored one doesn't, add that original bullet, word for word, to the same role or project. Original
 * bullets are the candidate's own words, so nothing new is claimed.
 */
export function restoreEvidence(r: TailoredResume, originalText: string, jobSkills: string[]): { resume: TailoredResume; restored: string[] } {
  if (!originalText.trim() || !jobSkills.length) return { resume: r, restored: [] };
  const before = analyzeResume(originalText);
  const c: TailoredResume = JSON.parse(JSON.stringify(r));
  const restored: string[] = [];
  const clean = (l: string) => l.replace(/^([•\-*▪●◦‣–·]|\d+[.)])\s+/, "").trim();
  for (const skill of jobSkills) {
    const was = findEvidence(skill, before);
    if (was?.strength !== "demonstrated") continue;
    const now = findEvidence(skill, analyzeResume(resumeText(c)));
    if (now?.strength === "demonstrated") continue;
    // The role / project the original bullet sat under: the first non-bullet line above it
    const at = before.lines.indexOf(was.line);
    let h = at - 1;
    while (h >= 0 && /^([•\-*▪●◦‣–·]|\d+[.)])\s+/.test(before.lines[h])) h--;
    const heading = h >= 0 ? before.lines[h].toLowerCase() : "";
    const named = (name: string) => !!name.trim() && heading.includes(name.trim().toLowerCase());
    const target =
      c.experience.find((e) => named(e.company) || named(e.title))?.bullets ??
      c.projects.find((x) => named(projectName(x.name)))?.bullets;
    const bullet = clean(was.line);
    if (!target || target.some((b) => b.trim() === bullet)) continue;
    target.push(bullet);
    restored.push(skill);
  }
  return { resume: c, restored };
}

const projectName = (name: string) => name.split(/\s[-–—|:]\s|\s\(/)[0];

export function buildReport(
  beforeText: string,
  afterText: string,
  job: Pick<JobPosting, "text">,
  extra: Pick<TailorReport, "removed" | "skillGaps" | "notes"> & Partial<Pick<TailorReport, "addedSkills" | "droppedSkills">>,
  bullets: string[],
): TailorReport {
  const req = extractRequirementsHeuristic({ title: null, company: null, location: null, url: null, text: job.text, source: "user" });
  const before = analyzeResume(beforeText);
  const after = analyzeResume(afterText);
  return {
    addedSkills: [],
    droppedSkills: [],
    ...extra,
    repeatedVerbs: repetitionReport(bullets),
    atsBefore: scoreATS(before).score,
    atsAfter: scoreATS(after).score,
    alignmentBefore: computeAlignment(req, before).overall,
    alignmentAfter: computeAlignment(req, after).overall,
    words: wordCount(afterText),
  };
}

export interface TailorInput {
  profile: CandidateProfile;
  /** Original resume text (for the "before" scores and as grounding source) */
  resumeText: string;
  job: Pick<JobPosting, "title" | "company" | "text">;
  /** ATS-specific instructions (see atsTailorHints) */
  atsHints?: string[];
  /** Skills the candidate approved for this resume (see missingJobSkills); added to the Skills section */
  addSkills?: string[];
  /** The job's skills as the job analysis read them (required + preferred); kept in use when trimming */
  jobSkills?: string[];
}

const cleanSkills = (xs?: string[]) => [...new Set((xs ?? []).map((x) => String(x).trim()).filter((x) => x && x.length <= 60))].slice(0, 40);

const atsNotes = (hints?: string[]) =>
  hints?.length ? `\nATS NOTES (follow these within the hard rules; never add facts)\n${hints.map((h) => `- ${h}`).join("\n")}` : "";

/** Profile → job-tailored structured resume (no LaTeX given). */
export async function tailorResume(ai: AIConfig, input: TailorInput, opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {}): Promise<{ resume: TailoredResume; report: TailorReport }> {
  const source = `${profileToContext(input.profile)}\n${input.resumeText}`;
  const approved = cleanSkills(input.addSkills);
  const user = [
    `JOB: ${input.job.title ?? ""} at ${input.job.company ?? ""}\n${input.job.text.slice(0, 7000)}`,
    atsNotes(input.atsHints),
    mustInclude(jobSkillsYouHave(input.job.text, source)),
    toAdd(approved),
    `\n${indexedProfile(input.profile)}`,
    `\nCANDIDATE PROFILE\n${profileToContext(input.profile, input.resumeText).slice(0, 12000)}`,
  ].join("\n");
  const { value } = await completeParsed(ai, { system: TAILOR_PROMPT, user, ...opts }, (raw) => {
    const parsed = TailorSchema.safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });
  // What the candidate's work shows (not the bare Skills list): approved skills outside it stay out of bullets
  const workText = [
    input.resumeText,
    ...input.profile.experience.map((e) => e.description),
    ...input.profile.projects.flatMap((x) => [x.tech, x.description]),
  ].join("\n");
  const { resume, report } = assemble(input.profile, value, source, input.job.text, approved, workText, input.job.title ?? "");
  // The job's skills (the analysis's list when given): their proof is restored if the rewrite lost it, and kept when
  // trimming to one page, so tailoring never lowers the job match
  const jobSkills = jobSkillList(input.job.text, [...cleanSkills(input.jobSkills), ...approved]);
  const kept = restoreEvidence(resume, input.resumeText, jobSkills).resume;
  const fitted = fitToWords(kept, ONE_PAGE_WORDS, jobSkills);
  const bullets = [...fitted.experience.flatMap((e) => e.bullets), ...fitted.projects.flatMap((x) => x.bullets)];
  return { resume: fitted, report: buildReport(input.resumeText || source, resumeText(fitted), input.job, report, bullets) };
}

/* ------------------------------ LaTeX rendering ------------------------------ */

/**
 * The resume template: Source Sans, one column, text links (icon fonts turn into junk in ATS parsers),
 * company/date rows as tables, skills as unbulleted rows. Fits one A4 page at about 640 words.
 */
const RESUME_PREAMBLE = String.raw`\documentclass[a4paper,10.5pt]{article}
\usepackage{geometry}
\geometry{top=0.42in, bottom=0.42in, left=0.48in, right=0.48in}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\hypersetup{breaklinks=true}
\usepackage[T1]{fontenc}
\usepackage{sourcesanspro}
\usepackage{microtype}
\usepackage{tabularx}
\usepackage{color}
\usepackage{fancyhdr}

% ATS: real space characters and Unicode mappings in the PDF (pdfLaTeX; ignored by other engines)
\ifdefined\pdfgentounicode \input{glyphtounicode}\pdfgentounicode=1 \fi
\ifdefined\pdfinterwordspaceon \pdfinterwordspaceon \fi

\renewcommand{\familydefault}{\sfdefault}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\baselinestretch}{0.97}
\setlength{\tabcolsep}{0pt}
\raggedbottom
\raggedright

\setlist[itemize]{topsep=2pt, partopsep=0pt, parsep=0pt, itemsep=2pt, leftmargin=12pt}

\titleformat{\section}{\scshape\normalsize\bfseries}{}{0em}{}[\titlerule]
\titlespacing*{\section}{0pt}{5pt}{3pt}

\newcommand{\expentry}[2]{
  \begin{tabular*}{\textwidth}{l@{\extracolsep{\fill}}r}
    \textbf{#1} & \small\textit{#2}
  \end{tabular*}
}

\newcommand{\projentry}[3]{
  \begin{tabular*}{\textwidth}{l@{\extracolsep{\fill}}r}
    \textbf{#1} \hspace{2pt} \textit{\small #2} & \small\textit{#3}
  \end{tabular*}
}

\newcommand{\eduentry}[3]{
  \begin{tabular*}{\textwidth}{l@{\extracolsep{\fill}}r}
    \textbf{#1} & \small\textit{#2} \\[-1pt]
    \small\textit{#3} &
  \end{tabular*}
}
`;

/** One-page, ATS-friendly LaTeX resume in the JobPilot template (text-selectable, Unicode-mapped, no graphics). */
export function renderResumeLatex(r: TailoredResume): string {
  const e = escapeLatex;
  const href = (url: string, label: string) => `\\href{${escapeUrl(url)}}{${e(label)}}`;
  const items = (xs: string[]) => (xs.length ? `\\vspace{-8pt}\n\\begin{itemize}\n${xs.map((b) => `  \\item ${e(b)}`).join("\n")}\n\\end{itemize}\n` : "");
  const contact = [
    r.contact.email ? href(`mailto:${r.contact.email}`, r.contact.email) : "",
    r.contact.linkedin ? href(r.contact.linkedin, "LinkedIn") : "",
    r.contact.github ? href(r.contact.github, "GitHub") : "",
    r.contact.portfolio ? href(r.contact.portfolio, "Portfolio") : "",
    e(r.contact.phone),
  ].filter(Boolean).join(" $\\,|\\,$\n  ");

  const sec: string[] = [];
  if (r.summary) sec.push(`\\section{Summary}\n${e(r.summary)}`);
  if (r.experience.length) {
    sec.push(`%--- EXPERIENCE ---\n\\section{Experience}\n\n${r.experience.map((x) => {
      const where = /remote/i.test(x.location) ? " (Remote)" : "";
      const head = [x.company, `${x.title}${where}`].filter((s) => s.trim()).map(e).join(" --- ");
      return `\\expentry{${head}}{${e(x.dates)}}\n${items(x.bullets)}\\vspace{2pt}\n`;
    }).join("\n")}`);
  }
  if (r.projects.length) {
    sec.push(`%--- PROJECTS ---\n\\section{Projects}\n\n${r.projects.map((x) => {
      const link = x.link ? ` {\\normalfont\\small${href(x.link, /github\.com|gitlab\.com|bitbucket\.org/i.test(x.link) ? "Code" : "Live")}}` : "";
      return `\\projentry{${e(x.name)}${link}}{${e(x.tech)}}{}\n${items(x.bullets)}\\vspace{2pt}\n`;
    }).join("\n")}`);
  }
  for (const x of r.extras) {
    const heading = /publication/i.test(x.heading) ? "Research Publications" : x.heading;
    sec.push(`\\section{${e(heading)}}\n\\begin{itemize}\n${x.items.map((i) => `  \\item ${e(i)}`).join("\n")}\n\\end{itemize}\n\\vspace{2pt}`);
  }
  if (r.education.length) {
    sec.push(`%--- EDUCATION ---\n\\section{Education}\n\n${r.education.map((x) => {
      const line = [x.degree, x.details].filter(Boolean).map(e).join(" \\hspace{8pt} ");
      return line ? `\\eduentry{${e(x.school)}}{${e(x.dates)}}{${line}}` : `\\expentry{${e(x.school)}}{${e(x.dates)}}`;
    }).join("\n\\vspace{2pt}\n")}\n\\vspace{2pt}`);
  }
  if (r.skills.length) {
    sec.push(`%--- SKILLS ---\n\\section{Technical Skills}\n\\vspace{3pt}\n\\begin{itemize}[leftmargin=0pt, label={}, itemsep=2pt]\n${r.skills
      .map((g) => `  \\item \\textbf{${e(g.category)}:} \\hspace{1pt} ${e(g.items.join(", "))}`).join("\n")}\n\\end{itemize}`);
  }

  return `${RESUME_PREAMBLE}
\\begin{document}

%--- HEADER ---
\\begin{tabular*}{\\textwidth}{l@{\\extracolsep{\\fill}}r}
  {\\Large\\bfseries ${e(r.name)}} & ${e(r.contact.location)} \\\\[2pt]
${r.headline ? `  {\\normalsize ${e(r.headline).replace(/\s*·\s*/g, " $\\,\\cdot\\,$ ")}} & \\\\[1pt]\n` : ""}  \\small
  ${contact} &
\\end{tabular*}

\\vspace{2pt}

${sec.join("\n\n")}

\\end{document}
`;
}

/* ------------------------------ Tailor the user's own LaTeX ------------------------------ */

const LATEX_PROMPT = `You tailor a candidate's LaTeX resume (Overleaf code) to one job.

Hard rules:
- Return the COMPLETE LaTeX document. Keep the preamble, custom macros, layout and section structure exactly as they are;
  edit only the text content inside the document body.
- Use ONLY facts in the resume and CANDIDATE PROFILE. Never invent employers, titles, dates, tools, skills or results.
  Only use numbers that already appear in them.
- Must fit on ONE page: tighten wording, merge or drop the least relevant bullets/projects instead of adding.
- SKILLS TO ADD (if given) go into the Skills section; keep each skills row on one line by removing the skills in that
  row this job needs least. Don't claim them in bullets unless the resume already shows that work.
- Mirror the job's keywords only where the candidate genuinely has that skill. Strong, varied action verbs; no first person;
  no exaggeration; avoid repeating the same verb or phrase.
- Keep it valid LaTeX: escape & % $ # _ in text, balance braces, don't add packages.

Return JSON only: { "latex": string, "changes": string[] } (changes = short list of what you changed and why).`;

export interface LatexTailorResult {
  latex: string;
  changes: string[];
  report: TailorReport;
  /** Numbers / skills the model introduced that aren't in the original resume or profile (shown as warnings) */
  warnings: string[];
}

export async function tailorLatex(
  ai: AIConfig,
  input: TailorInput & { latex: string; shorten?: boolean },
  opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {},
): Promise<LatexTailorResult> {
  const originalText = latexToText(input.latex);
  const approved = cleanSkills(input.addSkills);
  const source = `${originalText}\n${profileToContext(input.profile)}\n${approved.join("\n")}`;
  const user = [
    input.shorten ? "The previous version compiled to MORE THAN ONE PAGE. Shorten it to fit one page.\n" : "",
    `JOB: ${input.job.title ?? ""} at ${input.job.company ?? ""}\n${input.job.text.slice(0, 6000)}`,
    atsNotes(input.atsHints),
    mustInclude(jobSkillsYouHave(input.job.text, source)),
    toAdd(approved),
    `\nCANDIDATE PROFILE\n${profileToContext(input.profile).slice(0, 6000)}`,
    `\nLATEX RESUME\n${input.latex.slice(0, 20000)}`,
  ].join("\n");
  const { value } = await completeParsed(ai, { system: LATEX_PROMPT, user, ...opts }, (raw) => {
    const parsed = z.object({ latex: z.string().min(50), changes: looseStrings(/\n/) }).safeParse(parseJSONLoose(raw));
    if (!parsed.success || !parsed.data.latex.includes("\\begin{document}")) {
      throw new ProviderError("The model didn't return a complete LaTeX document", null, "invalid_output");
    }
    return parsed.data;
  });

  // Never let the model change the preamble (packages, macros, layout)
  let latex = value.latex;
  const pre = latexPreamble(input.latex);
  if (pre && latexPreamble(latex) !== pre) latex = pre + latex.slice(latex.indexOf("\\begin{document}"));

  const newText = latexToText(latex);
  const warnings = [
    ...ungroundedNumbers(newText, source).map((n) => `New number “${n}” isn't in your resume or profile. Check or remove it.`),
    ...ungroundedSkills(newText, source).map((k) => `Mentions ${k}, which isn't in your resume or profile. Check or remove it.`),
  ];
  const bullets = newText.split("\n").filter((l) => l.startsWith("•")).map((l) => l.slice(1).trim());
  const jobSkills = [...findSkills(input.job.text).keys()];
  const srcSkills = findSkills(source);
  const inNew = findSkills(newText);
  const newLower = newText.toLowerCase();
  const left = [...new Set([...jobSkills.filter((k) => srcSkills.has(k)), ...approved.map(canonicalSkill)])].filter((k) => !inNew.has(k) && !newLower.includes(k.toLowerCase()));
  if (left.length) {
    const them = left.length > 1 ? "them" : "it";
    warnings.push(`The job asks for ${left.join(", ")} and your profile shows ${them}, but the tailored resume doesn't mention ${them}. Add ${them} to your Skills section.`);
  }
  return {
    latex,
    changes: value.changes,
    warnings,
    report: buildReport(originalText, newText, input.job, {
      removed: [],
      skillGaps: jobSkills.filter((k) => !srcSkills.has(k)),
      notes: [],
      addedSkills: [...inNew.keys()].filter((k) => !findSkills(originalText).has(k)),
    }, bullets),
  };
}

/**
 * Compile a structured resume, trimming the least important content until the PDF is one page.
 * `compile` is injected (public LaTeX service from the web server or the extension).
 */
export async function compileOnePage(
  resume: TailoredResume,
  compile: (latex: string) => Promise<Uint8Array>,
  countPages: (pdf: Uint8Array) => Promise<number>,
  maxPasses = 6,
  /** The job's skills: bullets and projects showing them are the last to be trimmed */
  jobSkills: string[] = [],
): Promise<{ resume: TailoredResume; latex: string; pdf: Uint8Array; pages: number }> {
  let current = fitToWords(resume, ONE_PAGE_WORDS, jobSkills);
  let latex = renderResumeLatex(current);
  let pdf = await compile(latex);
  let pages = await countPages(pdf);
  for (let i = 0; pages > 1 && i < maxPasses; i++) {
    // Two trims per pass (each compile is slow), but keep the first one even if the second has nothing left to cut
    const once = shrinkResume(current, jobSkills);
    if (!once) break;
    const next = shrinkResume(once, jobSkills) ?? once;
    current = next;
    latex = renderResumeLatex(current);
    pdf = await compile(latex);
    pages = await countPages(pdf);
  }
  return { resume: current, latex, pdf, pages };
}
