"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Save, Trash2, Upload } from "lucide-react";
import {
  analyzeResume,
  BASIC_FIELDS,
  COMMON_QUESTIONS,
  EMPTY_EDUCATION,
  EMPTY_EXPERIENCE,
  EMPTY_PROFILE,
  EMPTY_PROJECT,
  EMPTY_PUBLICATION,
  knownAnswer,
  mergeProfile,
  profileFromResume,
  QUESTION_CATEGORIES,
  scoreATS,
  type CandidateProfile,
  type StoredResume,
} from "@internova/core";
import { Button, Card, Input } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { deleteResume, listResumes, loadProfile, saveProfile, saveResume } from "@/lib/data";

type Status = { kind: "info" | "ok" | "error"; text: string } | null;

export default function ProfilePage() {
  const [profile, setProfile] = useState<CandidateProfile>(EMPTY_PROFILE);
  const [saved, setSaved] = useState<CandidateProfile>(EMPTY_PROFILE);
  const [resumes, setResumes] = useState<StoredResume[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [aiDrafted, setAiDrafted] = useState<Set<string>>(new Set());
  const latest = useRef(profile);
  latest.current = profile;

  useEffect(() => {
    Promise.all([loadProfile(), listResumes()])
      .then(([p, r]) => {
        if (p) { setProfile(p); setSaved(p); }
        setResumes(r);
      })
      .catch((e) => setStatus({ kind: "error", text: `Couldn't load your profile: ${e.message}` }))
      .finally(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify({ ...profile, updatedAt: 0 }) !== JSON.stringify({ ...saved, updatedAt: 0 });
  const set = <K extends keyof CandidateProfile>(k: K, v: CandidateProfile[K]) => setProfile((p) => ({ ...p, [k]: v }));

  async function persist(p: CandidateProfile) {
    const s = await saveProfile(p);
    setProfile(s);
    setSaved(s);
    return s;
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setStatus({ kind: "info", text: `Reading ${file.name}…` });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch("/resume/extract", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? `Upload failed (${res.status})`);
      const resume = await saveResume({ id: crypto.randomUUID(), name: file.name.replace(/\.pdf$/i, ""), text: body.text, addedAt: Date.now() }, file);
      setResumes((r) => [...r, resume]);

      // Fill empty profile fields: rules first, then an optional AI pass (never overwrites your edits)
      await persist(mergeProfile(latest.current, profileFromResume(resume.text)));
      setStatus({ kind: "info", text: `Filled your profile from “${resume.name}”. AI is checking for anything the rules missed…` });
      const ai = await fetch("/api/parse-resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: resume.text }) });
      if (ai.ok) {
        await persist(mergeProfile(latest.current, await ai.json()));
        setStatus({ kind: "ok", text: `Filled your profile from “${resume.name}”. Review each section below.` });
      } else {
        setStatus({ kind: "ok", text: `Filled your profile from “${resume.name}” (rules only${ai.status === 503 ? "; AI isn't configured on this server" : ""}). Review each section below.` });
      }
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function draftBlank() {
    const blank = COMMON_QUESTIONS.filter((q) => q.ai && !knownAnswer(q, profile));
    if (!blank.length) return setStatus({ kind: "info", text: "Every AI-answerable question already has an answer." });
    setDrafting(true);
    if (dirty) await persist(profile);
    const res = await fetch("/api/draft-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: blank.map((q) => ({ id: q.id, question: q.question })) }),
    });
    setDrafting(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setStatus({ kind: "error", text: body.error ?? `Drafting failed (${res.status})` });
    setProfile((p) => ({ ...p, answers: { ...p.answers, ...body.answers } }));
    setAiDrafted(new Set(Object.keys(body.answers)));
    setStatus({ kind: "ok", text: `Drafted ${Object.keys(body.answers).length} answers. Edit them so they sound like you, then save.` });
  }

  if (loading) return <div className="p-8 flex items-center gap-2"><Loader2 className="animate-spin" /> Loading your profile…</div>;

  return (
    <div className="container mx-auto p-6 pt-16 max-w-4xl space-y-6 pb-28">
      <div>
        <h1 className="text-3xl font-bold">Your profile</h1>
        <p className="text-muted-foreground">Shared with the JobPilot browser extension. Upload a resume and the sections below fill in automatically.</p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-semibold">Resumes</h2>
          <label className="inline-flex items-center gap-2 cursor-pointer rounded-md bg-primary text-primary-foreground px-4 h-10 text-sm font-medium hover:bg-primary/90">
            {uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Upload PDF
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={onUpload} disabled={uploading} />
          </label>
        </div>
        {resumes.length === 0 && <p className="text-sm text-muted-foreground">No resumes yet. Uploading one fills your profile automatically.</p>}
        <ul className="divide-y divide-border">
          {resumes.map((r) => {
            const a = analyzeResume(r.text);
            return (
              <li key={r.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{a.wordCount} words · {a.skills.size} skills · ATS {scoreATS(a).score}/100 · added {new Date(r.addedAt).toLocaleDateString()}</div>
                </div>
                <Button variant="ghost" size="sm" aria-label={`Delete ${r.name}`} onClick={async () => {
                  if (!confirm(`Delete “${r.name}”?`)) return;
                  await deleteResume(r.id);
                  setResumes((all) => all.filter((x) => x.id !== r.id));
                }}><Trash2 size={16} /></Button>
              </li>
            );
          })}
        </ul>
      </Card>

      {status && (
        <div role="status" className={`rounded-md border p-3 text-sm ${status.kind === "error" ? "border-destructive text-destructive" : status.kind === "ok" ? "border-green-600/40 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "border-border bg-muted"}`}>
          {status.text}
        </div>
      )}

      <Section title="Basics" open>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {BASIC_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} wide={f.wide}>
              <Input value={profile[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            </Field>
          ))}
          <Field label="Headline" wide><Input value={profile.headline} placeholder="e.g. B.Tech CSE student building LLM apps" onChange={(e) => set("headline", e.target.value)} /></Field>
          <Field label="Summary" wide><TextArea rows={4} value={profile.summary} onChange={(v) => set("summary", v)} /></Field>
        </div>
      </Section>

      <Section title={`Education (${profile.education.length})`}>
        <ListEditor items={profile.education} empty={EMPTY_EDUCATION} onChange={(v) => set("education", v)} addLabel="Add education"
          title={(e) => [e.degree, e.school].filter(Boolean).join(", ")}
          fields={[{ key: "school", label: "School / university", wide: true }, { key: "degree", label: "Degree" }, { key: "major", label: "Major / branch" },
            { key: "startYear", label: "Start year" }, { key: "endYear", label: "End / graduation year" }, { key: "cgpa", label: "CGPA / GPA" }, { key: "cgpaScale", label: "Scale (10 or 4)" }]} />
      </Section>

      <Section title={`Work experience (${profile.experience.length})`}>
        <ListEditor items={profile.experience} empty={EMPTY_EXPERIENCE} onChange={(v) => set("experience", v)} addLabel="Add experience"
          title={(e) => [e.title, e.company].filter(Boolean).join(" · ")}
          fields={[{ key: "title", label: "Title" }, { key: "company", label: "Company" }, { key: "start", label: "Start" }, { key: "end", label: "End" },
            { key: "location", label: "Location", wide: true }, { key: "description", label: "What you did (one point per line)", wide: true, multiline: true }]} />
      </Section>

      <Section title={`Projects (${profile.projects.length})`}>
        <ListEditor items={profile.projects} empty={EMPTY_PROJECT} onChange={(v) => set("projects", v)} addLabel="Add project" title={(p) => p.name}
          fields={[{ key: "name", label: "Name" }, { key: "link", label: "Link (GitHub / live)" }, { key: "tech", label: "Tech used", wide: true },
            { key: "description", label: "Description (one point per line)", wide: true, multiline: true }]} />
      </Section>

      <Section title={`Skills (${profile.skills.length})`}>
        <ListText value={profile.skills} separator="," rows={3} onCommit={(v) => set("skills", v)} placeholder="Python, React, LangGraph…" />
      </Section>

      <Section title={`Publications (${profile.publications.length})`}>
        <ListEditor items={profile.publications} empty={EMPTY_PUBLICATION} onChange={(v) => set("publications", v)} addLabel="Add publication" title={(p) => p.title}
          fields={[{ key: "title", label: "Title", wide: true }, { key: "venue", label: "Venue / journal" }, { key: "year", label: "Year" }, { key: "link", label: "Link", wide: true }]} />
      </Section>

      <Section title="Certifications & achievements">
        <Field label="Certifications (one per line)" wide><ListText value={profile.certifications} separator={"\n"} rows={3} onCommit={(v) => set("certifications", v)} /></Field>
        <Field label="Achievements (one per line)" wide><ListText value={profile.achievements} separator={"\n"} rows={3} onCommit={(v) => set("achievements", v)} /></Field>
      </Section>

      <Section title="Additional information" open>
        <p className="text-sm text-muted-foreground">Anything autofill and AI should know that isn't in your resume: LLMs and tools you've used, hours you can commit, preferred locations, demo links…</p>
        <TextArea rows={6} value={profile.additionalInfo} onChange={(v) => set("additionalInfo", v)}
          placeholder="e.g. Built agents with LangGraph + GPT-4o and Llama 3 (Groq). Available full-time May–Aug 2026. Open to Bengaluru or remote." />
      </Section>

      <Section title="Common questions" open>
        <p className="text-sm text-muted-foreground">
          Answer once; forms reuse it (on the web and in the extension). Blank answers in the first four groups can be drafted by AI from your profile. Eligibility & logistics answers come only from you.
        </p>
        <Button variant="outline" onClick={draftBlank} disabled={drafting}>{drafting ? <><Loader2 className="animate-spin mr-2" size={16} />Drafting…</> : "Draft blank answers with AI"}</Button>
        {QUESTION_CATEGORIES.map((cat) => (
          <div key={cat.id} className="space-y-3 pt-4 border-t border-border">
            <h3 className="text-sm font-semibold text-muted-foreground">{cat.label}</h3>
            {COMMON_QUESTIONS.filter((q) => q.category === cat.id).map((q) => {
              const derived = q.derive?.(profile).trim();
              return (
                <Field key={q.id} label={q.question} wide badge={aiDrafted.has(q.id) && profile.answers[q.id] ? "AI draft, review" : undefined}>
                  <TextArea
                    rows={q.category === "logistics" || q.derive ? 2 : 4}
                    value={profile.answers[q.id] ?? ""}
                    placeholder={derived ? `Auto: ${derived.split("\n").join(", ").slice(0, 120)}` : q.ai ? "Leave blank: AI drafts it from your profile when needed" : q.hint ?? "Only you can answer this"}
                    onChange={(v) => {
                      setProfile((p) => ({ ...p, answers: { ...p.answers, [q.id]: v } }));
                      setAiDrafted((s) => { const n = new Set(s); n.delete(q.id); return n; });
                    }}
                  />
                </Field>
              );
            })}
          </div>
        ))}
      </Section>

      <div className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 backdrop-blur p-3">
        <div className="container mx-auto max-w-4xl flex items-center gap-4">
          <Button onClick={() => persist(profile).then(() => setStatus({ kind: "ok", text: "Profile saved." }), (e) => setStatus({ kind: "error", text: e.message }))} disabled={!dirty}>
            <Save className="mr-2" size={16} /> {dirty ? "Save profile" : "All changes saved"}
          </Button>
          {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ small building blocks ------------------------------ */

function Section({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-lg border border-border bg-card shadow-sm">
      <summary className="cursor-pointer list-none p-5 flex justify-between items-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>▸</span>
      </summary>
      <div className="px-5 pb-5 space-y-3">{children}</div>
    </details>
  );
}

function Field({ label, wide, badge, children }: { label: string; wide?: boolean; badge?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-sm font-medium flex items-center gap-2">
        {label}
        {badge && <span className="text-xs rounded-full px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">{badge}</span>}
      </span>
      {children}
    </label>
  );
}

function TextArea({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
  );
}

function ListText({ value, separator, rows, placeholder, onCommit }: { value: string[]; separator: string; rows: number; placeholder?: string; onCommit: (v: string[]) => void }) {
  const joined = value.join(separator === "," ? ", " : separator);
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  return (
    <textarea rows={rows} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text.split(separator).map((s) => s.trim()).filter(Boolean))}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
  );
}

interface FieldSpec<T> { key: keyof T & string; label: string; wide?: boolean; multiline?: boolean }

function ListEditor<T extends object>({ items, empty, onChange, fields, addLabel, title }: {
  items: T[]; empty: T; onChange: (v: T[]) => void; fields: FieldSpec<T>[]; addLabel: string; title: (t: T) => string;
}) {
  const update = (i: number, k: keyof T, v: string) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <details key={i} open={!title(item)} className="rounded-md border border-border bg-muted/40 p-3">
          <summary className="cursor-pointer flex items-center justify-between gap-2">
            <span className="font-medium">{title(item) || "New entry"}</span>
            <Button variant="ghost" size="sm" onClick={(e) => { e.preventDefault(); onChange(items.filter((_, j) => j !== i)); }}>Remove</Button>
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} wide={f.wide}>
                {f.multiline
                  ? <TextArea rows={4} value={String(item[f.key] ?? "")} onChange={(v) => update(i, f.key, v)} />
                  : <Input value={String(item[f.key] ?? "")} onChange={(e) => update(i, f.key, e.target.value)} />}
              </Field>
            ))}
          </div>
        </details>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, { ...empty }])}>+ {addLabel}</Button>
    </div>
  );
}
