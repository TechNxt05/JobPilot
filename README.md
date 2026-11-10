# JobPilot — AI Career Copilot

JobPilot (formerly Internova) helps students and early-career candidates find, evaluate and apply to internships. It has three parts:

| Part | Folder | What it is |
|---|---|---|
| **JobPilot Extension** | `extension/` | Chrome (Manifest V3) side panel that reads the job you're looking at on LinkedIn, Indeed, Greenhouse, Lever, Workday, Internshala, Naukri and most career pages, and shows how well each of your resumes fits it. On application forms it fills the fields you approve and never submits. Works with no account and no backend. |
| **Core** (`@internova/core`) | `packages/core/` | Shared TypeScript engine: resume analysis, ATS readability score, job-requirement extraction, explainable alignment scoring, eligibility checks, cover letters, resume tailoring + LaTeX rendering, and AI adapters (Groq, Gemini, OpenRouter, OpenAI) with automatic fallback. |
| **JobPilot Web** | `frontend/` + `backend/` | Next.js app + FastAPI service: profile, application tracker, **cover letter generator**, **resume upgrade (Overleaf/LaTeX → one-page tailored PDF)**, a **multi-agent LangGraph pipeline** for cited internship answers, and a job board. |

> **Status:** working prototype, tested end to end against mocks (not yet against a live Supabase project or live AI keys); see [Known issues](#known-issues).
>
> Code identifiers keep the original name (`@internova/core`, the repo folder); everything users see says JobPilot.

---

## Deployment
See **[DEPLOY.md](DEPLOY.md)**: Supabase (database + sign-in), Google Cloud Run (Python API, Docker), Vercel (website + hosted AI) and the extension's production build.

## Hosted AI (no API key needed)
Signed-in users get AI through JobPilot's server: **20 actions per user per day**, shared across the website and the extension.
- The limit lives in `ai_config.daily_limit` and is counted by `consume_ai_quota()` in Supabase. Users can't reset it.
- If the quota can't be checked, AI doesn't run, which protects your API bill.
- The extension calls `POST /api/ai` on the website with the user's Supabase token.
- Users who add their own keys (Settings → Advanced) bypass the hosted service: their requests go straight from the browser to the provider, unlimited.

## AI providers and fallback

Every AI feature can use **Groq, Google Gemini, OpenRouter and OpenAI**. Configure one or more; they're tried **in order**. If one fails (invalid key, rate limit, outage, unknown model, or a response that doesn't parse), the same request goes to the next.
- **Extension:** Settings → AI providers. One key per provider, reorder with ↑/↓, and "Test keys" checks each key separately. Keys stay in the browser.
- **Website (Next.js server routes):** `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, with order set by `LLM_FALLBACK_ORDER` (default `groq,gemini,openrouter,openai`).
- **Backend (FastAPI agents):** same variables. LangChain `with_fallbacks` chains every provider that has a key.

## Cover letters and resume upgrade

**Cover letter** (website `/cover-letter`, extension Analyze → Cover letter)
- **Inputs:** your profile plus the job description you paste in (or the page you're viewing, in the extension). Optionally, the website researches the company first: Serper (Google results) if `SERPER_API_KEY` is set, otherwise DuckDuckGo.
- **Grounding:** facts about you come only from your profile; facts about the company come only from the job description or the research. Any number or skill not found in those sources is flagged for you to check.
- **Output:** editable text, Copy, a PDF (LaTeX letter template), and Open in Overleaf.

**Resume upgrade** (website `/resume-upgrade`, extension Analyze → Tailored resume)
- **With your Overleaf code:** it tailors that document and keeps your preamble, macros and layout. If the model changes the preamble, the original is restored.
- **Without it:** it builds a tailored resume from your profile in JobPilot's ATS-friendly template (single column, selectable text, `\pdfgentounicode` for clean ATS extraction).
- **Checked in code:**
  - **No invented facts:** contact details, education, titles, companies and dates are copied from your profile, never from the model. Bullets that introduce numbers or skills not in your profile are dropped, and the screen lists what was dropped and why.
  - **Skill gaps:** skills the job wants that you don't have are listed as gaps, never added.
  - **One page:** a word budget first, then compile and count pages. The profile template is trimmed until it fits; your own LaTeX gets one AI "shorten" pass.
  - **Repetition:** repeated opening verbs are reported.
  - **Before/after scores:** ATS readability and job alignment.
- **Output:** PDF preview and download, editable LaTeX with Recompile, Open in Overleaf, and .tex download.
- **PDF compilation:** a public TeX Live service (latex.ytotech.com, falling back to texlive.net), used only when a PDF is requested. "Open in Overleaf" posts the LaTeX to overleaf.com/docs.

## JobPilot Extension

### What it does
1. Open a job posting and click the Internova icon. The side panel opens next to the page.
2. Click **Analyze this job page**. Internova reads the posting in this order: your text selection, then the page's schema.org `JobPosting` data (published by most career sites), then site-specific selectors, then a generic best-guess block.
3. You get, for every resume you've added:
   - **Job alignment (0–100)**: a weighted score over required skills (50%), preferred skills (15%), experience (20%) and education (15%). Dimensions the posting doesn't mention are left out rather than counted as zero.
   - **Evidence**: each matched requirement shows the exact resume line that supports it; unmatched ones are listed as missing. A skill shown in an experience or project bullet gets full credit. One that's only named in a skills list gets 70% and is tagged "only in skills list".
   - **Eligibility, shown separately**: CGPA minimums (compared across 4- and 10-point scales) and graduation batch. A strong skill match doesn't hide a hard "not eligible".
   - **ATS readability (0–100)**: a job-independent check of contact info, sections, recognised skills, bullets, quantified impact, action verbs and length, with each check itemised.
   - **Best resume**: if you've added several versions (e.g. "SDE", "AI/ML"), the best match for this job is recommended.
4. **Optional AI (bring your own key).** With a Groq, Gemini, OpenAI or OpenRouter key, one model call extracts the requirements more accurately and writes a short fit summary plus suggestions for your resume.
   - **Scores are still computed in code, not by the model.**
   - Each suggestion has to quote a real line from your resume. Suggestions that quote text not in your resume are dropped, and the panel says how many.

### Profile (filled from your resume, editable everywhere)
**Uploading a resume fills the profile automatically.** Rules fill it instantly. With an AI key, an AI pass then fills anything still empty. Anything it adds must appear in the resume, and nothing you typed is overwritten. Every section is editable:

| Section | Contents |
|---|---|
| Basics | Name, email, phone, city, country, LinkedIn, GitHub, portfolio, **headline**, **summary** |
| Education | Entries with school, degree, major, years, CGPA and scale |
| Work experience | Entries with title, company, dates, location and what you did |
| Projects | Entries with name, link, tech and description |
| Skills, Publications, Certifications, Achievements | Lists |
| **Additional information** | Free text for anything not in your resume: LLMs and tools you've used, hours you can commit, preferred locations, demo links… It's used as AI context. |
| **Common questions** | 31 questions that come up again and again (see below). Answer once; autofill reuses the answer on every form. |

The common questions are grouped into five categories:
- **About you:** tell us about yourself, strengths, teamwork, conflict, leadership, failure.
- **Technical:** programming languages, LLMs and agents you've worked with, tech stack, deployed AI apps, GitHub or deployed links.
- **Projects:** your best AI project, an end-to-end ML project, something hard you built, something interesting you explored with AI.
- **Motivation:** why this role, why this company, cover letter, career goals.
- **Eligibility & logistics:** availability (e.g. 3 months at 40 h/week), start date, duration, work authorisation, sponsorship, relocation, work mode, how you heard about the company, expected stipend.

How each kind of question is answered:
- **Left blank in About you, Technical, Projects or Motivation:** AI drafts an answer from your profile, using only facts that are in it, and you review it. You can draft them all at once ("Draft blank answers with AI"), or they're drafted automatically when a form asks.
- **Programming languages and links:** filled straight from your profile's skills and links, with no AI.
- **Eligibility & logistics:** AI never answers these. Your own saved answer is proposed unticked on each form, so you confirm it applies to that job. Demographic questions (gender, ethnicity, disability, veteran status, date of birth) and consent checkboxes are never filled.

### Application tracker
**Save job** on the Analyze screen, or **Track as applied** after autofilling. The **Jobs** tab lists everything by status: saved, applied, interviewing, offer, rejected or withdrawn. Each job keeps its alignment score, the resume you used, the deadline, a follow-up date (with a reminder banner when it's due) and notes.

### Account & sync (optional)
With a Supabase-configured build, **Settings → Account & sync** lets you sign in with a 6-digit email code. Your profile, resumes, saved answers and tracked jobs then sync across devices: local-first, the newest change wins, and deletions sync too. AI keys and settings are never synced. Setup is in [Cloud sync setup](#cloud-sync-setup-supabase).

### Autofill (you review everything, it never submits)
1. Upload your resume and review your **Profile** once (see above).
2. On an application form, open **Autofill** and click **Scan application form**. The scan covers the page and any embedded forms, such as a Greenhouse or Lever iframe on a company site.
3. Internova sorts the fields into four groups:
   - **Ready to fill**: matched to your profile. Select menus are matched to their options, so "B.Tech" picks "Bachelor's Degree". Fields that already hold a different value start unticked.
   - **Questions**: your saved answer, an answer derived from your profile, a saved answer from your library, or an AI draft (generated automatically on scan when you have a key). Each one is labelled with where it came from. Your eligibility answers are proposed unticked, and selects and radio buttons are matched ("Yes, available May–Aug" picks "Yes"). An eligibility answer you give here is saved to your profile for next time.
   - **Needs you**: demographic and consent questions and file uploads. These have no input box; you answer them on the form.
   - **Not recognised**: listed so you can see them.
4. Click **Fill N selected fields**. Values are set so that React and Vue forms register them, and each filled field is outlined in blue. Approved answers to common questions are saved to your profile; job-specific ones (e.g. "Why Acme?") go to the **answer library**.
5. **You submit the form yourself.** Internova never clicks Submit.

### Privacy model
- Resumes, profile details and saved answers are stored only in `chrome.storage.local`. PDFs are parsed locally with pdf.js. Full policy: [`extension/store/PRIVACY.md`](extension/store/PRIVACY.md).
- **Where the API key is kept:** by default in `chrome.storage.session`, which is in memory only and cleared when the browser closes. It's saved to disk only if you tick "Remember key", and even then it isn't encrypted; the Settings screen says so.
- **Who can use the key:** only the background service worker. Web pages and content scripts can't reach it, and messages are only accepted from Internova's own pages.
- **Where it's sent:** only to your chosen provider. Error messages are scrubbed so the key never appears in them.
- **Page access:** the extension reads major job sites by default. Other sites need a one-time "Allow on all sites" approval, which you can revoke in `chrome://extensions`.

