import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { cloudConfigured, currentUser, sendCode, signOut, syncNow, verifyCode } from "../cloud";

interface LastSync {
  at: number;
  pulled: number;
  pushed: number;
  deleted: number;
}

export function CloudCard() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(null);
  const [last, setLast] = useState<LastSync | null>(null);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!cloudConfigured) return;
    currentUser().then(setUser);
    const load = () => chrome.storage.local.get(["lastSync", "autoSync"]).then((r) => { setLast(r.lastSync ?? null); setAuto(r.autoSync !== false); });
    load();
    const onChange = (c: Record<string, chrome.storage.StorageChange>) => (c.lastSync || c.autoSync) && load();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  if (!cloudConfigured) {
    return (
      <div className="card subtle">
        <h3>Account & sync</h3>
        <p className="muted small">This build is local-only: everything stays in this browser. Builds with Supabase configured can sync your profile, resumes, answers and tracked jobs across devices.</p>
      </div>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ error: true, text: (e as Error).message }); } finally { setBusy(false); }
  };

  if (!user) {
    return (
      <div className="card">
        <h3>Account & sync</h3>
        <p className="muted small">Optional. Sign in with a one-time email code to back up and sync your profile, resumes, saved answers and tracked jobs. Your AI key is never synced.</p>
        {!codeSent ? (
          <form className="row gap" onSubmit={(e) => { e.preventDefault(); run(async () => { await sendCode(email); setCodeSent(true); setMsg({ text: `We emailed a 6-digit code to ${email}.` }); }); }}>
            <input type="email" required value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} aria-label="Account email" />
            <button className="btn primary" disabled={busy || !email}>Email me a code</button>
          </form>
        ) : (
          <form className="row gap" onSubmit={(e) => { e.preventDefault(); run(async () => { const u = await verifyCode(email, code); setUser(u); setMsg({ text: "Signed in. Syncing…" }); const r = await syncNow(); setMsg({ text: `Synced: ${r.pulled} down, ${r.pushed} up.` }); }); }}>
            <input inputMode="numeric" autoComplete="one-time-code" required value={code} placeholder="6-digit code" onChange={(e) => setCode(e.target.value)} aria-label="Code" />
            <button className="btn primary" disabled={busy || code.length < 6}>Verify</button>
            <button type="button" className="btn ghost" onClick={() => { setCodeSent(false); setCode(""); }}>Change email</button>
          </form>
        )}
        {msg && <p className={msg.error ? "error-text" : "muted small"}>{msg.text}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Account & sync</h3>
      <p className="small">Signed in as <strong>{user.email}</strong></p>
      <p className="muted small">{last ? `Last synced ${new Date(last.at).toLocaleString()} (${last.pulled} down, ${last.pushed} up, ${last.deleted} deleted)` : "Not synced yet"}</p>
      <label className="check small">
        <input type="checkbox" checked={auto} onChange={(e) => chrome.storage.local.set({ autoSync: e.target.checked })} />
        Sync automatically after changes
      </label>
      <div className="row gap">
        <button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = await syncNow(); setMsg({ text: `Synced: ${r.pulled} down, ${r.pushed} up, ${r.deleted} deleted.` }); })}>
          {busy ? "Syncing…" : "Sync now"}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => run(async () => { await signOut(); setUser(null); setCodeSent(false); setMsg({ text: "Signed out. Your data stays in this browser." }); })}>Sign out</button>
      </div>
      {msg && <p className={msg.error ? "error-text" : "muted small"}>{msg.text}</p>}
    </div>
  );
}
