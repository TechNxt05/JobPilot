import { z } from "zod";
/**
 * Bring-your-own-key AI provider adapters.
 *
 * Requests go straight from the caller (the extension's service worker, or a server
 * route) to the provider. Nothing here logs or stores the key, and keys are scrubbed
 * from any error message before it is thrown.
 */

export type ProviderId = "groq" | "openai" | "gemini" | "openrouter" | "mistral";

export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  /** Empty → provider default */
  model?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  keyUrl: string;
  /** Origins the caller needs network access to (used for extension host_permissions) */
  origin: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  groq: {
    id: "groq",
    label: "Groq",
    defaultModel: "openai/gpt-oss-120b",
    keyUrl: "https://console.groq.com/keys",
    origin: "https://api.groq.com",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    origin: "https://api.openai.com",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-3.5-flash-lite",
    keyUrl: "https://aistudio.google.com/app/apikey",
    origin: "https://generativelanguage.googleapis.com",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    // Auto-routes to an available free model; works on free-tier (no credit) accounts
    defaultModel: "openrouter/free",
    keyUrl: "https://openrouter.ai/keys",
    origin: "https://openrouter.ai",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    // Free "Experiment" plan (phone verification); supports JSON mode
    defaultModel: "mistral-small-latest",
    keyUrl: "https://console.mistral.ai/api-keys",
    origin: "https://api.mistral.ai",
  },
};

const OPENAI_COMPATIBLE_BASE: Partial<Record<ProviderId, string>> = {
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
};

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public kind: "auth" | "rate_limit" | "bad_request" | "server" | "network" | "invalid_output",
    /** Rate limits: how long the provider asked to wait before retrying */
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Wait the provider asked for: a Retry-After header (seconds), or "try again in 23.8s / 1m2s / 450ms" in the message. */
export function retryAfterMs(header: string | null, message: string): number | undefined {
  const secs = Number(header);
  if (header && Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  const m = message.match(/try again in\s+(?:(\d+)m)?\s*(\d+(?:\.\d+)?)\s*(ms|s)\b/i);
  if (!m) return undefined;
  const value = Number(m[2]) * (m[3].toLowerCase() === "ms" ? 1 : 1000);
  return Math.ceil(Number(m[1] ?? 0) * 60_000 + value);
}

function scrub(message: string, apiKey: string): string {
  let out = message;
  if (apiKey && apiKey.length >= 6) out = out.split(apiKey).join("***");
  // Also mask anything that looks like a provider key
  return out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{20,}|sk-or-[A-Za-z0-9_-]{8,})/g, "***");
}

function kindForStatus(status: number): ProviderError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "bad_request";
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? body?.message ?? JSON.stringify(body).slice(0, 300);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export interface CompleteOptions {
  system: string;
  user: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Ask the provider for JSON output (default true) */
  json?: boolean;
  /** Output token cap (default 8192). Without it some providers reserve their maximum and reject low-credit accounts. */
  maxTokens?: number;
  /** Per-provider time limit in ms before falling back to the next provider (default 45 s) */
  timeoutMs?: number;
  /** When every provider is rate-limited: the longest "try again in …" worth waiting for once (default 30 s) */
  maxRetryWaitMs?: number;
}

/** Single chat completion; returns the raw text content. */
export async function complete(config: ProviderConfig, opts: CompleteOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const model = config.model?.trim() || PROVIDERS[config.provider].defaultModel;
  const json = opts.json ?? true;
  if (!config.apiKey) throw new ProviderError("No API key configured", null, "auth");

  let res: Response;
  try {
    if (config.provider === "gemini") {
      res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          signal: opts.signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            contents: [{ role: "user", parts: [{ text: opts.user }] }],
            generationConfig: { temperature: 0, maxOutputTokens: opts.maxTokens ?? 8192, ...(json ? { responseMimeType: "application/json" } : {}) },
          }),
        },
      );
    } else {
      const base = OPENAI_COMPATIBLE_BASE[config.provider]!;
      res = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        signal: opts.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.provider === "openrouter" ? { "X-Title": "Internova" } : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 8192,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ProviderError(scrub(`Network error contacting ${PROVIDERS[config.provider].label}: ${(e as Error).message}`, config.apiKey), null, "network");
  }

  if (!res.ok) {
    const detail = scrub(await readError(res), config.apiKey);
    const kind = kindForStatus(res.status);
    const hint = kind === "auth" ? " (check your API key)" : kind === "rate_limit" ? " (rate limited; try again shortly)" : "";
    throw new ProviderError(`${PROVIDERS[config.provider].label} error ${res.status}: ${detail}${hint}`, res.status, kind,
      kind === "rate_limit" ? retryAfterMs(res.headers.get("retry-after"), detail) : undefined);
  }

  const body = await res.json();
  const text: string | undefined =
    config.provider === "gemini"
      ? body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("")
      : body?.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError("The model returned an empty response", res.status, "invalid_output");
  return text;
}

