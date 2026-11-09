"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { APPLICATION_STATUSES, newApplication, type Application, type ApplicationStatus } from "@internova/core";
import { Button, Card, Input } from "@/components/ui";
import { deleteApplication, listApplications, saveApplication } from "@/lib/data";

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [filter, setFilter] = useState<ApplicationStatus | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", company: "", url: "" });

  useEffect(() => {
    listApplications().then(setApps).catch((e) => setError(e.message));
  }, []);

  async function update(app: Application, patch: Partial<Application>) {
    const next = { ...app, ...patch, ...(patch.status === "applied" && !app.appliedAt ? { appliedAt: Date.now() } : {}) };
    setApps((all) => all?.map((a) => (a.id === app.id ? next : a)) ?? null);
    try { await saveApplication(next); } catch (e) { setError((e as Error).message); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const app = await saveApplication(newApplication({ title: draft.title.trim(), company: draft.company.trim(), url: draft.url.trim() }));
    setApps((all) => [app, ...(all ?? [])]);
    setDraft({ title: "", company: "", url: "" });
  }

  if (!apps) return <div className="p-8 flex items-center gap-2">{error ?? <><Loader2 className="animate-spin" /> Loading…</>}</div>;

  const shown = filter === "all" ? apps : apps.filter((a) => a.status === filter);
  const today = new Date().toISOString().slice(0, 10);
  const due = apps.filter((a) => a.followUpOn && a.followUpOn <= today && !["offer", "rejected", "withdrawn"].includes(a.status));

  return (
    <div className="container mx-auto p-6 pt-16 max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Application tracker</h1>
        <p className="text-muted-foreground">Synced with the JobPilot browser extension: jobs you save there appear here.</p>
      </div>
      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        <FilterChip on={filter === "all"} onClick={() => setFilter("all")}>All {apps.length}</FilterChip>
        {APPLICATION_STATUSES.map((s) => (
          <FilterChip key={s.id} on={filter === s.id} onClick={() => setFilter(s.id)}>{s.label} {apps.filter((a) => a.status === s.id).length}</FilterChip>
        ))}
      </div>

      {due.length > 0 && (
        <div className="rounded-md border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950 p-3 text-sm">
          <strong>{due.length} follow-up{due.length > 1 ? "s" : ""} due:</strong> {due.map((a) => `${a.title} · ${a.company}`).join("; ")}
        </div>
      )}

      <Card className="p-4">
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input required placeholder="Job title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Input placeholder="Company" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
          <Input required type="url" placeholder="Job link" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <Button type="submit">Add job</Button>
        </form>
      </Card>

      {shown.length === 0 && <p className="text-muted-foreground text-center py-8">No jobs here yet. Save them from the extension, or add one above.</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {shown.map((a) => (
          <Card key={a.id} className="p-4 space-y-3">
            <div className="flex justify-between gap-2">
              <div className="min-w-0">
                <a href={a.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline inline-flex items-center gap-1">
                  {a.title || "Untitled job"} <ExternalLink size={14} />
                </a>
                <div className="text-sm text-muted-foreground">{[a.company, a.location].filter(Boolean).join(" · ")}</div>
              </div>
              {a.score !== null && <span className="text-xs rounded-full border border-border px-2 py-0.5 h-fit">{a.score}/100</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium flex flex-col gap-1">Status
                <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={a.status}
                  onChange={(e) => update(a, { status: e.target.value as ApplicationStatus })}>
                  {APPLICATION_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium flex flex-col gap-1">Follow up on
                <Input type="date" className="h-9" value={a.followUpOn} onChange={(e) => update(a, { followUpOn: e.target.value })} />
              </label>
            </div>
            <div className="text-xs text-muted-foreground">
              {[a.resumeName && `Resume: ${a.resumeName}`, a.deadline && `Deadline: ${a.deadline}`, a.appliedAt && `Applied ${new Date(a.appliedAt).toLocaleDateString()}`].filter(Boolean).join(" · ")}
            </div>
            <Notes app={a} onSave={(notes) => update(a, { notes })} />
            <Button variant="ghost" size="sm" onClick={async () => {
              if (!confirm(`Remove “${a.title}”?`)) return;
              await deleteApplication(a.id);
              setApps((all) => all?.filter((x) => x.id !== a.id) ?? null);
            }}><Trash2 size={14} className="mr-1" /> Remove</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs rounded-full px-3 py-1 border ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
      {children}
    </button>
  );
}

function Notes({ app, onSave }: { app: Application; onSave: (n: string) => void }) {
  const [text, setText] = useState(app.notes);
  useEffect(() => setText(app.notes), [app.notes]);
  return (
    <textarea rows={2} value={text} placeholder="Notes: referral, interview dates, contacts…" onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== app.notes && onSave(text)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
  );
}
