import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isRealKey, type ProviderConfig, type ProviderId } from "@internova/core";
import { supabaseServer } from "./supabase/server";

const ENV: Record<ProviderId, { key?: string; model?: string }> = {
  groq: { key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL },
  gemini: { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL },
  openrouter: { key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL },
  openai: { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
};

/**
 * Server-side AI providers in fallback order (LLM_FALLBACK_ORDER, default groq → gemini → openrouter → openai).
 * Every provider with a key joins the chain; if one fails, the next is tried. Keys never reach the browser.
 */
export function serverAI(): ProviderConfig[] | null {
  const order = (process.env.LLM_FALLBACK_ORDER || "groq,gemini,openrouter,openai").split(",").map((s) => s.trim()) as ProviderId[];
  const configs = order
    .filter((p) => isRealKey(ENV[p]?.key))
    .map((p) => ({ provider: p, apiKey: ENV[p].key!, model: ENV[p].model || undefined }));
  return configs.length ? configs : null;
}

/**
 * The signed-in user, or null. Accepts the website's session cookie or, for the browser extension,
 * `Authorization: Bearer <Supabase access token>`. Validated with Supabase Auth; queries made with the
 * returned client run as that user, so RLS applies.
 */
export async function requireUser(req?: Request): Promise<{ supabase: SupabaseClient; user: { id: string; email?: string } } | null> {
  const bearer = req?.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase.auth.getUser(bearer);
    return data.user ? { supabase, user: data.user } : null;
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user ? { supabase, user: data.user } : null;
}

export interface Quota {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Use one hosted-AI action for the user (daily limit lives in the database: ai_config.daily_limit).
 * Fails closed: if the quota can't be checked, AI isn't run (protects your API bill).
 */
export async function consumeQuota(supabase: SupabaseClient): Promise<Quota | { error: string }> {
  const { data, error } = await supabase.rpc("consume_ai_quota");
  if (error) return { error: `AI quota check failed (${error.message}). Run supabase/migrations/20261110000000_ai_quota.sql.` };
  return data as Quota;
}

export async function quotaStatus(supabase: SupabaseClient): Promise<{ remaining: number; limit: number } | null> {
  const { data, error } = await supabase.rpc("ai_quota_status");
  return error ? null : (data as { remaining: number; limit: number });
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

export const NO_AI = () => json({ error: "AI isn't configured on this server. Add GROQ_API_KEY (and optionally GEMINI_API_KEY / OPENROUTER_API_KEY as fallbacks)." }, 503);

/** Auth + AI keys + quota in one step for AI routes. Returns either the context or an error Response. */
export async function aiGate(req: Request): Promise<
  { ok: true; supabase: SupabaseClient; user: { id: string }; ai: ProviderConfig[]; quota: Quota; headers: Record<string, string> } | { ok: false; res: Response }
> {
  const auth = await requireUser(req);
  if (!auth) return { ok: false, res: json({ error: "Sign in first" }, 401) };
  const ai = serverAI();
  if (!ai) return { ok: false, res: NO_AI() };
  const quota = await consumeQuota(auth.supabase);
  if ("error" in quota) return { ok: false, res: json({ error: quota.error }, 503) };
  if (!quota.allowed) {
    return {
      ok: false,
      res: json({ error: `You've used all ${quota.limit} AI actions for today. They reset at midnight UTC. In the extension you can add your own API key (Settings → Advanced) for unlimited use.`, quota }, 429, { "X-AI-Remaining": "0" }),
    };
  }
  return { ok: true, ...auth, ai, quota, headers: { "X-AI-Remaining": String(quota.remaining), "X-AI-Limit": String(quota.limit) } };
}
