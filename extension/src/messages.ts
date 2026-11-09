import type { CoverLetterTone, DraftQuestion, JobAnalysis, JobPosting } from "@internova/core";

/** Side panel → service worker. The API key never leaves the service worker. */
export type Request =
  | { type: "analyze-ai"; job: JobPosting }
  | { type: "test-key" }
  | { type: "draft-answers"; questions: DraftQuestion[]; job: JobPosting | null }
  | { type: "parse-resume"; resumeId: string }
  | { type: "cover-letter"; job: Pick<JobPosting, "title" | "company" | "text">; resumeId?: string | null; tone?: CoverLetterTone; words?: number }
  | { type: "tailor-resume"; job: Pick<JobPosting, "title" | "company" | "text">; resumeId?: string | null; latex?: string; shorten?: boolean };

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export type AnalyzeAIResponse = Response<JobAnalysis>;
export type KeyTest = { provider: string; model: string; ok: boolean; error?: string };

export async function send<T>(msg: Request): Promise<Response<T>> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as Response<T> | undefined;
    return res ?? { ok: false, error: "No response from the JobPilot background worker. Try reloading the extension." };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}