/** Parse JSON from model output, tolerating ```json fences and leading prose. */
export function parseJSONLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    if (start < 0) throw new ProviderError("The model did not return valid JSON", null, "invalid_output");
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    const sliced = end > start ? candidate.slice(start, end + 1) : candidate.slice(start);
    for (const attempt of [sliced, repairJSON(sliced), repairJSON(candidate.slice(start))]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* next */
      }
    }
    throw new ProviderError("The model did not return valid JSON", null, "invalid_output");
  }
}

/**
 * Fix the slips models make in long JSON: a missing comma between items, a trailing comma, raw line breaks inside
 * strings, and an answer cut off before its closing quotes / brackets.
 */
export function repairJSON(text: string): string {
  let out = "";
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  // Last significant character outside strings, to spot a missing comma before the next value
  let prev = "";
  let gap = false; // whitespace since `prev` (so "12" or "true" isn't split into two values)
  for (const ch of text) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === "\\") { escaped = true; out += ch; continue; }
      if (ch === '"') { inString = false; prev = '"'; gap = false; out += ch; continue; }
      out += ch === "\n" ? "\\n" : ch === "\r" ? "" : ch === "\t" ? "\\t" : ch;
      continue;
    }
    if (/\s/.test(ch)) { out += ch; gap = true; continue; }
    // A value right after another value: the comma is missing
    const startsValue = ch === '"' || ch === "{" || ch === "[" || /[-\dtfn]/.test(ch);
    const endedValue = prev === '"' || prev === "}" || prev === "]" || (gap && /[\del]/.test(prev));
    if (startsValue && endedValue && stack.length) out = out.replace(/\s*$/, "") + ",";
    gap = false;
    if (ch === "}" || ch === "]") out = out.replace(/,\s*$/, ""); // trailing comma
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
    out += ch;
    prev = ch;
  }
  // Cut off mid-answer: close the open string, drop a dangling key or comma, close the brackets
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "").replace(/,\s*"[^"]*"\s*:?\s*$/, "").replace(/:\s*$/, ": null");
  while (stack.length) out += stack.pop();
  return out;
}

/* ------------------------------ Lenient output schemas ------------------------------ */
// Real models return years/CGPA as numbers, bullets as arrays and missing values as null.
// These accept all of that and normalise to the strings/arrays the app uses.
const scalar = z.union([z.string(), z.number(), z.boolean()]);
const named = z.object({ name: scalar.optional(), title: scalar.optional(), skill: scalar.optional() }).passthrough();
const flat = (v: unknown): string =>
  v === null || v === undefined ? "" : typeof v === "object" && !Array.isArray(v)
    ? String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).title ?? (v as Record<string, unknown>).skill ?? "")
    : String(v);

/** String field; arrays are joined with `sep` (newline for bullets, ", " for lists). */
export const looseText = (sep = "\n") =>
  z.union([scalar, z.array(z.union([scalar, named])), named]).nullish()
    .transform((v) => (Array.isArray(v) ? v.map(flat).map((x) => x.trim()).filter(Boolean).join(sep) : flat(v)).trim());

/** Array of strings; a single string becomes one item (or splits on newlines/commas when `split`). */
export const looseStrings = (split?: RegExp) =>
  z.union([z.array(z.union([scalar, named])), scalar]).nullish()
    .transform((v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v.map(flat) : split ? String(v).split(split) : [String(v)])
      .map((x) => x.trim()).filter(Boolean));

/** Array of objects; null → []. */
export const looseArray = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullish().transform((v) => (v ?? []) as z.infer<T>[]);

/* ------------------------------ Fallback across providers ------------------------------ */

/** One provider, or several in priority order (e.g. Groq → Gemini → OpenRouter → OpenAI). */
export type AIConfig = ProviderConfig | ProviderConfig[];

