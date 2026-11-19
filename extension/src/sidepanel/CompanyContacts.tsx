import { useEffect, useState } from "react";
import { gmailComposeUrl, type JobPosting } from "@internova/core";
import { companyContacts, type CompanyContact } from "../contacts";
import { HOSTED_API } from "../hosted";
import { send } from "../messages";

interface Draft { subject: string; body: string; warnings: string[] }

const SHOWN = 3;

/** HR / recruiter emails JobPilot has for the job's company: your contact list first, then the shared HR lists. */
export function CompanyContacts({ job, keySet, resumeId }: { job: JobPosting; keySet: boolean; resumeId?: string | null }) {
  const company = job.company?.trim() ?? "";
  const [state, setState] = useState<{ contacts: CompanyContact[]; signedIn: boolean } | null>(null);
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState("");
  const [open, setOpen] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});

  /** A cold email for this contact and job, with your phone, email, LinkedIn, GitHub, portfolio and project links. */
  async function write(c: CompanyContact) {
    setOpen(c.email);
    setBusy(c.email);
    setErr((e) => ({ ...e, [c.email]: "" }));
    const res = await send<{ subject: string; body: string; signature: string; warnings: string[] }>({
      type: "cold-email",
      job: job.text.length >= 80 ? { title: job.title, url: job.url, text: job.text } : null,
      contact: { name: c.name, company, title: c.title, department: "" },
      resumeId,
    });
    setBusy("");
    if (!res.ok) return setErr((e) => ({ ...e, [c.email]: res.error }));
    setDrafts((d) => ({ ...d, [c.email]: { subject: res.data.subject, body: `${res.data.body}\n\n${res.data.signature}`, warnings: res.data.warnings } }));
  }

  useEffect(() => {
    let live = true;
    setState(null);
    setAll(false);
    if (company) companyContacts(company).then((s) => live && setState(s)).catch(() => live && setState({ contacts: [], signedIn: false }));
    return () => { live = false; };
  }, [company]);

  if (!company || !state) return null;
  const outreach = HOSTED_API ? `${HOSTED_API}/outreach` : "";
  if (!state.contacts.length) {
    return (
      <p className="hint">
        No HR emails for {company} in {state.signedIn ? "your contacts or JobPilot's HR lists" : "JobPilot's HR lists"}.
        {outreach && <> <a href={outreach} target="_blank" rel="noreferrer">{state.signedIn ? "Add contacts" : "Sign in on the website"}</a> to see your own.</>}
      </p>
    );
  }

  const copy = async (email: string) => {
    await navigator.clipboard.writeText(email).catch(() => {});
    setCopied(email);
    setTimeout(() => setCopied((c) => (c === email ? "" : c)), 1500);
  };
  const subject = `Application: ${job.title ?? "open role"}${company ? ` at ${company}` : ""}`;
  const list = all ? state.contacts : state.contacts.slice(0, SHOWN);

  return (
    <div className="card">
      <h3>Contacts at {company}</h3>
      <ul className="plain contact-list">
        {list.map((c) => (
          <li key={c.email}>
            <div className="row gap wrap">
              <span className="mono small contact-email">{c.email}</span>
              <span className={`chip ${c.status === "verified" ? "ok" : "weak"}`}>{c.status === "verified" ? "Verified" : "Unverified"}</span>
              {c.origin === "list" && <span className="chip" title="A generic careers mailbox from a shared HR list">HR list</span>}
            </div>
            {(c.name || c.title) && <div className="muted small">{[c.name, c.title].filter(Boolean).join(" · ")}</div>}
            {c.notes && <div className="muted small">{c.notes}</div>}
            <div className="row gap">
              <button className="btn small" onClick={() => copy(c.email)}>{copied === c.email ? "Copied" : "Copy"}</button>
              {keySet ? (
                <button className="btn small primary" onClick={() => (drafts[c.email] && open !== c.email ? setOpen(c.email) : write(c))} disabled={busy === c.email}>
                  {busy === c.email ? "Writing…" : drafts[c.email] ? (open === c.email ? "Rewrite" : "Show email") : "Write email"}
                </button>
              ) : (
                <a className="btn small ghost" href={gmailComposeUrl(c.email, subject, "")} target="_blank" rel="noreferrer">Email in Gmail</a>
              )}
            </div>
            {open === c.email && err[c.email] && <p className="error-text small">{err[c.email]}</p>}
            {open === c.email && drafts[c.email] && (
              <EmailDraft
                to={c.email}
                draft={drafts[c.email]}
                onChange={(d) => setDrafts((all) => ({ ...all, [c.email]: d }))}
                onCopy={() => copy(`Subject: ${drafts[c.email].subject}\n\n${drafts[c.email].body}`)}
              />
            )}
          </li>
        ))}
      </ul>
      {state.contacts.length > SHOWN && (
        <button className="linklike small" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${state.contacts.length}`}</button>
      )}
      <p className="hint">
        {state.contacts.some((c) => c.origin === "list") && "HR-list addresses are shared careers mailboxes and may be out of date. "}
        {outreach && <>Draft a cold email with your resume on the <a href={outreach} target="_blank" rel="noreferrer">Outreach page</a>.</>}
      </p>
    </div>
  );
}

/** The drafted email, editable, then handed to Gmail (you attach the resume and press Send). */
function EmailDraft({ to, draft, onChange, onCopy }: { to: string; draft: Draft; onChange: (d: Draft) => void; onCopy: () => void }) {
  return (
    <div className="email-draft">
      <label className="label">Subject</label>
      <input value={draft.subject} onChange={(e) => onChange({ ...draft, subject: e.target.value })} />
      <label className="label">Email</label>
      <textarea rows={14} value={draft.body} onChange={(e) => onChange({ ...draft, body: e.target.value })} />
      {draft.warnings.length > 0 && <ul className="plain small warn-text">{draft.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
      <div className="row gap">
        <a className="btn small primary" href={gmailComposeUrl(to, draft.subject, draft.body)} target="_blank" rel="noreferrer">Open in Gmail</a>
        <button className="btn small" onClick={onCopy}>Copy email</button>
      </div>
      <p className="hint">Attach your resume in Gmail before sending (the tailored PDF from the Apply kit is the best fit).</p>
    </div>
  );
}
