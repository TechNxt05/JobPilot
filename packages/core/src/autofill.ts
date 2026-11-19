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
  /**
   * input type, "select", "textarea", "radio" (one choice: native radios, ARIA radios, Yes/No buttons),
   * "checkbox" (several choices; a lone checkbox has options Yes / No), or "combobox" (custom dropdown, tag "select";
   * no options when they only load as you type)
   */
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
  [/how\s+did\s+you\s+(hear|find|learn|come\s+to)|\breferr(al|ed)\b|^\s*source\s*$/i, "Referral source"],
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

/** Same place, different names: "India" / "IN" / "Bharat", "USA" / "United States of America". */
const ALIASES: string[][] = [
  ["india", "in", "ind", "bharat"],
  ["united states", "united states of america", "usa", "us", "u s", "u s a", "america"],
  ["united kingdom", "uk", "u k", "gb", "great britain", "britain", "england"],
  ["united arab emirates", "uae", "u a e"],
  ["germany", "de", "deutschland"],
  ["netherlands", "nl", "holland", "the netherlands"],
  ["south korea", "korea", "republic of korea", "korea republic of"],
  ["bengaluru", "bangalore"],
  ["gurugram", "gurgaon"],
  ["mumbai", "bombay"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["new delhi", "delhi", "delhi ncr", "ncr"],
];
const aliasesOf = (v: string) => ALIASES.find((g) => g.includes(v)) ?? [v];

/** Other names for a place, longest first ("Bengaluru" → ["bangalore"]), to try in search-as-you-type dropdowns. */
export function valueAliases(value: string): string[] {
  const v = normalize(value).replace(/['’`]/g, "");
  return aliasesOf(v).filter((a) => a !== v && a.length > 3).sort((a, b) => b.length - a.length);
}

/** Option text without a bracketed code: "India (+91)" → "india", "Bachelor's (B.Tech)" → "bachelor's". */
const withoutParens = (s: string) => normalize(s.replace(/\([^)]*\)|\[[^\]]*\]/g, " "));

/** Numeric range an option describes: "1-3 years" → [1, 3], "5+ years" → [5, ∞], "Less than 1 year" → [0, 1). */
function optionRange(o: string): [number, number, boolean] | null {
  const t = o.toLowerCase().replace(/,/g, "");
  const num = "(\\d+(?:\\.\\d+)?)";
  let m = t.match(new RegExp(`${num}\\s*(?:-|–|—|to)\\s*${num}`));
  if (m) return [Number(m[1]), Number(m[2]), true];
  m = t.match(new RegExp(`(?:less\\s+than|under|below|fewer\\s+than|<)\\s*${num}`));
  if (m) return [0, Number(m[1]), false];
  m = t.match(new RegExp(`${num}\\s*\\+|(?:more\\s+than|over|above|at\\s+least|>)\\s*${num}|${num}\\s*(?:years?\\s+)?(?:or|and)\\s+(?:more|above|over)`));
  if (m) return [Number(m[1] ?? m[2] ?? m[3]), Infinity, true];
  m = t.match(new RegExp(`^\\s*${num}\\s*(?:years?|yrs?|months?)?\\s*$`));
  if (m) return [Number(m[1]), Number(m[1]), true];
  return null;
}

/** "2", "2 years", "2.5 yrs" → 2 / 2.5; null when the value isn't a plain amount. */
function plainNumber(v: string): number | null {
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*(\+|years?|yrs?|y)?\s*$/i);
  return m ? Number(m[1]) : null;
}

/** The option whose range holds the number: 2 → "1-3 years" (on a shared edge, "2-5" beats "1-2"). */
function rangeOption(opts: string[], n: number): string | null {
  const hits = opts.map((o) => [o, optionRange(o)] as const).filter(([, r]) => r && n >= r[0] && (r[2] ? n <= r[1] : n < r[1]));
  if (!hits.length) return null;
  return (hits.find(([, r]) => n < r![1]) ?? hits[0])[0];
}

