"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { ATS_PROFILES, detectAtsVendor, type AtsVendor, type AtsVendorReport, type TailorReport } from "@internova/core";
import { Button, Card, Input } from "@/components/ui";
import { UPGRADE_JOB_KEY } from "@/lib/handoff";
import { b64ToBlobUrl, compileToPdf, LatexActions } from "@/components/LatexActions";

interface Result {
  mode: "latex" | "profile";
  latex: string;
  report: TailorReport;
  pages?: number;
  pdf?: string;
  changes?: string[];
  warnings?: string[];
  ats?: { before: AtsVendorReport | null; after: AtsVendorReport };
}

export default function ResumeUpgradePage() {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jd, setJd] = useState("");
  const [source, setSource] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [ats, setAts] = useState<AtsVendor | "auto">("auto");

  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const raw = sessionStorage.getItem(UPGRADE_JOB_KEY);
        if (!raw) return;
        sessionStorage.removeItem(UPGRADE_JOB_KEY);
        const j = JSON.parse(raw) as { company?: string; role?: string; text?: string; url?: string; ats?: AtsVendor };
        if (j.company) setCompany(j.company);
        if (j.role) setRole(j.role);
        if (j.text) setJd(j.text);
        if (j.url) setJobUrl(j.url);
        if (j.ats) setAts(j.ats);
      } catch { /* nothing handed over */ }
    });
  }, []);
  const detected = detectAtsVendor(jobUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [latex, setLatex] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [recompiling, setRecompiling] = useState(false);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    setPdfUrl(null);
    try {
      const res = await fetch("/api/resume-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, role, jobDescription: jd, jobUrl: jobUrl.trim() || undefined, ats: ats === "auto" ? undefined : ats, latex: source.trim() || undefined, compile: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error([body.error ?? `Failed (${res.status})`, body.log].filter(Boolean).join("\n"));
      setResult(body);
      setLatex(body.latex);
      setPages(body.pages ?? null);
      if (body.pdf) setPdfUrl(b64ToBlobUrl(body.pdf));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function recompile() {
    setRecompiling(true);
    setError(null);
    try {
      const r = await compileToPdf(latex);
      setPdfUrl(r.url);
      setPages(r.pages);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecompiling(false);
    }
  }

  const r = result?.report;
  const filename = `Resume_${(company || "Tailored").replace(/\W+/g, "_")}`;

  return (
    <div className="container mx-auto p-6 pt-16 max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Resume upgrade</h1>
        <p className="text-muted-foreground">
          Tailors your resume to a job: ATS keywords you genuinely have, quantified bullets using only your real numbers, varied verbs, one page.
          Paste your Overleaf code to keep your own design, or leave it empty to use JobPilot&apos;s ATS-friendly template.
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={generate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">Company<Input value={company} onChange={(e) => setCompany(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Role<Input value={role} onChange={(e) => setRole(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Job link (optional)
            <Input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://… (used to detect the company’s ATS)" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Applicant tracking system
            <select className="h-10 rounded-md border border-input bg-background px-2 text-sm font-normal" value={ats} onChange={(e) => setAts(e.target.value as AtsVendor | "auto")}>
              <option value="auto">Auto-detect{jobUrl ? `: ${ATS_PROFILES[detected].label}` : " (from the job link)"}</option>
              {Object.values(ATS_PROFILES).filter((p) => p.id !== "unknown").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Job description
            <textarea required rows={12} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job description"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Overleaf / LaTeX code (optional)
            <textarea rows={12} value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false}
              placeholder={"Paste your main.tex from Overleaf (Menu → Download → Source, or copy the editor).\nLeave empty to generate from your JobPilot profile."}
              className="rounded-md border border-input bg-background px-3 py-2 text-xs font-mono font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <div className="md:col-span-2 flex items-center gap-4 flex-wrap">
            <Button type="submit" disabled={busy || jd.trim().length < 80}>
              {busy ? <><Loader2 className="animate-spin mr-2" size={16} />Tailoring and compiling…</> : <><Sparkles className="mr-2" size={16} />Generate upgraded resume</>}
            </Button>
            <span className="text-xs text-muted-foreground">Takes 20–60 s. The PDF is compiled by a public LaTeX service.</span>
          </div>
        </form>
        {error && <pre className="text-sm text-destructive whitespace-pre-wrap mt-3" role="alert">{error}</pre>}
      </Card>

      {result && r && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 grid grid-cols-2 gap-3 text-center">
              <Metric label="ATS readability" before={r.atsBefore} after={r.atsAfter} />
              <Metric label="Job alignment" before={r.alignmentBefore} after={r.alignmentAfter} />
              <div className="text-sm"><div className="text-muted-foreground">Pages</div><div className={`text-xl font-semibold ${pages && pages > 1 ? "text-destructive" : ""}`}>{pages ?? "–"}</div></div>
              <div className="text-sm"><div className="text-muted-foreground">Words</div><div className="text-xl font-semibold">{r.words}</div></div>
            </Card>

            {result.ats && <AtsCard before={result.ats.before} after={result.ats.after} />}
            {(result.warnings?.length ?? 0) > 0 && (
              <Card className="p-4 border-yellow-500/50">
                <h3 className="font-semibold text-sm mb-2">Check these (not in your resume or profile)</h3>
                <ul className="text-sm list-disc pl-4 space-y-1">{result.warnings!.map((w) => <li key={w}>{w}</li>)}</ul>
              </Card>
            )}
            {r.removed.length > 0 && (
              <Card className="p-4">
                <h3 className="font-semibold text-sm mb-2">Removed to avoid exaggeration</h3>
                <ul className="text-sm list-disc pl-4 space-y-1">{r.removed.map((x, i) => <li key={i}><span className="text-muted-foreground">“{x.text}”</span>: {x.reason}</li>)}</ul>
              </Card>
            )}
            {r.skillGaps.length > 0 && (
              <Card className="p-4">
                <h3 className="font-semibold text-sm mb-1">Skill gaps (not added)</h3>
                <p className="text-xs text-muted-foreground mb-2">The job asks for these and your profile doesn&apos;t show them. Learn or build with them before claiming them.</p>
                <div className="flex flex-wrap gap-1">{r.skillGaps.map((g) => <span key={g} className="text-xs rounded-full border border-border px-2 py-0.5">{g}</span>)}</div>
              </Card>
            )}
            {r.repeatedVerbs.length > 0 && (
              <Card className="p-4">
                <h3 className="font-semibold text-sm mb-1">Repetition</h3>
                <p className="text-sm">{r.repeatedVerbs.map((v) => `“${v.verb}” ×${v.count}`).join(", ")}: consider varying these.</p>
              </Card>
            )}
            {((result.changes?.length ?? 0) > 0 || r.notes.length > 0) && (
              <Card className="p-4">
                <h3 className="font-semibold text-sm mb-2">What changed</h3>
                <ul className="text-sm list-disc pl-4 space-y-1">{[...(result.changes ?? []), ...r.notes].map((c, i) => <li key={i}>{c}</li>)}</ul>
              </Card>
            )}
          </div>

          <div className="lg:col-span-3 space-y-4">
            <Card className="p-4 space-y-3">
              <LatexActions latex={latex} filename={filename} pdfUrl={pdfUrl} onCompiled={(c) => { setPdfUrl(c.url); setPages(c.pages); }} />
              {pdfUrl ? <iframe title="Resume PDF preview" src={pdfUrl} className="w-full h-[780px] rounded border border-border" /> : <p className="text-sm text-muted-foreground">No PDF yet.</p>}
            </Card>
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">LaTeX source (editable)</h3>
                <Button size="sm" variant="outline" onClick={recompile} disabled={recompiling}>
                  {recompiling ? <Loader2 className="animate-spin mr-1" size={14} /> : <RefreshCw size={14} className="mr-1" />} Recompile
                </Button>
              </div>
              <textarea rows={16} value={latex} onChange={(e) => setLatex(e.target.value)} spellCheck={false} aria-label="LaTeX source"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, before, after }: { label: string; before: number | null; after: number | null }) {
  const up = before !== null && after !== null && after > before;
  return (
    <div className="text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">
        {before ?? "–"} <span className="text-muted-foreground">→</span> <span className={up ? "text-green-600" : ""}>{after ?? "–"}</span>
      </div>
    </div>
  );
}

function AtsCard({ before, after }: { before: AtsVendorReport | null; after: AtsVendorReport }) {
  const prev = new Map(before?.checks.map((c) => [c.id, c]) ?? []);
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-sm">{after.label} check <span className="font-normal text-muted-foreground">({after.parsing} parser)</span></h3>
        <span className="text-sm font-semibold">{before ? <>{before.score} <span className="text-muted-foreground">→</span> </> : null}<span className={before && after.score > before.score ? "text-green-600" : ""}>{after.score}</span></span>
      </div>
      <ul className="text-xs space-y-1">
        {after.checks.map((c) => (
          <li key={c.id} className="flex gap-2">
            <span className={c.passed ? "text-green-600" : "text-yellow-700 dark:text-yellow-400"}>{c.passed ? "✓" : "!"}</span>
            <span><strong>{c.label}</strong>{prev.get(c.id) && !prev.get(c.id)!.passed && c.passed ? " (fixed)" : ""}: {c.detail}</span>
          </li>
        ))}
      </ul>
      {after.missingKeywords.length > 0 && (
        <p className="text-xs text-muted-foreground">Job keywords still missing (add only if true): {after.missingKeywords.join(", ")}</p>
      )}
      <details className="text-xs"><summary className="cursor-pointer font-medium">Tips for {after.label}</summary>
        <ul className="list-disc pl-4 mt-1 space-y-0.5">{after.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      </details>
    </Card>
  );
}
