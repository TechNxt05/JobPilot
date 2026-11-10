import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  compileLatex,
  compileOnePage,
  completeParsed,
  coverLetterText,
  escapeLatex,
  fitToWords,
  generateCoverLetter,
  latexToText,
  ONE_PAGE_WORDS,
  parseDuckDuckGoHtml,
  parseLetterText,
  pdfPageCount,
  profileFromResume,
  renderCoverLetterLatex,
  renderResumeLatex,
  repetitionReport,
  researchCompany,
  resumeText,
  tailorLatex,
  tailorResume,
  ungroundedNumbers,
  ungroundedSkills,
  ProviderError,
  toConfigs,
} from "../src";
import { JD, RESUME } from "./fixtures";

const chat = (content: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] } : { error: { message: String(content) } }), { status });
const gemini = (content: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }] }), { status: 200 });
const profile = profileFromResume(RESUME);
const job = { title: "Software Engineer Intern", company: "Acme", text: JD };

describe("provider fallback", () => {
  it("falls back to the next provider on auth / rate-limit / bad output, and reports every attempt", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("groq")) return chat("Invalid API Key", 401);
      if (url.includes("openrouter")) return chat("not json at all");
      return gemini({ ok: 1 });
    });
    const res = await completeParsed(
      [{ provider: "groq", apiKey: "gsk_a" }, { provider: "openrouter", apiKey: "sk-or-b" }, { provider: "gemini", apiKey: "AIzaC" }],
      { system: "s", user: "u", fetchImpl: fetchImpl as unknown as typeof fetch },
      (raw) => { const v = JSON.parse(raw); if (!v.ok) throw new ProviderError("bad", null, "invalid_output"); return v; },
    );
    expect(res.provider).toBe("gemini");
    expect(res.attempts.map((a) => [a.provider, !!a.error])).toEqual([["groq", true], ["openrouter", true], ["gemini", false]]);
  });

  it("throws a combined error when all fail, without leaking keys", async () => {
    const fetchImpl = vi.fn(async () => chat("rate limited", 429));
    const err = await completeParsed([{ provider: "groq", apiKey: "gsk_SECRETSECRET123" }, { provider: "openai", apiKey: "sk-SECRETSECRETSECRET99" }],
      { system: "s", user: "u", fetchImpl: fetchImpl as unknown as typeof fetch }, (r) => r).catch((e) => e);
    expect(err.message).toContain("All 2 AI providers failed");
    expect(err.message).not.toMatch(/SECRET/);
  });
});

describe("grounding", () => {
  it("flags invented numbers and skills", () => {
    expect(ungroundedNumbers("Cut latency 35% for 40+ sellers; grew users 300%", RESUME)).toEqual(["300%"]);
    expect(ungroundedSkills("Deployed on Kubernetes with Docker", RESUME)).toEqual(["Kubernetes"]);
  });
  it("finds repeated opening verbs", () => {
    expect(repetitionReport(["Built a", "Built b", "Built c", "Led d"])).toEqual([{ verb: "built", count: 3 }]);
  });
});

describe("latex helpers", () => {
  it("escapes special characters and strips emoji", () => {
    expect(escapeLatex("R&D at 50% cost_center #1 {x} ~ ^ \\ 🚀")).toBe("R\\&D at 50\\% cost\\_center \\#1 \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}");
  });
  it("turns LaTeX into readable text", () => {
    const t = latexToText(String.raw`\documentclass{article}\usepackage{x}
\begin{document}
\section{Experience} % comment
\textbf{SWE Intern}, Flipkart \hfill May 2024\\
\begin{itemize}\item Reduced latency by 35\% using \textit{Redis}\end{itemize}
\end{document}`);
    expect(t).toContain("Experience");
    expect(t).toContain("SWE Intern, Flipkart");
    expect(t).toContain("• Reduced latency by 35% using Redis");
    expect(t).not.toContain("usepackage");
    expect(t).not.toContain("comment");
  });
  it("counts PDF pages", async () => {
    const doc = await PDFDocument.create();
    doc.addPage(); doc.addPage();
    expect(await pdfPageCount(await doc.save())).toBe(2);
  });
});

