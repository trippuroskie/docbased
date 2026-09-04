import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { env } from "@/lib/env";

// Optional host canonicalization, driven by NEXT_PUBLIC_CANONICAL_HOST
// (e.g. "www.example.com"). Unset — the default — disables it entirely.
//
// When you do run a www canonical host, configure the apex to SERVE the app
// rather than platform-redirect to www, and let this handle the redirect for
// pages only. Reason: apex→www is a different origin, and fetch/undici strips
// the Authorization header (and cookies) across that hop, which silently
// breaks the remote MCP at /mcp and anything else using bearer or cookie auth.
// So /mcp and /api must reach the app on whichever host they arrive at.
const CANONICAL_HOST = env.canonicalHost;
const APEX_HOST = CANONICAL_HOST?.replace(/^www\./, "") ?? null;

function isAuthEndpoint(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname.startsWith("/api/")
  );
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (
    CANONICAL_HOST &&
    APEX_HOST !== CANONICAL_HOST &&
    host === APEX_HOST &&
    !isAuthEndpoint(request.nextUrl.pathname)
  ) {
    const url = request.nextUrl.clone();
    url.hostname = CANONICAL_HOST;
    return NextResponse.redirect(url, 308);
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
