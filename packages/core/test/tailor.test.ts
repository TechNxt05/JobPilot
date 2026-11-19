import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  compileLatex,
  compileOnePage,
  completeParsed,
  coverLetterText,
  escapeLatex,
  fitToWords,
  shrinkResume,
  tightenBullet,
  BULLET_LINE_CHARS,
  fitSkillRows,
  cleanJobTitle,
  titleLine,
  missingJobSkills,
  markInProfile,
  addSkillsToProfile,
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
    // source_index 9 does not exist; the role the model left out (ML Research Intern) is kept with its own bullets
    expect(resume.experience.map((e) => e.title)).toEqual(["Software Engineering Intern", "ML Research Intern"]);
    expect(resume.experience[1].bullets[0]).toBe("Trained PyTorch models for text classification on 120k samples");
    expect(resume.experience[0]).toMatchObject({ title: "Software Engineering Intern", company: "Flipkart", dates: "May 2024 – Jul 2024" });
    // The rewrite dropped the only bullets showing React and Jest-tested work the job wants: the originals come back
    expect(resume.experience[0].bullets[0]).toBe("Reduced API latency by 35% by adding Redis caching to a Node.js service");
    expect(resume.experience[0].bullets).toContain("Built a React dashboard used by 40+ sellers to track returns");
    expect(report.alignmentAfter!).toBeGreaterThanOrEqual(report.alignmentBefore!);
    // Kubernetes removed (not in the profile); job skills the profile shows (Java) are added back
    expect(resume.skills[0].items.slice(0, 2)).toEqual(["Python", "TypeScript"]);
    expect(resume.skills.flatMap((g) => g.items)).not.toContain("Kubernetes");
    expect(resume.skills[0].items).toContain("Java");
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

