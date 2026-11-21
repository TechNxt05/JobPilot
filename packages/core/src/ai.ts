import { z } from "zod";
import type { JobPosting, JobRequirements } from "./job";
import { normalizeSkillList } from "./job";
import type { DegreeLevel } from "./resume";
import { EMPTY_PROFILE, mergeProfile, type CandidateProfile } from "./profile";
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
- Never invent experience, skills, tools, models, metrics, employers, dates, links or achievements.
- Write exactly what the candidate would type into the form, in their own natural voice. Never talk about the profile
  or resume ("my profile doesn't mention…", "not specified"), and never add [brackets], placeholders, notes or
  instructions for the candidate. If the profile answers only part of a question, answer that part naturally and leave
  the rest out; if it can't answer the question at all, return "".
- Never answer eligibility, legal, visa, salary, availability, relocation or demographic questions; return "" for those.
- First person, specific, plain language, no clichés or flattery. Respect any word or character limit in the question;
  otherwise keep each answer under 150 words. Yes/no questions start with "Yes" or "No" when the profile makes it clear.
- Questions are often worded differently from the usual ones ("Walk us through…", "Years of hands-on Python",
  "Tools you'd reach for to test a web app"). Work out what is really being asked and answer from the whole profile:
  projects, their tech, experience bullets, education, additional information and the candidate's earlier answers.
- When the question is close to one of the CANDIDATE'S EARLIER ANSWERS, reuse that answer, adapted to the new wording.
- OPTIONS given: answer with exactly one option text, copied verbatim, that the profile supports; "" if it doesn't say.
- PICK ALL THAT APPLY: answer with every option the profile supports, each copied verbatim, one per line; "" if none.
- SHORT field: a short value only (a number, a few words or a comma-separated list), no sentences.
- Counting questions ("years of experience with X"): count from the dates in the profile; if they don't say, return "".

Return JSON only: { "answers": [ { "id": string, "answer": string } ] } with one entry per question id.`;

export interface DraftQuestion {
  id: string;
  question: string;
  /** Choices for a select / radio question: the answer must be one of them */
  options?: string[];
  /** "short" for one-line inputs (a value, not a paragraph) */
  kind?: "short" | "long";
  /** Checkbox group: several options may apply */
  multi?: boolean;
}

export interface DraftContext {
  /** profileToContext(profile, resumeText) */
  profile: string;
  job?: Pick<JobPosting, "title" | "company" | "text"> | null;
  /** The candidate's earlier answers (answer library), reused for similar questions */
  answers?: { question: string; answer: string }[];
}

const questionLine = (q: DraftQuestion) => {
  const opts = q.options?.filter((o) => o.trim() && !/^(select|choose|please|--)/i.test(o.trim())).slice(0, 40);
  return `- id "${q.id}"${q.kind === "short" ? " (SHORT field)" : ""}: ${q.question}${opts?.length ? `\n  ${q.multi ? "PICK ALL THAT APPLY from" : "OPTIONS"}: ${opts.map((o) => JSON.stringify(o)).join(" | ")}` : ""}`;
};

const strArr = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").slice(0, n).map((x) => x.slice(0, max));

/** Validate draft questions sent by a client (hosted AI). */
export function cleanDraftQuestions(raw: unknown): DraftQuestion[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((q): q is Record<string, unknown> => !!q && typeof q === "object" && typeof q.id === "string" && typeof q.question === "string")
    .slice(0, 40)
    .map((q) => ({
      id: String(q.id).slice(0, 100),
      question: String(q.question).slice(0, 1000),
      ...(Array.isArray(q.options) ? { options: strArr(q.options, 60, 200) } : {}),
      ...(q.kind === "short" || q.kind === "long" ? { kind: q.kind } : {}),
      ...(q.multi === true ? { multi: true } : {}),
    }));
}

/** Validate earlier answers sent by a client (hosted AI). */
export function cleanDraftAnswers(raw: unknown): { question: string; answer: string }[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof a.question === "string" && typeof a.answer === "string")
    .slice(0, 25)
    .map((a) => ({ question: String(a.question).slice(0, 300), answer: String(a.answer).slice(0, 1500) }));
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
    ...questions.map(questionLine),
    ctx.job ? `\nJOB: ${ctx.job.title ?? ""} at ${ctx.job.company ?? ""}\n${ctx.job.text.slice(0, 5000)}` : `\n(No specific job: write answers that work for internship applications in general.)`,
    `\nCANDIDATE PROFILE\n${ctx.profile.slice(0, 14000)}`,
    ctx.answers?.length
      ? `\nCANDIDATE'S EARLIER ANSWERS\n${ctx.answers.slice(0, 25).map((a) => `Q: ${a.question.slice(0, 200)}\nA: ${a.answer.slice(0, 600)}`).join("\n")}`
      : "",
  ].join("\n");
  const { value: answers } = await completeParsed(ai, { system: DRAFT_PROMPT, user, ...opts }, (raw) => {
    const parsed = z.object({ answers: looseArray(z.object({ id: looseText(), answer: looseText() })) }).safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data.answers;
  });
  const ids = new Set(questions.map((q) => q.id));
  const out: Record<string, string> = {};
  for (const a of answers) {
    const answer = naturalAnswer(a.answer);
    if (ids.has(a.id) && answer) out[a.id] = answer;
  }
  return out;
}

