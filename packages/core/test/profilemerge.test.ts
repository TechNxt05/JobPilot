import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, mergeProfile, profileFromResume } from "../src";

const A = `Asha Verma
asha@example.com
PROJECTS
RAGOps - Enterprise RAG Platform Code | Live Next.js, FastAPI, LangChain 2026
• Built a RAG platform with hybrid retrieval and evaluation for many teams.
SKILLS
Python, Docker, LangChain`;
const B = `Asha Verma
asha@example.com
PROJECTS
RAGOps - RAG Platform Code | Live Next.js, FastAPI 2026
• Built a RAG platform with hybrid retrieval.
TribeBharat - E-Commerce Platform Site Django, React 2025
• Helped launch a store taking real orders.
SKILLS
python, Django, React`;

describe("several resumes into one profile", () => {
  it("never changes the shared empty profile", () => {
    profileFromResume(A); profileFromResume(B);
    expect(EMPTY_PROFILE.skills).toEqual([]);
    expect(EMPTY_PROFILE.projects).toEqual([]);
  });

  it("adds projects and skills the profile doesn't have yet, once", () => {
    const a = profileFromResume(A);
    const b = profileFromResume(B);
    expect(a.projects.map((p) => p.name)).toEqual(["RAGOps - Enterprise RAG Platform"]);
    expect(b.projects.map((p) => p.name)).toEqual(["RAGOps - RAG Platform", "TribeBharat - E-Commerce Platform"]);
    const m = mergeProfile({ ...EMPTY_PROFILE, ...a }, b);
    expect(m.projects.map((p) => p.name)).toEqual(["RAGOps - Enterprise RAG Platform", "TribeBharat - E-Commerce Platform"]);
    const lower = m.skills.map((s) => s.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    expect(lower).toEqual(expect.arrayContaining(["python", "django", "react", "docker"]));
    expect(a.projects.length).toBe(1); // inputs untouched
  });
});
