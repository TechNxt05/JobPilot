/**
 * Live smoke tests against real AI providers, using the keys in backend/.env.
 * Skipped unless JOBPILOT_LIVE=1. Run: JOBPILOT_LIVE=1 npx vitest run test/live.test.ts
 * Uses only the fictional fixture resume/job.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeWithAI,
  completeParsed,
  draftAnswers,
  generateCoverLetter,
  isRealKey,
  parseResumeWithAI,
  profileFromResume,
  profileToContext,
  renderResumeLatex,
  tailorResume,
  ungroundedNumbers,
  type ProviderConfig,
  type ProviderId,
} from "../src";
import { JD, RESUME } from "./fixtures";

const LIVE = process.env.JOBPILOT_LIVE === "1";
const envPath = resolve(__dirname, "../../../backend/.env");
const env: Record<string, string> = {};
if (LIVE && existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const one = (p: ProviderId, key: string, model: string): ProviderConfig[] => (isRealKey(env[key]) ? [{ provider: p, apiKey: env[key], model: env[model] || undefined }] : []);
const ALL: ProviderConfig[] = [
  ...one("groq", "GROQ_API_KEY", "GROQ_MODEL"),
  ...one("gemini", "GEMINI_API_KEY", "GEMINI_MODEL"),
  ...one("openrouter", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"),
  ...one("openai", "OPENAI_API_KEY", "OPENAI_MODEL"),
];
const job = { title: "Software Engineer Intern", company: "Acme Cloud", location: null, url: null, text: JD, source: "test" };
const profile = profileFromResume(RESUME);
const T = 120_000;

describe.skipIf(!LIVE)("live providers", () => {
  it.each(ALL.map((c) => [c.provider, c] as const))("%s answers in JSON", async (_p, config) => {
    const t = Date.now();
    const { value } = await completeParsed(config, { system: 'Return JSON only: {"ok": true}', user: "Respond now." }, (raw) => JSON.parse(raw));
    console.log(`   ${config.provider}: ${Date.now() - t} ms`);
    expect(value).toBeTruthy();
  }, T);

  it("falls back from a broken provider to a working one", async () => {
    const { provider, attempts } = await completeParsed(
      [{ provider: "groq", apiKey: "gsk_definitely_invalid_key_000" }, ...ALL],
      { system: 'Return JSON only: {"ok": true}', user: "Respond now." },
      (raw) => JSON.parse(raw),
    );
    console.log(`   fallback answered by ${provider} after: ${attempts.filter((a) => a.error).map((a) => a.error?.slice(0, 60)).join(" | ")}`);
    expect(attempts[0].error).toBeTruthy();
  }, T);
});

describe.skipIf(!LIVE)("live features (fallback chain)", () => {
  it("analyzes a job: real requirement extraction, grounded suggestions", async () => {
    const r = await analyzeWithAI(ALL, job, RESUME);
    console.log(`   required: ${r.requirements.requiredSkills.join(", ")} | preferred: ${r.requirements.preferredSkills.join(", ")}`);
    console.log(`   suggestions kept ${r.suggestions.length}, dropped as ungrounded ${r.droppedSuggestions}`);
    expect(r.requirements.requiredSkills).toEqual(expect.arrayContaining(["React"]));
    expect(r.requirements.minCgpa?.value).toBe(7.5);
  }, T);

  it("parses a resume into the profile without inventing entries", async () => {
    const p = await parseResumeWithAI(ALL, RESUME);
    console.log(`   experience: ${p.experience?.map((e) => e.company).join(", ")} | projects: ${p.projects?.map((x) => x.name).join(", ")}`);
    expect(p.firstName).toBe("Priya");
    expect(p.experience?.map((e) => e.company)).toEqual(expect.arrayContaining(["Flipkart"]));
  }, T);

  it("drafts common answers from the profile", async () => {
    const answers = await draftAnswers(ALL, [
      { id: "llms", question: "Which LLMs/Agents have you worked with?" },
      { id: "hard", question: "What's something hard you built recently, and why did you build it?" },
    ], { profile: profileToContext(profile, RESUME) });
    console.log(`   llms: ${answers.llms?.slice(0, 140)}`);
    expect(Object.keys(answers).length).toBeGreaterThan(0);
  }, T);

  it("writes a cover letter grounded in the profile", async () => {
    const l = await generateCoverLetter(ALL, { profile, resumeText: RESUME, job, tone: "professional", words: 220 });
    console.log(`   ${l.paragraphs.length} paragraphs, ${l.paragraphs.join(" ").split(/\s+/).length} words; warnings: ${l.warnings.join(" | ") || "none"}`);
    console.log(`   opening: ${l.paragraphs[0].slice(0, 160)}`);
    expect(l.paragraphs.length).toBeGreaterThanOrEqual(2);
  }, T);

  it("tailors a one-page resume with no invented numbers", async () => {
    const { resume, report } = await tailorResume(ALL, { profile, resumeText: RESUME, job });
    const text = renderResumeLatex(resume);
    console.log(`   ATS ${report.atsBefore}→${report.atsAfter}, alignment ${report.alignmentBefore}→${report.alignmentAfter}, ${report.words} words`);
    console.log(`   removed: ${report.removed.map((r) => r.reason).join(" | ") || "nothing"}; gaps: ${report.skillGaps.join(", ")}`);
    console.log(`   first bullet: ${resume.experience[0]?.bullets[0]}`);
    expect(resume.name).toBe("Priya Sharma");
    const allBullets = [...resume.experience.flatMap((e) => e.bullets), ...resume.projects.flatMap((x) => x.bullets)].join("\n");
    expect(ungroundedNumbers(allBullets, `${RESUME}\n${profileToContext(profile)}`)).toEqual([]);
    expect(text).toContain("\\begin{document}");
  }, T);
});
