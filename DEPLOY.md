# Deploying JobPilot

Production setup:

| Piece | Host | Address |
|---|---|---|
| Database, sign-in, file storage | **Supabase** | `https://xlfgwmxgdwcremcngibj.supabase.co` |
| Python API (chat agents, job search with Playwright, PDF text, resume score/match) | **Google Cloud Run** (project `fresh-shell-470006-n3`, region `asia-south1`, service `jobpilot-api`) | `https://jobpilot-api-190640980886.asia-south1.run.app` |
| Website + its AI routes (cover letter, resume upgrade, hosted AI for the extension) | **Vercel** | `https://job-pilot-orcin.vercel.app` |
| Browser extension | **Chrome Web Store** | calls the Vercel site + Supabase |

> Keep every key out of the repo. Keys go only into the Cloud Run / Vercel / Supabase settings screens (and your local, git-ignored `.env` files).

**Why two hosts?** The Python API runs a real Chromium browser (Playwright) for job scraping. That needs system libraries and about 300 MB of browser, which doesn't fit Vercel's serverless functions (about 250 MB limit, no `apt-get`). Cloud Run runs a full Docker container, so it fits.

---

## Progress

Legend: ✅ done · ⬜ to do · 🔍 check (likely done, not yet confirmed)

| # | Step | Status |
|---|---|---|
| 0 | Latest code pushed to GitHub `main` | ✅ |
| 2 | Cloud Run service built and running, `/health` returns ok | ✅ |
| 3 | Website deployed on Vercel | ✅ |
| 1.3 | Supabase Site URL + Redirect URL set to the Vercel address | ✅ |
| 2.4 | Cloud Run env vars (AI keys, Supabase) added | 🔍 |
| 3.5 | Cloud Run `CORS_ORIGINS` set to the Vercel address | ⬜ |
| 1.1 | Supabase migrations `20261110000000_ai_quota.sql` and `20261113000000_discovery_contacts.sql` run | ⬜ |
| 1.2 | Email sending fixed (Gmail SMTP now, Resend + own domain later) | ⬜ **← next: sign-in fails until this is done** |
| 2.6 | Broken Cloud Build trigger disabled | ⬜ |
| 4 | Extension production build pointing at the Vercel site | ⬜ |
| 5 | End-to-end checks | ⬜ |
| 6 | Chrome Web Store submission | ⬜ |

### Do next, in this order
1. **Fix email (step 1.2).** The website shows "Error sending confirmation email" (Supabase `POST /auth/v1/otp` → 500) because custom SMTP points at a Gmail address with no valid password. Set up Gmail SMTP with an app password (below). No redeploy is needed; reload the login page afterwards.
2. **Set `CORS_ORIGINS` on Cloud Run (step 3.5).** Without it the website's Chat page can't reach the API.
3. **Run both migrations (step 1.1).** Without them the hosted AI quota checks fail, and the Discover settings and Outreach contacts can't be saved.
4. **Disable the old Cloud Build trigger (step 2.6)**, so pushes stop sending build-failure emails.
5. **Build the extension (step 4)** and run the checks in step 5.

---

## 0. Code on GitHub ✅
The repo `TechNxt05/JobPilot`, branch `main`, holds the latest code. Vercel redeploys automatically on every push to `main`. Cloud Run does **not** (see step 2.6); redeploy it from Cloud Shell.

## 1. Supabase

1. ⬜ **Run the migrations.** In the SQL Editor, paste and run each file, in this order:
   - `supabase/migrations/20261110000000_ai_quota.sql`: the daily AI quota.
   - `supabase/migrations/20261113000000_discovery_contacts.sql`: Discover settings (watched companies, filters) and the private recruiter contacts list for Outreach. Each user sees only their own rows.

   The AI quota defaults to **20 actions per user per day**. To change the limit later:
   ```sql
   update public.ai_config set daily_limit = 30;
   ```
