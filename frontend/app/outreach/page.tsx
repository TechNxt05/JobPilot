"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, ExternalLink, Loader2, Mail, Sparkles, Trash2, Upload, X } from "lucide-react";
import {
  addDays,
  companyKey,
  CONTACT_STATUSES,
  worksAt,
  gmailComposeUrl,
  mailtoUrl,
  OUTREACH_STATUSES,
  parseContactsCsv,
  type Contact,
  type ImportResult,
} from "@internova/core";
import { Button, Card, Input } from "@/components/ui";
import { OUTREACH_JOB_KEY } from "@/lib/handoff";
import { deleteContacts, importContacts, listContacts, updateContact } from "@/lib/outreach";

interface JobContext { title: string; company: string; url: string; text: string }
const PAGE = 100;

export default function OutreachPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("");
  const [country, setCountry] = useState("");
  const [outreach, setOutreach] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [showImport, setShowImport] = useState(false);
  const [drafting, setDrafting] = useState<Contact | null>(null);
  const [job, setJob] = useState<JobContext | null>(null);

  const reload = () => listContacts().then(setContacts).catch((e) => { setError(e.message); setContacts([]); });

  useEffect(() => {
    listContacts()
      .catch((e) => { setError(e.message); return [] as Contact[]; })
      .then((list) => {
        // Arriving from Discover: ?company=… plus the job saved in sessionStorage
        const c = new URLSearchParams(window.location.search).get("company");
        let saved: JobContext | null = null;
        try {
          const raw = sessionStorage.getItem(OUTREACH_JOB_KEY);
          if (raw) saved = JSON.parse(raw);
        } catch { /* no saved job */ }
        if (c) setCompany(c);
        setJob(saved);
        setContacts(list);
        if (!list.length) setShowImport(true);
      });
  }, []);

  const countries = useMemo(() => [...new Set((contacts ?? []).map((c) => c.country).filter(Boolean))].sort(), [contacts]);
  const filtered = useMemo(() => {
    let list = contacts ?? [];
    if (company.trim()) list = list.filter((c) => worksAt(company, c));
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((c) => `${c.company} ${c.name} ${c.email} ${c.title} ${c.city} ${c.roleTags.join(" ")}`.toLowerCase().includes(needle));
    if (country) list = list.filter((c) => c.country === country);
    if (outreach) list = list.filter((c) => c.outreach === outreach);
    return list;
  }, [contacts, company, q, country, outreach]);

  const today = new Date().toISOString().slice(0, 10);
  const due = (contacts ?? []).filter((c) => c.outreach === "sent" && c.followUpOn && c.followUpOn <= today);

  async function patch(c: Contact, p: Partial<Contact>) {
    setContacts((all) => all?.map((x) => (x.id === c.id ? { ...x, ...p } : x)) ?? null);
    if (drafting?.id === c.id) setDrafting({ ...c, ...p });
    try { await updateContact(c.id, p); } catch (e) { setError((e as Error).message); }
  }

  async function remove(c: Contact) {
    if (!confirm(`Delete ${c.email}?`)) return;
    try {
      await deleteContacts([c.id]);
      setContacts((all) => all?.filter((x) => x.id !== c.id) ?? null);
    } catch (e) { setError((e as Error).message); }
  }

  if (!contacts) return <div className="p-8 flex items-center gap-2"><Loader2 className="animate-spin" /> Loading…</div>;

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl">Recruiter outreach</h1>
          <p className="text-muted-foreground">Your private list of recruiter and HR contacts. JobPilot drafts the email; you review it and send it from your own mail.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/outreach/post"><Button><Sparkles size={16} className="mr-2" /> Reply to a hiring post</Button></Link>
          <Button variant="outline" onClick={() => setShowImport((v) => !v)}><Upload size={16} className="mr-2" /> Import contacts</Button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
      {showImport && <ImportPanel onDone={(n) => { setShowImport(false); reload(); setError(null); alert(`${n} contacts imported.`); }} />}

      {due.length > 0 && (
        <div className="rounded-[3px] note-warn p-3 text-sm">
          <strong>{due.length} follow-up{due.length > 1 ? "s" : ""} due:</strong> {due.slice(0, 8).map((c) => `${c.name || c.email} (${c.company})`).join("; ")}{due.length > 8 ? "…" : ""}
        </div>
      )}

      {job && (
        <div className="rounded-[3px] border border-border p-3 text-sm flex items-start gap-2">
          <span className="min-w-0">Emails will be about <strong>{job.title}</strong> at {job.company}. Showing contacts at that company.</span>
          <button className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Clear job" onClick={() => {
            setJob(null); setCompany("");
            try { sessionStorage.removeItem(OUTREACH_JOB_KEY); } catch { /* ignore */ }
          }}><X size={16} /></button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name, email, role tags…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        <Input className="max-w-56" placeholder="Company" value={company} onChange={(e) => { setCompany(e.target.value); setLimit(PAGE); }} />
        <select className="h-10 rounded-[3px] border border-input bg-background px-2 text-sm" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
          <option value="">All countries</option>
          {countries.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="h-10 rounded-[3px] border border-input bg-background px-2 text-sm" value={outreach} onChange={(e) => setOutreach(e.target.value)} aria-label="Outreach status">
          <option value="">Any outreach</option>
          {OUTREACH_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className="text-sm text-muted-foreground self-center">{filtered.length} of {contacts.length}</span>
      </div>

      {company.trim() && filtered.length === 0 && contacts.length > 0 && (
        <p className="text-sm text-muted-foreground">No contacts at “{company}” in your list. Look for an official careers or recruiting address on the company&apos;s site rather than guessing one.</p>
      )}

      <div className="space-y-2">
        {filtered.slice(0, limit).map((c) => (
          <Card key={c.id} className="p-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{c.company}</span>
                <span className="text-sm">{[c.name, c.title].filter(Boolean).join(", ")}</span>
                <span className="text-sm text-muted-foreground break-all">{c.email}</span>
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                {[c.city, c.country].filter(Boolean).join(", ") && <span>{[c.city, c.country].filter(Boolean).join(", ")}</span>}
                {c.department && <span>{c.department}</span>}
                {c.roleTags.length > 0 && <span>{c.roleTags.join(" · ")}</span>}
                {c.source && <span>Source: {c.source}</span>}
                {c.lastContactedAt && <span>Last emailed {new Date(c.lastContactedAt).toLocaleDateString()}</span>}
                {c.linkedin && <a className="underline" href={c.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="h-9 rounded-[3px] border border-input bg-background px-2 text-xs" value={c.status} aria-label="Email status" onChange={(e) => patch(c, { status: e.target.value as Contact["status"] })}>
                {CONTACT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <select className="h-9 rounded-[3px] border border-input bg-background px-2 text-xs" value={c.outreach} aria-label="Outreach" onChange={(e) => patch(c, { outreach: e.target.value as Contact["outreach"] })}>
                {OUTREACH_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <Input type="date" className="h-9 w-36 text-xs" title="Follow up on" value={c.followUpOn} onChange={(e) => patch(c, { followUpOn: e.target.value })} />
              <Button size="sm" onClick={() => setDrafting(c)} disabled={c.status === "do_not_contact" || c.status === "bounced"}><Mail size={14} className="mr-1" /> Draft email</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(c)} aria-label={`Delete ${c.email}`}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ))}
        {filtered.length > limit && <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>Show more ({filtered.length - limit} left)</Button>}
      </div>

      {drafting && (
        <DraftDialog
          contact={drafting}
          job={job && companyKey(job.company) === companyKey(drafting.company) ? job : null}
          onClose={() => setDrafting(null)}
          onSent={() => patch(drafting, { outreach: "sent", lastContactedAt: new Date().toISOString(), followUpOn: addDays(7) })}
        />
      )}
    </div>
  );
}

function ImportPanel({ onDone }: { onDone: (n: number) => void }) {
  const [text, setText] = useState("");
  const [country, setCountry] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const preview: ImportResult | null = useMemo(() => (text.trim() ? parseContactsCsv(text, { country: country.trim(), source: source.trim() }) : null), [text, country, source]);

  async function file(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { setErr("Excel files: open the sheet and use File → Save as / Download → CSV, then upload that."); return; }
    setText(await f.text());
    if (!source) setSource(f.name.replace(/\.[^.]+$/, ""));
  }

  async function run() {
    if (!preview?.contacts.length) return;
    setBusy(true); setErr(null);
    try { onDone(await importContacts(preview.contacts, setProgress)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Import contacts</h2>
        <p className="text-sm text-muted-foreground">
          Upload a CSV, or copy rows from Excel / Google Sheets and paste them here. A header row like <code>Company, Name, Email, Designation, Country</code> is
          recognised; without one, each line just needs an email (the company comes from another column or the email domain). Existing emails are updated, not duplicated.
        </p>
      </div>
      <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={file} className="text-sm" />
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Company,Name,Email,Designation,Country\nRazorpay,Asha Rao,asha@razorpay.com,Talent Partner,India"}
        className="w-full rounded-[3px] border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input placeholder="Country for rows without one (e.g. India, Saudi Arabia)" value={country} onChange={(e) => setCountry(e.target.value)} />
        <Input placeholder="Source / list name (e.g. India HR list)" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      {preview && (
        <div className="text-sm space-y-1">
          <p><strong>{preview.contacts.length}</strong> contacts ready{preview.skipped.length ? `, ${preview.skipped.length} rows skipped` : ""}.</p>
          {preview.contacts.length > 0 && (
            <p className="text-xs text-muted-foreground">e.g. {preview.contacts.slice(0, 3).map((c) => `${c.company} · ${c.email}`).join("; ")}</p>
          )}
          {preview.skipped.length > 0 && (
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Skipped rows</summary>
              <ul className="mt-1 space-y-0.5">{preview.skipped.slice(0, 30).map((s, i) => <li key={i}>Line {s.line}: {s.reason}{s.text && ` · ${s.text}`}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button onClick={run} disabled={busy || !preview?.contacts.length}>
        {busy ? <><Loader2 size={16} className="animate-spin mr-2" /> Importing {progress}/{preview?.contacts.length}</> : `Import ${preview?.contacts.length ?? 0} contacts`}
      </Button>
    </Card>
  );
}

function DraftDialog({ contact, job, onClose, onSent }: { contact: Contact; job: JobContext | null; onClose: () => void; onSent: () => void }) {
  const [useJob, setUseJob] = useState(!!job);
  const [jd, setJd] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  async function generate() {
    setBusy(true); setErr(null);
    const jobCtx = useJob && job ? job : jd.trim().length >= 80 ? { title: "", url: "", text: jd } : null;
    try {
      const res = await fetch("/api/cold-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, job: jobCtx, target }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? `Failed (${res.status})`);
      setSubject(out.subject);
      setBody(`${out.body}\n\n${out.signature}`);
      setWarnings(out.warnings ?? []);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start md:items-center justify-center p-4 overflow-auto" role="dialog" aria-modal="true" aria-label={`Email ${contact.email}`}>
      <Card className="w-full max-w-2xl p-5 space-y-3 bg-background">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold">Email {contact.name || contact.company}</h2>
            <p className="text-sm text-muted-foreground break-all">{contact.email}{contact.title ? ` · ${contact.title}` : ""}</p>
          </div>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {!body && (
          <div className="space-y-2">
            {job && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useJob} onChange={(e) => setUseJob(e.target.checked)} /> About the job: <strong>{job.title}</strong></label>
            )}
            {!(useJob && job) && (
              <>
                <textarea rows={4} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Optional: paste a job description to write about a specific opening"
                  className="w-full rounded-[3px] border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="What you're looking for (e.g. AI / backend engineering roles, 2026 graduate)" />
              </>
            )}
            <Button onClick={generate} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin mr-2" /> : <Sparkles size={16} className="mr-2" />} Draft email</Button>
            <p className="text-xs text-muted-foreground">Uses 1 AI action. Written only from your profile and resume.</p>
          </div>
        )}

        {body && (
          <div className="space-y-2">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
            <textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Email body"
              className="w-full rounded-[3px] border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            {warnings.length > 0 && (
              <ul className="text-xs text-warn space-y-0.5">
                {warnings.map((w, i) => <li key={i} className="flex gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}</li>)}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Read it through, then open it in your mail. <strong>Attach your resume PDF</strong> before you press Send.</p>
            <div className="flex flex-wrap gap-2">
              <a href={gmailComposeUrl(contact.email, subject, body)} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink size={14} className="mr-1" /> Open in Gmail</Button></a>
              <a href={mailtoUrl(contact.email, subject, body)}><Button size="sm" variant="outline"><Mail size={14} className="mr-1" /> Mail app</Button></a>
              <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`); setCopied(true); }}>
                <Copy size={14} className="mr-1" /> {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="secondary" disabled={sent} onClick={() => { onSent(); setSent(true); }}>{sent ? "Marked as sent · follow-up in 7 days" : "I sent it"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setBody(""); setSubject(""); }}>Start over</Button>
            </div>
          </div>
        )}
        {err && <p className="text-destructive text-sm">{err}</p>}
      </Card>
    </div>
  );
}
