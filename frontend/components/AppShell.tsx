"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Search, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { UI_PREVIEW } from "@/lib/preview";
import { cn } from "@/components/ui";

const PRIMARY = [
  { href: "/", label: "Today" },
  { href: "/discover", label: "Discover" },
  { href: "/internships", label: "Search" },
  { href: "/applications", label: "Jobs" },
  { href: "/outreach", label: "Outreach" },
  { href: "/chat", label: "Chat" },
];

const PREPARE = [
  { href: "/outreach/post", label: "Reply to a post" },
  { href: "/cover-letter", label: "Cover letter" },
  { href: "/resume-upgrade", label: "Resume upgrade" },
  { href: "/resume-score", label: "Resume score" },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`) && !PREPARE.some((p) => p.href === path));

/** Railway-blue header band (where you are) + buff strip (tools to prepare an application, and the one Find action). */
export function AppShell() {
  const [email, setEmail] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    supabase().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data } = supabase().auth.onAuthStateChange((_e, session) => setEmail(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  if ((!email && !UI_PREVIEW) || pathname === "/login") return null;

  return (
    <header className="sticky top-0 z-40">
      <div className="bg-band text-band-ink">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 md:px-6">
          <Link href="/" className="font-narrow text-[22px] font-bold tracking-[0.02em] shrink-0">JobPilot</Link>
          <nav aria-label="Main" className="hidden h-full min-w-0 items-stretch gap-5 overflow-x-auto md:flex">
            {PRIMARY.map((l) => {
              const on = isActive(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex items-center border-b-2 pt-[2px] font-narrow text-[14px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap transition-colors",
                    on ? "border-band-ink text-band-ink" : "border-transparent text-band-ink-2 hover:text-band-ink",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm shrink-0" data-account>
            <Link href="/profile" className={cn("flex items-center gap-1.5 hover:text-band-ink", pathname === "/profile" ? "text-band-ink" : "text-band-ink-2")} title={email ?? undefined}>
              <UserRound size={16} aria-hidden /> <span className="hidden lg:inline">Profile</span>
            </Link>
            <button
              className="flex items-center gap-1.5 text-band-ink-2 hover:text-band-ink"
              onClick={async () => {
                await supabase().auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
            >
              <LogOut size={16} aria-hidden /> <span className="hidden lg:inline">Sign out</span>
            </button>
          </div>
        </div>
      </div>
      {/* Small screens: main nav gets its own scrolling row, with a fade showing there is more */}
      <nav aria-label="Main" className="flex h-10 items-stretch gap-5 overflow-x-auto bg-band px-4 [mask-image:linear-gradient(to_right,black_85%,transparent)] md:hidden">
        {PRIMARY.map((l) => (
          <Link key={l.href} href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined}
            className={cn("flex items-center border-b-2 font-narrow text-[13px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap", isActive(pathname, l.href) ? "border-band-ink text-band-ink" : "border-transparent text-band-ink-2")}>
            {l.label}
          </Link>
        ))}
        <Link href="/outreach/post" className="flex items-center border-b-2 border-transparent font-narrow text-[13px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap text-band-ink-2">Prepare</Link>
      </nav>
      <div className={cn("border-b border-border bg-strip", pathname === "/" && "hidden md:block")}>
        <div className="mx-auto flex h-10 max-w-[1400px] items-center gap-4 px-4 md:px-6">
          <span className="label hidden md:inline">Prepare</span>
          <nav aria-label="Prepare an application" className="hidden min-w-0 items-center gap-4 overflow-x-auto text-[13.5px] md:flex">
            {PREPARE.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={cn("whitespace-nowrap hover:text-foreground", pathname === l.href ? "font-semibold text-foreground underline decoration-2 underline-offset-[6px]" : "text-muted-foreground")}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          {pathname !== "/" && <Link
            href="/?find=1"
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[3px] bg-cta px-3 font-narrow text-[13px] font-semibold uppercase tracking-[0.08em] text-cta-foreground hover:bg-cta/90"
          >
            <Search size={14} aria-hidden /> Find jobs
          </Link>}
        </div>
      </div>
    </header>
  );
}
