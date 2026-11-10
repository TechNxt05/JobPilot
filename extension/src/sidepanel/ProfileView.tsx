import { useEffect, useRef, useState } from "react";
import {
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
  type CandidateProfile,
  type SavedAnswer,
  type StoredResume,
} from "@internova/core";
import { send } from "../messages";
import { deleteAnswer, getAnswers, getProfile, saveAnswer, saveProfile } from "../storage";
import { ResumesView } from "./ResumesView";

type Status = { kind: "info" | "ok" | "error"; text: string } | null;

export function ProfileView({ resumes, keySet }: { resumes: StoredResume[]; keySet: boolean }) {
  const [profile, setProfile] = useState<CandidateProfile>(EMPTY_PROFILE);
  const [saved, setSaved] = useState<CandidateProfile>(EMPTY_PROFILE);
  const [status, setStatus] = useState<Status>(null);
  const [aiDrafted, setAiDrafted] = useState<Set<string>>(new Set());
  const [drafting, setDrafting] = useState(false);
  const latest = useRef(profile);
  latest.current = profile;

  const dirtyRef = useRef(false);
  useEffect(() => {
    const load = () => getProfile().then((p) => {
      if (p) {
        setProfile(p);
        setSaved(p);
      }
    });
    load();
    // Pick up changes made elsewhere (sync, autofill answers) unless the user has unsaved edits
    const onChange = (c: Record<string, chrome.storage.StorageChange>) => { if (c.profile && !dirtyRef.current) load(); };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const dirty = JSON.stringify({ ...profile, updatedAt: 0 }) !== JSON.stringify({ ...saved, updatedAt: 0 });
  dirtyRef.current = dirty;
  const set = <K extends keyof CandidateProfile>(key: K, value: CandidateProfile[K]) => setProfile((p) => ({ ...p, [key]: value }));

  async function persist(p: CandidateProfile) {
    const s = await saveProfile(p);
    setProfile(s);
    setSaved(s);
    return s;
  }

  /** New resume → fill empty profile fields (rules now, AI after if a key is set). Never overwrites user edits. */
  async function onResumeAdded(r: StoredResume) {
    const filled = mergeProfile(latest.current, profileFromResume(r.text));
    await persist(filled);
    setStatus({ kind: "ok", text: `Filled your profile from “${r.name}”. Review each section below.` });
    if (!keySet) return;
    setStatus({ kind: "info", text: `Filled from “${r.name}”. AI is reading it for anything the rules missed…` });
    const res = await send<Partial<CandidateProfile>>({ type: "parse-resume", resumeId: r.id });
    if (!res.ok) {
      setStatus({ kind: "error", text: `Filled with rules. AI pass failed: ${res.error}` });
      return;
    }
    await persist(mergeProfile(latest.current, res.data));
    setStatus({ kind: "ok", text: `Filled from “${r.name}”, with AI filling the gaps. Review each section below.` });
  }

  async function draftBlankAnswers() {
    const blank = COMMON_QUESTIONS.filter((q) => q.ai && !knownAnswer(q, profile));
    if (!blank.length) return setStatus({ kind: "info", text: "Every AI-answerable question already has an answer." });
    setDrafting(true);
    setStatus({ kind: "info", text: `Drafting ${blank.length} answers from your profile…` });
    // Drafts use the saved profile, so save pending edits first
    if (dirty) await persist(profile);
    const res = await send<Record<string, string>>({ type: "draft-answers", questions: blank.map((q) => ({ id: q.id, question: q.question })), job: null });
    setDrafting(false);
    if (!res.ok) return setStatus({ kind: "error", text: res.error });
    setProfile((p) => ({ ...p, answers: { ...p.answers, ...res.data } }));
    setAiDrafted(new Set(Object.keys(res.data)));
    setStatus({ kind: "ok", text: `Drafted ${Object.keys(res.data).length} answers. Edit them so they sound like you, then save.` });
  }

  return (
    <div className="stack profile">
      {resumes.length === 0 && <Onboarding keySet={keySet} />}
      <ResumesView resumes={resumes} onAdded={onResumeAdded} />
      {status && <div className={`card ${status.kind === "error" ? "error" : status.kind === "ok" ? "ok" : "subtle"}`}><p className="small">{status.text}</p></div>}

      <Section title="Basics" open>
        <div className="grid2">
          {BASIC_FIELDS.map((f) => (
            <label key={f.key} className={`field ${f.wide ? "wide" : ""}`}>
              <span className="label">{f.label}</span>
              <input value={profile[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            </label>
          ))}
          <label className="field wide">
            <span className="label">Headline</span>
            <input value={profile.headline} placeholder="e.g. B.Tech CSE student building LLM apps" onChange={(e) => set("headline", e.target.value)} />
          </label>
          <label className="field wide">
            <span className="label">Summary</span>
            <textarea rows={4} value={profile.summary} placeholder="2–4 sentences about you" onChange={(e) => set("summary", e.target.value)} />
          </label>
        </div>
      </Section>

      <Section title={`Education (${profile.education.length})`}>
        <ListEditor
          items={profile.education}
          empty={EMPTY_EDUCATION}
          onChange={(v) => set("education", v)}
          addLabel="Add education"
          title={(e) => [e.degree, e.school].filter(Boolean).join(", ") || "New entry"}
          fields={[
            { key: "school", label: "School / university", wide: true },
            { key: "degree", label: "Degree", placeholder: "B.Tech" },
            { key: "major", label: "Major / branch" },
            { key: "startYear", label: "Start year" },
            { key: "endYear", label: "End / graduation year" },
            { key: "cgpa", label: "CGPA / GPA" },
            { key: "cgpaScale", label: "Scale", placeholder: "10 or 4" },
          ]}
        />
      </Section>

      <Section title={`Work experience (${profile.experience.length})`}>
        <ListEditor
          items={profile.experience}
          empty={EMPTY_EXPERIENCE}
          onChange={(v) => set("experience", v)}
          addLabel="Add experience"
          title={(e) => [e.title, e.company].filter(Boolean).join(" · ") || "New entry"}
          fields={[
            { key: "title", label: "Title" },
            { key: "company", label: "Company" },
            { key: "start", label: "Start", placeholder: "May 2024" },
            { key: "end", label: "End", placeholder: "Present" },
            { key: "location", label: "Location", wide: true },
            { key: "description", label: "What you did (one point per line)", wide: true, multiline: true },
          ]}
        />
      </Section>

      <Section title={`Projects (${profile.projects.length})`}>
        <ListEditor
          items={profile.projects}
          empty={EMPTY_PROJECT}
          onChange={(v) => set("projects", v)}
          addLabel="Add project"
          title={(p) => p.name || "New project"}
          fields={[
            { key: "name", label: "Name" },
            { key: "link", label: "Link (GitHub / live)" },
            { key: "tech", label: "Tech used", wide: true },
            { key: "description", label: "Description (one point per line)", wide: true, multiline: true },
          ]}
        />
      </Section>

      <Section title={`Skills (${profile.skills.length})`}>
        <ListText value={profile.skills} separator="," rows={3} placeholder="Python, React, LangGraph, Docker…" onCommit={(v) => set("skills", v)} />
        <p className="hint">Comma-separated.</p>
      </Section>

      <Section title={`Publications (${profile.publications.length})`}>
        <ListEditor
          items={profile.publications}
          empty={EMPTY_PUBLICATION}
          onChange={(v) => set("publications", v)}
          addLabel="Add publication"
          title={(p) => p.title || "New publication"}
          fields={[
            { key: "title", label: "Title", wide: true },
            { key: "venue", label: "Venue / journal" },
            { key: "year", label: "Year" },
            { key: "link", label: "Link", wide: true },
          ]}
        />
      </Section>

      <Section title="Certifications & achievements">
        <span className="label">Certifications (one per line)</span>
        <ListText value={profile.certifications} separator={"\n"} rows={3} onCommit={(v) => set("certifications", v)} />
        <span className="label">Achievements (one per line)</span>
        <ListText value={profile.achievements} separator={"\n"} rows={3} onCommit={(v) => set("achievements", v)} />
      </Section>

      <Section title="Additional information" open>
        <p className="muted small">
          Anything else autofill and AI should know that isn't in your resume: LLMs, agents and tools you've used, the hours you can
          commit, preferred locations, interests, links to demos, languages you speak…
        </p>
        <textarea
          rows={6}
          value={profile.additionalInfo}
          placeholder={"e.g. Built agents with LangGraph + GPT-4o and Llama 3 (Groq). Available full-time May–Aug 2026. Open to Bengaluru or remote. Demo: https://…"}
          onChange={(e) => set("additionalInfo", e.target.value)}
        />
      </Section>

      <Section title="Common questions" open>
        <p className="muted small">
          Answer once and autofill reuses it on every form. Blank answers in the first four groups are drafted by AI from your profile when a
          form asks (you review them). Eligibility & logistics answers come only from you.
        </p>
        <div className="row gap">
          <button className="btn" onClick={draftBlankAnswers} disabled={!keySet || drafting}>
            {drafting ? "Drafting…" : "Draft blank answers with AI"}
          </button>
          {!keySet && <span className="muted small">Turn on AI in Settings (sign in, or add your own key) to draft answers.</span>}
        </div>
        {QUESTION_CATEGORIES.map((cat) => (
          <div key={cat.id} className="qgroup">
            <div className="label">{cat.label}</div>
            {COMMON_QUESTIONS.filter((q) => q.category === cat.id).map((q) => {
              const derived = q.derive?.(profile).trim();
              return (
                <label key={q.id} className="field qa">
                  <span className="q-text">
                    {q.question}
                    {aiDrafted.has(q.id) && profile.answers[q.id] && <span className="chip weak">AI draft, review</span>}
                  </span>
                  <textarea
                    rows={q.category === "logistics" || q.id === "links" || q.id === "languages" ? 2 : 4}
                    value={profile.answers[q.id] ?? ""}
                    placeholder={
                      derived ? `Auto: ${derived.split("\n").join(", ").slice(0, 120)}`
                      : q.ai ? "Leave blank: AI drafts it from your profile when a form asks"
                      : q.hint ?? "Only you can answer this. Leave blank to answer on each form"
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setProfile((p) => ({ ...p, answers: { ...p.answers, [q.id]: v } }));
                      setAiDrafted((s) => { const n = new Set(s); n.delete(q.id); return n; });
                    }}
                  />
                </label>
              );
            })}
          </div>
        ))}
      </Section>

      <AnswersCard />

      <div className="sticky-actions">
        <button className="btn primary block" onClick={() => persist(profile).then(() => setStatus({ kind: "ok", text: "Profile saved." }))} disabled={!dirty}>
          {dirty ? "Save profile" : "All changes saved"}
        </button>
      </div>
    </div>
  );
}

function Onboarding({ keySet }: { keySet: boolean }) {
  return (
    <div className="card onboarding">
      <h3>Welcome to JobPilot</h3>
      <ol className="steps">
        <li><strong>Upload your resume.</strong> Your profile fills in automatically. It's read and stored only in this browser.</li>
        <li><strong>Review your profile</strong> and add <strong>Additional information</strong> plus answers to common questions.</li>
        <li><strong>Optional:</strong> sign in (Settings → Account) for JobPilot AI: better parsing, matching, cover letters and tailored resumes, 20 free actions a day{keySet ? " (on)" : ""}.</li>
        <li>Open a job and click <strong>Analyze</strong>. On an application form, use <strong>Autofill</strong>.</li>
      </ol>
    </div>
  );
}

function Section({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="card section" open={open}>
      <summary><h3 className="inline">{title}</h3></summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

interface FieldSpec<T> {
  key: keyof T & string;
  label: string;
  wide?: boolean;
  multiline?: boolean;
  placeholder?: string;
}

function ListEditor<T extends object>({ items, empty, onChange, fields, addLabel, title }: {
  items: T[];
  empty: T;
  onChange: (items: T[]) => void;
  fields: FieldSpec<T>[];
  addLabel: string;
  title: (item: T) => string;
}) {
  const update = (i: number, key: keyof T, value: string) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  return (
    <div className="list-editor">
      {items.map((item, i) => (
        <details key={i} className="entry" open={!title(item) || title(item).startsWith("New")}>
          <summary>
            <span className="entry-title">{title(item)}</span>
            <button className="btn ghost small" aria-label={`Remove ${title(item)}`} onClick={(e) => { e.preventDefault(); onChange(items.filter((_, j) => j !== i)); }}>Remove</button>
          </summary>
          <div className="grid2">
            {fields.map((f) => (
              <label key={f.key} className={`field ${f.wide ? "wide" : ""}`}>
                <span className="label">{f.label}</span>
                {f.multiline ? (
                  <textarea rows={4} value={String(item[f.key] ?? "")} placeholder={f.placeholder} onChange={(e) => update(i, f.key, e.target.value)} />
                ) : (
                  <input value={String(item[f.key] ?? "")} placeholder={f.placeholder} onChange={(e) => update(i, f.key, e.target.value)} />
                )}
              </label>
            ))}
          </div>
        </details>
      ))}
      <button className="btn small" onClick={() => onChange([...items, { ...empty }])}>+ {addLabel}</button>
    </div>
  );
}

/** Textarea for a string list; edits are committed on blur so separators can be typed freely. */
function ListText({ value, separator, rows, placeholder, onCommit }: { value: string[]; separator: string; rows: number; placeholder?: string; onCommit: (v: string[]) => void }) {
  const joined = value.join(separator === "," ? ", " : separator);
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  const commit = () => onCommit(text.split(separator).map((s) => s.trim()).filter(Boolean));
  return <textarea rows={rows} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} />;
}

function AnswersCard() {
  const [answers, setAnswers] = useState<SavedAnswer[]>([]);
  const refresh = () => getAnswers().then(setAnswers);
  useEffect(() => {
    refresh();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => changes.answers && refresh();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return (
    <Section title={`Answer library (${answers.length})`}>
      <p className="muted small">Answers you approve on forms (for questions not in the list above) are saved here and suggested for similar questions.</p>
      {answers.map((a) => <AnswerItem key={a.id} answer={a} />)}
    </Section>
  );
}

function AnswerItem({ answer }: { answer: SavedAnswer }) {
  const [text, setText] = useState(answer.answer);
  useEffect(() => setText(answer.answer), [answer.answer]);
  return (
    <details className="answer">
      <summary>{answer.question}</summary>
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row gap">
        <button className="btn" disabled={text.trim() === answer.answer || !text.trim()} onClick={() => saveAnswer(answer.question, text)}>Save</button>
        <button className="btn ghost" onClick={() => confirm("Delete this saved answer?") && deleteAnswer(answer.id)}>Delete</button>
      </div>
    </details>
  );
}
