import type { JobRequirements } from "./job";
import type { DegreeLevel, ResumeAnalysis } from "./resume";
import { skillPatterns } from "./skills";

export type EvidenceStrength = "demonstrated" | "listed";

export interface Evidence {
  requirement: string;
  /** Verbatim resume line that supports the requirement */
  resumeLine: string;
  /**
   * demonstrated: used in experience / projects / achievements (or any bullet outside the skills list)
   * listed: only named in a skills list, summary or certifications
   */
  strength: EvidenceStrength;
}

/** Credit given to a skill that is only listed, relative to one shown in use. */
export const LISTED_CREDIT = 0.7;

export interface Dimension {
  id: "required_skills" | "preferred_skills" | "experience" | "education";
  label: string;
  /** 0–100, or null when the job states no such requirement (excluded from the overall score) */
  score: number | null;
  weight: number;
  matched: Evidence[];
  missing: string[];
  note: string;
}

export type EligibilityStatus = "met" | "not_met" | "unknown";

export interface EligibilityCheck {
  id: "cgpa" | "graduation_year";
  label: string;
  status: EligibilityStatus;
  detail: string;
}

export interface AlignmentReport {
  /** Weighted mean of the dimensions that apply, 0–100. Null if the job has no checkable requirements. */
  overall: number | null;
  dimensions: Dimension[];
  /** Hard requirements, shown separately: a 95% skill match means little if the candidate isn't eligible. */
  eligibility: EligibilityCheck[];
  /** not_applicable when the posting states no CGPA / graduation-year rules */
  eligible: EligibilityStatus | "not_applicable";
  missingRequirements: string[];
}

const WEIGHTS = { required_skills: 0.5, preferred_skills: 0.15, experience: 0.2, education: 0.15 };

const DEGREE_RANK: Record<DegreeLevel, number> = { diploma: 0, bachelor: 1, master: 2, phd: 3 };

const DEMONSTRATING_SECTIONS = new Set(["experience", "projects", "achievements", "leadership", "publications"]);
const BULLET_LINE = /^([•\-*▪●◦‣–·]|\d+[.)])\s+/;

function strengthOf(line: string, resume: ResumeAnalysis): EvidenceStrength {
  const section = resume.lineSection.get(line);
  if (section) return DEMONSTRATING_SECTIONS.has(section) ? "demonstrated" : "listed";
  // Unlabelled resume: a sentence-like bullet counts as use, a comma list doesn't
  return BULLET_LINE.test(line) && line.split(",").length < 4 ? "demonstrated" : "listed";
}

/** Best resume line evidencing the skill (lines that show it in use win over skills-list mentions), or null. */
export function findEvidence(skill: string, resume: ResumeAnalysis): { line: string; strength: EvidenceStrength } | null {
  const patterns = skillPatterns(skill);
  const candidates = resume.skills.get(skill)?.lines.length
    ? [...resume.skills.get(skill)!.lines, ...resume.lines.filter((l) => patterns.some((p) => p.test(l)))]
    : resume.lines.filter((l) => patterns.some((p) => p.test(l)));
  if (!candidates.length) return null;
  const demonstrated = candidates.find((l) => strengthOf(l, resume) === "demonstrated");
  return demonstrated ? { line: demonstrated, strength: "demonstrated" } : { line: candidates[0], strength: "listed" };
}

function skillDimension(
  id: "required_skills" | "preferred_skills",
  label: string,
  skills: string[],
  resume: ResumeAnalysis,
): Dimension {
  const matched: Evidence[] = [];
  const missing: string[] = [];
  for (const s of skills) {
    const ev = findEvidence(s, resume);
    if (ev) matched.push({ requirement: s, resumeLine: ev.line, strength: ev.strength });
    else missing.push(s);
  }
  const credit = matched.reduce((sum, m) => sum + (m.strength === "demonstrated" ? 1 : LISTED_CREDIT), 0);
  const score = skills.length ? Math.round((credit / skills.length) * 100) : null;
  const listedOnly = matched.filter((m) => m.strength === "listed").length;
  return {
    id,
    label,
    score,
    weight: WEIGHTS[id],
    matched,
    missing,
    note: skills.length
      ? `${matched.length} of ${skills.length} found in your resume` + (listedOnly ? ` · ${listedOnly} only in a skills list` : "")
      : "None listed in this posting",
  };
}

