// Per-process caller context. Resolved once at server boot, reused across
// every tool call. Re-export the core types so tool/resource modules don't
// need to reach across packages.

import {
  callerEnvFromProcessEnv,
  resolveCaller,
  type ResolvedCaller,
} from "@core/auth";
import { writeAuditLog } from "@core/audit";

export type ServerContext = {
  caller: ResolvedCaller;
  openrouterApiKey: string;
  embeddingModel: string;
  rerankerModel: string;
  appUrl: string;
};

let cached: ServerContext | null = null;

/**
 * Idempotent — first call resolves the caller and signs in (if user mode);
 * subsequent calls return the cached context. Throws if required env is
 * missing.
 */
export async function getContext(): Promise<ServerContext> {
  if (cached) return cached;
  const env = callerEnvFromProcessEnv();
  const caller = await resolveCaller(env);
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required.");
  }
  cached = {
    caller,
    openrouterApiKey,
    embeddingModel:
      process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    rerankerModel: process.env.RERANKER_MODEL ?? "cohere/rerank-3.5",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://docbased.local",
  };
  return cached;
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
