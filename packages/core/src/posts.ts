/**
 * Hiring posts and careers pages: sources that aren't ATS job boards.
 *  - searchHiringPosts: public LinkedIn / X posts found through Google (Serper). We never log in or crawl those
 *    sites; we read what the search engine already indexed (title, snippet, link).
 *  - hnWhoIsHiring: the monthly Hacker News "Ask HN: Who is hiring?" thread, via the official Algolia API.
 *  - inspectCareersPage: any careers URL → the ATS boards it links to, plus jobs it publishes as schema.org JSON-LD.
 */
import { htmlToText, jobsFromJsonLd, sourceFromUrl, type DiscoveredJob, type JobSource } from "./discover";

export interface HiringPost {
  id: string;
  source: "linkedin" | "x" | "hn" | "web";
  title: string;
  url: string;
  /** Text we can see: search snippet, or the full HN comment */
  text: string;
  /** Emails that literally appear in the text */
  emails: string[];
  /** The post asks for a DM / message */
  wantsDm: boolean;
  postedAt: string | null;
}

const EMAIL_G = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const DM = /\b(dm|d\.m\.|direct message|message me|inbox me|ping me|drop (me )?a (message|dm))\b/i;
export const emailsIn = (text: string) => [...new Set([...text.matchAll(EMAIL_G)].map((m) => m[0].replace(/[.,;:]+$/, "").toLowerCase()))];

/* ------------------------------ public posts via search ------------------------------ */

export interface PostSearchOptions {
  serperKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Google recency filter: d (day), w (week), m (month) */
  recency?: "d" | "w" | "m";
}

/** The Google queries used for one role (kept small: Serper's free tier is 2,500 searches). */
export function hiringPostQueries(role: string, location: string): { source: HiringPost["source"]; q: string }[] {
  const r = `"${role.trim()}"`;
  const loc = location.trim() ? ` ${location.trim()}` : "";
  return [
    { source: "linkedin", q: `site:linkedin.com/posts (hiring OR "we are hiring" OR "now hiring") ${r}${loc} (email OR "send your resume" OR "dm me" OR "share your cv")` },
    { source: "x", q: `(site:x.com OR site:twitter.com) hiring ${r}${loc} (email OR dm)` },
  ];
}

export async function searchHiringPosts(role: string, location: string, opts: PostSearchOptions): Promise<HiringPost[]> {
  const f = opts.fetchImpl ?? fetch;
  const out: HiringPost[] = [];
  const seen = new Set<string>();
  for (const { source, q } of hiringPostQueries(role, location)) {
    const res = await f("https://google.serper.dev/search", {
      method: "POST",
      signal: opts.signal,
      headers: { "X-API-KEY": opts.serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q, num: 20, ...(opts.recency ? { tbs: `qdr:${opts.recency}` } : {}) }),
    });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const body = (await res.json()) as { organic?: { title?: string; link?: string; snippet?: string; date?: string }[] };
    for (const o of body.organic ?? []) {
      const url = o.link ?? "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const text = `${o.title ?? ""}\n${o.snippet ?? ""}`;
      out.push({
        id: `${source}:${url}`, source, title: (o.title ?? "").replace(/\s*\|\s*LinkedIn$/i, "").trim(), url, text,
        emails: emailsIn(text), wantsDm: DM.test(text), postedAt: o.date ? parseRelativeDate(o.date) : null,
      });
    }
  }
  return out;
}

