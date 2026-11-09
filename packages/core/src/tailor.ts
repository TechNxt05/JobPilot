import { z } from "zod";
import { computeAlignment } from "./alignment";
import { scoreATS } from "./ats";
import { extractRequirementsHeuristic, type JobPosting } from "./job";
import { escapeLatex, escapeUrl, latexPreamble, latexToText } from "./latex";
import { profileToContext, type CandidateProfile } from "./profile";
import { completeParsed, parseJSONLoose, ProviderError, type AIConfig, type CompleteOptions } from "./providers";
import { analyzeResume } from "./resume";
import { findSkills } from "./skills";

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
  /** Job skills the candidate doesn't show; never added to the resume */
  skillGaps: string[];
  repeatedVerbs: { verb: string; count: number }[];
  atsBefore: number;
  atsAfter: number;
  alignmentBefore: number | null;
  alignmentAfter: number | null;
  words: number;
  notes: string[];
}

const s = z.string().nullish().transform((v) => (v ?? "").trim());
const TailorSchema = z.object({
  headline: s,
  summary: s,
  experience: z.array(z.object({ source_index: z.number().int(), bullets: z.array(z.string()).default([]) })).default([]),
  projects: z.array(z.object({ source_index: z.number().int(), bullets: z.array(z.string()).default([]) })).default([]),
  skills: z.array(z.object({ category: s, items: z.array(z.string()).default([]) })).default([]),
  extras: z.array(z.object({ heading: s, items: z.array(z.string()).default([]) })).default([]),
  notes: z.array(z.string()).default([]),
});

const TAILOR_PROMPT = `You tailor a candidate's resume to one job, as an expert resume writer and ATS specialist.

Hard rules (violations are automatically removed):
- Use ONLY facts in the CANDIDATE PROFILE. Never invent employers, titles, dates, tools, skills, metrics or results.
- Numbers: only use numbers that already appear in the profile. If a bullet has no metric, describe scope/impact in words.
- Skills: list only skills present in the profile. Prefer the job's wording when the candidate genuinely has the skill
  (e.g. profile "ReactJS" and job "React" → "React").
- One page: at most 4 bullets per role, 3 per project, 3 projects, each bullet under 25 words; summary under 45 words.
- Order bullets and projects by relevance to the job. Drop irrelevant items rather than padding.
- Start every bullet with a strong, specific past-tense verb; don't reuse the same verb more than twice.
- No first person, no buzzword stuffing, no exaggeration ("revolutionized", "world-class").

Return JSON only:
{
  "headline": string,
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
function assemble(p: CandidateProfile, out: z.infer<typeof TailorSchema>, source: string, jobText: string): { resume: TailoredResume; report: Pick<TailorReport, "removed" | "skillGaps" | "notes"> } {
  const removed: TailorReport["removed"] = [];
  const keepBullet = (b: string) => {
    const nums = ungroundedNumbers(b, source);
    if (nums.length) { removed.push({ text: b, reason: `uses ${nums.join(", ")}, which isn't in your profile` }); return false; }
    const skills = ungroundedSkills(b, source);
    if (skills.length) { removed.push({ text: b, reason: `claims ${skills.join(", ")}, which isn't in your profile` }); return false; }
    return b.trim().length > 0;
  };
  const clip = (b: string) => b.replace(/^[•\-*\s]+/, "").trim();

  const experience = out.experience
    .filter((e) => p.experience[e.source_index])
    .slice(0, 4)
    .map((e) => {
      const src = p.experience[e.source_index];
      let bullets = e.bullets.map(clip).filter(keepBullet).slice(0, 4);
      if (!bullets.length) bullets = src.description.split("\n").map(clip).filter(Boolean).slice(0, 3); // fall back to the original
      return { title: src.title, company: src.company, location: src.location, dates: dates(src.start, src.end), bullets };
    });
  const projects = out.projects
    .filter((x) => p.projects[x.source_index])
    .slice(0, 3)
    .map((x) => {
      const src = p.projects[x.source_index];
      let bullets = x.bullets.map(clip).filter(keepBullet).slice(0, 3);
      if (!bullets.length) bullets = src.description.split("\n").map(clip).filter(Boolean).slice(0, 2);
      return { name: src.name, link: src.link, tech: src.tech, bullets };
    });

  const sourceLower = source.toLowerCase();
  const sourceSkills = findSkills(source);
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
    .slice(0, 5);

  const extras = out.extras
    .map((x) => ({ heading: x.heading || "Achievements", items: x.items.map(clip).filter(keepBullet).slice(0, 4) }))
    .filter((x) => x.items.length);

  let summary = out.summary;
  if (summary && (ungroundedNumbers(summary, source).length || ungroundedSkills(summary, source).length)) {
    removed.push({ text: summary, reason: "summary contained facts not in your profile" });
    summary = p.summary;
  }

  const jobSkills = [...findSkills(jobText).keys()];
  const skillGaps = jobSkills.filter((k) => !sourceSkills.has(k));

  return {
    resume: {
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
      headline: out.headline && !ungroundedSkills(out.headline, source).length ? out.headline : p.headline,
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
      skills: skills.length ? skills : [{ category: "Skills", items: p.skills.slice(0, 20) }],
      extras,
    },
    report: { removed, skillGaps, notes: out.notes },
  };
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
/** ~ what fits one A4 page in the template at 10pt */
export const ONE_PAGE_WORDS = 560;

