import type { Contact } from "@internova/core";
import { json, requireUser } from "@/lib/ai";
import { activeSources, normalizeSettings, type DiscoverResponse } from "@/lib/discoverTypes";
import { scanJobs } from "@/lib/scanJobs";
import { loadUserData } from "@/lib/userData";

export const maxDuration = 60;

const MAX_RESULTS = 150;

/**
 * POST { settings? } → DiscoverResponse
 * Fetches every watched company's public job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee,
 * Breezy, Zoho Recruit, Keka, Workday, Oracle Recruiting, Eightfold, Amazon, Google Careers), career sites and job aggregators read through
 * their sitemaps, and careers pages, filters, dedupes, and scores each job against the user's resumes in code (no AI, so no quota
 * is used). `settings` lets the page try unsaved filters; otherwise the saved discovery_settings row is used.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Sign in first" }, 401);
  const body = (await req.json().catch(() => ({}))) as { settings?: unknown };

  const [{ data: saved }, { profile, resumes }, { data: contactRows }] = await Promise.all([
    auth.supabase.from("discovery_settings").select("data").maybeSingle(),
    loadUserData(auth.supabase),
    auth.supabase.from("contacts").select("company, email, status, department, title").limit(20000),
  ]);
  const settings = normalizeSettings(body.settings ?? saved?.data ?? {});
  if (!activeSources(settings).length && !settings.pages.length) return json({ error: "No company boards selected. Add a company or turn some defaults back on." }, 400);

  const out = await scanJobs({ settings, profile, resumes, contacts: (contactRows ?? []) as Contact[] });
  const res: DiscoverResponse = { ...out, jobs: out.jobs.slice(0, MAX_RESULTS) };
  return json(res);
}
