/**
 * Reservation-chart primitives shared by every page: bands, PNRs, the match ramp and the status ladder.
 * One fixed ramp encodes match score everywhere; one ladder encodes application progress everywhere.
 */
import * as React from "react";
import type { ApplicationStatus } from "@internova/core";
import { cn } from "@/components/ui";

/** Stable, readable reference for any record id: "PNR 482-1937". */
export function pnrOf(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (h >>> 0) % 10_000_000;
  const s = String(n).padStart(7, "0");
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export function Pnr({ id, className }: { id: string; className?: string }) {
  return (
    <span className={cn("fig text-muted-foreground whitespace-nowrap", className)} title="Reference number">
      PNR {pnrOf(id)}
    </span>
  );
}

export function Band({ title, meta, children, className, actions }: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("band rounded-[3px]", className)}>
      <header className="band-head">
        <h2 className="text-[13px] tracking-[0.1em]">{title}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans normal-case tracking-normal text-sm font-normal">
          {actions}
          {meta !== undefined && <span className="text-[13px] text-muted-foreground">{meta}</span>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** Match score on a fixed five-step ramp (0–19, 20–39, 40–59, 60–79, 80–100). */
export function MatchRamp({ score, className }: { score: number | null; className?: string }) {
  const steps = score === null ? 0 : Math.max(1, Math.min(5, Math.ceil((score + 1) / 20)));
  const tone = score === null ? "" : score >= 70 ? "bg-ok border-ok" : score >= 45 ? "bg-primary border-primary" : "bg-muted-foreground border-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={score === null ? "No description or no resume to compare" : `Match ${score} of 100`}>
      <span className="inline-flex gap-[2px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={cn("block h-[9px] w-[9px] border border-input", i < steps && tone)} />
        ))}
      </span>
      <span className="fig text-[13px] text-foreground">{score === null ? "–" : score}</span>
      <span className="sr-only">{score === null ? "no match score" : `match ${score} of 100`}</span>
    </span>
  );
}

const LADDER: { id: ApplicationStatus; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "applied", label: "Applied" },
  { id: "interviewing", label: "Interview" },
  { id: "offer", label: "Offer" },
];

/** Status ladder: done steps green, the current step blue, later steps outlined. Closed applications show struck. */
export function Ladder({ status, compact }: { status: ApplicationStatus | "new"; compact?: boolean }) {
  if (status === "rejected" || status === "withdrawn") {
    return (
      <span className="fig inline-flex items-center gap-1 px-1.5 py-0.5 border border-border text-muted-foreground line-through">
        {status === "rejected" ? "Not selected" : "Withdrawn"}
      </span>
    );
  }
  const steps = status === "new" ? [{ id: "new" as const, label: "New" }, ...LADDER.slice(0, 2)] : LADDER;
  const at = steps.findIndex((s) => s.id === status);
  return (
    <span className="inline-flex items-center gap-[3px]" aria-label={`Status: ${steps[at]?.label ?? status}`}>
      {steps.slice(0, compact ? at + 2 : steps.length).map((s, i) => (
        <span
          key={s.id}
          className={cn(
            "fig px-1.5 py-[2px] border text-[11px] uppercase leading-none whitespace-nowrap",
            i < at && "bg-ok border-ok text-white dark:text-[#0b1220]",
            i === at && "bg-primary border-primary text-primary-foreground",
            i > at && "border-input text-muted-foreground",
          )}
        >
          {s.label}
        </span>
      ))}
    </span>
  );
}

/** Empty state inside a band: says what's missing and the one action that fills it. */
export function BandEmpty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-sm text-muted-foreground">{children}</div>;
}
