import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MAX_RANKED, normalizeProfile, profileToContext, rankJobsWithAI, type Contact, type StoredResume } from "@internova/core";
import { serverAI } from "@/lib/ai";
import { digestEmail } from "@/lib/digest";
import { activeSources, normalizeSettings, type RankedJob } from "@/lib/discoverTypes";
import { mailConfigured, sendMail, siteUrl } from "@/lib/mail";
import { scanJobs } from "@/lib/scanJobs";

/** Most jobs kept per run, and most listed in one email. */
const MAX_KEEP = 150;
const MAX_EMAIL = 25;

export interface AgentRunResult {
  at: string;
  scanned: number;
  matched: number;
  newJobs: number;
  emailed: number;
  emailError: string | null;
  boardErrors: number;
}

/** Admin client for the scheduled run (bypasses row-level security, so every query below filters by user_id). */
export function serviceClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * One user's run: scan their Discover boards, keep jobs not seen before, email the new ones (if on).
 * Works with either the admin client (cron) or the user's own client (Run now); both filter by user_id.
 */
export async function runAgentForUser(db: SupabaseClient, userId: string, opts: { email: string; sendEmail: boolean; minScore: number }): Promise<AgentRunResult> {
  const [{ data: settingsRow }, { data: prof }, { data: res }, { data: contactRows }] = await Promise.all([
    db.from("discovery_settings").select("data").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("data").eq("user_id", userId).maybeSingle(),
    db.from("resumes").select("data").eq("user_id", userId).is("deleted_at", null),
    db.from("contacts").select("company, email, status, department, title").eq("user_id", userId).limit(20000),
  ]);
  const settings = normalizeSettings(settingsRow?.data ?? {});
  const resumes = ((res ?? []) as { data: StoredResume }[]).map((r) => r.data).filter(Boolean).sort((a, b) => b.addedAt - a.addedAt);
  const at = new Date().toISOString();
  if (!activeSources(settings).length && !settings.pages.length) {
    return { at, scanned: 0, matched: 0, newJobs: 0, emailed: 0, emailError: "No boards selected in Discover.", boardErrors: 0 };
  }

  const profile = normalizeProfile(prof?.data ?? {});
  const out = await scanJobs({ settings, profile, resumes, contacts: (contactRows ?? []) as Contact[], timeoutMs: 45_000 });
  const keep = out.jobs.slice(0, MAX_KEEP);

  // Insert only jobs never seen before; the response lists exactly the new rows
  let fresh: RankedJob[] = [];
  if (keep.length) {
    const rows = keep.map((j) => ({ user_id: userId, job_key: j.id, data: { ...j, text: j.text.slice(0, 3000) }, score: j.score }));
    const { data: inserted, error } = await db.from("agent_jobs").upsert(rows, { onConflict: "user_id,job_key", ignoreDuplicates: true }).select("job_key");
    if (error) throw new Error(error.message);
    const ids = new Set((inserted ?? []).map((r) => r.job_key as string));
    fresh = keep.filter((j) => ids.has(j.id));
  }

  // AI fit for the new jobs the rules kept (one call, JobPilot's own keys): the email trusts it over the rule score
  const open = fresh.filter((j) => !j.flags.some((f) => f.severity === "blocker"));
  const toRank = [...open].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, MAX_RANKED);
  const ai = serverAI();
  if (ai && toRank.length) {
    try {
      const candidate = profileToContext(profile, resumes[0]?.text ?? "");
      const ranks = await rankJobsWithAI(ai, candidate, toRank, { timeoutMs: 60_000 });
      for (const j of toRank) {
        const r = ranks[j.id];
        if (!r) continue;
        j.aiScore = r.score;
        j.aiReason = r.reason;
        await db.from("agent_jobs").update({ score: r.score, data: { ...j, text: j.text.slice(0, 3000) } }).eq("user_id", userId).eq("job_key", j.id);
      }
    } catch { /* AI unavailable: the rule scores decide, as before */ }
  }

  // Email: new jobs without a hard blocker, at or above the score you chose. An AI score, when there is one, decides
  // (and anything it scores under 40 is not a fit); AI-scored jobs come first, best first
  const AI_FLOOR = 40;
  const fit = (j: RankedJob) => (j.aiScore != null ? j.aiScore >= Math.max(opts.minScore, AI_FLOOR) : (j.score ?? 0) >= opts.minScore);
  const worth = open.filter(fit).sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1) || (b.score ?? -1) - (a.score ?? -1));
  let emailed = 0;
  let emailError: string | null = null;
  if (opts.sendEmail && worth.length) {
    if (!mailConfigured()) emailError = "Email isn't set up on the server yet.";
    else if (!opts.email) emailError = "No email address.";
    else {
      try {
        const list = worth.slice(0, MAX_EMAIL);
        await sendMail({ to: opts.email, ...digestEmail(list, siteUrl(), worth.length) });
        emailed = list.length;
        await db.from("agent_jobs").update({ emailed_at: at }).eq("user_id", userId).in("job_key", list.map((j) => j.id));
      } catch (e) {
        emailError = (e as Error).message;
      }
    }
  }

  // Housekeeping: forget dismissed / untouched jobs after 60 days
  const cutoff = new Date(Date.now() - 60 * 86400e3).toISOString();
  await db.from("agent_jobs").delete().eq("user_id", userId).in("status", ["new", "dismissed"]).lt("first_seen_at", cutoff);

  const result: AgentRunResult = { at, scanned: out.scanned, matched: out.matched, newJobs: fresh.length, emailed, emailError, boardErrors: out.boards.filter((b) => b.error).length };
  await db.from("agent_settings").update({ last_run_at: at, last_result: result }).eq("user_id", userId);
  return result;
}
