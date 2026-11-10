# Deploying JobPilot

Production setup:

| Piece | Host | Address (example) |
|---|---|---|
| Database, sign-in, file storage | **Supabase** (already created) | `https://<ref>.supabase.co` |
| Python API (chat agents, job search with Playwright, PDF text, resume score/match) | **Google Cloud Run** | `https://jobpilot-api-xxxx.a.run.app` |
| Website + its AI routes (cover letter, resume upgrade, hosted AI for the extension) | **Vercel** | `https://jobpilot-xxxx.vercel.app` |
| Browser extension | **Chrome Web Store** | calls the Vercel site + Supabase |

Nothing needs to be installed on your computer: Cloud Run and Vercel both build straight from the GitHub repo.

> Keep every key out of the repo. Keys go only into the Cloud Run / Vercel settings screens (and your local, git-ignored `.env` files).

---

## 0. Code on GitHub
The repo `TechNxt05/JobPilot` must contain the latest code (branch `main`). Both hosts redeploy automatically on every push to `main`.

## 1. Supabase

1. **Run the new migration.** In the SQL Editor, paste and run `supabase/migrations/20261110000000_ai_quota.sql`. It creates the daily AI quota (default **20 actions per user per day**). To change the limit later:
   ```sql
   update public.ai_config set daily_limit = 30;
   ```
2. **Email (needed for real users).** Supabase's built-in sender only emails your team and locks the templates.
   - Create a free account at [resend.com](https://resend.com), verify a domain, and create an API key.
   - In Supabase, go to **Authentication → Emails → SMTP Settings → Enable custom SMTP**. Enter host `smtp.resend.com`, port `465`, username `resend`, the API key as the password, and your sender address.
   - In **Email Templates → Magic Link**, add `Your JobPilot code: {{ .Token }}` to the body. The extension signs in with this code; the website accepts the code or the link.
3. **URLs.** Do this after step 3 below, once you know the Vercel address. In **Authentication → URL Configuration**:
   - Site URL: `https://<your-vercel-domain>`
   - Redirect URLs: `https://<your-vercel-domain>/auth/callback` and `http://localhost:3000/auth/callback`

## 2. Python API on Google Cloud Run

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project (e.g. `jobpilot`), and attach a billing account. Small usage stays within the free tier.
2. Open **Cloud Run → Create service → Continuously deploy from a repository**, then **Set up with Cloud Build**:
   - Connect GitHub and choose `TechNxt05/JobPilot`, with branch `^main$`.
   - Build type: **Dockerfile**. Source location: `/backend/Dockerfile`.
3. Service settings:
   - Name: `jobpilot-api`. Region: `asia-south1` (Mumbai) or the one nearest your users.
   - Authentication: **Allow unauthenticated invocations**. The API checks each user's Supabase sign-in itself.
   - Under **Container(s) → Settings**:
     - **Port:** 8080
     - **Memory:** 2 GiB (Chromium needs it)
     - **CPU:** 1
     - **Request timeout:** 300 s
     - **Instances:** min 0 (scales to zero, so no idle cost), max 3 (caps your bill)
4. **Variables & Secrets.** Add these. Prefer *Reference a secret* (Secret Manager) for the four keys:
   ```
   GROQ_API_KEY=…            GEMINI_API_KEY=…          OPENROUTER_API_KEY=…      SERPER_API_KEY=…
   GROQ_MODEL=openai/gpt-oss-120b
   GEMINI_MODEL=gemini-3.5-flash-lite
   OPENROUTER_MODEL=openrouter/free
   LLM_FALLBACK_ORDER=groq,gemini,openrouter,openai
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_…
   CORS_ORIGINS=https://<your-vercel-domain>      # set after step 3; comma-separate several
   ```
5. Click **Create**. The first build takes about 5–8 minutes. Then open `https://<service-url>/health`; it should return `{"status":"ok"}`.

## 3. Website on Vercel

1. At [vercel.com](https://vercel.com), choose **Add New → Project → Import** `TechNxt05/JobPilot`.
2. **Root Directory:** `frontend`. Framework is detected as Next.js. Under *Build & Development Settings*, set **Install Command** to `cd .. && npm install`. The repo is an npm workspace and the website uses `packages/core`.
3. **Environment Variables** (Production + Preview):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…
   NEXT_PUBLIC_API_URL=https://<cloud-run-service-url>
   GROQ_API_KEY=…   GEMINI_API_KEY=…   OPENROUTER_API_KEY=…   SERPER_API_KEY=…
   GROQ_MODEL=openai/gpt-oss-120b
   GEMINI_MODEL=gemini-3.5-flash-lite
   OPENROUTER_MODEL=openrouter/free
   LLM_FALLBACK_ORDER=groq,gemini,openrouter,openai
   ```
   `NEXT_PUBLIC_*` values are public by design. The AI keys are server-only and never reach browsers.
4. Click **Deploy**. Rename the project under Settings → General to get a nicer `*.vercel.app` address, or add your own domain.
5. Go back and finish the pieces that needed this address:
   - **Cloud Run:** set `CORS_ORIGINS` to the Vercel address (**Edit & deploy new revision**).
   - **Supabase:** set the URLs from step 1.3.

> **Vercel plan note:** the free Hobby plan is for personal, non-commercial use. If JobPilot starts charging users or has paid ads, move to Vercel Pro.

## 4. Extension (production build)

1. Edit `extension/.env`:
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_…
   JOBPILOT_API_URL=https://<your-vercel-domain>
   ```
   The build adds exactly this site to the extension's permissions, for hosted AI. The extension never contains AI keys.
2. From the repo root, run `npm run package -w @internova/extension`. The log should show `Cloud sync: …` and `Hosted AI: …`, and the output is `extension/jobpilot-extension-v<version>.zip`, ready for the Chrome Web Store.

## 5. Check it end to end
- [ ] `https://<cloud-run>/health` returns ok.
- [ ] On the website, sign in with the email code or link, upload a resume, and confirm the profile fills in.
- [ ] Website: Cover Letter and Resume Upgrade produce a PDF.
- [ ] Website: Chat answers. This goes through Cloud Run, so it also proves CORS and sign-in checks work.
- [ ] Extension: sign in under Settings → Account. The **JobPilot AI** card shows "20 of 20 left today".
- [ ] Extension: on a LinkedIn or Lever job, Analyze, Write cover letter and Tailor my resume work, and the counter goes down.
- [ ] The Jobs tracker shows the same jobs in the extension and on the website.

## Costs and safety
- **AI:** each signed-in user gets at most `ai_config.daily_limit` hosted actions per day across the website and extension. Users with their own keys don't use your quota.
- **Cloud Run:** add a budget alert under **Billing → Budgets & alerts** (e.g. ₹500/month). Max instances = 3 caps concurrency.
- **Groq, Gemini and OpenRouter:** each has its own dashboard with rate limits and usage. The fallback chain moves to the next provider when one is rate-limited.
- **Rotating keys:** change them in Cloud Run and Vercel, then redeploy. Nothing in the repo or extension needs to change.