2. ⬜ **Email.** Supabase's built-in sender only emails your project's team members and locks the templates, so real sign-ins need custom SMTP.

   **Now (free, no domain needed): Gmail SMTP.** Sends from your Gmail to anyone, up to about 500 emails a day.
   1. Turn on 2-Step Verification for the Google account, then create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (name it "Supabase"). Copy the 16-character password.
   2. **Authentication → Emails → SMTP Settings → Enable custom SMTP:**

      | Field | Value |
      |---|---|
      | Sender email | your Gmail address |
      | Sender name | `JobPilot` |
      | Host | `smtp.gmail.com` |
      | Port | `465` |
      | Username | your Gmail address |
      | Password | the 16-character app password, no spaces |
   3. **Email Templates → Magic Link:** the body must contain `Your JobPilot code: {{ .Token }}`. The extension signs in with this code; the website accepts the code or the link.
   4. **Authentication → Rate Limits:** raise *emails per hour* (e.g. 30).
   5. Reload the login page and try again. The first emails may land in Spam.

   **Later, before real users: Resend with your own domain.** Without a verified domain, Resend only delivers to your own Resend login email, so it is no use for users yet.
   1. Buy a cheap domain (`.in` / `.xyz`, about ₹100–800 a year) and verify it in Resend → **Domains**.
   2. Change the SMTP settings to host `smtp.resend.com`, port `465`, username `resend`, password your `re_…` API key, sender `noreply@<your-domain>`.

   **Debugging:** Supabase → **Logs → Auth** shows the mail server's actual error (e.g. `535 authentication failed`, `domain not verified`).
3. ✅ **URLs.** In **Authentication → URL Configuration**:
   - Site URL: `https://job-pilot-orcin.vercel.app`
   - Redirect URLs: `https://job-pilot-orcin.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`

## 2. Python API on Google Cloud Run ✅

The service is live at `https://jobpilot-api-190640980886.asia-south1.run.app`, and `/health` returns `{"status":"ok"}`.

### Deploying and redeploying (Cloud Shell)
Open Cloud Shell (the **>_** icon at the top right of the Google Cloud console). First time:
```
git clone https://github.com/TechNxt05/JobPilot.git && cd JobPilot
gcloud run deploy jobpilot-api --source backend --region asia-south1
```
After every backend change pushed to GitHub:
```
cd ~/JobPilot && git pull && gcloud run deploy jobpilot-api --source backend --region asia-south1
```
A build takes about 6–10 minutes (Chromium is large). Env vars and settings set in the console are kept. If it fails, read the log with the build ID from the error message:
```
gcloud builds log <build-id> --region asia-south1 | tail -60
```

### Settings (Cloud Run → jobpilot-api → Edit & deploy new revision)
1. **Containers → Settings:** port 8080, memory **2 GiB** (Chromium needs it), CPU 1, request timeout **300 s**, instances min 0 / max 3.
2. **Security:** allow unauthenticated invocations. The API checks each user's Supabase sign-in itself.
3. 🔍 **Containers → Variables & Secrets.** Copy the values from your local `backend/.env`:

   | Name | Value |
   |---|---|
   | `GROQ_API_KEY` | Groq key |
   | `GEMINI_API_KEY` | Gemini key |
   | `OPENROUTER_API_KEY` | OpenRouter key |
   | `SERPER_API_KEY` | Serper key |
   | `SUPABASE_URL` | `https://xlfgwmxgdwcremcngibj.supabase.co` |
   | `SUPABASE_ANON_KEY` | `sb_publishable_…` |
   | `CORS_ORIGINS` | see step 3.5 |

   Model names (`GROQ_MODEL`, `GEMINI_MODEL`, `OPENROUTER_MODEL`, `LLM_FALLBACK_ORDER`) are optional; the code's defaults are correct. Changing a variable creates a new revision in about a minute, with no rebuild.
4. Add a budget alert under **Billing → Budgets & alerts** (e.g. ₹500/month).

### 2.6 ⬜ Disable the old Cloud Build trigger
**Cloud Build → Triggers → `rmgpgab-jobpilot-api-asia-south1-…` → Disable.** It was created by the console's "continuously deploy" option and never built successfully. It looked for a Dockerfile at the repo root, then only built without deploying, and it ignored saved changes. Until it's disabled, every push to `main` starts a failing build. A working config is in `cloudbuild.yaml` if you want to retry continuous deploys later (trigger type *Cloud Build configuration file*, location `/cloudbuild.yaml`).

### Build problems already fixed
- `lstat /workspace/Dockerfile: no such file or directory`: the Dockerfile lives in `backend/`, so build with `--source backend`.
- `playwright/driver/node: error while loading shared libraries: libatomic.so.1`: the Dockerfile now uses `python:3.11-slim-bookworm` and installs `libatomic1` before running `playwright install --with-deps chromium`.

