/**
 * Recruiter / HR contacts and cold-email drafts.
 * Contacts are the user's own private list (imported from CSV / a pasted sheet). Emails are only ever
 * drafted here; the user reviews and sends them from their own mail app.
 */
import { z } from "zod";
import type { JobPosting } from "./job";
import { profileToContext, type CandidateProfile } from "./profile";
import { completeParsed, looseText, parseJSONLoose, ProviderError, type AIConfig, type CompleteOptions } from "./providers";
import { ungroundedNumbers, ungroundedSkills } from "./tailor";

export type ContactStatus = "unverified" | "verified" | "bounced" | "do_not_contact";
export type OutreachStatus = "none" | "drafted" | "sent" | "replied" | "no_reply";

export const CONTACT_STATUSES: { id: ContactStatus; label: string }[] = [
  { id: "unverified", label: "Unverified" },
  { id: "verified", label: "Verified" },
  { id: "bounced", label: "Bounced" },
  { id: "do_not_contact", label: "Do not contact" },
];

export const OUTREACH_STATUSES: { id: OutreachStatus; label: string }[] = [
  { id: "none", label: "Not contacted" },
  { id: "drafted", label: "Drafted" },
  { id: "sent", label: "Sent" },
  { id: "replied", label: "Replied" },
  { id: "no_reply", label: "No reply" },
];

export interface Contact {
  id: string;
  company: string;
  email: string;
  name: string;
  title: string;
  country: string;
  city: string;
  department: string;
  /** e.g. AI, ML, SDE, Backend */
  roleTags: string[];
  /** Where the contact came from (list name, website, referral, ...) */
  source: string;
  linkedin: string;
  status: ContactStatus;
  outreach: OutreachStatus;
  lastContactedAt: string | null;
  followUpOn: string;
  notes: string;
}

export type ContactDraft = Omit<Contact, "id" | "status" | "outreach" | "lastContactedAt" | "followUpOn" | "notes"> &
  Partial<Pick<Contact, "status" | "notes">>;

/* ------------------------------ company matching ------------------------------ */

const LEGAL_WORDS = new Set([
  "pvt", "private", "ltd", "limited", "llp", "llc", "inc", "incorporated", "corp", "corporation", "co", "company", "plc", "gmbh", "ag", "sa", "bv",
  "technologies", "technology", "tech", "solutions", "services", "software", "systems", "labs", "lab", "group", "holdings", "global",
  "india", "international", "the", "and", "consulting", "consultancy", "infotech", "digital", "ventures", "enterprises",
]);

/** Comparable key for a company name: "Razorpay Software Private Limited" and "Razorpay" → "razorpay". */
export function companyKey(name: string): string {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\.(com|io|ai|in|co)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const core = words.filter((w) => !LEGAL_WORDS.has(w));
  return (core.length ? core : words).join("");
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|aol|proton|protonmail|rediffmail|zoho|gmx|mail|yandex)$/;

/** Company part of an email domain ("talent@careers.razorpay.com" → "razorpay"), or "" for free-mail domains. */
export function emailCompanyKey(email: string): string {
  const sld = domainLabel(email);
  return !sld || FREE_MAIL.test(sld) ? "" : companyKey(sld);
}

/** Organisation label of an email's domain: "hr@careers.acme.co.in" → "acme". */
function domainLabel(email: string): string {
  const labels = (email.split("@")[1]?.toLowerCase() ?? "").split(".").filter(Boolean);
  if (labels.length < 2) return "";
  // Skip country second-level domains: x.co.in, x.com.sa
  return labels.length >= 3 && /^(co|com|org|net|ac|gov|edu)$/.test(labels[labels.length - 2]) ? labels[labels.length - 3] : labels[labels.length - 2];
}

/** Does this contact work at the company (by name, or by their email domain)? */
export function worksAt(company: string, c: Pick<Contact, "company" | "email">): boolean {
  const key = companyKey(company);
  if (!key) return false;
  const ck = companyKey(c.company);
  return ck === key || emailCompanyKey(c.email) === key || (key.length >= 4 && ck.length >= 4 && (ck.startsWith(key) || key.startsWith(ck)));
}

/** Contacts you can email at the given company (skips bounced / do-not-contact), best candidates first. */
export function contactsForCompany<T extends Pick<Contact, "company" | "email" | "status" | "department" | "title">>(company: string, contacts: T[]): T[] {
  const rank = (c: T) =>
    (c.status === "verified" ? 0 : 1) + (/(talent|recruit|hiring|\bhr\b|people|campus|university)/i.test(`${c.title} ${c.department}`) ? 0 : 0.5);
  return contacts
    .filter((c) => c.status !== "do_not_contact" && c.status !== "bounced" && worksAt(company, c))
    .sort((a, b) => rank(a) - rank(b));
}