/** A sentence that talks about the candidate's data instead of answering ("The profile does not specify…"). */
const META_SENTENCE = new RegExp(
  [
    // "The profile does not specify…", "My resume doesn't mention…", "the information provided doesn't include…"
    String.raw`\b(the|my|your|candidate's|this)\s+(profile|resume|résumé|cv|information|details)\b[^.!?]*(\bnot|n't|\bno)\s+(\w+\s+)?(mention|specif|state|include|list|say|indicate|provid|show|contain|cover|detail)`,
    String.raw`\bno\s+(mention|information|details?|data)\s+(of|about|on|regarding)\b`,
    String.raw`\b(not|isn't|aren't)\s+(specified|mentioned|stated|provided|listed|available|indicated|included)\b`,
    String.raw`\bplease\s+(indicate|specify|add|fill|provide|insert|enter|confirm|update)\b`,
    String.raw`\b(to be (filled|added|confirmed)|fill in|tbd|placeholder)\b`,
  ].join("|"),
  "i",
);

/**
 * Drop what a form answer shouldn't contain: [bracketed notes], placeholders and sentences about the profile
 * itself. Returns "" when nothing real is left (the field then stays for the candidate).
 */
export function naturalAnswer(text: string): string {
  const noBrackets = text.replace(/\[[^\]]*\]|\{[^}]*\}|<[^>]*>/g, " ");
  const kept = noBrackets
    .split("\n")
    .map((line) => (line.match(/[^.!?]+[.!?]*\s*/g) ?? []).filter((s) => !META_SENTENCE.test(s)).join("").trim())
    .join("\n");
  return kept.replace(/[ \t]+/g, " ").replace(/ ([,.;:!?])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
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

/**
 * A long CV, portfolio write-up or profile document → profile fields. Read in sections (each well inside the model's
 * input and output limits) and merged: the same project or job seen in two sections is kept once, with its details
 * combined. Entries whose names aren't in the text are dropped, as with a resume.
 */
export async function parseProfileText(
  ai: AIConfig,
  text: string,
  opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {},
): Promise<Partial<CandidateProfile>> {
  const SECTION = 7000;
  const chunks: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > SECTION && cur.trim()) { chunks.push(cur); cur = ""; }
    cur += `${line}\n`;
  }
  if (cur.trim()) chunks.push(cur);
  let merged = { ...EMPTY_PROFILE };
  // One section at a time: free-tier providers count tokens per minute
  for (const chunk of chunks.slice(0, 6)) merged = mergeProfile(merged, await parseResumeWithAI(ai, chunk, opts));
  const { updatedAt: _u, answers: _a, ...fields } = merged;
  return fields;
}