## 3. Website on Vercel ✅

Live at `https://job-pilot-orcin.vercel.app`.

1. Imported `TechNxt05/JobPilot` as a **single project** with the **frontend** folder (not the "Services" preset, and not the backend; Cloud Run hosts that).
2. **Root Directory:** `frontend`. **Install Command:** `cd .. && npm install`. The repo is an npm workspace and the website uses `packages/core`.
3. **Environment Variables** (Production + Preview):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xlfgwmxgdwcremcngibj.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` |
   | `NEXT_PUBLIC_API_URL` | `https://jobpilot-api-190640980886.asia-south1.run.app` (no trailing `/`) |
   | `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `SERPER_API_KEY` | same keys as Cloud Run |

   `NEXT_PUBLIC_*` values are public by design. The AI keys are server-only and never reach browsers. After changing a variable, **Redeploy** in Vercel (Deployments → ⋯ → Redeploy), because `NEXT_PUBLIC_*` values are baked in at build time.
4. To get a nicer address, rename the project under Settings → General, or add your own domain. If the address changes, update Supabase URLs (1.3) and `CORS_ORIGINS` (3.5).
5. ⬜ **CORS on Cloud Run.** Cloud Run → jobpilot-api → **Edit & deploy new revision** → Variables & Secrets, then set:
   ```
   CORS_ORIGINS=https://job-pilot-orcin.vercel.app,http://localhost:3000
   ```
   Comma-separated, no spaces, no trailing `/`. Click **Deploy**.

> **Vercel plan note:** the free Hobby plan is for personal, non-commercial use. If JobPilot starts charging users or has paid ads, move to Vercel Pro.

## 4. Extension (production build) ⬜

1. Edit `extension/.env`:
   ```
   SUPABASE_URL=https://xlfgwmxgdwcremcngibj.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_…
   JOBPILOT_API_URL=https://job-pilot-orcin.vercel.app
   ```
   The build adds exactly this site to the extension's permissions, for hosted AI. The extension never contains AI keys.
2. From the repo root, run `npm run package -w @internova/extension`. The log should show `Cloud sync: …` and `Hosted AI: …`, and the output is `extension/jobpilot-extension-v<version>.zip`.
3. Test it first: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`.

## 5. Check it end to end ⬜
- [x] `https://jobpilot-api-190640980886.asia-south1.run.app/health` returns ok.
- [ ] On the website, sign in with the email code or link, upload a resume, and confirm the profile fills in.
- [ ] Website: Cover Letter and Resume Upgrade produce a PDF.
- [ ] Website: Chat answers. This goes through Cloud Run, so it also proves CORS and sign-in checks work.
- [ ] Extension: sign in under Settings → Account. The **JobPilot AI** card shows "20 of 20 left today".
- [ ] Extension: on a LinkedIn or Lever job, Analyze, Write cover letter and Tailor my resume work, and the counter goes down.
- [ ] The Jobs tracker shows the same jobs in the extension and on the website.
- [ ] Website: **Discover** → Find jobs lists ranked roles with match scores; "Save to tracker" adds one to Jobs.
- [ ] Website: **Outreach** → import a few contacts, then Draft email → Open in Gmail opens a pre-filled draft.
- [ ] Website: **Outreach → Reply to a hiring post** → paste a LinkedIn post; you get the details, any official posting, an email, DM and connection note.
- [ ] Website: **Resume Upgrade** with a Workday / Greenhouse job link shows the matching ATS check before → after.

## 6. Chrome Web Store ⬜
After step 5 passes: upload the zip from step 4 at the Chrome Web Store Developer Dashboard (one-time $5 developer fee). Use `extension/store/LISTING.md` for the listing text and `extension/store/PRIVACY.md` for the privacy policy.

## Costs and safety
- **AI:** each signed-in user gets at most `ai_config.daily_limit` hosted actions per day across the website and extension. Users with their own keys don't use your quota.
- **Cloud Run:** budget alert (step 2), max instances 3 caps concurrency, min 0 means no idle cost.
- **Groq, Gemini and OpenRouter:** each has its own dashboard with rate limits and usage. The fallback chain moves to the next provider when one is rate-limited.
- **Email:** Gmail SMTP allows about 500 emails a day; move to Resend + own domain before launch.
- **Rotating keys:** change them in Cloud Run and Vercel (then redeploy Vercel). Nothing in the repo or extension needs to change.
