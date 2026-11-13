/**
 * ATS vendor profiles: which applicant tracking system a job uses, and how to prepare a resume for it.
 *
 * Honest scope: no vendor publishes its ranking algorithm, and none of the big ones are open source.
 * What IS known is how their resume parsers and recruiter searches behave: older enterprise systems
 * (Taleo, iCIMS, SuccessFactors, Workday) parse into fixed fields and recruiters filter with exact keyword /
 * boolean searches, so exact JD phrasing, standard headings and plain layouts matter most there. Modern
 * systems (Greenhouse, Lever, Ashby) show the resume to a human largely as-is and their search is more
 * forgiving, so readability and relevance matter more than keyword density.
 * The checks below are deterministic and explain themselves; scores are computed in code.
 */
import { extractRequirementsHeuristic } from "./job";
import { analyzeResume } from "./resume";
import { findSkills } from "./skills";

export type AtsVendor =
  | "workday" | "taleo" | "oracle" | "icims" | "successfactors" | "greenhouse" | "lever" | "ashby"
  | "smartrecruiters" | "workable" | "recruitee" | "bamboohr" | "jobvite" | "linkedin" | "naukri" | "unknown";

export interface AtsProfile {
  id: AtsVendor;
  label: string;
  /** strict: fixed-field parser + exact keyword search; standard: good parser, keyword search; lenient: human-first review */
  parsing: "strict" | "standard" | "lenient";
  /** Recruiter search typically matches the exact words (true) or is more forgiving (false) */
  exactKeywords: boolean;
  /** Application usually asks screening / knockout questions */
  knockoutQuestions: boolean;
  tips: string[];
}

const STRICT_TIPS = [
  "Use the exact phrases from the job description (e.g. “machine learning” and “ML”, not only one form).",
  "Keep standard headings: Experience, Education, Skills, Projects. Creative headings may not map to fields.",
  "Single column, no tables, text boxes, headers/footers or icons; put contact details in the body.",
  "Dates like “Jan 2025 – Jun 2025” on the same line as each role, so tenure is calculated correctly.",
  "Answer knockout questions (work authorization, notice period, CGPA) carefully: they filter before anyone reads the resume.",
];

export const ATS_PROFILES: Record<AtsVendor, AtsProfile> = {
  workday: { id: "workday", label: "Workday", parsing: "strict", exactKeywords: true, knockoutQuestions: true,
    tips: [...STRICT_TIPS, "Workday re-types your resume into its form: check every parsed field before submitting.", "Put the target job title in your headline; recruiters often search by title."] },
  taleo: { id: "taleo", label: "Taleo (Oracle)", parsing: "strict", exactKeywords: true, knockoutQuestions: true,
    tips: [...STRICT_TIPS, "Taleo is the most literal of the common parsers: avoid special characters in headings and use a .docx or simple PDF."] },
  oracle: { id: "oracle", label: "Oracle Recruiting Cloud", parsing: "strict", exactKeywords: true, knockoutQuestions: true, tips: STRICT_TIPS },
  icims: { id: "icims", label: "iCIMS", parsing: "strict", exactKeywords: true, knockoutQuestions: true,
    tips: [...STRICT_TIPS, "iCIMS ranks by keyword matches to the posting: mirror the job's skill names where you genuinely have them."] },
  successfactors: { id: "successfactors", label: "SAP SuccessFactors", parsing: "strict", exactKeywords: true, knockoutQuestions: true, tips: STRICT_TIPS },
  smartrecruiters: { id: "smartrecruiters", label: "SmartRecruiters", parsing: "standard", exactKeywords: true, knockoutQuestions: true,
    tips: ["Mirror the job's skill names where you genuinely have them.", "Standard headings and a single-column layout parse best.", "Answer screening questions consistently with your resume."] },
  jobvite: { id: "jobvite", label: "Jobvite", parsing: "standard", exactKeywords: true, knockoutQuestions: true,
    tips: ["Mirror the job's skill names where you genuinely have them.", "Standard headings and a single-column layout parse best."] },
  bamboohr: { id: "bamboohr", label: "BambooHR", parsing: "standard", exactKeywords: false, knockoutQuestions: true,
    tips: ["Small teams read these by hand: a clear one-page resume and a short, specific cover note matter most."] },
  workable: { id: "workable", label: "Workable", parsing: "standard", exactKeywords: false, knockoutQuestions: true,
    tips: ["Workable shows recruiters a parsed summary plus your file: keep the top third of the resume strong and relevant.", "Answer screening questions consistently with your resume."] },
  recruitee: { id: "recruitee", label: "Recruitee", parsing: "standard", exactKeywords: false, knockoutQuestions: true,
    tips: ["Recruiters review the original file: readability and relevance beat keyword density."] },
  greenhouse: { id: "greenhouse", label: "Greenhouse", parsing: "lenient", exactKeywords: false, knockoutQuestions: true,
    tips: ["Greenhouse puts your original resume in front of a person and uses structured scorecards: show evidence for each listed requirement.", "Lead with the 2–3 most relevant projects or roles; specificity beats keyword density.", "Fill the optional questions (LinkedIn, GitHub, “why us”): reviewers read them."] },
  lever: { id: "lever", label: "Lever", parsing: "lenient", exactKeywords: false, knockoutQuestions: false,
    tips: ["Lever shows recruiters your original resume: make the first half-page match the role.", "The “Additional information” box is read; use it for a two-line, specific pitch."] },
  ashby: { id: "ashby", label: "Ashby", parsing: "lenient", exactKeywords: false, knockoutQuestions: true,
    tips: ["Ashby surfaces your resume and answers to a person: concrete, relevant evidence matters most.", "Keep links (GitHub, portfolio) live and relevant; reviewers click them."] },
  linkedin: { id: "linkedin", label: "LinkedIn (Easy Apply)", parsing: "standard", exactKeywords: true, knockoutQuestions: true,
    tips: ["Easy Apply ranks applicants partly by profile/resume skill matches: add the job's skills you genuinely have to your LinkedIn Skills.", "Answer screening questions truthfully: wrong answers auto-reject.", "Message the poster or a recruiter after applying; Easy Apply piles are large."] },
  naukri: { id: "naukri", label: "Naukri", parsing: "strict", exactKeywords: true, knockoutQuestions: true,
    tips: ["Recruiters search Naukri by exact keywords: keep the profile's key skills and resume headline in the job's wording.", "Update the profile regularly; recently updated profiles rank higher in recruiter search."] },
  unknown: { id: "unknown", label: "Unknown ATS", parsing: "standard", exactKeywords: true, knockoutQuestions: false,
    tips: ["When in doubt, prepare for the strictest case: exact JD phrasing, standard headings, single column, no tables."] },
};

