import { useEffect, useState } from "react";
import { PROVIDERS, type ProviderId } from "@internova/core";
import { clearApiKey, configuredProviders, saveSettings, type AISettings, type ApiKeys } from "../storage";
import { send, type KeyTest } from "../messages";
import { CloudCard } from "./CloudCard";
import { hostedConfigured, type QuotaInfo } from "../hosted";

export function SettingsView({ settings, keySet, signedIn }: { settings: AISettings; keySet: boolean; signedIn: boolean }) {
  const [order, setOrder] = useState<ProviderId[]>(settings.order);
  const [models, setModels] = useState(settings.models);
  const [persistKey, setPersistKey] = useState(settings.persistKey);
  const [keys, setKeys] = useState<ApiKeys>({});
  const [saved, setSaved] = useState<ProviderId[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [tests, setTests] = useState<KeyTest[] | null>(null);

  useEffect(() => {
    setOrder(settings.order);
    setModels(settings.models);
    setPersistKey(settings.persistKey);
    configuredProviders().then(setSaved);
  }, [settings, keySet]);

  const move = (i: number, d: -1 | 1) => setOrder((o) => {
    const n = [...o];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });

  async function save() {
    await saveSettings({ order, models, persistKey }, keys);
    setKeys({});
    setSaved(await configuredProviders());
    setTests(null);
    setStatus({ kind: "info", text: "Saved." });
  }

  async function test() {
    setStatus({ kind: "info", text: "Testing keys…" });
    setTests(null);
    const res = await send<KeyTest[]>({ type: "test-key" });
    if (!res.ok) return setStatus({ kind: "error", text: res.error });
    setTests(res.data);
    const working = res.data.filter((t) => t.ok).length;
    setStatus({ kind: working ? "ok" : "error", text: `${working} of ${res.data.length} key${res.data.length === 1 ? "" : "s"} working.` });
  }

  return (
    <div className="stack">
      <CloudCard />
      <HostedAICard signedIn={signedIn} ownKeys={saved.length > 0} />
      <details className="card" open={saved.length > 0 || !hostedConfigured}>
        <summary><h3 className="inline">Advanced: your own API keys</h3></summary>
        <p className="muted small">
          Optional, for unlimited use. While any key is saved, JobPilot sends AI requests straight from your browser to your
          providers instead of using JobPilot AI. They're used in this order, <strong>falling back</strong> to the next if one fails
          (bad key, rate limit, outage).
        </p>
        {order.map((p, i) => {
          const info = PROVIDERS[p];
          const has = saved.includes(p);
          return (
            <div key={p} className="provider">
              <div className="row">
                <strong>{i + 1}. {info.label}</strong>
                <span className="row gap">
                  {has && <span className="chip ok">Key saved</span>}
                  <button className="btn ghost small" aria-label={`Move ${info.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="btn ghost small" aria-label={`Move ${info.label} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                </span>
              </div>
              <input id={`key-${p}`} type="password" autoComplete="off" aria-label={`${info.label} API key`} value={keys[p] ?? ""}
                placeholder={has ? "•••••••• (leave blank to keep)" : `Paste your ${info.label} key`} onChange={(e) => setKeys({ ...keys, [p]: e.target.value })} />
              <div className="row gap">
                <input aria-label={`${info.label} model`} value={models[p] ?? ""} placeholder={`Model: ${info.defaultModel}`} onChange={(e) => setModels({ ...models, [p]: e.target.value })} />
                <a className="small" href={info.keyUrl} target="_blank" rel="noreferrer">Get key ↗</a>
                {has && <button className="btn ghost small" onClick={async () => { await clearApiKey(p); setSaved(await configuredProviders()); setStatus({ kind: "info", text: `${info.label} key deleted.` }); }}>Delete</button>}
              </div>
            </div>
          );
        })}
        <label className="check">
          <input type="checkbox" checked={persistKey} onChange={(e) => setPersistKey(e.target.checked)} />
          Remember keys after the browser closes
        </label>
        <div className="row gap">
          <button className="btn primary" onClick={save}>Save</button>
          <button className="btn" onClick={test} disabled={!saved.length}>Test keys</button>
          {saved.length > 0 && <button className="btn ghost" onClick={async () => { await clearApiKey(); setSaved([]); setStatus({ kind: "info", text: "All keys deleted." }); }}>Delete all keys</button>}
        </div>
        {status && <p className={status.kind === "error" ? "error-text" : status.kind === "ok" ? "ok-text" : "muted small"}>{status.text}</p>}
        {tests && (
          <ul className="plain small">
            {tests.map((t) => (
              <li key={t.provider}><span className={`dot ${t.ok ? "met" : "not_met"}`} aria-hidden /> <strong>{t.provider}</strong> · {t.model}{t.ok ? " · works" : ` · ${t.error}`}</li>
            ))}
          </ul>
        )}
      </details>

      <div className="card subtle">
        <h3>Privacy</h3>
        <ul className="plain small">
          <li>JobPilot AI (when signed in, without your own keys): the job description, your profile and resume text are sent to the JobPilot server, which forwards them to its AI provider and returns the result. Nothing is stored except a count of your daily AI actions.</li>
          <li>Your own keys are sent only to their own providers, directly from this browser. JobPilot never receives them.</li>
          <li>By default keys are kept in memory and cleared when the browser closes. If you choose to remember them, they're saved unencrypted in this browser profile. Anyone with access to the profile could read them.</li>
          <li>Keys are never exposed to web pages. Only JobPilot's background worker uses them.</li>
          <li>When AI is on, the job description, your profile and resume are sent to the provider in use. Usage is billed to your account.</li>
          <li>Generating a PDF sends the resume/letter LaTeX to a public LaTeX compiler (latex.ytotech.com, or texlive.net).</li>
        </ul>
      </div>
    </div>
  );
}

function HostedAICard({ signedIn, ownKeys }: { signedIn: boolean; ownKeys: boolean }) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  useEffect(() => {
    if (!hostedConfigured || !signedIn || ownKeys) return;
    const load = () => chrome.storage.local.get("aiQuota").then((r) => setQuota(r.aiQuota ?? null));
    load();
    send<QuotaInfo | null>({ type: "ai-quota" }).then((r) => r.ok && r.data && setQuota(r.data));
    const onChange = (c: Record<string, chrome.storage.StorageChange>) => c.aiQuota && load();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [signedIn, ownKeys]);

  if (!hostedConfigured) return null;
  return (
    <div className="card">
      <h3>JobPilot AI</h3>
      {ownKeys ? (
        <p className="muted small">Using <strong>your own API keys</strong> (unlimited). Delete them under Advanced to use JobPilot AI instead.</p>
      ) : !signedIn ? (
        <p className="small">Sign in above to turn on AI: cover letters, tailored resumes, answer drafts and smarter job matching. <strong>20 free AI actions a day</strong>, no API key needed.</p>
      ) : (
        <>
          <p className="small">On. No API key needed.</p>
          {quota && (
            <>
              <div className="bar" aria-label={`${quota.remaining} of ${quota.limit} AI actions left today`}>
                <div className={`fill ${quota.remaining > quota.limit / 4 ? "good" : quota.remaining > 0 ? "mid" : "low"}`} style={{ width: `${(quota.remaining / quota.limit) * 100}%` }} />
              </div>
              <p className="muted small">{quota.remaining} of {quota.limit} AI actions left today · resets at midnight UTC</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
