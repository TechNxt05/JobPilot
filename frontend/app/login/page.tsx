"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const linkError = params.get("error");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
    setBusy(false);
    if (error) return setMsg({ error: true, text: error.message });
    setSent(true);
    setMsg({ text: `We emailed ${email}. Click the sign-in link in that email, or enter the 6-digit code if the email shows one.` });
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return setMsg({ error: true, text: error.message });
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <section className="band w-full max-w-md rounded-[3px]">
      <div className="band-head">Sign in</div>
      <div className="space-y-4 p-6">
      <p className="text-sm text-muted-foreground">Same account as the JobPilot browser extension: your profile, resumes and tracked jobs are shared.</p>
      {linkError && !msg && <p className="text-sm text-destructive" role="alert">{linkError}</p>}
      {!sent ? (
        <form onSubmit={sendCode} className="space-y-3">
          <label className="label block" htmlFor="email">Email</label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <Button variant="cta" className="w-full uppercase tracking-[0.08em]" disabled={busy || !email}>{busy ? "Sending…" : "Email me a code"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <label className="label block" htmlFor="code">6-digit code</label>
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          <Button className="w-full" disabled={busy || code.trim().length < 6}>{busy ? "Verifying…" : "Verify and sign in"}</Button>
          <button type="button" className="text-sm text-muted-foreground underline" onClick={() => { setSent(false); setCode(""); setMsg(null); }}>
            Use a different email
          </button>
        </form>
      )}
      {msg && <p className={`text-sm ${msg.error ? "text-destructive" : "text-muted-foreground"}`} role={msg.error ? "alert" : undefined}>{msg.text}</p>}
      </div>
    </section>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col justify-between gap-10 bg-band p-8 text-band-ink md:p-12">
        <span className="font-narrow text-[26px] font-bold tracking-[0.02em]">JobPilot</span>
        <div className="max-w-lg space-y-5">
          <h1 className="text-[44px] md:text-[56px] leading-[1.02]">Every application on one chart.</h1>
          <ul className="space-y-2.5 text-band-ink-2">
            <li>Roles straight from company job boards, ranked against your resume.</li>
            <li>Resumes, cover letters and recruiter emails written only from facts you can back.</li>
            <li>Every application tracked from saved to offer, with follow-ups on time.</li>
          </ul>
        </div>
        <span className="fig text-band-ink-2">Nothing is ever sent or submitted without you.</span>
      </div>
      <div className="flex items-center justify-center p-6">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
