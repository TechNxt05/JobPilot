import { describe, expect, it, vi } from "vitest";
import {
  COMMON_QUESTIONS,
  draftAnswers,
  EMPTY_PROFILE,
  knownAnswer,
  lengthLimit,
  matchCommonQuestion,
  mergeProfile,
  normalizeProfile,
  parseResumeWithAI,
  planAutofill,
  profileFromResume,
  profileToContext,
  type FormField,
} from "../src";
import { RESUME } from "./fixtures";

const field = (label: string, extra: Partial<FormField> = {}): FormField => ({
  iid: "1", frameId: 0, tag: "textarea", type: "textarea", label, name: "", id: "", placeholder: "", autocomplete: "",
  required: false, options: [], currentValue: "", ...extra,
});
const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });

describe("rich profile from resume", () => {
  const p = profileFromResume(RESUME);

  it("parses experience entries with titles, companies, dates and bullets", () => {
    expect(p.experience).toHaveLength(2);
    expect(p.experience[0]).toMatchObject({ title: "Software Engineering Intern", company: "Flipkart", start: "May 2024", end: "Jul 2024" });
    expect(p.experience[0].description).toContain("Reduced API latency by 35%");
    expect(p.experience[1]).toMatchObject({ title: "ML Research Intern", company: "IIT Delhi" });
  });

  it("parses projects, education, skills and a factual headline", () => {
    expect(p.projects[0]).toMatchObject({ name: "Internova", description: expect.stringContaining("LangGraph") });
    expect(p.projects[0].tech).toContain("LangGraph");
    expect(p.education[0]).toMatchObject({ school: "Indian Institute of Technology, Delhi", degree: "B.Tech", startYear: "2022", endYear: "2026", cgpa: "8.6" });
    expect(p.skills).toEqual(expect.arrayContaining(["Python", "React", "FastAPI", "PostgreSQL"]));
    expect(p.headline).toBe("B.Tech Computer Science and Engineering student at Indian Institute of Technology, Delhi");
  });

  it("builds an AI context with additional info and the user's own answers", () => {
    const ctx = profileToContext({ ...p, additionalInfo: "Worked with GPT-4o and Claude via LangGraph agents.", answers: { availability: "Yes, May–Aug" } });
    expect(ctx).toContain("ADDITIONAL INFORMATION");
    expect(ctx).toContain("Claude");
    expect(ctx).toContain("[availability] Yes, May–Aug");
  });
});

describe("merge + migration", () => {
  it("fills only empty fields and unions skills", () => {
    const base = { ...EMPTY_PROFILE, firstName: "Pri", skills: ["Go"], answers: { why_role: "mine" } };
    const merged = mergeProfile(base, { firstName: "Priya", lastName: "Sharma", skills: ["go", "Rust"], answers: { why_role: "ai", strengths: "x" } });
    expect(merged).toMatchObject({ firstName: "Pri", lastName: "Sharma", skills: ["Go", "Rust"], answers: { why_role: "mine", strengths: "x" } });
  });

  it("migrates the flat v0.2 profile", () => {
    const p = normalizeProfile({ firstName: "A", college: "IIT", degree: "B.Tech", graduationYear: "2026", cgpa: "9", cgpaScale: "10", currentCompany: "Acme" });
    expect(p.education[0]).toMatchObject({ school: "IIT", degree: "B.Tech", endYear: "2026", cgpa: "9" });
    expect(p.experience[0]).toMatchObject({ company: "Acme", end: "Present" });
    expect(p.answers).toEqual({});
  });
});

