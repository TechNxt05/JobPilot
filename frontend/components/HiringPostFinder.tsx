"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2, Mail, MessageSquare, Plus, Search } from "lucide-react";
import { guessCompany, type HiringPost } from "@internova/core";
import { Button, Card, Input } from "@/components/ui";
import { importContacts } from "@/lib/outreach";

const SOURCE: Record<HiringPost["source"], string> = { linkedin: "LinkedIn", x: "X", hn: "Hacker News", web: "Web" };

/**
 * Search public hiring posts (LinkedIn / X through Google, and Hacker News "Who is hiring?").
 * "Reply" hands the post to the form below; emails can be saved straight to your contacts.
 */
export function HiringPostFinder({ onUse }: { onUse: (text: string, url: string) => void }) {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("India");
  const [recency, setRecency] = useState<"d" | "w" | "m">("w");
  const [onlyEmail, setOnlyEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<HiringPost[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/hiring-posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, location, recency }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error ?? `Failed (${r.status})`);
      setPosts(out.posts); setNotes(out.notes ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEmail(p: HiringPost, email: string) {
    try {
      await importContacts([{
        company: guessCompany(p.text) || email.split("@")[1].split(".")[0], email, name: "", title: "", country: location, city: "",
        department: "HR / Talent", roleTags: [], source: `${SOURCE[p.source]} hiring post`, linkedin: "", notes: `${role} post: ${p.url}`,
      }]);
      setSaved((s) => new Set(s).add(email));
    } catch (err) { setError((err as Error).message); }
  }

  const shown = (posts ?? []).filter((p) => !onlyEmail || p.emails.length);

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Find hiring posts</h2>
        <p className="text-xs text-muted-foreground">
          Public LinkedIn and X posts that Google has indexed, plus this month&apos;s Hacker News &ldquo;Who is hiring?&rdquo; thread. JobPilot never logs in to LinkedIn, so it sees only the search preview. Open the post, copy the full text, and paste it below for the best reply.
        </p>
      </div>
      <form onSubmit={search} className="flex flex-col md:flex-row gap-2">
        <Input required value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role, e.g. AI Engineer" />
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" className="md:max-w-44" />
        <select value={recency} onChange={(e) => setRecency(e.target.value as "d" | "w" | "m")} aria-label="Posted within" className="h-10 rounded-[3px] border border-input bg-card px-2 text-sm">
          <option value="d">Past day</option><option value="w">Past week</option><option value="m">Past month</option>
        </select>
        <Button type="submit" disabled={busy || role.trim().length < 2}>{busy ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Search size={16} className="mr-2" />} Search</Button>
      </form>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}

      {posts && (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{shown.length} posts{posts.length !== shown.length ? ` (of ${posts.length})` : ""}</span>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={onlyEmail} onChange={(e) => setOnlyEmail(e.target.checked)} /> Only posts with an email</label>
          </div>
          {shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing found. Try a broader role (e.g. &ldquo;ML Engineer&rdquo;) or a longer time range.</p>}
          <ul className="divide-y divide-border">
            {shown.map((p) => (
              <li key={p.id} className="py-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-[3px] border border-border px-1.5">{SOURCE[p.source]}</span>
                  {p.postedAt && <span>{new Date(p.postedAt).toLocaleDateString()}</span>}
                  {p.wantsDm && <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> asks for a DM</span>}
                </div>
                <a href={p.url} target="_blank" rel="noreferrer" className="font-medium hover:underline inline-flex items-center gap-1">{p.title || p.url} <ExternalLink size={13} /></a>
                <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">{p.text.split("\n").slice(1).join(" ").trim() || p.text}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {p.emails.map((em) => (
                    <Button key={em} size="sm" variant="outline" onClick={() => saveEmail(p, em)} disabled={saved.has(em)} title="Save to your contacts">
                      {saved.has(em) ? <Check size={13} className="mr-1" /> : <Mail size={13} className="mr-1" />}{em}{!saved.has(em) && <Plus size={12} className="ml-1" />}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => onUse(p.text, p.url)}>Reply to this post</Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
