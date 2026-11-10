import { useMemo, useState } from "react";
import {
  analyzeJobLocal,
  type AlignmentReport,
  type Dimension,
  type JobAnalysis,
  type JobPosting,
  type ResumeResult,
  type StoredResume,
} from "@internova/core";
import { extractJobFromPage } from "../extractor";
import { send } from "../messages";
import { TrackButton } from "./TrackButton";
import { ApplyKit } from "./ApplyKit";

const ALL_SITES = ["https://*/*", "http://*/*"];

interface Props {
  resumes: StoredResume[];
  keySet: boolean;
  goTo: (tab: "profile" | "settings") => void;
}

export function AnalyzeView({ resumes, keySet, goTo }: Props) {
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function analyze() {
    setError(null);
    setNeedsPermission(false);
    setBusy(true);
    setAnalysis(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");

      let job: JobPosting | undefined;
      try {
        const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobFromPage });
        job = res?.result as JobPosting | undefined;
      } catch {
        // No host permission for this site (or a chrome:// / Web Store page, which extensions can't read)
        setNeedsPermission(true);
        return;
      }
      if (!job || job.text.length < 200) {
        setError("Couldn't find a job description on this page. Select the description text, then click Analyze again.");
        return;
      }

      const local = analyzeJobLocal(job, resumes);
      setAnalysis(local);
      setSelectedId(local.recommendedResumeId);

      if (keySet && resumes.length) {
        setAiBusy(true);
        const res = await send<JobAnalysis>({ type: "analyze-ai", job });
        if (res.ok) {
          setAnalysis(res.data);
          setSelectedId(res.data.recommendedResumeId);
        } else {
          setAnalysis({ ...local, aiError: res.error });
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setAiBusy(false);
    }
  }

  async function grantAndRetry() {
    // permissions.request must run directly inside the click handler (user gesture)
    const granted = await chrome.permissions.request({ origins: ALL_SITES });
    if (granted) analyze();
  }

  const selected: ResumeResult | undefined = useMemo(
    () => analysis?.results.find((r) => r.resumeId === selectedId) ?? analysis?.results[0],
    [analysis, selectedId],
  );

  return (
    <div className="stack">
      <button className="btn primary block" onClick={analyze} disabled={busy}>
        {busy && !analysis ? "Reading page…" : "Analyze this job page"}
      </button>
      <p className="hint">Works on LinkedIn, Indeed, Greenhouse, Lever, Workday, Internshala, Naukri and most career pages. On other sites, select the job description first.</p>

      {needsPermission && (
        <div className="card warn">
          <strong>JobPilot can't read this page yet.</strong>
          <p>It only has access to major job sites by default. Allow it to read pages on other sites when you click Analyze? You can revoke this in chrome://extensions.</p>
          <button className="btn" onClick={grantAndRetry}>Allow on all sites</button>
          <p className="hint">Chrome pages (chrome://, the Web Store) can't be read by any extension.</p>
        </div>
      )}
      {error && <div className="card error">{error}</div>}

      {analysis && (
        <>
          <JobHeader analysis={analysis} />
          <TrackButton job={analysis.job} score={selected?.alignment.overall ?? null} resumeName={selected?.resumeName} deadline={analysis.requirements.deadline} />

          {!resumes.length ? (
            <div className="card">
              <p>Add a resume to see how well you match this job.</p>
              <button className="btn" onClick={() => goTo("profile")}>Add resume</button>
            </div>
          ) : selected ? (
            <>
              {analysis.results.length > 1 && (
                <div className="card">
                  <label className="label" htmlFor="resume-pick">Resume</label>
                  <select id="resume-pick" value={selected.resumeId} onChange={(e) => setSelectedId(e.target.value)}>
                    {analysis.results.map((r) => (
                      <option key={r.resumeId} value={r.resumeId}>
                        {r.resumeName} · {r.alignment.overall ?? "n/a"}{r.resumeId === analysis.recommendedResumeId ? " (best match)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <ScoreSummary result={selected} recommended={selected.resumeId === analysis.recommendedResumeId && analysis.results.length > 1} />
              <Eligibility report={selected.alignment} />
              <div className="card">
                <h3>Breakdown</h3>
                {selected.alignment.dimensions.map((d) => <DimensionRow key={d.id} d={d} />)}
                <p className="hint">
                  Requirements read by {analysis.requirements.origin === "ai" ? "AI (scores still computed by rules)" : "keyword rules"}.
                  {analysis.requirements.origin === "heuristic" && !keySet && " Turn on AI in Settings for more accurate extraction."}
                </p>
              </div>
              <AIInsights analysis={analysis} aiBusy={aiBusy} keySet={keySet} goTo={goTo} />
              <ATSCard result={selected} />
              <ApplyKit job={analysis.job} resumeId={selected.resumeId} keySet={keySet} goTo={goTo} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function JobHeader({ analysis }: { analysis: JobAnalysis }) {
  const { job, requirements } = analysis;
  return (
    <div className="card">
      <div className="job-title">{job.title ?? "Untitled job"}</div>
      <div className="muted">{[job.company, job.location].filter(Boolean).join(" · ") || "Company unknown"}</div>
      <div className="chips">
        <span className="chip">{job.source === "json-ld" ? "Structured data" : job.source === "selection" ? "Your selection" : job.source.startsWith("site:") ? job.source.slice(5) : "Page text"}</span>
        {requirements.deadline && <span className="chip">Deadline: {requirements.deadline}</span>}
      </div>
    </div>
  );
}

function band(score: number | null) {
  if (score === null) return "na";
  return score >= 75 ? "good" : score >= 50 ? "mid" : "low";
}

function ScoreSummary({ result, recommended }: { result: ResumeResult; recommended: boolean }) {
  const a = result.alignment;
  return (
    <div className="card score-card">
      <div className={`score ${band(a.overall)}`}>
        <span className="num">{a.overall ?? "–"}</span>
        <span className="of">/100</span>
      </div>
      <div>
        <div className="score-label">Job alignment</div>
        <div className="muted">{result.resumeName}{recommended ? " · best of your resumes" : ""}</div>
        {a.missingRequirements.length > 0 && (
          <div className="muted small">{a.missingRequirements.length} requirement{a.missingRequirements.length > 1 ? "s" : ""} not evidenced</div>
        )}
      </div>
    </div>
  );
}

function Eligibility({ report }: { report: AlignmentReport }) {
  if (report.eligible === "not_applicable") return null;
  const label = { met: "Eligible", not_met: "Not eligible", unknown: "Eligibility unclear" }[report.eligible];
  return (
    <div className={`card elig ${report.eligible}`}>
      <h3>{label}</h3>
      <ul className="plain">
        {report.eligibility.map((c) => (
          <li key={c.id}>
            <span className={`dot ${c.status}`} aria-hidden /> <strong>{c.label}</strong>
            <span className="muted"> · {c.detail}</span>
          </li>
        ))}
      </ul>
      {report.eligible === "not_met" && <p className="hint">Hard requirements aren't part of the alignment score. Check them before applying.</p>}
    </div>
  );
}

function DimensionRow({ d }: { d: Dimension }) {
  const [open, setOpen] = useState(false);
  const expandable = d.matched.length > 0 || d.missing.length > 0;
  return (
    <div className="dim">
      <button className="dim-head" onClick={() => expandable && setOpen(!open)} aria-expanded={open} disabled={!expandable}>
        <span className="dim-label">{d.label}</span>
        <span className={`dim-score ${band(d.score)}`}>{d.score === null ? "n/a" : `${d.score}%`}</span>
      </button>
      <div className="bar"><div className={`fill ${band(d.score)}`} style={{ width: `${d.score ?? 0}%` }} /></div>
      <div className="muted small">{d.note}{expandable ? (open ? " · hide" : " · details") : ""}</div>
      {open && (
        <div className="dim-body">
          {d.missing.length > 0 && (
            <div className="chips">
              {d.missing.map((m) => <span key={m} className="chip missing">✕ {m}</span>)}
            </div>
          )}
          {d.matched.map((ev) => (
            <div key={ev.requirement} className="evidence">
              <span className="chips">
                <span className="chip ok">✓ {ev.requirement}</span>
                {ev.strength === "listed" && <span className="chip weak" title="Counts 70%: show it in a project or experience bullet for full credit">only in skills list</span>}
              </span>
              <blockquote>{ev.resumeLine}</blockquote>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AIInsights({ analysis, aiBusy, keySet, goTo }: { analysis: JobAnalysis; aiBusy: boolean; keySet: boolean; goTo: (t: "settings") => void }) {
  if (!keySet) {
    return (
      <div className="card subtle">
        <h3>AI insights</h3>
        <p className="muted">AI-written summary and resume suggestions. Sign in (Settings → Account) to use JobPilot AI, free for 20 actions a day, or add your own key under Settings → Advanced.</p>
        <button className="btn" onClick={() => goTo("settings")}>Turn on AI</button>
      </div>
    );
  }
  if (aiBusy) return <div className="card subtle"><h3>AI insights</h3><p className="muted">Analyzing with your AI provider…</p></div>;
  if (analysis.aiError) return <div className="card error"><strong>AI analysis failed.</strong> {analysis.aiError} Showing rule-based results.</div>;
  if (!analysis.ai) return null;
  const { summary, suggestions, droppedSuggestions, resumeName } = analysis.ai;
  return (
    <div className="card">
      <h3>AI insights</h3>
      {summary && <p>{summary}</p>}
      {suggestions.length > 0 && (
        <>
          <div className="label">Suggestions for “{resumeName}”</div>
          {suggestions.map((s, i) => (
            <div key={i} className="suggestion">
              <blockquote>{s.resumeLine}</blockquote>
              <p>{s.suggestion}</p>
              {s.addresses && <span className="chip">{s.addresses}</span>}
            </div>
          ))}
        </>
      )}
      {droppedSuggestions > 0 && (
        <p className="hint">{droppedSuggestions} suggestion{droppedSuggestions > 1 ? "s were" : " was"} hidden because it quoted text that isn't in your resume.</p>
      )}
    </div>
  );
}

function ATSCard({ result }: { result: ResumeResult }) {
  const [open, setOpen] = useState(false);
  const { ats } = result;
  const failing = ats.checks.filter((c) => !c.passed);
  return (
    <div className="card">
      <button className="dim-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><h3 className="inline">ATS readability</h3> <span className="muted small">(any job)</span></span>
        <span className={`dim-score ${band(ats.score)}`}>{ats.score}/100</span>
      </button>
      {ats.warnings.map((w) => <p key={w} className="hint warn-text">{w}</p>)}
      {open ? (
        <ul className="plain">
          {ats.checks.map((c) => (
            <li key={c.id}>
              <span className={`dot ${c.passed ? "met" : c.points > 0 ? "unknown" : "not_met"}`} aria-hidden /> {c.label}
              <span className="muted small"> · {c.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{failing.length ? `${failing.length} check${failing.length > 1 ? "s" : ""} to improve · details` : "All checks passed"}</p>
      )}
    </div>
  );
}
