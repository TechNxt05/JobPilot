import { useEffect, useState } from "react";
import {
  addSkillsToProfile,
  analyzeResume,
  compileLatex,
  computeAlignment,
  latexToText,
  resumeText,
  scoreATS,
  type JobRequirements,
  jobSkillList,
  markInProfile,
  missingJobSkills,
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
import { getProfile, getResumes, saveProfile } from "../storage";
import { resumeFileName, setTailoredPdf } from "../resumeFiles";

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
export function ApplyKit({ job, jobSkills = [], missingSkills, requirements, resumeId, keySet, goTo }: {
  job: JobPosting;
  /** The job analysis's requirements: the tailored resume is scored against the same list as the Analyze breakdown */
  requirements?: JobRequirements;
  /** Skills the job analysis scraped from the posting (required + preferred) */
  jobSkills?: string[];
  /** The breakdown's missing skills for the selected resume: the picker lists exactly these */
  missingSkills?: string[];
  resumeId: string | null;
  keySet: boolean;
  goTo: (t: "settings") => void;
}) {
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

  // ---- skills the job wants that the chosen resume doesn't show ----
  const [missing, setMissing] = useState<{ skill: string; inProfile: boolean }[]>([]);
  const [jobSkillCount, setJobSkillCount] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [savedToProfile, setSavedToProfile] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const [profile, resumes] = await Promise.all([getProfile(), getResumes()]);
      const resume = resumes.find((r) => r.id === resumeId) ?? resumes[resumes.length - 1];
      const list = missingSkills && jobSkills.length
        ? markInProfile(missingSkills, profile)
        : missingJobSkills(job.text, resume?.text ?? "", profile, jobSkills);
      if (!live) return;
      setMissing(list);
      setJobSkillCount(jobSkillList(job.text, jobSkills).length);
      setPicked(new Set(list.map((m) => m.skill))); // all ticked: untick what you don't want
      setSavedToProfile([]);
    })().catch(() => {});
    return () => { live = false; };
  }, [job.text, resumeId, jobSkills.join("|"), (missingSkills ?? []).join("|")]);

  const toggle = (skill: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });

  /** Ticked skills go into the profile too, so every future tailored resume and autofill knows them. */
  async function syncPickedToProfile(skills: string[]) {
    const p = await getProfile();
    if (!p || !skills.length) return;
    const next = addSkillsToProfile(p, skills);
    if (next === p) return;
    await saveProfile(next);
    setSavedToProfile(next.skills.slice(p.skills.length));
    setMissing((cur) => cur.map((m) => (skills.includes(m.skill) ? { ...m, inProfile: true } : m)));
  }

  /** The latest tailored PDF is offered in Autofill for this job's resume upload field. */
  async function keepForAutofill(bytes: Uint8Array) {
    const p = await getProfile();
    await setTailoredPdf({ bytes, name: resumeFileName(p?.firstName ?? "", p?.lastName ?? "", `Resume_${slug}`), jobUrl: job.url ?? "", jobTitle: job.title ?? "", company: job.company ?? "", at: Date.now() }).catch(() => {});
  }

  async function runTailor() {
    setTailorErr(null);
    setPdf(null);
    setTailorBusy("Tailoring with AI…");
    const addSkills = missing.map((m) => m.skill).filter((s) => picked.has(s));
    await syncPickedToProfile(addSkills).catch(() => {});
    // Every skill the job asks for: tailoring keeps the bullets that show them when it trims to one page
    const allJobSkills = jobSkillList(job.text, jobSkills);
    const res = await send<TailorResult>({ type: "tailor-resume", job: jobInfo, resumeId, latex: latexIn.trim() || undefined, addSkills, jobSkills: allJobSkills });
    if (!res.ok) { setTailorBusy(""); return setTailorErr(res.error); }
    let result = res.data;
    try {
      setTailorBusy("Compiling PDF…");
      if (result.mode === "profile") {
        const out = await compileOnePage(result.resume, async (t) => (await compileLatex(t)).pdf, pdfPageCount, 6, allJobSkills);
        result = { ...result, resume: out.resume };
        setTailoredTex(out.latex);
        setPdf({ url: pdfUrl(out.pdf), pages: out.pages });
        await keepForAutofill(out.pdf);
      } else {
        let compiled = await compileLatex(result.latex);
        let pages = await pdfPageCount(compiled.pdf);
        if (pages > 1) {
          setTailorBusy("Over one page: shortening…");
          const again = await send<TailorResult>({ type: "tailor-resume", job: jobInfo, resumeId, latex: result.latex, shorten: true, addSkills, jobSkills: allJobSkills });
          if (again.ok && again.data.mode === "latex") {
            const c2 = await compileLatex(again.data.latex);
            const p2 = await pdfPageCount(c2.pdf);
            if (p2 <= pages) { result = again.data; compiled = c2; pages = p2; }
          }
        }
        setTailoredTex(result.latex);
        setPdf({ url: pdfUrl(compiled.pdf), pages });
        await keepForAutofill(compiled.pdf);
      }
    } catch (e) {
      setTailorErr(`PDF: ${compileErr(e)}`);
      setTailoredTex(result.mode === "latex" ? result.latex : renderResumeLatex(result.resume));
    } finally {
      setTailor(await rescore(result).catch(() => result));
      setTailorBusy("");
    }
  }

  /**
   * Score what's actually in the final PDF (after one-page trimming), against the same requirements as the Analyze
   * breakdown, so "Job match" before = the Analyze score for this resume.
   */
  async function rescore(r: TailorResult): Promise<TailorResult> {
    if (!requirements) return r;
    const resumes = await getResumes();
    const original = resumes.find((x) => x.id === resumeId) ?? resumes[resumes.length - 1];
    const after = analyzeResume(r.mode === "profile" ? resumeText(r.resume) : latexToText(r.latex));
    const before = original ? analyzeResume(original.text) : null;
    return {
      ...r,
      report: {
        ...r.report,
        atsAfter: scoreATS(after).score,
        alignmentAfter: computeAlignment(requirements, after).overall,
        ...(before ? { atsBefore: scoreATS(before).score, alignmentBefore: computeAlignment(requirements, before).overall } : {}),
      },
    };
  }

  if (!keySet) {
    return (
      <div className="card subtle">
        <h3>Cover letter & tailored resume</h3>
        <p className="muted small">Write a cover letter and tailor your resume to this job. Sign in (Settings → Account) to use JobPilot AI, free for 20 actions a day, or add your own key under Settings → Advanced.</p>
        <button className="btn" onClick={() => goTo("settings")}>Turn on AI</button>
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
            <textarea rows={14} value={letterText} onChange={(e) => setLetterText(e.target.value)} aria-label="Cover letter text" />
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
        {jobSkillCount > 0 && (
          <div className="skill-pick">
            {missing.length === 0 ? (
              <p className="small good-text">Your resume already shows all {jobSkillCount} skills this job asks for.</p>
            ) : (
              <>
                <p className="small">
                  <strong>Missing from your resume:</strong> {missing.length} of the {jobSkillCount} skills this job asks for.
                </p>
                <p className="hint">Ticked skills go into the tailored resume's Skills section (less relevant skills make room, so it stays one page) and are saved to your Profile for future roles. Untick any you don't want.</p>
                {[
                  { label: "In your profile", list: missing.filter((m) => m.inProfile) },
                  { label: "New to your profile: keep only the ones you really have", list: missing.filter((m) => !m.inProfile) },
                ].filter((g) => g.list.length).map((g) => (
                  <div key={g.label} className="field">
                    <span className="muted small">{g.label}</span>
                    <div className="chips">
                      {g.list.map((m) => (
                        <label key={m.skill} className={`chip pick ${picked.has(m.skill) ? "on" : ""} ${m.inProfile ? "" : "new"}`}>
                          <input type="checkbox" checked={picked.has(m.skill)} onChange={() => toggle(m.skill)} />
                          {m.skill}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="row gap">
                  <button className="btn small ghost" onClick={() => setPicked(new Set(missing.map((m) => m.skill)))}>Tick all</button>
                  <button className="btn small ghost" onClick={() => setPicked(new Set())}>Untick all</button>
                  <span className="muted small">{picked.size} will be added</span>
                </div>
              </>
            )}
          </div>
        )}
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
            {(report.addedSkills ?? []).length > 0 && (
              <div className="field">
                <span className="muted small">Added to Skills</span>
                <div className="chips">{report.addedSkills.map((s) => <span key={s} className="chip ok">{s}</span>)}</div>
              </div>
            )}
            {(report.droppedSkills ?? []).length > 0 && <p className="small muted">Removed to keep it one page (this job doesn't ask for them): {report.droppedSkills.join(", ")}</p>}
            {savedToProfile.length > 0 && <p className="small good-text">Saved to your Profile: {savedToProfile.join(", ")}</p>}
            {missing.some((m) => !picked.has(m.skill)) && <p className="small"><span className="muted">Not added (unticked):</span> {missing.filter((m) => !picked.has(m.skill)).map((m) => m.skill).join(", ")}</p>}
            {report.repeatedVerbs.length > 0 && <p className="small muted">Repeated verbs: {report.repeatedVerbs.map((v) => `${v.verb} ×${v.count}`).join(", ")}</p>}
            <div className="row gap">
              {pdf && <button className="btn small primary" onClick={() => download(pdf.url, `Resume_${slug}.pdf`)}>Download PDF</button>}
              {pdf && <span className="muted small">Ready to attach: Autofill offers it for this job's resume upload.</span>}
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
