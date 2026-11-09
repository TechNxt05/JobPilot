import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { normalizeProfile, syncAll, type CollectionName, type RemoteRow, type SyncAdapter, type SyncRecord, type SyncReport } from "@internova/core";
import { getTombstones, type TombstoneCollection } from "./storage";

/**
 * Optional cloud sync via Supabase. The URL and publishable (anon) key are baked in at build time
 * (see build.mjs / README). They're safe to ship: Row Level Security limits every row to its owner.
 * Synced: profile, resumes (text), saved answers, tracked applications. Never synced: AI keys or settings.
 */
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export const cloudConfigured = !!(__SUPABASE_URL__ && __SUPABASE_ANON_KEY__);

const TABLE: Record<CollectionName, string> = { profile: "profiles", resumes: "resumes", answers: "answers", applications: "applications" };

// Auth session lives in chrome.storage.local so it survives panel reloads.
const chromeStorage = {
  getItem: async (k: string) => ((await chrome.storage.local.get(k))[k] as string | undefined) ?? null,
  setItem: async (k: string, v: string) => chrome.storage.local.set({ [k]: v }),
  removeItem: async (k: string) => chrome.storage.local.remove(k),
};

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!cloudConfigured) throw new Error("Cloud sync isn't configured in this build.");
  client ??= createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__, {
    auth: { storage: chromeStorage, storageKey: "internova-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export async function currentUser(): Promise<User | null> {
  if (!cloudConfigured) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.user ?? null;
}

/** Email one-time code: no redirects, so it works inside an extension. Creates the account on first use. */
export async function sendCode(email: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

export async function verifyCode(email: string, token: string): Promise<User> {
  const { data, error } = await supabase().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email" });
  if (error || !data.user) throw new Error(error?.message ?? "Invalid code");
  return data.user;
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
  await chrome.storage.local.remove("lastSync");
}

/* ---------------------------- adapter ---------------------------- */

async function readLocal(c: CollectionName) {
  if (c === "profile") {
    const { profile } = await chrome.storage.local.get("profile");
    if (!profile) return { records: [], tombstones: {} };
    const p = normalizeProfile(profile);
    return { records: [{ ...p, id: "me", updatedAt: p.updatedAt || 1 } as SyncRecord], tombstones: {} };
  }
  const items = ((await chrome.storage.local.get(c))[c] ?? []) as (SyncRecord & { addedAt?: number })[];
  return {
    records: items.map((r) => ({ ...r, updatedAt: r.updatedAt ?? r.addedAt ?? 1 })),
    tombstones: await getTombstones(c as TombstoneCollection),
  };
}

/**
 * Fingerprints of what sync itself last wrote, per storage key. Auto-sync ignores change events whose
 * new value matches, so sync never re-triggers itself, while any user edit (even mid-sync) still does.
 */
const written = new Map<string, string>();
const fingerprint = (v: unknown) => JSON.stringify(v ?? null);

async function setFromSync(values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) written.set(k, fingerprint(v));
  await chrome.storage.local.set(values);
}

async function writeLocal(c: CollectionName, records: SyncRecord[], tombstones: Record<string, number>) {
  if (c === "profile") {
    if (records[0]) {
      const { id: _id, ...profile } = records[0] as SyncRecord & Record<string, unknown>;
      await setFromSync({ profile });
    }
    return;
  }
  const sorted = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
  const { tombstones: all } = await chrome.storage.local.get("tombstones");
  await setFromSync({
    [c]: c === "resumes" ? sorted.reverse() : sorted,
    tombstones: { ...(all ?? {}), [c as TombstoneCollection]: tombstones },
  });
}

function adapter(userId: string): SyncAdapter {
  const db = supabase();
  const conflict = (c: CollectionName) => (c === "profile" ? "user_id" : "user_id,id");
  return {
    readLocal,
    writeLocal,
    async fetchRemote(c) {
      const { data, error } = await db.from(TABLE[c]).select("id, data, updated_at, deleted_at");
      if (error) throw new Error(`${TABLE[c]}: ${error.message}`);
      return (data ?? []).map((r): RemoteRow<SyncRecord> => ({
        id: r.id, updatedAt: Number(r.updated_at), deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
        data: r.deleted_at ? null : (r.data as SyncRecord),
      }));
    },
    async upsertRemote(c, records) {
      const rows = records.map((r) => ({ user_id: userId, id: r.id, data: r, updated_at: r.updatedAt, deleted_at: null }));
      const { error } = await db.from(TABLE[c]).upsert(rows, { onConflict: conflict(c) });
      if (error) throw new Error(`${TABLE[c]}: ${error.message}`);
    },
    async deleteRemote(c, dels) {
      // Soft delete: keeps a tombstone row so other devices learn about the deletion
      const rows = dels.map((d) => ({ user_id: userId, id: d.id, data: null, updated_at: d.deletedAt, deleted_at: d.deletedAt }));
      const { error } = await db.from(TABLE[c]).upsert(rows, { onConflict: conflict(c) });
      if (error) throw new Error(`${TABLE[c]}: ${error.message}`);
    },
  };
}

let running: Promise<SyncReport> | null = null;

export async function syncNow(): Promise<SyncReport> {
  if (running) return running;
  running = (async () => {
    const user = await currentUser();
    if (!user) throw new Error("Sign in to sync");
    const report = await syncAll(adapter(user.id));
    await chrome.storage.local.set({ lastSync: { at: Date.now(), ...report } });
    return report;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

const SYNCED_KEYS = ["profile", "resumes", "answers", "applications", "tombstones"];
let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced auto-sync after local edits, while signed in. Returns an unsubscribe function. */
export function startAutoSync(onDone?: (r: SyncReport | Error) => void): () => void {
  if (!cloudConfigured) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local") return;
    const userChange = Object.entries(changes).some(
      ([k, ch]) => SYNCED_KEYS.includes(k) && fingerprint(ch.newValue) !== written.get(k),
    );
    if (!userChange) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const { autoSync } = await chrome.storage.local.get("autoSync");
      if (autoSync === false || !(await currentUser())) return;
      // An edit made during a running sync needs its own pass afterwards
      if (running) await running.catch(() => {});
      syncNow().then(onDone, (e: Error) => onDone?.(e));
    }, 3000);
  };
  chrome.storage.onChanged.addListener(listener);
  // Pull on open
  currentUser().then((u) => u && syncNow().then(onDone, (e: Error) => onDone?.(e)));
  return () => chrome.storage.onChanged.removeListener(listener);
}
