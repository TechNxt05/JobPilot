import { parseProfileText } from "@internova/core";
import { aiGate, json } from "@/lib/ai";

/**
 * POST { text } → partial profile extracted by AI from a resume or any longer profile text (a full CV, a portfolio
 * write-up), read in sections. Entries whose names aren't in the text are dropped.
 */
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text || text.length < 100) return json({ error: "Resume text is missing or too short" }, 400);
  const gate = await aiGate(req);
  if (!gate.ok) return gate.res;
  const { ai, headers } = gate;
  try {
    return json(await parseProfileText(ai, text.slice(0, 40000)), 200, headers);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
