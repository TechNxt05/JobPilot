import { z } from "zod";
import type { JobPosting, JobRequirements } from "./job";
import { normalizeSkillList } from "./job";
import type { DegreeLevel } from "./resume";
import type { CandidateProfile } from "./profile";
import { completeParsed, looseArray, looseStrings, looseText, parseJSONLoose, ProviderError, type AIConfig, type CompleteOptions } from "./providers";

const nullableNumber = z.union([z.number(), z.string().transform((s) => (s.trim() === "" ? null : Number(s)))]).nullable().optional()
  .transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));

const AIOutputSchema = z.object({
  requirements: z.object({
    required_skills: z.array(z.string()).default([]),
    preferred_skills: z.array(z.string()).default([]),
    min_years_experience: nullableNumber,
    degree_levels: z.array(z.string()).default([]),
    min_cgpa: nullableNumber,
    cgpa_scale: nullableNumber,
    graduation_years: z.array(z.union([z.number(), z.string()])).default([]),
    deadline: z.string().nullable().optional(),
  }),
  summary: z.string().default(""),
  suggestions: z
    .array(
      z.object({
        resume_line: z.string(),
        suggestion: z.string(),
        addresses: z.string().optional().default(""),
      }),
    )
    .default([]),
});

export interface Suggestion {
  /** Verbatim line from the resume this suggestion improves */
  resumeLine: string;
  suggestion: string;
  /** Which job requirement it addresses */
  addresses: string;
}

export interface AIAnalysis {
  requirements: JobRequirements;
  summary: string;
  /** Only suggestions whose quoted resume line really exists in the resume */
  suggestions: Suggestion[];
  /** Suggestions dropped because they quoted text that isn't in the resume */
  droppedSuggestions: number;
}

const SYSTEM_PROMPT = `You are Internova, a careful career assistant. You analyse a job posting and a candidate's resume.

Rules:
- Extract requirements ONLY from the job posting. Do not invent requirements.
- Put a skill in "preferred_skills" only if the posting marks it as preferred / nice-to-have / bonus. Otherwise "required_skills".
- Skills are short canonical names ("Python", "React", "AWS", "System Design"), not sentences. Ignore soft skills.
- Ignore skills that only appear in the company description or benefits.
- degree_levels: any of "diploma", "bachelor", "master", "phd" that the posting accepts.
- Use null when the posting doesn't state something.
- Suggestions must be grounded in the resume. Never invent experience, skills, employers, metrics or achievements.
  Each suggestion quotes ONE existing resume line verbatim in "resume_line" and explains how to rewrite or emphasise it
  for this job, using only facts already present in the resume. If the candidate lacks a skill, say so plainly
  instead of suggesting they claim it. Give at most 5 suggestions.

Respond with JSON only, in exactly this shape:
{
  "requirements": {
    "required_skills": string[],
    "preferred_skills": string[],
    "min_years_experience": number | null,
    "degree_levels": string[],
    "min_cgpa": number | null,
    "cgpa_scale": number | null,
    "graduation_years": number[],
    "deadline": string | null
  },
  "summary": "2-3 sentence honest assessment of fit",
  "suggestions": [{ "resume_line": string, "suggestion": string, "addresses": string }]
}`;

