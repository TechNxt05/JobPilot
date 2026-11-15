"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import type { SavedAnswer } from "@internova/core";
import { Button, Input } from "@/components/ui";
import { deleteAnswerRecord, listAnswers, saveAnswerRecord } from "@/lib/data";

const area = "w-full rounded-[3px] border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Ask the AI for a first draft of one answer, written only from the user's profile and resumes. */
async function draftOne(question: string): Promise<string> {
  const res = await fetch("/api/draft-answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questions: [{ id: "q", question }] }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
  const text = (body.answers?.q ?? "").trim();
  if (!text) throw new Error("The AI couldn't answer that from your profile. Write it yourself or add details to your profile.");
  return text;
}

/**
 * Your own questions and answers. Shared with the extension, whose autofill suggests the closest saved
 * answer when a form asks a similar question. Every answer stays editable.
 */
export function AnswerLibrary({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<SavedAnswer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    listAnswers().then(setItems).catch((e) => { setError(e.message); setItems([]); });
  }, [refreshKey]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || !a.trim()) return;
    try {
      const saved = await saveAnswerRecord({ question: q, answer: a });
      setItems((all) => [...(all ?? []), saved].sort((x, y) => x.question.localeCompare(y.question)));
      setQ(""); setA(""); setError(null);
    } catch (err) { setError((err as Error).message); }
  }

  async function draftNew() {
    if (!q.trim()) return setError("Type the question first.");
    setBusy("new"); setError(null);
    try { setA(await draftOne(q)); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Questions that aren&apos;t in the list above (for example &ldquo;Which LLMs have you used?&rdquo;). The extension suggests the closest one when a form asks something similar. AI drafts are written only from your profile and resumes; edit them before saving.
      </p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <form onSubmit={add} className="band rounded-[3px] p-4 space-y-2">
        <label className="label block" htmlFor="qa-q">New question</label>
        <Input id="qa-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Describe a project where you used LangGraph." />
        <label className="label block" htmlFor="qa-a">Your answer</label>
        <textarea id="qa-a" rows={4} className={area} value={a} onChange={(e) => setA(e.target.value)} placeholder="Write it, or let AI draft it from your profile." />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!q.trim() || !a.trim()}><Plus size={14} /> Add to library</Button>
          <Button type="button" variant="outline" onClick={draftNew} disabled={busy === "new" || !q.trim()}>
            {busy === "new" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Draft with AI
          </Button>
        </div>
      </form>

      {items === null ? (
        <p className="text-sm text-muted-foreground"><Loader2 size={14} className="inline animate-spin" /> Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved questions yet.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <AnswerRow key={it.id} item={it} busy={busy === it.id}
              onSave={async (next) => {
                const saved = await saveAnswerRecord(next);
                setItems((all) => all?.map((x) => (x.id === saved.id ? saved : x)) ?? null);
              }}
              onDelete={async () => {
                if (!confirm(`Delete “${it.question}”?`)) return;
                await deleteAnswerRecord(it.id);
                setItems((all) => all?.filter((x) => x.id !== it.id) ?? null);
              }}
              onDraft={async (question) => {
                setBusy(it.id); setError(null);
                try { return await draftOne(question); } catch (err) { setError((err as Error).message); return null; } finally { setBusy(null); }
              }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AnswerRow({ item, busy, onSave, onDelete, onDraft }: {
  item: SavedAnswer;
  busy: boolean;
  onSave: (next: SavedAnswer) => Promise<void>;
  onDelete: () => Promise<void>;
  onDraft: (question: string) => Promise<string | null>;
}) {
  const [question, setQuestion] = useState(item.question);
  const [answer, setAnswer] = useState(item.answer);
  const [saving, setSaving] = useState(false);
  const dirty = question.trim() !== item.question || answer.trim() !== item.answer;
  return (
    <li className="band rounded-[3px] p-3 space-y-2">
      <Input value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question" className="font-medium" />
      <textarea rows={4} className={area} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!dirty || saving || !question.trim() || !answer.trim()} onClick={async () => {
          setSaving(true);
          try { await onSave({ ...item, question, answer }); } finally { setSaving(false); }
        }}>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const d = await onDraft(question); if (d) setAnswer(d); }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Redraft with AI
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${item.question}`}><Trash2 size={13} /></Button>
      </div>
    </li>
  );
}
