import { computeAlignment, type AlignmentReport } from "./alignment";
import { analyzeWithAI, type AIAnalysis } from "./ai";
import { scoreATS, type ATSReport } from "./ats";
import { extractRequirementsHeuristic, type JobPosting, type JobRequirements } from "./job";
import { toConfigs, type AIConfig, type CompleteOptions } from "./providers";
import { analyzeResume } from "./resume";

export interface StoredResume {
  id: string;
  name: string;
  text: string;
  addedAt: number;
  /** Clickable links found in the PDF (LinkedIn, GitHub, projects, papers); not part of the text */
  links?: string[];
  /** Last edit (sync); defaults to addedAt */
  updatedAt?: number;
}

export interface ResumeResult {
  resumeId: string;
  resumeName: string;
  alignment: AlignmentReport;
  ats: ATSReport;
}

export interface JobAnalysis {
  job: JobPosting;
  requirements: JobRequirements;
  /** Sorted best match first */
  results: ResumeResult[];
  recommendedResumeId: string | null;
  /** AI insights, written for the resume named here (the best heuristic match) */
  ai: (Omit<AIAnalysis, "requirements"> & { resumeId: string; resumeName: string }) | null;
  aiError: string | null;
}

function rank(results: ResumeResult[]): ResumeResult[] {
  const elig = (r: ResumeResult) => (r.alignment.eligible === "not_met" ? 0 : 1);
  return [...results].sort(
    (a, b) =>
      elig(b) - elig(a) ||
      (b.alignment.overall ?? -1) - (a.alignment.overall ?? -1) ||
      b.ats.score - a.ats.score,
  );
}

/** Deterministic analysis: instant, no network, no API key. */
export function analyzeJobLocal(job: JobPosting, resumes: StoredResume[], requirements?: JobRequirements): JobAnalysis {
  const req = requirements ?? extractRequirementsHeuristic(job);
  const results = rank(
    resumes.map((r) => {
      const analysis = analyzeResume(r.text);
      return { resumeId: r.id, resumeName: r.name, alignment: computeAlignment(req, analysis), ats: scoreATS(analysis) };
    }),
  );
  return { job, requirements: req, results, recommendedResumeId: results[0]?.resumeId ?? null, ai: null, aiError: null };
}

/**
 * Full analysis: heuristic pass first (to pick the most relevant resume), then one AI call
 * for requirement extraction + grounded suggestions, then deterministic re-scoring.
 * Scores are always computed in code, never by the model. Falls back to the heuristic
 * result when the AI call fails.
 */
export async function analyzeJob(
  job: JobPosting,
  resumes: StoredResume[],
  ai: AIConfig | null,
  opts: Pick<CompleteOptions, "fetchImpl" | "signal"> = {},
): Promise<JobAnalysis> {
  const local = analyzeJobLocal(job, resumes);
  if (!toConfigs(ai).length || !resumes.length) return local;

  const best = resumes.find((r) => r.id === local.recommendedResumeId) ?? resumes[0];
  try {
    const { requirements, ...rest } = await analyzeWithAI(ai!, job, best.text, opts);
    // Keep the heuristic values for anything the model left empty
    const merged: JobRequirements = {
      ...requirements,
      requiredSkills: requirements.requiredSkills.length || requirements.preferredSkills.length
        ? requirements.requiredSkills
        : local.requirements.requiredSkills,
      preferredSkills: requirements.requiredSkills.length || requirements.preferredSkills.length
        ? requirements.preferredSkills
        : local.requirements.preferredSkills,
      minYearsExperience: requirements.minYearsExperience ?? local.requirements.minYearsExperience,
      degreeLevels: requirements.degreeLevels.length ? requirements.degreeLevels : local.requirements.degreeLevels,
      minCgpa: requirements.minCgpa ?? local.requirements.minCgpa,
      graduationYears: requirements.graduationYears.length ? requirements.graduationYears : local.requirements.graduationYears,
      deadline: requirements.deadline ?? local.requirements.deadline,
    };
    const rescored = analyzeJobLocal(job, resumes, merged);
    return { ...rescored, ai: { ...rest, resumeId: best.id, resumeName: best.name }, aiError: null };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return { ...local, aiError: (e as Error).message };
  }
}