/** Remove the least important content until the resume fits the word budget. Returns null when nothing more can go. */
export function shrinkResume(r: TailoredResume): TailoredResume | null {
  const c: TailoredResume = JSON.parse(JSON.stringify(r));
  const longest = <T extends { bullets: string[] }>(xs: T[], min: number) =>
    xs.map((x, i) => [i, x.bullets.length] as const).filter(([, n]) => n > min).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  if (c.extras.some((x) => x.items.length > 2)) { const x = c.extras.find((e) => e.items.length > 2)!; x.items.pop(); return c; }
  if (c.projects.length > 2) { c.projects.pop(); return c; }
  let i = longest(c.projects, 2);
  if (i !== undefined) { c.projects[i].bullets.pop(); return c; }
  i = longest(c.experience, 3);
  if (i !== undefined) { c.experience[i].bullets.pop(); return c; }
  if (c.extras.length) { c.extras.pop(); return c; }
  if (c.summary) { c.summary = ""; return c; }
  i = longest(c.projects, 1);
  if (i !== undefined) { c.projects[i].bullets.pop(); return c; }
  i = longest(c.experience, 2);
  if (i !== undefined) { c.experience[i].bullets.pop(); return c; }
  if (c.projects.length > 1) { c.projects.pop(); return c; }
  return null;
}

export function fitToWords(r: TailoredResume, budget = ONE_PAGE_WORDS): TailoredResume {
  let cur = r;
  while (wordCount(resumeText(cur)) > budget) {
    const next = shrinkResume(cur);
    if (!next) break;
    cur = next;
  }
  return cur;
}

