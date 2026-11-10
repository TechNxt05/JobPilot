import { generateCoverLetter, researchCompany, type CoverLetterTone } from "@internova/core";
import { aiGate, json } from "@/lib/ai";
import { clampText, loadUserData } from "@/lib/userData";

/**
 * POST { company, role, jobDescription, research?: boolean, tone?, words?, hiringManager? }
 * → CoverLetter (subject, greeting, paragraphs, closing, warnings, sources)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const company = clampText(body.company, 120);
  const role = clampText(body.role, 160);
  const jobDescription = clampText(body.jobDescription, 15000);
  if (!jobDescription || jobDescription.length < 80) return json({ error: "Paste the job description (at least a few sentences)." }, 400);
  const tone = (["professional", "enthusiastic", "concise"].includes(body.tone as string) ? body.tone : "professional") as CoverLetterTone;
  const words = Math.min(450, Math.max(120, Number(body.words) || 250));

  const gate = await aiGate(req);
  if (!gate.ok) return gate.res;
  const { ai, headers } = gate;
  const { profile, resumes } = await loadUserData(gate.supabase);
  if (!profile.firstName && !resumes.length) return json({ error: "Upload a resume or fill in your Profile first. The letter is written from it." }, 400);

  const research = body.research && company
    ? await researchCompany(company, role, { serperKey: process.env.SERPER_API_KEY, signal: AbortSignal.timeout(15000) }).catch(() => [])
    : [];

  try {
    const letter = await generateCoverLetter(ai, {
      profile,
      resumeText: resumes[0]?.text,
      job: { title: role || null, company: company || null, text: jobDescription },
      research,
      tone,
      words,
      hiringManager: clampText(body.hiringManager, 80) || undefined,
    });
    return json({ ...letter, name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") }, 200, headers);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
