import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Host canonicalization. The apex (docbased.dev) is configured in Vercel to
// SERVE the app — not platform-redirect to www — so that bearer-authed
// endpoints work without a cross-origin hop. A redirect from apex→www is a
// different origin, and fetch/undici strips the Authorization header (and
// cookies) across it, which silently breaks the remote MCP at /mcp and any
// other token/cookie auth. So we canonicalize *pages* to www here, but never
// redirect /mcp or /api — those must reach the app on whichever host they hit.
const APEX_HOST = "docbased.dev";
const CANONICAL_HOST = "www.docbased.dev";

function isAuthEndpoint(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname.startsWith("/api/")
  );
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (host === APEX_HOST && !isAuthEndpoint(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.hostname = CANONICAL_HOST;
    return NextResponse.redirect(url, 308);
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
