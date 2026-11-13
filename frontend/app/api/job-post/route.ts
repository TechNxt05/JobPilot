import {
  contactsForCompany,
  DEFAULT_SOURCES,
  emailSignature,
  extractPostDetails,
  findOfficialJobs,
  postAtsReport,
  researchCompany,
  scanPost,
  writePostReplies,
  ATS_LABELS,
  type Contact,
} from "@internova/core";
import { aiGate, json } from "@/lib/ai";
import { normalizeSettings } from "@/lib/discoverTypes";
import { clampText, loadUserData } from "@/lib/userData";

export const maxDuration = 120;

/**
 * POST { text, postUrl? } → everything needed to answer a hiring post (e.g. a LinkedIn post):
 * details (company, role, how to apply), the official posting if the company has a public job board,
 * company research, your saved contacts there, an ATS / reader check of your resume, and drafts of an
 * email, a LinkedIn DM and a connection note. Uses one AI action (two model calls). Nothing is sent.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = clampText(body.text, 12000);
  if (text.length < 60) return json({ error: "Paste the full post (at least a few lines)." }, 400);
  const postUrl = clampText(body.postUrl, 2000);

  const gate = await aiGate(req);
  if (!gate.ok) return gate.res;
  const { ai, headers, supabase } = gate;
  const { profile, resumes } = await loadUserData(supabase);
  if (!profile.firstName && !resumes.length) return json({ error: "Upload a resume or fill in your Profile first. The replies are written from it." }, 400);

  try {
    const scan = scanPost(text);
    const details = await extractPostDetails(ai, text);

    const [{ data: settingsRow }, { data: contactRows }] = await Promise.all([
      supabase.from("discovery_settings").select("data").maybeSingle(),
      supabase.from("contacts").select("id, company, email, name, title, department, status").limit(5000),
    ]);
    const known = [...DEFAULT_SOURCES, ...normalizeSettings(settingsRow?.data ?? {}).sources];
    const [official, research] = await Promise.all([
      details.company ? findOfficialJobs(details.company, details.role, { knownSources: known, signal: AbortSignal.timeout(20000) }).catch(() => []) : Promise.resolve([]),
      details.company ? researchCompany(details.company, details.role, { serperKey: process.env.SERPER_API_KEY, signal: AbortSignal.timeout(15000), limit: 5 }).catch(() => []) : Promise.resolve([]),
    ]);
    const best = official[0] ?? null;

    const replies = await writePostReplies(ai, {
      profile,
      resumeText: resumes[0]?.text,
      postText: text,
      details,
      research,
      officialJob: best ? { title: best.job.title, url: best.job.url, text: best.job.text } : null,
    });

    const contacts = details.company
      ? contactsForCompany(details.company, (contactRows ?? []) as Contact[]).slice(0, 10).map((c) => ({ id: c.id, email: c.email, name: c.name, title: c.title }))
      : [];
    const ats = postAtsReport(resumes[0]?.text ?? "", details, best, text);

    return json({
      details,
      scan: { emails: scan.emails, urls: scan.urls, hashtags: scan.hashtags },
      postUrl,
      official: official.map((o) => ({
        title: o.job.title, url: o.job.url, applyUrl: o.job.applyUrl, location: o.job.location, ats: ATS_LABELS[o.job.ats],
        postedAt: o.job.postedAt, similarity: Math.round(o.similarity * 100), text: o.job.text.slice(0, 6000),
      })),
      research,
      contacts,
      ats,
      replies,
      signature: emailSignature(profile),
      // Short LinkedIn sign-off: name + one link
      dmSignoff: [[profile.firstName, profile.lastName].filter(Boolean).join(" "), profile.portfolio || profile.github].filter(Boolean).join("\n"),
    }, 200, headers);
  } catch (e) {
    return json({ error: (e as Error).message }, 502, headers);
  }
}
