# JobPilot — Privacy Policy

_Last updated: 9 November 2026_

JobPilot ("the extension") helps you compare job postings with your resume and fill job application forms that you review. This policy explains what data the extension handles and where it goes.

## Summary
- By default the extension is **local-only**: your resumes, profile, saved answers and tracked jobs are stored only in your browser.
- **Optional account sync:** if you sign in (Settings → Account & sync), that same data is backed up to JobPilot's cloud database (Supabase) so you can use it on other devices. Only you can access it.
- If you choose to add your own AI provider key, the job text, your profile and your resume are sent **directly from your browser to that provider**. Your AI key is never synced or sent to JobPilot.
- We never sell your data.

## Data the extension stores on your device
| Data | Where | Purpose |
|---|---|---|
| Resume text (extracted from PDFs you add, or text you paste) | `chrome.storage.local` | Matching resumes to jobs; drafting answers |
| Profile details you enter (name, contact details, links, education, CGPA) | `chrome.storage.local` | Filling application forms you approve |
| Profile sections (education, experience, projects, skills, publications, certifications, achievements, additional information) and your answers to common questions | `chrome.storage.local` | Filling forms you approve; context for AI drafts you request |
| Answers you approve while autofilling | `chrome.storage.local` | Suggesting them for similar questions |
| Tracked jobs (title, company, link, status, notes, dates) | `chrome.storage.local` | Your application tracker |
| AI provider, model and settings | `chrome.storage.local` | Remembering your choice |
| AI API keys (optional, one per provider) | `chrome.storage.session` by default (in memory, cleared when the browser closes); `chrome.storage.local` only if you tick "Remember keys" | Calling the AI providers you chose, in your fallback order |

PDF files are read locally and are not stored; only the extracted text is kept. Stored data is not encrypted by the extension; anyone with access to your browser profile can read it. You can delete resumes, saved answers and the API key at any time from the extension, or remove everything by uninstalling it.

## Web pages the extension reads
The extension reads a page **only when you click a button** in its side panel:
- **Analyze** reads the job posting text on the current tab.
- **Scan application form** reads the form's fields and labels on the current tab.
- **Fill** writes only the values you've approved into those fields. The extension never submits forms.

What it reads from pages is processed in your browser and is not stored, except as part of an AI request you've enabled (below).

## Account sync (optional)
If you sign in with your email (a one-time code is emailed to you), the extension stores a copy of your profile, resume text, saved answers and tracked jobs in JobPilot's Supabase database, hosted by Supabase Inc.
- Database row-level security means each record can only be read or changed by the account that owns it.
- Your email address is used only to sign you in.
- Deleting a resume, answer or job removes its content from the server. A deletion record keeps the item's id and time so other devices also remove it.
- Signing out stops syncing and keeps your data in this browser.
- To delete your account and all synced data, contact us (see below).

AI keys, AI provider settings and pages you visit are never synced.

## JobPilot AI (hosted, when signed in)
If you're signed in and haven't added your own API keys, AI features send the job description, your profile and your resume text to the JobPilot website's server. The server forwards them to its AI provider (Groq, Google Gemini or OpenRouter, in that order of fallback) and returns the result. The content isn't stored; the server keeps only a count of your AI actions per day to enforce the free daily limit.

## AI providers with your own keys (optional)
If you add API keys for Groq, Google Gemini, OpenAI and/or OpenRouter, then when you analyze a job, parse a resume, draft answers, write a cover letter or tailor your resume, the extension sends the job description, the application questions (for drafts), your profile and your resume text directly to the first provider in your order; if that call fails, the same request is sent to the next provider you configured. That provider's own privacy policy and terms apply, and usage is billed to your account with them. The key is used only by the extension's background service worker, is never exposed to web pages, and is never sent anywhere except the provider it belongs to.

## PDF generation
When you click **Download PDF** for a tailored resume or cover letter, the document's LaTeX source (which contains your resume or letter text) is sent to a public LaTeX compilation service, latex.ytotech.com, or texlive.net as a backup, which returns the PDF. Nothing is sent until you click. **Open in Overleaf** sends the LaTeX to Overleaf (overleaf.com) to create a project in your Overleaf account.

## What we don't do
- No analytics, tracking, advertising or telemetry.
- No sale or transfer of your data, except to the AI providers you configure, the LaTeX service when you ask for a PDF, and, if you sign in, our database host (Supabase), as described above.
- No use of your data for creditworthiness, lending or any purpose unrelated to the extension's single purpose.

## Children
The extension is not directed at children under 13.

## Changes
We will update this page and its date if this policy changes. Material changes will also be noted in the extension's release notes.

## Contact
Questions about this policy: open an issue on the JobPilot project repository, or contact the developer listed on the Chrome Web Store page.
