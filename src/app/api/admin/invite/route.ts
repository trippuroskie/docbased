import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi } from "@/lib/auth";
import { env } from "@/lib/env";

const InviteBody = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  spaceId: z.string().uuid().optional(),
  role: z.enum(["viewer", "editor", "owner"]).default("viewer"),
});

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const body = InviteBody.parse(await req.json());
  const admin = createServiceClient();

  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(
    body.email,
    { redirectTo: `${env.appUrl}/auth/callback` },
  );
  if (error || !invited.user) {
    return NextResponse.json({ error: error?.message ?? "invite_failed" }, { status: 400 });
  }

  await admin.from("users").upsert({
    id: invited.user.id,
    email: body.email,
    display_name: body.displayName ?? null,
  });

  if (body.spaceId) {
    await admin.from("space_access").upsert({
      space_id: body.spaceId,
      user_id: invited.user.id,
      role: body.role,
    });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "invite",
    target_type: "user",
    target_id: invited.user.id,
    metadata: { email: body.email, space_id: body.spaceId, role: body.role },
  });

  return NextResponse.json({ ok: true, userId: invited.user.id });
}