/* ------------------------------ CSV / sheet import ------------------------------ */

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const isEmail = (s: string) => new RegExp(`^${EMAIL_RE.source}$`).test(s.trim());

/** RFC-4180-ish CSV/TSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? (firstLine.includes("\t") ? "\t" : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === d) {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const COLUMN_ALIASES: Record<keyof Omit<ContactDraft, "roleTags" | "status" | "notes"> | "roleTags" | "notes", RegExp> = {
  email: /^(e-?mail|email ?(id|address)?|mail|contact email|hr email|recruiter email)$/i,
  company: /^(company|company name|organi[sz]ation|org|employer|firm|brand)$/i,
  name: /^(name|full name|contact|contact name|hr name|recruiter|recruiter name|person|poc)$/i,
  title: /^(title|designation|job title|position|role)$/i,
  country: /^(country|nation)$/i,
  city: /^(city|location|office|place|state)$/i,
  department: /^(department|dept|team|function)$/i,
  roleTags: /^(tags|role ?tags|categories|role categories|domains?|hiring for|roles)$/i,
  source: /^(source|list|from)$/i,
  linkedin: /^(linked ?in|linkedin url|profile|linkedin profile)$/i,
  notes: /^(notes?|comments?|remarks?)$/i,
};

export interface ImportResult {
  contacts: ContactDraft[];
  skipped: { line: number; reason: string; text: string }[];
}

/**
 * Turn a pasted sheet / CSV into contacts. With a header row, columns are matched by name
 * (Company, Email, Name, Designation, Country, ...). Without one, each row needs an email; the company
 * is taken from a non-email column or, failing that, from the email domain.
 * Duplicate emails are merged (first one wins).
 */
export function parseContactsCsv(text: string, defaults: Partial<Pick<ContactDraft, "country" | "source">> = {}): ImportResult {
  const rows = parseDelimited(text);
  const result: ImportResult = { contacts: [], skipped: [] };
  if (!rows.length) return result;

  const header = rows[0];
  const columns = new Map<string, number>();
  header.forEach((h, i) => {
    const clean = h.replace(/[*:]/g, "").trim();
    for (const [key, re] of Object.entries(COLUMN_ALIASES)) if (!columns.has(key) && re.test(clean)) columns.set(key, i);
  });
  const hasHeader = columns.has("email") && !header.some((h) => isEmail(h));
  const body = hasHeader ? rows.slice(1) : rows;
  const seen = new Set<string>();

  body.forEach((cells, idx) => {
    const line = idx + (hasHeader ? 2 : 1);
    const get = (k: string) => (columns.has(k) ? cells[columns.get(k)!] ?? "" : "");
    // Some sheets put several emails in one cell ("a@x.com / b@x.com"): import each
    const emailCell = hasHeader ? get("email") : cells.find((c) => EMAIL_RE.test(c)) ?? "";
    const emails = [...emailCell.matchAll(new RegExp(EMAIL_RE.source, "g"))].map((m) => m[0].toLowerCase().replace(/[.,;]+$/, ""));
    if (!emails.length) {
      result.skipped.push({ line, reason: "No email address", text: cells.join(", ").slice(0, 120) });
      return;
    }
    const company = hasHeader ? get("company") : cells.find((c) => c && !EMAIL_RE.test(c) && !/^https?:/i.test(c)) ?? "";
    for (const email of emails) {
      if (seen.has(email)) {
        result.skipped.push({ line, reason: `Duplicate of an earlier row (${email})`, text: "" });
        continue;
      }
      const fromDomain = domainLabel(email);
      const companyName = company || (FREE_MAIL.test(fromDomain) ? "" : fromDomain.replace(/\b\w/g, (c) => c.toUpperCase()));
      if (!companyName) {
        result.skipped.push({ line, reason: "No company (and the email is a personal address)", text: cells.join(", ").slice(0, 120) });
        continue;
      }
      seen.add(email);
      result.contacts.push({
        company: companyName.slice(0, 200),
        email,
        name: get("name").slice(0, 200),
        title: get("title").slice(0, 200),
        country: (get("country") || defaults.country || "").slice(0, 100),
        city: get("city").slice(0, 100),
        department: get("department").slice(0, 100),
        roleTags: get("roleTags").split(/[,;/|]/).map((t) => t.trim()).filter(Boolean).slice(0, 12),
        source: (get("source") || defaults.source || "").slice(0, 200),
        linkedin: get("linkedin").slice(0, 300),
        notes: get("notes").slice(0, 2000),
      });
    }
  });
  return result;
}

