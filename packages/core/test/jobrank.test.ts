import { describe, expect, it, vi } from "vitest";
import { rankJobsWithAI } from "../src";

describe("AI job-fit scoring", () => {
  it("scores many jobs in one call and maps the answers back", async () => {
    const reply = { results: [{ id: "j2", score: "92", reason: "Strong RAG and agent match" }, { id: "j1", score: 140, reason: "x" }, { id: "j9", score: 50, reason: "unknown job" }] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })));
    const jobs = [
      { id: "greenhouse:acme:1", title: "Ops", company: "Acme", location: "", text: "Call centre operations" },
      { id: "ashby:beta:2", title: "AI Engineer", company: "Beta", location: "India", text: "LangGraph agents and RAG" },
      { id: "lever:gamma:3", title: "QA", company: "Gamma", location: "", text: "" },
    ];
    const ranks = await rankJobsWithAI({ provider: "groq", apiKey: "gsk_aaaaaaaaaa" }, "Candidate: RAG, LangGraph", jobs, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(ranks).toEqual({
      "ashby:beta:2": { score: 92, reason: "Strong RAG and agent match" },
      "greenhouse:acme:1": { score: 100, reason: "x" },
    });
  });
});
