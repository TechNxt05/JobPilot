import "server-only";
import type { ProviderConfig, ProviderId } from "@internova/core";
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
    .filter((p) => ENV[p]?.key)
    .map((p) => ({ provider: p, apiKey: ENV[p].key!, model: ENV[p].model || undefined }));
  return configs.length ? configs : null;
}

/** The signed-in user, or null. Validated with Supabase Auth (RLS applies to all queries made with this client). */
export async function requireUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user ? { supabase, user: data.user } : null;
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const NO_AI = () => json({ error: "AI isn't configured on this server. Add GROQ_API_KEY (and optionally GEMINI_API_KEY / OPENROUTER_API_KEY as fallbacks)." }, 503);
