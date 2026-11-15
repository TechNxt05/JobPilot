/**
 * "Tell JobPilot about yourself": free text in, profile details out.
 * The model only extracts what the text states; links and skills it returns are checked against the text,
 * and nothing it returns overwrites what the user already filled in.
 */
import { z } from "zod";
import type { SavedAnswer } from "./autofill";
import type { CandidateProfile } from "./profile";
import { completeParsed, looseStrings, looseText, parseJSONLoose, ProviderError, type AIConfig, type CompleteOptions } from "./providers";
import { COMMON_QUESTIONS } from "./questions";

export interface NotesExtraction {
  fields: Partial<Pick<CandidateProfile, "headline" | "summary" | "city" | "country" | "phone" | "linkedin" | "github" | "portfolio">>;
  skills: string[];
  certifications: string[];
  achievements: string[];
  /** Common-question id → answer stated in the text */
  answers: Record<string, string>;
  /** Other question/answer pairs worth saving to the answer library */
  qa: { question: string; answer: string }[];
}

const PROMPT = `You turn a job seeker's free-text notes about themselves into structured profile data.

Rules:
- Use ONLY what the notes state. Never guess, infer or embellish. If something isn't stated, leave it out.
- "answers": fill a question id only when the notes clearly answer it (e.g. notice period, expected stipend, relocation,
  work mode, availability, visa). Write the answer in first person, short, as the candidate would type it into a form.
- "qa": other useful facts phrased as a form question and the candidate's answer (e.g. "Which LLMs have you used?").
  At most 8. Do not repeat anything already covered by "answers".
- skills / certifications / achievements: exact items the notes name.

Return JSON only:
{ "headline": string, "summary": string, "city": string, "country": string, "phone": string,
  "linkedin": string, "github": string, "portfolio": string,
  "skills": string[], "certifications": string[], "achievements": string[],
  "answers": { "<question id>": string }, "qa": [{ "question": string, "answer": string }] }`;

const appears = (needle: string, hay: string) => needle.trim().length > 0 && hay.toLowerCase().includes(needle.trim().toLowerCase());

export async function extractFromNotes(ai: AIConfig, notes: string, opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {}): Promise<NotesExtraction> {
  const text = notes.slice(0, 8000);
  const ids = COMMON_QUESTIONS.map((q) => `${q.id}: ${q.question}`).join("\n");
  const user = `QUESTION IDS\n${ids}\n\nNOTES\n${text}`;
  const { value } = await completeParsed(ai, { system: PROMPT, user, ...opts }, (raw) => {
    const s = looseText(" ");
    const parsed = z.object({
      headline: s, summary: s, city: s, country: s, phone: s, linkedin: s, github: s, portfolio: s,
      skills: looseStrings(/,|\n/), certifications: looseStrings(/\n/), achievements: looseStrings(/\n/),
      answers: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
      qa: z.array(z.object({ question: looseText(" "), answer: looseText(" ") })).nullish().transform((v) => v ?? []),
    }).safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });

  const validIds = new Set(COMMON_QUESTIONS.map((q) => q.id));
  const answers: Record<string, string> = {};
  for (const [id, v] of Object.entries(value.answers)) {
    if (validIds.has(id) && typeof v === "string" && v.trim()) answers[id] = v.trim().slice(0, 1500);
  }
  // Links and contact details must literally appear in the notes
  const link = (v: string) => (v && appears(v.replace(/^https?:\/\//, "").replace(/\/$/, ""), text) ? v.trim() : "");
  return {
    fields: {
      headline: value.headline.trim(), summary: value.summary.trim(), city: value.city.trim(), country: value.country.trim(),
      phone: appears(value.phone.replace(/\D/g, "").slice(-6), text.replace(/\D/g, "")) ? value.phone.trim() : "",
      linkedin: link(value.linkedin), github: link(value.github), portfolio: link(value.portfolio),
    },
    // Skills the notes don't actually mention are dropped
    skills: value.skills.filter((k) => appears(k, text)).slice(0, 60),
    certifications: value.certifications.slice(0, 20),
    achievements: value.achievements.slice(0, 20),
    answers,
    qa: value.qa.filter((x) => x.question && x.answer).slice(0, 8),
  };
}

/** Apply an extraction without overwriting anything the user already filled in. Returns what changed. */
export function mergeNotes(profile: CandidateProfile, ex: NotesExtraction): { profile: CandidateProfile; filled: string[] } {
  const out: CandidateProfile = { ...profile, answers: { ...profile.answers }, skills: [...profile.skills], certifications: [...profile.certifications], achievements: [...profile.achievements] };
  const filled: string[] = [];
  for (const [k, v] of Object.entries(ex.fields) as [keyof NotesExtraction["fields"], string][]) {
    if (v && !out[k].trim()) { out[k] = v; filled.push(k); }
  }
  const union = (key: "skills" | "certifications" | "achievements", add: string[]) => {
    const seen = new Set(out[key].map((s) => s.toLowerCase()));
    let n = 0;
    for (const s of add) if (s.trim() && !seen.has(s.toLowerCase())) { out[key].push(s.trim()); seen.add(s.toLowerCase()); n++; }
    if (n) filled.push(`${n} ${key}`);
  };
  union("skills", ex.skills);
  union("certifications", ex.certifications);
  union("achievements", ex.achievements);
  let answered = 0;
  for (const [id, a] of Object.entries(ex.answers)) if (!out.answers[id]?.trim()) { out.answers[id] = a; answered++; }
  if (answered) filled.push(`${answered} saved answers`);
  return { profile: out, filled };
}

/** Q&A pairs not already in the library (same question, ignoring case and punctuation). */
export function newLibraryEntries(qa: NotesExtraction["qa"], library: SavedAnswer[]): NotesExtraction["qa"] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const have = new Set(library.map((a) => norm(a.question)));
  return qa.filter((x) => !have.has(norm(x.question)));
}
