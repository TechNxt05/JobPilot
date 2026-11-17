import type { FormField, JobPosting } from "@internova/core";
import { scanFormFields, type ScannedField } from "./formScanner";
import { runInAllFrames } from "./tabs";

/**
 * What one read of the job tab found: the job description and, when the same page also holds the
 * application form (Lever, Ashby, Greenhouse and many careers pages do), its fields. Analyze reads the
 * page once and hands this to Autofill, so the page isn't scanned again and questions are drafted once.
 */
export interface PageScan {
  tabId: number;
  url: string;
  job: JobPosting | null;
  fields: FormField[];
  at: number;
}

/** How long a read job description is reused as context for an application form opened from it. */
export const JOB_CONTEXT_MS = 3 * 3600e3;

/** Form fields in every frame of the active tab (application forms are often embedded iframes). */
export async function scanFields(): Promise<FormField[]> {
  const frames = await runInAllFrames<ScannedField[]>(scanFormFields);
  return frames.flatMap((f) => f.result.map((r) => ({ ...r, frameId: f.frameId })));
}

/** A real application form, not just a search box or a newsletter signup. */
export function looksLikeApplicationForm(fields: FormField[]): boolean {
  const text = fields.map((f) => `${f.label} ${f.name} ${f.type}`).join(" ").toLowerCase();
  const signals = [/e-?mail/, /phone|mobile/, /first\s*name|full\s*name|\bname\b/, /resume|cv|\bfile\b/, /linked\s*in/].filter((re) => re.test(text)).length;
  return fields.length >= 4 && signals >= 2;
}
