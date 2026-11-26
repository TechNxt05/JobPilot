import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FILTERS, DEFAULT_SOURCES, fetchBoard, isValidSource, jobsFromJsonLd, looksLikeJobUrl, parseAmazonJobs, parseBreezyJobs,
  parseEightfoldJobs, parseGoogleJobs, parseKekaJobs, parseOracleJobs, parseZohoJobs, parseWorkdayJobs, sourceFromUrl, sourceKey, workdayPostedAt, type JobSource,
} from "../src";

const now = Date.parse("2026-11-22T00:00:00Z");

describe("links from every supported job system", () => {
  it("recognises the boards behind job links", () => {
    const cases: [string, Partial<JobSource>][] = [
      ["https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/India-Bengaluru/X_JR1", { ats: "workday", slug: "nvidia.wd5/NVIDIAExternalCareerSite" }],
      ["https://citi.wd5.myworkdayjobs.com/wday/cxs/citi/2/jobs", { ats: "workday", slug: "citi.wd5/2" }],
      ["https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_45001/job/1", { ats: "oracle", slug: "eeho.fa.us2.oraclecloud.com/CX_45001" }],
      ["https://paypal.eightfold.ai/careers/job/274923287904", { ats: "eightfold", slug: "paypal/paypal.com" }],
      ["https://jobs.careers.microsoft.com/global/en/job/1", { ats: "eightfold", slug: "apply.careers.microsoft.com/microsoft.com", company: "Microsoft" }],
      ["https://accrete-ai.breezy.hr/p/c7a172809a35-full-stack-engineer", { ats: "breezy", slug: "accrete-ai" }],
      ["https://www.google.com/about/careers/applications/jobs/results/1-x", { ats: "google", slug: "google" }],
      ["https://www.amazon.jobs/en/jobs/10610151/x", { ats: "amazon", slug: "amazon" }],
      ["https://www.talentd.in/j/19705/w11", { ats: "sitemap", slug: "www.talentd.in", company: "Talentd" }],
      ["https://search.jobs.barclays/job/-/-/13015/103374232544?src=JB-12860", { ats: "sitemap", slug: "search.jobs.barclays" }],
      ["https://jobs.ashbyhq.com/hopper/927864e8/application?utm_source=LinkedIn", { ats: "ashby", slug: "hopper" }],
    ];
    for (const [url, want] of cases) expect(sourceFromUrl(url), url).toMatchObject(want);
    expect(sourceFromUrl("https://nvidia.wd5.myworkdayjobs.com/")).toBeNull();
  });

  it("validates two-part slugs and keeps defaults unique", () => {
    expect(isValidSource({ ats: "workday", slug: "nvidia.wd5/NVIDIAExternalCareerSite", company: "NVIDIA" })).toBe(true);
    expect(isValidSource({ ats: "sitemap", slug: "../etc/passwd", company: "x" })).toBe(false);
    expect(isValidSource({ ats: "workday", slug: "a/b/c", company: "x" })).toBe(false);
    const keys = DEFAULT_SOURCES.map(sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_SOURCES.every(isValidSource)).toBe(true);
  });
});