describe("common questions", () => {
  const USER_QUESTIONS: [string, string][] = [
    ["Which LLMs/Agents have you worked with?", "llms_agents"],
    ["Which programming languages are you comfortable with?", "languages"],
    ["Describe your best AI project in under 200 words.", "best_ai_project"],
    ["Briefly describe one end-to-end ML project.", "e2e_ml_project"],
    ["What's something hard you built recently, and why did you build it?", "hard_thing"],
    ["Have you built or deployed an AI application?", "deployed_ai_app"],
    ["What GitHub or deployed-build link can you share?", "links"],
    ["Are you available for 3 months, 40 hours per week?", "availability"],
    ["Are you legally authorized to work in the relevant location?", "work_authorization"],
    ["Are you willing to relocate?", "relocation"],
    ["How did you come to learn about the company?", "referral_source"],
    ["Why did you choose this role?", "why_role"],
    ["Why are you interested in this company?", "why_company"],
    ["Share something interesting you've built or explored using AI.", "interesting_ai"],
  ];

  it.each(USER_QUESTIONS)("matches “%s”", (label, id) => {
    expect(matchCommonQuestion(label)?.id).toBe(id);
  });

  it("has unique ids and never lets AI answer logistics", () => {
    expect(new Set(COMMON_QUESTIONS.map((q) => q.id)).size).toBe(COMMON_QUESTIONS.length);
    for (const q of COMMON_QUESTIONS.filter((q) => q.category === "logistics")) expect(q.ai, q.id).toBe(false);
  });

  it("derives languages and links from the profile", () => {
    const p = profileFromResume(RESUME);
    expect(knownAnswer(COMMON_QUESTIONS.find((q) => q.id === "languages")!, p)?.value).toMatch(/Python.*Java/);
    expect(knownAnswer(COMMON_QUESTIONS.find((q) => q.id === "links")!, p)?.value).toContain("github.com/priyasharma");
  });

  it("reads word / character limits", () => {
    expect(lengthLimit("Describe your best AI project in under 200 words.")).toEqual({ words: 200, chars: undefined });
    expect(lengthLimit("Why us? (max 500 characters)")).toEqual({ words: undefined, chars: 500 });
  });
});

describe("autofill with the question bank", () => {
  const p = { ...profileFromResume(RESUME), answers: { availability: "Yes, I'm available full-time May–August 2026.", llms_agents: "GPT-4o, Llama 3 via Groq, LangGraph agents" } };

  it("fills the user's answers, proposes eligibility answers unticked, leaves the rest for AI", () => {
    const plan = planAutofill(
      [
        field("Which LLMs/Agents have you worked with?"),
        field("Are you available for 3 months, 40 hours per week?", { tag: "select", type: "select", options: ["Select", "Yes", "No"] }),
        field("Are you willing to relocate?", { tag: "input", type: "radio", options: ["Yes", "No"] }),
        field("Why are you interested in this company?"),
        field("Gender", { tag: "select", type: "select", options: ["Female", "Male"] }),
      ],
      p,
    );
    expect(plan[0]).toMatchObject({ action: "fill", source: "your_answer", selected: true, questionId: "llms_agents" });
    expect(plan[1]).toMatchObject({ action: "fill", value: "Yes", selected: false, questionId: "availability" });
    expect(plan[2]).toMatchObject({ action: "ask", reason: "sensitive", questionId: "relocation" });
    expect(plan[3]).toMatchObject({ action: "ask", reason: "open_question", aiDraftable: true, questionId: "why_company" });
    expect(plan[4]).toMatchObject({ action: "ask", reason: "sensitive" });
    expect(plan[4].questionId).toBeUndefined();
  });

  it("maps a radio group answer to the right option", () => {
    const [r] = planAutofill([field("Are you willing to relocate?", { tag: "input", type: "radio", options: ["Yes", "No"] })], { ...p, answers: { relocation: "No, I'd prefer remote." } });
    expect(r).toMatchObject({ action: "fill", value: "No", selected: false });
  });
});

describe("AI drafting + parsing", () => {
  it("drafts several answers in one call and ignores unknown ids", async () => {
    const fetchImpl = vi.fn(async () => ok({ answers: [{ id: "a", answer: "One" }, { id: "b", answer: " " }, { id: "zzz", answer: "x" }] }));
    const out = await draftAnswers({ provider: "openai", apiKey: "sk-x" }, [{ id: "a", question: "Q1" }, { id: "b", question: "Q2" }], { profile: "ctx" }, { fetchImpl });
    expect(out).toEqual({ a: "One" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("drops parsed entries that aren't in the resume", async () => {
    const fetchImpl = vi.fn(async () =>
      ok({
        firstName: "Priya", lastName: "Sharma", email: "priya.sharma@example.com",
        experience: [
          { title: "Software Engineering Intern", company: "Flipkart", start: "May 2024", end: "Jul 2024", description: "x" },
          { title: "Staff Engineer", company: "Google", start: "2020", end: "2023", description: "invented" },
        ],
        education: [], projects: [], skills: ["Python"], publications: [], certifications: [], achievements: [],
      }),
    );
    const parsed = await parseResumeWithAI({ provider: "groq", apiKey: "gsk_x" }, RESUME, { fetchImpl });
    expect(parsed.experience?.map((e) => e.company)).toEqual(["Flipkart"]);
    expect(parsed.firstName).toBe("Priya");
  });
});
