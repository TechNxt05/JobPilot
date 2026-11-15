import { describe, expect, it } from "vitest";
import { emailsIn, filterHnComments, hiringPostQueries, inspectCareersPage, isPublicHttpUrl, parseRelativeDate, searchHiringPosts } from "../src";

describe("hiring posts", () => {
  it("finds emails and DM asks in search snippets", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ organic: [
      { title: "We're hiring an AI Engineer | LinkedIn", link: "https://www.linkedin.com/posts/a_hiring-1", snippet: "Send your resume to jobs@acme.ai. Or DM me.", date: "2 days ago" },
      { title: "dup", link: "https://www.linkedin.com/posts/a_hiring-1", snippet: "" },
    ] }), { status: 200 })) as unknown as typeof fetch;
    const posts = await searchHiringPosts("AI Engineer", "India", { serperKey: "k", fetchImpl });
    expect(posts[0]).toMatchObject({ source: "linkedin", title: "We're hiring an AI Engineer", emails: ["jobs@acme.ai"], wantsDm: true });
    expect(posts.filter((p) => p.url.endsWith("hiring-1")).length).toBe(1);
    expect(hiringPostQueries("AI Engineer", "")[0].q).toContain('site:linkedin.com/posts');
    expect(parseRelativeDate("3 days ago", Date.UTC(2026, 10, 16))).toBe("2026-11-13T00:00:00.000Z");
    expect(emailsIn("mail a@b.co, or x@y.com.")).toEqual(["a@b.co", "x@y.com"]);
  });

  it("filters HN comments by keyword and location, decoding [at]/[dot]", () => {
    const out = filterHnComments([
      { id: 1, text: "Acme | ML Engineer | REMOTE | email jobs [at] acme [dot] com" },
      { id: 2, text: "Beta | Sales | Onsite NYC" },
      { id: 3, text: "Gamma | ML Engineer | Onsite Berlin" },
    ], ["ml engineer"], ["india"]);
    expect(out.map((p) => p.id)).toEqual(["hn:1"]);
    expect(out[0].emails).toEqual(["jobs@acme.com"]);
  });
});

describe("careers pages", () => {
  it("finds linked ATS boards and JSON-LD jobs", () => {
    const html = `<meta property="og:site_name" content="Acme"><a href="https://jobs.lever.co/acme">Jobs</a>
      <script type="application/ld+json">{"@type":"JobPosting","title":"Backend Engineer","datePosted":"2026-11-01","description":"<p>Python</p>","hiringOrganization":{"name":"Acme Inc"},"jobLocation":{"address":{"addressLocality":"Pune","addressCountry":"IN"}},"url":"https://acme.com/careers/1"}</script>`;
    const r = inspectCareersPage(html, "https://acme.com/careers");
    expect(r.boards).toEqual([expect.objectContaining({ ats: "lever", slug: "acme" })]);
    expect(r.jobs[0]).toMatchObject({ title: "Backend Engineer", company: "Acme Inc", location: "Pune, IN", sourceLabel: "Careers page", text: "Python" });
  });

  it("refuses private and odd addresses", () => {
    expect(isPublicHttpUrl("https://acme.com/careers")).toBe(true);
    for (const bad of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.5/x", "http://10.0.0.1", "http://169.254.169.254/latest", "file:///etc/passwd", "http://[::1]/", "https://user:pw@acme.com", "http://intranet"]) expect(isPublicHttpUrl(bad)).toBe(false);
  });
});
