import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Body = z.object({
  userId: z.string().uuid(),
  spaceId: z.string().uuid(),
  role: z.enum(["viewer", "editor", "owner"]).nullable(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: me } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = Body.parse(await request.json());
  const admin = createServiceClient();

  if (body.role === null) {
    await admin
      .from("space_access")
      .delete()
      .eq("user_id", body.userId)
      .eq("space_id", body.spaceId);
  } else {
    await admin.from("space_access").upsert(
      { user_id: body.userId, space_id: body.spaceId, role: body.role },
      { onConflict: "space_id,user_id" },
    );
  }

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: body.role ? "grant_access" : "revoke_access",
    target_type: "space_access",
    target_id: body.spaceId,
    metadata: { user_id: body.userId, role: body.role },
  });

  return NextResponse.json({ ok: true });
}
