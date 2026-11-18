import { describe, expect, it, vi } from "vitest";
import {
  cleanDraftQuestions,
  draftAnswers,
  DEFAULT_SOURCES,
  EMPTY_PROFILE,
  planAutofill,
  skillsMissingFromList,
  sourceKey,
  STARTER_LISTS,
  tailorResume,
  type CandidateProfile,
  type FormField,
} from "../src";

const chat = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });

const profile: CandidateProfile = {
  ...EMPTY_PROFILE,
  firstName: "Asha", lastName: "Rao", email: "asha@example.com",
  education: [], experience: [], publications: [], certifications: [], achievements: [], answers: {},
  projects: [{ name: "ScrapeAll", link: "", tech: "Python, Playwright, FastAPI", description: "Built a scraper for job boards with Playwright and FastAPI" }],
  skills: ["Python", "FastAPI", "React"],
};

describe("tailored resume keeps job skills the candidate has", () => {
  it("adds Playwright to Skills when the job asks for it and the model left it out", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      // The prompt names the job skills the candidate has
      expect(String(init.body)).toContain("JOB SKILLS THE CANDIDATE HAS");
      return chat({
        headline: "", summary: "", experience: [], extras: [], notes: [],
        projects: [{ source_index: 0, bullets: ["Built a job-board scraper with FastAPI"] }],
        skills: [{ category: "Languages", items: ["Python"] }, { category: "Frameworks", items: ["FastAPI", "React"] }],
      });
    });
    const { resume, report } = await tailorResume([{ provider: "openai", apiKey: "sk-test" }], {
      profile, resumeText: "",
      job: { title: "QA Automation Intern", company: "Acme", text: "We need Python and Playwright for end-to-end test automation. FastAPI is a plus." },
    }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const items = resume.skills.flatMap((g) => g.items);
    expect(items).toContain("Playwright");
    expect(report.addedSkills).toContain("Playwright");
  });
});

describe("skillsMissingFromList", () => {
  it("finds skills used in projects but not listed", () => {
    expect(skillsMissingFromList(profile)).toEqual(["Playwright"]);
    expect(skillsMissingFromList({ ...profile, skills: [...profile.skills, "playwright"] })).toEqual([]);
  });
});

const field = (over: Partial<FormField>): FormField => ({
  iid: over.label ?? "x", frameId: 0, tag: "input", type: "text", label: "", name: "", id: "", placeholder: "", autocomplete: "", required: false, options: [], currentValue: "", ...over,
});

describe("autofill: questions worded differently from the rules", () => {
  const plan = planAutofill([
    field({ label: "Years of Python experience" }),
    field({ label: "Preferred testing framework", type: "radio", options: ["Playwright", "Selenium", "Cypress"] }),
    field({ label: "Phone" }),
    field({ label: "q_12" }),
    field({ label: "Headline" }),
  ], profile);

  it("lets AI answer unrecognised fields and single-choice questions from the profile", () => {
    expect(plan[0]).toMatchObject({ reason: "unknown", aiDraftable: true });
    expect(plan[1]).toMatchObject({ reason: "choice", aiDraftable: true });
  });
  it("never lets AI write contact details or answer unlabelled fields", () => {
    expect(plan[2]).toMatchObject({ reason: "no_value", aiDraftable: false });
    expect(plan[3].aiDraftable).toBeFalsy();
    expect(plan[4]).toMatchObject({ reason: "no_value", aiDraftable: true });
  });
  it("reuses a saved answer to a similar question", () => {
    const [p] = planAutofill([field({ label: "Years of hands-on Python experience" })], profile,
      [{ id: "a1", question: "How many years of Python experience?", answer: "2", updatedAt: 0 }]);
    expect(p).toMatchObject({ action: "fill", source: "library", value: "2" });
  });
});

describe("draftAnswers", () => {
  it("sends options, field kind and earlier answers to the model", async () => {
    let body = "";
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => { body = String(init.body); return chat({ answers: [{ id: "f", answer: "Playwright" }] }); });
    const out = await draftAnswers([{ provider: "openai", apiKey: "sk-test" }],
      [{ id: "f", question: "Preferred testing framework", options: ["Playwright", "Selenium"], kind: "short" }],
      { profile: "PROJECTS\n- ScrapeAll [Playwright]", answers: [{ question: "Why testing?", answer: "I like reliable software." }] },
      { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.f).toBe("Playwright");
    expect(body).toContain("OPTIONS");
    expect(body).toContain("SHORT field");
    expect(body).toContain("EARLIER ANSWERS");
  });
  it("validates client-sent questions", () => {
    expect(cleanDraftQuestions([{ id: "a", question: "Q", options: ["x", 3], kind: "weird" }, { id: 1 }, null])).toEqual([{ id: "a", question: "Q", options: ["x"] }]);
  });
});

describe("bundled data", () => {
  it("starter HR lists parse fully", () => {
    expect(STARTER_LISTS.map((l) => l.contacts.length)).toEqual([19, 40]);
    expect(STARTER_LISTS[1].contacts.find((c) => c.email === "engserv@inf.com")?.notes).toMatch(/infosys\.com/);
  });
  it("default boards have no duplicates", () => {
    const keys = DEFAULT_SOURCES.map(sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