/** Detect the ATS from a job / apply URL, optionally helped by the page's HTML. */
export function detectAtsVendor(url: string | null | undefined, html = ""): AtsVendor {
  let host = "";
  try { host = new URL(url ?? "").hostname.toLowerCase(); } catch { /* no URL */ }
  const h = (re: RegExp) => re.test(host);
  if (h(/myworkdayjobs\.com$|myworkdaysite\.com$|(^|\.)workday\.com$/)) return "workday";
  if (h(/taleo\.net$/)) return "taleo";
  if (h(/oraclecloud\.com$/)) return "oracle";
  if (h(/icims\.com$/)) return "icims";
  if (h(/successfactors\.(com|eu)$|sapsf\.(com|eu)$/)) return "successfactors";
  if (h(/greenhouse\.io$/)) return "greenhouse";
  if (h(/lever\.co$/)) return "lever";
  if (h(/ashbyhq\.com$/)) return "ashby";
  if (h(/smartrecruiters\.com$/)) return "smartrecruiters";
  if (h(/workable\.com$/)) return "workable";
  if (h(/recruitee\.com$/)) return "recruitee";
  if (h(/bamboohr\.com$/)) return "bamboohr";
  if (h(/jobvite\.com$/)) return "jobvite";
  if (h(/(^|\.)linkedin\.com$/)) return "linkedin";
  if (h(/naukri\.com$/)) return "naukri";
  // Company career sites that embed an ATS
  const page = html.slice(0, 300_000);
  if (/boards\.greenhouse\.io|grnhse_app|greenhouse\.io\/embed/i.test(page)) return "greenhouse";
  if (/jobs\.lever\.co/i.test(page)) return "lever";
  if (/jobs\.ashbyhq\.com|ashby_embed/i.test(page)) return "ashby";
  if (/myworkdayjobs\.com/i.test(page)) return "workday";
  if (/icims\.com/i.test(page)) return "icims";
  if (/taleo\.net/i.test(page)) return "taleo";
  if (/smartrecruiters\.com/i.test(page)) return "smartrecruiters";
  if (/successfactors/i.test(page)) return "successfactors";
  return "unknown";
}

/* ------------------------------ exact-phrase keywords ------------------------------ */

