"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";
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
    <Card className="w-full max-w-sm p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Sign in to JobPilot</h1>
        <p className="text-sm text-muted-foreground">Same account as the JobPilot browser extension. Your profile, resumes and tracked jobs are shared.</p>
      </div>
      {linkError && !msg && <p className="text-sm text-destructive" role="alert">{linkError}</p>}
      {!sent ? (
        <form onSubmit={sendCode} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="email">Email</label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <Button className="w-full" disabled={busy || !email}>{busy ? "Sending…" : "Email me a code"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="code">6-digit code</label>
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          <Button className="w-full" disabled={busy || code.trim().length < 6}>{busy ? "Verifying…" : "Verify and sign in"}</Button>
          <button type="button" className="text-sm text-muted-foreground underline" onClick={() => { setSent(false); setCode(""); setMsg(null); }}>
            Use a different email
          </button>
        </form>
      )}
      {msg && <p className={`text-sm ${msg.error ? "text-destructive" : "text-muted-foreground"}`} role={msg.error ? "alert" : undefined}>{msg.text}</p>}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
