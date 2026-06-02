import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi } from "@/lib/auth";

const Patch = z.object({ isAdmin: z.boolean().optional() });

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const { id } = await ctx.params;
  const body = Patch.parse(await request.json());
  const admin = createServiceClient();
  await admin.from("users").update({ is_admin: body.isAdmin }).eq("id", id);
  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: body.isAdmin ? "grant_access" : "revoke_access",
    target_type: "user",
    target_id: id,
    metadata: { is_admin: body.isAdmin },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const { id } = await ctx.params;
  const admin = createServiceClient();

  // Deactivate by deleting from auth (cascades to public.users via FK).
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "revoke_access",
    target_type: "user",
    target_id: id,
    metadata: { reason: "deactivated" },
  });

  return NextResponse.json({ ok: true });
}
