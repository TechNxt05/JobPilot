import {
  analyzeJob,
  complete,
  draftAnswers,
  emailSignature,
  EMPTY_PROFILE,
  generateColdEmail,
  generateCoverLetter,
  pickResumeForJob,
  parseResumeWithAI,
  profileToContext,
  PROVIDERS,
  tailorLatex,
  tailorResume,
  type ProviderConfig,
} from "@internova/core";
import { hostedAI, hostedConfigured, hostedQuota } from "./hosted";
import type { Request } from "./messages";
import { getAnswers, getProfile, getProviderConfig, getResumes } from "./storage";

// Clicking the toolbar icon opens the side panel
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

/**
 * Where AI runs:
 *  1. The user's own keys (Settings → Advanced), if any: direct to the provider, unlimited.
 *  2. Otherwise JobPilot hosted AI (signed-in users, daily quota) via the JobPilot website.
 */
async function runAI<T>(task: string, payload: Record<string, unknown>, local: (ai: ProviderConfig[]) => Promise<T>): Promise<T> {
  const own = await getProviderConfig();
  if (own) return local(own);
  if (hostedConfigured) return hostedAI<T>(task, payload);
  throw new Error("No AI configured. Add your own API key in Settings → Advanced.");
}

async function profileAndResume(resumeId?: string | null) {
  const [profile, resumes] = await Promise.all([getProfile(), getResumes()]);
  if (!profile && !resumes.length) throw new Error("Add a resume or fill in your Profile first.");
  const resume = resumes.find((r) => r.id === resumeId) ?? resumes[resumes.length - 1];
  return { profile: profile ?? EMPTY_PROFILE, resumeText: resume?.text ?? "" };
}

async function handle(msg: Request) {
  switch (msg.type) {
    case "analyze-ai": {
      const resumes = await getResumes();
      return runAI("analyze", { job: msg.job, resumes }, (ai) => analyzeJob(msg.job, resumes, ai));
    }
    case "draft-answers": {
      const { profile, resumeText } = await profileAndResume();
      // Earlier answers (library + common questions) let the model adapt an answer when a question is reworded
      const library = (await getAnswers()).map((a) => ({ question: a.question, answer: a.answer }));
      const answers = [...(msg.answers ?? []), ...library].slice(0, 25);
      return runAI("draft-answers", { questions: msg.questions, job: msg.job, profile, resumeText, answers },
        (ai) => draftAnswers(ai, msg.questions, { profile: profileToContext(profile, resumeText), job: msg.job, answers }));
    }
    case "parse-resume": {
      const resume = (await getResumes()).find((r) => r.id === msg.resumeId);
      if (!resume) throw new Error("Resume not found");
      return runAI("parse-resume", { text: resume.text }, (ai) => parseResumeWithAI(ai, resume.text));
    }
    case "cover-letter": {
      const { profile, resumeText } = await profileAndResume(msg.resumeId);
      return runAI("cover-letter", { job: msg.job, profile, resumeText, tone: msg.tone, words: msg.words },
        (ai) => generateCoverLetter(ai, { profile, resumeText, job: msg.job, tone: msg.tone, words: msg.words }));
    }
    case "cold-email": {
      // The resume that best fits the job, so the email cites the right projects
      const resumes = await getResumes();
      const best = msg.resumeId ? resumes.find((r) => r.id === msg.resumeId) : pickResumeForJob(resumes, msg.job ? { title: msg.job.title ?? "", text: msg.job.text } : null);
      const { profile, resumeText } = await profileAndResume(best?.id);
      const email = await runAI<{ subject: string; body: string; warnings: string[] }>("cold-email", { job: msg.job, contact: msg.contact, profile, resumeText },
        (ai) => generateColdEmail(ai, { profile, resumeText, contact: msg.contact, job: msg.job }));
      return { ...email, signature: emailSignature(profile, email.body) };
    }
    case "tailor-resume": {
      const { profile, resumeText } = await profileAndResume(msg.resumeId);
      return runAI("tailor-resume", { job: msg.job, profile, resumeText, latex: msg.latex, shorten: msg.shorten, addSkills: msg.addSkills }, async (ai) =>
        msg.latex
          ? { mode: "latex" as const, ...(await tailorLatex(ai, { profile, resumeText, job: msg.job, latex: msg.latex, shorten: msg.shorten, addSkills: msg.addSkills })) }
          : { mode: "profile" as const, ...(await tailorResume(ai, { profile, resumeText, job: msg.job, addSkills: msg.addSkills })) });
    }
    case "ai-quota":
      return hostedQuota();
    case "test-key": {
      // Test each of the user's own keys separately so they see which work
      const own = await getProviderConfig();
      if (!own) throw new Error("No API keys saved.");
      const results = [];
      for (const config of own) {
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
