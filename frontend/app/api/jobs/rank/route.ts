import { MAX_RANKED, profileToContext, rankJobsWithAI, type JobToRank } from "@internova/core";
import { aiGate, json } from "@/lib/ai";
import { clampText, loadUserData } from "@/lib/userData";

export const maxDuration = 60;

/**
 * POST { jobs: [{ id, title, company, location, text }] } → { ranks: { [id]: { score, reason } } }
 * AI's fit score for the top jobs of a Discover search, against your whole profile: one AI call (one action from
 * your daily allowance) for up to 20 jobs. The search itself stays rule-based and free.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { jobs?: unknown };
  const jobs: JobToRank[] = (Array.isArray(body.jobs) ? body.jobs : []).slice(0, MAX_RANKED).flatMap((raw) => {
    const j = (raw ?? {}) as Record<string, unknown>;
    const id = clampText(j.id, 300);
    const title = clampText(j.title, 200);
    return id && title ? [{ id, title, company: clampText(j.company, 120), location: clampText(j.location, 160), text: clampText(j.text, 4000) }] : [];
  });
  if (!jobs.length) return json({ ranks: {} });

  const gate = await aiGate(req);
  if (!gate.ok) return gate.res;
  const { profile, resumes } = await loadUserData(gate.supabase);
  try {
    const ranks = await rankJobsWithAI(gate.ai, profileToContext(profile, resumes[0]?.text ?? ""), jobs, { timeoutMs: 40_000 });
    return json({ ranks }, 200, gate.headers);
  } catch (e) {
    return json({ error: (e as Error).message }, 502, gate.headers);
  }
}
