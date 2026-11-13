import { describe, expect, it, vi } from "vitest";
import {
  atsTailorHints,
  atsVendorCheck,
  detectAtsVendor,
  extractPostDetails,
  findOfficialJobs,
  guessCompany,
  phraseGaps,
  scanPost,
  slugCandidates,
  titleSimilarity,
  writePostReplies,
  EMPTY_PROFILE,
} from "../src";
import { JD, RESUME } from "./fixtures";

const POST = `🚀 Acme Robotics is hiring! We're looking for a Backend Engineer (0-2 yrs) in Bengaluru.
Skills: Python, FastAPI, PostgreSQL, Docker.
Interested folks can share their resume at careers@acmerobotics.in with subject "Backend Engineer - <Your Name>".
Please mention current CTC and notice period. Or DM me!
Apply: https://jobs.lever.co/acmerobotics/123 #hiring #backend`;

describe("scanPost", () => {
  it("extracts emails, links, hashtags and instructions verbatim", () => {
    const s = scanPost(POST);
    expect(s.emails).toEqual(["careers@acmerobotics.in"]);
    expect(s.urls).toEqual(["https://jobs.lever.co/acmerobotics/123"]);
    expect(s.hashtags).toEqual(["hiring", "backend"]);
    expect(s.wantsDm).toBe(true);
    expect(s.wantsEmail).toBe(true);
    expect(s.subjectFormat).toBe("Backend Engineer - <Your Name>");
    expect(guessCompany(POST)).toBe("Acme Robotics");
  });
});

const ai = { provider: "groq" as const, apiKey: "gsk_testkey_1234567890" };
const reply = (content: unknown) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 }));

describe("extractPostDetails", () => {
  it("never keeps an email or link the post doesn't contain", async () => {
    const fetchImpl = reply({
      company: "Acme Robotics", role: "Backend Engineer", location: "Bengaluru", experience: "0-2 years", employment_type: "",
      contact_name: "", contact_role: "", emails: ["careers@acmerobotics.in", "invented@acme.com"], apply_url: "https://evil.example.com",
      apply_method: "email", subject_format: "", include: ["current CTC", "notice period"], skills: ["Python"], deadline: "",
    });
    const d = await extractPostDetails(ai, POST, { fetchImpl });
    expect(d.emails).toEqual(["careers@acmerobotics.in"]);
    expect(d.applyUrl).toBe("");
    expect(d.subjectFormat).toBe("Backend Engineer - <Your Name>");
    expect(d.include).toEqual(["current CTC", "notice period"]);
  });
});

describe("writePostReplies", () => {
  it("collects [ADD: …] placeholders and caps the connection note", async () => {
    const fetchImpl = reply({
      email_subject: "Backend Engineer - Asha", email_body: "Hi team,\n\nI'd like to apply for the Backend Engineer role. Notice period: [ADD: notice period]. My resume is attached.",
      dm: "Hi, I've emailed my resume for the Backend Engineer role.", connection_note: "x".repeat(400), missing_info: ["current CTC"],
    });
    const out = await writePostReplies(ai, {
      profile: { ...EMPTY_PROFILE, firstName: "Asha" }, postText: POST,
      details: { company: "Acme Robotics", role: "Backend Engineer", location: "", experience: "", employmentType: "", contactName: "", contactRole: "", emails: [], applyUrl: "", applyMethod: "email", subjectFormat: "", include: [], skills: [], deadline: "" },
    }, { fetchImpl });
    expect(out.missingInfo).toEqual(["current CTC", "notice period"]);
    expect(out.connectionNote.length).toBeLessThanOrEqual(300);
  });
});

describe("official job matching", () => {
  it("scores title similarity and guesses board slugs", () => {
    expect(titleSimilarity("Backend Engineer", "Software Engineer, Backend")).toBe(1);
    expect(titleSimilarity("SDE-1 Backend", "Software Engineer I - Backend")).toBeGreaterThanOrEqual(0.5);
    expect(titleSimilarity("Product Designer", "Backend Engineer")).toBe(0);
    expect(slugCandidates("Acme Robotics Pvt Ltd")).toContain("acmerobotics");
    expect(slugCandidates("Sarvam AI")).toEqual(expect.arrayContaining(["sarvamai", "sarvam-ai"]));
  });

  it("finds the role on a guessed board", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("api.lever.co/v0/postings/acmerobotics")) {
        return new Response(JSON.stringify([
          { id: "1", text: "Backend Engineer", hostedUrl: "https://jobs.lever.co/acmerobotics/1", categories: { location: "Bengaluru" }, descriptionPlain: "Python" },
          { id: "2", text: "Product Designer", hostedUrl: "https://jobs.lever.co/acmerobotics/2", categories: {} },
        ]), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    const found = await findOfficialJobs("Acme Robotics", "Backend Engineer", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(found.map((f) => f.job.url)).toEqual(["https://jobs.lever.co/acmerobotics/1"]);
  });
});

describe("ATS vendors", () => {
  it("detects the ATS from job URLs and embedded career pages", () => {
    expect(detectAtsVendor("https://walmart.wd5.myworkdayjobs.com/en-US/WalmartExternal/job/123")).toBe("workday");
    expect(detectAtsVendor("https://careers-acme.icims.com/jobs/1/job")).toBe("icims");
    expect(detectAtsVendor("https://acme.taleo.net/careersection/2/jobdetail.ftl")).toBe("taleo");
    expect(detectAtsVendor("https://career5.successfactors.eu/career?company=acme")).toBe("successfactors");
    expect(detectAtsVendor("https://www.linkedin.com/jobs/view/1")).toBe("linkedin");
    expect(detectAtsVendor("https://acme.com/careers", '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme">')).toBe("greenhouse");
    expect(detectAtsVendor("https://acme.com/careers")).toBe("unknown");
  });

  it("finds abbreviation / long-form mismatches", () => {
    expect(phraseGaps("Built natural language processing pipelines", "Experience with NLP required")).toEqual([{ jobTerm: "NLP", resumeTerm: "natural language processing" }]);
    expect(phraseGaps("Worked on NLP and natural language processing", "NLP")).toEqual([]);
  });

  it("weights checks by parser strictness and gives vendor tips + tailoring hints", () => {
    const job = { title: "Software Engineer Intern", text: JD };
    const strict = atsVendorCheck(RESUME, { ...job, url: "https://acme.wd1.myworkdayjobs.com/x" });
    const lenient = atsVendorCheck(RESUME, { ...job, url: "https://jobs.lever.co/acme/1" });
    expect(strict.vendor).toBe("workday");
    expect(lenient.vendor).toBe("lever");
    expect(strict.checks.find((c) => c.id === "keywords")!.weight).toBeLessThan(lenient.checks.find((c) => c.id === "keywords")!.weight);
    expect(strict.score).toBeGreaterThan(0);
    expect(strict.tips.join(" ")).toMatch(/Workday/);
    expect(atsTailorHints("workday", "natural language processing", "NLP").join(" ")).toMatch(/“NLP”/);
    expect(atsTailorHints("lever").join(" ")).toMatch(/human reads/);
  });
});
