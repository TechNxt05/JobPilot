import {
  analyzeJob,
  draftAnswers,
  generateCoverLetter,
  normalizeProfile,
  parseResumeWithAI,
  profileToContext,
  tailorLatex,
  tailorResume,
  type CoverLetterTone,
  type DraftQuestion,
  type JobPosting,
  type StoredResume,
} from "@internova/core";
import { aiGate, json, quotaStatus, requireUser } from "@/lib/ai";

export const maxDuration = 120;

/**
 * Hosted AI for the JobPilot browser extension (and any signed-in client).
 * Auth: `Authorization: Bearer <Supabase access token>`. Each call uses one action from the user's daily quota.
 * The client sends the context it needs (job, profile, resume text); nothing is stored.
 *
 * POST { task: "quota" }                       → { remaining, limit }   (free, no quota used)
 * POST { task: "analyze", job, resumes }        → JobAnalysis
 * POST { task: "draft-answers", questions, job?, profile, resumeText }
 * POST { task: "parse-resume", text }
 * POST { task: "cover-letter", job, profile, resumeText, tone?, words? }
 * POST { task: "tailor-resume", job, profile, resumeText, latex?, shorten? }
 */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const jobOf = (v: unknown): JobPosting => {
  const j = (v ?? {}) as Partial<JobPosting>;
  return { title: str(j.title, 200) || null, company: str(j.company, 200) || null, location: str(j.location, 200) || null, url: str(j.url, 2000) || null, text: str(j.text, 15000), source: str(j.source, 40) || "extension" };
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.task !== "string") return json({ error: "Missing task" }, 400);

  if (body.task === "quota") {
    const auth = await requireUser(req);
    if (!auth) return json({ error: "Sign in first" }, 401);
    return json((await quotaStatus(auth.supabase)) ?? { error: "Quota not set up" });
  }

  const job = jobOf(body.job);
  const profile = normalizeProfile(body.profile ?? {});
  const resumeText = str(body.resumeText, 20000);
  if (["analyze", "cover-letter", "tailor-resume"].includes(body.task) && job.text.length < 80) return json({ error: "The job description is missing or too short." }, 400);

  const gate = await aiGate(req);
  if (!gate.ok) return gate.res;
  const { ai, headers } = gate;

  try {
    switch (body.task) {
      case "analyze": {
        const resumes = (Array.isArray(body.resumes) ? body.resumes : []).slice(0, 10).map((r) => ({
          id: str((r as StoredResume).id, 100), name: str((r as StoredResume).name, 200), text: str((r as StoredResume).text, 20000), addedAt: Number((r as StoredResume).addedAt) || 0,
        }));
        return json(await analyzeJob(job, resumes, ai), 200, headers);
      }
      case "draft-answers": {
        const questions = ((Array.isArray(body.questions) ? body.questions : []) as DraftQuestion[])
          .filter((q) => q && typeof q.id === "string" && typeof q.question === "string").slice(0, 40);
        const ctxJob = job.text.length >= 80 ? job : null;
        return json(await draftAnswers(ai, questions, { profile: profileToContext(profile, resumeText), job: ctxJob }), 200, headers);
      }
      case "parse-resume": {
        const text = str(body.text, 20000);
        if (text.length < 100) return json({ error: "Resume text is missing or too short" }, 400);
        return json(await parseResumeWithAI(ai, text), 200, headers);
      }
      case "cover-letter":
        return json(await generateCoverLetter(ai, {
          profile, resumeText, job,
          tone: (["professional", "enthusiastic", "concise"].includes(body.tone as string) ? body.tone : "professional") as CoverLetterTone,
          words: Math.min(450, Math.max(120, Number(body.words) || 250)),
        }), 200, headers);
      case "tailor-resume": {
        const latex = str(body.latex, 60000);
        const result = latex
          ? { mode: "latex" as const, ...(await tailorLatex(ai, { profile, resumeText, job, latex, shorten: !!body.shorten })) }
          : { mode: "profile" as const, ...(await tailorResume(ai, { profile, resumeText, job })) };
        return json(result, 200, headers);
      }
      default:
        return json({ error: `Unknown task: ${body.task}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 502, headers);
  }
}