/* ------------------------------ cold email ------------------------------ */

export interface ColdEmailInput {
  profile: CandidateProfile;
  resumeText?: string;
  contact: Pick<Contact, "name" | "company" | "title" | "department">;
  /** A specific opening, if the email is about one */
  job?: Pick<JobPosting, "title" | "url" | "text"> | null;
  /** What the candidate is looking for when there's no specific job, e.g. "AI / backend engineering roles" */
  target?: string;
  /** Target length in words (default 150) */
  words?: number;
}

export interface ColdEmail {
  subject: string;
  body: string;
  /** Facts the model introduced that aren't in the profile or job description */
  warnings: string[];
}

const COLD_EMAIL_PROMPT = `You write a short cold email from a job seeker to a recruiter / hiring contact.

Rules:
- Facts about the CANDIDATE come only from the CANDIDATE PROFILE. Never invent experience, skills, numbers, results or links.
- Facts about the COMPANY come only from the JOB section. Never invent company facts, products, news or people.
- If a specific JOB is given, ask to be considered for it. Otherwise ask whether there are openings matching TARGET.
- Pick the 2 most relevant concrete projects / experiences for this company and role and say what they did in one line each.
- Greeting: "Hi <first name>," when a contact name is given, else "Hi <Company> team,". Plain, polite, specific.
  No clichés ("I hope this email finds you well", "passionate"), no flattery, no pressure.
- Close with one clear ask (a short call, or a referral to the right person) and mention the resume is attached.
- Do NOT include a signature, links or contact details: they are appended separately.
- Subject: specific and short, e.g. "Software Engineer (New Grad): <name>, RAG + backend projects".

Return JSON only: { "subject": string, "body": string }`;

/** Signature with the profile's real links (never generated by the model). */
export function emailSignature(p: CandidateProfile): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  const links = [
    p.linkedin && `LinkedIn: ${p.linkedin}`,
    p.github && `GitHub: ${p.github}`,
    p.portfolio && `Portfolio: ${p.portfolio}`,
  ].filter(Boolean);
  return ["Best regards,", name, p.phone, p.email, ...links].filter(Boolean).join("\n");
}

export async function generateColdEmail(ai: AIConfig, input: ColdEmailInput, opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {}): Promise<ColdEmail> {
  const c = input.contact;
  const user = [
    `LENGTH: about ${input.words ?? 150} words (body only)`,
    `\nCONTACT: ${c.name || "(no name)"}${c.title ? `, ${c.title}` : ""}${c.department ? ` (${c.department})` : ""} at ${c.company}`,
    input.job
      ? `\nJOB: ${input.job.title ?? ""}${input.job.url ? ` (${input.job.url})` : ""}\nJOB DESCRIPTION\n${input.job.text.slice(0, 5000)}`
      : `\nJOB: none specific. TARGET: ${input.target || input.profile.headline || "entry-level software / AI engineering roles"}`,
    `\nCANDIDATE PROFILE\n${profileToContext(input.profile, input.resumeText ?? "").slice(0, 10000)}`,
  ].join("\n");
  const { value } = await completeParsed(ai, { system: COLD_EMAIL_PROMPT, user, ...opts }, (raw) => {
    const parsed = z.object({ subject: looseText(" "), body: looseText("\n\n").pipe(z.string().min(40)) }).safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });
  const source = [profileToContext(input.profile, input.resumeText ?? ""), input.job?.text ?? "", input.job?.title ?? "", c.company, input.target ?? ""].join("\n");
  const body = value.body.trim();
  return {
    subject: value.subject.trim() || (input.job?.title ? `Application: ${input.job.title}` : `Interest in roles at ${c.company}`),
    body,
    warnings: [
      ...ungroundedNumbers(body, source).map((n) => `“${n}” isn't in your profile or the job description. Check it.`),
      ...ungroundedSkills(body, source).map((k) => `Mentions ${k}, which isn't in your profile or the job description. Check it.`),
    ],
  };
}

/* ------------------------------ hand-off to the user's mail app ------------------------------ */

/** Gmail compose window, pre-filled (the user attaches the resume and presses Send). */
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}

export function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Date N days from now as YYYY-MM-DD (follow-up reminders). */
export function addDays(days: number, from = new Date()): string {
  const d = new Date(from.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
