"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Check, FileText, Loader2, Mail, Plus, Search } from "lucide-react";
import { jobKey, newApplication, type Application, type Contact } from "@internova/core";
import { Band, BandEmpty, Ladder, MatchRamp, Pnr } from "@/components/chart";
import { Button, cn } from "@/components/ui";
import { listApplications, loadProfile, saveApplication } from "@/lib/data";
import type { RankedJob } from "@/lib/discoverTypes";
import { useFindJobs, type SourceState } from "@/lib/findJobs";
import { OUTREACH_JOB_KEY, UPGRADE_JOB_KEY } from "@/lib/handoff";
import { listContacts } from "@/lib/outreach";
import { previewApplications, previewContacts, previewScan, UI_PREVIEW } from "@/lib/preview";

const today = () => new Date().toISOString().slice(0, 10);
const ageOf = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null);
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default function TodayPage() {
  const router = useRouter();
  const live = useFindJobs();
  const scan = UI_PREVIEW ? previewScan : live.scan;
  // Preview fixtures are a build-time constant, so they are safe as initial state
  const [apps, setApps] = useState<Application[] | null>(UI_PREVIEW ? previewApplications : null);
  const [contacts, setContacts] = useState<Contact[]>(UI_PREVIEW ? previewContacts : []);
  const [name, setName] = useState(UI_PREVIEW ? "Amritanshu" : "");
  const [quota, setQuota] = useState<{ remaining: number; limit: number } | null>(UI_PREVIEW ? { remaining: 14, limit: 20 } : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (UI_PREVIEW) return;
    listApplications().then(setApps).catch((e) => { setError(e.message); setApps([]); });
    listContacts().then(setContacts).catch(() => {});
    loadProfile().then((p) => setName(p?.firstName ?? "")).catch(() => {});
    fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "quota" }) })
      .then((r) => r.json()).then((q) => typeof q?.remaining === "number" && setQuota(q)).catch(() => {});
    // The header's "Find jobs" lands here with ?find=1
    if (new URLSearchParams(window.location.search).get("find") === "1") {
      router.replace("/");
      live.run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tracked = useMemo(() => new Set((apps ?? []).map((a) => jobKey(a.url))), [apps]);
  const t = today();
  const followUps = useMemo(() => [
    ...(apps ?? []).filter((a) => a.followUpOn && a.followUpOn <= t && !["offer", "rejected", "withdrawn"].includes(a.status))
      .map((a) => ({ id: a.id, who: a.company || a.title, what: a.title, on: a.followUpOn, href: "/applications" })),
    ...contacts.filter((c) => c.outreach === "sent" && c.followUpOn && c.followUpOn <= t)
      .map((c) => ({ id: c.id, who: c.name || c.email, what: `Recruiter · ${c.company}`, on: c.followUpOn, href: `/outreach?company=${encodeURIComponent(c.company)}` })),
  ].sort((a, b) => a.on.localeCompare(b.on)), [apps, contacts, t]);

  const newJobs = (scan?.boards?.jobs ?? []).filter((j) => !j.flags.some((f) => f.severity === "blocker"));
  const blocked = (scan?.boards?.jobs ?? []).length - newJobs.length;
  const freshCount = newJobs.filter((j) => (ageOf(j.postedAt) ?? 99) <= 2).length;
  const active = (apps ?? []).filter((a) => ["applied", "interviewing", "offer"].includes(a.status)).sort((a, b) => b.updatedAt - a.updatedAt);
  const counts = (s: Application["status"][]) => (apps ?? []).filter((a) => s.includes(a.status)).length;

  async function track(j: RankedJob) {
    if (UI_PREVIEW) return;
    try {
      const saved = await saveApplication(newApplication({ title: j.title, company: j.company, url: j.url, location: j.location, score: j.score, resumeName: j.resumeName ?? "", deadline: j.deadline ?? "" }));
      setApps((a) => [saved, ...(a ?? [])]);
    } catch (e) { setError((e as Error).message); }
  }
  function handoff(key: string, j: RankedJob, to: string) {
    try { sessionStorage.setItem(key, JSON.stringify(key === UPGRADE_JOB_KEY ? { company: j.company, role: j.title, text: j.text, url: j.applyUrl, ats: j.ats } : { title: j.title, company: j.company, url: j.url, text: j.text })); } catch { /* storage blocked */ }
    router.push(to);
  }

  const date = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const summary = [
    scan?.boards ? `${scan.boards.matched} matching roles on the boards${freshCount ? `, ${freshCount} posted in the last 2 days` : ""}` : "No scan yet",
    `${followUps.length} follow-up${followUps.length === 1 ? "" : "s"} due`,
    quota ? `${quota.remaining} of ${quota.limit} AI actions left` : null,
  ].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      {UI_PREVIEW && <p className="note-warn mb-4 rounded-[3px] px-3 py-2 text-sm">Local UI preview: every company, person and number on this page is synthetic.</p>}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[40px] md:text-[48px]">Chart for {date}</h1>
          <p className="mt-2 max-w-[80ch] text-muted-foreground">{name ? `${name}, here's your search. ` : ""}{summary}.</p>
        </div>
        <FindPanel live={live} at={scan?.at ?? null} scan={scan} />
      </div>
      {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}

      <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Band title="New matches" meta={scan?.boards ? `${newJobs.length} shown · ${scan.boards.scanned.toLocaleString("en-IN")} roles scanned at ${scan.boards.companies} companies` : undefined}
            actions={scan?.boards ? <Link href="/discover" className="text-sm text-primary hover:underline">All results</Link> : null}>
            {!scan?.boards ? (
              <BandEmpty>No scan yet. <strong className="text-foreground">Find jobs everywhere</strong> checks 31 company job boards and the web search, then ranks every role against your resume.</BandEmpty>
            ) : newJobs.length === 0 ? (
              <BandEmpty>Nothing matched your filters. Widen keywords or locations on <Link className="text-primary underline" href="/discover">Discover</Link>.</BandEmpty>
            ) : (
              <ul>
                <ColumnHeads cols={["PNR · Match", "Role · Company", "Status · Action"]} />
                {newJobs.slice(0, 8).map((j) => <MatchRow key={j.id} job={j} tracked={tracked.has(jobKey(j.url))} onTrack={() => track(j)}
                  onTailor={() => handoff(UPGRADE_JOB_KEY, j, "/resume-upgrade")} onEmail={() => handoff(OUTREACH_JOB_KEY, j, `/outreach?company=${encodeURIComponent(j.company)}`)} />)}
              </ul>
            )}
            {blocked > 0 && <p className="border-t border-dotted border-border px-4 py-2 text-xs text-muted-foreground">{blocked} more hidden: they need experience, eligibility or work authorization you don&apos;t have yet.</p>}
          </Band>

          <Band title="In progress" meta={`${active.length}`} actions={<Link href="/applications" className="text-sm text-primary hover:underline">Tracker</Link>}>
            {apps === null ? <BandEmpty><Loader2 className="inline animate-spin" size={14} /> Loading…</BandEmpty>
              : active.length === 0 ? <BandEmpty>Nothing applied yet. Save a match above, apply on the company site, then mark it Applied in the tracker.</BandEmpty>
              : <ul><ColumnHeads cols={["PNR", "Role · Company", "Status"]} />{active.slice(0, 6).map((a) => (
                <li key={a.id} className="band-row grid grid-cols-1 items-center gap-2 px-4 py-3 md:grid-cols-[120px_minmax(0,1fr)_auto]">
                  <Pnr id={a.id} />
                  <div className="min-w-0"><div className="truncate font-semibold">{a.title}</div><div className="truncate text-[13px] text-muted-foreground">{[a.company, a.appliedAt && `applied ${new Date(a.appliedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`].filter(Boolean).join(" · ")}</div></div>
                  <Ladder status={a.status} />
                </li>))}</ul>}
          </Band>

          {scan?.search && scan.search.jobs.length > 0 && (
            <Band title="From web search" meta={scan.search.query}>
              <ul>{scan.search.jobs.slice(0, 6).map((s, i) => (
                <li key={i} className="band-row flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0"><div className="truncate font-medium">{s.role}</div><div className="truncate text-[13px] text-muted-foreground">{[s.company, s.location].filter(Boolean).join(" · ")}</div></div>
                  {s.apply_link && <a href={s.apply_link} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline">Open <ArrowUpRight size={14} aria-hidden /></a>}
                </li>))}</ul>
            </Band>
          )}
        </div>

        <aside className="space-y-6">
          <Band title="Follow-ups due" meta={followUps.length ? String(followUps.length) : undefined}>
            {followUps.length === 0 ? <BandEmpty>Nothing due today.</BandEmpty> : (
              <ul>{followUps.slice(0, 6).map((f) => (
                <li key={f.id} className="band-row px-4 py-2.5">
                  <Link href={f.href} className="flex items-baseline justify-between gap-3 hover:text-primary">
                    <span className="min-w-0"><span className="block truncate font-medium">{f.who}</span><span className="block truncate text-[13px] text-muted-foreground">{f.what}</span></span>
                    <span className={cn("fig shrink-0", f.on < t ? "text-destructive" : "text-warn")}>{f.on < t ? `${Math.round((Date.parse(t) - Date.parse(f.on)) / 86_400_000)}d late` : "today"}</span>
                  </Link>
                </li>))}</ul>
            )}
          </Band>

          <Band title="Journey" meta={apps ? `${apps.length} tracked` : undefined}>
            <dl className="grid grid-cols-5 divide-x divide-border text-center">
              {([["Saved", ["saved"]], ["Applied", ["applied"]], ["Interview", ["interviewing"]], ["Offer", ["offer"]], ["Closed", ["rejected", "withdrawn"]]] as const).map(([label, s]) => (
                <div key={label} className="px-1 py-3"><dt className="label text-[10.5px]">{label}</dt><dd className="mt-1 font-narrow text-[28px] font-bold leading-none">{apps ? counts([...s]) : "–"}</dd></div>
              ))}
            </dl>
          </Band>

          <Band title="AI actions" meta={quota ? `${quota.remaining} / ${quota.limit} left` : undefined}>
            <div className="px-4 py-3">
              {quota ? (
                <>
                  <div className="flex gap-[3px]" aria-hidden>{Array.from({ length: quota.limit }, (_, i) => <i key={i} className={cn("block h-3 flex-1 border", i < quota.remaining ? "border-primary bg-primary" : "border-input")} />)}</div>
                  <p className="mt-2 text-[13px] text-muted-foreground">Cover letters, tailoring, cold emails and post replies use one each. Matching and ATS checks are free. Resets at 05:30 IST.</p>
                </>
              ) : <p className="text-[13px] text-muted-foreground">Quota unavailable. Run the AI quota migration in Supabase.</p>}
            </div>
          </Band>

          <Band title="Prepare">
            <ul className="text-sm">
              {[["/outreach/post", "Reply to a LinkedIn hiring post"], ["/resume-upgrade", "Tailor your resume to a job"], ["/cover-letter", "Write a cover letter"], ["/resume-score", "Check your resume"]].map(([href, label]) => (
                <li key={href} className="band-row"><Link href={href} className="flex items-center justify-between px-4 py-2.5 hover:bg-accent">{label} <ArrowUpRight size={14} aria-hidden className="text-muted-foreground" /></Link></li>
              ))}
            </ul>
          </Band>
        </aside>
      </div>
    </main>
  );
}

