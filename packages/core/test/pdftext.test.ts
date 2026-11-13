import { describe, expect, it } from "vitest";
import { classifyLinks, cleanResumeText, itemsToText, joinWrappedLines, linkForProject, profileFromResume, type PdfTextItem } from "../src";

const item = (str: string, x: number, y: number, width: number, size = 10): PdfTextItem => ({ str, x, y, width, size });

describe("itemsToText", () => {
  it("rebuilds spaces from glyph gaps and breaks lines on baseline changes", () => {
    // A LaTeX PDF that stores words as separate runs with no space characters
    const page = [item("Engineered", 0, 700, 50), item("a", 52.5, 700, 5), item("native", 60, 700, 30), item("app", 0, 688, 15)];
    expect(itemsToText([page])).toBe("Engineered a native\napp");
  });
  it("doesn't add a space inside a word split across runs", () => {
    expect(itemsToText([[item("Lang", 0, 700, 20), item("Graph", 20.2, 700, 25)]])).toBe("LangGraph");
  });
});

describe("cleanResumeText", () => {
  it("turns icon glyphs into separators and fixes extraction junk", () => {
    const raw = [
      "Asha Rao Pune, Maharashtra",
      "Ledgerly - Expense Tracker \u0087  W Next.js, FastAPI 2026",
      "Payments Platform W Django, React Dec 2025",
      "� Built a ledger � fast",
      "(cid:135) Docs",
    ].join("\n");
    expect(cleanResumeText(raw).split("\n")).toEqual([
      "Asha Rao Pune, Maharashtra",
      "Ledgerly - Expense Tracker · Next.js, FastAPI 2026",
      "Payments Platform · Django, React Dec 2025",
      "• Built a ledger — fast",
      "Docs",
    ]);
  });
  it("leaves a real W in bullet text alone", () => {
    expect(cleanResumeText("• Measured W boson decay")).toBe("• Measured W boson decay");
  });
});

describe("links", () => {
  it("classifies resume links and matches projects by name", () => {
    const l = classifyLinks([
      "mailto:a@x.com",
      "https://www.linkedin.com/in/asha-rao/",
      "https://github.com/asharao",
      "https://asha-portfolio.vercel.app/",
      "https://scholar.google.com/citations?user=ABC",
      "https://github.com/asharao/Ledgerly",
      "https://ledgerly-app.vercel.app/",
      "https://ieeexplore.ieee.org/document/1",
    ]);
    expect(l.linkedin).toContain("linkedin.com/in/asha-rao");
    expect(l.github).toBe("https://github.com/asharao");
    expect(l.portfolio).toBe("https://asha-portfolio.vercel.app/");
    expect(l.scholar).toContain("scholar.google.com");
    expect(l.papers).toEqual(["https://ieeexplore.ieee.org/document/1"]);
    expect(linkForProject("Ledgerly - Expense Tracker", l.projects)).toEqual({ live: "https://ledgerly-app.vercel.app/", repo: "https://github.com/asharao/Ledgerly" });
  });
});

describe("joinWrappedLines", () => {
  it("joins a bullet's continuation lines but keeps the next header", () => {
    expect(joinWrappedLines([
      "• Built an enterprise platform with hybrid retrieval, reranking, query routing,",
      "citation verification and failover.",
      "Second Project · Django 2025",
      "• Shipped it.",
    ])).toEqual([
      "• Built an enterprise platform with hybrid retrieval, reranking, query routing, citation verification and failover.",
      "Second Project · Django 2025",
      "• Shipped it.",
    ]);
  });
});

const RESUME = `Asha Rao Pune, Maharashtra
asha@example.com | LinkedIn | GitHub | Portfolio | +91-9000000000
EXPERIENCE
Bharat Analytics Labs — Data Science Intern Jan 2026 - Jun 2026
• Built forecasting models for retail demand across 40 stores, cutting stockouts by
18% in the pilot region.
Northwind — Software Engineer Intern (Remote) Jun 2025 – Aug 2025
• Wrote FastAPI services and pytest suites for the billing team.
PROJECTS
Ledgerly - Expense Tracker · Next.js, FastAPI, PostgreSQL 2026
• Built an expense tracker with receipts OCR and monthly
budgets for 200 users.
Payments Platform · Django, React Dec 2025
• Integrated Razorpay payments.
RESEARCH PUBLICATIONS
IEEE ICXYZ 2026, Tokyo — Learning to Rank Retail Demand Signals · 2026
• Proposed a ranking loss for sparse demand.
EDUCATION
Indian Institute of Information Technology, Pune 2022 – 2026
B.Tech in Computer Science and Engineering CGPA: 8.4
TECHNICAL SKILLS
Languages: Python, TypeScript, SQL`;

describe("profileFromResume on a LaTeX-style resume", () => {
  const p = profileFromResume(RESUME, [
    "https://www.linkedin.com/in/asha-rao/",
    "https://github.com/asharao",
    "https://github.com/asharao/Ledgerly",
    "https://ieeexplore.ieee.org/document/1",
  ]);
  it("splits the name from the location on the same line", () => {
    expect([p.firstName, p.lastName, p.city, p.country]).toEqual(["Asha", "Rao", "Pune", "India"]);
  });
  it("takes links from the PDF when the text only says LinkedIn / GitHub", () => {
    expect(p.linkedin).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(p.github).toBe("https://github.com/asharao");
  });
  it("reads Company — Title headers and joins wrapped bullets", () => {
    expect(p.experience.map((e) => [e.title, e.company, e.location])).toEqual([
      ["Data Science Intern", "Bharat Analytics Labs", ""],
      ["Software Engineer Intern", "Northwind", "Remote"],
    ]);
    expect(p.experience[0].description).toBe("Built forecasting models for retail demand across 40 stores, cutting stockouts by 18% in the pilot region.");
  });
  it("finds one project per header with its tech list and link", () => {
    expect(p.projects.map((x) => [x.name, x.tech])).toEqual([
      ["Ledgerly - Expense Tracker", "Next.js, FastAPI, PostgreSQL"],
      ["Payments Platform", "Django, React"],
    ]);
    expect(p.projects[0].link).toBe("https://github.com/asharao/Ledgerly");
  });
  it("reads a Research Publications section", () => {
    expect(p.publications).toEqual([{ title: "Learning to Rank Retail Demand Signals", venue: "IEEE ICXYZ 2026, Tokyo", year: "2026", link: "https://ieeexplore.ieee.org/document/1" }]);
  });
  it("keeps years out of the school name and reads the major", () => {
    expect(p.education[0]).toMatchObject({ school: "Indian Institute of Information Technology, Pune", degree: "B.Tech", major: "Computer Science and Engineering", startYear: "2022", endYear: "2026", cgpa: "8.4" });
  });
});
