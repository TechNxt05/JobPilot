"use client";

import { supabase } from "./supabase/client";

// Backend base URL. Set NEXT_PUBLIC_API_URL in .env.local for non-local deployments.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

/** fetch() to the FastAPI backend with the user's Supabase access token attached. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}
