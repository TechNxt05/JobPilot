import "server-only";
import { normalizeProfile, type CandidateProfile, type StoredResume } from "@internova/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The signed-in user's profile and resumes (newest first), read with their session so RLS applies. */
export async function loadUserData(supabase: SupabaseClient): Promise<{ profile: CandidateProfile; resumes: StoredResume[] }> {
  const [{ data: prof }, { data: res }] = await Promise.all([
    supabase.from("profiles").select("data").maybeSingle(),
    supabase.from("resumes").select("data").is("deleted_at", null),
  ]);
  return {
    profile: normalizeProfile(prof?.data ?? {}),
    resumes: ((res ?? []) as { data: StoredResume }[]).map((r) => r.data).filter(Boolean).sort((a, b) => b.addedAt - a.addedAt),
  };
}

/** Basic input guard for user-pasted text fields. */
export function clampText(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}
