import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, findSkills, mergeProfile, phraseGrounded, profileGains, type CandidateProfile } from "../src";

const base: CandidateProfile = {
  ...EMPTY_PROFILE,
  experience: [{ title: "Research Intern", company: "Defence Research & Development Organisation (DRDO)", location: "", start: "Jan 2026", end: "Jun 2026", description: "Engineered a multithreaded Win32 telemetry application." }],
  projects: [{ name: "AuditAI - LLM Reliability Platform", link: "", tech: "FastAPI", description: "Built a deterministic 5-point engine scoring hallucination and faithfulness." }],
  publications: [{ title: "ML-Assisted Design of a Tunable Microfluidic SIW Antenna", venue: "IEEE ICAIIC 2026", year: "2026", link: "" }],
  skills: ["Tailwind CSS", "AWS", "EC2", "Python"],
};

describe("growing a profile from a longer document", () => {
  const incoming: Partial<CandidateProfile> = {
    experience: [{ title: "Research Intern", company: "DRDO, Research Centre Imarat", location: "Hyderabad", start: "", end: "", description: "Engineered a native multithreaded Win32 telemetry application\nBuilt an RS-422 serial console and a headless CLI" }],
    projects: [
      { name: "AuditAI", link: "https://audit-ai-eosin.vercel.app", tech: "", description: "Fine-tuned DeBERTa-v3-base hallucination classifier on 65K HaluEval examples" },
      { name: "CallLens", link: "", tech: "Next.js, FastAPI", description: "Call quality scoring platform" },
    ],
    publications: [{ title: "ML-Assisted Design and Performance Modeling of a Tunable Microfluidic SIW Antenna", venue: "", year: "", link: "" }],
    skills: ["Tailwind", "AWS EC2", "LangGraph"],
  };
  const out = mergeProfile(base, incoming);

  it("adds new lines to the same job and project, and new entries once", () => {
    expect(out.experience).toHaveLength(1);
    expect(out.experience[0].description.split("\n")).toEqual(["Engineered a multithreaded Win32 telemetry application.", "Built an RS-422 serial console and a headless CLI"]);
    expect(out.experience[0].location).toBe("Hyderabad");
    expect(out.projects.map((p) => p.name)).toEqual(["AuditAI - LLM Reliability Platform", "CallLens"]);
    expect(out.projects[0].description).toContain("DeBERTa");
    expect(out.projects[0].link).toBe("https://audit-ai-eosin.vercel.app");
    expect(out.projects[0].tech).toBe("FastAPI"); // never overwritten
  });

  it("keeps papers and skills once", () => {
    expect(out.publications).toHaveLength(1);
    expect(out.skills).toEqual(["Tailwind CSS", "AWS", "EC2", "Python", "LangGraph"]);
  });

  it("says what it added", () => {
    expect(profileGains(base, out)).toEqual(["1 project", "1 skill", "2 existing entries given new details"]);
  });

  it("then knows the skills the new lines show", () => {
    const text = out.projects.map((p) => p.description).join("\n").toLowerCase();
    expect(findSkills(text).has("Fine-tuning")).toBe(true);
    expect(phraseGrounded("Hallucination detection", "hallucination, injection and grounding detectors")).toBe(true);
    expect(phraseGrounded("Hallucination detection", "scoring hallucination and faithfulness")).toBe(false);
  });
});