describe("approved skills (skill picker)", () => {
  it("lists job skills missing from the resume, profile ones first", () => {
    const p = { ...profile, skills: [...profile.skills, "Docker"] };
    const missing = missingJobSkills("Need Python, Docker and Kubernetes.", "Python developer", p);
    expect(missing).toEqual([{ skill: "Docker", inProfile: true }, { skill: "Kubernetes", inProfile: false }]);
  });

  it("adds approved skills to Skills, keeps them out of bullets, and drops less relevant skills to fit a row", async () => {
    const longRow = ["Python", "TypeScript", "Ruby", "PHP", "Scala", "MATLAB", "Dart", "Kotlin", "Swift", "Solidity", "Verilog", "Bash", "Rust", "C#", "Haskell", "Elixir"];
    const p = { ...profile, skills: [...profile.skills, ...longRow] };
    const fetchImpl = vi.fn(async () =>
      chat({
        headline: "", summary: "A summary",
        experience: [{ source_index: 0, bullets: ["Reduced API latency by 35% by adding Redis caching to a Node.js service", "Ran the service on Kubernetes"] }],
        projects: [], skills: [{ category: "Languages", items: longRow }], extras: [], notes: [],
      }),
    );
    const { resume, report } = await tailorResume({ provider: "groq", apiKey: "gsk_x" },
      { profile: p, resumeText: RESUME, job: { ...job, text: `${JD}\nKubernetes and Go required.` }, addSkills: ["Kubernetes", "Go"] },
      { fetchImpl: fetchImpl as unknown as typeof fetch });
    const items = resume.skills.flatMap((g) => g.items);
    expect(items).toEqual(expect.arrayContaining(["Kubernetes", "Go"]));
    expect(resume.experience[0].bullets.join(" ")).not.toContain("Kubernetes"); // approved for Skills, not a claimed achievement
    expect(report.addedSkills).toEqual(expect.arrayContaining(["Kubernetes", "Go"]));
    expect(report.skillGaps).not.toContain("Kubernetes");
    expect(report.droppedSkills.length).toBeGreaterThan(0);
    for (const g of resume.skills) expect(`${g.category}: ${g.items.join(", ")}`.length).toBeLessThanOrEqual(118);
    expect(resume.summary).toBe("");
    const tex = renderResumeLatex(resume);
    expect(tex).toContain("\\usepackage{sourcesanspro}");
    expect(tex).toContain("\\section{Technical Skills}");
    expect(tex).toContain("Kubernetes");
  });

  it("puts the job title and matching skills on one line under the name", () => {
    expect(cleanJobTitle("Senior AI Engineer - Remote (m/f/d)")).toBe("Senior AI Engineer");
    expect(cleanJobTitle("ML Engineer (Hybrid) #REQ-4521")).toBe("ML Engineer");
    expect(cleanJobTitle("Software Engineer, Backend")).toBe("Software Engineer, Backend");
    const line = titleLine("AI Engineer", ["Python", "RAG", "FastAPI", "Docker", "LangChain", "PostgreSQL", "Kubernetes"]);
    expect(line).toBe("AI Engineer · Python, RAG, FastAPI, Docker, LangChain");
    expect(titleLine("", ["Python"])).toBe("");
    const r = { name: "A B", headline: line, contact: { email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" }, summary: "", education: [], experience: [], projects: [], skills: [], extras: [] };
    expect(renderResumeLatex(r)).toContain("AI Engineer $\\,\\cdot\\,$ Python, RAG");
  });

  it("never drops skills the job needs", () => {
    const { groups, dropped } = fitSkillRows([{ category: "Tools", items: ["Docker", "Jira", "Postman", "Kubernetes"] }], new Set(["Docker", "Kubernetes"]), 30);
    expect(groups[0].items).toEqual(["Docker", "Kubernetes"]);
    expect(dropped).toEqual(["Postman", "Jira"]);
  });

  it("adds skills to the profile without duplicates", () => {
    const p = { ...profile, skills: ["React.js", "Python"] };
    expect(addSkillsToProfile(p, ["React", "Kubernetes", "kubernetes"]).skills).toEqual(["React.js", "Python", "Kubernetes"]);
    expect(addSkillsToProfile(p, ["python"])).toBe(p);
  });

  it("lists every skill the job analysis found as missing, not only dictionary skills", () => {
    const jd = "We use Ruby and Ruby on Rails, plus Sidekiq and event sourcing.";
    const list = missingJobSkills(jd, "Python, React", { ...profile, skills: ["Sidekiq"] }, ["Ruby", "Sidekiq", "Event sourcing", "Python"]);
    const names = list.map((m) => m.skill);
    // Exactly the analysis's list: nothing extra from the dictionary ("Ruby on Rails")
    expect(names.sort()).toEqual(["Event sourcing", "Ruby", "Sidekiq"]);
    expect(list.find((m) => m.skill === "Sidekiq")?.inProfile).toBe(true);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    // No analysis list: falls back to dictionary hits in the posting
    expect(missingJobSkills(jd, "Python", profile).map((m) => m.skill)).toEqual(expect.arrayContaining(["Ruby", "Ruby on Rails"]));
    expect(markInProfile(["Sidekiq", "Go"], { ...profile, skills: ["Sidekiq"] })).toEqual([{ skill: "Sidekiq", inProfile: true }, { skill: "Go", inProfile: false }]);
  });
});

describe("one-page trimming keeps the job's proof", () => {
  it("drops the least job-relevant bullet and project, not simply the last one", () => {
    const r = {
      name: "A", headline: "", contact: { email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" }, summary: "",
      education: [], extras: [], skills: [],
      experience: [{ title: "Intern", company: "Acme", location: "", dates: "", bullets: [
        "Wrote internal docs for the onboarding wiki",
        "Organised weekly team demos and retros",
        "Planned the quarterly offsite agenda",
        "Built the billing service in Kubernetes on AWS",
      ] }],
      projects: [
        { name: "Chatbot", link: "", tech: "Python", bullets: ["Built a GraphQL API for the chatbot"] },
        { name: "Blog", link: "", tech: "", bullets: ["Wrote posts"] },
        { name: "Game", link: "", tech: "", bullets: ["Made a puzzle game"] },
      ],
    };
    const jobSkills = ["Kubernetes", "AWS", "GraphQL"];
    const once = shrinkResume(r, jobSkills)!;
    // First a bullet from the 4-bullet role: a job-irrelevant one (the later one on a tie), never the only Kubernetes / AWS proof
    expect(once.experience[0].bullets).toEqual([
      "Wrote internal docs for the onboarding wiki",
      "Organised weekly team demos and retros",
      "Built the billing service in Kubernetes on AWS",
    ]);
    // Then a project: a job-irrelevant one, not the GraphQL one
    expect(shrinkResume(once, jobSkills)!.projects.map((x) => x.name)).toEqual(["Chatbot", "Blog"]);
    // The old behaviour, removing the last bullet, would have lost the Kubernetes / AWS proof
    expect(shrinkResume(r)!.experience[0].bullets).not.toContain("Built the billing service in Kubernetes on AWS");
  });
});

describe("tightening bullets that spill onto an extra line", () => {
  const spill = "Successfully utilized FastAPI and PostgreSQL in order to build a retrieval service that cut ticket triage time for the support team";
  it("saves the line with same-meaning wording, only when it saves the line", () => {
    expect(spill.length).toBeGreaterThan(BULLET_LINE_CHARS);
    const t = tightenBullet(spill)!;
    expect(t.length).toBeLessThanOrEqual(BULLET_LINE_CHARS);
    // The smallest edit that saves the line: the rest of the wording stays yours
    expect(t).toBe("Successfully utilized FastAPI and PostgreSQL to build a retrieval service that cut ticket triage time for the support team");
    // Already one line, or a real second line, or nothing to tighten: left alone
    expect(tightenBullet("Built a retrieval service with FastAPI")).toBeNull();
    expect(tightenBullet("x ".repeat(100))).toBeNull();
    expect(tightenBullet("Built a retrieval service with FastAPI and PostgreSQL that cut ticket triage time for the support team across three regions")).toBeNull();
  });

  it("tightens before removing anything", () => {
    const r = {
      name: "A", headline: "", contact: { email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" }, summary: "",
      education: [], extras: [], skills: [], projects: [],
      experience: [{ title: "Intern", company: "Acme", location: "", dates: "", bullets: ["Wrote docs", "Ran demos", "Planned offsite", spill] }],
    };
    const once = shrinkResume(r)!;
    expect(once.experience[0].bullets).toHaveLength(4);
    expect(once.experience[0].bullets[3].length).toBeLessThanOrEqual(BULLET_LINE_CHARS);
    // Nothing left to tighten: now a bullet goes
    expect(shrinkResume(once)!.experience[0].bullets).toHaveLength(3);
  });
});
