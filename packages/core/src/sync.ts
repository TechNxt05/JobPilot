/**
 * Local-first sync. Every synced record has an id and updatedAt (ms). Deletions are kept as
 * tombstones (id → deletedAt) locally and as deleted_at remotely, so they propagate too.
 * Conflict rule: the newer change wins (last-write-wins per record).
 *
 * Pure logic + a storage-agnostic orchestrator, so it is testable without Supabase or Chrome.
 */

export interface SyncRecord {
  id: string;
  updatedAt: number;
}

export interface RemoteRow<T> {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
  data: T | null;
}

export type Tombstones = Record<string, number>;

export interface MergeResult<T> {
  /** New local collection */
  local: T[];
  /** New local tombstones */
  tombstones: Tombstones;
  /** Records to write to the server */
  upserts: T[];
  /** Records to mark deleted on the server */
  deletes: { id: string; deletedAt: number }[];
}

export function mergeRecords<T extends SyncRecord>(local: T[], tombstones: Tombstones, remote: RemoteRow<T>[]): MergeResult<T> {
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const ids = new Set([...localById.keys(), ...Object.keys(tombstones), ...remoteById.keys()]);
  const out: MergeResult<T> = { local: [], tombstones: {}, upserts: [], deletes: [] };

  for (const id of ids) {
    const l = localById.get(id);
    const t = tombstones[id];
    const r = remoteById.get(id);
    const localDeleted = t !== undefined && t >= (l?.updatedAt ?? 0);
    const localTime = Math.max(l?.updatedAt ?? 0, t ?? 0);
    const remoteDeleted = !!r?.deletedAt || (r !== undefined && !r.data);
    const remoteTime = r ? Math.max(r.updatedAt, r.deletedAt ?? 0) : 0;

    if (!r) {
      if (localDeleted) out.tombstones[id] = t!; // never reached the server; keep until it does
      else if (l) { out.local.push(l); out.upserts.push(l); }
      continue;
    }
    if (!l && t === undefined) {
      if (!remoteDeleted) out.local.push(r.data!);
      continue;
    }
    if (localTime > remoteTime) {
      if (localDeleted) { out.tombstones[id] = t!; out.deletes.push({ id, deletedAt: t! }); }
      else { out.local.push(l!); out.upserts.push(l!); }
    } else if (remoteTime > localTime) {
      if (remoteDeleted) out.tombstones[id] = remoteTime;
      else out.local.push(r.data!);
    } else {
      // Same timestamp: already in sync
      if (localDeleted || remoteDeleted) out.tombstones[id] = remoteTime;
      else out.local.push(l ?? r.data!);
    }
  }
  return out;
}

/** Collections that sync. "profile" is a single record with id "me". */
export type CollectionName = "profile" | "resumes" | "answers" | "applications";
export const COLLECTIONS: CollectionName[] = ["profile", "resumes", "answers", "applications"];

export interface SyncAdapter {
  readLocal(c: CollectionName): Promise<{ records: SyncRecord[]; tombstones: Tombstones }>;
  writeLocal(c: CollectionName, records: SyncRecord[], tombstones: Tombstones): Promise<void>;
  fetchRemote(c: CollectionName): Promise<RemoteRow<SyncRecord>[]>;
  upsertRemote(c: CollectionName, records: SyncRecord[]): Promise<void>;
  deleteRemote(c: CollectionName, deletes: { id: string; deletedAt: number }[]): Promise<void>;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  deleted: number;
}

/** Two-way sync of every collection. Remote writes happen before local writes so a failure can be retried safely. */
export async function syncAll(adapter: SyncAdapter, collections: CollectionName[] = COLLECTIONS): Promise<SyncReport> {
  const report: SyncReport = { pulled: 0, pushed: 0, deleted: 0 };
  for (const c of collections) {
    const [{ records, tombstones }, remote] = await Promise.all([adapter.readLocal(c), adapter.fetchRemote(c)]);
    const merged = mergeRecords(records, tombstones, remote);
    if (merged.upserts.length) await adapter.upsertRemote(c, merged.upserts);
    if (merged.deletes.length) await adapter.deleteRemote(c, merged.deletes);
    // Tombstones the server now knows about can be dropped locally
    const remoteKnown = new Set([...remote.filter((r) => r.deletedAt).map((r) => r.id), ...merged.deletes.map((d) => d.id)]);
    const keptTombstones = Object.fromEntries(Object.entries(merged.tombstones).filter(([id]) => !remoteKnown.has(id)));
    const before = new Map(records.map((r) => [r.id, r.updatedAt]));
    report.pulled += merged.local.filter((r) => before.get(r.id) !== r.updatedAt).length;
    report.pushed += merged.upserts.length;
    report.deleted += merged.deletes.length;
    await adapter.writeLocal(c, merged.local, keptTombstones);
  }
  return report;
}

/* ------------------------------ Application tracker ------------------------------ */

export type ApplicationStatus = "saved" | "applied" | "interviewing" | "offer" | "rejected" | "withdrawn";

export const APPLICATION_STATUSES: { id: ApplicationStatus; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "applied", label: "Applied" },
  { id: "interviewing", label: "Interviewing" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" },
  { id: "withdrawn", label: "Withdrawn" },
];

export interface Application extends SyncRecord {
  title: string;
  company: string;
  location: string;
  url: string;
  status: ApplicationStatus;
  /** Alignment score when saved, if analyzed */
  score: number | null;
  resumeName: string;
  deadline: string;
  appliedAt: number | null;
  followUpOn: string;
  notes: string;
  createdAt: number;
}

/** Normalise a URL for "already tracked?" checks (drops tracking params and fragments). */
export function jobKey(url: string): string {
  try {
    const u = new URL(url);
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (/^(currentjobid|jk|gh_jid|jobid|id|job)$/i.test(k)) keep.set(k, v);
    const q = keep.toString();
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${q ? `?${q}` : ""}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function newApplication(fields: Partial<Application> & Pick<Application, "title" | "company" | "url">, now = Date.now()): Application {
  return {
    id: crypto.randomUUID(),
    location: "", status: "saved", score: null, resumeName: "", deadline: "", appliedAt: null, followUpOn: "", notes: "",
    ...fields,
    createdAt: now,
    updatedAt: now,
  };
}
