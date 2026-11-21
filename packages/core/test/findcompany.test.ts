import { describe, expect, it, vi } from "vitest";
import { boardGuesses, findCompanyBoards, sourceKey } from "../src";

describe("finding a company's job board by name", () => {
  it("uses the board JobPilot already knows", () => {
    expect(boardGuesses("JP Morgan").map(sourceKey)).toEqual(["oracle:jpmc.fa.oraclecloud.com/cx_1001"]);
    expect(boardGuesses("Microsoft")[0]).toMatchObject({ ats: "eightfold", slug: "apply.careers.microsoft.com/microsoft.com" });
    expect(boardGuesses("mastercard")[0]).toMatchObject({ ats: "sitemap", slug: "careers.mastercard.com" });
  });

  it("guesses every job system for an unknown company, once per spelling", () => {
    const keys = boardGuesses("Zepto").map(sourceKey);
    for (const k of ["greenhouse:zepto", "lever:zepto", "ashby:zepto", "breezy:zepto", "eightfold:zepto/zepto.com", "sitemap:careers.zepto.com", "sitemap:jobs.zepto.com"]) {
      expect(keys).toContain(k);
    }
    const sr = keys.filter((k) => k.toLowerCase().startsWith("smartrecruiters:"));
    expect(new Set(sr.map((k) => k.toLowerCase())).size).toBe(sr.length);
  });

  it("returns boards with real openings and drops boards of test postings", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io/v1/boards/zepto/")) {
        return new Response(JSON.stringify({ jobs: [{ id: 1, title: "SDE 1", absolute_url: "https://x/1", location: { name: "Bengaluru" } }] }));
      }
      if (url.includes("api.lever.co/v0/postings/zepto")) {
        return new Response(JSON.stringify([{ id: "a", text: "Test UAT", hostedUrl: "https://x/a", categories: {} }]));
      }
      return new Response("not found", { status: 404 });
    });
    const found = await findCompanyBoards("Zepto", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(found.map((f) => [sourceKey(f.source), f.jobs, f.sample])).toEqual([["greenhouse:zepto", 1, ["SDE 1 · Bengaluru"]]]);
  });
});

describe("boards that belong to another company", () => {
  it("are never offered for that name", () => {
    expect(boardGuesses("Pylon").map(sourceKey)).not.toContain("ashby:pylon");
    expect(boardGuesses("Pine Labs").map(sourceKey)).not.toContain("greenhouse:pine");
    expect(boardGuesses("Nous Research").map(sourceKey)).not.toContain("ashby:nous");
    expect(boardGuesses("Nous Research").map(sourceKey)).toContain("ashby:nousresearch");
  });
});
