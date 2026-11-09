"use client";

/**
 * Web data layer over Supabase. Rows use exactly the same shape as the Chrome extension's sync
 * (`data` = the full record incl. id + updatedAt, `updated_at` ms, soft deletes via `deleted_at`),
 * so the web app and the extension share one profile, resume list and tracker.
 */
import { normalizeProfile, type Application, type CandidateProfile, type StoredResume } from "@internova/core";
import { supabase } from "./supabase/client";

async function uid(): Promise<string> {
  const { data } = await supabase().auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/* ------------------------------ profile ------------------------------ */

export async function loadProfile(): Promise<CandidateProfile | null> {
  const rows = check(await supabase().from("profiles").select("data, deleted_at"));
  const row = (rows as { data: unknown; deleted_at: number | null }[])[0];
  return row?.data && !row.deleted_at ? normalizeProfile(row.data) : null;
}

export async function saveProfile(profile: CandidateProfile): Promise<CandidateProfile> {
  const user_id = await uid();
  const saved = { ...profile, updatedAt: Date.now() };
  check(await supabase().from("profiles").upsert(
    { user_id, id: "me", data: { ...saved, id: "me" }, updated_at: saved.updatedAt, deleted_at: null },
    { onConflict: "user_id" },
  ));
  return saved;
}

/* ------------------------------ resumes ------------------------------ */

export async function listResumes(): Promise<StoredResume[]> {
  const rows = check(await supabase().from("resumes").select("data").is("deleted_at", null)) as { data: StoredResume }[];
  return rows.map((r) => r.data).filter(Boolean).sort((a, b) => a.addedAt - b.addedAt);
}

/** Store the extracted text (what syncs) and, when given, the original PDF in the private bucket. */
export async function saveResume(resume: StoredResume, pdf?: File): Promise<StoredResume> {
  const user_id = await uid();
  const saved = { ...resume, updatedAt: Date.now() };
  check(await supabase().from("resumes").upsert(
    { user_id, id: saved.id, data: saved, updated_at: saved.updatedAt, deleted_at: null },
    { onConflict: "user_id,id" },
  ));
  if (pdf) {
    // Best effort: the text is what matters; a storage hiccup shouldn't lose the resume
    await supabase().storage.from("resumes").upload(`${user_id}/${saved.id}.pdf`, pdf, { upsert: true, contentType: "application/pdf" }).catch(() => {});
  }
  return saved;
}

export async function deleteResume(id: string): Promise<void> {
  const user_id = await uid();
  const now = Date.now();
  check(await supabase().from("resumes").upsert({ user_id, id, data: null, updated_at: now, deleted_at: now }, { onConflict: "user_id,id" }));
  await supabase().storage.from("resumes").remove([`${user_id}/${id}.pdf`]).catch(() => {});
}

/** Most recently added resume's text, for matching and scoring. */
export async function latestResumeText(): Promise<string> {
  const all = await listResumes();
  return all[all.length - 1]?.text ?? "";
}

/* ------------------------------ applications ------------------------------ */

export async function listApplications(): Promise<Application[]> {
  const rows = check(await supabase().from("applications").select("data").is("deleted_at", null)) as { data: Application }[];
  return rows.map((r) => r.data).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveApplication(app: Application): Promise<Application> {
  const user_id = await uid();
  const saved = { ...app, updatedAt: Date.now() };
  check(await supabase().from("applications").upsert(
    { user_id, id: saved.id, data: saved, updated_at: saved.updatedAt, deleted_at: null },
    { onConflict: "user_id,id" },
  ));
  return saved;
}

export async function deleteApplication(id: string): Promise<void> {
  const user_id = await uid();
  const now = Date.now();
  check(await supabase().from("applications").upsert({ user_id, id, data: null, updated_at: now, deleted_at: now }, { onConflict: "user_id,id" }));
}