function FindPanel({ live, at, scan }: { live: ReturnType<typeof useFindJobs>; at: number | null; scan: ReturnType<typeof useFindJobs>["scan"] }) {
  return (
    <div className="flex flex-col gap-2 lg:items-end">
      <Button variant="cta" size="lg" onClick={live.run} disabled={live.running || UI_PREVIEW} className="text-[15px] uppercase tracking-[0.08em]">
        {live.running ? <Loader2 className="animate-spin" size={18} aria-hidden /> : <Search size={18} aria-hidden />}
        {live.running ? "Searching every source…" : "Find jobs everywhere"}
      </Button>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground lg:justify-end" aria-live="polite">
        <Source label="Company boards" s={live.boards} last={scan?.boards ? scan.boards.matched : null} />
        <Source label="Web search" s={live.search} last={scan?.search ? scan.search.jobs.length : null} />
        {at && !live.running && <span>Last scan {ago(at)}</span>}
      </div>
    </div>
  );
}

function Source({ label, s, last }: { label: string; s: SourceState; last: number | null }) {
  if (s.status === "idle") return <span>{label} · {last === null ? "not run" : last}</span>;
  return (
    <span className="inline-flex items-center gap-1.5" title={s.error}>
      {s.status === "running" ? <Loader2 size={12} className="animate-spin" aria-hidden /> : s.status === "done" ? <Check size={12} className="text-ok" aria-hidden /> : <AlertTriangle size={12} className="text-warn" aria-hidden />}
      {label}{s.status === "done" ? ` · ${s.count}` : s.status === "error" ? ` · ${s.error}` : ""}
    </span>
  );
}

