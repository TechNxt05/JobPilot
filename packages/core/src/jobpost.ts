/**
 * Job posts that aren't on a job board (e.g. a LinkedIn post: "We're hiring … DM me / email your CV to …").
 * 1. scanPost: deterministic extraction of emails, links and instructions (the only source of contact details)
 * 2. extractPostDetails: AI reads company / role / requirements / how to apply
 * 3. findOfficialJobs: looks for the same role on the company's public job board
 * 4. writePostReplies: email + LinkedIn DM + connection note, written only from the candidate's profile
 */
import { z } from "zod";
import { atsVendorCheck, detectAtsVendor, type AtsVendorReport } from "./atsvendors";
import { companyKey } from "./contacts";
import type { ResearchSnippet } from "./coverletter";
import { fetchBoards, type DiscoveredJob, type JobSource } from "./discover";
import { profileToContext, type CandidateProfile } from "./profile";
import { completeParsed, looseStrings, looseText, parseJSONLoose, ProviderError, type AIConfig, type CompleteOptions } from "./providers";
import { COMMON_QUESTIONS } from "./questions";
import { ungroundedNumbers, ungroundedSkills } from "./tailor";

/* ------------------------------ 1. deterministic scan ------------------------------ */

export interface PostScan {
  emails: string[];
  urls: string[];
  hashtags: string[];
  /** The post asks for a DM / message */
  wantsDm: boolean;
  /** The post asks for an email */
  wantsEmail: boolean;
  /** Required subject line, if the post states one */
  subjectFormat: string | null;
}

