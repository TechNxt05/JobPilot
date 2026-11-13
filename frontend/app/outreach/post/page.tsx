"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, ExternalLink, FileText, Loader2, Mail, Plus, Sparkles } from "lucide-react";
import { detectAtsVendor, gmailComposeUrl, mailtoUrl, newApplication, type AtsVendorReport, type PostDetails, type PostReplies, type ResearchSnippet } from "@internova/core";
import { Button, Card, Input } from "@/components/ui";
import { saveApplication } from "@/lib/data";
import { UPGRADE_JOB_KEY } from "@/lib/handoff";

interface Official { title: string; url: string; applyUrl: string; location: string; ats: string; postedAt: string | null; similarity: number; text: string }
interface Result {
  details: PostDetails;
  scan: { emails: string[]; urls: string[]; hashtags: string[] };
  postUrl: string;
  official: Official[];
  research: ResearchSnippet[];
  contacts: { id: string; email: string; name: string; title: string }[];
  ats: AtsVendorReport | null;
  replies: PostReplies;
  signature: string;
  dmSignoff: string;
}

const METHOD: Record<PostDetails["applyMethod"], string> = { email: "Email", dm: "LinkedIn DM", link: "Apply link", comment: "Comment on the post", unknown: "Not stated" };
const area = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function JobPostPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dm, setDm] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setRes(null); setSaved(false);
    try {
      const r = await fetch("/api/job-post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, postUrl }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error ?? `Failed (${r.status})`);
      const data = out as Result;
      setRes(data);
      setTo(data.details.emails[0] ?? data.contacts[0]?.email ?? "");
      setSubject(data.replies.emailSubject);
      setBody(`${data.replies.emailBody}\n\n${data.signature}`);
      setDm(`${data.replies.dm}\n\n${data.dmSignoff}`.trim());
      setNote(data.replies.connectionNote);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const official = res?.official[0] ?? null;
  const jobUrl = official?.url || res?.details.applyUrl || res?.postUrl || "";

  function tailorResume() {
    if (!res) return;
    const d = res.details;
    try {
      sessionStorage.setItem(UPGRADE_JOB_KEY, JSON.stringify({
        company: d.company, role: d.role || official?.title, text: official?.text || text, url: official?.applyUrl || d.applyUrl || "",
        ats: res.ats?.vendor && res.ats.vendor !== "unknown" ? res.ats.vendor : undefined,
      }));
    } catch { /* storage unavailable */ }
    router.push("/resume-upgrade");
  }

  async function track() {
    if (!res) return;
    const d = res.details;
    const how = d.applyMethod === "email" && to ? `Apply by email to ${to}` : `Apply via ${METHOD[d.applyMethod]}`;
    await saveApplication(newApplication({
      title: d.role || official?.title || "Role from post", company: d.company, url: jobUrl || "https://www.linkedin.com/feed/",
      location: d.location, deadline: d.deadline, notes: [`From a hiring post. ${how}.`, d.contactName && `Contact: ${d.contactName}${d.contactRole ? ` (${d.contactRole})` : ""}`, res.postUrl && `Post: ${res.postUrl}`].filter(Boolean).join("\n"),
    })).then(() => setSaved(true)).catch((e) => setError((e as Error).message));
  }

  return (
    <div className="container mx-auto p-6 pt-16 max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reply to a hiring post</h1>
        <p className="text-muted-foreground">
          Paste a LinkedIn (or any) hiring post. JobPilot finds the company&apos;s official posting if there is one, gathers context, checks your resume for where it&apos;ll be read,
          and drafts an email, a DM and a connection note from your profile. Nothing is sent automatically. <Link className="underline" href="/outreach">Back to contacts</Link>
        </p>
      </div>

      <Card className="p-4">
        <form onSubmit={run} className="space-y-3">
          <textarea required rows={10} className={area} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Paste the whole post, e.g.\n\n“We're hiring a Backend Engineer (0–2 yrs) in Bengaluru… Share your resume at careers@company.com with subject 'Backend Engineer - Name'. Mention notice period.”"} />
          <div className="flex flex-col md:flex-row gap-2">
            <Input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="Post link (optional): https://www.linkedin.com/posts/…" />
            <Button type="submit" disabled={busy || text.trim().length < 60} className="md:w-56">
              {busy ? <><Loader2 size={16} className="animate-spin mr-2" /> Working… (~20 s)</> : <><Sparkles size={16} className="mr-2" /> Prepare my reply</>}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Uses 1 AI action. Answers like notice period or expected pay come only from Profile → Saved answers; anything missing is marked [ADD: …].</p>
        </form>
        {error && <p className="text-destructive text-sm mt-2" role="alert">{error}</p>}
      </Card>

      {res && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 space-y-2 text-sm">
              <h2 className="font-semibold">The post</h2>
              <Fact k="Company" v={res.details.company} />
              <Fact k="Role" v={res.details.role} />
              <Fact k="Location" v={res.details.location} />
              <Fact k="Experience" v={res.details.experience} />
              <Fact k="Type" v={res.details.employmentType} />
              <Fact k="Contact" v={[res.details.contactName, res.details.contactRole].filter(Boolean).join(", ")} />
              <Fact k="Apply via" v={METHOD[res.details.applyMethod]} />
              <Fact k="Email(s)" v={res.details.emails.join(", ")} />
              <Fact k="Subject" v={res.details.subjectFormat} />
              <Fact k="Include" v={res.details.include.join(", ")} />
              <Fact k="Deadline" v={res.details.deadline} />
              {res.details.skills.length > 0 && <div className="flex flex-wrap gap-1 pt-1">{res.details.skills.map((s) => <span key={s} className="text-xs rounded-full border border-border px-2 py-0.5">{s}</span>)}</div>}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={track} disabled={saved}>{saved ? <><Check size={14} className="mr-1" /> In tracker</> : <><Plus size={14} className="mr-1" /> Save to tracker</>}</Button>
                <Button size="sm" variant="outline" onClick={tailorResume}><FileText size={14} className="mr-1" /> Tailor resume for this</Button>
              </div>
            </Card>

            <Card className="p-4 space-y-2 text-sm">
              <h2 className="font-semibold">Official posting</h2>
              {res.official.length ? res.official.map((o) => (
                <div key={o.url}>
                  <a className="font-medium hover:underline inline-flex items-center gap-1" href={o.url} target="_blank" rel="noreferrer">{o.title} <ExternalLink size={13} /></a>
                  <div className="text-xs text-muted-foreground">{[o.location, o.ats, `${o.similarity}% title match`].filter(Boolean).join(" · ")}</div>
                </div>
              )) : <p className="text-muted-foreground">Not found on a public job board (Greenhouse / Lever / Ashby). Apply the way the post asks.</p>}
              {res.scan.urls.length > 0 && (
                <div className="pt-1"><div className="text-xs font-medium">Links in the post</div>
                  {res.scan.urls.map((u) => <a key={u} className="block text-xs underline break-all" href={u} target="_blank" rel="noreferrer">{u}{detectAtsVendor(u) !== "unknown" ? ` (${detectAtsVendor(u)})` : ""}</a>)}
                </div>
              )}
            </Card>

            {res.ats && (
              <Card className="p-4 space-y-2 text-sm">
                <div className="flex justify-between gap-2"><h2 className="font-semibold">Resume check: {res.ats.label}</h2><span className="font-semibold">{res.ats.score}/100</span></div>
                <ul className="text-xs space-y-1">
                  {res.ats.checks.filter((c) => !c.passed).map((c) => <li key={c.id} className="flex gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-yellow-600" /><span><strong>{c.label}:</strong> {c.detail}</span></li>)}
                  {res.ats.checks.every((c) => c.passed) && <li>All checks passed.</li>}
                </ul>
                <ul className="text-xs list-disc pl-4 text-muted-foreground">{res.ats.tips.slice(0, 3).map((t) => <li key={t}>{t}</li>)}</ul>
              </Card>
            )}

            {res.research.length > 0 && (
              <Card className="p-4 space-y-2 text-sm">
                <h2 className="font-semibold">About {res.details.company}</h2>
                {res.research.map((r) => (
                  <div key={r.url}><a className="text-xs font-medium underline" href={r.url} target="_blank" rel="noreferrer">{r.title}</a><p className="text-xs text-muted-foreground">{r.snippet}</p></div>
                ))}
              </Card>
            )}
          </div>

          <div className="lg:col-span-3 space-y-4">
            {(res.replies.missingInfo.length > 0 || res.replies.warnings.length > 0) && (
              <Card className="p-4 text-sm space-y-1 border-yellow-500/50">
                {res.replies.missingInfo.length > 0 && <p><strong>Fill in before sending:</strong> {res.replies.missingInfo.join(", ")} (replace each [ADD: …]). Save them under Profile → Saved answers to reuse.</p>}
                {res.replies.warnings.map((w) => <p key={w} className="text-xs text-yellow-700 dark:text-yellow-400">{w}</p>)}
              </Card>
            )}

            <Card className="p-4 space-y-2">
              <h2 className="font-semibold flex items-center gap-2"><Mail size={16} /> Email</h2>
              <div className="flex flex-col md:flex-row gap-2">
                <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" list="post-emails" aria-label="To" />
                <datalist id="post-emails">
                  {[...res.details.emails, ...res.contacts.map((c) => c.email)].map((e) => <option key={e} value={e} />)}
                </datalist>
              </div>
              {res.contacts.length > 0 && <p className="text-xs text-muted-foreground">From your contacts at {res.details.company}: {res.contacts.map((c) => `${c.name || c.email}${c.title ? ` (${c.title})` : ""}`).join(", ")}</p>}
              {!to && <p className="text-xs text-muted-foreground">The post has no email. Use the DM below, or an official address from the company&apos;s careers page (don&apos;t guess addresses).</p>}
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
              <textarea rows={12} className={area} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Email body" />
              <div className="flex flex-wrap gap-2">
                <a href={to ? gmailComposeUrl(to, subject, body) : undefined} target="_blank" rel="noreferrer" aria-disabled={!to}><Button size="sm" disabled={!to}><ExternalLink size={14} className="mr-1" /> Open in Gmail</Button></a>
                <a href={to ? mailtoUrl(to, subject, body) : undefined} aria-disabled={!to}><Button size="sm" variant="outline" disabled={!to}>Mail app</Button></a>
                <CopyButton text={`Subject: ${subject}\n\n${body}`} />
              </div>
              <p className="text-xs text-muted-foreground"><strong>Attach your resume PDF</strong> before sending (tailor it first with “Tailor resume for this”).</p>
            </Card>

            <Card className="p-4 space-y-2">
              <h2 className="font-semibold">LinkedIn message</h2>
              <textarea rows={7} className={area} value={dm} onChange={(e) => setDm(e.target.value)} aria-label="LinkedIn message" />
              <div className="flex flex-wrap gap-2 items-center">
                <CopyButton text={dm} />
                {res.postUrl && <a href={res.postUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><ExternalLink size={14} className="mr-1" /> Open the post</Button></a>}
                <span className="text-xs text-muted-foreground">{dm.length} characters</span>
              </div>
            </Card>

            <Card className="p-4 space-y-2">
              <h2 className="font-semibold">Connection request note</h2>
              <textarea rows={3} className={area} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Connection note" />
              <div className="flex gap-2 items-center">
                <CopyButton text={note} />
                <span className={`text-xs ${note.length > 300 ? "text-destructive" : "text-muted-foreground"}`}>{note.length}/300</span>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return <div className="flex gap-2"><span className="text-muted-foreground w-24 shrink-0">{k}</span><span className="min-w-0 break-words">{v}</span></div>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      <Copy size={14} className="mr-1" /> {done ? "Copied" : "Copy"}
    </Button>
  );
}