/** Pick the select/radio option that best matches a value, or null if nothing is a confident match. */
export function bestOption(options: string[], value: string, key?: FieldKey | null): string | null {
  const v = normalize(value);
  if (!v) return null;
  const opts = options.filter((o) => o.trim() && !/^(select|choose|please|--|none selected)\b/i.test(o.trim()));
  const exact = opts.find((o) => normalize(o) === v);
  if (exact) return exact;
  // Apostrophes, accents and bracketed codes: "Bachelor’s" = "Bachelors", "India (+91)" = "India"
  const loose = (s: string) => withoutParens(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’`]/g, "");
  const lv = loose(value);
  const names = aliasesOf(lv);
  const aliased = opts.filter((o) => names.includes(loose(o)));
  if (aliased.length === 1) return aliased[0];
  const n = plainNumber(value);
  if (n !== null) {
    const ranged = rangeOption(opts, n);
    if (ranged) return ranged;
  }
  // "Yes, available from May" → the option starting with Yes
  const yn = v.match(/^(yes|no)\b/);
  if (yn) {
    const hit = opts.filter((o) => normalize(o).split(/[^a-z0-9]+/)[0] === yn[1]);
    if (hit.length === 1) return hit[0];
  }
  if (key === "degree") {
    const level = DEGREE_LEVEL_WORDS.find(([valueRe]) => valueRe.test(value));
    if (level) {
      const hit = opts.find((o) => level[1].test(o));
      if (hit) return hit;
    }
  }
  // Whole words only, so "India" doesn't match "British Indian Ocean Territory"
  const words = (s: string) => ` ${loose(s)} `;
  const contains = opts.filter((o) => {
    const on = loose(o);
    return on.length >= 3 && lv.length >= 2 && (words(o).includes(` ${lv} `) || words(value).includes(` ${on} `));
  });
  if (contains.length === 1) return contains[0];
  // Several contain it ("India", "India - Remote"): the shortest one, when it is the value itself plus little else
  if (contains.length > 1) {
    const shortest = [...contains].sort((a, b) => a.length - b.length)[0];
    if (loose(shortest) === lv) return shortest;
  }
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

/** Profile fields AI may write from the rest of the profile when they're empty (never contact or identity details). */
const AI_WRITABLE_KEYS = new Set<FieldKey>(["headline", "summary", "skills", "currentTitle"]);

/** A visible label that reads like a question or field name (not just an id like "q_12" or a search box). */
function hasMeaningfulLabel(f: FormField): boolean {
  const l = f.label.trim();
  return l.length >= 4 && /[a-z]{3}/i.test(l) && !/^(search|filter|captcha|keyword|q|query)\b/i.test(l);
}

function profileValue(key: FieldKey, p: FlatProfile): string {
  if (key === "fullName") return [p.firstName, p.lastName].filter(Boolean).join(" ");
  return p[key] ?? "";
}

/** Separator between the picked options of a checkbox group in a plan's value. */
export const MULTI_SEP = "\n";

/** A group of checkboxes where several options can be ticked (a lone checkbox is a Yes / No choice). */
export const isMultiChoice = (f: Pick<FormField, "type" | "options">) => f.type === "checkbox" && !isYesNo(f.options);
const isYesNo = (options: string[]) => options.length === 2 && options[0] === "Yes" && options[1] === "No";

/** A dropdown whose options only appear as you type (location, school): any value can be typed and matched there. */
export const isTypeahead = (f: Pick<FormField, "type" | "options">) => f.type === "combobox" && f.options.length === 0;

/** A field answered by picking from options (dropdown, radio group, checkboxes). */
export const isChoiceField = (f: Pick<FormField, "tag" | "type">) => f.tag === "select" || f.type === "radio" || f.type === "checkbox";

/**
 * Options of a checkbox group that an answer names ("Python, SQL" / one per line), in the form's order;
 * MULTI_SEP-joined, or null when none match.
 */
export function bestOptions(options: string[], value: string): string | null {
  const parts = value.split(/\n|;|,|\band\b/i).map((s) => s.trim()).filter(Boolean);
  const picked = new Set<string>();
  for (const p of parts) {
    const o = bestOption(options, p);
    if (o) picked.add(o);
  }
  // Options that themselves contain commas ("Yes, full time") still match as a whole
  const whole = bestOption(options, value);
  if (whole && !picked.size) picked.add(whole);
  return picked.size ? options.filter((o) => picked.has(o)).join(MULTI_SEP) : null;
}

/** Fit an answer to a choice field (option text, or MULTI_SEP-joined options), or keep it as free text. */
export function fitToField(field: FormField, value: string): string | null {
  if (isTypeahead(field)) return value.trim() || null;
  if (isMultiChoice(field)) return bestOptions(field.options, value);
  if (isChoiceField(field)) return bestOption(field.options, value);
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
      // A profile detail asked as options ("Degree: B.Tech / M.Tech", "Country: India / Other")
      const own = c.key ? profileValue(c.key, flat) : "";
      const fitted = own ? fitToField(field, own) : null;
      if (c.key && fitted) {
        const differs = !!field.currentValue && field.currentValue.trim() !== fitted.trim();
        return { ...base, key: c.key, action: "fill", reason: null, value: fitted, source: "profile", selected: !differs,
          note: differs ? `Already has “${field.currentValue.slice(0, 40)}”; tick to overwrite` : "" };
      }
      // A choice question we have no rule for: AI can pick the option(s) the profile supports
      const draftable = hasMeaningfulLabel(field) && field.options.length > 1;
      const many = isMultiChoice(field);
      return { ...base, key: c.key, action: "ask", reason: "choice", aiDraftable: draftable,
        note: draftable
          ? many ? "Tick all that apply, or let AI choose from your profile" : "Choice question: pick an option, or let AI choose from your profile"
          : "Choice field: pick the option yourself" };
    }
    if (c.openQuestion) {
      const saved = matchSavedAnswer(field.label, library);
      return saved
        ? { ...base, action: "fill", reason: null, value: saved.answer, answerId: saved.id, source: "library", selected: !field.currentValue,
            note: `Saved answer to “${saved.question.slice(0, 60)}”` }
        : { ...base, action: "ask", reason: "open_question", aiDraftable: true, note: "Open question: write an answer or let AI draft one from your profile" };
    }
    if (!c.key) {
      // Worded differently from every rule ("Years of Python experience", "Tools you use for testing"): a saved answer
      // to a similar question, else AI answers it from the whole profile. AI returns nothing when the profile can't.
      if (!hasMeaningfulLabel(field)) return { ...base, action: "ask", reason: "unknown", note: "Not recognised" };
      const saved = matchSavedAnswer(field.label, library, 0.4);
      const fitted = saved ? fitToField(field, saved.answer) : null;
      if (saved && fitted) {
        return { ...base, action: "fill", reason: null, value: fitted, answerId: saved.id, source: "library", selected: !field.currentValue,
          note: `Saved answer to “${saved.question.slice(0, 60)}”` };
      }
      return { ...base, action: "ask", reason: "unknown", aiDraftable: true, note: "Not a standard field. AI can answer it from your profile" };
    }

    let value = profileValue(c.key, flat);
    if (!value) {
      // Descriptive fields can be written from the rest of the profile; contact details never are
      const draftable = AI_WRITABLE_KEYS.has(c.key);
      return { ...base, key: c.key, action: "ask", reason: "no_value", aiDraftable: draftable,
        note: draftable ? "Not in your profile. AI can write it from your experience" : "Not in your profile" };
    }

    if (c.key === "cgpa" && flat.cgpaScale && /(out\s+of|\/)\s*4\b|4\.0/i.test(field.label) && flat.cgpaScale !== "4") {
      return { ...base, key: c.key, action: "ask", reason: "format", note: `Asks for a 4-point GPA; yours is on a ${flat.cgpaScale}-point scale` };
    }
    if (c.key === "graduationYear" && ["date", "month"].includes(field.type)) {
      return { ...base, key: c.key, action: "ask", reason: "format", note: "Needs a full date; pick it yourself" };
    }
    if (isTypeahead(field)) {
      const differs = !!field.currentValue && field.currentValue.trim().toLowerCase() !== value.trim().toLowerCase();
      return { ...base, key: c.key, action: "fill", reason: null, value, source: "profile", selected: !differs,
        note: differs ? `Already has “${field.currentValue.slice(0, 40)}”; tick to overwrite` : "Typed into the search box; JobPilot picks the matching suggestion" };
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