const normalizeForMatch = (s: string) =>
  s.toLowerCase().replace(/^[\s•\-*▪●◦‣–·]+/, "").replace(/[^a-z0-9+#%$.]+/g, " ").trim();

/** Find the resume line a model quote refers to. Returns null when it isn't really in the resume. */
export function locateQuote(quote: string, resumeText: string): string | null {
  const q = normalizeForMatch(quote);
  if (q.length < 8) return null;
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Exact (normalised) containment either way: models sometimes quote a fragment, or join a wrapped line
  const hit = lines.find((l) => {
    const n = normalizeForMatch(l);
    return n.length >= 8 && (n.includes(q) || q.includes(n));
  });
  if (hit) return hit;
  // Quotes that span two wrapped PDF lines
  const joined = normalizeForMatch(lines.join(" "));
  return joined.includes(q) ? quote.trim() : null;
}

const DEGREE_VALUES: DegreeLevel[] = ["diploma", "bachelor", "master", "phd"];

export async function analyzeWithAI(
  ai: AIConfig,
  job: JobPosting,
  resumeText: string,
  opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {},
): Promise<AIAnalysis> {
  const user = [
    `JOB POSTING`,
    `Title: ${job.title ?? "unknown"}`,
    `Company: ${job.company ?? "unknown"}`,
    `Location: ${job.location ?? "unknown"}`,
    ``,
    job.text.slice(0, 12000),
    ``,
    `CANDIDATE RESUME`,
    resumeText.slice(0, 10000),
  ].join("\n");

  const { value: out } = await completeParsed(ai, { system: SYSTEM_PROMPT, user, ...opts }, (raw) => {
    const parsed = AIOutputSchema.safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });
  const r = out.requirements;

  const required = normalizeSkillList(r.required_skills);
  const requiredLower = new Set(required.map((s) => s.toLowerCase()));
  const preferred = normalizeSkillList(r.preferred_skills).filter((s) => !requiredLower.has(s.toLowerCase()));

  const scale = r.cgpa_scale && [4, 5, 10, 100].includes(r.cgpa_scale) ? r.cgpa_scale : r.min_cgpa && r.min_cgpa <= 4 ? 4 : 10;
  const suggestions: Suggestion[] = [];
  let dropped = 0;
  for (const s of out.suggestions.slice(0, 5)) {
    const line = locateQuote(s.resume_line, resumeText);
    if (line) suggestions.push({ resumeLine: line, suggestion: s.suggestion, addresses: s.addresses });
    else dropped++;
  }

  return {
    requirements: {
      requiredSkills: required,
      preferredSkills: preferred,
      minYearsExperience: r.min_years_experience !== null && r.min_years_experience >= 0 && r.min_years_experience < 30 ? r.min_years_experience : null,
      degreeLevels: r.degree_levels.map((d) => d.toLowerCase().trim()).filter((d): d is DegreeLevel => DEGREE_VALUES.includes(d as DegreeLevel)),
      minCgpa: r.min_cgpa && r.min_cgpa > 0 && r.min_cgpa <= scale ? { value: r.min_cgpa, scale } : null,
      graduationYears: r.graduation_years.map((y) => Number(y)).filter((y) => Number.isInteger(y) && y >= 2000 && y < 2100),
      deadline: r.deadline ?? null,
      origin: "ai",
    },
    summary: out.summary,
    suggestions,
    droppedSuggestions: dropped,
  };
}

const DRAFT_PROMPT = `You draft answers to job application questions for a candidate, from their profile.

Rules:
- Use ONLY facts in the CANDIDATE PROFILE (which includes their resume, additional information and their own answers),
  plus the job posting for facts about the company/role.
- Never invent experience, skills, tools, models, metrics, employers, dates, links or achievements. If the profile doesn't
  support an answer, write what it does support and add a short [bracketed note] for the candidate to fill in.
- Never answer eligibility, legal, visa, salary, availability, relocation or demographic questions; return "" for those.
- First person, specific, plain language, no clichés or flattery. Respect any word or character limit in the question;
  otherwise keep each answer under 150 words. Yes/no questions start with "Yes" or "No" when the profile makes it clear.

Return JSON only: { "answers": [ { "id": string, "answer": string } ] } with one entry per question id.`;

export interface DraftQuestion {
  id: string;
  question: string;
}

export interface DraftContext {
  /** profileToContext(profile, resumeText) */
  profile: string;
  job?: Pick<JobPosting, "title" | "company" | "text"> | null;
}

/** Draft answers for several open questions in one call. Returns id → answer (empty answers omitted). */
export async function draftAnswers(
  ai: AIConfig,
  questions: DraftQuestion[],
  ctx: DraftContext,
  opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {},
): Promise<Record<string, string>> {
  if (!questions.length) return {};
  const user = [
    `QUESTIONS`,
    ...questions.map((q) => `- id "${q.id}": ${q.question}`),
    ctx.job ? `\nJOB: ${ctx.job.title ?? ""} at ${ctx.job.company ?? ""}\n${ctx.job.text.slice(0, 5000)}` : `\n(No specific job: write answers that work for internship applications in general.)`,
    `\nCANDIDATE PROFILE\n${ctx.profile.slice(0, 14000)}`,
  ].join("\n");
  const { value: answers } = await completeParsed(ai, { system: DRAFT_PROMPT, user, ...opts }, (raw) => {
    const parsed = z.object({ answers: looseArray(z.object({ id: looseText(), answer: looseText() })) }).safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data.answers;
  });
  const ids = new Set(questions.map((q) => q.id));
  const out: Record<string, string> = {};
  for (const a of answers) if (ids.has(a.id) && a.answer.trim()) out[a.id] = a.answer.trim();
  return out;
}

/** Single-question convenience wrapper. */
export async function draftAnswer(
  ai: AIConfig,
  req: { question: string; context: string; job?: DraftContext["job"] },
  opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {},
): Promise<string> {
  const out = await draftAnswers(ai, [{ id: "q", question: req.question }], { profile: req.context, job: req.job }, opts);
  if (!out.q) throw new ProviderError("The model returned no answer for this question", null, "invalid_output");
  return out.q;
}

/* ------------------------------ AI resume → profile ------------------------------ */

const s = looseText();
const list = looseText(", ");
const ParsedResumeSchema = z.object({
  firstName: s, lastName: s, email: s, phone: s, city: s, country: s, linkedin: s, github: s, portfolio: s,
  headline: s, summary: s,
  education: looseArray(z.object({ school: s, degree: s, major: s, startYear: s, endYear: s, cgpa: s, cgpaScale: s })),
  experience: looseArray(z.object({ title: s, company: s, location: s, start: s, end: s, description: s })),
  projects: looseArray(z.object({ name: s, link: s, tech: list, description: s })),
  skills: looseStrings(/,/),
  publications: looseArray(z.object({ title: s, venue: s, year: s, link: s })),
  certifications: looseStrings(/\n/),
  achievements: looseStrings(/\n/),
});

const PARSE_PROMPT = `Extract a structured candidate profile from the resume text.

Rules:
- Copy facts exactly as written; do not infer, embellish or invent anything. Use "" or [] when something is absent.
- headline: a short factual line built only from the resume (e.g. "B.Tech CSE student at IIT Delhi"), or "".
- summary: the resume's own summary/objective if present, else "".
- experience.description / projects.description: the bullet points, one per line, verbatim.
- years as 4 digits; cgpa and cgpaScale as plain numbers ("8.6", "10").
- skills: short canonical names, no sentences.

Return JSON only with keys: firstName, lastName, email, phone, city, country, linkedin, github, portfolio, headline, summary,
education[{school, degree, major, startYear, endYear, cgpa, cgpaScale}], experience[{title, company, location, start, end, description}],
projects[{name, link, tech, description}], skills[], publications[{title, venue, year, link}], certifications[], achievements[].`;

export async function parseResumeWithAI(
  ai: AIConfig,
  resumeText: string,
  opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {},
): Promise<Partial<CandidateProfile>> {
  const { value: d } = await completeParsed(ai, { system: PARSE_PROMPT, user: resumeText.slice(0, 14000), ...opts }, (raw) => {
    const parsed = ParsedResumeSchema.safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });
  // Drop anything whose text isn't in the resume (cheap guard against invented employers/schools)
  const lower = resumeText.toLowerCase();
  const inResume = (v: string) => !v || lower.includes(v.toLowerCase().slice(0, 25));
  return {
    ...d,
    education: d.education.filter((e) => inResume(e.school) || inResume(e.degree)),
    experience: d.experience.filter((e) => inResume(e.company) || inResume(e.title)),
    projects: d.projects.filter((p) => inResume(p.name)),
    publications: d.publications.filter((p) => inResume(p.title)),
    skills: d.skills.map((x) => x.trim()).filter(Boolean),
  };
}
