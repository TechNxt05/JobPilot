"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, Check, ExternalLink, FileText, Loader2, Mail, Plus, Search, Settings2, X } from "lucide-react";
import {
  ATS_LABELS,
  DEFAULT_SOURCES,
  jobKey,
  newApplication,
  sourceFromUrl,
  sourceKey,
  type JobSource,
} from "@internova/core";
import { Button, Card, Input } from "@/components/ui";
import { listApplications, saveApplication } from "@/lib/data";
import { EMPTY_SETTINGS, type DiscoverResponse, type DiscoverySettings, type RankedJob } from "@/lib/discoverTypes";
import { OUTREACH_JOB_KEY, UPGRADE_JOB_KEY } from "@/lib/handoff";
import { loadDiscoverySettings, saveDiscoverySettings } from "@/lib/outreach";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const daysAgo = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);

export default function DiscoverPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<DiscoverySettings>(EMPTY_SETTINGS);
  const [keywords, setKeywords] = useState("");
  const [locations, setLocations] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoverResponse | null>(null);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [hideBlocked, setHideBlocked] = useState(true);
  const [query, setQuery] = useState("");
  const [showBoards, setShowBoards] = useState(false);

  useEffect(() => {
    loadDiscoverySettings()
      .then((s) => {
        setSettings(s);
        setKeywords(s.filters.keywords.join(", "));
        setLocations(s.filters.locations.join(", "));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
    listApplications().then((apps) => setTracked(new Set(apps.map((a) => jobKey(a.url))))).catch(() => {});
  }, []);

  const current = (): DiscoverySettings => ({
    ...settings,
    filters: { ...settings.filters, keywords: list(keywords), locations: list(locations) },
  });

  async function run() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/jobs/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: current() }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setResult(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    try {
      const s = current();
      await saveDiscoverySettings(s);
      setSettings(s);
      setNotice("Saved as your default search.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function track(j: RankedJob) {
    const app = newApplication({
      title: j.title, company: j.company, url: j.url, location: j.location,
      score: j.score, resumeName: j.resumeName ?? "", deadline: j.deadline ?? "",
      notes: `Found via ${ATS_LABELS[j.ats]} board.`,
    });
    try {
      await saveApplication(app);
      setTracked((t) => new Set(t).add(jobKey(j.url)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function emailRecruiter(j: RankedJob) {
    try {
      sessionStorage.setItem(OUTREACH_JOB_KEY, JSON.stringify({ title: j.title, company: j.company, url: j.url, text: j.text }));
    } catch { /* storage unavailable: the outreach page still works without the job */ }
    router.push(`/outreach?company=${encodeURIComponent(j.company)}`);
  }

  function tailor(j: RankedJob) {
    try {
      // The board type is also the ATS, so the resume is tailored for that system
      sessionStorage.setItem(UPGRADE_JOB_KEY, JSON.stringify({ company: j.company, role: j.title, text: j.text, url: j.applyUrl, ats: j.ats }));
    } catch { /* storage unavailable */ }
    router.push("/resume-upgrade");
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (result?.jobs ?? []).filter((j) =>
      (!hideBlocked || !j.flags.some((f) => f.severity === "blocker")) &&
      (!q || `${j.title} ${j.company} ${j.location} ${j.department}`.toLowerCase().includes(q)));
  }, [result, hideBlocked, query]);

  const f = settings.filters;
  const setF = (patch: Partial<DiscoverySettings["filters"]>) => setSettings({ ...settings, filters: { ...settings.filters, ...patch } });

  return (
    <div className="container mx-auto p-6 pt-16 max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Discover jobs</h1>
        <p className="text-muted-foreground">
          Open roles straight from companies&apos; own job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable), ranked against your resume. No AI quota used.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm font-medium flex flex-col gap-1">Title keywords <span className="text-xs text-muted-foreground font-normal">any of these, comma-separated</span>
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="engineer, AI, backend, intern" />
          </label>
          <label className="text-sm font-medium flex flex-col gap-1">Locations <span className="text-xs text-muted-foreground font-normal">any of these; empty = anywhere</span>
            <Input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="India, Bengaluru, Hyderabad" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Toggle on={f.includeRemote} onChange={(v) => setF({ includeRemote: v })}>Include remote jobs</Toggle>
          <Toggle on={f.earlyCareerOnly} onChange={(v) => setF({ earlyCareerOnly: v })}>Hide senior roles</Toggle>
          <Toggle on={!!f.searchDescription} onChange={(v) => setF({ searchDescription: v })}>Match keywords in descriptions too</Toggle>
          <label className="flex items-center gap-2">Posted within
            <select className="h-9 rounded-md border border-input bg-background px-2" value={f.postedWithinDays} onChange={(e) => setF({ postedWithinDays: Number(e.target.value) })}>
              {[7, 14, 30, 60, 90, 0].map((d) => <option key={d} value={d}>{d ? `${d} days` : "any time"}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={run} disabled={busy || !loaded}>
            {busy ? <Loader2 className="animate-spin mr-2" size={16} /> : <Search className="mr-2" size={16} />}
            {busy ? "Scanning boards…" : "Find jobs"}
          </Button>
          <Button variant="outline" onClick={save} disabled={!loaded}>Save as default</Button>
          <Button variant="ghost" onClick={() => setShowBoards((v) => !v)}><Settings2 size={16} className="mr-2" /> Companies ({countActive(settings)})</Button>
        </div>
        {showBoards && <Boards settings={settings} setSettings={setSettings} result={result} />}
      </Card>

      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
      {notice && <p className="text-sm text-green-700 dark:text-green-400" role="status">{notice}</p>}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {result.matched} matching of {result.scanned} open roles at {result.boards.filter((b) => !b.error).length} companies
              {result.matched > result.jobs.length && ` · showing the top ${result.jobs.length}`}
            </span>
            <Toggle on={hideBlocked} onChange={setHideBlocked}>Hide jobs you likely can&apos;t apply to</Toggle>
            <Input className="h-9 max-w-xs ml-auto" placeholder="Filter results" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {!result.hasResume && (
            <p className="text-sm rounded-md border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950 p-3">
              Upload a resume on the <Link className="underline" href="/profile">Profile</Link> page to get match scores and eligibility checks.
            </p>
          )}
          {result.boards.some((b) => b.error) && (
            <p className="text-xs text-muted-foreground">Couldn&apos;t load: {result.boards.filter((b) => b.error).map((b) => `${b.company} (${b.error})`).join(", ")}</p>
          )}
          {shown.length === 0 && <p className="text-muted-foreground text-center py-8">No jobs match. Try more keywords, more locations, or a longer time window.</p>}
          <div className="space-y-3">
            {shown.map((j) => <JobRow key={j.id} job={j} tracked={tracked.has(jobKey(j.url))} onTrack={() => track(j)} onEmail={() => emailRecruiter(j)} onTailor={() => tailor(j)} />)}
          </div>
        </>
      )}
    </div>
  );
}

function countActive(s: DiscoverySettings) {
  const hidden = new Set(s.hidden);
  return DEFAULT_SOURCES.filter((d) => !hidden.has(sourceKey(d))).length + s.sources.length;
}

function JobRow({ job: j, tracked, onTrack, onEmail, onTailor }: { job: RankedJob; tracked: boolean; onTrack: () => void; onEmail: () => void; onTailor: () => void }) {
  const [open, setOpen] = useState(false);
  const age = daysAgo(j.postedAt);
  const tone = j.score === null ? "border-border text-muted-foreground" : j.score >= 70 ? "border-green-600 text-green-700 dark:text-green-400" : j.score >= 45 ? "border-yellow-600 text-yellow-700 dark:text-yellow-400" : "border-border text-muted-foreground";
  return (
    <Card className="p-4 space-y-2">
      <div className="flex gap-3 justify-between">
        <div className="min-w-0">
          <a href={j.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline inline-flex items-center gap-1">{j.title} <ExternalLink size={14} /></a>
          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-2">
            <span className="font-medium text-foreground">{j.company}</span>
            {j.location && <span>{j.location}</span>}
            {j.remote && <span className="text-xs rounded-full border border-border px-2">Remote</span>}
            {age !== null && <span>{age <= 0 ? "today" : `${age}d ago`}</span>}
            {age !== null && age <= 3 && <span className="text-xs rounded-full bg-primary text-primary-foreground px-2">New</span>}
            {j.department && <span>· {j.department}</span>}
          </div>
        </div>
        <div className={`text-sm font-semibold rounded-md border px-2 py-1 h-fit whitespace-nowrap ${tone}`} title={j.resumeName ? `Best match: ${j.resumeName}` : "No description or no resume to compare"}>
          {j.score === null ? "–" : `${j.score}% match`}
        </div>
      </div>

      {j.flags.length > 0 && (
        <ul className="space-y-1">
          {j.flags.map((f, i) => (
            <li key={i} className={`text-xs flex items-start gap-1 ${f.severity === "blocker" ? "text-destructive" : "text-yellow-700 dark:text-yellow-400"}`}>
              {f.severity === "blocker" ? <Ban size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />} {f.message}
            </li>
          ))}
        </ul>
      )}
      {(j.matchedSkills.length > 0 || j.missingSkills.length > 0) && (
        <div className="flex flex-wrap gap-1 text-xs">
          {j.matchedSkills.map((s) => <span key={s} className="rounded-full bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 px-2 py-0.5">{s}</span>)}
          {j.missingSkills.map((s) => <span key={s} className="rounded-full border border-dashed border-border text-muted-foreground px-2 py-0.5" title="Required, not found in your resume">{s}</span>)}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <a href={j.applyUrl} target="_blank" rel="noreferrer"><Button size="sm">Apply</Button></a>
        <Button size="sm" variant="outline" onClick={onTrack} disabled={tracked}>
          {tracked ? <><Check size={14} className="mr-1" /> In tracker</> : <><Plus size={14} className="mr-1" /> Save to tracker</>}
        </Button>
        <Button size="sm" variant="outline" onClick={onEmail}>
          <Mail size={14} className="mr-1" /> {j.contacts ? `Email a recruiter (${j.contacts})` : "Email a recruiter"}
        </Button>
        {j.text && <Button size="sm" variant="outline" onClick={onTailor} title={`Tailor your resume for ${ATS_LABELS[j.ats]}`}><FileText size={14} className="mr-1" /> Tailor resume</Button>}
        {j.text && <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide description" : "Description"}</Button>}
      </div>
      {open && <pre className="whitespace-pre-wrap text-sm font-sans text-muted-foreground max-h-96 overflow-auto border-t pt-2">{j.text}</pre>}
    </Card>
  );
}

function Boards({ settings, setSettings, result }: { settings: DiscoverySettings; setSettings: (s: DiscoverySettings) => void; result: DiscoverResponse | null }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const hidden = new Set(settings.hidden);
  const status = new Map(result?.boards.map((b) => [`${b.ats}:${b.ats === "smartrecruiters" ? b.slug : b.slug.toLowerCase()}`, b]) ?? []);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const src = sourceFromUrl(url);
    if (!src) {
      setErr("Paste a careers link from Greenhouse, Lever, Ashby, SmartRecruiters, Workable or Recruitee (e.g. jobs.lever.co/company).");
      return;
    }
    const key = sourceKey(src);
    if (DEFAULT_SOURCES.some((d) => sourceKey(d) === key)) {
      setSettings({ ...settings, hidden: settings.hidden.filter((h) => h !== key) });
    } else if (!settings.sources.some((s) => sourceKey(s) === key)) {
      setSettings({ ...settings, sources: [...settings.sources, { ...src, company: name.trim() || src.company }] });
    }
    setUrl(""); setName(""); setErr(null);
  }

  const row = (s: JobSource, custom: boolean) => {
    const key = sourceKey(s);
    const on = custom || !hidden.has(key);
    const st = status.get(key);
    return (
      <li key={key} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} aria-label={`Watch ${s.company}`} onChange={() => {
          if (custom) setSettings({ ...settings, sources: settings.sources.filter((x) => sourceKey(x) !== key) });
          else setSettings({ ...settings, hidden: on ? [...settings.hidden, key] : settings.hidden.filter((h) => h !== key) });
        }} />
        <span className={on ? "" : "text-muted-foreground line-through"}>{s.company}</span>
        <span className="text-xs text-muted-foreground">{ATS_LABELS[s.ats]}</span>
        {st && <span className={`text-xs ${st.error ? "text-destructive" : "text-muted-foreground"}`}>{st.error ?? `${st.jobs} open`}</span>}
        {custom && <button className="ml-auto text-muted-foreground hover:text-foreground" aria-label={`Remove ${s.company}`} onClick={() => setSettings({ ...settings, sources: settings.sources.filter((x) => sourceKey(x) !== key) })}><X size={14} /></button>}
      </li>
    );
  };

  return (
    <div className="border-t pt-4 space-y-3">
      <form onSubmit={add} className="flex flex-col md:flex-row gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Add a company: paste its careers link, e.g. https://jobs.ashbyhq.com/company" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="md:max-w-48" />
        <Button type="submit" variant="outline"><Plus size={16} className="mr-1" /> Add</Button>
      </form>
      {err && <p className="text-destructive text-xs">{err}</p>}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        {settings.sources.map((s) => row(s, true))}
        {DEFAULT_SOURCES.map((s) => row(s, false))}
      </ul>
      <p className="text-xs text-muted-foreground">Changes apply to the next search. Use “Save as default” to keep them.</p>
    </div>
  );
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
