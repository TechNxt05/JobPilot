import { describe, expect, it } from "vitest";
import {
  companyKey,
  contactsForCompany,
  dedupeJobs,
  emailCompanyKey,
  emailSignature,
  EMPTY_PROFILE,
  fitFlags,
  gmailComposeUrl,
  htmlToText,
  isSeniorTitle,
  matchesFilters,
  parseBoard,
  parseContactsCsv,
  parseDelimited,
  sourceFromUrl,
  DEFAULT_FILTERS,
  type Contact,
  type DiscoveredJob,
} from "../src";

const NOW = new Date("2026-11-13T00:00:00Z").getTime();

describe("sourceFromUrl", () => {
  it("recognises each ATS from careers, job and API URLs", () => {
    expect(sourceFromUrl("https://boards.greenhouse.io/anthropic")).toMatchObject({ ats: "greenhouse", slug: "anthropic" });
    expect(sourceFromUrl("https://job-boards.eu.greenhouse.io/groww/jobs/4970739101")).toMatchObject({ ats: "greenhouse", slug: "groww" });
    expect(sourceFromUrl("https://boards.greenhouse.io/embed/job_board?for=stripe")).toMatchObject({ ats: "greenhouse", slug: "stripe" });
    expect(sourceFromUrl("https://boards-api.greenhouse.io/v1/boards/mongodb/jobs")).toMatchObject({ ats: "greenhouse", slug: "mongodb" });
    expect(sourceFromUrl("jobs.lever.co/meesho/7d9af9b5")).toMatchObject({ ats: "lever", slug: "meesho" });
    expect(sourceFromUrl("https://jobs.eu.lever.co/acme")).toMatchObject({ ats: "lever", slug: "acme" });
    expect(sourceFromUrl("https://jobs.ashbyhq.com/sarvam/c0406fe0")).toMatchObject({ ats: "ashby", slug: "sarvam" });
    expect(sourceFromUrl("https://jobs.smartrecruiters.com/BoschGroup/744000161510719")).toMatchObject({ ats: "smartrecruiters", slug: "BoschGroup" });
    expect(sourceFromUrl("https://apply.workable.com/huggingface/")).toMatchObject({ ats: "workable", slug: "huggingface" });
    expect(sourceFromUrl("https://hotjar.recruitee.com/o/engineer")).toMatchObject({ ats: "recruitee", slug: "hotjar" });
    expect(sourceFromUrl("https://www.linkedin.com/jobs/view/1")).toBeNull();
    expect(sourceFromUrl("not a url at all")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("decodes Greenhouse's double-encoded HTML and keeps bullets", () => {
    const t = htmlToText("&lt;p&gt;About &amp;amp; us&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;");
    expect(t).toBe("About & us\n\n• Python\n• SQL");
  });
});

describe("parseBoard", () => {
  it("normalises Greenhouse, Lever, Ashby, SmartRecruiters and Workable", () => {
    const gh = parseBoard({ ats: "greenhouse", slug: "groww", company: "Groww" }, {
      jobs: [{ id: 1, title: "Backend Engineer", absolute_url: "https://job-boards.greenhouse.io/groww/jobs/1", location: { name: "Bengaluru, India" }, first_published: "2026-11-01T00:00:00-04:00", content: "&lt;p&gt;Go&lt;/p&gt;", departments: [{ name: "Eng" }] }],
    });
    expect(gh[0]).toMatchObject({ id: "greenhouse:groww:1", title: "Backend Engineer", location: "Bengaluru, India", department: "Eng", text: "Go", remote: null });

    const lever = parseBoard({ ats: "lever", slug: "meesho", company: "Meesho" }, [
      { id: "a", text: "SDE Intern", hostedUrl: "https://jobs.lever.co/meesho/a", applyUrl: "https://jobs.lever.co/meesho/a/apply", workplaceType: "remote", createdAt: 1762992000000, categories: { location: "Bangalore", team: "Tech" }, descriptionPlain: "Build", lists: [{ text: "Need", content: "<li>Java</li>" }] },
    ]);
    expect(lever[0]).toMatchObject({ remote: true, applyUrl: "https://jobs.lever.co/meesho/a/apply", department: "Tech" });
    expect(lever[0].text).toContain("• Java");

    const ashby = parseBoard({ ats: "ashby", slug: "x", company: "X" }, {
      jobs: [
        { id: "1", title: "ML Engineer", jobUrl: "https://jobs.ashbyhq.com/x/1", isRemote: true, location: "Remote", publishedAt: "2026-11-10T00:00:00Z", descriptionPlain: "LLMs" },
        { id: "2", title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/x/2", isListed: false },
      ],
    });
    expect(ashby).toHaveLength(1);
    expect(ashby[0].remote).toBe(true);

    const sr = parseBoard({ ats: "smartrecruiters", slug: "BoschGroup", company: "Bosch" }, {
      content: [{ id: "77", name: "Data Engineer", releasedDate: "2026-11-12T00:00:00Z", location: { fullLocation: "Bengaluru, KA, India", remote: false } }],
    });
    expect(sr[0].url).toBe("https://jobs.smartrecruiters.com/BoschGroup/77");
    expect(sr[0].remote).toBe(false);

    const wk = parseBoard({ ats: "workable", slug: "huggingface", company: "HF" }, {
      jobs: [{ shortcode: "AB", title: "MLE", url: "https://apply.workable.com/j/AB", telecommuting: true, city: "Paris", country: "France", published_on: "2026-05-29", description: "<p>Hi</p>" }],
    });
    expect(wk[0]).toMatchObject({ remote: true, location: "Paris, France", postedAt: "2026-05-29T00:00:00.000Z" });
  });

  it("returns [] for unexpected shapes", () => {
    expect(parseBoard({ ats: "greenhouse", slug: "x", company: "X" }, null)).toEqual([]);
    expect(parseBoard({ ats: "lever", slug: "x", company: "X" }, { error: "nope" })).toEqual([]);
  });
});

const job = (over: Partial<DiscoveredJob>): DiscoveredJob => ({
  id: "a:b:1", ats: "greenhouse", slug: "b", company: "B", title: "Software Engineer", location: "Bengaluru, India", remote: false,
  department: "", url: "https://x.com/1", applyUrl: "https://x.com/1", postedAt: "2026-11-10T00:00:00Z", text: "", ...over,
});

describe("filters", () => {
  it("matches keywords on word boundaries and filters location, seniority and age", () => {
    const f = { ...DEFAULT_FILTERS, keywords: ["ai", "ml"] };
    expect(matchesFilters(job({ title: "AI Engineer" }), f, NOW)).toBe(true);
    expect(matchesFilters(job({ title: "Maintenance Technician" }), f, NOW)).toBe(false); // "ai" inside a word
    expect(matchesFilters(job({ title: "HTML Developer" }), f, NOW)).toBe(false);
    expect(matchesFilters(job({ title: "Senior ML Engineer" }), f, NOW)).toBe(false);
    expect(matchesFilters(job({ title: "ML Engineer", location: "San Francisco", remote: false }), f, NOW)).toBe(false);
    expect(matchesFilters(job({ title: "ML Engineer", location: "Remote", remote: true }), f, NOW)).toBe(true);
    expect(matchesFilters(job({ title: "ML Engineer", location: "Remote - APAC", remote: true }), f, NOW)).toBe(true);
    // Remote, but only for people in another country
    expect(matchesFilters(job({ title: "ML Engineer", location: "Remote, United States", remote: true }), f, NOW)).toBe(false);
    expect(matchesFilters(job({ title: "ML Engineer", location: "Remote-Friendly (Travel Required) | San Francisco, CA", remote: true }), f, NOW)).toBe(false);
    expect(matchesFilters(job({ title: "ML Engineer", location: "Remote, India", remote: true }), f, NOW)).toBe(true);
    expect(matchesFilters(job({ title: "ML Engineer", postedAt: "2026-01-01T00:00:00Z" }), f, NOW)).toBe(false);
    expect(matchesFilters(job({ title: "ML Engineer", postedAt: null }), f, NOW)).toBe(true);
  });

  it("knows early-career titles", () => {
    expect(isSeniorTitle("Senior Software Engineer")).toBe(true);
    expect(isSeniorTitle("Associate Software Engineer")).toBe(false);
    expect(isSeniorTitle("Lead Generation Intern")).toBe(false);
    expect(isSeniorTitle("Associate Director, Engineering")).toBe(true);
    expect(isSeniorTitle("Software Engineer III")).toBe(true);
  });

  it("dedupes by URL and by company + title + location", () => {
    const a = job({ id: "1", url: "https://x.com/jobs/1?utm_source=a" });
    const b = job({ id: "2", url: "https://x.com/jobs/1" });
    const c = job({ id: "3", url: "https://x.com/jobs/9" });
    expect(dedupeJobs([a, b, c])).toHaveLength(1);
  });
});

describe("fitFlags", () => {
  const ctx = { minYearsExperience: null, candidateMonths: 6, eligibilityNotMet: [], candidateCountry: "India", graduated: true };
  it("flags experience gaps, work authorization and student-only roles, but not unknowns", () => {
    expect(fitFlags(job({}), ctx)).toEqual([]);
    expect(fitFlags(job({}), { ...ctx, minYearsExperience: 3 })[0]).toMatchObject({ kind: "experience", severity: "blocker" });
    expect(fitFlags(job({}), { ...ctx, minYearsExperience: 1 })[0]).toMatchObject({ kind: "experience", severity: "caution" });
    expect(fitFlags(job({}), { ...ctx, minYearsExperience: 3, candidateMonths: null })).toEqual([]);
    expect(fitFlags(job({ text: "Candidates must be authorized to work in the US. We do not sponsor visas." }), ctx).map((f) => f.kind)).toContain("work_authorization");
    expect(fitFlags(job({ text: "You must be currently enrolled in a degree program." }), ctx).map((f) => f.kind)).toContain("student_only");
    expect(fitFlags(job({ location: "London, UK" }), ctx).map((f) => f.kind)).toContain("location");
    expect(fitFlags(job({ location: "Pune" }), ctx)).toEqual([]);
  });
});

describe("contacts", () => {
  it("normalises company names and email domains", () => {
    expect(companyKey("Razorpay Software Private Limited")).toBe("razorpay");
    expect(companyKey("Tata Consultancy Services")).toBe("tata");
    expect(companyKey("Zeta Suite")).toBe("zetasuite");
    expect(emailCompanyKey("talent@careers.razorpay.com")).toBe("razorpay");
    expect(emailCompanyKey("hr@acme.co.in")).toBe("acme");
    expect(emailCompanyKey("someone@gmail.com")).toBe("");
  });

  it("parses delimited text with quotes, tabs and semicolons", () => {
    expect(parseDelimited('a,"b, c","d ""q"""\n1,2,3')).toEqual([["a", "b, c", 'd "q"'], ["1", "2", "3"]]);
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("imports a sheet with a header, splitting multi-email cells and skipping bad rows", () => {
    const csv = [
      "Company Name,HR Name,Email ID,Designation,Location",
      "Razorpay,Asha,asha@razorpay.com,Talent Partner,Bengaluru",
      "Groww,,hr@groww.in / campus@groww.in,,",
      "NoEmail Inc,Bob,,,",
      "Razorpay,Dup,ASHA@razorpay.com,,",
    ].join("\n");
    const r = parseContactsCsv(csv, { country: "India", source: "India HR list" });
    expect(r.contacts.map((c) => c.email)).toEqual(["asha@razorpay.com", "hr@groww.in", "campus@groww.in"]);
    expect(r.contacts[0]).toMatchObject({ company: "Razorpay", name: "Asha", title: "Talent Partner", city: "Bengaluru", country: "India", source: "India HR list" });
    expect(r.skipped.map((s) => s.line)).toEqual([4, 5]);
  });

  it("imports headerless lines, taking the company from a column or the email domain", () => {
    const r = parseContactsCsv("Aramco, recruit@aramco.com\nhr@stc.com.sa\njohn@gmail.com");
    expect(r.contacts.map((c) => [c.company, c.email])).toEqual([["Aramco", "recruit@aramco.com"], ["Stc", "hr@stc.com.sa"]]);
    expect(r.skipped[0].reason).toMatch(/personal/);
  });

  it("finds contacts for a job's company, skipping bounced / do-not-contact", () => {
    const base = { name: "", title: "", country: "", city: "", department: "", roleTags: [], source: "", linkedin: "", outreach: "none", lastContactedAt: null, followUpOn: "", notes: "" } as const;
    const list: Contact[] = [
      { ...base, roleTags: [], id: "1", company: "Razorpay Software Pvt Ltd", email: "a@razorpay.com", status: "unverified" },
      { ...base, roleTags: [], id: "2", company: "Other", email: "b@razorpay.com", status: "verified", title: "Recruiter" },
      { ...base, roleTags: [], id: "3", company: "Razorpay", email: "c@razorpay.com", status: "bounced" },
      { ...base, roleTags: [], id: "4", company: "Groww", email: "d@groww.in", status: "verified" },
    ];
    expect(contactsForCompany("Razorpay", list).map((c) => c.id)).toEqual(["2", "1"]);
  });

  it("builds a signature from real profile links and a Gmail compose URL", () => {
    const sig = emailSignature({ ...EMPTY_PROFILE, firstName: "Asha", lastName: "K", github: "https://github.com/asha", email: "a@x.com" });
    expect(sig).toBe("Best regards,\nAsha K\na@x.com\nGitHub: https://github.com/asha");
    const url = new URL(gmailComposeUrl("hr@x.com", "Hi there", "Line 1\nLine 2"));
    expect(url.searchParams.get("to")).toBe("hr@x.com");
    expect(url.searchParams.get("body")).toBe("Line 1\nLine 2");
  });
});
