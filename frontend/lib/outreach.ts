"use client";

/** Client data layer for recruiter contacts and discovery settings (Supabase, RLS: each user sees only their rows). */
import { companyKey, type Contact, type ContactDraft } from "@internova/core";
import { normalizeSettings, type DiscoverySettings } from "./discoverTypes";
import { supabase } from "./supabase/client";

const MISSING_TABLE = /relation .* does not exist|Could not find the table|schema cache/i;
const friendly = (msg: string) =>
  MISSING_TABLE.test(msg) ? "Database not set up yet: run supabase/migrations/20261113000000_discovery_contacts.sql in the Supabase SQL Editor." : msg;

async function uid(): Promise<string> {
  const { data } = await supabase().auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

interface ContactRow {
  id: string; company: string; email: string; name: string; title: string; country: string; city: string; department: string;
  role_tags: string[]; source: string; linkedin: string; status: Contact["status"]; outreach: Contact["outreach"];
  last_contacted_at: string | null; follow_up_on: string | null; notes: string;
}

const fromRow = (r: ContactRow): Contact => ({
  id: r.id, company: r.company, email: r.email, name: r.name, title: r.title, country: r.country, city: r.city,
  department: r.department, roleTags: r.role_tags ?? [], source: r.source, linkedin: r.linkedin, status: r.status,
  outreach: r.outreach, lastContactedAt: r.last_contacted_at, followUpOn: r.follow_up_on ?? "", notes: r.notes,
});

export async function listContacts(): Promise<Contact[]> {
  const all: Contact[] = [];
  // Page through (PostgREST returns at most 1000 rows per request by default)
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase().from("contacts").select("*").order("company").range(from, from + 999);
    if (error) throw new Error(friendly(error.message));
    all.push(...(data as ContactRow[]).map(fromRow));
    if (!data || data.length < 1000) break;
  }
  return all;
}

/**
 * Insert contacts in batches. Emails already in your list are updated with any non-empty new fields
 * (your outreach status, notes and verification are kept).
 */
export async function importContacts(drafts: ContactDraft[], onProgress?: (done: number) => void): Promise<number> {
  const user_id = await uid();
  let done = 0;
  for (let i = 0; i < drafts.length; i += 500) {
    const batch = drafts.slice(i, i + 500).map((d) => ({
      user_id, company: d.company, company_key: companyKey(d.company), email: d.email.toLowerCase(), name: d.name, title: d.title,
      country: d.country, city: d.city, department: d.department, role_tags: d.roleTags, source: d.source, linkedin: d.linkedin,
      ...(d.notes ? { notes: d.notes } : {}), updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase().from("contacts").upsert(batch, { onConflict: "user_id,email" });
    if (error) throw new Error(friendly(error.message));
    done += batch.length;
    onProgress?.(done);
  }
  return done;
}

export async function updateContact(id: string, patch: Partial<Contact>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.company !== undefined) { row.company = patch.company; row.company_key = companyKey(patch.company); }
  const map: [keyof Contact, string][] = [
    ["email", "email"], ["name", "name"], ["title", "title"], ["country", "country"], ["city", "city"], ["department", "department"],
    ["roleTags", "role_tags"], ["source", "source"], ["linkedin", "linkedin"], ["status", "status"], ["outreach", "outreach"],
    ["lastContactedAt", "last_contacted_at"], ["notes", "notes"],
  ];
  for (const [k, col] of map) if (patch[k] !== undefined) row[col] = patch[k];
  if (patch.followUpOn !== undefined) row.follow_up_on = patch.followUpOn || null;
  const { error } = await supabase().from("contacts").update(row).eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

export async function deleteContacts(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase().from("contacts").delete().in("id", ids.slice(i, i + 200));
    if (error) throw new Error(friendly(error.message));
  }
}

/* ------------------------------ discovery settings ------------------------------ */

export async function loadDiscoverySettings(): Promise<DiscoverySettings> {
  const { data, error } = await supabase().from("discovery_settings").select("data").maybeSingle();
  if (error && !MISSING_TABLE.test(error.message)) throw new Error(error.message);
  return normalizeSettings(data?.data ?? {});
}

export async function saveDiscoverySettings(s: DiscoverySettings): Promise<void> {
  const user_id = await uid();
  const { error } = await supabase().from("discovery_settings").upsert({ user_id, data: s, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(friendly(error.message));
}