export interface Attempt {
  provider: ProviderId;
  model: string;
  error?: string;
}

/** False for empty values and template placeholders such as "your_openai_api_key". */
export function isRealKey(key: string | undefined | null): key is string {
  const k = (key ?? "").trim();
  return k.length > 0 && !/^(your[_-]|<|xxx|changeme|replace)/i.test(k) && !/\.\.\.$/.test(k);
}

export function toConfigs(ai: AIConfig | null | undefined): ProviderConfig[] {
  if (!ai) return [];
  return (Array.isArray(ai) ? ai : [ai]).filter((c) => c && isRealKey(c.apiKey));
}

/**
 * Run a completion and parse it, falling back to the next provider when one fails:
 * bad key, rate limit, outage, unknown model, network error, or output that doesn't parse.
 * Throws a ProviderError listing every attempt if all providers fail.
 */
export async function completeParsed<T>(
  ai: AIConfig,
  opts: CompleteOptions,
  parse: (raw: string) => T,
): Promise<{ value: T; provider: ProviderId; attempts: Attempt[] }> {
  const configs = toConfigs(ai);
  if (!configs.length) throw new ProviderError("No AI provider configured. Add an API key in Settings.", null, "auth");
  const attempts: Attempt[] = [];
  const failed: { config: ProviderConfig; error: ProviderError }[] = [];

  async function attempt(config: ProviderConfig, nudge = ""): Promise<{ value: T } | null> {
    const model = config.model?.trim() || PROVIDERS[config.provider].defaultModel;
    try {
      // A provider that hangs must not block the fallback chain: abort it after timeoutMs
      const timer = new AbortController();
      const timeout = setTimeout(() => timer.abort(), opts.timeoutMs ?? 45_000);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timer.signal]) : timer.signal;
      let raw: string;
      try {
        raw = await complete(config, { ...opts, system: opts.system + nudge, signal });
      } catch (e) {
        if ((e as Error)?.name === "AbortError" && !opts.signal?.aborted) {
          throw new ProviderError(`${PROVIDERS[config.provider].label} timed out after ${Math.round((opts.timeoutMs ?? 45_000) / 1000)} s`, null, "network");
        }
        throw e;
      } finally {
        clearTimeout(timeout);
      }
      const value = parse(raw);
      attempts.push({ provider: config.provider, model });
      return { value };
    } catch (e) {
      if ((e as Error)?.name === "AbortError" && opts.signal?.aborted) throw e;
      const err = e instanceof ProviderError ? e : new ProviderError(scrub((e as Error).message ?? String(e), config.apiKey), null, "invalid_output");
      attempts.push({ provider: config.provider, model, error: err.message });
      failed.push({ config, error: err });
      return null;
    }
  }

  for (const config of configs) {
    const ok = await attempt(config);
    if (ok) return { value: ok.value, provider: config.provider, attempts };
  }

  // Everyone failed. Second chance for failures that usually pass on a retry:
  // 1. a reply that wasn't valid JSON (asked again, reminded to check the JSON);
  // 2. a short rate limit ("try again in 24s"): wait it out once, then retry.
  const firstRound = [...failed];
  const nudge = "\n\nIMPORTANT: reply with one complete, valid JSON object. Check every comma, quote and bracket.";
  for (const { config } of firstRound.filter((f) => f.error.kind === "invalid_output")) {
    const ok = await attempt(config, nudge);
    if (ok) return { value: ok.value, provider: config.provider, attempts };
  }
  const maxWait = opts.maxRetryWaitMs ?? 30_000;
  const limited = firstRound
    .filter((f) => f.error.kind === "rate_limit" && f.error.retryAfterMs !== undefined && f.error.retryAfterMs <= maxWait)
    .sort((a, b) => a.error.retryAfterMs! - b.error.retryAfterMs!);
  if (limited.length) {
    await sleep(limited[0].error.retryAfterMs! + 500, opts.signal);
    for (const { config } of limited) {
      const ok = await attempt(config);
      if (ok) return { value: ok.value, provider: config.provider, attempts };
    }
  }

  const summary = attempts.map((a) => a.error).filter(Boolean).join(" · ");
  const lastErr = failed[failed.length - 1]?.error;
  throw new ProviderError(configs.length > 1 ? `All ${configs.length} AI providers failed: ${summary}` : summary, lastErr?.status ?? null, lastErr?.kind ?? "server");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}
