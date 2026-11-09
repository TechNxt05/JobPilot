import { flatProfile, type CandidateProfile, type FlatProfile } from "./profile";
import { knownAnswer, matchCommonQuestion } from "./questions";

/**
 * Autofill planning. Pure functions: the extension scans the form, this decides what to
 * propose, and the user approves every value before anything is written into the page.
 * Nothing here ever submits a form.
 */

/** A form control as seen by the page scanner. */
export interface FormField {
  /** Stable id assigned by the scanner (data-internova-id), unique per frame */
  iid: string;
  frameId: number;
  tag: "input" | "select" | "textarea";
  /** input type, "select", "textarea", or "radio"/"checkbox" for grouped choices */
  type: string;
  label: string;
  name: string;
  id: string;
  placeholder: string;
  autocomplete: string;
  required: boolean;
  /** Option texts for selects / radio groups */
  options: string[];
  /** Value already in the field, if any */
  currentValue: string;
}

export type FieldKey = keyof FlatProfile | "fullName";

export type AskReason =
  | "sensitive" // legal / demographic / consent; the user must answer
  | "open_question" // free-text question with no saved answer yet
  | "file" // resume upload; the user picks the file
  | "choice" // radio / checkbox group we can't answer
  | "no_value" // recognised field, but the profile has no value for it
  | "no_option" // select with no option matching the profile value
  | "format" // e.g. a date picker where we only know the year
  | "unknown"; // couldn't tell what the field wants

export type ValueSource = "profile" | "your_answer" | "derived" | "library" | "ai";

export interface FieldPlan {
  field: FormField;
  key: FieldKey | null;
  /** fill: we propose a value; ask: the user must provide or confirm one */
  action: "fill" | "ask";
  value: string;
  reason: AskReason | null;
  /** Human explanation shown next to the field */
  note: string;
  /** Whether the field is pre-ticked for filling */
  selected: boolean;
  /** Where the proposed value came from */
  source?: ValueSource;
  /** Common question this field asks (questions.ts id) */
  questionId?: string;
  /** True when AI may draft an answer from the profile (only for non-logistics questions) */
  aiDraftable?: boolean;
  /** For library answers: the saved answer this came from */
  answerId?: string;
}

export interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  updatedAt: number;
}

// Never autofilled, never drafted, no input offered: always the user's call on the form itself.
const LOCKED_SENSITIVE: [RegExp, string][] = [
  [/gender|\bsex\b|pronoun/i, "Gender"],
  [/\brace\b|ethnic|hispanic|latino|caste|tribe/i, "Race / ethnicity"],
  [/veteran|military/i, "Veteran status"],
  [/disab/i, "Disability"],
  [/religio/i, "Religion"],
  [/marital|married/i, "Marital status"],
  [/criminal|convict|felony|arrest/i, "Criminal history"],
  [/date\s+of\s+birth|\bdob\b|birth\s*date|\bage\b/i, "Date of birth / age"],
  [/background\s+check|drug\s+test/i, "Background check"],
  // Not "confirm": "Confirm email" is an ordinary field
  [/\b(i\s+)?(agree|certify|consent|acknowledge|attest)\b|terms\s+(and|&)\s+conditions|privacy\s+policy|signature|sign\s+here/i, "Consent / declaration"],
];

// Eligibility / logistics: filled only from the user's own saved answer, proposed unticked.
const LOGISTICS_SENSITIVE: [RegExp, string][] = [
  [/authori[sz](ed|ation)\s+to\s+work|work\s+authori[sz]ation|legally\s+(authori[sz]ed|eligible)|right\s+to\s+work|work\s+permit|eligib(le|ility)\s+to\s+work/i, "Work authorization"],
  [/sponsor|visa|immigration|citizenship|nationality/i, "Visa / sponsorship"],
  [/salary|compensation|\bctc\b|pay\s+expectation|expected\s+pay|stipend\s+expect/i, "Compensation"],
  [/notice\s+period|start\s+date|join(ing)?\s+date|\bavailab(le|ility)\b|available\s+to\s+start/i, "Availability"],
  [/relocat/i, "Relocation"],
  [/how\s+did\s+you\s+(hear|find|learn|come\s+to)|referr(al|ed)|^\s*source\s*$/i, "Referral source"],
];

const SENSITIVE = [...LOCKED_SENSITIVE, ...LOGISTICS_SENSITIVE];

