import { describe, expect, it } from "vitest";
import { computeAlignment, analyzeResume, jobRelevance, type JobRequirements } from "../src";

const candidate = `AI Systems Engineer. Python, Java, TypeScript, C++, LangChain, LangGraph, RAG, FAISS, LLMs, FastAPI, Docker, PostgreSQL,
Redis, AWS, React, Next.js, PyTorch, TensorFlow, Machine Learning. Built a 7-agent LangGraph workflow and an enterprise RAG platform.`;

describe("is a job in the candidate's field", () => {
  const rel = (title: string, text: string) => jobRelevance({ title, text }, [], candidate).relevant;

  it("drops roles where only everyday languages or buzzwords match", () => {
    expect(rel("CPU Verification Engineer", "SystemVerilog, UVM, Verilog, C++, Python scripting, computer architecture")).toBe(false);
    expect(rel("Simulation Engineer", "MATLAB, Simulink, C++, Python, ROS, control systems")).toBe(false);
    expect(rel("Analyst - Data & Analytics", "Tableau, accounting, SAP. We leverage artificial intelligence and machine learning.")).toBe(false);
    expect(rel("Automated Operations Engineer", "Service monitoring, alarm handling, ITIL, call centers, customer complaint resolution")).toBe(false);
  });

  it("keeps software, AI and data roles that use your skills", () => {
    expect(rel("Software Engineer - I (AI Engineer, Agentic System)", "Python, LLM APIs, tool calling, RAG pipelines, PostgreSQL, Docker")).toBe(true);
    expect(rel("Software Engineer - 1 (Backend)", "Java or Python, REST APIs, PostgreSQL, Redis, AWS")).toBe(true);
    expect(rel("Machine Learning Engineer", "PyTorch, TensorFlow, model training, Python")).toBe(true);
    expect(rel("Software Engineer", "Java and Python")).toBe(true);
    // Any title, when two of your specialist skills match
    expect(rel("Associate", "Build LangChain agents with FastAPI")).toBe(true);
  });
});

describe("no skills in a posting, no score", () => {
  it("a degree match alone isn't a 100% job match", () => {
    const req: JobRequirements = { requiredSkills: [], preferredSkills: [], minYearsExperience: null, degreeLevels: ["bachelor"], minCgpa: null, graduationYears: [], deadline: null, origin: "heuristic" };
    const report = computeAlignment(req, analyzeResume("EDUCATION\nB.Tech in Computer Science, 2026"));
    expect(report.dimensions.find((d) => d.id === "education")!.score).toBe(100);
    expect(report.overall).toBeNull();
  });
});