/** Abbreviation ↔ long form pairs that strict parsers treat as different words. */
export const TERM_PAIRS: [string, string][] = [
  ["ML", "machine learning"], ["AI", "artificial intelligence"], ["NLP", "natural language processing"],
  ["DL", "deep learning"], ["CV", "computer vision"], ["LLM", "large language model"], ["LLMs", "large language models"],
  ["RAG", "retrieval-augmented generation"], ["GenAI", "generative AI"], ["RL", "reinforcement learning"],
  ["CI/CD", "continuous integration"], ["K8s", "Kubernetes"], ["JS", "JavaScript"], ["TS", "TypeScript"],
  ["AWS", "Amazon Web Services"], ["GCP", "Google Cloud"], ["OOP", "object-oriented programming"],
  ["DSA", "data structures and algorithms"], ["DBMS", "database management"], ["OS", "operating systems"],
  ["SQL", "structured query language"], ["API", "application programming interface"], ["UI", "user interface"],
  ["UX", "user experience"], ["QA", "quality assurance"], ["SDE", "software development engineer"], ["SWE", "software engineer"],
  ["ETL", "extract, transform, load"], ["IoT", "Internet of Things"], ["VLSI", "very large scale integration"],
  ["DSP", "digital signal processing"], ["B.Tech", "Bachelor of Technology"], ["M.Tech", "Master of Technology"],
];

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, term: string) => new RegExp(`(^|[^A-Za-z0-9])${esc(term)}([^A-Za-z0-9]|$)`, term.length <= 4 && term === term.toUpperCase() ? "" : "i").test(text);

export interface PhraseGap {
  /** The wording the job uses */
  jobTerm: string;
  /** The wording your resume uses instead */
  resumeTerm: string;
}

/** Terms the job uses in one form while the resume only uses the other (e.g. job "NLP", resume "natural language processing"). */
export function phraseGaps(resumeText: string, jobText: string): PhraseGap[] {
  const gaps: PhraseGap[] = [];
  for (const [abbr, long] of TERM_PAIRS) {
    const jobAbbr = has(jobText, abbr), jobLong = has(jobText, long);
    const resAbbr = has(resumeText, abbr), resLong = has(resumeText, long);
    if (jobAbbr && !resAbbr && resLong) gaps.push({ jobTerm: abbr, resumeTerm: long });
    if (jobLong && !resLong && resAbbr) gaps.push({ jobTerm: long, resumeTerm: abbr });
  }
  return gaps;
}

/* ------------------------------ vendor-aware check ------------------------------ */

export interface AtsVendorCheck {
  id: "keywords" | "exact_phrases" | "job_title" | "headings" | "dates" | "layout" | "contact";
  label: string;
  passed: boolean;
  /** 0–1 */
  ratio: number;
  weight: number;
  detail: string;
}

export interface AtsVendorReport {
  vendor: AtsVendor;
  label: string;
  parsing: AtsProfile["parsing"];
  /** 0–100: how well this resume is prepared for this ATS and this job */
  score: number;
  checks: AtsVendorCheck[];
  phraseGaps: PhraseGap[];
  missingKeywords: string[];
  tips: string[];
}

const TITLE_STOP = /^(and|or|of|the|a|an|in|for|to|with|at|i|ii|iii|iv|intern|internship|remote|hybrid|full|time|part|new|grad|graduate|2025|2026|2027|-|–|\/|&)$/i;

/** Weights per parsing style: strict systems care about exact words and structure, lenient ones mostly about relevance. */
const WEIGHTS: Record<AtsProfile["parsing"], Record<AtsVendorCheck["id"], number>> = {
  strict: { keywords: 30, exact_phrases: 15, job_title: 10, headings: 15, dates: 10, layout: 15, contact: 5 },
  standard: { keywords: 35, exact_phrases: 10, job_title: 10, headings: 12, dates: 8, layout: 15, contact: 10 },
  lenient: { keywords: 50, exact_phrases: 5, job_title: 10, headings: 10, dates: 5, layout: 10, contact: 10 },
};

