import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi } from "@/lib/auth";

const Body = z.object({
  userId: z.string().uuid(),
  spaceId: z.string().uuid(),
  role: z.enum(["viewer", "editor", "owner"]).nullable(),
});

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { user } = gate;

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
