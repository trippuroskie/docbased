import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/_next",
  "/favicon.ico",
  "/docs",
  "/api/docs-search",
];

export async function updateSession(request: NextRequest) {
  // /mcp authenticates with its own bearer token (no Supabase cookie), so skip
  // the session refresh + login redirect entirely. Otherwise unauthenticated
  // MCP requests get 307'd to /login instead of reaching the route's own token
  // check, and clients that follow redirects receive HTML.
  const pathname = request.nextUrl.pathname;
  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
