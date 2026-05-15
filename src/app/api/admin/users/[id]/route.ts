import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Patch = z.object({ isAdmin: z.boolean().optional() });

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

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = Patch.parse(await request.json());
  const admin = createServiceClient();
  await admin.from("users").update({ is_admin: body.isAdmin }).eq("id", id);
  await admin.from("audit_log").insert({
    actor_id: me.id,
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
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const admin = createServiceClient();

  // Deactivate by deleting from auth (cascades to public.users via FK).
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_log").insert({
    actor_id: me.id,
    action: "revoke_access",
    target_type: "user",
    target_id: id,
    metadata: { reason: "deactivated" },
  });

  return NextResponse.json({ ok: true });
}
