import { useState } from "react";
import {
  compileLatex,
  compileOnePage,
  coverLetterText,
  LatexError,
  latexLogErrors,
  OVERLEAF_NEW_PROJECT_URL,
  parseLetterText,
  pdfPageCount,
  renderCoverLetterLatex,
  renderResumeLatex,
  type CoverLetter,
  type CoverLetterTone,
  type JobPosting,
  type LatexTailorResult,
  type TailoredResume,
  type TailorReport,
} from "@internova/core";
import { send } from "../messages";
import { getProfile } from "../storage";

type TailorResult =
  | ({ mode: "latex" } & LatexTailorResult)
  | { mode: "profile"; resume: TailoredResume; report: TailorReport };

const pdfUrl = (bytes: Uint8Array) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

function openInOverleaf(latex: string, name: string) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = OVERLEAF_NEW_PROJECT_URL;
  form.target = "_blank";
  for (const [k, v] of [["encoded_snip", encodeURIComponent(latex)], ["snip_name", name]]) {
    const i = document.createElement("input");
    i.type = "hidden";
    i.name = k;
    i.value = v;
    form.appendChild(i);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

const compileErr = (e: unknown) => (e instanceof LatexError ? `${e.message}\n${latexLogErrors(e.log)}` : (e as Error).message);

/** Cover letter + tailored resume for the analyzed job (uses the user's own AI keys). */
export function ApplyKit({ job, resumeId, keySet, goTo }: { job: JobPosting; resumeId: string | null; keySet: boolean; goTo: (t: "settings") => void }) {
  const jobInfo = { title: job.title, company: job.company, text: job.text };
  const slug = (job.company || "Job").replace(/\W+/g, "_");

  // ---- cover letter ----
  const [tone, setTone] = useState<CoverLetterTone>("professional");
  const [letter, setLetter] = useState<CoverLetter | null>(null);
  const [letterText, setLetterText] = useState("");
  const [letterBusy, setLetterBusy] = useState(false);
  const [letterErr, setLetterErr] = useState<string | null>(null);

  async function writeLetter() {
    setLetterBusy(true);
    setLetterErr(null);
    const res = await send<CoverLetter>({ type: "cover-letter", job: jobInfo, resumeId, tone });
    setLetterBusy(false);
    if (!res.ok) return setLetterErr(res.error);
    const p = await getProfile();
    setLetter(res.data);
    setLetterText(coverLetterText(res.data, [p?.firstName, p?.lastName].filter(Boolean).join(" ")));
  }

  async function letterLatex() {
    const p = await getProfile();
    const name = [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    const body = name && letterText.trim().endsWith(name) ? letterText.trim().slice(0, -name.length) : letterText;
    return renderCoverLetterLatex(parseLetterText(body), p!, job.company ?? "");
  }

  // ---- tailored resume ----
  const [latexIn, setLatexIn] = useState("");
  const [tailor, setTailor] = useState<TailorResult | null>(null);
  const [tailoredTex, setTailoredTex] = useState("");
  const [pdf, setPdf] = useState<{ url: string; pages: number } | null>(null);
  const [tailorBusy, setTailorBusy] = useState("");
  const [tailorErr, setTailorErr] = useState<string | null>(null);

  async function runTailor() {
    setTailorErr(null);
    setPdf(null);
    setTailorBusy("Tailoring with AI…");
    const res = await send<TailorResult>({ type: "tailor-resume", job: jobInfo, resumeId, latex: latexIn.trim() || undefined });
    if (!res.ok) { setTailorBusy(""); return setTailorErr(res.error); }
    let result = res.data;
    try {
      setTailorBusy("Compiling PDF…");
      if (result.mode === "profile") {
        const out = await compileOnePage(result.resume, async (t) => (await compileLatex(t)).pdf, pdfPageCount);
        result = { ...result, resume: out.resume };
        setTailoredTex(out.latex);
        setPdf({ url: pdfUrl(out.pdf), pages: out.pages });
      } else {
        let compiled = await compileLatex(result.latex);
        let pages = await pdfPageCount(compiled.pdf);
        if (pages > 1) {
          setTailorBusy("Over one page: shortening…");
          const again = await send<TailorResult>({ type: "tailor-resume", job: jobInfo, resumeId, latex: result.latex, shorten: true });
          if (again.ok && again.data.mode === "latex") {
            const c2 = await compileLatex(again.data.latex);
            const p2 = await pdfPageCount(c2.pdf);
            if (p2 <= pages) { result = again.data; compiled = c2; pages = p2; }
          }
        }
        setTailoredTex(result.latex);
        setPdf({ url: pdfUrl(compiled.pdf), pages });
      }
    } catch (e) {
      setTailorErr(`PDF: ${compileErr(e)}`);
      setTailoredTex(result.mode === "latex" ? result.latex : renderResumeLatex(result.resume));
    } finally {
      setTailor(result);
      setTailorBusy("");
    }
  }

  if (!keySet) {
    return (
      <div className="card subtle">
        <h3>Cover letter & tailored resume</h3>
        <p className="muted small">Add an AI key in Settings to write a cover letter and tailor your resume to this job.</p>
        <button className="btn" onClick={() => goTo("settings")}>Add API key</button>
      </div>
    );
  }

  const report = tailor?.report;
  const warnings = tailor?.mode === "latex" ? tailor.warnings : [];
  return (
    <>
      <div className="card">
        <h3>Cover letter</h3>
        <div className="row gap">
          <select aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value as CoverLetterTone)}>
            <option value="professional">Professional</option>
            <option value="enthusiastic">Enthusiastic</option>
            <option value="concise">Concise</option>
          </select>
          <button className="btn primary" onClick={writeLetter} disabled={letterBusy}>{letterBusy ? "Writing…" : letter ? "Rewrite" : "Write cover letter"}</button>
        </div>
        {letterErr && <p className="error-text">{letterErr}</p>}
        {letter && (
          <>
            <textarea rows={14} value={letterText} onChange={(e) => setLetterText(e.target.value)} aria-label="Cover letter" />
            {letter.warnings.length > 0 && <ul className="plain small warn-text">{letter.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
            <div className="row gap">
              <button className="btn small" onClick={() => navigator.clipboard.writeText(letterText)}>Copy</button>
              <button className="btn small" onClick={async () => {
                try { download(pdfUrl((await compileLatex(await letterLatex())).pdf), `Cover_Letter_${slug}.pdf`); }
                catch (e) { setLetterErr(`PDF: ${compileErr(e)}`); }
              }}>Download PDF</button>
              <button className="btn small ghost" onClick={async () => openInOverleaf(await letterLatex(), `Cover_Letter_${slug}.tex`)}>Open in Overleaf</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3>Tailored resume</h3>
        <p className="muted small">One page, ATS-friendly, only facts from your profile. Paste your Overleaf code to keep your design (optional).</p>
        <details>
          <summary>Overleaf / LaTeX code (optional)</summary>
          <textarea rows={8} value={latexIn} onChange={(e) => setLatexIn(e.target.value)} spellCheck={false} placeholder="Paste main.tex" className="mono" />
        </details>
        <button className="btn primary" onClick={runTailor} disabled={!!tailorBusy}>{tailorBusy || (tailor ? "Tailor again" : "Tailor my resume")}</button>
        {tailorErr && <pre className="error-text small pre">{tailorErr}</pre>}
        {report && (
          <>
            <div className="metrics">
              <div><span className="muted small">ATS</span><strong>{report.atsBefore} → {report.atsAfter}</strong></div>
              <div><span className="muted small">Job match</span><strong>{report.alignmentBefore ?? "–"} → {report.alignmentAfter ?? "–"}</strong></div>
              <div><span className="muted small">Pages</span><strong className={pdf && pdf.pages > 1 ? "error-text" : ""}>{pdf?.pages ?? "–"}</strong></div>
            </div>
            {warnings.length > 0 && <ul className="plain small warn-text">{warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
            {report.removed.length > 0 && (
              <details><summary>{report.removed.length} invented detail{report.removed.length > 1 ? "s" : ""} removed</summary>
                <ul className="plain small">{report.removed.map((r, i) => <li key={i}>“{r.text}”: {r.reason}</li>)}</ul></details>
            )}
            {report.skillGaps.length > 0 && <p className="small"><span className="muted">Skill gaps (not added):</span> {report.skillGaps.join(", ")}</p>}
            {report.repeatedVerbs.length > 0 && <p className="small muted">Repeated verbs: {report.repeatedVerbs.map((v) => `${v.verb} ×${v.count}`).join(", ")}</p>}
            <div className="row gap">
              {pdf && <button className="btn small primary" onClick={() => download(pdf.url, `Resume_${slug}.pdf`)}>Download PDF</button>}
              {tailoredTex && <button className="btn small" onClick={() => openInOverleaf(tailoredTex, `Resume_${slug}.tex`)}>Open in Overleaf</button>}
              {tailoredTex && <button className="btn small ghost" onClick={() => download(URL.createObjectURL(new Blob([tailoredTex], { type: "application/x-tex" })), `Resume_${slug}.tex`)}>.tex</button>}
            </div>
            <p className="hint">PDFs are compiled by a public LaTeX service (latex.ytotech.com / texlive.net).</p>
          </>
        )}
      </div>
    </>
  );
}