const EMAIL_G = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_G = /\b(?:https?:\/\/|www\.)[^\s<>"'()]+|\b(?:lnkd\.in|forms\.gle|bit\.ly)\/[^\s<>"'()]+/gi;

export function scanPost(text: string): PostScan {
  const emails = [...new Set([...text.matchAll(EMAIL_G)].map((m) => m[0].replace(/[.,;:]+$/, "").toLowerCase()))];
  const urls = [...new Set([...text.matchAll(URL_G)].map((m) => m[0].replace(/[.,;:!?]+$/, "")).map((u) => (/^https?:/i.test(u) ? u : `https://${u}`)))];
  const hashtags = [...new Set([...text.matchAll(/#([A-Za-z][\w]{1,40})/g)].map((m) => m[1]))];
  // Quoted ("with subject "X"") or after a separator ("Subject: X")
  const subject = text.match(/subject(?:\s+line)?\s*(?:should\s+be|as|:|-|–|=)?\s*["“‘]([^\n"”’]{4,140})["”’]/i) ??
    text.match(/subject(?:\s+line)?\s*(?:should\s+be|as|:|-|–|=)\s*([^\n"”]{4,140})/i);
  return {
    emails,
    urls,
    hashtags,
    wantsDm: /\b(dm|d\.m\.|direct message|message me|inbox me|drop (me )?a (message|dm)|ping me|reach out to me)\b/i.test(text),
    wantsEmail: emails.length > 0 || /\b(e-?mail|mail)\b.{0,40}\b(resume|cv|profile|application)\b|\b(resume|cv)\b.{0,40}\b(e-?mail|mail)\b/i.test(text),
    subjectFormat: subject ? subject[1].trim().replace(/[.,]$/, "") : null,
  };
}

/* ------------------------------ 2. AI extraction ------------------------------ */

export type ApplyMethod = "email" | "dm" | "link" | "comment" | "unknown";

export interface PostDetails {
  company: string;
  role: string;
  location: string;
  experience: string;
  employmentType: string;
  contactName: string;
  contactRole: string;
  /** Only emails that literally appear in the post */
  emails: string[];
  /** Only links that literally appear in the post */
  applyUrl: string;
  applyMethod: ApplyMethod;
  subjectFormat: string;
  /** What the post asks applicants to include (e.g. "CTC, notice period, resume") */
  include: string[];
  skills: string[];
  deadline: string;
}

const EXTRACT_PROMPT = `You read a hiring post (often from LinkedIn) and extract facts. Use ONLY what the post says; leave a field "" or [] when it isn't stated.

Return JSON only:
{
  "company": string,           // hiring company (not the poster's agency unless that's the employer)
  "role": string,              // job title; if several roles, the first / main one
  "location": string,          // e.g. "Bengaluru (hybrid)", "Remote"
  "experience": string,        // e.g. "0–2 years", "2025/2026 graduates"
  "employment_type": string,   // e.g. "Full-time", "Internship (6 months)"
  "contact_name": string,      // person to contact (often the poster), if stated
  "contact_role": string,      // e.g. "Talent Acquisition, Acme"
  "emails": string[],          // emails exactly as written in the post
  "apply_url": string,         // application link exactly as written, if any
  "apply_method": "email" | "dm" | "link" | "comment" | "unknown",
  "subject_format": string,    // required email subject line, if stated
  "include": string[],         // things applicants must include, e.g. "current CTC", "notice period", "portfolio"
  "skills": string[],          // required / preferred skills named in the post
  "deadline": string
}`;

/** First "X is hiring" / "hiring at X" style company mention, as a fallback when AI is unavailable. */
export function guessCompany(text: string): string {
  const m = text.match(/\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+(?:is|are)\s+hiring\b/) ??
    text.match(/\b(?:hiring|join(?:ing)?|opening|openings|role|position)s?\s+(?:at|@|with)\s+@?([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/) ??
    text.match(/@([A-Z][\w&.-]+)/);
  return m ? m[1].replace(/[.,]$/, "").trim() : "";
}

export async function extractPostDetails(ai: AIConfig, text: string, opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {}): Promise<PostDetails> {
  const scan = scanPost(text);
  const { value } = await completeParsed(ai, { system: EXTRACT_PROMPT, user: `POST\n${text.slice(0, 8000)}`, ...opts }, (raw) => {
    const s = looseText(" ");
    const parsed = z.object({
      company: s, role: s, location: s, experience: s, employment_type: s, contact_name: s, contact_role: s,
      emails: looseStrings(/[,\s]+/), apply_url: s, apply_method: s, subject_format: s,
      include: looseStrings(/[,\n]/), skills: looseStrings(/[,\n]/), deadline: s,
    }).safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });
  // Contact details are never taken from the model unless they literally appear in the post
  const emails = value.emails.map((e) => e.toLowerCase().trim()).filter((e) => scan.emails.includes(e));
  const applyUrl = scan.urls.find((u) => value.apply_url && (u === value.apply_url || u.includes(value.apply_url.replace(/^https?:\/\//, "")))) ?? "";
  const method = (["email", "dm", "link", "comment"].includes(value.apply_method) ? value.apply_method : "unknown") as ApplyMethod;
  return {
    company: value.company || guessCompany(text),
    role: value.role,
    location: value.location,
    experience: value.experience,
    employmentType: value.employment_type,
    contactName: value.contact_name,
    contactRole: value.contact_role,
    emails: emails.length ? emails : scan.emails,
    applyUrl,
    applyMethod: method === "unknown" ? (scan.emails.length ? "email" : scan.wantsDm ? "dm" : applyUrl ? "link" : "unknown") : method,
    subjectFormat: value.subject_format || scan.subjectFormat || "",
    include: value.include.slice(0, 12),
    skills: value.skills.slice(0, 25),
    deadline: value.deadline,
  };
}

/* ------------------------------ 3. official posting ------------------------------ */

const STOP = new Set(["and", "or", "of", "the", "a", "an", "in", "for", "to", "with", "at", "-", "–", "/", "&", "job", "role", "position", "opening", "hiring"]);
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").split(" ").filter((t) => t && !STOP.has(t));

/** 0–1 token overlap between two job titles ("SDE-1 Backend" vs "Software Engineer I, Backend" share "backend"). */
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(tokens(a).map(normTitleToken)), B = new Set(tokens(b).map(normTitleToken));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / Math.min(A.size, B.size);
}
function normTitleToken(t: string): string {
  const map: Record<string, string> = { sde: "software", swe: "software", dev: "developer", developers: "developer", engineers: "engineer", ml: "machine", ai: "ai", sr: "senior", jr: "junior", intern: "intern", internship: "intern", "1": "i", "2": "ii", "3": "iii" };
  return map[t] ?? t;
}

/** Board slugs worth trying for a company name ("Sarvam AI" → sarvam, sarvamai, sarvam-ai). */
export function slugCandidates(company: string): string[] {
  const words = company.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return [...new Set([companyKey(company), words.join(""), words.join("-"), words[0]].filter((s) => s && s.length >= 2))].slice(0, 3);
}

export interface OfficialJob {
  job: DiscoveredJob;
  similarity: number;
}

/**
 * Look for the role on the company's public job board. Tries known boards first, then guesses
 * Greenhouse / Lever / Ashby slugs from the name. Best effort: returns [] when nothing is found.
 */
export async function findOfficialJobs(
  company: string,
  role: string,
  opts: { knownSources?: JobSource[]; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<OfficialJob[]> {
  if (!company.trim()) return [];
  const key = companyKey(company);
  const known = (opts.knownSources ?? []).filter((s) => companyKey(s.company) === key || s.slug.toLowerCase() === key);
  const guesses: JobSource[] = known.length
    ? known
    : slugCandidates(company).flatMap((slug) => (["greenhouse", "lever", "ashby"] as const).map((ats) => ({ ats, slug, company })));
  const boards = await fetchBoards(guesses, { fetchImpl: opts.fetchImpl, signal: opts.signal, timeoutMs: 8000, concurrency: 9 });
  const seen = new Set<string>();
  const out: OfficialJob[] = [];
  for (const b of boards) {
    for (const job of b.jobs) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      const similarity = role ? titleSimilarity(role, job.title) : 0;
      if (similarity >= 0.5) out.push({ job, similarity });
    }
  }
  return out.sort((a, b) => b.similarity - a.similarity || (b.job.postedAt ?? "").localeCompare(a.job.postedAt ?? "")).slice(0, 5);
}

/* ------------------------------ 4. replies ------------------------------ */

export interface PostRepliesInput {
  profile: CandidateProfile;
  resumeText?: string;
  postText: string;
  details: PostDetails;
  research?: ResearchSnippet[];
  /** The matching posting on the company's job board, if found (richer description) */
  officialJob?: Pick<DiscoveredJob, "title" | "url" | "text"> | null;
}

export interface PostReplies {
  emailSubject: string;
  emailBody: string;
  /** LinkedIn message (DM / InMail) */
  dm: string;
  /** LinkedIn connection request note, ≤ 300 characters */
  connectionNote: string;
  /** Things the post asks for that your profile doesn't answer (fill them in yourself) */
  missingInfo: string[];
  warnings: string[];
}

const REPLY_PROMPT = `You help a job seeker reply to a hiring post. Write three messages from the candidate:
1. "email": a short application email (120–200 words) to the address in the post.
2. "dm": a LinkedIn direct message to the poster (60–110 words).
3. "connection_note": a LinkedIn connection-request note, at most 280 characters.

Rules:
- Facts about the CANDIDATE come only from CANDIDATE PROFILE and SAVED ANSWERS. Never invent experience, skills,
  numbers, CTC, notice period, availability or links.
- Facts about the ROLE / COMPANY come only from the POST, the OFFICIAL POSTING and COMPANY RESEARCH.
- Follow the post's instructions exactly: required subject line format, details to include (e.g. CTC, notice period,
  location, years of experience). Fill each requested detail from SAVED ANSWERS / PROFILE; if it isn't there, write
  the placeholder [ADD: <detail>] and list the detail in "missing_info".
- Name the role. Pick the 2 most relevant concrete projects / experiences and say what they did in one line each.
- Greet the contact by first name if known, else "Hi <Company> team," (email) / "Hi," (DM).
- Plain, specific and polite. No clichés ("I am writing to apply", "I hope this finds you well", "passionate", "eager to contribute"), no flattery.
- Email layout: 3–4 short paragraphs separated by blank lines (role + who you are; evidence; requested details; close).
- Email: mention the resume is attached. DM: say you've emailed / applied if the post asks for email or a link, and offer to share the resume.
- No signature or links in any message: they are appended separately.

Return JSON only: { "email_subject": string, "email_body": string, "dm": string, "connection_note": string, "missing_info": string[] }`;

/** Saved logistics answers (CTC, notice period, …) that the post might ask for. */
function savedAnswers(p: CandidateProfile): string {
  const lines = COMMON_QUESTIONS.filter((q) => q.category === "logistics" && p.answers[q.id]?.trim()).map((q) => `- ${q.question} ${p.answers[q.id].trim()}`);
  return lines.length ? lines.join("\n") : "(none saved)";
}

export async function writePostReplies(ai: AIConfig, input: PostRepliesInput, opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {}): Promise<PostReplies> {
  const d = input.details;
  const research = input.research ?? [];
  const user = [
    `POST\n${input.postText.slice(0, 6000)}`,
    `\nEXTRACTED: company=${d.company || "?"}; role=${d.role || "?"}; contact=${d.contactName || "?"}${d.contactRole ? ` (${d.contactRole})` : ""}; apply via ${d.applyMethod}` +
      `${d.subjectFormat ? `; REQUIRED SUBJECT FORMAT: ${d.subjectFormat}` : ""}${d.include.length ? `; MUST INCLUDE: ${d.include.join(", ")}` : ""}`,
    input.officialJob ? `\nOFFICIAL POSTING: ${input.officialJob.title} (${input.officialJob.url})\n${input.officialJob.text.slice(0, 4000)}` : "",
    research.length ? `\nCOMPANY RESEARCH\n${research.map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`).join("\n")}` : "",
    `\nSAVED ANSWERS\n${savedAnswers(input.profile)}`,
    `\nCANDIDATE PROFILE\n${profileToContext(input.profile, input.resumeText ?? "").slice(0, 10000)}`,
  ].join("\n");
  const { value } = await completeParsed(ai, { system: REPLY_PROMPT, user, ...opts }, (raw) => {
    const s = looseText("\n\n");
    const parsed = z.object({ email_subject: looseText(" "), email_body: s.pipe(z.string().min(40)), dm: s, connection_note: looseText(" "), missing_info: looseStrings(/\n/) })
      .safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });

  const source = [profileToContext(input.profile, input.resumeText ?? ""), savedAnswers(input.profile), input.postText, input.officialJob?.text ?? "", ...research.map((r) => `${r.title} ${r.snippet}`)].join("\n");
  const all = `${value.email_body}\n${value.dm}\n${value.connection_note}`;
  let note = value.connection_note.trim();
  if (note.length > 300) note = `${note.slice(0, 297).replace(/\s+\S*$/, "")}…`;
  const role = d.role || input.officialJob?.title || "the role";
  return {
    emailSubject: value.email_subject.trim() || d.subjectFormat || `Application: ${role}${d.company ? ` at ${d.company}` : ""}`,
    emailBody: value.email_body.trim(),
    dm: value.dm.trim(),
    connectionNote: note,
    missingInfo: [...new Set([...value.missing_info, ...[...all.matchAll(/\[ADD:\s*([^\]]+)\]/g)].map((m) => m[1].trim())])],
    warnings: [
      ...ungroundedNumbers(all.replace(/\[ADD:[^\]]*\]/g, ""), source).map((n) => `“${n}” isn't in your profile or the post. Check it.`),
      ...ungroundedSkills(all, source).map((k) => `Mentions ${k}, which isn't in your profile or the post. Check it.`),
    ],
  };
}

/** ATS readiness for the best place this application will land (official posting / apply link). */
export function postAtsReport(resumeText: string, details: PostDetails, official: OfficialJob | null, postText: string): AtsVendorReport | null {
  if (!resumeText.trim()) return null;
  const url = official?.job.applyUrl || official?.job.url || details.applyUrl || null;
  // Applying by email / DM means a person reads it first; treat as a human-first review
  const vendor = url ? detectAtsVendor(url) : details.applyMethod === "email" || details.applyMethod === "dm" ? "greenhouse" : "unknown";
  const report = atsVendorCheck(resumeText, { title: details.role || official?.job.title || null, text: official?.job.text || postText, url }, vendor);
  if (!url && (details.applyMethod === "email" || details.applyMethod === "dm")) {
    return { ...report, label: "Read by a person first (email / DM)", tips: ["A recruiter reads this directly: a clean one-page PDF with the most relevant projects first matters more than keywords.", "Name the file Firstname_Lastname_Role.pdf.", ...report.tips.slice(1)] };
  }
  return report;
}
