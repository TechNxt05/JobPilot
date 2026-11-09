import { draftAnswers, normalizeProfile, profileToContext, type DraftQuestion, type JobPosting, type StoredResume } from "@internova/core";
import { json, NO_AI, requireUser, serverAI } from "@/lib/ai";

/** POST { questions: [{id, question}], job? } → { answers: { id: text } }. Drafts only from the user's own profile. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return json({ error: "Sign in first" }, 401);
  const ai = serverAI();
  if (!ai) return NO_AI();

  const body = (await req.json().catch(() => null)) as { questions?: DraftQuestion[]; job?: JobPosting | null } | null;
  const questions = (body?.questions ?? []).filter((q) => q && typeof q.id === "string" && typeof q.question === "string").slice(0, 40);
  if (!questions.length) return json({ answers: {} });

  const [{ data: prof }, { data: res }] = await Promise.all([
    auth.supabase.from("profiles").select("data").maybeSingle(),
    auth.supabase.from("resumes").select("data").is("deleted_at", null),
  ]);
  const profile = normalizeProfile(prof?.data ?? {});
  const resumes = ((res ?? []) as { data: StoredResume }[]).map((r) => r.data).filter(Boolean).sort((a, b) => b.addedAt - a.addedAt);

  try {
    const answers = await draftAnswers(ai, questions, { profile: profileToContext(profile, resumes[0]?.text ?? ""), job: body?.job ?? null });
    return json({ answers });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
