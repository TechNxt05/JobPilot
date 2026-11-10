import { describe, expect, it, vi } from "vitest";
import {
  analyzeJob,
  analyzeJobLocal,
  analyzeResume,
  canonicalSkill,
  complete,
  computeAlignment,
  estimateExperienceMonths,
  extractRequirementsHeuristic,
  findSkills,
  locateQuote,
  parseCGPA,
  parseJSONLoose,
  ProviderError,
  scoreATS,
  type JobPosting,
} from "../src";
import { JD, RESUME } from "./fixtures";

const NOW = new Date("2026-11-09T00:00:00Z");
const job: JobPosting = { title: "Software Engineer Intern", company: "Acme Cloud", location: null, url: null, text: JD, source: "test" };

describe("skills", () => {
  it("respects word boundaries and special characters", () => {
    const s = findSkills("Java, C++, C#, Node.js and .NET; also JavaScript");
    expect([...s.keys()]).toEqual(expect.arrayContaining(["Java", "C++", "C#", "Node.js", ".NET", "JavaScript"]));
    expect(findSkills("JavaScript only").has("Java")).toBe(false);
  });

  it("does not treat common English words as skills", () => {
    const s = findSkills("We react quickly, go to market, and excel at rust removal. HTML is fine.");
    expect(s.has("React")).toBe(false);
    expect(s.has("Go")).toBe(false);
    expect(s.has("Excel")).toBe(false);
    expect(s.has("Rust")).toBe(false);
    expect(s.has("Machine Learning")).toBe(false); // "ML" inside "HTML"
  });

  it("canonicalises free-text skills", () => {
    expect(canonicalSkill("reactjs")).toBe("React");
    expect(canonicalSkill("k8s")).toBe("Kubernetes");
    expect(canonicalSkill("Amazon Web Services")).toBe("AWS");
    expect(canonicalSkill("Some Internal Tool")).toBe("Some Internal Tool");
  });
});

describe("resume analysis", () => {
  const r = analyzeResume(RESUME, NOW);

  it("extracts contact details, sections and education", () => {
    expect(r.contact.email).toBe("priya.sharma@example.com");
    expect(r.contact.phone).toContain("98765");
    expect(r.contact.linkedin).toContain("linkedin.com/in/priyasharma");
    expect(Object.keys(r.sections)).toEqual(expect.arrayContaining(["education", "experience", "projects", "skills"]));
    expect(r.cgpa).toEqual({ value: 8.6, scale: 10 });
    expect(r.graduationYear).toBe(2026);
    expect(r.degreeLevels).toContain("bachelor");
  });

  it("does not mistake year ranges for phone numbers", () => {
    expect(analyzeResume("B.Tech 2021-2025\nfoo@bar.com").contact.phone).toBeNull();
  });

  it("estimates experience from date ranges, merging overlaps", () => {
    expect(r.experienceMonths).toBe(3 + 3); // May–Jul 2024 + Dec 2024–Feb 2025
    expect(estimateExperienceMonths(["Jan 2024 - Jun 2024", "Mar 2024 - Aug 2024"], NOW)).toBe(8);
    expect(estimateExperienceMonths(["Jun 2026 - Present"], NOW)).toBe(6);
    expect(estimateExperienceMonths(["no dates here"], NOW)).toBeNull();
  });

  it("parses CGPA formats", () => {
    expect(parseCGPA("CGPA: 9.1")).toEqual({ value: 9.1, scale: 10 });
    expect(parseCGPA("GPA 3.7/4.0")).toEqual({ value: 3.7, scale: 4 });
    expect(parseCGPA("8.2/10 CGPA")).toEqual({ value: 8.2, scale: 10 });
  });

  it("scores ATS readability with explainable checks", () => {
    const ats = scoreATS(r);
    expect(ats.score).toBeGreaterThan(70);
    expect(ats.checks.find((c) => c.id === "email")?.passed).toBe(true);
    const sparse = scoreATS(analyzeResume("John Doe\nSome text"));
    expect(sparse.score).toBeLessThan(25);
    expect(sparse.warnings.length).toBeGreaterThan(0);
  });
});

describe("job requirements (heuristic)", () => {
  const req = extractRequirementsHeuristic(job);

  it("splits required vs preferred and ignores the company blurb", () => {
    expect(req.requiredSkills).toEqual(expect.arrayContaining(["Python", "Java", "React", "TypeScript", "Kubernetes", "AWS"]));
    expect(req.preferredSkills).toEqual(expect.arrayContaining(["GraphQL", "Docker"]));
    expect(req.requiredSkills).not.toContain("Excel");
    expect(req.requiredSkills).not.toContain("Artificial Intelligence");
    expect(req.preferredSkills).not.toContain("React");
  });

  it("extracts experience, degree, CGPA, batch and deadline", () => {
    expect(req.minYearsExperience).toBe(1);
    expect(req.degreeLevels).toContain("bachelor");
    expect(req.minCgpa).toEqual({ value: 7.5, scale: 10 });
    expect(req.graduationYears).toEqual([2026, 2027]);
    expect(req.deadline).toBe("30 November 2026");
  });
});

