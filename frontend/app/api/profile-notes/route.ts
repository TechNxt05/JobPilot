import { extractFromNotes } from "@internova/core";
import { aiGate, json } from "@/lib/ai";
import { clampText } from "@/lib/userData";

/**
 * POST { notes } → NotesExtraction: profile fields, saved answers and extra Q&A stated in the user's notes.
 * The page merges it without overwriting anything already filled in. Uses one AI action.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { notes?: unknown };
  const notes = clampText(body.notes, 8000);
  if (notes.length < 20) return json({ error: "Write a few sentences about yourself first." }, 400);
  const gate = await aiGate(req);
  if (!gate.ok) return gate.res;
  try {
    return json(await extractFromNotes(gate.ai, notes), 200, gate.headers);
  } catch (e) {
    return json({ error: (e as Error).message }, 502, gate.headers);
  }
}
