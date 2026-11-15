"use client";

import type { RankedJob } from "./discoverTypes";
import { supabase } from "./supabase/client";

export type AgentJobStatus = "new" | "opened" | "applied" | "dismissed";
export interface AgentJob { key: string; job: RankedJob; score: number | null; status: AgentJobStatus; firstSeenAt: string; emailedAt: string | null }
export interface AgentSettings {
  enabled: boolean;
  email: string;
  minScore: number;
  lastRunAt: string | null;
  lastResult: { newJobs: number; emailed: number; scanned: number; matched: number; emailError: string | null; boardErrors: number } | null;
}

const MISSING = /agent_(jobs|settings)|schema cache|does not exist/i;
const migrationHint = () => new Error("Run supabase/migrations/20261116000000_job_agent.sql in Supabase first (SQL Editor).");

async function uid(): Promise<string> {
  const { data } = await supabase().auth.getUser();
  if (!data.user) throw new Error("Sign in first.");
  return data.user.id;
}

export async function loadAgentSettings(): Promise<AgentSettings> {
  const { data, error } = await supabase().from("agent_settings").select("enabled, email, min_score, last_run_at, last_result").maybeSingle();
  if (error) throw MISSING.test(error.message) ? migrationHint() : new Error(error.message);
  return { enabled: !!data?.enabled, email: data?.email ?? "", minScore: data?.min_score ?? 0, lastRunAt: data?.last_run_at ?? null, lastResult: data?.last_result ?? null };
}

export async function saveAgentSettings(s: Pick<AgentSettings, "enabled" | "email" | "minScore">): Promise<void> {
  const { error } = await supabase().from("agent_settings").upsert(
    { user_id: await uid(), enabled: s.enabled, email: s.email.trim(), min_score: s.minScore, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw MISSING.test(error.message) ? migrationHint() : new Error(error.message);
}

export async function listAgentJobs(): Promise<AgentJob[]> {
  const { data, error } = await supabase().from("agent_jobs")
    .select("job_key, data, score, status, first_seen_at, emailed_at")
    .order("first_seen_at", { ascending: false }).order("score", { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw MISSING.test(error.message) ? migrationHint() : new Error(error.message);
  return (data ?? []).map((r) => ({ key: r.job_key, job: r.data as RankedJob, score: r.score, status: r.status as AgentJobStatus, firstSeenAt: r.first_seen_at, emailedAt: r.emailed_at }));
}

export async function setAgentJobStatus(key: string, status: AgentJobStatus): Promise<void> {
  const { error } = await supabase().from("agent_jobs").update({ status, updated_at: new Date().toISOString() }).eq("job_key", key);
  if (error) throw new Error(error.message);
}
