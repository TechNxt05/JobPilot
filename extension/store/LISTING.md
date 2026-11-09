# Chrome Web Store listing — JobPilot

Paste these into the Web Store developer dashboard. Build the upload with `npm run package -w @internova/extension` (creates `extension/internova-extension-v<version>.zip`).

## Name
JobPilot

## Summary (≤132 characters)
See how well your resume fits the job you're viewing, and autofill applications you review. No auto-submit.

## Category
Workflow & Planning (alternative: Tools)

## Description
JobPilot reads the job posting you're looking at and shows how well your resume fits it, with every score explained.

**Job alignment you can check**
• Required and preferred skills, experience and education, each scored separately
• Every match points to the exact line in your resume that supports it
• Skills you only list (but don't show in projects or experience) get partial credit, so you know what to strengthen
• Eligibility checks (CGPA cut-offs, graduation batch) shown separately: a high skill match never hides "not eligible"
• Add several resumes (SDE, AI/ML, Data…) and JobPilot recommends the best one for each job

**ATS readability check**
Contact details, section structure, recognised skills, quantified impact, action verbs and length, itemised so you know what to fix.

**Application autofill you approve**
• Fills name, contact details, links, education and other profile fields on Greenhouse, Lever, Workday, Google Forms and most career sites
• Never fills work-authorization, visa, gender, ethnicity, disability, salary or consent questions. Those are always yours to answer
• Saves the answers you approve and suggests them for similar questions later
• Never clicks Submit

**Optional AI, using your own key**
Connect Groq, Google Gemini, OpenAI or OpenRouter for sharper requirement extraction, resume suggestions and drafted answers. Requests go straight from your browser to the provider you choose. AI suggestions must quote real lines from your resume, and anything that doesn't is hidden.

**Your full profile, filled from your resume**
Education, experience, projects, skills, publications, certifications, achievements and an Additional information box. Answer common application questions once ("Which LLMs have you worked with?", "Are you available 40 h/week?") and they're reused on every form. With your own AI key, blank answers are drafted from your profile for you to review.

**Application tracker**
Save jobs from any posting, mark them applied, set follow-up dates and keep notes.

**Private by design**
Works fully offline-first with no account. Optional sign-in syncs your data across devices; your AI key never leaves your browser.

## Single purpose (for review)
Help a job seeker evaluate the job posting or application form in the current tab against their own resume, and fill application fields they approve.

## Permission justifications (for review)
| Permission | Why |
|---|---|
| `sidePanel` | The whole UI lives in Chrome's side panel next to the job page. |
| `storage` | Saves the user's resumes, profile, saved answers, tracked jobs and settings locally. The optional AI key is kept in session storage unless the user opts in to remembering it. |
| `scripting` | When the user clicks Analyze or Scan, reads the job description or form fields from the current tab, and (only after the user approves) writes the chosen values into form fields. |
| `activeTab` | Lets the user analyze the current tab on demand. |
| Host permissions: job sites (LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Workday, Ashby, Internshala, Naukri, Wellfound, Unstop, Google Forms) | So Analyze and Autofill work on the major job boards and application systems without extra prompts. Nothing runs on these sites until the user clicks a button in the panel. |
| Host permissions: api.groq.com, api.openai.com, generativelanguage.googleapis.com, openrouter.ai | Only used when the user adds their own API key, to send the job text and their resume to the provider they chose. |
| Optional host permissions: all sites | Requested at runtime, only if the user asks to analyze or autofill a page on a site not listed above. |

## Data usage disclosures (dashboard checkboxes)
- Collects: **Personally identifiable information** (name, email, phone, education, work history in the resume and profile) and **authentication information** (email, for optional sign-in). Stored locally; copied to JobPilot's Supabase database only if the user signs in to sync.
- Not sold, not used for unrelated purposes, not used for creditworthiness or lending.
- Transferred to a third party only when the user enables AI with their own key: the job description and resume text go to the provider they picked, to provide the feature.

## Privacy policy URL
Host `store/PRIVACY.md` publicly (e.g. as a page on the JobPilot website or a GitHub Pages / Vercel page) and paste its URL.

## Assets still needed
- Screenshots 1280×800: Analyze (score + evidence), Autofill (review list), Profile
- Small promo tile 440×280
- Icon 128×128: `static/icons/icon128.png` ✓
