import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Landing page for the email sign-in LINK (works with Supabase's default email template).
 * Handles both link styles: PKCE (?code=…) and token hash (?token_hash=…&type=…).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const supabase = await supabaseServer();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing sign-in code") };

  if (error) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("error", "That sign-in link is invalid or expired. Request a new one.");
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
