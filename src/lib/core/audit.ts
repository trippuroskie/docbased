// Audit-log writer used by the CLI and MCP server. Fire-and-forget — an
// audit failure must never break the call that triggered it.
//
// The `source` field is stamped into `metadata.source` so the admin audit
// UI can filter by origin without a schema change.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditSource = "cli" | "mcp" | "web";

export type AuditEntry = {
  /** Actor user id, or null for service-mode CLI/MCP calls. */
  actorId: string | null;
  /** Verb: 'search', 'read', 'list', 'ask', etc. */
  action: string;
  /** Subject of the action: 'document', 'chunk', 'query', 'space'. */
  targetType: string;
  /** Subject id when there is one. */
  targetId?: string | null;
  source: AuditSource;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(
  supabase: SupabaseClient,
  entry: AuditEntry,
): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      metadata: { ...(entry.metadata ?? {}), source: entry.source },
    });
  } catch {
    // Swallow — audit failures must never propagate.
  }
}
