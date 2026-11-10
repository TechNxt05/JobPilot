import { cloudConfigured, supabase } from "./cloud";

/**
 * JobPilot hosted AI: the extension calls the JobPilot website's /api/ai with the user's Supabase
 * session token; the server uses JobPilot's own AI keys and enforces the daily quota.
 * The website URL is baked in at build time (JOBPILOT_API_URL).
 */
declare const __JOBPILOT_API_URL__: string;

export const HOSTED_API = (__JOBPILOT_API_URL__ || "").replace(/\/$/, "");
export const hostedConfigured = !!HOSTED_API && cloudConfigured;

export interface QuotaInfo {
  remaining: number;
  limit: number;
  at: number;
}

async function accessToken(): Promise<string | null> {
  if (!hostedConfigured) return null;
  // getSession() refreshes an expired token using the stored refresh token
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function hostedSignedIn(): Promise<boolean> {
  return !!(await accessToken());
}

async function rememberQuota(res: Response) {
  const remaining = res.headers.get("X-AI-Remaining");
  const limit = res.headers.get("X-AI-Limit");
  if (remaining !== null) {
    await chrome.storage.local.set({ aiQuota: { remaining: Number(remaining), limit: Number(limit) || 20, at: Date.now() } satisfies QuotaInfo });
  }
}

export async function hostedAI<T>(task: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in (Settings → Account) to use JobPilot AI, or add your own API key under Settings → Advanced.");
  let res: Response;
  try {
    res = await fetch(`${HOSTED_API}/api/ai`, {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(150_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ task, ...payload }),
    });
  } catch (e) {
    throw new Error(`Couldn't reach JobPilot AI (${(e as Error).message}). Check your connection and try again.`);
  }
  await rememberQuota(res);
  const body = await res.json().catch(() => ({}));
  if (res.status === 429 && body.quota) await chrome.storage.local.set({ aiQuota: { ...body.quota, remaining: 0, at: Date.now() } });
  if (!res.ok) throw new Error(body.error ?? `JobPilot AI error ${res.status}`);
  return body as T;
}

/** Today's remaining hosted actions (doesn't use one). */
export async function hostedQuota(): Promise<QuotaInfo | null> {
  const token = await accessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${HOSTED_API}/api/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ task: "quota" }),
    });
    const body = await res.json();
    if (!res.ok || typeof body.remaining !== "number") return null;
    const q = { remaining: body.remaining, limit: body.limit, at: Date.now() };
    await chrome.storage.local.set({ aiQuota: q });
    return q;
  } catch {
    return null;
  }
}