### Build and load
```bash
# from the repo root (npm workspaces: packages/core + extension)
npm install
npm test                  # core unit tests (vitest)
npm run typecheck
npm run build:extension   # outputs extension/dist
npm run package -w @internova/extension   # Web Store zip: extension/internova-extension-v<version>.zip
```
Web Store listing copy, the permission justifications and the data disclosures are in [`extension/store/LISTING.md`](extension/store/LISTING.md).
Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select `extension/dist`. Without `SUPABASE_URL` set, the build is local-only and the Account card says so. For development, `npm run watch -w @internova/extension` rebuilds on save (click reload on the extension card afterwards).

### Cloud sync setup (Supabase)
> **Email templates locked on the free plan?** With Supabase's built-in email sender, template editing is restricted, and emails only go to your project's team members. Before real users can sign in, set up a custom SMTP provider, for example [Resend](https://resend.com) (free tier):
> 1. Create a Resend account, verify a sending domain (or use their test domain), and create an API key.
> 2. In Supabase, go to **Authentication → Emails → SMTP Settings → Enable custom SMTP**. Use host `smtp.resend.com`, port `465`, user `resend`, the API key as the password, and your verified sender address.
> 3. The **Magic Link** template is now editable: add `Your JobPilot code: {{ .Token }}` to the body. The extension needs this code.
>
> The website also accepts the default sign-in **link**. Under **Authentication → URL Configuration**, set **Site URL** to your website and add `https://<your-site>/auth/callback` (plus `http://localhost:3000/auth/callback`) to **Redirect URLs**.

1. Create a Supabase project.
2. Run [`supabase/migrations/20261109000000_internova_sync.sql`](supabase/migrations/20261109000000_internova_sync.sql) in the SQL editor, or run `supabase db push`. It creates the `profiles`, `resumes`, `answers` and `applications` tables (all with row-level security) and a private `resumes` storage bucket.
3. In **Authentication → Email**, keep Email enabled. In **Email Templates → Magic Link**, include `{{ .Token }}` so users receive a 6-digit code (the extension signs in with codes, not links).
4. Copy `extension/.env.example` to `extension/.env` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the publishable key; it's safe to ship because row-level security protects the data).
5. Run `npm run build:extension`. The build log prints `Cloud sync: https://…`.

---

## Features

| Feature | Page | Backend endpoint | What it does |
|---|---|---|---|
| **Intelligence Chat** | `/` | `POST /chat` (SSE) | Runs the multi-agent pipeline and streams each agent's progress to a live *Execution Flow* panel. Returns a structured answer (Answer / Key Details / Notes / Confidence / Sources) plus apply links, recruiter profiles and autofill compatibility. |
| **Internship Board** | `/internships` | `POST /jobs/search` | Searches LinkedIn, Indeed, Glassdoor and the open web for a role + location, scrapes the top results and extracts structured job cards (role, company, stipend, skills, apply link). |
| **Resume ↔ Job Match** | `/internships` (per card) | `POST /jobs/match` | Scores your resume against a job (0–100), with missing keywords, strengths, weaknesses and tips. |
| **Resume Health Check** | `/resume-score` | `POST /resume/score` | ATS-style audit: score, critical issues, formatting issues, strengths and a step-by-step improvement plan. |
| **Profile** | `/profile` | `POST /resume/extract` + Supabase | Same rich profile as the extension (sections, additional info, common questions). Uploading a PDF auto-fills it. Shared with the extension through Supabase. |
| **Application tracker** | `/applications` | Supabase | Same tracker as the extension's Jobs tab; jobs saved in either place show up in both. |
| **AI drafts** | `/profile` | `POST /api/draft-answers`, `POST /api/parse-resume` (Next.js) | Server-side Groq calls using `@internova/core`; the key stays on the server. |
| **Auth** | all pages | — | Supabase email-code sign-in (same account as the extension). `proxy.ts` protects every page; the API checks the user's sign-in on every request. |

---

## Architecture

```
┌──────────────────────────┐        HTTP / SSE        ┌───────────────────────────────────┐
│  Next.js 16 (App Router) │ ───────────────────────▶ │  FastAPI                          │
│  React 19 · Tailwind v4  │                          │   ├─ LangGraph agent pipeline     │
│  @internova/core         │ ◀─────────────────────── │   ├─ Job search / match / score   │
└───────────┬──────────────┘   Bearer <Supabase JWT>  │   └─ PDF → text (pdfplumber)      │
            │                                         └──────┬──────────────┬─────────────┘
            │  supabase-js (RLS)                             │ token check  │ profile (as user)
            ▼                                                ▼              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Supabase: Auth (email code) · Postgres (profiles, resumes, answers, applications; RLS)  │
│            · Storage (private resume PDFs). Shared with the Chrome extension.             │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   Backend AI: Groq / OpenAI · Serper + DuckDuckGo · Playwright (scraping)
```

### Chat agent pipeline (`backend/app/graph/workflow.py`)

The graph runs in sequence; each node streams its output to the frontend as one SSE event.

```
profile → query_analysis → search → scraper → verification → discovery → autofill → ranking → answer → visualizer
```

| # | Agent | File | Role | Model / tool |
|---|---|---|---|---|
| 1 | ProfileContextAgent | `agents/profile_agent.py` | Loads the user's profile from Supabase as context (requested as the user, so RLS applies) | Supabase REST |
| 2 | QueryAgent (node `query_analysis`) | `agents/query_agent.py` | Pulls out the intent (role, company, location, batch) and writes search queries | Groq (`GROQ_MODEL`) |
| 3 | SearchAgent | `agents/search_agent.py` | Runs each query through hybrid search and removes duplicates | Serper + DuckDuckGo |
| 4 | ScraperAgent | `agents/scraper_agent.py` | Scrapes the top 3 results (renders JavaScript) | Playwright + BeautifulSoup |
| 5 | VerificationAgent | `agents/verification_agent.py` | Pulls facts from the scraped pages, each with a confidence level and a source | OpenAI (`OPENAI_MODEL`) |
| 6 | DiscoveryAgent | `agents/discovery_agent.py` | Finds official apply links and recruiter LinkedIn profiles | Serper + DuckDuckGo |
| 7 | AutofillAgent | `agents/autofill_agent.py` | Classifies apply links by how autofillable they are (Google Form / ATS / LinkedIn) | URL rules |
| 8 | RankingAgent | `agents/ranking_agent.py` | Adds a trust score per source domain and lowers confidence for low-trust sources | `tools/ranking.py` |
| 9 | AnswerAgent | `agents/answer_agent.py` | Writes the final cited markdown answer | Groq (`GROQ_MODEL`) |
| 10 | VisualizerAgent | `agents/visualizer_agent.py` | Turns the accumulated `execution_log` into numbered `execution_flow` steps | — |

Standalone agents (not in the graph): `JobSearchAgent`, `JobMatcher` (`core/matching.py`), `ResumeScorerAgent`, `ResumeIntelligenceAgent`.

---

## Project structure

```
Internova/
├── package.json                 # npm workspaces: packages/*, extension
├── packages/core/               # @internova/core (shared TypeScript engine)
│   ├── src/
│   │   ├── skills.ts            # skill taxonomy + boundary-aware matcher
│   │   ├── resume.ts            # sections, contact, CGPA, grad year, experience dates, bullets
│   │   ├── ats.ts               # job-independent ATS readability score
│   │   ├── job.ts               # JobPosting type + heuristic requirement extraction
│   │   ├── alignment.ts         # explainable alignment + eligibility
│   │   ├── providers.ts         # BYOK adapters: Groq, OpenAI, Gemini, OpenRouter
│   │   ├── ai.ts                # AI requirement extraction, grounded suggestions, answer drafts
│   │   ├── profile.ts           # rich candidate profile, resume → profile parser, merge, AI context
│   │   ├── autofill.ts          # field classification, sensitive-field rules, option matching, answer library
│   │   ├── questions.ts         # common-question bank: patterns, AI / user-only rules, derived answers
│   │   ├── sync.ts              # local-first sync (last-write-wins + tombstones), application tracker model
│   │   └── analyze.ts           # analyzeJobLocal / analyzeJob orchestration
│   └── test/                    # vitest
├── extension/                   # Chrome MV3 extension
│   ├── static/                  # manifest.json, sidepanel.html/.css
│   ├── src/
│   │   ├── background.ts        # service worker: holds the key, runs AI calls
│   │   ├── extractor.ts         # job extraction, injected into the page
│   │   ├── storage.ts           # resumes, settings, key (session by default)
│   │   ├── formScanner.ts       # form scan + approved fill, injected into all frames
│   │   ├── tabs.ts              # run injected code in the active tab / frames
│   │   ├── cloud.ts             # Supabase auth (email code) + sync adapter + auto-sync
│   │   ├── pdf.ts               # local PDF → text (pdf.js)
│   │   └── sidepanel/           # React UI: Analyze, Autofill, Jobs, Profile, Settings
│   ├── store/                   # Web Store listing + privacy policy
│   ├── package.mjs              # zips dist/ for upload
│   └── build.mjs                # esbuild → dist/
├── supabase/migrations/         # Postgres schema + row-level security for sync
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + all routes
│   │   ├── agents/              # One class per agent (see table above)
│   │   ├── core/
│   │   │   ├── config.py        # Settings + load_dotenv (reads backend/.env)
│   │   │   ├── auth.py          # Supabase token check (GET /auth/v1/user) + profile fetch
│   │   │   ├── llm.py           # LLMFactory: groq | openai (models from config)
│   │   │   ├── matching.py      # Resume ↔ job matcher
│   │   │   └── schemas.py       # Pydantic models (UserProfile, UserIntent, …)
│   │   ├── graph/
│   │   │   ├── state.py         # AgentState (append reducers for logs/errors)
│   │   │   └── workflow.py      # LangGraph definition
│   │   └── tools/
│   │       ├── search.py        # Serper + DuckDuckGo hybrid search
│   │       ├── scraper.py       # Playwright scraper
│   │       └── ranking.py       # Domain trust scoring
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/
    │   ├── layout.tsx           # nav (AuthNav)
    │   ├── login/page.tsx       # email-code sign-in
    │   ├── applications/page.tsx # tracker (shared with extension)
    │   ├── api/                 # draft-answers, parse-resume (server-side AI)
    │   ├── page.tsx             # Chat + Execution Flow panel
    │   ├── internships/page.tsx # Job board
    │   ├── profile/page.tsx     # Profile form + resume upload
    │   └── resume-score/page.tsx
    ├── components/
    │   ├── FlowVisualizer.tsx
    │   ├── JobCard.tsx
    │   ├── ResumeUpload.tsx
    │   └── ui/index.tsx         # Button, Input, Card
    ├── lib/api.ts               # API_URL (NEXT_PUBLIC_API_URL)
    ├── lib/supabase/            # browser + server Supabase clients
    ├── lib/data.ts              # profile / resumes / applications in the extension's sync format
    ├── proxy.ts                 # Supabase session refresh + route protection (Next 16 "proxy")
    └── .env.local.example
```

---

## Prerequisites

- **Python 3.10+**
- **Node.js 20+** (Next.js 16 needs Node ≥ 20.9)
- **A Supabase project** (free tier is fine): auth, database and resume storage for both the web app and the extension. See [Cloud sync setup](#cloud-sync-setup-supabase).
- API keys:
  - [Groq](https://console.groq.com): query, answer, job extraction, matching, scoring and resume parsing
  - [OpenAI](https://platform.openai.com): fact verification
  - [Serper](https://serper.dev): Google search results (optional; DuckDuckGo is the fallback)

---

## Setup

### 1. Backend

```bash
cd backend
python -m venv venv
# Windows
.\venv\Scripts\activate
# macOS / Linux
# source venv/bin/activate

pip install -r requirements.txt

playwright install chromium
```

Copy `.env.example` to `.env` and fill it in:

```env
GROQ_API_KEY=...
OPENAI_API_KEY=...
SERPER_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile   # optional override
OPENAI_MODEL=gpt-4o                  # optional override
SUPABASE_URL=https://<ref>.supabase.co  # same project as the web app + extension
SUPABASE_ANON_KEY=...                # anon/publishable key (no service key needed)
CORS_ORIGINS=http://localhost:3000   # comma-separated
```

`backend/.env` is loaded automatically, whatever directory you start the server from. Run it from `backend/`:

```bash
uvicorn app.main:app --reload
```

API: `http://localhost:8000` · interactive docs: `http://localhost:8000/docs`

### 2. Frontend

```bash
# from the repo root (the frontend is part of the npm workspace)
npm install
cp frontend/.env.local.example frontend/.env.local
#   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: your Supabase project
#   NEXT_PUBLIC_API_URL: the FastAPI backend (default http://localhost:8000)
#   GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY: server-only AI keys (fallback order: LLM_FALLBACK_ORDER)
#   SERPER_API_KEY: optional, company research for cover letters (DuckDuckGo is the fallback)
npm run dev:web
```

App: `http://localhost:3000`

---

## API reference

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` | — | `{status: "ok"}` (public) |

All other endpoints require `Authorization: Bearer <Supabase access token>`; the backend checks it with Supabase Auth (401 if missing or invalid).

| POST | `/chat` | `{query}` | `text/event-stream`, one `data: {<node>: {...}}` event per graph node |
| POST | `/resume/extract` | multipart: `file` (PDF ≤ 5 MB) | `{text}`. 400 for non-PDF/unreadable files |
| POST | `/resume/score` | `{resume_text}` | `{score, summary, critical_issues, formatting_issues, content_strengths, improvement_plan}` |
| POST | `/jobs/search` | `{role, location}` | `{jobs: [{role, company, location, type, stipend, description, skills_required, apply_link}]}` |
| POST | `/jobs/match` | `{resume_text, job_description}` | `{score, match_level, missing_keywords, strengths, weaknesses, improvement_tips}` |

---

## Known issues

These bugs, found in the 2026-11-09 code review, are now **fixed**: unescaped JSON braces in prompt templates, user data built into prompts with f-strings, `execution_log` being overwritten instead of appended, a graph node named the same as a state key (`query`), missing `"use client"` directives, the Clerk v6 `auth.protect()` call (and `middleware.ts` → `proxy.ts`), the retired Groq model, `.env` never being loaded, missing Python dependencies, undefined Tailwind theme tokens, the SSE stream parser dropping events split across chunks, the profile page wiping `resume_text` on save, and crashes when `intent` was empty or a PDF page had no text.

Still open:

1. **Backend AI cost:** the web app's AI endpoints use the server's own keys, so any signed-in user spends your quota. There's no per-user rate limit yet.
2. **Scanned (image-only) PDFs** are rejected in both the web app and the extension; there is no OCR.
3. **Web lint:** `npm run lint` in `frontend/` still reports `no-explicit-any` errors and unused imports. The TypeScript type check and `next build` both pass.
4. **Extension, rule-based mode:** without an AI key, requirement extraction uses keyword rules. A technology named in the responsibilities counts as required, and skills outside the ~190-skill taxonomy aren't detected. Adding a key fixes both.
5. **Extension, site selectors:** the LinkedIn and Indeed selectors depend on their markup and can break when it changes. Schema.org data and text selection are the fallbacks.
6. **Autofill limits:**
   - Custom dropdown widgets (e.g. Workday's button-based pickers) aren't filled; only native `<select>`s are. They're listed under "Not recognised" or "Needs you".
   - Fields that appear only after an earlier answer (multi-step Workday flows) need a rescan for each step.
   - Radio and checkbox questions are always left to you.
   - Tested end to end on Greenhouse- and Lever-style forms built for the test; not yet tested on live LinkedIn Easy Apply or Workday.
7. **Store submission:** the privacy policy needs a public URL, and screenshots plus a promo tile still have to be made.
8. **Cloud sync:**
   - Tested end to end against a mock of Supabase's auth, REST and storage APIs: the extension (real `supabase-js`, two simulated devices) and the web app (built Next.js + real FastAPI). Not yet tested against a live Supabase project, and the row-level security policies haven't been exercised there yet.
   - Conflicts resolve per record, newest wins, so two devices editing the same profile offline keep the later save.
   - No account deletion button yet: deleting an account means deleting the user in Supabase.

## Roadmap

Direction: **AI Career Copilot**. The extension works locally on its own; the web app and cloud sync are added on top. Decided 2026-11-09: shared TypeScript core, Chrome extension first, and Supabase (Auth + Postgres + Storage) replacing Clerk + MongoDB when cloud sync arrives.

**Phase 1 — Core v2 + Extension MVP** *(done)*
- [x] Fix the web app's blocking bugs
- [x] Shared `@internova/core`: explainable alignment, eligibility engine, ATS score, BYOK adapters
- [x] Chrome MV3 extension: job extraction, multi-resume ranking, evidence, BYOK AI with grounded suggestions
- [x] Unit tests (core) + browser end-to-end tests of the extension

**Phase 2 — Extension polish** *(done)*
- [x] Evidence strength: experience/project bullets get full credit, skills-list-only mentions get 70% and are tagged
- [x] Bigger taxonomy (~190 skills) with security, design, business and hardware packs
- [x] Icons, onboarding, Web Store listing, permission justifications, privacy policy, packaging script
- [ ] Store screenshots + promo tile; host the privacy policy; submit for review

**Phase 3 — Smart autofill** (user reviews every field; never auto-submits) *(done)*
- [x] Candidate profile pre-filled from resume
- [x] Form scanning across frames (Greenhouse/Lever iframes, Google Forms labels, Workday automation ids)
- [x] Field classification, select-option matching, overwrite protection, hard block on sensitive questions
- [x] Answer library with similar-question matching; grounded AI-drafted answers
- [ ] Custom dropdown widgets (Workday), multi-step forms, live-site testing on LinkedIn Easy Apply / Workday

**Phase 3.5 — Rich profile** *(done)*
- [x] Editable sections: basics, headline, summary, education, experience, projects, skills, publications, certifications, achievements
- [x] Additional information box used as AI context
- [x] 31-question common-question bank: answer once, reuse everywhere; AI drafts blank answers from the profile; eligibility questions only ever use the user's own answer
- [x] Resume upload auto-fills the profile (rules, then an optional grounded AI pass)

**Phase 4 — Cloud sync (Supabase)** *(done)*
- [x] Supabase schema with row-level security + private resume bucket (`supabase/migrations`)
- [x] Extension: email-code sign-in, local-first sync of profile, resumes, answers and tracked jobs, auto-sync, deletions synced
- [x] Application tracker (Jobs tab): save, mark applied, statuses, follow-ups, notes
- [x] Web app moved off MongoDB/Clerk onto the same Supabase project (email-code auth, proxy route protection, backend token checks, shared profile/resumes/tracker); web app consumes `@internova/core`
- [ ] Account deletion; live-project test of the row-level security policies

**Phase 5 — Career intelligence** *(in progress)*
- [x] Job-specific resume tailoring and PDF export (grounded, never invents experience): Overleaf/LaTeX or profile template, one-page enforcement
- [x] Grounded cover letters with optional company research (Serper / DuckDuckGo)
- [x] Multi-provider AI with automatic fallback (Groq, Gemini, OpenRouter, OpenAI)
- [ ] Interview prep from the job description + resume; skill-gap roadmap
- [ ] Job authenticity checks (expired listings, suspicious domains); application analytics
- [ ] Move web-app hosting to Vercel. Replace Playwright scraping with fetch-based extraction, since the extension already reads rendered pages.
