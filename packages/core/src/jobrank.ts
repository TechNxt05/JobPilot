/**
 * AI job-fit scoring: many jobs, one call. The rules (skills, field check, filters) run first for free and pick the
 * jobs worth a look; this scores those against the candidate's whole profile the way a recruiter would.
 */
import { z } from "zod";
import { completeParsed, looseArray, looseText, parseJSONLoose, ProviderError, type AIConfig, type CompleteOptions } from "./providers";

export interface JobToRank {
  id: string;
  title: string;
  company: string;
  location: string;
  text: string;
}

export interface JobRank {
  /** 0–100 */
  score: number;
  /** One line: the decisive match or gap */
  reason: string;
}

/** Most jobs scored in one call (keeps the request inside free-tier token limits). */
export const MAX_RANKED = 20;

const PROMPT = `You are a strict technical recruiter. Score how well the CANDIDATE fits each JOB, 0-100.

Scale:
- 80-100: the job's core work and must-have skills match the candidate's experience and projects; could start now.
- 60-79: good fit with a few gaps.
- 40-59: partial fit: an adjacent role, or several must-haves missing.
- 0-39: a different field, or the core requirements are missing (hardware / chip verification, telecom operations,
  sales, accounting, call centres for a software or AI candidate), or far more seniority than the candidate has.

Rules:
- Judge the job's actual work and its must-have skills, not shared buzzwords. Python, "AI", communication or
  teamwork on their own are not a match.
- Use only the facts given. Compare years of experience asked for with the candidate's.
- reason: at most 18 words, the decisive match or gap, e.g. "Strong RAG and LangGraph match; no Kubernetes".

Return JSON only: {"results":[{"id":string,"score":number,"reason":string}]} with one entry per job id.`;

/** The part of a posting that says what the job is: role, duties and requirements, without the company blurb. */
function jobDigest(text: string, max = 750): string {
  const t = text.replace(/\s+/g, " ").trim();
  const at = t.search(/\b(responsibilit|what you('ll| will) do|requirements|qualifications|you will|the role|about the role|what we('re| are) looking for|skills)/i);
  return (at > 200 ? t.slice(at) : t).slice(0, max);
}

/** Scores for up to MAX_RANKED jobs: job id → { score, reason }. Jobs the model skipped are left out. */
export async function rankJobsWithAI(
  ai: AIConfig,
  candidate: string,
  jobs: JobToRank[],
  opts: Pick<CompleteOptions, "fetchImpl" | "signal" | "timeoutMs"> = {},
): Promise<Record<string, JobRank>> {
  const list = jobs.slice(0, MAX_RANKED);
  if (!list.length) return {};
  // Short ids keep the prompt small and stop the model mangling long ones
  const user = [
    `CANDIDATE\n${candidate.slice(0, 4500)}`,
    `\nJOBS`,
    ...list.map((j, i) => `\n[j${i + 1}] ${j.title} at ${j.company}${j.location ? ` (${j.location})` : ""}\n${jobDigest(j.text) || "(no description)"}`),
  ].join("\n");
  const { value } = await completeParsed(ai, { system: PROMPT, user, maxTokens: 2500, ...opts }, (raw) => {
    const parsed = z.object({ results: looseArray(z.object({ id: looseText(), score: z.union([z.number(), z.string()]), reason: looseText(" ") })) }).safeParse(parseJSONLoose(raw));
    if (!parsed.success || !parsed.data.results.length) throw new ProviderError("The model's answer didn't match the expected format", null, "invalid_output");
    return parsed.data.results;
  });
  const out: Record<string, JobRank> = {};
  for (const r of value) {
    const i = Number(r.id.replace(/\D/g, "")) - 1;
    const job = list[i];
    const score = Math.round(Number(r.score));
    if (!job || !Number.isFinite(score)) continue;
    out[job.id] = { score: Math.max(0, Math.min(100, score)), reason: r.reason.trim().slice(0, 160) };
  }
  return out;
}
