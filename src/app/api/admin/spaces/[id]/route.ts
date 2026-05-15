import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  return me?.is_admin ? user : null;
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
    actor_id: me.id,
    action: "delete",
    target_type: "space",
    target_id: id,
  });
  return NextResponse.json({ ok: true });
}
