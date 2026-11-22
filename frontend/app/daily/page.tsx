"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, Check, ExternalLink, FileText, Loader2, Mail, RefreshCw, X } from "lucide-react";
import { ATS_LABELS, newApplication } from "@internova/core";
import { MatchRamp } from "@/components/chart";
import { Button, Card, Input } from "@/components/ui";
import { loadAgentSettings, listAgentJobs, saveAgentSettings, setAgentJobStatus, type AgentJob, type AgentJobStatus, type AgentSettings } from "@/lib/agentData";
import { saveApplication } from "@/lib/data";
import { UPGRADE_JOB_KEY } from "@/lib/handoff";

type Tab = "todo" | "applied" | "dismissed";
const TABS: { id: Tab; label: string; has: AgentJobStatus[] }[] = [
  { id: "todo", label: "To review", has: ["new", "opened"] },
  { id: "applied", label: "Applied", has: ["applied"] },
  { id: "dismissed", label: "Dismissed", has: ["dismissed"] },
];

export default function DailyJobsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [jobs, setJobs] = useState<AgentJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("todo");
  const [hideBlocked, setHideBlocked] = useState(true);
  const [day, setDay] = useState("all");

  async function reload() {
    try {
      const [s, j] = await Promise.all([loadAgentSettings(), listAgentJobs()]);
      setSettings(s); setJobs(j);
    } catch (e) {
      setError((e as Error).message); setJobs([]);
      setSettings((s) => s ?? { enabled: false, email: "", minScore: 0, lastRunAt: null, lastResult: null });
    }
  }
  useEffect(() => { reload(); }, []);

  async function run(email: boolean) {
    setRunning(true); setError(null); setNotice(null);
    try {
      const r = await fetch("/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error ?? `Failed (${r.status})`);
      setNotice(`Checked ${out.scanned} jobs: ${out.matched} match your filters, ${out.newJobs} new.${email ? (out.emailed ? ` Emailed ${out.emailed}.` : out.emailError ? ` Email not sent: ${out.emailError}` : " Nothing new to email.") : ""}`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function save(next: AgentSettings) {
    setSaving(true); setError(null);
    try { await saveAgentSettings(next); setSettings(next); setNotice(next.enabled ? "Saved. JobPilot will check every morning." : "Saved. Daily checks are off."); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function mark(a: AgentJob, status: AgentJobStatus) {
    setJobs((all) => all?.map((x) => (x.key === a.key ? { ...x, status } : x)) ?? null);
    try {
      await setAgentJobStatus(a.key, status);
      if (status === "applied") {
        const j = a.job;
        await saveApplication(newApplication({
          title: j.title, company: j.company, url: j.url, location: j.location, status: "applied", appliedAt: Date.now(),
          score: j.aiScore ?? j.score, resumeName: j.resumeName ?? "", deadline: j.deadline ?? "", notes: `Found by the daily check (${j.sourceLabel ?? ATS_LABELS[j.ats]}).`,
        }));
      }
    } catch (e) { setError((e as Error).message); }
  }

  function apply(a: AgentJob) {
    window.open(a.job.applyUrl || a.job.url, "_blank", "noopener");
    if (a.status === "new") mark(a, "opened");
  }

  function tailor(a: AgentJob) {
    const j = a.job;
    try { sessionStorage.setItem(UPGRADE_JOB_KEY, JSON.stringify({ company: j.company, role: j.title, text: j.text, url: j.applyUrl, ats: j.sourceLabel ? undefined : j.ats })); } catch { /* storage blocked */ }
    router.push("/resume-upgrade");
  }

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (jobs ?? []).filter((j) => t.has.includes(j.status)).length])) as Record<Tab, number>, [jobs]);
  const inTab = useMemo(() => (jobs ?? []).filter((j) => TABS.find((t) => t.id === tab)!.has.includes(j.status) && (!hideBlocked || tab !== "todo" || !j.job.flags.some((f) => f.severity === "blocker"))), [jobs, tab, hideBlocked]);
  // One group per day: the day of the email the job was in, else the day it was found. Newest day first, best job first
  const groups = useMemo(() => {
    const by = new Map<string, AgentJob[]>();
    for (const a of inTab) by.set(dayOf(a), [...(by.get(dayOf(a)) ?? []), a]);
    const fit = (a: AgentJob) => a.job.aiScore ?? a.job.score ?? a.score ?? -1;
    return [...by.entries()].sort((x, y) => y[0].localeCompare(x[0])).map(([d, list]) => ({ day: d, jobs: [...list].sort((x, y) => fit(y) - fit(x)) }));
  }, [inTab]);
  const days = groups.map((g) => g.day);
  const shownGroups = day === "all" ? groups : groups.filter((g) => g.day === day);
  const shown = shownGroups.flatMap((g) => g.jobs);

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl">Daily jobs</h1>
          <p className="text-muted-foreground">
            Every morning JobPilot checks your <Link href="/discover" className="underline">Discover</Link> boards with your saved filters, keeps the new jobs here and emails you a list. Press Apply, then use the extension&apos;s Autofill on the form.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => run(false)} disabled={running}>{running ? <Loader2 size={16} className="mr-2 animate-spin" /> : <RefreshCw size={16} className="mr-2" />} Check now</Button>
          <Button variant="outline" onClick={() => run(true)} disabled={running} title="Check now and email the new jobs"><Mail size={16} className="mr-2" /> Check &amp; email</Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}

      {settings && <SettingsCard settings={settings} saving={saving} onSave={save} />}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex gap-4" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`pb-2 -mb-px border-b-2 font-narrow text-[13px] font-semibold uppercase tracking-[0.08em] ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
              {t.label} <span className="fig">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <select value={days.includes(day) ? day : "all"} onChange={(e) => setDay(e.target.value)} aria-label="Show jobs from" className="h-8 rounded-[3px] border border-input bg-card px-2 text-xs">
            <option value="all">All dates</option>
            {groups.map((g) => <option key={g.day} value={g.day}>{dayLabel(g.day)} ({g.jobs.length})</option>)}
          </select>
          {tab === "todo" && <label className="inline-flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={hideBlocked} onChange={(e) => setHideBlocked(e.target.checked)} /> Hide jobs you can&apos;t apply to or that aren&apos;t your field</label>}
        </div>
      </div>

      {jobs === null ? (
        <p className="text-sm text-muted-foreground"><Loader2 size={14} className="inline animate-spin" /> Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tab === "todo" ? (jobs.length ? "All caught up." : "No jobs yet. Press Check now, or turn on the daily check below.") : "Nothing here."}</p>
      ) : (
        <div className="space-y-6">
          {shownGroups.map((g) => {
            const emailed = g.jobs.filter((a) => a.emailedAt).length;
            return (
              <section key={g.day} className="space-y-3" aria-label={dayLabel(g.day)}>
                <div className="flex items-center gap-3">
                  <h2 className="font-narrow text-[13px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap">{dayLabel(g.day)}</h2>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {g.jobs.length} job{g.jobs.length === 1 ? "" : "s"}{emailed ? ` · ${emailed} in that day's email` : ""}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <ul className="space-y-3">
                  {g.jobs.map((a) => <JobCard key={a.key} a={a} onApply={() => apply(a)} onApplied={() => mark(a, "applied")} onDismiss={() => mark(a, a.status === "dismissed" ? "new" : "dismissed")} onTailor={() => tailor(a)} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The local day a job belongs to: the day of the email it was in, else the day it was found (YYYY-MM-DD). */
function dayOf(a: AgentJob): string {
  const d = new Date(a.emailedAt ?? a.firstSeenAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Today · Mon 23 Nov", "Yesterday · Sun 22 Nov", "Fri 20 Nov 2026". */
function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  const label = date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(y !== today.getFullYear() ? { year: "numeric" } : {}) });
  return diff === 0 ? `Today · ${label}` : diff === 1 ? `Yesterday · ${label}` : label;
}

function SettingsCard({ settings, saving, onSave }: { settings: AgentSettings; saving: boolean; onSave: (s: AgentSettings) => void }) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const dirty = s.enabled !== settings.enabled || s.email !== settings.email || s.minScore !== settings.minScore;
  const last = settings.lastRunAt ? new Date(settings.lastRunAt) : null;
  return (
    <Card className="p-4 space-y-3" id="settings">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        Check every morning (by about 9 AM India time) and email me the new jobs
      </label>
      <div className="flex flex-col md:flex-row gap-2">
        <Input type="email" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} placeholder="Email (blank = your sign-in email)" />
        <select value={s.minScore} onChange={(e) => setS({ ...s, minScore: Number(e.target.value) })} aria-label="Minimum match to email" className="h-10 rounded-[3px] border border-input bg-card px-2 text-sm md:max-w-64">
          <option value={0}>Email every new job</option>
          <option value={40}>Email matches 40+</option>
          <option value={60}>Email matches 60+</option>
          <option value={70}>Email strong matches (70+)</option>
        </select>
        <Button onClick={() => onSave(s)} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Jobs you likely can&apos;t apply to (wrong country, too much experience) are never emailed. Which companies and roles are checked comes from <Link href="/discover" className="underline">Discover</Link>: set your keywords and locations there and press &ldquo;Save as default&rdquo;.
        {last && <> Last check: {last.toLocaleString()}{settings.lastResult ? `, ${settings.lastResult.newJobs} new${settings.lastResult.emailed ? `, ${settings.lastResult.emailed} emailed` : ""}${settings.lastResult.emailError ? ` (email: ${settings.lastResult.emailError})` : ""}` : ""}.</>}
      </p>
    </Card>
  );
}

function JobCard({ a, onApply, onApplied, onDismiss, onTailor }: { a: AgentJob; onApply: () => void; onApplied: () => void; onDismiss: () => void; onTailor: () => void }) {
  const [open, setOpen] = useState(false);
  const j = a.job;
  const seen = new Date(a.firstSeenAt);
  return (
    <li>
      <Card className="p-4 space-y-2">
        <div className="flex gap-3 justify-between">
          <div className="min-w-0">
            <a href={j.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline inline-flex items-center gap-1">{j.title} <ExternalLink size={14} /></a>
            <div className="text-sm text-muted-foreground flex flex-wrap gap-x-2">
              <span className="font-medium text-foreground">{j.company}</span>
              {j.location && <span>{j.location}</span>}
              {j.remote && <span className="text-xs rounded-[3px] border border-border px-2">Remote</span>}
              <span>found {seen.toLocaleDateString()}</span>
              {a.status === "new" && <span className="text-xs rounded-[3px] bg-primary text-primary-foreground px-2">New</span>}
              {a.status === "opened" && <span className="text-xs rounded-[3px] border border-border px-2">Opened</span>}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1" title={j.aiScore != null ? `AI fit ${j.aiScore} (skills match ${j.score ?? "–"})` : j.resumeName ? `Best resume: ${j.resumeName}` : undefined}>
            <MatchRamp score={j.aiScore ?? j.score} />
            {j.aiScore != null && <span className="text-[11px] text-muted-foreground">AI fit</span>}
          </div>
        </div>
        {j.aiReason && <p className="text-xs text-foreground/80">{j.aiReason}</p>}
        {j.flags.length > 0 && (
          <ul className="space-y-1">
            {j.flags.map((f, i) => (
              <li key={i} className={`text-xs flex items-start gap-1 ${f.severity === "blocker" ? "text-destructive" : "text-warn"}`}>
                {f.severity === "blocker" ? <Ban size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />} {f.message}
              </li>
            ))}
          </ul>
        )}
        {(j.matchedSkills.length > 0 || j.missingSkills.length > 0) && (
          <div className="flex flex-wrap gap-1 text-xs">
            {j.matchedSkills.map((s) => <span key={s} className="rounded-[3px] chip-ok px-2 py-0.5">{s}</span>)}
            {j.missingSkills.map((s) => <span key={s} className="rounded-[3px] border border-dashed border-border text-muted-foreground px-2 py-0.5" title="Required, not found in your resume">{s}</span>)}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onApply}>Apply <ExternalLink size={13} className="ml-1" /></Button>
          {a.status !== "applied" && <Button size="sm" variant="outline" onClick={onApplied}><Check size={14} className="mr-1" /> I applied</Button>}
          {j.text && <Button size="sm" variant="outline" onClick={onTailor}><FileText size={14} className="mr-1" /> Tailor resume</Button>}
          {j.text && <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide description" : "Description"}</Button>}
          {a.status !== "applied" && <Button size="sm" variant="ghost" onClick={onDismiss} className="ml-auto">{a.status === "dismissed" ? "Restore" : <><X size={14} className="mr-1" /> Dismiss</>}</Button>}
        </div>
        {open && <pre className="whitespace-pre-wrap text-sm font-sans text-muted-foreground max-h-96 overflow-auto border-t pt-2">{j.text}</pre>}
      </Card>
    </li>
  );
}
