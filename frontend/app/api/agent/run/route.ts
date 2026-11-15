import { json, requireUser } from "@/lib/ai";
import { runAgentForUser } from "@/lib/agent";

export const maxDuration = 60;

/**
 * POST { email?: boolean } → AgentRunResult. "Run now" on the Daily jobs page: same as the morning run, for you only,
 * using your own session (row-level security applies). Emails the new jobs only if asked.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Sign in first" }, 401);
  const body = (await req.json().catch(() => ({}))) as { email?: boolean };
  const { data: s } = await auth.supabase.from("agent_settings").select("email, min_score").eq("user_id", auth.user.id).maybeSingle();
  try {
    const r = await runAgentForUser(auth.supabase, auth.user.id, {
      email: (s?.email as string) || auth.user.email || "",
      sendEmail: !!body.email,
      minScore: (s?.min_score as number) ?? 0,
    });
    return json(r);
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: /agent_jobs|agent_settings/.test(msg) ? "Run the migration supabase/migrations/20261116000000_job_agent.sql in Supabase first." : msg }, 500);
  }
}
