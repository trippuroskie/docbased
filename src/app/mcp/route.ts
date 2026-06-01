// Remote MCP endpoint — POST/GET/DELETE https://<app>/mcp
//
// Runs the EdgeFastMCP server (web-standard Streamable HTTP) inside the Next
// app on Vercel, so the MCP server ships with every deploy — no separate host.
// Auth is a docbased personal access token (Authorization: Bearer dbk_…),
// validated here against the same mcp_tokens table the web UI mints from; the
// request then runs scoped to that token's owner.

import { createServiceClient } from "@/lib/supabase/server";
import { resolveCallerForUser } from "@/lib/core/auth";
import { validateMcpToken } from "@/lib/core/tokens";
import { env } from "@/lib/env";
import { mcpCtxStore, mcpServer } from "@/lib/mcp/edge-server";

// Node runtime: EdgeFastMCP uses web-standard APIs but our tool bodies use
// @supabase/supabase-js, node:crypto, and the OpenAI SDK. maxDuration matches
// the chat route.
export const runtime = "nodejs";
export const maxDuration = 60;

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: valid docbased access token required." },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "WWW-Authenticate": 'Bearer realm="docbased", error="invalid_token"',
      },
    },
  );
}

async function handler(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;
  if (!token) return unauthorized();

  if (!env.openrouterApiKey) {
    return new Response("Server misconfigured: OPENROUTER_API_KEY unset.", {
      status: 500,
    });
  }

  const serviceClient = createServiceClient();
  const result = await validateMcpToken(serviceClient, token);
  if (!result) return unauthorized();

  const caller = await resolveCallerForUser(serviceClient, result.userId);

  // Hand the resolved caller to the tool bodies via AsyncLocalStorage, then let
  // EdgeFastMCP process the JSON-RPC request.
  return mcpCtxStore.run(
    {
      caller,
      openrouterApiKey: env.openrouterApiKey,
      embeddingModel: env.embeddingModel,
      rerankerModel: env.rerankerModel,
      appUrl: env.appUrl,
    },
    () => mcpServer.fetch(req),
  );
}

export { handler as GET, handler as POST, handler as DELETE };
