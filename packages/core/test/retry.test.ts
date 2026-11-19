import { describe, expect, it, vi } from "vitest";
import { completeParsed, parseJSONLoose, repairJSON, retryAfterMs, PROVIDERS } from "../src";

const chat = (content: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : JSON.stringify({ error: { message: content } }), { status, headers });

describe("rate limits", () => {
  it("reads how long to wait", () => {
    expect(retryAfterMs(null, "Please try again in 23.8875s. Need more tokens?")).toBe(23888);
    expect(retryAfterMs(null, "try again in 1m2.5s")).toBe(62500);
    expect(retryAfterMs(null, "try again in 450ms")).toBe(450);
    expect(retryAfterMs("7", "whatever")).toBe(7000);
    expect(retryAfterMs(null, "slow down")).toBeUndefined();
  });

  it("waits out a short limit once when every provider failed, then succeeds", async () => {
    let groq = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("groq")) return groq++ === 0 ? chat("Rate limit reached. Please try again in 0.1s.", 429) : chat('{"ok": true}');
      return chat("broken {", 200); // the other provider returns junk
    });
    const out = await completeParsed(
      [{ provider: "groq", apiKey: "gsk_aaaaaaaaaa" }, { provider: "openrouter", apiKey: "sk-or-aaaaaaaaaa" }],
      { system: "s", user: "u", fetchImpl: fetchImpl as unknown as typeof fetch },
      (raw) => { const v = parseJSONLoose(raw) as { ok?: boolean }; if (!v.ok) throw new Error("no"); return v; },
    );
    expect(out.value).toEqual({ ok: true });
    expect(out.provider).toBe("groq");
  });

  it("doesn't wait for long limits", async () => {
    const fetchImpl = vi.fn(async () => chat("Please try again in 90s.", 429));
    const err = await completeParsed({ provider: "groq", apiKey: "gsk_aaaaaaaaaa" }, { system: "s", user: "u", fetchImpl: fetchImpl as unknown as typeof fetch }, (r) => r).catch((e) => e);
    expect(err.kind).toBe("rate_limit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("invalid JSON", () => {
  it("asks once more, reminding the model to check the JSON", async () => {
    const systems: string[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      systems.push(JSON.parse(String(init.body)).messages[0].content);
      return chat(n++ === 0 ? 'not json at all' : '{"answers": []}');
    });
    const out = await completeParsed({ provider: "groq", apiKey: "gsk_aaaaaaaaaa" }, { system: "SYS", user: "u", fetchImpl: fetchImpl as unknown as typeof fetch }, (raw) => parseJSONLoose(raw));
    expect(out.value).toEqual({ answers: [] });
    expect(systems[1]).toMatch(/^SYS[\s\S]*valid JSON/);
  });

  it("repairs the slips models make", () => {
    // Missing comma between array items (the "Expected ',' or ']' after array element" error)
    expect(JSON.parse(repairJSON('{"a": [\n {"x": 1}\n {"x": 2}\n ]}'))).toEqual({ a: [{ x: 1 }, { x: 2 }] });
    expect(JSON.parse(repairJSON('{"a": ["p" "q"], "b": 12}'))).toEqual({ a: ["p", "q"], b: 12 });
    // Trailing commas, raw line breaks in strings, numbers and literals left intact
    expect(JSON.parse(repairJSON('{"a": [1, 2,], "b": "line 1\nline 2", "c": true, "d": null,}'))).toEqual({ a: [1, 2], b: "line 1\nline 2", c: true, d: null });
    // Cut off mid-answer
    expect(JSON.parse(repairJSON('{"answers": [{"id": "q1", "answer": "Yes"}, {"id": "q2", "answer": "I built'))).toEqual({ answers: [{ id: "q1", answer: "Yes" }, { id: "q2", answer: "I built" }] });
    expect(parseJSONLoose('Here you go:\n```json\n{"a": [1 2]}\n```')).toEqual({ a: [1, 2] });
  });
});

describe("Mistral", () => {
  it("is an OpenAI-compatible provider with a free default model", async () => {
    expect(PROVIDERS.mistral.defaultModel).toBe("mistral-small-latest");
    const fetchImpl = vi.fn(async () => chat('{"ok": true}'));
    await completeParsed({ provider: "mistral", apiKey: "mistralkey123456" }, { system: "s", user: "u", fetchImpl: fetchImpl as unknown as typeof fetch }, (r) => parseJSONLoose(r));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "mistral-small-latest", response_format: { type: "json_object" } });
  });
});
