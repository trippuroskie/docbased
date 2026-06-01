// Per-process caller context. Resolved once at server boot, reused across
// every tool call. Re-export the core types so tool/resource modules don't
// need to reach across packages.

import {
  callerEnvFromProcessEnv,
  resolveCaller,
  type ResolvedCaller,
} from "@core/auth";
import { writeAuditLog } from "@core/audit";
import type { FastMCP } from "fastmcp";

export type ServerContext = {
  caller: ResolvedCaller;
  openrouterApiKey: string;
  embeddingModel: string;
  rerankerModel: string;
  appUrl: string;
};

/**
 * Per-request auth object returned by the HTTP transport's `authenticate` hook
 * (see auth/oauth.ts) and handed to every tool/resource call as `session`.
 * Undefined on the stdio transport, where the caller comes from env instead.
 */
export type DocbasedAuth = {
  caller: ResolvedCaller;
  userId: string | null;
  email: string | null;
  scope?: string;
};

/** The FastMCP server, typed with our per-request auth shape. */
export type DocbasedServer = FastMCP<DocbasedAuth>;

type ServerConfig = Omit<ServerContext, "caller">;

let cachedConfig: ServerConfig | null = null;
let cachedEnvContext: ServerContext | null = null;

/**
 * Static, caller-independent config (OpenRouter key + model overrides). Cached.
 * Shared by every call regardless of which user is authenticated.
 */
export function getServerConfig(): ServerConfig {
  if (cachedConfig) return cachedConfig;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required.");
  }
  cachedConfig = {
    openrouterApiKey,
    embeddingModel:
      process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    rerankerModel: process.env.RERANKER_MODEL ?? "cohere/rerank-3.5",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://docbased.local",
  };
  return cachedConfig;
}

/**
 * stdio / local context: resolves a single caller from env (service key, or
 * DOCBASED_EMAIL/PASSWORD) once and caches it. Used when there's no per-request
 * auth — the stdio transport and the smoke test.
 */
export async function getContext(): Promise<ServerContext> {
  if (cachedEnvContext) return cachedEnvContext;
  const caller = await resolveCaller(callerEnvFromProcessEnv());
  cachedEnvContext = { caller, ...getServerConfig() };
  return cachedEnvContext;
}

/**
 * Resolve the context for a single tool/resource invocation. On the HTTP
 * transport the caller comes from the validated bearer token (per-user scope);
 * on stdio it falls back to the env caller. This is the function tools should
 * call — pass the `session` FastMCP hands them.
 */
export async function toolContext(auth?: DocbasedAuth): Promise<ServerContext> {
  if (auth?.caller) {
    return { caller: auth.caller, ...getServerConfig() };
  }
  return getContext();
}

/**
 * Stamp an audit-log row for an MCP call. Fire-and-forget — failures don't
 * propagate. The source is always 'mcp'; the caller's mode + userId are
 * recorded so the admin UI can distinguish service-mode vs user-mode reads.
 */
export function audit(
  ctx: ServerContext,
  action: string,
  targetType: string,
  targetId: string | null = null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return writeAuditLog(ctx.caller.serviceClient, {
    actorId: ctx.caller.userId,
    action,
    targetType,
    targetId,
    source: "mcp",
    metadata: { ...metadata, mode: ctx.caller.mode },
  });
}
