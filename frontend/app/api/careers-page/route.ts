import { fetchBoard, inspectCareersPage, type JobSource } from "@internova/core";
import { json, requireUser } from "@/lib/ai";
import { fetchPublicHtml } from "@/lib/fetchPage";
import { clampText } from "@/lib/userData";

/**
 * POST { url } → { company, boards, jobs }
 * Reads a company's own careers page: which job board (Greenhouse, Lever, Ashby, Workday, Oracle…) it links to or
 * embeds, and any jobs it publishes as structured data (schema.org JobPosting, which Google for Jobs also reads).
 * Failing that, whether the site's sitemap lists job pages with that data (then the whole site is watched). No AI.
 * Pages that draw their jobs with JavaScript only can't be read here; the extension reads those in your browser.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Sign in first" }, 401);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let url = clampText(body.url, 2000);
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const { html, finalUrl } = await fetchPublicHtml(url);
    const r = inspectCareersPage(html, finalUrl);
    // No job system and at most one job on the page (a single job post, or a site that draws its list with
    // JavaScript): the site may still list every job page in its sitemap
    if (!r.boards.length && r.jobs.length <= 1) {
      const host = new URL(finalUrl).hostname.toLowerCase();
      const site: JobSource = { ats: "sitemap", slug: host, company: r.company || host };
      const found = await fetchBoard(site, { maxPages: 3, timeoutMs: 12_000 }).catch(() => []);
      if (found.length) return json({ company: site.company, url: finalUrl, boards: [site], jobs: found.length });
    }
    return json({ company: r.company, url: finalUrl, boards: r.boards, jobs: r.jobs.length });
  } catch (e) {
    return json({ error: `Couldn't read that page: ${(e as Error).message}` }, 400);
  }
}
