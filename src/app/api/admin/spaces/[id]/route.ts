import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi } from "@/lib/auth";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const { id } = await ctx.params;
  const admin = createServiceClient();

  // Soft-delete documents in the space; hard-delete the space row.
  await admin
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("space_id", id);
  const { error } = await admin.from("spaces").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "delete",
    target_type: "space",
    target_id: id,
  });
  return NextResponse.json({ ok: true });
}
