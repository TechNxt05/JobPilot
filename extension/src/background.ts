import {
  analyzeJob,
  complete,
  draftAnswers,
  EMPTY_PROFILE,
  generateCoverLetter,
  parseResumeWithAI,
  profileToContext,
  PROVIDERS,
  tailorLatex,
  tailorResume,
} from "@internova/core";
import type { Request } from "./messages";
import { getProfile, getProviderConfig, getResumes } from "./storage";

// Clicking the toolbar icon opens the side panel
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

/** Keys stay in the service worker; every AI call uses the user's providers in fallback order. */
async function providers() {
  const configs = await getProviderConfig();
  if (!configs) throw new Error("No API key configured. Add one in Settings.");
  return configs;
}

async function profileAndResume(resumeId?: string | null) {
  const [profile, resumes] = await Promise.all([getProfile(), getResumes()]);
  if (!profile && !resumes.length) throw new Error("Add a resume or fill in your Profile first.");
  const resume = resumes.find((r) => r.id === resumeId) ?? resumes[resumes.length - 1];
  return { profile: profile ?? EMPTY_PROFILE, resumeText: resume?.text ?? "" };
}

async function handle(msg: Request) {
  switch (msg.type) {
    case "analyze-ai":
      return analyzeJob(msg.job, await getResumes(), await providers());
    case "draft-answers": {
      const ai = await providers();
      const { profile, resumeText } = await profileAndResume();
      return draftAnswers(ai, msg.questions, { profile: profileToContext(profile, resumeText), job: msg.job });
    }
    case "parse-resume": {
      const ai = await providers();
      const resume = (await getResumes()).find((r) => r.id === msg.resumeId);
      if (!resume) throw new Error("Resume not found");
      return parseResumeWithAI(ai, resume.text);
    }
    case "cover-letter": {
      const ai = await providers();
      const { profile, resumeText } = await profileAndResume(msg.resumeId);
      return generateCoverLetter(ai, { profile, resumeText, job: msg.job, tone: msg.tone, words: msg.words });
    }
    case "tailor-resume": {
      const ai = await providers();
      const { profile, resumeText } = await profileAndResume(msg.resumeId);
      return msg.latex
        ? { mode: "latex" as const, ...(await tailorLatex(ai, { profile, resumeText, job: msg.job, latex: msg.latex, shorten: msg.shorten })) }
        : { mode: "profile" as const, ...(await tailorResume(ai, { profile, resumeText, job: msg.job })) };
    }
    case "test-key": {
      // Test each configured provider on its own so the user sees which keys work
      const results = [];
      for (const config of await providers()) {
        const model = config.model || PROVIDERS[config.provider].defaultModel;
        try {
          await complete(config, { system: 'Reply with the JSON object {"ok": true}.', user: "Respond with JSON." });
          results.push({ provider: PROVIDERS[config.provider].label, model, ok: true });
        } catch (e) {
          results.push({ provider: PROVIDERS[config.provider].label, model, ok: false, error: (e as Error).message });
        }
      }
      return results;
    }
  }
}

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  // Only accept messages from our own extension pages (side panel, or the panel opened as a tab).
  // Content scripts report the web page's URL here, so they're rejected too.
  const ownPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  if (!ownPage) return false;
  handle(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e: Error) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
  return true; // async response
});
