import { describe, expect, it, vi } from "vitest";
import {
  analyzeResume,
  bestOption,
  classifyField,
  computeAlignment,
  draftAnswer,
  findEvidence,
  findSkills,
  flatProfile,
  matchSavedAnswer,
  planAutofill,
  profileFromResume,
  type FormField,
} from "../src";
import { RESUME } from "./fixtures";

const field = (label: string, extra: Partial<FormField> = {}): FormField => ({
  iid: "1", frameId: 0, tag: "input", type: "text", label, name: "", id: "", placeholder: "", autocomplete: "",
  required: false, options: [], currentValue: "", ...extra,
});

describe("evidence strength", () => {
  const r = analyzeResume(RESUME);

  it("prefers lines that show a skill in use over the skills list", () => {
    const react = findEvidence("React", r)!;
    expect(react.strength).toBe("demonstrated");
    expect(react.line).toContain("Built a React dashboard");
    const ts = findEvidence("TypeScript", r)!;
    expect(ts.strength).toBe("listed"); // only in "Languages: ..."
  });

  it("gives listed-only skills partial credit", () => {
    const base = { preferredSkills: [], minYearsExperience: null, degreeLevels: [], minCgpa: null, graduationYears: [], deadline: null, origin: "heuristic" as const };
    expect(computeAlignment({ ...base, requiredSkills: ["React"] }, r).dimensions[0].score).toBe(100);
    const listed = computeAlignment({ ...base, requiredSkills: ["TypeScript"] }, r).dimensions[0];
    expect(listed.score).toBe(70);
    expect(listed.note).toContain("only in a skills list");
  });
});

describe("taxonomy packs", () => {
  it("recognises design, security, hardware and business skills", () => {
    const s = findSkills("Figma wireframes, UI/UX design, Burp Suite, OWASP, FPGA and Verilog, financial modelling, SEO");
    for (const k of ["UI/UX Design", "Wireframing", "Burp Suite", "OWASP", "FPGA", "Financial Modeling", "SEO"]) expect(s.has(k)).toBe(true);
  });
  it("keeps case-sensitive short names strict", () => {
    const s = findSkills("We store data in s3 buckets and helm the ship. dbt models in Looker.");
    expect(s.has("S3")).toBe(false);
    expect(s.has("Helm")).toBe(false);
    expect(s.has("dbt")).toBe(true);
  });
});

describe("profile from resume", () => {
  it("pre-fills the candidate profile", () => {
    const p = flatProfile(profileFromResume(RESUME));
    expect(p).toMatchObject({
      firstName: "Priya",
      lastName: "Sharma",
      email: "priya.sharma@example.com",
      linkedin: "https://linkedin.com/in/priyasharma",
      github: "https://github.com/priyasharma",
      college: "Indian Institute of Technology, Delhi",
      degree: "B.Tech",
      major: "Computer Science and Engineering",
      graduationYear: "2026",
      cgpa: "8.6",
      cgpaScale: "10",
    });
    expect(p.phone).toContain("98765");
  });
});

describe("field classification", () => {
  it("maps common labels, attributes and autocomplete tokens", () => {
    expect(classifyField(field("First Name *")).key).toBe("firstName");
    expect(classifyField(field("Surname")).key).toBe("lastName");
    expect(classifyField(field("Full name")).key).toBe("fullName");
    expect(classifyField(field("Confirm email")).key).toBe("email");
    expect(classifyField(field("", { name: "urls[LinkedIn]" })).key).toBe("linkedin");
    expect(classifyField(field("", { autocomplete: "given-name" })).key).toBe("firstName");
    expect(classifyField(field("School Name")).key).toBe("college");
    expect(classifyField(field("Graduation Year")).key).toBe("graduationYear");
    expect(classifyField(field("Graduate degree", { tag: "select" })).key).toBe("degree");
    expect(classifyField(field("CGPA")).key).toBe("cgpa");
    expect(classifyField(field("Open source contributions")).sensitive).toBeNull();
  });

  it("never treats legal / demographic / consent questions as fillable", () => {
    for (const label of [
      "Are you legally authorized to work in India?",
      "Will you now or in the future require visa sponsorship?",
      "Gender",
      "Race/Ethnicity",
      "Veteran status",
      "Disability status",
      "Expected salary (CTC)",
      "I agree to the privacy policy",
      "How did you hear about us?",
      "Date of birth",
    ]) {
      expect(classifyField(field(label)).sensitive, label).not.toBeNull();
    }
  });

  it("detects open questions", () => {
    expect(classifyField(field("Why do you want to work at Acme?", { tag: "textarea" })).openQuestion).toBe(true);
    expect(classifyField(field("Cover letter", { tag: "textarea" })).openQuestion).toBe(true);
  });
});

