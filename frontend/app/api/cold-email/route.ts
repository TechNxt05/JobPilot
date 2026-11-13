import { emailSignature, generateColdEmail } from "@internova/core";
import { aiGate, json } from "@/lib/ai";
import { clampText, loadUserData } from "@/lib/userData";

/**
 * POST { contactId, job?: { title, url, text }, target?, words? } → { subject, body, signature, warnings, to }
 * Drafts a cold email to one of the user's saved contacts. Nothing is sent: the page hands the draft to the
 * user's own mail app. Uses one AI action from the daily quota.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contactId = clampText(body.contactId, 64);
  if (!contactId) return json({ error: "Pick a contact first." }, 400);
  const j = (body.job ?? null) as Record<string, unknown> | null;
  const job = j && clampText(j.text, 12000).length >= 80
    ? { title: clampText(j.title, 200) || null, url: clampText(j.url, 2000) || null, text: clampText(j.text, 12000) }
    : null;

  const gate = await aiGate(req);
  if (!gate.ok) return gate.res;
  const { ai, headers, supabase } = gate;

  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, name, company, title, department, email, status, outreach")
    .eq("id", contactId)
    .maybeSingle();
  if (error || !contact) return json({ error: "Contact not found." }, 404);
  if (contact.status === "do_not_contact" || contact.status === "bounced") return json({ error: `This contact is marked “${contact.status.replace(/_/g, " ")}”.` }, 400);

  const { profile, resumes } = await loadUserData(supabase);
  if (!profile.firstName && !resumes.length) return json({ error: "Upload a resume or fill in your Profile first. The email is written from it." }, 400);

  try {
    const email = await generateColdEmail(ai, {
      profile,
      resumeText: resumes[0]?.text,
      contact,
      job,
      target: clampText(body.target, 200) || undefined,
      words: Math.min(250, Math.max(80, Number(body.words) || 150)),
    });
    if (contact.outreach === "none") {
      await supabase.from("contacts").update({ outreach: "drafted", updated_at: new Date().toISOString() }).eq("id", contact.id);
    }
    return json({ ...email, signature: emailSignature(profile), to: contact.email }, 200, headers);
  } catch (e) {
    return json({ error: (e as Error).message }, 502, headers);
  }
}
