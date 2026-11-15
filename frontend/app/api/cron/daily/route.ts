import { json } from "@/lib/ai";
import { runAgentForUser, serviceClient } from "@/lib/agent";

// Vercel runs this every morning (vercel.json). Up to 5 minutes; users are processed one after another.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BUDGET_MS = 270_000;

/**
 * GET (Vercel Cron) → runs the daily job agent for every user who turned it on.
 * Vercel sends "Authorization: Bearer $CRON_SECRET"; anything else is refused.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, 401);
  const db = serviceClient();
  if (!db) return json({ error: "SUPABASE_SERVICE_ROLE_KEY isn't set" }, 503);

  const started = Date.now();
  // Least recently run first, so if time runs out the skipped users go first tomorrow
  const { data: users, error } = await db.from("agent_settings").select("user_id, email, min_score, last_run_at").eq("enabled", true).order("last_run_at", { ascending: true, nullsFirst: true });
  if (error) return json({ error: error.message }, 500);

  const results: { ok: boolean; newJobs?: number; emailed?: number; error?: string }[] = [];
  for (const u of users ?? []) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      let email = (u.email as string) || "";
      if (!email) email = (await db.auth.admin.getUserById(u.user_id as string)).data.user?.email ?? "";
      const r = await runAgentForUser(db, u.user_id as string, { email, sendEmail: true, minScore: (u.min_score as number) ?? 0 });
      results.push({ ok: true, newJobs: r.newJobs, emailed: r.emailed, error: r.emailError ?? undefined });
    } catch (e) {
      results.push({ ok: false, error: (e as Error).message });
    }
  }
  // Counts only: no user ids or emails in the cron log
  return json({ users: users?.length ?? 0, processed: results.length, failed: results.filter((r) => !r.ok).length, newJobs: results.reduce((n, r) => n + (r.newJobs ?? 0), 0) });
}
