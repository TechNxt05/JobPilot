"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/internships", label: "Internships" },
  { href: "/applications", label: "Jobs" },
  { href: "/cover-letter", label: "Cover Letter" },
  { href: "/resume-upgrade", label: "Resume Upgrade" },
  { href: "/resume-score", label: "Resume Score" },
  { href: "/profile", label: "Profile" },
];

export function AuthNav() {
  const [email, setEmail] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    supabase().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data } = supabase().auth.onAuthStateChange((_e, session) => setEmail(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!email || pathname === "/login") return null;

  return (
    <header className="absolute top-3 right-4 left-4 z-50 flex items-center gap-4 text-sm">
      <Link href="/" className="font-bold text-base mr-auto">JobPilot</Link>
      <nav className="flex gap-3 font-medium">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`hover:underline ${pathname === l.href ? "text-primary" : ""}`}>{l.label}</Link>
        ))}
      </nav>
      <span className="text-muted-foreground hidden md:inline" title={email}>{email}</span>
      <button
        className="underline text-muted-foreground"
        onClick={async () => {
          await supabase().auth.signOut();
          router.replace("/login");
          router.refresh();
        }}
      >
        Sign out
      </button>
    </header>
  );
}
