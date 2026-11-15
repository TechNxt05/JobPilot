import { hnWhoIsHiring, searchHiringPosts, type HiringPost } from "@internova/core";
import { json, requireUser } from "@/lib/ai";
import { clampText } from "@/lib/userData";

export const maxDuration = 60;

/**
 * POST { role, location?, recency?: "d"|"w"|"m", sources?: ("social"|"hn")[] } → { posts, notes }
 * Finds public hiring posts. LinkedIn and X posts come from Google's index (via Serper): we never log in to or
 * crawl those sites, so we only see what Google shows (title, snippet, link). Open the post for the full text.
 * Hacker News "Who is hiring?" comments come from HN's official API in full. No AI is used.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Sign in first" }, 401);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const role = clampText(body.role, 80);
  if (role.length < 2) return json({ error: "Type a role, e.g. AI Engineer." }, 400);
  const location = clampText(body.location, 60);
  const recency = (["d", "w", "m"] as const).find((r) => r === body.recency) ?? "w";
  const sources = Array.isArray(body.sources) ? body.sources : ["social", "hn"];

  const notes: string[] = [];
  const jobs: Promise<HiringPost[]>[] = [];
  const serperKey = process.env.SERPER_API_KEY;
  if (sources.includes("social")) {
    if (serperKey) {
      jobs.push(searchHiringPosts(role, location, { serperKey, recency, signal: AbortSignal.timeout(20_000) })
        .catch((e) => { notes.push(`LinkedIn / X search failed: ${(e as Error).message}`); return []; }));
    } else {
      notes.push("LinkedIn / X search is off on this server (SERPER_API_KEY isn't set).");
    }
  }
  if (sources.includes("hn")) {
    jobs.push(hnWhoIsHiring(role.split(/[,/]/), location ? [location] : [], { signal: AbortSignal.timeout(25_000) })
      .catch((e) => { notes.push(`Hacker News failed: ${(e as Error).message}`); return []; }));
  }
  const posts = (await Promise.all(jobs)).flat();
  // Posts with an email first, then ones asking for a DM, then newest
  posts.sort((a, b) => Number(b.emails.length > 0) - Number(a.emails.length > 0) || Number(b.wantsDm) - Number(a.wantsDm) || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  return json({ posts: posts.slice(0, 80), notes });
}
