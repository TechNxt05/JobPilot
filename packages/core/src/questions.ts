import { profileLanguages, type CandidateProfile } from "./profile";

/**
 * Common application questions. The user can answer any of them once in their Profile;
 * autofill then reuses the answer on every form where the same question appears.
 *
 * ai = true  → if the user leaves it blank, AI may draft an answer from the profile (user reviews it).
 * ai = false → eligibility / logistics: only the user's own answer is ever used. AI never invents these,
 *              and autofill proposes the saved answer unticked so the user confirms it for each job.
 */
export type QuestionCategory = "about" | "technical" | "projects" | "motivation" | "logistics";

export interface CommonQuestion {
  id: string;
  category: QuestionCategory;
  question: string;
  /** Matches form labels that ask this question */
  patterns: RegExp[];
  ai: boolean;
  /** Needs the specific job/company to answer well (drafted per form when job context is available) */
  jobSpecific?: boolean;
  /** Deterministic answer from the profile, used before AI */
  derive?: (p: CandidateProfile) => string;
  hint?: string;
}

export const QUESTION_CATEGORIES: { id: QuestionCategory; label: string }[] = [
  { id: "about", label: "About you" },
  { id: "technical", label: "Technical background" },
  { id: "projects", label: "Projects & building" },
  { id: "motivation", label: "Motivation (role / company)" },
  { id: "logistics", label: "Eligibility & logistics (you answer these)" },
];

