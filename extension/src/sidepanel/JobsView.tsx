import { useEffect, useState } from "react";
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from "@internova/core";
import { deleteApplication, getApplications, saveApplication } from "../storage";

export function JobsView() {
  const [apps, setApps] = useState<Application[]>([]);
  const [filter, setFilter] = useState<ApplicationStatus | "all">("all");

  useEffect(() => {
    const refresh = () => getApplications().then(setApps);
    refresh();
    const onChange = (c: Record<string, chrome.storage.StorageChange>) => c.applications && refresh();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s.id, apps.filter((a) => a.status === s.id).length]));
  const shown = filter === "all" ? apps : apps.filter((a) => a.status === filter);
  const today = new Date().toISOString().slice(0, 10);
  const due = apps.filter((a) => a.followUpOn && a.followUpOn <= today && !["offer", "rejected", "withdrawn"].includes(a.status));

  return (
    <div className="stack">
      <div className="chips filter" role="group" aria-label="Filter by status">
        <button className={`chip btnchip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All {apps.length}</button>
        {APPLICATION_STATUSES.map((s) => (
          <button key={s.id} className={`chip btnchip ${filter === s.id ? "on" : ""}`} onClick={() => setFilter(s.id)}>
            {s.label} {counts[s.id] || 0}
          </button>
        ))}
      </div>

      {due.length > 0 && (
        <div className="card warn">
          <strong>{due.length} follow-up{due.length > 1 ? "s" : ""} due</strong>
          <p className="small">{due.map((a) => `${a.title} · ${a.company}`).join("; ")}</p>
        </div>
      )}

      {apps.length === 0 && (
        <div className="card subtle">
          <h3>No tracked jobs yet</h3>
          <p className="muted small">Click <strong>Save job</strong> after analyzing a posting, or <strong>Track as applied</strong> after autofilling an application.</p>
        </div>
      )}

      {shown.map((a) => <AppCard key={a.id} app={a} />)}
    </div>
  );
}

function AppCard({ app }: { app: Application }) {
  const [notes, setNotes] = useState(app.notes);
  useEffect(() => setNotes(app.notes), [app.notes]);
  const update = (patch: Partial<Application>) =>
    saveApplication({ ...app, ...patch, ...(patch.status === "applied" && !app.appliedAt ? { appliedAt: Date.now() } : {}) });

  return (
    <div className="card app">
      <div className="row">
        <div>
          <a className="job-title" href={app.url} target="_blank" rel="noreferrer">{app.title || "Untitled job"}</a>
          <div className="muted small">{[app.company, app.location].filter(Boolean).join(" · ")}</div>
        </div>
        {app.score !== null && <span className="chip">{app.score}/100</span>}
      </div>
      <div className="grid2">
        <label className="field">
          <span className="label">Status</span>
          <select value={app.status} onChange={(e) => update({ status: e.target.value as ApplicationStatus })}>
            {APPLICATION_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Follow up on</span>
          <input type="date" value={app.followUpOn} onChange={(e) => update({ followUpOn: e.target.value })} />
        </label>
      </div>
      <div className="muted small">
        {[app.resumeName && `Resume: ${app.resumeName}`, app.deadline && `Deadline: ${app.deadline}`, app.appliedAt && `Applied ${new Date(app.appliedAt).toLocaleDateString()}`]
          .filter(Boolean).join(" · ")}
      </div>
      <textarea rows={2} value={notes} placeholder="Notes: referral, interview dates, contacts…" onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== app.notes && update({ notes })} />
      <div className="row gap">
        <button className="btn ghost small" onClick={() => confirm(`Remove “${app.title}” from your tracker?`) && deleteApplication(app.id)}>Remove</button>
      </div>
    </div>
  );
}