const AUTOCOMPLETE_MAP: Record<string, FieldKey> = {
  "given-name": "firstName",
  "family-name": "lastName",
  name: "fullName",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  url: "portfolio",
  organization: "currentCompany",
  "organization-title": "currentTitle",
  "address-level2": "city",
  "country-name": "country",
  country: "country",
};

// Order matters: specific before generic (e.g. "school name" must not become fullName).
const RULES: [RegExp, FieldKey][] = [
  [/e-?mail/i, "email"],
  [/linked\s*in/i, "linkedin"],
  [/git\s*hub/i, "github"],
  [/portfolio|personal\s+(web\s*)?site|\bwebsite\b|\bblog\b|other\s+(url|link)|\burl\b/i, "portfolio"],
  [/(name\s+of\s+)?(university|college|school|institut|alma\s+mater)(\s+name)?/i, "college"],
  [/current\s+(title|role|position|designation)|\bjob\s+title\b/i, "currentTitle"],
  [/current\s+(company|employer)|\bemployer\b|^\s*(company|organi[sz]ation)\s*$|current\s+organi[sz]ation/i, "currentCompany"],
  [/first\s*name|given\s*name|forename/i, "firstName"],
  [/last\s*name|surname|family\s*name/i, "lastName"],
  [/^(full\s+|legal\s+|your\s+|candidate'?s?\s+)?name\b|full\s*name|legal\s*name/i, "fullName"],
  [/phone|mobile|contact\s*(no|number)|whats\s*app|\btel\b/i, "phone"],
  // "graduation", not "graduate": "Graduate degree" is a degree field
  [/\b(graduation|passing|pass[\s-]?out|completion)\b(\s*(year|date))?|year\s+of\s+(graduation|passing|completion)|\bbatch\b/i, "graduationYear"],
  [/c\.?g\.?p\.?a|\bg\.?p\.?a\b|\bcpi\b|grade\s+point/i, "cgpa"],
  [/major|branch|discipline|field\s+of\s+study|speciali[sz]|\bstream\b/i, "major"],
  [/degree|qualification|education\s+level|program(me)?\s+of\s+study/i, "degree"],
  [/\bcountry\b/i, "country"],
  [/\bcity\b|current\s+location|^\s*location\s*$|where\s+.*(based|located)|town/i, "city"],
  [/\bheadline\b|professional\s+title/i, "headline"],
  [/^\s*(professional\s+)?summary\s*$|^\s*bio\s*$|short\s+bio/i, "summary"],
  [/^\s*(key\s+|technical\s+)?skills\s*$|list\s+your\s+skills/i, "skills"],
];

const OPEN_QUESTION = /\b(why|describe|tell\s+us|explain|share|what\s+(makes|interests|excites|motivates|is|are|was)|which|how\s+(would|have|do|did)\s+you|have\s+you|cover\s+letter|about\s+yourself|motivation|additional\s+information)\b/i;

const normalize = (s: string) => s.toLowerCase().replace(/[_\[\]().:*?-]+/g, " ").replace(/\s+/g, " ").trim();
const isQuestionLike = (label: string) => (label.trim().endsWith("?") || label.split(/\s+/).length >= 5) && label.split(/\s+/).length >= 3;

export interface Classification {
  key: FieldKey | null;
  sensitive: string | null;
  /** Locked sensitive fields are never filled, even from saved answers */
  locked: boolean;
  openQuestion: boolean;
}

export function classifyField(f: FormField): Classification {
  const label = normalize(f.label);
  const attrs = normalize(`${f.name} ${f.id} ${f.placeholder}`);

  const sensitive = SENSITIVE.find(([re]) => re.test(label) || (!label && re.test(attrs)));
  if (sensitive) {
    return { key: null, sensitive: sensitive[1], locked: LOCKED_SENSITIVE.some(([re]) => re === sensitive[0]), openQuestion: false };
  }

  const ac = AUTOCOMPLETE_MAP[f.autocomplete.trim().toLowerCase()];
  if (ac) return { key: ac, sensitive: null, locked: false, openQuestion: false };

  // Long questions are open questions even if they mention "company" or "university"
  if ((f.tag === "textarea" || isQuestionLike(f.label)) && OPEN_QUESTION.test(f.label) && !/^\s*(e-?mail|phone|linked\s*in|git\s*hub)/i.test(f.label)) {
    return { key: null, sensitive: null, locked: false, openQuestion: true };
  }

  for (const source of [label, attrs]) {
    if (!source) continue;
    const rule = RULES.find(([re]) => re.test(source));
    if (rule) return { key: rule[1], sensitive: null, locked: false, openQuestion: false };
  }
  if (f.tag === "textarea" || isQuestionLike(f.label)) return { key: null, sensitive: null, locked: false, openQuestion: true };
  return { key: null, sensitive: null, locked: false, openQuestion: false };
}

const DEGREE_LEVEL_WORDS: [RegExp, RegExp][] = [
  [/\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?s\b|b\.?\s?sc|bca|bba|b\.?\s?com|bachelor|undergrad)/i, /bachelor|undergrad|b\.?\s?tech|b\.?\s?e\b|b\.?\s?s\b|b\.?\s?sc/i],
  [/\b(m\.?\s?tech|m\.?\s?s\b|m\.?\s?sc|mca|mba|master)/i, /master|graduate|m\.?\s?tech|m\.?\s?s\b|m\.?\s?sc|mba/i],
  [/ph\.?\s?d|doctor/i, /ph\.?\s?d|doctor/i],
];

/** Pick the select/radio option that best matches a value, or null if nothing is a confident match. */
export function bestOption(options: string[], value: string, key?: FieldKey | null): string | null {
  const v = normalize(value);
  if (!v) return null;
  const opts = options.filter((o) => o.trim() && !/^(select|choose|please|--|none selected)/i.test(o.trim()));
  const exact = opts.find((o) => normalize(o) === v);
  if (exact) return exact;
  // "Yes, available from May" → the option starting with Yes
  const yn = v.match(/^(yes|no)\b/);
  if (yn) {
    const hit = opts.filter((o) => normalize(o).split(" ")[0] === yn[1]);
    if (hit.length === 1) return hit[0];
  }
  if (key === "degree") {
    const level = DEGREE_LEVEL_WORDS.find(([valueRe]) => valueRe.test(value));
    if (level) {
      const hit = opts.find((o) => level[1].test(o));
      if (hit) return hit;
    }
  }
  const contains = opts.filter((o) => {
    const n = normalize(o);
    return n.length >= 3 && (n.includes(v) || v.includes(n));
  });
  if (contains.length === 1) return contains[0];
  const vt = new Set(v.split(" "));
  let best: string | null = null;
  let bestScore = 0;
  for (const o of opts) {
    const ot = normalize(o).split(" ");
    const overlap = ot.filter((t) => vt.has(t)).length / Math.max(ot.length, vt.size);
    if (overlap > bestScore) [best, bestScore] = [o, overlap];
  }
  return bestScore >= 0.5 ? best : null;
}

const STOP = new Set("a an the to of in for and or with you your our we at on is are do did be this that what why how".split(" "));
const tokens = (s: string) => new Set(normalize(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t)));

