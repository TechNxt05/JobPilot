import { parseResumeWithAI } from "@internova/core";
import { json, NO_AI, requireUser, serverAI } from "@/lib/ai";

/** POST { text } → partial profile extracted by AI (entries not found in the resume text are dropped). */
export async function POST(req: Request) {
  if (!(await requireUser())) return json({ error: "Sign in first" }, 401);
  const ai = serverAI();
  if (!ai) return NO_AI();
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text || text.length < 100) return json({ error: "Resume text is missing or too short" }, 400);
  try {
    return json(await parseResumeWithAI(ai, text.slice(0, 20000)));
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
