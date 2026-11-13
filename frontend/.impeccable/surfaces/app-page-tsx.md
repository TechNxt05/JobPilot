---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/layout.tsx","components/AppShell.tsx"]
---

Scope: the whole signed-in web app shell plus its home dashboard (`/`); every other route inherits the world. Mode: Operate.

Audience and job: one daily power user running his own internship / first-job search. Home answers "what changed, what's due, what do I do next" and offers one control that runs every job source.

Constraints: all routes and features keep working; the Chat page keeps the agent Execution Flow panel; name stays JobPilot; nothing auto-sent; no invented numbers on screen (demo data only in dev preview, labelled).

## Direction contract

THESIS: The job search as today's reservation chart: every application has a PNR and a status that moves along a fixed ladder. Refuses the default SaaS dashboard of KPI cards and a grey sidebar.

OWN-WORLD: Chart-paper buff ground (night chart: ink-blue ground, buff text) ruled with dotted and solid rules; railway-blue header band; maroon for the one primary action; status green for confirmed steps. Archivo Narrow caps for headers and labels, Archivo body, Martian Mono for PNRs and figures. Square corners, no shadows, bands with a tinted head strip.

STORY: Open the app, read today's chart (new matches, in progress, follow-ups due, AI quota), press Find jobs everywhere, act on a row (save, tailor, email, apply), and the row's ladder advances.

FIRST VIEWPORT: Blue header band: JobPilot, primary nav, account. Buff sub-strip: Prepare tools and the maroon Find jobs everywhere button with per-source status. Main column: "Chart for <date>" heading and one-line summary; New matches band (rows: PNR, role/company/location/age, match ramp + score, fit deltas, NEW→SAVED ladder, actions). Below: In progress band from the tracker. Right column: Follow-ups due, Journey counts by status, AI actions left.

FORM: Reservation Chart, my grounded pick (rank 1 on my ordered list), chosen by the user over the roll. seed:07d0398a3cb923bd

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
