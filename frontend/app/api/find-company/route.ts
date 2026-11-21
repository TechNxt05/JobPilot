import { findCompanyBoards } from "@internova/core";
import { json, requireUser } from "@/lib/ai";
import { clampText } from "@/lib/userData";

export const maxDuration = 60;

/**
 * POST { name } → { boards: FoundBoard[] }
 * Finds a company's public job boards from its name ("JPMorgan", "Mastercard", "Zepto"): the boards JobPilot
 * already knows, then guesses on every job system Discover reads and the company's careers / jobs site. No AI.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Sign in first" }, 401);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = clampText(body.name, 80).trim();
  if (name.length < 2) return json({ error: "Type a company name." }, 400);
  try {
    const boards = await findCompanyBoards(name, { signal: AbortSignal.timeout(45_000) });
    return json({ boards });
  } catch (e) {
    return json({ error: `Couldn't search for ${name}: ${(e as Error).message}` }, 502);
  }
}