describe("parsers", () => {
  it("Workday", () => {
    expect(workdayPostedAt("Posted Today", now)!.slice(0, 10)).toBe("2026-11-22");
    expect(workdayPostedAt("Posted 30+ Days Ago", now)!.slice(0, 10)).toBe("2026-10-23");
    const [j] = parseWorkdayJobs({ ats: "workday", slug: "nvidia.wd5/NVIDIAExternalCareerSite", company: "NVIDIA" },
      { total: 1, jobPostings: [{ title: "Software Intern", externalPath: "/job/India-Bengaluru/Software-Intern_JR123", locationsText: "India, Bengaluru", postedOn: "Posted Yesterday" }] }, now);
    expect(j).toMatchObject({ title: "Software Intern", location: "India, Bengaluru", url: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/India-Bengaluru/Software-Intern_JR123" });
    expect(j.postedAt!.slice(0, 10)).toBe("2026-11-21");
  });

  it("Oracle Recruiting", () => {
    const [j] = parseOracleJobs({ ats: "oracle", slug: "h.oraclecloud.com/CX_1", company: "Hexaware" },
      { items: [{ TotalJobsCount: 1, requisitionList: [{ Id: "708740", Title: "Test Analyst", PostedDate: "2026-11-21", PrimaryLocation: "Chennai, India", ShortDescriptionStr: "<p>Test <b>AI</b> apps</p>", secondaryLocations: [{ Name: "Pune, India" }] }] }] });
    expect(j).toMatchObject({ title: "Test Analyst", location: "Chennai, India / Pune, India", url: "https://h.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/708740", text: "Test AI apps" });
  });

  it("Eightfold (own domain too), Breezy, Amazon", () => {
    const [ms] = parseEightfoldJobs({ ats: "eightfold", slug: "apply.careers.microsoft.com/microsoft.com", company: "Microsoft" },
      [{ id: 1, name: "Applied Sciences INTERN", locations: ["India, Multiple Locations"], postedTs: 1794787200, workLocationOption: "onsite" }]);
    expect(ms).toMatchObject({ url: "https://apply.careers.microsoft.com/careers/job/1", remote: false });
    expect(ms.postedAt!.slice(0, 4)).toBe("2026");
    const [bz] = parseBreezyJobs({ ats: "breezy", slug: "accrete-ai", company: "Accrete" },
      [{ id: "c7a", name: "Full Stack Engineer", url: "https://accrete-ai.breezy.hr/p/c7a", published_date: "2026-11-02T14:55:54Z", location: { city: "Mumbai", country: { name: "India" }, is_remote: false } }]);
    expect(bz).toMatchObject({ title: "Full Stack Engineer", location: "Mumbai, India" });
    const [am] = parseAmazonJobs({ ats: "amazon", slug: "amazon", company: "Amazon" },
      { jobs: [{ id_icims: "10610151", title: "SDE", job_path: "/en/jobs/10610151/sde", normalized_location: "Hyderabad, Telangana, IND", posted_date: "November 20, 2026", description: "Build things<br/>at scale", basic_qualifications: "- 1+ years" }] });
    expect(am).toMatchObject({ url: "https://www.amazon.jobs/en/jobs/10610151/sde", location: "Hyderabad, Telangana, IND" });
    expect(am.text).toContain("Basic qualifications");
  });

  it("Google Careers cards", () => {
    const card = (id: string, title: string, loc: string) =>
      `<li><h3>${title}</h3><p>Google | <span class="pwO9Dc"><span class="r0wTof ">${loc}</span></span><span class="r0wTof ">; ${loc}</span></p>` +
      `<div><h4>Minimum qualifications</h4><ul><li>Bachelor degree</li><li>Python</li></ul></div>` +
      `<a class="WpHeLc" href="jobs/results/${id}-slug?location=India" aria-label="Learn more about ${title}" jsname="x"></a></li>`;
    const jobs = parseGoogleJobs({ ats: "google", slug: "google", company: "Google" }, card("1", "Software Engineer, Early", "Bengaluru, Karnataka, India") + card("2", "Data Engineer", "Hyderabad, Telangana, India"));
    expect(jobs.map((j) => [j.title, j.location])).toEqual([["Software Engineer, Early", "Bengaluru, Karnataka, India"], ["Data Engineer", "Hyderabad, Telangana, India"]]);
    expect(jobs[0].text).toContain("Python");
  });

  it("JobPosting pages, aggregator titles cleaned", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"JobPosting","title":"IBM Bangalore Hiring Data Engineer, Google Data Platforms","hiringOrganization":{"name":"IBM"},"jobLocation":{"address":{"addressLocality":"Bengaluru","addressCountry":"IN"}},"datePosted":"2026-11-20","description":"<p>Build pipelines</p>"}]}</script>`;
    const [j] = jobsFromJsonLd(html, "https://www.talentd.in/jobs/ibm-x", { ats: "sitemap", slug: "www.talentd.in", company: "Talentd" });
    expect(j).toMatchObject({ company: "IBM", title: "Data Engineer, Google Data Platforms", location: "Bengaluru, IN", sourceLabel: "Talentd", text: "Build pipelines" });
  });

  it("tells job pages from listing pages", () => {
    expect(looksLikeJobUrl("https://www.talentd.in/jobs/ibm-is-hiring-quality-engineer-automation-hyderabad")).toBe(true);
    expect(looksLikeJobUrl("https://search.jobs.barclays/job/pune/data-engineer/13015/103552278624")).toBe(true);
    expect(looksLikeJobUrl("https://www.talentd.in/jobs/jobs-in-ahmedabad")).toBe(false);
    expect(looksLikeJobUrl("https://www.talentd.in/jobs/it-software-jobs")).toBe(false);
    expect(looksLikeJobUrl("https://www.talentd.in/articles/how-to-crack-the-tcs-nqt-exam")).toBe(false);
  });
});

describe("careers sites through their sitemap", () => {
  it("reads matching job pages and never follows a redirect to an internal address", async () => {
    const page = (title: string) => `<script type="application/ld+json">{"@type":"JobPosting","title":"${title}","hiringOrganization":{"name":"Acme"},"jobLocation":{"address":{"addressLocality":"Pune"}}}</script>`;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("Sitemap: https://jobs.acme.com/sitemap.xml");
      if (url.endsWith("/sitemap.xml")) return new Response(`<urlset>
        <url><loc>https://jobs.acme.com/job/pune/software-engineer/1/12345</loc><lastmod>2026-11-20</lastmod></url>
        <url><loc>https://jobs.acme.com/job/pune/head-of-sales-emea/1/12346</loc></url>
        <url><loc>https://jobs.acme.com/job/pune/data-engineer-intern/1/12347</loc><lastmod>2026-11-21</lastmod></url>
        <url><loc>https://evil.example.net/job/x/backend-engineer/1/1</loc></url>
        <url><loc>https://jobs.acme.com/category/engineering-jobs</loc></url></urlset>`);
      if (url.includes("12345")) return new Response(page("Software Engineer"));
      if (url.includes("12347")) return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
      return new Response("nope", { status: 404 });
    });
    const jobs = await fetchBoard({ ats: "sitemap", slug: "jobs.acme.com", company: "Acme" }, { filters: DEFAULT_FILTERS, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(jobs.map((j) => j.title)).toEqual(["Software Engineer"]);
    const asked = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(asked.some((u) => u.includes("169.254") || u.includes("evil.example") || u.includes("head-of-sales"))).toBe(false);
  });
});