function MatchRow({ job: j, tracked, onTrack, onTailor, onEmail }: { job: RankedJob; tracked: boolean; onTrack: () => void; onTailor: () => void; onEmail: () => void }) {
  const age = ageOf(j.postedAt);
  const caution = j.flags.filter((f) => f.severity === "caution");
  return (
    <li className="band-row grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[120px_minmax(0,1fr)_auto]">
      <div className="flex items-center gap-3 md:block md:space-y-1.5">
        <Pnr id={j.id} />
        <MatchRamp score={j.score} />
      </div>
      <div className="min-w-0">
        <a href={j.url} target="_blank" rel="noreferrer" className="font-semibold hover:text-primary hover:underline">{j.title}</a>
        <div className="truncate text-[13px] text-muted-foreground">
          {[j.company, j.location, age === null ? null : age === 0 ? "today" : `${age}d ago`].filter(Boolean).join(" · ")}
        </div>
        {caution.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{caution.map((f, i) => <span key={i} className="inline-flex items-center gap-1 text-[12.5px] text-warn"><AlertTriangle size={12} aria-hidden />{f.message}</span>)}</div>}
        {j.missingSkills.length > 0 && <div className="mt-1 text-[12.5px] text-muted-foreground">Missing: {j.missingSkills.slice(0, 4).join(", ")}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-end">
        <Ladder status={tracked ? "saved" : "new"} />
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={onTrack} disabled={tracked}>{tracked ? <><Check size={13} aria-hidden /> Saved</> : <><Plus size={13} aria-hidden /> Save</>}</Button>
          <Button size="sm" variant="outline" onClick={onTailor} title="Tailor your resume for this job's ATS"><FileText size={13} aria-hidden /> Tailor</Button>
          <Button size="sm" variant="outline" onClick={onEmail} title="Email a recruiter"><Mail size={13} aria-hidden /> {j.contacts ? `Email (${j.contacts})` : "Email"}</Button>
        </div>
      </div>
    </li>
  );
}


/** Column heads of a chart band, aligned with its rows (desktop only). */
function ColumnHeads({ cols }: { cols: string[] }) {
  return (
    <li aria-hidden className="hidden grid-cols-[120px_minmax(0,1fr)_auto] gap-x-4 border-b border-border bg-background/40 px-4 py-1.5 md:grid">
      {cols.map((c, i) => <span key={c} className={cn("label text-[10.5px]", i === cols.length - 1 && "text-right")}>{c}</span>)}
    </li>
  );
}
