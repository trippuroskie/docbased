import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Body = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
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
  const { data, error } = await admin
    .from("spaces")
    .insert({ name: body.name, slug: body.slug, description: body.description })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "grant_access",
    target_type: "space",
    target_id: data.id,
    metadata: { created: true, name: body.name },
  });

  return NextResponse.json({ id: data.id });
}
