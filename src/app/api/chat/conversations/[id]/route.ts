import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();

  // Ownership check.
  const { data: convo } = await admin
    .from("conversations")
    .select("id, title, user_id, space_ids")
    .eq("id", id)
    .maybeSingle();
  if (!convo || convo.user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: messages, error } = await admin
    .from("messages")
    .select("id, role, content, model, citations, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    conversation: {
      id: convo.id,
      title: convo.title,
      spaceIds: convo.space_ids ?? [],
    },
    messages: messages ?? [],
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const { data: convo } = await admin
    .from("conversations")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!convo || convo.user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await admin.from("messages").delete().eq("conversation_id", id);
  await admin.from("conversations").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}
