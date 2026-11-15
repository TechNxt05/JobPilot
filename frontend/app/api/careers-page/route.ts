import { inspectCareersPage } from "@internova/core";
import { json, requireUser } from "@/lib/ai";
import { fetchPublicHtml } from "@/lib/fetchPage";
import { clampText } from "@/lib/userData";

/**
 * POST { url } → { company, boards, jobs }
 * Reads a company's own careers page: which job board (Greenhouse, Lever, Ashby…) it links to or embeds, and any
 * jobs it publishes as structured data (schema.org JobPosting, which Google for Jobs also reads). No AI is used.
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
    return json({ company: r.company, url: finalUrl, boards: r.boards, jobs: r.jobs.length });
  } catch (e) {
    return json({ error: `Couldn't read that page: ${(e as Error).message}` }, 400);
  }
}