export function atsVendorCheck(resumeText: string, job: { title: string | null; text: string; url?: string | null }, vendor?: AtsVendor): AtsVendorReport {
  const v = vendor ?? detectAtsVendor(job.url);
  const profile = ATS_PROFILES[v];
  const w = WEIGHTS[profile.parsing];
  const r = analyzeResume(resumeText);
  const req = extractRequirementsHeuristic({ title: job.title, company: null, location: null, url: job.url ?? null, text: job.text, source: "ats-check" });
  const checks: AtsVendorCheck[] = [];
  const add = (id: AtsVendorCheck["id"], label: string, ratio: number, detail: string) =>
    checks.push({ id, label, ratio: Math.max(0, Math.min(1, ratio)), passed: ratio >= 0.999, weight: w[id], detail });

  // 1. Job keywords present in the resume (exact skill names for strict systems, canonical skills otherwise)
  const wanted = [...new Set([...req.requiredSkills, ...req.preferredSkills.slice(0, 6)])];
  const resumeSkills = r.skills;
  const missing = wanted.filter((k) => !resumeSkills.has(k));
  add("keywords", "Job keywords in your resume", wanted.length ? (wanted.length - missing.length) / wanted.length : 1,
    wanted.length ? `${wanted.length - missing.length} of ${wanted.length} skills the job names` : "The job names no recognisable skills");

  // 2. Exact wording (abbreviation vs long form)
  const gaps = phraseGaps(resumeText, job.text);
  add("exact_phrases", "Job's exact wording", gaps.length ? Math.max(0, 1 - gaps.length / 4) : 1,
    gaps.length ? gaps.map((g) => `job says “${g.jobTerm}”, resume says “${g.resumeTerm}”`).join("; ") : "Abbreviations and long forms match the job");

  // 3. Job title words appear (recruiters search by title)
  const titleWords = (job.title ?? "").split(/[\s,()/|–-]+/).filter((t) => t.length > 1 && !TITLE_STOP.test(t));
  const titleHits = titleWords.filter((t) => has(resumeText, t));
  add("job_title", "Target job title", titleWords.length ? titleHits.length / titleWords.length : 1,
    titleWords.length ? `${titleHits.length} of ${titleWords.length} title words (${titleWords.join(", ")}) appear in your resume` : "No job title given");

  // 4. Standard headings
  const heads = [r.sections.experience || r.sections.projects, r.sections.education, r.sections.skills];
  add("headings", "Standard section headings", heads.filter(Boolean).length / 3,
    [!r.sections.education && "Education", !(r.sections.experience || r.sections.projects) && "Experience/Projects", !r.sections.skills && "Skills"].filter(Boolean).join(", ")
      ? `Missing or unrecognised: ${[!r.sections.education && "Education", !(r.sections.experience || r.sections.projects) && "Experience/Projects", !r.sections.skills && "Skills"].filter(Boolean).join(", ")}`
      : "Education, Experience/Projects and Skills found");

  // 5. Parseable dates on roles
  const hasExp = !!r.sections.experience;
  add("dates", "Parseable dates", !hasExp || r.experienceMonths !== null ? 1 : 0,
    !hasExp ? "No experience section to date" : r.experienceMonths !== null ? "Role dates were readable" : "Couldn't read dates in your Experience section (use “Jan 2025 – Jun 2025”)");

  // 6. Layout signals in the extracted text (columns / tables come out as fragments or pipes)
  const lines = r.lines;
  const pipeLines = lines.filter((l) => (l.match(/\|/g)?.length ?? 0) >= 3).length;
  const tiny = lines.filter((l) => l.length <= 3).length;
  const fragmentRatio = lines.length ? (pipeLines + tiny) / lines.length : 0;
  add("layout", "Simple layout", fragmentRatio > 0.15 ? 0.3 : fragmentRatio > 0.07 ? 0.7 : 1,
    fragmentRatio > 0.07 ? "The text reads as fragments or table cells: the PDF may use columns or tables" : "Text extracts in a clean reading order");

  // 7. Contact details in the body
  const contactCount = [r.contact.email, r.contact.phone].filter(Boolean).length;
  add("contact", "Contact details", contactCount / 2, contactCount === 2 ? "Email and phone found" : "Put your email and phone in the body (not a header/footer)");

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((checks.reduce((s, c) => s + c.ratio * c.weight, 0) / total) * 100);
  return { vendor: v, label: profile.label, parsing: profile.parsing, score, checks, phraseGaps: gaps, missingKeywords: missing, tips: profile.tips };
}

/** Instructions for the tailoring model, specific to the detected ATS. */
export function atsTailorHints(vendor: AtsVendor, resumeText = "", jobText = ""): string[] {
  const p = ATS_PROFILES[vendor];
  const hints = [`Target ATS: ${p.label} (${p.parsing} parser).`];
  if (p.exactKeywords) {
    hints.push("Use the job's exact skill names and phrases wherever the candidate genuinely has that skill.");
    const gaps = phraseGaps(resumeText, jobText);
    if (gaps.length) hints.push(`Write these in the job's form (optionally followed by the other in brackets): ${gaps.map((g) => `“${g.jobTerm}” (resume has “${g.resumeTerm}”)`).join(", ")}.`);
    hints.push("Include the target job title's key words in the headline if truthful.");
  } else {
    hints.push("A human reads this resume early: prioritise concrete, relevant evidence and clarity over keyword repetition.");
  }
  if (p.parsing === "strict") hints.push("Keep headings standard (Experience, Projects, Education, Skills) and avoid symbols in headings.");
  return hints;
}

/** Skills the job names that the resume lacks, by exact detection (used for "add only if true" suggestions). */
export function jobSkillGaps(resumeText: string, jobText: string): string[] {
  const res = findSkills(resumeText);
  return [...findSkills(jobText).keys()].filter((k) => !res.has(k));
}
