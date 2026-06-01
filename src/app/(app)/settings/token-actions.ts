"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/core/audit";
import {
  createMcpToken,
  revokeMcpToken,
  type McpTokenRow,
} from "@/lib/core/tokens";

// Token management runs through the service client after an explicit
// requireUser() check, with an explicit user_id filter — the same pattern the
// rest of the app uses (see AGENTS.md "Auth & RLS").

export async function createTokenAction(
  name: string,
): Promise<{ token: string; row: McpTokenRow }> {
  const user = await requireUser();
  const trimmed = name.trim().slice(0, 80) || "Untitled token";
  const admin = createServiceClient();
  const result = await createMcpToken(admin, user.id, trimmed);
  await writeAuditLog(admin, {
    actorId: user.id,
    action: "create",
    targetType: "mcp_token",
    targetId: result.row.id,
    source: "web",
    metadata: { name: trimmed },
  });
  revalidatePath("/settings");
  return result;
}

export async function revokeTokenAction(id: string): Promise<void> {
  const user = await requireUser();
  const admin = createServiceClient();
  await revokeMcpToken(admin, user.id, id);
  await writeAuditLog(admin, {
    actorId: user.id,
    action: "revoke",
    targetType: "mcp_token",
    targetId: id,
    source: "web",
  });
  revalidatePath("/settings");
}
