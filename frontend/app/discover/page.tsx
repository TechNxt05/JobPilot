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
import { MatchRamp, Pnr } from "@/components/chart";
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
  const [ranking, setRanking] = useState(false);
  const [rankNote, setRankNote] = useState<string | null>(null);

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
      setBusy(false);
      await rankTop(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** AI's fit score for the top jobs the rules kept: one AI action for up to 20 jobs, filled in after the results. */
  async function rankTop(found: DiscoverResponse) {
    setRankNote(null);
    const top = found.jobs.filter((j) => !j.flags.some((f) => f.severity === "blocker")).slice(0, 20);
    if (!top.length || !found.hasResume) return;
    setRanking(true);
    try {
      const res = await fetch("/api/jobs/rank", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: top.map((j) => ({ id: j.id, title: j.title, company: j.company, location: j.location, text: j.text })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRankNote(res.status === 429 ? "AI scoring skipped: today's AI actions are used up. Scores shown are the skills match." : `AI scoring unavailable (${body.error ?? res.status}). Scores shown are the skills match.`);
        return;
      }
      const ranks = (body.ranks ?? {}) as Record<string, { score: number; reason: string }>;
      setResult((r) => r && { ...r, jobs: r.jobs.map((j) => (ranks[j.id] ? { ...j, aiScore: ranks[j.id].score, aiReason: ranks[j.id].reason } : j)) });
    } catch {
      setRankNote("AI scoring unavailable. Scores shown are the skills match.");
    } finally {
      setRanking(false);
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
      score: j.aiScore ?? j.score, resumeName: j.resumeName ?? "", deadline: j.deadline ?? "",
      notes: `Found via ${j.sourceLabel ?? `${ATS_LABELS[j.ats]} board`}.`,
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
      sessionStorage.setItem(UPGRADE_JOB_KEY, JSON.stringify({ company: j.company, role: j.title, text: j.text, url: j.applyUrl, ats: j.sourceLabel ? undefined : j.ats }));
    } catch { /* storage unavailable */ }
    router.push("/resume-upgrade");
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // AI-scored good fits first (best first), then jobs AI didn't score, then the ones AI judged a weak fit
    const tier = (j: RankedJob) => (j.aiScore == null ? 1 : j.aiScore >= 40 ? 0 : 2);
    return (result?.jobs ?? [])
      .filter((j) =>
        (!hideBlocked || !j.flags.some((f) => f.severity === "blocker")) &&
        (!q || `${j.title} ${j.company} ${j.location} ${j.department}`.toLowerCase().includes(q)))
      .map((j, i) => ({ j, i }))
      .sort((a, b) => tier(a.j) - tier(b.j) || (tier(a.j) !== 1 ? (b.j.aiScore ?? 0) - (a.j.aiScore ?? 0) : a.i - b.i))
      .map((x) => x.j);
  }, [result, hideBlocked, query]);

  const f = settings.filters;
  const setF = (patch: Partial<DiscoverySettings["filters"]>) => setSettings({ ...settings, filters: { ...settings.filters, ...patch } });

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-4xl">Discover jobs</h1>
        <p className="text-muted-foreground">
          Open roles straight from companies&apos; own job systems (Greenhouse, Lever, Ashby, Workday, Oracle, Eightfold, SmartRecruiters and more), Google, Amazon and Microsoft careers, and fresher-job sites like Talentd and InternDoor, ranked against your resume. No AI quota used.
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
            <select className="h-9 rounded-[3px] border border-input bg-background px-2" value={f.postedWithinDays} onChange={(e) => setF({ postedWithinDays: Number(e.target.value) })}>
              {[7, 14, 30, 60, 90, 0].map((d) => <option key={d} value={d}>{d ? `${d} days` : "any time"}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={run} disabled={busy || !loaded}>
            {busy ? <Loader2 className="animate-spin mr-2" size={16} /> : <Search className="mr-2" size={16} />}
            {busy ? "Scanning boards…" : "Search company boards"}
          </Button>
          <Button variant="outline" onClick={save} disabled={!loaded}>Save as default</Button>
          <Button variant="ghost" onClick={() => setShowBoards((v) => !v)}><Settings2 size={16} className="mr-2" /> Companies ({countActive(settings)})</Button>
        </div>
        {showBoards && <Boards settings={settings} setSettings={setSettings} result={result} />}
      </Card>

      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
      {notice && <p className="text-sm text-ok" role="status">{notice}</p>}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {result.matched} matching of {result.scanned} open roles at {result.boards.filter((b) => !b.error).length} companies
              {result.matched > result.jobs.length && ` · showing the top ${result.jobs.length}`}
            </span>
            {ranking && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> AI is scoring the top 20 for you…</span>}
            <Toggle on={hideBlocked} onChange={setHideBlocked}>Hide jobs you can&apos;t apply to or that aren&apos;t your field</Toggle>
            <Input className="h-9 max-w-xs ml-auto" placeholder="Filter results" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {rankNote && <p className="text-xs text-muted-foreground">{rankNote}</p>}
          {!result.hasResume && (
            <p className="text-sm rounded-[3px] note-warn p-3">
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
  return (
    <Card className="p-4 space-y-2">
      <div className="flex gap-3 justify-between">
        <div className="min-w-0">
          <a href={j.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline inline-flex items-center gap-1">{j.title} <ExternalLink size={14} /></a>
          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-2">
            <span className="font-medium text-foreground">{j.company}</span>
            {j.location && <span>{j.location}</span>}
            {j.remote && <span className="text-xs rounded-[3px] border border-border px-2">Remote</span>}
            {age !== null && <span>{age <= 0 ? "today" : `${age}d ago`}</span>}
            {age !== null && age <= 3 && <span className="text-xs rounded-[3px] bg-primary text-primary-foreground px-2">New</span>}
            {j.department && <span>· {j.department}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5" title={j.aiScore != null ? `AI fit ${j.aiScore} (skills match ${j.score ?? "–"})` : j.resumeName ? `Skills match with ${j.resumeName}` : undefined}>
          <MatchRamp score={j.aiScore ?? j.score} />
          {j.aiScore != null && <span className="text-[11px] text-muted-foreground">AI fit</span>}
          <Pnr id={j.id} />
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
        <a href={j.applyUrl} target="_blank" rel="noreferrer"><Button size="sm">Apply</Button></a>
        <Button size="sm" variant="outline" onClick={onTrack} disabled={tracked}>
          {tracked ? <><Check size={14} className="mr-1" /> In tracker</> : <><Plus size={14} className="mr-1" /> Save to tracker</>}
        </Button>
        <Button size="sm" variant="outline" onClick={onEmail}>
          <Mail size={14} className="mr-1" /> {j.contacts ? `Email a recruiter (${j.contacts})` : "Email a recruiter"}
        </Button>
        {j.text && <Button size="sm" variant="outline" onClick={onTailor} title={`Tailor your resume for ${j.sourceLabel ?? ATS_LABELS[j.ats]}`}><FileText size={14} className="mr-1" /> Tailor resume</Button>}
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
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const hidden = new Set(settings.hidden);
  const status = new Map(result?.boards.map((b) => [`${b.ats}:${b.ats === "smartrecruiters" ? b.slug : b.slug.toLowerCase()}`, b]) ?? []);

  /** Add boards (deduped; a hidden default is switched back on) and return the next settings. */
  function withBoards(base: DiscoverySettings, found: JobSource[], label: string): DiscoverySettings {
    let next = base;
    for (const src of found) {
      const key = sourceKey(src);
      if (DEFAULT_SOURCES.some((d) => sourceKey(d) === key)) next = { ...next, hidden: next.hidden.filter((h) => h !== key) };
      else if (!next.sources.some((s) => sourceKey(s) === key)) next = { ...next, sources: [...next.sources, { ...src, company: label || src.company }] };
    }
    return next;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null);
    // A company name ("JPMorgan", "Mastercard"), not a link: look for its job boards
    if (!/[./]/.test(url.trim())) {
      setChecking(true);
      try {
        const r = await fetch("/api/find-company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: url.trim() }) });
        const out = await r.json();
        if (!r.ok) throw new Error(out.error ?? `Failed (${r.status})`);
        const found = out.boards as { source: JobSource; jobs: number; sample: string[] }[];
        if (!found.length) throw new Error(`No public job board found for “${url.trim()}”. Paste a link to one of its job postings or its careers page instead.`);
        setSettings(withBoards(settings, found.map((f) => ({ ...f.source, company: name.trim() || f.source.company })), ""));
        setInfo(`Added ${found.map((f) => `${ATS_LABELS[f.source.ats]} (${f.jobs} open, e.g. ${f.sample[0] ?? "…"})`).join("; ")}. Untick any that isn't the right company.`);
        setUrl(""); setName("");
      } catch (e2) {
        setErr((e2 as Error).message);
      } finally {
        setChecking(false);
      }
      return;
    }
    const src = sourceFromUrl(url);
    if (src) {
      setSettings(withBoards(settings, [src], name.trim()));
      setUrl(""); setName("");
      return;
    }
    // Not a known ATS link: read the page for the board it uses, or the jobs it publishes as structured data
    setChecking(true);
    try {
      const r = await fetch("/api/careers-page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error ?? `Failed (${r.status})`);
      const label = name.trim() || out.company;
      if (out.boards.length) {
        setSettings(withBoards(settings, out.boards, out.boards.length === 1 ? label : ""));
        setInfo(`That page uses ${out.boards.map((b: JobSource) => ATS_LABELS[b.ats]).join(", ")}. Added ${out.boards.length === 1 ? "its board" : "its boards"}.`);
      } else if (out.jobs > 0) {
        if (!settings.pages.some((p) => p.url === out.url)) setSettings({ ...settings, pages: [...settings.pages, { url: out.url, company: label }] });
        setInfo(`Added. The page lists ${out.jobs} job${out.jobs === 1 ? "" : "s"} JobPilot can read.`);
      } else {
        throw new Error("No job board or job data found on that page. It probably loads jobs with JavaScript. Open it in Chrome and use the JobPilot extension's Analyze, or paste a link from the company's job system (Greenhouse, Lever, Ashby, Workday, Oracle, Eightfold, Breezy, SmartRecruiters…).");
      }
      setUrl(""); setName("");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setChecking(false);
    }
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
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Add a company: type its name (e.g. JPMorgan) or paste a careers page / job link" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="md:max-w-48" />
        <Button type="submit" variant="outline" disabled={checking || !url.trim()}>{checking ? <Loader2 size={16} className="mr-1 animate-spin" /> : <Plus size={16} className="mr-1" />} Add</Button>
      </form>
      {err && <p className="text-destructive text-xs">{err}</p>}
      {info && <p className="text-xs text-muted-foreground">{info}</p>}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        {settings.pages.map((p) => {
          const st = result?.boards.find((b) => b.ats === "page" && b.slug === p.url);
          return (
            <li key={p.url} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked readOnly aria-label={`Watching ${p.company}`} />
              <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.company}</a>
              <span className="text-xs text-muted-foreground">Careers page</span>
              {st && <span className={`text-xs ${st.error ? "text-destructive" : "text-muted-foreground"}`}>{st.error ?? `${st.jobs} open`}</span>}
              <button className="ml-auto text-muted-foreground hover:text-foreground" aria-label={`Remove ${p.company}`} onClick={() => setSettings({ ...settings, pages: settings.pages.filter((x) => x.url !== p.url) })}><X size={14} /></button>
            </li>
          );
        })}
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
