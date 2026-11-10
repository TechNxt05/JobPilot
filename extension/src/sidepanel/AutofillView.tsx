import { useState } from "react";
import {
  EMPTY_PROFILE,
  getCommonQuestion,
  planAutofill,
  profileFromResume,
  type FieldPlan,
  type FormField,
  type JobPosting,
  type StoredResume,
  type ValueSource,
} from "@internova/core";
import { extractJobFromPage } from "../extractor";
import { fillFields, scanFormFields, type FillItem, type FillResult, type ScannedField } from "../formScanner";
import { send } from "../messages";
import { getAnswers, getProfile, saveAnswer, saveProfile } from "../storage";
import { TrackButton } from "./TrackButton";
import { NoAccessError, requestAllSites, runInAllFrames, runInFrame, runInPage } from "../tabs";

interface Row extends FieldPlan {
  /** Remember this answer (profile common question, or answer library) after filling */
  remember: boolean;
}

const rowKey = (r: { field: FormField }) => `${r.field.frameId}:${r.field.iid}`;

/** Demographic / consent fields, uploads, unanswerable choices, date pickers: no input is offered. */
const isLocked = (r: Row) =>
  (r.reason === "sensitive" && !r.questionId) || r.reason === "file" || r.reason === "format" || (r.reason === "choice" && !r.questionId);

const SOURCE_LABEL: Record<ValueSource, string> = {
  profile: "Profile",
  your_answer: "Your answer",
  derived: "From profile",
  library: "Saved answer",
  ai: "AI draft",
};

interface Props {
  resumes: StoredResume[];
  keySet: boolean;
  goTo: (tab: "profile" | "settings") => void;
}