/** Most similar saved answer (Jaccard over content words), or null below the threshold. */
export function matchSavedAnswer(question: string, answers: SavedAnswer[], threshold = 0.5): SavedAnswer | null {
  const q = tokens(question);
  let best: SavedAnswer | null = null;
  let bestScore = 0;
  for (const a of answers) {
    const t = tokens(a.question);
    const inter = [...q].filter((x) => t.has(x)).length;
    const union = new Set([...q, ...t]).size;
    const score = union ? inter / union : 0;
    if (score > bestScore) [best, bestScore] = [a, score];
  }
  return bestScore >= threshold ? best : null;
}

function profileValue(key: FieldKey, p: FlatProfile): string {
  if (key === "fullName") return [p.firstName, p.lastName].filter(Boolean).join(" ");
  return p[key] ?? "";
}

/** Fit an answer to a select / radio field, or keep it as free text. */
function fitToField(field: FormField, value: string): string | null {
  if (field.tag === "select" || field.type === "radio") return bestOption(field.options, value);
  return value;
}

export function planAutofill(fields: FormField[], profile: CandidateProfile, library: SavedAnswer[] = []): FieldPlan[] {
  const flat = flatProfile(profile);
  return fields.map((field): FieldPlan => {
    const base = { field, key: null, value: "", selected: false };
    if (field.type === "file") return { ...base, action: "ask", reason: "file", note: "Attach your resume yourself" };

    const c = classifyField(field);
    if (c.sensitive && c.locked) {
      return { ...base, action: "ask", reason: "sensitive", note: `${c.sensitive}: answer this yourself` };
    }

    // Common questions (incl. eligibility / logistics answered once in the profile)
    const cq = c.sensitive || c.openQuestion || field.tag === "textarea" || isQuestionLike(field.label) ? matchCommonQuestion(field.label) : null;
    if (cq) {
      const known = knownAnswer(cq, profile);
      const logistics = cq.category === "logistics" || !!c.sensitive;
      if (known) {
        const fitted = fitToField(field, known.value);
        if (fitted === null) {
          return { ...base, action: "ask", reason: "no_option", value: known.value, questionId: cq.id,
            note: `Your answer “${known.value.slice(0, 50)}” doesn't match an option. Choose one` };
        }
        const differs = !!field.currentValue && field.currentValue.trim() !== fitted.trim();
        return {
          ...base, action: "fill", reason: null, value: fitted, questionId: cq.id,
          source: known.source === "user" ? "your_answer" : "derived",
          // Eligibility answers are proposed unticked: confirm they apply to this job/location
          selected: !logistics && !differs,
          note: logistics
            ? "Your saved answer. Tick to confirm it applies to this job"
            : known.source === "derived" ? cq.hint ?? "From your profile" : "Your saved answer",
        };
      }
      if (logistics) {
        return { ...base, action: "ask", reason: "sensitive", questionId: cq.id,
          note: `${c.sensitive ?? "Eligibility"}: answer here, or save an answer in Profile → Common questions to reuse it` };
      }
      // Not answered: library answer, else AI may draft from the profile
      const saved = matchSavedAnswer(field.label, library);
      if (saved) {
        return { ...base, action: "fill", reason: null, value: saved.answer, answerId: saved.id, questionId: cq.id, source: "library",
          selected: !field.currentValue, note: `Saved answer to “${saved.question.slice(0, 60)}”` };
      }
      return { ...base, action: "ask", reason: "open_question", questionId: cq.id, aiDraftable: cq.ai,
        note: cq.ai ? "Not answered in your profile. AI can draft it from your profile" : "Write an answer" };
    }

    if (c.sensitive) {
      return { ...base, action: "ask", reason: "sensitive", note: `${c.sensitive}: answer this yourself` };
    }
    if (field.type === "radio" || field.type === "checkbox") {
      return { ...base, key: c.key, action: "ask", reason: "choice", note: "Choice field: pick the option yourself" };
    }
    if (c.openQuestion) {
      const saved = matchSavedAnswer(field.label, library);
      return saved
        ? { ...base, action: "fill", reason: null, value: saved.answer, answerId: saved.id, source: "library", selected: !field.currentValue,
            note: `Saved answer to “${saved.question.slice(0, 60)}”` }
        : { ...base, action: "ask", reason: "open_question", aiDraftable: true, note: "Open question: write an answer or let AI draft one from your profile" };
    }
    if (!c.key) return { ...base, action: "ask", reason: "unknown", note: "Not recognised" };

    let value = profileValue(c.key, flat);
    if (!value) return { ...base, key: c.key, action: "ask", reason: "no_value", note: "Not in your profile" };

    if (c.key === "cgpa" && flat.cgpaScale && /(out\s+of|\/)\s*4\b|4\.0/i.test(field.label) && flat.cgpaScale !== "4") {
      return { ...base, key: c.key, action: "ask", reason: "format", note: `Asks for a 4-point GPA; yours is on a ${flat.cgpaScale}-point scale` };
    }
    if (c.key === "graduationYear" && ["date", "month"].includes(field.type)) {
      return { ...base, key: c.key, action: "ask", reason: "format", note: "Needs a full date; pick it yourself" };
    }
    if (field.tag === "select") {
      const opt = bestOption(field.options, value, c.key);
      if (!opt) return { ...base, key: c.key, action: "ask", reason: "no_option", value, note: `No option matches “${value}”` };
      value = opt;
    }
    const differs = !!field.currentValue && field.currentValue.trim() !== value.trim();
    return {
      ...base, key: c.key, action: "fill", reason: null, value, source: "profile",
      selected: !differs,
      note: differs ? `Already has “${field.currentValue.slice(0, 40)}”; tick to overwrite` : "",
    };
  });
}