describe("alignment", () => {
  const resume = analyzeResume(RESUME, NOW);
  const report = computeAlignment(extractRequirementsHeuristic(job), resume);

  it("reports matched skills with verbatim resume evidence and missing skills", () => {
    const req = report.dimensions.find((d) => d.id === "required_skills")!;
    expect(req.missing).toEqual(expect.arrayContaining(["Kubernetes", "AWS"]));
    for (const ev of req.matched) expect(resume.lines).toContain(ev.resumeLine);
    expect(report.missingRequirements).toContain("Kubernetes");
  });

  it("keeps eligibility separate from the averaged score", () => {
    expect(report.eligible).toBe("met");
    const failing = computeAlignment({ ...extractRequirementsHeuristic(job), minCgpa: { value: 9, scale: 10 } }, resume);
    expect(failing.eligible).toBe("not_met");
    expect(failing.overall).toBe(report.overall); // eligibility doesn't move the alignment score
  });

  it("compares CGPA across scales", () => {
    const r = computeAlignment({ ...extractRequirementsHeuristic(job), minCgpa: { value: 3.0, scale: 4 } }, resume);
    expect(r.eligibility.find((c) => c.id === "cgpa")?.status).toBe("met"); // 8.6/10 ≈ 3.44/4
  });

  it("excludes dimensions the job doesn't state", () => {
    const r = computeAlignment(
      { requiredSkills: ["Python"], preferredSkills: [], minYearsExperience: null, degreeLevels: [], minCgpa: null, graduationYears: [], deadline: null, origin: "heuristic" },
      resume,
    );
    expect(r.overall).toBe(100);
    expect(r.eligible).toBe("not_applicable");
  });

  it("recommends the better-matching resume", () => {
    const res = analyzeJobLocal(job, [
      { id: "a", name: "Generic", text: "John\nSKILLS\nExcel, Word", addedAt: 0 },
      { id: "b", name: "SDE", text: RESUME, addedAt: 0 },
    ]);
    expect(res.recommendedResumeId).toBe("b");
  });
});

describe("grounding", () => {
  it("accepts quotes that exist in the resume and rejects invented ones", () => {
    expect(locateQuote("Reduced API latency by 35% by adding Redis caching", RESUME)).toContain("Redis caching");
    expect(locateQuote("• Built a React dashboard used by 40+ sellers to track returns", RESUME)).toBeTruthy();
    expect(locateQuote("Led a team of 10 engineers at Google", RESUME)).toBeNull();
  });
});

describe("providers", () => {
  const okResponse = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it("sends OpenAI-compatible requests to the right endpoint", async () => {
    const fetchImpl = vi.fn(async () => okResponse("{}"));
    await complete({ provider: "groq", apiKey: "gsk_test1234567890" }, { system: "s", user: "u", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gsk_test1234567890");
    expect(JSON.parse(init.body as string).model).toBe("openai/gpt-oss-120b");
  });

  it("uses the Gemini generateContent API with a header key", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"a\":1}" }] } }] }), { status: 200 }),
    );
    const out = await complete({ provider: "gemini", apiKey: "AIzaTEST", model: "gemini-x" }, { system: "s", user: "u", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/models/gemini-x:generateContent");
    expect(url).not.toContain("AIzaTEST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIzaTEST");
    expect(out).toBe("{\"a\":1}");
  });

  it("never leaks the API key in error messages", async () => {
    const key = "sk-secret-abcdefghijklmnop";
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${key}` } }), { status: 401 }),
    );
    const err = await complete({ provider: "openai", apiKey: key }, { system: "s", user: "u", fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("auth");
    expect(err.message).not.toContain(key);
  });

  it("parses fenced or prefixed JSON", () => {
    expect(parseJSONLoose("```json\n{\"x\": 1}\n```")).toEqual({ x: 1 });
    expect(parseJSONLoose("Here you go: {\"x\": 2}")).toEqual({ x: 2 });
  });
});

describe("analyzeJob with AI", () => {
  const resumes = [{ id: "b", name: "SDE", text: RESUME, addedAt: 0 }];

  it("scores AI-extracted requirements in code and drops ungrounded suggestions", async () => {
    const aiJson = {
      requirements: {
        required_skills: ["python", "React.js", "k8s"],
        preferred_skills: ["GraphQL", "React"],
        min_years_experience: 1,
        degree_levels: ["Bachelor"],
        min_cgpa: 7.5,
        cgpa_scale: 10,
        graduation_years: [2026, "2027"],
        deadline: "2026-11-30",
      },
      summary: "Good fit.",
      suggestions: [
        { resume_line: "Reduced API latency by 35% by adding Redis caching to a Node.js service", suggestion: "Lead with it", addresses: "Node.js" },
        { resume_line: "Managed Kubernetes clusters at Netflix", suggestion: "Highlight", addresses: "Kubernetes" },
      ],
    };
    const fetchImpl = vi.fn(async () => okJSON(aiJson));
    const res = await analyzeJob(job, resumes, { provider: "openai", apiKey: "sk-x" }, { fetchImpl });
    expect(res.aiError).toBeNull();
    expect(res.requirements.origin).toBe("ai");
    expect(res.requirements.requiredSkills).toEqual(["Python", "React", "Kubernetes"]);
    expect(res.requirements.preferredSkills).toEqual(["GraphQL"]); // React already required
    expect(res.requirements.graduationYears).toEqual([2026, 2027]);
    expect(res.ai?.suggestions).toHaveLength(1);
    expect(res.ai?.droppedSuggestions).toBe(1);
    expect(res.results[0].alignment.dimensions[0].score).toBe(67); // 2 of 3, computed deterministically
  });

  it("falls back to heuristic results when the provider fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    const res = await analyzeJob(job, resumes, { provider: "groq", apiKey: "gsk_x" }, { fetchImpl });
    expect(res.requirements.origin).toBe("heuristic");
    expect(res.aiError).toContain("500");
    expect(res.results).toHaveLength(1);
  });
});

function okJSON(obj: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), { status: 200 });
}
