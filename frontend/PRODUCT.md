# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primarily the builder himself: an Indian engineering student / 2026 graduate (AI, backend, systems) running his own internship and first-job search. Other early-career users may sign in later (the hosted tier has a per-user daily AI quota), but today's decisions optimise for one daily power user.

## Product Purpose
JobPilot is a job-search copilot. It finds openings that fit the user's real profile, explains fit and eligibility honestly, prepares the application (tailored resume, cover letter, form answers, recruiter emails and LinkedIn messages), and tracks every application and follow-up. Success: less time per application, fewer wasted applications to roles the user can't get, and nothing sent that misstates the user's background.

## Positioning
Grounded, not generative hype: every score is computed in code from the user's own resume, every AI sentence is checked against the user's profile (unbacked numbers and skills are flagged), contact details are never invented, and nothing is ever submitted or sent without the user. Jobs come straight from companies' own ATS boards rather than scraped aggregators.

## Operating Context
- Web app (Next.js on Vercel) plus a Chrome extension that shares the same account, profile, resumes and tracker (Supabase).
- Daily loop: find jobs (Discover across ATS boards; Search via the Python backend; pasted LinkedIn hiring posts), judge fit, tailor resume / cover letter, apply on the company site (extension autofills), email or DM recruiters (Gmail compose hand-off), track and follow up.
- Job finding is user-triggered today (no scheduled scan); the user wants one obvious control that runs every source at once.
- Hosted AI has a daily quota (default 20 actions); deterministic features (Discover, scoring, ATS checks) cost none.

## Capabilities and Constraints
- Routes that must keep working: `/` (home), Chat with the agent "Execution Flow" visualiser (keep this panel), `/discover`, `/internships` (backend search), `/applications` (tracker), `/outreach` and `/outreach/post`, `/cover-letter`, `/resume-upgrade`, `/resume-score`, `/profile`, `/login`, `/auth/callback`.
- Home becomes a dashboard (state of the search + quick actions); Chat moves to its own route.
- Stack: Next.js 16 App Router, React 19, Tailwind v4, lucide icons, Supabase auth; Python backend on Cloud Run (may move to Hugging Face Spaces).
- Nothing is auto-sent or auto-submitted; recruiter contacts are private per user.

## Brand Commitments
- Name: **JobPilot** (shared with the Chrome extension).
- Voice: plain, specific, honest about gaps; no hype or clichés.

## Evidence on Hand
No testimonials, customers, metrics or press exist; none may be invented. Real data comes from the signed-in user's own profile, resumes, tracker and contacts.

## Product Principles
1. Truth over polish: never show or send a claim the user's profile can't back.
2. One control per job-to-be-done: finding jobs, preparing an application and following up should each be one obvious action.
3. The user stays in charge: drafts, never auto-send; suggestions, never silent edits.
4. Spend AI only where it adds value; everything checkable is computed in code.
