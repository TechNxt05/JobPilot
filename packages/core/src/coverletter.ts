import { z } from "zod";
import type { JobPosting } from "./job";
import { escapeLatex, escapeUrl } from "./latex";
import { profileToContext, type CandidateProfile } from "./profile";
import { completeParsed, parseJSONLoose, ProviderError, type AIConfig, type CompleteOptions } from "./providers";
import { ungroundedNumbers, ungroundedSkills } from "./tailor";

/* ------------------------------ Company research ------------------------------ */

export interface ResearchSnippet {
  title: string;
  snippet: string;
  url: string;
}

const stripTags = (h: string) =>
  h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

/** Parse DuckDuckGo's HTML results page (html.duckduckgo.com). */
export function parseDuckDuckGoHtml(html: string): ResearchSnippet[] {
  const out: ResearchSnippet[] = [];
  const blocks = html.split(/class="result\s/).slice(1);
  for (const b of blocks) {
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(a|td|div)>/);
    if (!a) continue;
    let url = a[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    out.push({ title: stripTags(a[2]), snippet: sn ? stripTags(sn[1]) : "", url });
  }
  return out;
}

/**
 * A few public facts about the company/role to make the letter specific. Serper (Google results) when a key
 * is available, DuckDuckGo otherwise. Best effort: returns [] when both fail.
 */
export async function researchCompany(
  company: string,
  role: string,
  opts: { serperKey?: string; fetchImpl?: typeof fetch; signal?: AbortSignal; limit?: number } = {},
): Promise<ResearchSnippet[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const limit = opts.limit ?? 6;
  const queries = [`${company} company mission products`, `${company} ${role} team`, `${company} news ${new Date().getFullYear()}`];
  const seen = new Set<string>();
  const results: ResearchSnippet[] = [];
  const add = (xs: ResearchSnippet[]) => {
    for (const x of xs) {
      if (!x.snippet || seen.has(x.url)) continue;
      seen.add(x.url);
      results.push(x);
    }
  };

  if (opts.serperKey) {
    for (const q of queries) {
      try {
        const res = await fetchImpl("https://google.serper.dev/search", {
          method: "POST",
          signal: opts.signal,
          headers: { "X-API-KEY": opts.serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q, num: 5 }),
        });
        if (!res.ok) break;
        const j = await res.json();
        add((j.organic ?? []).map((o: { title?: string; snippet?: string; link?: string }) => ({ title: o.title ?? "", snippet: o.snippet ?? "", url: o.link ?? "" })));
      } catch {
        break;
      }
    }
  }
  if (results.length < 3) {
    for (const q of queries.slice(0, 2)) {
      try {
        const res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
          signal: opts.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; JobPilot/1.0)" },
        });
        if (res.ok) add(parseDuckDuckGoHtml(await res.text()));
      } catch {
        /* best effort */
      }
    }
  }
  return results.slice(0, limit);
}

/* ------------------------------ Cover letter ------------------------------ */

export type CoverLetterTone = "professional" | "enthusiastic" | "concise";

export interface CoverLetterInput {
  profile: CandidateProfile;
  resumeText?: string;
  job: Pick<JobPosting, "title" | "company" | "text">;
  research?: ResearchSnippet[];
  tone?: CoverLetterTone;
  /** Target length in words (default 250) */
  words?: number;
  hiringManager?: string;
}

export interface CoverLetter {
  subject: string;
  greeting: string;
  paragraphs: string[];
  closing: string;
  /** Facts the model introduced that aren't in the profile, job description or research */
  warnings: string[];
  /** Research sources the letter drew on */
  sources: ResearchSnippet[];
}

const LETTER_PROMPT = `You write a cover letter for an internship / early-career job application.

Rules:
- Facts about the CANDIDATE come only from the CANDIDATE PROFILE. Never invent experience, skills, tools, numbers or results.
- Facts about the COMPANY come only from the JOB DESCRIPTION and COMPANY RESEARCH. If research is thin, stay general
  rather than guessing. Never invent company facts, products, values or people.
- Connect 2–3 of the candidate's most relevant, concrete experiences/projects to the job's requirements.
- Plain, specific, confident; no clichés ("I am writing to express my interest", "passionate team player"), no flattery,
  no exaggeration. Vary sentence openings.
- 3–4 short paragraphs: why this role/company (specific), the relevant evidence, what they'd contribute, a brief close.

Return JSON only: { "subject": string, "greeting": string, "paragraphs": string[], "closing": string }
(closing = sign-off line only, e.g. "Sincerely,"; the name is added separately).`;