export const COMMON_QUESTIONS: CommonQuestion[] = [
  // About you
  { id: "about_yourself", category: "about", ai: true, question: "Tell us about yourself.",
    patterns: [/tell\s+(us|me)\s+(a\s+(bit|little)\s+)?about\s+yourself|introduce\s+yourself|describe\s+yourself|^about\s+(you|yourself)$/i] },
  { id: "strengths", category: "about", ai: true, question: "What are your greatest strengths?",
    patterns: [/\bstrengths?\b/i] },
  { id: "weakness", category: "about", ai: true, question: "What is an area you're working to improve?",
    patterns: [/\bweakness|area.*(improve|develop)|room\s+for\s+improvement/i] },
  { id: "teamwork", category: "about", ai: true, question: "Describe a time you worked closely with a team.",
    patterns: [/(time|example|situation).{0,40}\b(team|collaborat)/i] },
  { id: "conflict", category: "about", ai: true, question: "Describe a disagreement or conflict and how you handled it.",
    patterns: [/conflict|disagree/i] },
  { id: "leadership", category: "about", ai: true, question: "Describe a time you showed leadership or ownership.",
    patterns: [/(time|example).{0,40}\b(led|lead|leadership|ownership|initiative)/i] },
  { id: "failure", category: "about", ai: true, question: "Tell us about a time you failed and what you learned.",
    patterns: [/(time|example).{0,40}\b(fail|mistake|setback)|learn(ed|t)\s+from\s+(a\s+)?(failure|mistake)/i] },

  // Technical
  { id: "languages", category: "technical", ai: true, question: "Which programming languages are you comfortable with?",
    patterns: [/programming\s+languages?|languages?\s+(are\s+you|do\s+you)\s+(comfortable|proficient|know|use)|which\s+languages/i],
    derive: (p) => profileLanguages(p).join(", ") },
  { id: "llms_agents", category: "technical", ai: true, question: "Which LLMs / AI agents have you worked with?",
    patterns: [/\b(llms?|large\s+language\s+models?|ai\s+agents?|agents?|foundation\s+models?)\b.{0,40}\b(worked|used|experience|familiar)|\b(worked|used|experience)\b.{0,40}\b(llms?|agents?)\b/i] },
  { id: "tech_stack", category: "technical", ai: true, question: "Which frameworks and tools are you most experienced with?",
    patterns: [/(frameworks?|tools?|tech(nology)?\s+stack).{0,30}(experienced|comfortable|proficient|worked|familiar)/i] },
  { id: "deployed_ai_app", category: "technical", ai: true, question: "Have you built or deployed an AI application?",
    patterns: [/(built|deployed|shipped|launched).{0,30}\b(ai|llm|ml|machine\s+learning)\b.{0,20}(app|application|product|system|model)/i] },
  { id: "links", category: "technical", ai: false, question: "What GitHub or deployed-build link can you share?",
    patterns: [/(github|deployed[\s-]*(build|app|link)|live\s+(demo|link)|portfolio\s+link|link\s+to\s+(your\s+)?(work|project|code))/i],
    derive: (p) => [p.github, p.portfolio, ...p.projects.map((x) => x.link)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("\n"),
    hint: "Filled from your GitHub, portfolio and project links" },

  // Projects
  { id: "best_ai_project", category: "projects", ai: true, question: "Describe your best AI project in under 200 words.",
    patterns: [/best\s+(ai|ml|machine\s+learning)\s+project|(ai|ml)\s+project.{0,30}(proud|favou?rite|best)/i] },
  { id: "e2e_ml_project", category: "projects", ai: true, question: "Briefly describe one end-to-end ML project.",
    patterns: [/end[\s-]to[\s-]end/i] },
  { id: "hard_thing", category: "projects", ai: true, question: "What's something hard you built recently, and why did you build it?",
    patterns: [/(hard|difficult|challenging|complex).{0,40}(built|build|solved|made|worked\s+on)|something\s+hard/i] },
  { id: "interesting_ai", category: "projects", ai: true, question: "Share something interesting you've built or explored using AI.",
    patterns: [/(interesting|cool|fun|exciting).{0,40}(built|explored|made|created).{0,30}\bai\b|explored\s+using\s+ai|built\s+.*\busing\s+ai\b/i] },
  { id: "proud_project", category: "projects", ai: true, question: "Describe a project you're most proud of.",
    patterns: [/project.{0,30}(proud|favou?rite)|proud.{0,30}project/i] },

  // Motivation (job-specific; a generic version can live in the profile)
  { id: "why_role", category: "motivation", ai: true, jobSpecific: true, question: "Why did you choose this role?",
    patterns: [/why.{0,40}\b(this|the)\s+(role|position|internship|job|opportunity)|why\s+(are\s+you\s+)?(applying|apply)|interest(ed)?\s+in\s+this\s+(role|position|internship)/i] },
  { id: "why_company", category: "motivation", ai: true, jobSpecific: true, question: "Why are you interested in this company?",
    patterns: [/why.{0,40}\b(company|us\b|join|work\s+(at|with|for))|interest(ed)?\s+in\s+(this|our|the)\s+(company|organi[sz]ation|team)|what\s+(excites|attracts|interests)\s+you\s+about/i] },
  { id: "cover_letter", category: "motivation", ai: true, jobSpecific: true, question: "Cover letter",
    patterns: [/cover\s+letter|letter\s+of\s+motivation|motivation\s+letter/i] },
  { id: "career_goals", category: "motivation", ai: true, question: "What are your career goals?",
    patterns: [/career\s+(goals?|aspirations?)|where\s+do\s+you\s+see\s+yourself|long[\s-]term\s+goals?/i] },

  // Logistics: user-only
  { id: "availability", category: "logistics", ai: false, question: "Are you available for 3 months, 40 hours per week?",
    patterns: [/\bavailab(le|ility)\b|hours\s+(per|a|\/)\s*week|full[\s-]time\s+(for|basis)|commit.{0,20}(months|weeks|hours)/i],
    hint: "e.g. Yes, available full-time (40 h/week) from May to August 2026" },
  { id: "start_date", category: "logistics", ai: false, question: "When can you start? / Notice period",
    patterns: [/start\s+date|join(ing)?\s+date|notice\s+period|when\s+can\s+you\s+(start|join)|earliest.{0,20}start/i] },
  { id: "duration", category: "logistics", ai: false, question: "What internship duration are you looking for?",
    patterns: [/(internship|preferred)\s+duration|how\s+long.{0,30}(intern|available)/i] },
  { id: "work_authorization", category: "logistics", ai: false, question: "Are you legally authorized to work in the relevant location?",
    patterns: [/authori[sz](ed|ation)\s+to\s+work|work\s+authori[sz]ation|legally\s+(authori[sz]ed|eligible|allowed)|right\s+to\s+work|work\s+permit|eligib(le|ility)\s+to\s+work/i] },
  { id: "sponsorship", category: "logistics", ai: false, question: "Will you require visa sponsorship?",
    patterns: [/sponsor|\bvisa\b/i] },
  { id: "relocation", category: "logistics", ai: false, question: "Are you willing to relocate?",
    patterns: [/relocat/i] },
  { id: "work_mode", category: "logistics", ai: false, question: "Are you open to on-site / hybrid / remote work?",
    patterns: [/\b(on[\s-]?site|in[\s-]office|hybrid|remote)\b.{0,40}(open|comfortable|willing|prefer|okay|ok)|(open|comfortable|willing|prefer).{0,40}\b(on[\s-]?site|in[\s-]office|hybrid|remote)\b/i] },
  { id: "referral_source", category: "logistics", ai: false, question: "How did you come to learn about the company / this role?",
    patterns: [/how\s+did\s+you\s+(hear|come\s+to\s+(know|learn)|learn|find|discover)|where\s+did\s+you\s+(hear|find|see)|referred\s+by|referral/i] },
  { id: "expected_stipend", category: "logistics", ai: false, question: "What stipend / compensation do you expect?",
    patterns: [/salary|stipend|compensation|\bctc\b|pay\s+expectation|expected\s+pay/i] },
  { id: "previously_applied", category: "logistics", ai: false, question: "Have you applied to or worked at this company before?",
    patterns: [/(previously|before|ever).{0,30}(applied|worked|employed|interned)|(applied|worked).{0,30}(before|previously)/i] },
];

const BY_ID = new Map(COMMON_QUESTIONS.map((q) => [q.id, q]));
export const getCommonQuestion = (id: string) => BY_ID.get(id);

/** The common question a form label is asking, if any. More specific (longer) matches win. */
export function matchCommonQuestion(label: string): CommonQuestion | null {
  const text = label.replace(/\s+/g, " ").trim();
  if (!text) return null;
  let best: { q: CommonQuestion; len: number } | null = null;
  for (const q of COMMON_QUESTIONS) {
    for (const re of q.patterns) {
      const m = text.match(re);
      if (m && (!best || m[0].length > best.len)) best = { q, len: m[0].length };
    }
  }
  return best?.q ?? null;
}

/** The user's own answer, else a deterministic derived answer. Never AI. */
export function knownAnswer(q: CommonQuestion, p: CandidateProfile): { value: string; source: "user" | "derived" } | null {
  const own = p.answers[q.id]?.trim();
  if (own) return { value: own, source: "user" };
  const derived = q.derive?.(p).trim();
  if (derived) return { value: derived, source: "derived" };
  return null;
}

/** Word / character limit stated in a question ("under 200 words", "max 500 characters"). */
export function lengthLimit(question: string): { words?: number; chars?: number } {
  const w = question.match(/(?:under|within|max(?:imum)?|less\s+than|up\s+to|no\s+more\s+than|<)\s*(\d{2,4})\s*words?/i) ?? question.match(/(\d{2,4})\s*words?\s*(?:or\s+less|max)/i);
  const c = question.match(/(?:under|within|max(?:imum)?|less\s+than|up\s+to|no\s+more\s+than|<)\s*(\d{2,5})\s*char/i) ?? question.match(/(\d{2,5})\s*char(?:acter)?s?\s*(?:or\s+less|max)/i);
  return { words: w ? parseInt(w[1], 10) : undefined, chars: c ? parseInt(c[1], 10) : undefined };
}
