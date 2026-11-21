import { describe, expect, it } from "vitest";
import { ensureSkills, ensureSkillsInLatex, latexToText, phraseGrounded, type TailoredResume } from "../src";

const resume: TailoredResume = {
  name: "A", headline: "", contact: { email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" }, summary: "",
  education: [], experience: [], projects: [], extras: [],
  skills: [{ category: "Languages", items: ["Python", "Java"] }, { category: "AI / GenAI", items: ["LangChain", "RAG"] }, { category: "Tools", items: ["Docker", "Git"] }],
};

describe("skills the candidate ticked always reach the resume", () => {
  it("puts back the ones the AI left out, once", () => {
    const { resume: out, inserted } = ensureSkills(resume, ["Python", "Jenkins", "AI Agents", "NoSQL", "Large-scale AI/ML"]);
    expect(inserted).toEqual(["Jenkins", "AI Agents", "NoSQL", "Large-scale AI/ML"]);
    const all = out.skills.flatMap((g) => g.items);
    for (const s of inserted) expect(all).toContain(s);
    expect(all.filter((x) => x === "Python")).toHaveLength(1);
    expect(resume.skills[0].items).toEqual(["Python", "Java"]); // input untouched
  });

  it("adds them to the skills row of a pasted LaTeX resume", () => {
    const tex = String.raw`\documentclass{article}
\begin{document}
\section{Experience}
\item Built things with Python, Docker and AWS, at scale, fast
\section{Technical Skills}
\begin{itemize}
  \item \textbf{Languages}{: Python, Java, C++} \\
  \item \textbf{AI}{: LangChain, LangGraph, RAG, FAISS, PyTorch} \\
\end{itemize}
\end{document}`;
    const { latex, inserted } = ensureSkillsInLatex(tex, ["Python", "Jenkins", "R&D"]);
    expect(inserted).toEqual(["Jenkins", "R&D"]);
    expect(latex).toContain(String.raw`\textbf{AI}{: LangChain, LangGraph, RAG, FAISS, PyTorch, Jenkins, R\&D} \\`);
    expect(latexToText(latex)).toContain("Jenkins");
    expect(ensureSkillsInLatex(latex, ["Jenkins"]).inserted).toEqual([]);
  });
});

describe("skills on the resume must be in the profile, every part of them", () => {
  it("keeps Vector DB for a profile with vector databases, not SageMaker for a profile with only AWS", () => {
    expect(phraseGrounded("Vector DB", "skills: vector databases, faiss")).toBe(true);
    expect(phraseGrounded("SageMaker", "skills: aws ec2, docker")).toBe(false);
  });
});