describe("compileLatex", () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  it("uses YtoTech, falling back to texlive.net when it's unreachable", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("ytotech")) throw new TypeError("fetch failed");
      return new Response(pdfBytes, { status: 200 });
    });
    const res = await compileLatex("\\documentclass{article}", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.service).toBe("texlive.net");
  });
  it("surfaces real LaTeX errors with the log", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "COMPILATION_ERROR", log_files: { "__main_document__.log": "! Undefined control sequence.\nl.3 \\foo" } }), { status: 400 }));
    const err = await compileLatex("x", { fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err.name).toBe("LatexError");
    expect(err.log).toContain("Undefined control sequence");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("tailorResume (no LaTeX given)", () => {
  it("keeps facts from the profile, removes invented ones, reports gaps and scores", async () => {
    const fetchImpl = vi.fn(async () =>
      chat({
        headline: "Software engineering intern candidate",
        summary: "CS undergraduate who has shipped React and Node.js features.",
        experience: [
          { source_index: 0, bullets: ["Reduced API latency by 35% by adding Redis caching to a Node.js service", "Grew revenue 300% for sellers", "Managed Kubernetes clusters"] },
          { source_index: 9, bullets: ["Invented role"] },
        ],
        projects: [{ source_index: 0, bullets: ["Built a multi-agent pipeline with LangGraph and Python"] }],
        skills: [{ category: "Languages", items: ["Python", "TypeScript", "Kubernetes"] }],
        extras: [],
        notes: ["The job asks for AWS; your profile doesn't show it."],
      }),
    );
    const { resume, report } = await tailorResume({ provider: "groq", apiKey: "gsk_x" }, { profile, resumeText: RESUME, job }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(resume.name).toBe("Priya Sharma");
    expect(resume.contact.email).toBe("priya.sharma@example.com");
    expect(resume.experience).toHaveLength(1); // source_index 9 doesn't exist
    expect(resume.experience[0]).toMatchObject({ title: "Software Engineering Intern", company: "Flipkart", dates: "May 2024 – Jul 2024" });
    expect(resume.experience[0].bullets).toEqual(["Reduced API latency by 35% by adding Redis caching to a Node.js service"]);
    expect(resume.skills[0].items).toEqual(["Python", "TypeScript"]);
    expect(report.removed.map((r) => r.reason).join(" ")).toMatch(/300%.*Kubernetes|Kubernetes.*300%/s);
    expect(report.skillGaps).toEqual(expect.arrayContaining(["Kubernetes", "AWS"]));
    expect(report.atsAfter).toBeGreaterThan(0);
    expect(report.words).toBeLessThanOrEqual(ONE_PAGE_WORDS);
    const tex = renderResumeLatex(resume);
    expect(tex).toContain("\\pdfgentounicode=1");
    expect(tex).toContain("35\\%");
    expect(tex).toContain("\\section{Experience}");
  });

  it("shrinks long resumes to the one-page word budget", () => {
    const long = Array.from({ length: 8 }, (_, i) => `Shipped feature number ${i} with careful testing and clear documentation for the team`);
    const r = {
      name: "A", headline: "", contact: { email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" }, summary: "x ".repeat(40),
      education: [], experience: Array.from({ length: 4 }, () => ({ title: "T", company: "C", location: "", dates: "", bullets: long.slice(0, 4) })),
      projects: Array.from({ length: 3 }, () => ({ name: "P", link: "", tech: "", bullets: long.slice(0, 3) })),
      skills: [], extras: [{ heading: "Achievements", items: long }],
    };
    const fitted = fitToWords(r, 300);
    expect(resumeText(fitted).split(/\s+/).length).toBeLessThanOrEqual(300);
    expect(fitted.experience.length).toBe(4); // roles are kept; bullets go first
  });
});

describe("tailorLatex (user's Overleaf code)", () => {
  const original = String.raw`\documentclass{article}
\newcommand{\role}[1]{\textbf{#1}}
\begin{document}
\section{Experience}
\role{SWE Intern}, Flipkart
\begin{itemize}\item Reduced API latency by 35\% with Redis\end{itemize}
\end{document}`;

  it("restores the original preamble and warns about invented facts", async () => {
    const changed = String.raw`\documentclass{article}
\usepackage{fontawesome}
\begin{document}
\section{Experience}
\role{SWE Intern}, Flipkart
\begin{itemize}\item Reduced API latency by 35\% with Redis, serving 2M users on Kubernetes\end{itemize}
\end{document}`;
    const fetchImpl = vi.fn(async () => chat({ latex: changed, changes: ["Tightened bullet"] }));
    const res = await tailorLatex({ provider: "groq", apiKey: "gsk" }, { profile, resumeText: RESUME, job, latex: original }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.latex).toContain("\\newcommand{\\role}");
    expect(res.latex).not.toContain("fontawesome");
    expect(res.warnings.join(" ")).toMatch(/2M/);
    expect(res.warnings.join(" ")).toMatch(/Kubernetes/);
    expect(res.changes).toEqual(["Tightened bullet"]);
  });
});

describe("cover letter", () => {
  it("parses DuckDuckGo results", () => {
    const html = `<div class="result results_links"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fabout&rut=x">About <b>Acme</b></a>
      <a class="result__snippet" href="#">Acme builds developer tools &amp; cloud APIs.</a></div>`;
    expect(parseDuckDuckGoHtml(html)).toEqual([{ title: "About Acme", snippet: "Acme builds developer tools & cloud APIs.", url: "https://acme.com/about" }]);
  });

  it("researches with Serper first, DuckDuckGo when Serper has nothing", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("serper")) return new Response(JSON.stringify({ organic: [{ title: "Acme", snippet: "Acme makes APIs", link: "https://acme.com" }] }), { status: 200 });
      return new Response(`<div class="result x"><a class="result__a" href="https://news.example/acme">News</a><a class="result__snippet">Acme raised funding</a></div>`, { status: 200 });
    });
    const r = await researchCompany("Acme", "SWE Intern", { serperKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.map((x) => x.url)).toEqual(["https://acme.com", "https://news.example/acme"]);
  });

  it("writes a grounded letter, warns on invented facts, renders LaTeX", async () => {
    const fetchImpl = vi.fn(async () =>
      chat({ subject: "Application", greeting: "Dear Hiring Team,", paragraphs: ["At Flipkart I reduced API latency by 35% with Redis.", "I also led a team of 12 engineers."], closing: "Sincerely," }),
    );
    const letter = await generateCoverLetter({ provider: "groq", apiKey: "g" }, { profile, resumeText: RESUME, job, research: [] }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(letter.paragraphs).toHaveLength(2);
    expect(letter.warnings.join(" ")).toContain("12");
    const text = coverLetterText(letter, "Priya Sharma");
    expect(parseLetterText(text)).toMatchObject({ greeting: "Dear Hiring Team,", closing: "Sincerely," });
    expect(parseLetterText(text).paragraphs[0]).toContain("Flipkart");
    const tex = renderCoverLetterLatex(letter, profile, "Acme");
    expect(tex).toContain("35\\%");
    expect(tex).toContain("Priya Sharma");
  });
});

describe("currency metrics", () => {
  it("treats Rs./₹ amounts as numbers without matching words ending in 'rs'", () => {
    expect(ungroundedNumbers("Saved Rs. 50k for 40 users", "budget of Rs 50k")).toEqual(["40"]);
  });
});

describe("compileOnePage", () => {
  it("keeps trimming until one page, even when only one trim is possible per pass", async () => {
    const r = {
      name: "A", headline: "", contact: { email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" },
      summary: "Short summary.", education: [],
      experience: [{ title: "T", company: "C", location: "", dates: "", bullets: ["a", "b"] }],
      projects: [{ name: "P", link: "", tech: "", bullets: ["c"] }], skills: [], extras: [],
    };
    let calls = 0;
    const out = await compileOnePage(r, async () => new Uint8Array([++calls]), async (pdf) => (pdf[0] === 1 ? 2 : 1));
    expect(calls).toBe(2);
    expect(out.pages).toBe(1);
    expect(out.resume.summary).toBe(""); // the one available trim was kept
  });
});

describe("provider timeouts and placeholders", () => {
  it("falls back when a provider hangs", async () => {
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("groq")) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      }
      return Promise.resolve(gemini({ ok: 1 }));
    });
    const res = await completeParsed(
      [{ provider: "groq", apiKey: "gsk_hanging_key_123" }, { provider: "gemini", apiKey: "AIzaWorkingKey123" }],
      { system: "s", user: "u", fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 50 },
      (raw) => JSON.parse(raw),
    );
    expect(res.provider).toBe("gemini");
    expect(res.attempts[0].error).toContain("timed out");
  });

  it("ignores placeholder keys from .env templates", () => {
    expect(toConfigs([{ provider: "openai", apiKey: "your_openai_api_key" }, { provider: "groq", apiKey: "gsk_realLookingKey" }]).map((c) => c.provider)).toEqual(["groq"]);
  });
});