function experienceDimension(req: JobRequirements, resume: ResumeAnalysis): Dimension {
  const base = { id: "experience" as const, label: "Experience", weight: WEIGHTS.experience, matched: [], missing: [] };
  if (req.minYearsExperience === null) return { ...base, score: null, note: "No minimum experience stated" };
  if (req.minYearsExperience === 0) return { ...base, score: 100, note: "No prior experience required" };
  const need = req.minYearsExperience * 12;
  if (resume.experienceMonths === null) {
    return { ...base, score: null, missing: [`${req.minYearsExperience}+ years experience`],
      note: `Needs ${req.minYearsExperience}+ years; couldn't find dated roles in your Experience section to compare` };
  }
  const have = resume.experienceMonths;
  const years = (have / 12).toFixed(1);
  return {
    ...base,
    score: Math.round(Math.min(1, have / need) * 100),
    missing: have >= need ? [] : [`${req.minYearsExperience}+ years experience`],
    note: `Needs ${req.minYearsExperience}+ years; your resume shows about ${years} years (estimated from dates)`,
  };
}

function educationDimension(req: JobRequirements, resume: ResumeAnalysis): Dimension {
  const base = { id: "education" as const, label: "Education", weight: WEIGHTS.education };
  if (!req.degreeLevels.length) return { ...base, score: null, matched: [], missing: [], note: "No degree requirement stated" };
  // Postings often list several acceptable degrees ("B.Tech / M.Tech"); the lowest one is the bar
  const minNeeded = Math.min(...req.degreeLevels.map((d) => DEGREE_RANK[d]));
  const neededLabel = req.degreeLevels.slice().sort((a, b) => DEGREE_RANK[a] - DEGREE_RANK[b])[0];
  if (!resume.degreeLevels.length) {
    return { ...base, score: null, matched: [], missing: [], note: `Asks for a ${neededLabel} degree; none detected in your resume` };
  }
  const best = Math.max(...resume.degreeLevels.map((d) => DEGREE_RANK[d]));
  const ok = best >= minNeeded;
  const eduLine = (resume.sections.education ?? resume.lines).find((l) => /\b(b|m)\.?\s?(tech|e|s|sc)\b|bachelor|master|ph\.?d|diploma/i.test(l));
  return {
    ...base,
    score: ok ? 100 : 40,
    matched: ok && eduLine ? [{ requirement: `${neededLabel} degree`, resumeLine: eduLine, strength: "demonstrated" as const }] : [],
    missing: ok ? [] : [`${neededLabel} degree`],
    note: ok ? "Degree requirement met" : `Asks for a ${neededLabel} degree`,
  };
}

function eligibilityChecks(req: JobRequirements, resume: ResumeAnalysis): EligibilityCheck[] {
  const checks: EligibilityCheck[] = [];
  if (req.minCgpa) {
    const min = req.minCgpa;
    if (!resume.cgpa) {
      checks.push({ id: "cgpa", label: `CGPA ≥ ${min.value}/${min.scale}`, status: "unknown", detail: "No CGPA found in your resume" });
    } else {
      // Compare on a common scale
      const mine = (resume.cgpa.value / resume.cgpa.scale) * min.scale;
      checks.push({
        id: "cgpa",
        label: `CGPA ≥ ${min.value}/${min.scale}`,
        status: mine + 1e-9 >= min.value ? "met" : "not_met",
        detail: `Yours: ${resume.cgpa.value}/${resume.cgpa.scale}${resume.cgpa.scale !== min.scale ? ` (≈ ${mine.toFixed(2)}/${min.scale})` : ""}`,
      });
    }
  }
  if (req.graduationYears.length) {
    const label = `Graduating in ${req.graduationYears.join(" / ")}`;
    if (!resume.graduationYear) {
      checks.push({ id: "graduation_year", label, status: "unknown", detail: "No graduation year found in your resume" });
    } else {
      checks.push({
        id: "graduation_year",
        label,
        status: req.graduationYears.includes(resume.graduationYear) ? "met" : "not_met",
        detail: `Yours: ${resume.graduationYear}`,
      });
    }
  }
  return checks;
}

export function computeAlignment(req: JobRequirements, resume: ResumeAnalysis): AlignmentReport {
  const dimensions = [
    skillDimension("required_skills", "Required skills", req.requiredSkills, resume),
    skillDimension("preferred_skills", "Preferred skills", req.preferredSkills, resume),
    experienceDimension(req, resume),
    educationDimension(req, resume),
  ];
  const scored = dimensions.filter((d) => d.score !== null);
  const totalWeight = scored.reduce((s, d) => s + d.weight, 0);
  const overall = totalWeight ? Math.round(scored.reduce((s, d) => s + d.score! * d.weight, 0) / totalWeight) : null;

  const eligibility = eligibilityChecks(req, resume);
  const eligible: AlignmentReport["eligible"] = !eligibility.length
    ? "not_applicable"
    : eligibility.some((c) => c.status === "not_met")
    ? "not_met"
    : eligibility.some((c) => c.status === "unknown")
      ? "unknown"
      : "met";

  return {
    overall,
    dimensions,
    eligibility,
    eligible,
    missingRequirements: dimensions.filter((d) => d.id !== "preferred_skills").flatMap((d) => d.missing),
  };
}
