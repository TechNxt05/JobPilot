"use client";

/**
 * "Find jobs everywhere": runs every job source at once and remembers the last scan in this browser.
 *  - Company boards: /api/jobs/discover (Greenhouse, Lever, Ashby, … ranked against your resumes; no AI quota)
 *  - Web search: the Python backend's /jobs/search (may take ~1 min when the server is waking up)
 * Hiring posts (LinkedIn etc.) can't be fetched automatically; they're pasted on Outreach → Reply to a post.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import { loadProfile } from "./data";
import type { DiscoverResponse, RankedJob } from "./discoverTypes";
import { loadDiscoverySettings } from "./outreach";

export interface SearchJob {
  role: string;
  company: string;
  location: string;
  type?: string;
  stipend?: string;
  description?: string;
  skills_required?: string[];
  apply_link: string;
}

export type SourceState = { status: "idle" | "running" | "done" | "error"; count?: number; error?: string };

export interface Scan {
  at: number;
  boards: { jobs: RankedJob[]; matched: number; scanned: number; companies: number } | null;
  search: { jobs: SearchJob[]; query: string } | null;
}

const KEY = "jobpilot:last-scan";

function readScan(): Scan | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Scan) : null;
  } catch {
    return null;
  }
}

function writeScan(s: Scan) {
  try {
    // Keep it small: top 60 board jobs with shortened descriptions
    const slim: Scan = { ...s, boards: s.boards && { ...s.boards, jobs: s.boards.jobs.slice(0, 60).map((j) => ({ ...j, text: j.text.slice(0, 1500) })) } };
    localStorage.setItem(KEY, JSON.stringify(slim));
  } catch { /* storage full or blocked: the scan still shows for this visit */ }
}

export function useFindJobs() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [boards, setBoards] = useState<SourceState>({ status: "idle" });
  const [search, setSearch] = useState<SourceState>({ status: "idle" });

  useEffect(() => {
    Promise.resolve().then(() => setScan(readScan()));
  }, []);

  const run = useCallback(async () => {
    setBoards({ status: "running" });
    setSearch({ status: "running" });
    const next: Scan = { at: Date.now(), boards: null, search: null };

    const boardsTask = fetch("/api/jobs/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
        const d = body as DiscoverResponse;
        next.boards = { jobs: d.jobs, matched: d.matched, scanned: d.scanned, companies: d.boards.filter((b) => !b.error).length };
        setBoards({ status: "done", count: d.matched });
        setScan({ ...next });
      })
      .catch((e) => setBoards({ status: "error", error: (e as Error).message }));

    const searchTask = (async () => {
      const [settings, profile] = await Promise.all([loadDiscoverySettings().catch(() => null), loadProfile().catch(() => null)]);
      const role = profile?.headline?.trim() || "software engineer";
      const location = settings?.filters.locations[0] || profile?.city || "India";
      const r = await apiFetch("/jobs/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, location }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail ?? body.error ?? `Search server error (${r.status})`);
      next.search = { jobs: (body.jobs ?? []) as SearchJob[], query: `${role} · ${location}` };
      setSearch({ status: "done", count: next.search.jobs.length });
      setScan({ ...next });
    })().catch((e) => setSearch({ status: "error", error: (e as Error).message === "Failed to fetch" ? "Search server unreachable" : (e as Error).message }));

    await Promise.allSettled([boardsTask, searchTask]);
    // Keep whatever succeeded; fall back to the previous scan for a source that failed
    const prev = readScan();
    const merged: Scan = { at: next.at, boards: next.boards ?? prev?.boards ?? null, search: next.search ?? prev?.search ?? null };
    writeScan(merged);
    setScan(merged);
  }, []);

  const running = boards.status === "running" || search.status === "running";
  return { scan, boards, search, run, running };
}