describe("Zoho Recruit and Keka Hire", () => {
  it("recognises their links", () => {
    expect(sourceFromUrl("https://agivant.zohorecruit.in/jobs/Careers/86180000017993709/AI-Harness-Engineer?source=LinkedIn-Basic"))
      .toMatchObject({ ats: "zoho", slug: "agivant.zohorecruit.in/Careers" });
    expect(sourceFromUrl("https://anblicks.keka.com/careers/jobdetails/164334?src=linkedin")).toMatchObject({ ats: "keka", slug: "anblicks" });
  });

  it("reads the jobs a Zoho careers page embeds", () => {
    const jobs = JSON.stringify([
      { id: "153870000004521006", Posting_Title: "Distributed Systems Engineer", City: "Bangalore North", State: "Karnataka", Country: "India", Remote_Job: false, Publish: true, Date_Opened: "2026-11-19", Job_Description: "<p>Rust &amp; SQL</p>" },
      { id: "2", Posting_Title: "Hidden", Publish: false },
    ]).replace(/&/g, "&amp;").replace(/"/g, "&#34;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<input type="hidden" value="[]" id="moduleMeta"><input type="hidden" value="${jobs}" id="jobs">`;
    const out = parseZohoJobs({ ats: "zoho", slug: "e6data.zohorecruit.in/Careers", company: "e6data" }, html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: "Distributed Systems Engineer", location: "Bangalore North, Karnataka, India", remote: false, text: "Rust & SQL",
      url: "https://e6data.zohorecruit.in/jobs/Careers/153870000004521006/Distributed-Systems-Engineer",
    });
    expect(out[0].postedAt!.slice(0, 10)).toBe("2026-11-19");
  });

  it("reads Keka's job list", () => {
    const [j] = parseKekaJobs({ ats: "keka", slug: "anblicks", company: "Anblicks" }, [
      { id: 171522, title: "Sr. Full Stack Developer", description: "<div>React and FastAPI</div>", departmentName: "Intelligent Apps", jobLocations: [{ city: "Ahmedabad", countryName: "India" }, { city: "Hyderabad", countryName: "India" }], publishedOn: "2026-11-24T13:44:46.153Z" },
    ]);
    expect(j).toMatchObject({ title: "Sr. Full Stack Developer", location: "Ahmedabad, India / Hyderabad, India", url: "https://anblicks.keka.com/careers/jobdetails/171522", department: "Intelligent Apps", text: "React and FastAPI" });
  });
});