/** Serper dates look like "3 days ago" or "Nov 2, 2026". */
export function parseRelativeDate(s: string, now = Date.now()): string | null {
  const m = s.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
  if (m) {
    const unit = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3 }[m[2].toLowerCase() as "day"];
    return new Date(now - Number(m[1]) * unit).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ------------------------------ Hacker News: Who is hiring? ------------------------------ */

export interface HnOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Comments from the latest "Ask HN: Who is hiring?" thread that mention any keyword (and a location or REMOTE). */
export async function hnWhoIsHiring(keywords: string[], locations: string[], opts: HnOptions = {}): Promise<HiringPost[]> {
  const f = opts.fetchImpl ?? fetch;
  const get = async (url: string) => {
    const r = await f(url, { signal: opts.signal });
    if (!r.ok) throw new Error(`Hacker News API error (${r.status})`);
    return r.json();
  };
  const search = (await get("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring&hitsPerPage=5")) as { hits: { objectID: string; title: string }[] };
  const story = search.hits.find((h) => /who is hiring/i.test(h.title));
  if (!story) return [];
  const thread = (await get(`https://hn.algolia.com/api/v1/items/${story.objectID}`)) as { children?: { id: number; text?: string | null; created_at?: string }[] };
  return filterHnComments(thread.children ?? [], keywords, locations);
}

export function filterHnComments(children: { id: number; text?: string | null; created_at?: string }[], keywords: string[], locations: string[]): HiringPost[] {
  const kw = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const loc = locations.map((l) => l.trim().toLowerCase()).filter(Boolean);
  const word = (hay: string, t: string) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(hay);
  const out: HiringPost[] = [];
  for (const c of children) {
    if (!c.text) continue;
    const text = htmlToText(c.text);
    const low = text.toLowerCase();
    if (kw.length && !kw.some((k) => word(low, k))) continue;
    if (loc.length && !loc.some((l) => word(low, l)) && !/\bremote\b/.test(low)) continue;
    const first = text.split("\n")[0].slice(0, 160);
    out.push({
      id: `hn:${c.id}`, source: "hn", title: first, url: `https://news.ycombinator.com/item?id=${c.id}`, text: text.slice(0, 4000),
      emails: emailsIn(text.replace(/\s*\[at\]\s*|\s+at\s+(?=[a-z0-9-]+\s*(\.|\[dot\]|\bdot\b))/gi, "@").replace(/\s*\[dot\]\s*|\s+dot\s+/gi, ".")),
      wantsDm: false, postedAt: c.created_at ?? null,
    });
  }
  return out;
}

/* ------------------------------ any careers page ------------------------------ */

/** Only public http(s) addresses may be fetched by the server (no localhost, private or link-local IPs). */
export function isPublicHttpUrl(input: string): boolean {
  let u: URL;
  try { u = new URL(input); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h.startsWith("[") || h.includes(":")) return false; // IPv6 literals
  if (!h.includes(".") || h === "localhost" || /\.(localhost|local|internal)$/.test(h)) return false;
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  return true;
}

export interface CareersPageResult {
  /** ATS boards the page links to or embeds (added to Discover as boards) */
  boards: JobSource[];
  /** Jobs the page publishes as schema.org JobPosting JSON-LD */
  jobs: DiscoveredJob[];
  company: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Read a careers page: which ATS it uses (links / embeds) and any JobPosting structured data. */
export function inspectCareersPage(html: string, pageUrl: string): CareersPageResult {
  const boards = new Map<string, JobSource>();
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>()]+/g)) {
    const s = sourceFromUrl(m[0].replace(/&amp;/g, "&"));
    if (s) boards.set(`${s.ats}:${s.slug.toLowerCase()}`, s);
  }
  const gh = html.match(/boards\.greenhouse\.io\/embed\/job_board\/js\?for=([A-Za-z0-9_-]+)/);
  if (gh) boards.set(`greenhouse:${gh[1].toLowerCase()}`, { ats: "greenhouse", slug: gh[1], company: gh[1] });

  // Oracle Recruiting Cloud behind the company's own domain (jobs.hexaware.com/#en/sites/CX_1): the page script
  // names the Oracle host, and the address (or page) names the site
  const oracleHost = html.match(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.oraclecloud\.com)/i)?.[1];
  const oracleSite = `${pageUrl} ${html}`.match(/sites\/([A-Za-z0-9_]+)/)?.[1] ?? html.match(/siteNumber["':=\s]+["']?([A-Za-z0-9_]+)/)?.[1];
  if (oracleHost && oracleSite) {
    const o = sourceFromUrl(`https://${oracleHost}/hcmUI/CandidateExperience/en/sites/${oracleSite}/jobs`);
    if (o) boards.set(`oracle:${o.slug.toLowerCase()}`, o);
  }

  let host = "";
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
  const titleCompany = str(html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1]) || host.split(".")[0];
  for (const b of boards.values()) if (b.ats === "oracle" || b.ats === "workday" || b.ats === "eightfold") b.company = titleCompany || b.company;
  const jobs = jobsFromJsonLd(html, pageUrl).map((j) => ({ ...j, company: j.company === host ? titleCompany : j.company }));
  return { boards: [...boards.values()], jobs, company: titleCompany };
}
