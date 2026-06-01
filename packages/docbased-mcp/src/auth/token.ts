// Personal-access-token validation for the remote (HTTP) transport.
//
// Every HTTP request must carry `Authorization: Bearer dbk_…`. We hash the
// presented token and look it up (src/lib/core/tokens.ts); a valid, unrevoked,
// unexpired token resolves to its owning user, and the request then runs with
// that user's space access (resolveCallerForUser). No external IdP, no OAuth
// flow — the token is minted from the docbased web UI and pasted into the
// client config.
//
// Required env (already needed by the server): SUPABASE_URL + SUPABASE_SECRET_KEY.

import type { IncomingMessage } from "node:http";

import { resolveCallerForUser, serviceClientFromEnv } from "@core/auth";
import { validateMcpToken } from "@core/tokens";

import type { DocbasedAuth } from "../context.js";
import { log } from "../util.js";

function unauthorized(): Response {
  return new Response(null, {
    status: 401,
    statusText: "Unauthorized",
    headers: {
      "WWW-Authenticate": 'Bearer realm="docbased", error="invalid_token"',
    },
  });
}

/**
 * Build the `authenticate` hook FastMCP runs on every HTTP request before any
 * tool executes. The service client is created once and reused across requests.
 * Throws a 401 Response for a missing/invalid/revoked/expired token.
 */
export function makeTokenAuthenticate(): (
  request: IncomingMessage,
) => Promise<DocbasedAuth> {
  const serviceClient = serviceClientFromEnv();

  return async (request) => {
    const header = request.headers["authorization"];
    const token =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : null;
    if (!token) throw unauthorized();

    const result = await validateMcpToken(serviceClient, token);
    if (!result) {
      log("rejected token (unknown, revoked, or expired)");
      throw unauthorized();
    }

    const caller = await resolveCallerForUser(serviceClient, result.userId);
    return { caller, userId: caller.userId, email: caller.userEmail };
  };
}