describe("autofill plan", () => {
  const profile = profileFromResume(RESUME);

  it("fills recognised fields, asks for sensitive / unknown / file ones", () => {
    const plan = planAutofill(
      [
        field("First name"),
        field("Email"),
        field("Resume/CV", { type: "file" }),
        field("Are you authorized to work in India?", { tag: "select", type: "select", options: ["Yes", "No"] }),
        field("Favourite colour"),
        field("Portfolio"),
      ],
      profile,
    );
    expect(plan.map((p) => [p.action, p.reason])).toEqual([
      ["fill", null],
      ["fill", null],
      ["ask", "file"],
      ["ask", "sensitive"],
      ["ask", "unknown"],
      ["ask", "no_value"],
    ]);
    expect(plan[0].value).toBe("Priya");
  });

  it("matches select options, including degree synonyms", () => {
    expect(bestOption(["Select...", "Bachelor's Degree", "Master's Degree"], "B.Tech", "degree")).toBe("Bachelor's Degree");
    expect(bestOption(["2025", "2026", "2027"], "2026")).toBe("2026");
    expect(bestOption(["Mumbai", "Pune"], "Bengaluru")).toBeNull();
    const [deg] = planAutofill([field("Degree", { tag: "select", type: "select", options: ["Select", "Bachelor's", "Master's"] })], profile);
    expect(deg).toMatchObject({ action: "fill", value: "Bachelor's" });
  });

  it("doesn't overwrite existing values by default", () => {
    const [city] = planAutofill([field("City", { currentValue: "Delhi" })], { ...profile, city: "Bengaluru" });
    expect(city).toMatchObject({ action: "fill", value: "Bengaluru", selected: false });
  });

  it("flags GPA scale mismatches and date pickers", () => {
    const plan = planAutofill([field("GPA (out of 4.0)"), field("Graduation date", { type: "date" })], profile);
    expect(plan.map((p) => p.reason)).toEqual(["format", "format"]);
  });

  it("suggests saved answers for similar questions", () => {
    const answers = [{ id: "a1", question: "Why do you want to join Acme?", answer: "Because...", updatedAt: 0 }];
    expect(matchSavedAnswer("Why do you want to join our team at Globex?", answers)).toBeNull(); // too different
    expect(matchSavedAnswer("Why do you want to join Acme Corp?", answers)?.id).toBe("a1");
    const [q] = planAutofill([field("Why do you want to join Acme Corp?", { tag: "textarea" })], profile, answers);
    expect(q).toMatchObject({ action: "fill", source: "library", answerId: "a1", value: "Because..." });
  });
});

describe("draftAnswer", () => {
  it("returns the drafted text and includes the resume in the request", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers: [{ id: "q", answer: "I built a React dashboard..." }] }) } }] }), { status: 200 }),
    );
    const out = await draftAnswer({ provider: "groq", apiKey: "gsk_x" }, { question: "Why us?", context: RESUME }, { fetchImpl });
    expect(out).toBe("I built a React dashboard...");
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1].content).toContain("Reduced API latency");
  });
});