export function AutofillView({ resumes, keySet, goTo }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [usingResumeProfile, setUsingResumeProfile] = useState(false);
  const [job, setJob] = useState<JobPosting | null>(null);
  const [result, setResult] = useState<{ filled: number; failed: { label: string; error: string }[] } | null>(null);

  async function draftRows(targets: Row[], jobCtx: JobPosting | null) {
    if (!targets.length) return;
    setAiBusy(true);
    const res = await send<Record<string, string>>({
      type: "draft-answers",
      questions: targets.map((r) => ({ id: rowKey(r), question: r.field.label })),
      job: jobCtx,
    });
    setAiBusy(false);
    setRows((rs) =>
      rs?.map((r) => {
        if (!targets.some((t) => rowKey(t) === rowKey(r))) return r;
        if (!res.ok) return { ...r, note: `AI draft failed: ${res.error}` };
        const answer = res.data[rowKey(r)];
        return answer
          ? { ...r, value: answer, selected: true, source: "ai" as const, note: "Drafted from your profile. Edit it so it sounds like you" }
          : { ...r, note: "AI couldn't answer this from your profile. Write it yourself or add details in Additional information" };
      }) ?? null,
    );
  }

  async function scan() {
    setError(null);
    setResult(null);
    setNeedsPermission(false);
    setBusy(true);
    try {
      const frames = await runInAllFrames<ScannedField[]>(scanFormFields);
      const fields: FormField[] = frames.flatMap((f) => f.result.map((r) => ({ ...r, frameId: f.frameId })));
      if (!fields.length) {
        setRows(null);
        setError("No form fields found on this page. Open the application form (usually after clicking Apply), then scan again.");
        return;
      }
      let profile = await getProfile();
      setUsingResumeProfile(!profile);
      if (!profile) {
        if (!resumes.length) {
          setError("Upload a resume in Profile first. Autofill uses your profile details.");
          return;
        }
        profile = { ...EMPTY_PROFILE, ...profileFromResume(resumes[0].text) };
      }
      const plan: Row[] = planAutofill(fields, profile, await getAnswers()).map((p) => ({ ...p, remember: true }));
      setRows(plan);

      // Job context for motivation answers (best effort; application pages often lack the description)
      const jobCtx = await runInPage<JobPosting>(extractJobFromPage).then((j) => (j && j.text.length > 200 ? j : null)).catch(() => null);
      setJob(jobCtx);
      // Questions the profile doesn't answer: one batched AI draft, reviewed before filling
      if (keySet) await draftRows(plan.filter((r) => r.aiDraftable && !r.value), jobCtx);
    } catch (e) {
      if (e instanceof NoAccessError) setNeedsPermission(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((rs) => rs?.map((r) => (rowKey(r) === key ? { ...r, ...patch } : r)) ?? null);
  }

  const toFill = rows?.filter((r) => r.selected && r.value.trim() && !isLocked(r)) ?? [];

  async function fill() {
    if (!rows) return;
    setBusy(true);
    const byFrame = new Map<number, FillItem[]>();
    for (const r of toFill) byFrame.set(r.field.frameId, [...(byFrame.get(r.field.frameId) ?? []), { iid: r.field.iid, value: r.value }]);
    const results: FillResult[] = [];
    for (const [frameId, items] of byFrame) {
      try {
        results.push(...((await runInFrame(frameId, fillFields, items)) ?? []));
      } catch (e) {
        results.push(...items.map((i) => ({ iid: i.iid, ok: false, error: (e as Error).message })));
      }
    }

    // Remember approved answers: common questions go to the profile (answer once, reuse everywhere),
    // job-specific or unrecognised questions go to the answer library.
    const filledOk = (r: Row) => results.find((x) => x.iid === r.field.iid)?.ok;
    const profile = (await getProfile()) ?? { ...EMPTY_PROFILE };
    let profileChanged = false;
    for (const r of toFill) {
      if (!r.remember || !filledOk(r) || r.source === "profile" || r.source === "derived") continue;
      const q = r.questionId ? getCommonQuestion(r.questionId) : undefined;
      if (q && !q.jobSpecific) {
        if (profile.answers[q.id]?.trim() !== r.value.trim()) {
          profile.answers[q.id] = r.value.trim();
          profileChanged = true;
        }
      } else if (r.reason === "open_question" || r.source === "library" || r.source === "ai") {
        await saveAnswer(r.field.label, r.value);
      }
    }
    if (profileChanged) await saveProfile(profile);

    const labelOf = (iid: string) => rows.find((r) => r.field.iid === iid)?.field.label || iid;
    setResult({
      filled: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).map((r) => ({ label: labelOf(r.iid), error: r.error ?? "Failed" })),
    });
    setBusy(false);
  }

  const ready = rows?.filter((r) => r.action === "fill" && r.reason === null && r.source !== "ai" && r.source !== "library" && !r.questionId) ?? [];
  const questions = rows?.filter((r) => !ready.includes(r) && (r.questionId || r.reason === "open_question" || r.source === "library" || r.source === "ai") && !isLocked(r)) ?? [];
  const needsYou = rows?.filter((r) => !ready.includes(r) && !questions.includes(r) && r.reason !== "unknown") ?? [];
  const unknown = rows?.filter((r) => r.reason === "unknown") ?? [];

  return (
    <div className="stack">
      <button className="btn primary block" onClick={scan} disabled={busy}>
        {busy && !rows ? "Scanning form…" : rows ? "Rescan form" : "Scan application form"}
      </button>
      <p className="hint">JobPilot proposes values from your Profile. You review every one, and it never submits the form.</p>

      {needsPermission && (
        <div className="card warn">
          <strong>JobPilot can't read this page yet.</strong>
          <p>Allow it on all sites to autofill company career pages? You can revoke this in chrome://extensions.</p>
          <button className="btn" onClick={async () => (await requestAllSites()) && scan()}>Allow on all sites</button>
        </div>
      )}
      {error && <div className="card error">{error}</div>}
      {usingResumeProfile && rows && (
        <div className="card subtle">
          <p className="small">Using details read from your resume. <button className="linklike" onClick={() => goTo("profile")}>Review your Profile</button> so autofill uses exactly what you want.</p>
        </div>
      )}
      {aiBusy && <div className="card subtle"><p className="small">Drafting answers from your profile…</p></div>}

      {result && (
        <div className={`card ${result.failed.length ? "warn" : "ok"}`}>
          <strong>Filled {result.filled} field{result.filled === 1 ? "" : "s"}.</strong>
          <p className="small">Filled fields are outlined in blue. Check everything, answer the remaining questions, then submit the form yourself.</p>
          {result.failed.map((f) => <p key={f.label} className="small error-text">Couldn't fill “{f.label}”: {f.error}</p>)}
          <TrackButton job={job} applied />
        </div>
      )}

      {rows && (
        <>
          <Section title={`Ready to fill (${ready.length})`}>
            {ready.length === 0 && <p className="muted small">No fields matched your profile.</p>}
            {ready.map((r) => <FieldRow key={rowKey(r)} row={r} onChange={(p) => update(rowKey(r), p)} />)}
          </Section>

          {questions.length > 0 && (
            <Section title={`Questions (${questions.length})`}>
              {questions.map((r) => (
                <QuestionRow
                  key={rowKey(r)}
                  row={r}
                  keySet={keySet}
                  aiBusy={aiBusy}
                  onChange={(p) => update(rowKey(r), p)}
                  onDraft={() => draftRows([r], job)}
                  goTo={goTo}
                />
              ))}
            </Section>
          )}

          {needsYou.length > 0 && (
            <Section title={`Needs you (${needsYou.length})`}>
              {needsYou.map((r) => (
                <div key={rowKey(r)} className="field-row">
                  <div className="row">
                    <span className="field-label">{r.field.label || r.field.name || "(unlabelled)"}</span>
                    <span className={`chip ${r.reason === "sensitive" ? "missing" : ""}`}>{REASON_LABEL[r.reason ?? "unknown"]}</span>
                  </div>
                  <p className="muted small">{r.note}</p>
                  {!isLocked(r) && <ValueInput row={r} onChange={(p) => update(rowKey(r), p)} withCheckbox />}
                </div>
              ))}
            </Section>
          )}

          {unknown.length > 0 && (
            <details className="card subtle">
              <summary>Not recognised ({unknown.length})</summary>
              <ul className="plain small">
                {unknown.map((r) => <li key={rowKey(r)}>{r.field.label || r.field.name || r.field.placeholder || "(unlabelled)"}</li>)}
              </ul>
            </details>
          )}

          <div className="sticky-actions">
            <button className="btn primary block" onClick={fill} disabled={busy || aiBusy || toFill.length === 0}>
              Fill {toFill.length} selected field{toFill.length === 1 ? "" : "s"}
            </button>
            <p className="hint center">JobPilot never clicks Submit.</p>
          </div>
        </>
      )}
    </div>
  );
}

const REASON_LABEL: Record<string, string> = {
  sensitive: "Answer on form",
  file: "Upload",
  choice: "Choose",
  no_value: "Not in profile",
  no_option: "No match",
  format: "Format",
  unknown: "Unknown",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function SourceChip({ row }: { row: Row }) {
  if (!row.source || !row.value) return null;
  return <span className={`chip ${row.source === "ai" ? "weak" : ""}`}>{SOURCE_LABEL[row.source]}</span>;
}

/** Input that matches the form control: dropdown for selects and radio groups, textarea for questions. */
function ValueInput({ row, onChange, withCheckbox, multiline }: { row: Row; onChange: (p: Partial<Row>) => void; withCheckbox?: boolean; multiline?: boolean }) {
  const set = (value: string) => onChange({ value, selected: !!value.trim() });
  const choice = row.field.tag === "select" || row.field.type === "radio";
  const control = choice ? (
    <select value={row.field.options.includes(row.value) ? row.value : ""} onChange={(e) => set(e.target.value)}>
      <option value="">Choose…</option>
      {row.field.options.filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  ) : multiline ? (
    <textarea rows={5} value={row.value} placeholder="Write your answer" onChange={(e) => set(e.target.value)} />
  ) : (
    <input value={row.value} placeholder="Type a value to fill" onChange={(e) => set(e.target.value)} />
  );
  if (!withCheckbox) return control;
  return (
    <div className="row gap">
      <input type="checkbox" aria-label={`Fill ${row.field.label}`} checked={row.selected} disabled={!row.value.trim()} onChange={(e) => onChange({ selected: e.target.checked })} />
      {control}
    </div>
  );
}

function FieldRow({ row, onChange }: { row: Row; onChange: (p: Partial<Row>) => void }) {
  return (
    <div className="field-row">
      <label className="check">
        <input type="checkbox" checked={row.selected} onChange={(e) => onChange({ selected: e.target.checked })} />
        <span className="field-label">{row.field.label || row.field.name}</span>
        {row.field.frameId !== 0 && <span className="muted small">· embedded form</span>}
      </label>
      {row.field.tag === "select" ? (
        <select value={row.value} onChange={(e) => onChange({ value: e.target.value })}>
          {row.field.options.filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input value={row.value} onChange={(e) => onChange({ value: e.target.value })} />
      )}
      {row.note && <p className="muted small">{row.note}</p>}
    </div>
  );
}

function QuestionRow({ row, keySet, aiBusy, onChange, onDraft, goTo }: {
  row: Row; keySet: boolean; aiBusy: boolean; onChange: (p: Partial<Row>) => void; onDraft: () => void; goTo: (t: "settings") => void;
}) {
  const q = row.questionId ? getCommonQuestion(row.questionId) : undefined;
  const logistics = q?.category === "logistics";
  return (
    <div className="field-row">
      <label className="check">
        <input type="checkbox" checked={row.selected} disabled={!row.value.trim()} onChange={(e) => onChange({ selected: e.target.checked })} />
        <span className="field-label">{row.field.label || "(unlabelled question)"}</span>
        <SourceChip row={row} />
      </label>
      <ValueInput row={row} onChange={onChange} multiline={row.field.tag === "textarea" || !logistics} />
      {row.note && <p className="muted small">{row.note}</p>}
      <div className="row gap">
        {row.aiDraftable && (keySet ? (
          <button className="btn small" onClick={onDraft} disabled={aiBusy}>{row.value ? "Redraft with AI" : "Draft with AI"}</button>
        ) : (
          <button className="btn ghost small" onClick={() => goTo("settings")}>Turn on AI to draft answers</button>
        ))}
        <label className="check small">
          <input type="checkbox" checked={row.remember} onChange={(e) => onChange({ remember: e.target.checked })} />
          {q && !q.jobSpecific ? "Save to my profile" : "Save to answer library"}
        </label>
      </div>
    </div>
  );
}
