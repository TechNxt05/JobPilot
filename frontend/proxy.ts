import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 "proxy" (formerly middleware): refreshes the Supabase session cookie and guards pages.
const PUBLIC = [/^\/login(\/|$)/, /^\/auth\//, /^\/api\//];

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the token with Supabase Auth (not just the cookie) and refreshes it if needed
  const { data } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  // Local UI preview (next dev + NEXT_PUBLIC_UI_PREVIEW=1) renders signed-in pages with synthetic data
  const preview = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_UI_PREVIEW === "1";
  if (!data.user && !preview && !PUBLIC.some((re) => re.test(path))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (data.user && path === "/login") return NextResponse.redirect(new URL("/", req.url));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