export function buildReport(beforeText: string, afterText: string, job: Pick<JobPosting, "text">, extra: Pick<TailorReport, "removed" | "skillGaps" | "notes">, bullets: string[]): TailorReport {
  const req = extractRequirementsHeuristic({ title: null, company: null, location: null, url: null, text: job.text, source: "user" });
  const before = analyzeResume(beforeText);
  const after = analyzeResume(afterText);
  return {
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
}

/** Profile → job-tailored structured resume (no LaTeX given). */
export async function tailorResume(ai: AIConfig, input: TailorInput, opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {}): Promise<{ resume: TailoredResume; report: TailorReport }> {
  const source = `${profileToContext(input.profile)}\n${input.resumeText}`;
  const user = [
    `JOB: ${input.job.title ?? ""} at ${input.job.company ?? ""}\n${input.job.text.slice(0, 7000)}`,
    `\n${indexedProfile(input.profile)}`,
    `\nCANDIDATE PROFILE\n${profileToContext(input.profile, input.resumeText).slice(0, 12000)}`,
  ].join("\n");
  const { value } = await completeParsed(ai, { system: TAILOR_PROMPT, user, ...opts }, (raw) => {
    const parsed = TailorSchema.safeParse(parseJSONLoose(raw));
    if (!parsed.success) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data;
  });
  const { resume, report } = assemble(input.profile, value, source, input.job.text);
  const fitted = fitToWords(resume);
  const bullets = [...fitted.experience.flatMap((e) => e.bullets), ...fitted.projects.flatMap((x) => x.bullets)];
  return { resume: fitted, report: buildReport(input.resumeText || source, resumeText(fitted), input.job, report, bullets) };
}

/* ------------------------------ LaTeX rendering ------------------------------ */

/** Single-column, ATS-friendly LaTeX resume (text-selectable, Unicode-mapped, no tables or graphics). */
export function renderResumeLatex(r: TailoredResume): string {
  const e = escapeLatex;
  const link = (url: string, label?: string) => (url ? `\\href{${escapeUrl(url)}}{${e(label ?? url.replace(/^https?:\/\/(www\.)?/, ""))}}` : "");
  const contact = [e(r.contact.phone), r.contact.email ? link(`mailto:${r.contact.email}`, r.contact.email) : "", e(r.contact.location),
    link(r.contact.linkedin), link(r.contact.github), link(r.contact.portfolio)].filter(Boolean).join(" $|$ ");
  const items = (xs: string[]) => (xs.length ? `\\begin{itemize}\n${xs.map((b) => `  \\item ${e(b)}`).join("\n")}\n\\end{itemize}` : "");
  const sec: string[] = [];
  if (r.summary) sec.push(`\\section{Summary}\n${e(r.summary)}`);
  if (r.education.length) {
    sec.push(`\\section{Education}\n${r.education.map((x) => `\\textbf{${e(x.school)}} \\hfill ${e(x.dates)}\\\\\n${e(x.degree)}${x.details ? ` \\hfill ${e(x.details)}` : ""}`).join("\n\n\\smallskip\n")}`);
  }
  if (r.experience.length) {
    sec.push(`\\section{Experience}\n${r.experience.map((x) => `\\textbf{${e(x.title)}}${x.company ? `, ${e(x.company)}` : ""}${x.location ? ` -- ${e(x.location)}` : ""} \\hfill ${e(x.dates)}\n${items(x.bullets)}`).join("\n")}`);
  }
  if (r.projects.length) {
    sec.push(`\\section{Projects}\n${r.projects.map((x) => `\\textbf{${e(x.name)}}${x.tech ? ` $|$ \\textit{${e(x.tech)}}` : ""}${x.link ? ` \\hfill ${link(x.link)}` : ""}\n${items(x.bullets)}`).join("\n")}`);
  }
  if (r.skills.length) sec.push(`\\section{Technical Skills}\n${r.skills.map((g) => `\\textbf{${e(g.category)}:} ${e(g.items.join(", "))}`).join("\\\\\n")}`);
  for (const x of r.extras) sec.push(`\\section{${e(x.heading)}}\n${items(x.items)}`);

  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=0.55in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}
\\usepackage[hidelinks]{hyperref}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\input{glyphtounicode}
\\pdfgentounicode=1
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\titleformat{\\section}{\\large\\bfseries}{}{0em}{}[\\titlerule]
\\titlespacing*{\\section}{0pt}{7pt}{4pt}
\\setlist[itemize]{leftmargin=1.3em,itemsep=0.5pt,topsep=1.5pt,parsep=0pt}
\\begin{document}
\\begin{center}
{\\LARGE\\bfseries ${e(r.name)}}\\\\[2pt]
${r.headline ? `${e(r.headline)}\\\\[2pt]\n` : ""}\\small ${contact}
\\end{center}

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
  const source = `${originalText}\n${profileToContext(input.profile)}`;
  const user = [
    input.shorten ? "The previous version compiled to MORE THAN ONE PAGE. Shorten it to fit one page.\n" : "",
    `JOB: ${input.job.title ?? ""} at ${input.job.company ?? ""}\n${input.job.text.slice(0, 6000)}`,
    `\nCANDIDATE PROFILE\n${profileToContext(input.profile).slice(0, 6000)}`,
    `\nLATEX RESUME\n${input.latex.slice(0, 20000)}`,
  ].join("\n");
  const { value } = await completeParsed(ai, { system: LATEX_PROMPT, user, ...opts }, (raw) => {
    const parsed = z.object({ latex: z.string().min(50), changes: z.array(z.string()).default([]) }).safeParse(parseJSONLoose(raw));
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
  return {
    latex,
    changes: value.changes,
    warnings,
    report: buildReport(originalText, newText, input.job, { removed: [], skillGaps: jobSkills.filter((k) => !srcSkills.has(k)), notes: [] }, bullets),
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
): Promise<{ resume: TailoredResume; latex: string; pdf: Uint8Array; pages: number }> {
  let current = fitToWords(resume);
  let latex = renderResumeLatex(current);
  let pdf = await compile(latex);
  let pages = await countPages(pdf);
  for (let i = 0; pages > 1 && i < maxPasses; i++) {
    // Two trims per pass (each compile is slow), but keep the first one even if the second has nothing left to cut
    const once = shrinkResume(current);
    if (!once) break;
    const next = shrinkResume(once) ?? once;
    current = next;
    latex = renderResumeLatex(current);
    pdf = await compile(latex);
    pages = await countPages(pdf);
  }
  return { resume: current, latex, pdf, pages };
}
