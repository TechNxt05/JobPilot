import { useState } from "react";
import { analyzeResume, scoreATS, type StoredResume } from "@internova/core";
import { deleteResume, saveResume } from "../storage";
import { pdfToText } from "../pdf";

export function ResumesView({ resumes, onAdded }: { resumes: StoredResume[]; onAdded?: (r: StoredResume) => void }) {
  const [name, setName] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(text: string, fallbackName: string) {
    const clean = text.trim();
    if (clean.split(/\s+/).length < 50) {
      setError("That resume has very little text. If it's a scanned PDF, export a text-based PDF or paste the text instead.");
      return;
    }
    const resume = { id: crypto.randomUUID(), name: name.trim() || fallbackName, text: clean, addedAt: Date.now() };
    await saveResume(resume);
    onAdded?.(resume);
    setName("");
    setPasted("");
    setError(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError("PDF must be 5 MB or smaller.");
    setBusy(true);
    setError(null);
    try {
      await add(await pdfToText(file), file.name.replace(/\.pdf$/i, ""));
    } catch {
      setError("Couldn't read that PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h3>Add a resume</h3>
        <p className="muted small">Uploading fills your profile automatically. Add a version per target role (e.g. “SDE”, “AI/ML”) and JobPilot recommends the best one for each job. Resumes are parsed and stored only in this browser.</p>
        <label className="label" htmlFor="resume-name">Name (optional)</label>
        <input id="resume-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Software Engineer" />
        <label className="btn block file">
          {busy ? "Reading PDF…" : "Upload PDF"}
          <input type="file" accept="application/pdf,.pdf" onChange={onFile} disabled={busy} hidden />
        </label>
        <details>
          <summary>Or paste text</summary>
          <textarea rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste your resume text" />
          <button className="btn" disabled={!pasted.trim()} onClick={() => add(pasted, `Resume ${resumes.length + 1}`)}>Save</button>
        </details>
        {error && <p className="error-text">{error}</p>}
      </div>

      {resumes.map((r) => {
        const analysis = analyzeResume(r.text);
        const ats = scoreATS(analysis);
        return (
          <div key={r.id} className="card">
            <div className="row">
              <div>
                <div className="job-title">{r.name}</div>
                <div className="muted small">
                  {analysis.wordCount} words · {analysis.skills.size} skills · ATS {ats.score}/100 · added {new Date(r.addedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                className="btn ghost"
                aria-label={`Delete ${r.name}`}
                onClick={() => confirm(`Delete “${r.name}”?`) && deleteResume(r.id)}
              >
                Delete
              </button>
            </div>
            <div className="chips">
              {[...analysis.skills.keys()].slice(0, 14).map((s) => <span key={s} className="chip">{s}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
