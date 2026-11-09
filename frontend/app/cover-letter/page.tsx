"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, Sparkles } from "lucide-react";
import {
  coverLetterText,
  EMPTY_PROFILE,
  parseLetterText,
  renderCoverLetterLatex,
  type CandidateProfile,
  type CoverLetter,
  type CoverLetterTone,
} from "@internova/core";
import { Button, Card, Input } from "@/components/ui";
import { LatexActions } from "@/components/LatexActions";
import { loadProfile } from "@/lib/data";

type Result = CoverLetter & { name: string };

export default function CoverLetterPage() {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [manager, setManager] = useState("");
  const [jd, setJd] = useState("");
  const [research, setResearch] = useState(true);
  const [tone, setTone] = useState<CoverLetterTone>("professional");
  const [words, setWords] = useState(250);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [text, setText] = useState("");
  const [profile, setProfile] = useState<CandidateProfile>(EMPTY_PROFILE);
  const [copied, setCopied] = useState(false);

  useEffect(() => { loadProfile().then((p) => p && setProfile(p)).catch(() => {}); }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, role, jobDescription: jd, research, tone, words, hiringManager: manager }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setResult(body);
      setText(coverLetterText(body, body.name));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  // The PDF uses the (possibly edited) text; the name line is added by the template
  const latex = renderCoverLetterLatex(parseLetterText(text.replace(new RegExp(`\\n?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "")), profile, company);

  return (
    <div className="container mx-auto p-6 pt-16 max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Cover letter</h1>
        <p className="text-muted-foreground">Written from your profile and the job description. Nothing about you is invented: claims that aren't in your profile are flagged for you to check.</p>
      </div>

      <Card className="p-6">
        <form onSubmit={generate} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">Company<Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Razorpay" /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Role<Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Backend Engineering Intern" /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Hiring manager (optional)<Input value={manager} onChange={(e) => setManager(e.target.value)} placeholder="e.g. Ms. Rao" /></label>
          <label className="md:col-span-3 flex flex-col gap-1 text-sm font-medium">Job description
            <textarea required rows={9} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job description"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} />
            Research the company on the web first
          </label>
          <label className="flex items-center gap-2 text-sm">Tone
            <select value={tone} onChange={(e) => setTone(e.target.value as CoverLetterTone)} className="h-9 rounded-md border border-input bg-background px-2">
              <option value="professional">Professional</option>
              <option value="enthusiastic">Enthusiastic</option>
              <option value="concise">Concise</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">Length
            <select value={words} onChange={(e) => setWords(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2">
              <option value={180}>Short (~180 words)</option>
              <option value={250}>Standard (~250 words)</option>
              <option value={350}>Long (~350 words)</option>
            </select>
          </label>
          <div className="md:col-span-3">
            <Button type="submit" disabled={busy || jd.trim().length < 80}>
              {busy ? <><Loader2 className="animate-spin mr-2" size={16} />{research ? "Researching and writing…" : "Writing…"}</> : <><Sparkles className="mr-2" size={16} />Generate cover letter</>}
            </Button>
          </div>
        </form>
        {error && <p className="text-sm text-destructive mt-3" role="alert">{error}</p>}
      </Card>

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-6 space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Your letter <span className="text-sm font-normal text-muted-foreground">(edit freely)</span></h2>
              <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                <Copy size={14} className="mr-1" /> {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-sm"><span className="text-muted-foreground">Subject:</span> {result.subject}</p>
            <textarea rows={18} value={text} onChange={(e) => setText(e.target.value)} aria-label="Cover letter text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <LatexActions latex={latex} filename={`Cover_Letter_${(company || "Company").replace(/\W+/g, "_")}`} />
          </Card>
          <div className="space-y-4">
            {result.warnings.length > 0 && (
              <Card className="p-4 border-yellow-500/50">
                <h3 className="font-semibold text-sm mb-2">Check these before sending</h3>
                <ul className="text-sm space-y-1 list-disc pl-4">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </Card>
            )}
            <Card className="p-4">
              <h3 className="font-semibold text-sm mb-2">Company research used</h3>
              {result.sources.length ? (
                <ul className="text-sm space-y-2">
                  {result.sources.map((s) => (
                    <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.title || s.url}</a><p className="text-xs text-muted-foreground">{s.snippet}</p></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">{research ? "No public results found; the letter relies on the job description." : "Research was off."}</p>}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