export async function generateCoverLetter(ai: AIConfig, input: CoverLetterInput, opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {}): Promise<CoverLetter> {
  const research = input.research ?? [];
  const words = input.words ?? 250;
  const user = [
    `TONE: ${input.tone ?? "professional"} · LENGTH: about ${words} words${input.hiringManager ? ` · ADDRESS TO: ${input.hiringManager}` : ""}`,
    `\nJOB: ${input.job.title ?? ""} at ${input.job.company ?? ""}\nJOB DESCRIPTION\n${input.job.text.slice(0, 7000)}`,
    research.length ? `\nCOMPANY RESEARCH (public web results)\n${research.map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet} (${r.url})`).join("\n")}` : "\nCOMPANY RESEARCH: none",
    `\nCANDIDATE PROFILE\n${profileToContext(input.profile, input.resumeText ?? "").slice(0, 12000)}`,
  ].join("\n");
  const { value } = await completeParsed(ai, { system: LETTER_PROMPT, user, ...opts }, (raw) => {
    const parsed = z
      .object({ subject: z.string().default(""), greeting: z.string().default(""), paragraphs: z.array(z.string()).min(1), closing: z.string().default("Sincerely,") })
      .safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });

  const source = [profileToContext(input.profile, input.resumeText ?? ""), input.job.text, ...research.map((r) => `${r.title} ${r.snippet}`)].join("\n");
  const body = value.paragraphs.join("\n");
  const warnings = [
    ...ungroundedNumbers(body, source).map((n) => `“${n}” isn't in your profile, the job description or the research. Check it.`),
    ...ungroundedSkills(body, source).map((k) => `Mentions ${k}, which isn't in your profile or the job description. Check it.`),
  ];
  return {
    subject: value.subject || `Application for ${input.job.title ?? "the internship"}${input.job.company ? ` at ${input.job.company}` : ""}`,
    greeting: value.greeting || (input.hiringManager ? `Dear ${input.hiringManager},` : "Dear Hiring Team,"),
    paragraphs: value.paragraphs.map((p) => p.trim()).filter(Boolean),
    closing: value.closing || "Sincerely,",
    warnings,
    sources: research,
  };
}

export function coverLetterText(l: Pick<CoverLetter, "greeting" | "paragraphs" | "closing">, name: string): string {
  return [l.greeting, "", ...l.paragraphs.flatMap((p) => [p, ""]), l.closing, name].join("\n").trim();
}

/** Parse an edited plain-text letter back into parts (first line = greeting, last two = closing + name). */
export function parseLetterText(text: string): Pick<CoverLetter, "greeting" | "paragraphs" | "closing"> {
  const blocks = text.trim().split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const greeting = /^(dear|hello|hi|to whom)/i.test(blocks[0] ?? "") ? blocks.shift()! : "";
  const last = blocks[blocks.length - 1] ?? "";
  const closingMatch = last.match(/^(sincerely|best regards|regards|thank you|kind regards|warm regards|yours (sincerely|truly))[,.]?/i);
  const closing = closingMatch ? blocks.pop()!.match(/^[^,.\n]*[,.]?/)![0] : "Sincerely,";
  return { greeting, paragraphs: blocks, closing };
}

export function renderCoverLetterLatex(l: Pick<CoverLetter, "greeting" | "paragraphs" | "closing">, p: CandidateProfile, company: string, date = new Date()): string {
  const e = escapeLatex;
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  const contact = [e(p.email), e(p.phone), e([p.city, p.country].filter(Boolean).join(", ")),
    p.linkedin ? `\\href{${escapeUrl(p.linkedin)}}{${e(p.linkedin.replace(/^https?:\/\/(www\.)?/, ""))}}` : ""].filter(Boolean).join(" $|$ ");
  const when = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}
\\usepackage[hidelinks]{hyperref}
\\input{glyphtounicode}
\\pdfgentounicode=1
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{9pt}
\\begin{document}
{\\Large\\bfseries ${e(name)}}\\\\
{\\small ${contact}}

${e(when)}

${company ? `Hiring Team\\\\\n${e(company)}\n\n` : ""}${e(l.greeting || "Dear Hiring Team,")}

${l.paragraphs.map(e).join("\n\n")}

${e(l.closing || "Sincerely,")}\\\\
${e(name)}
\\end{document}
`;
}
