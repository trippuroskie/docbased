import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/settings";

export const runtime = "nodejs";

const Body = z.object({
  chatModels: z.array(z.string().min(1).max(200)).max(50),
  defaultChatModel: z.string().min(1).max(200).nullable(),
  embeddingModel: z.string().min(1).max(200).nullable(),
  rerankerModel: z.string().min(1).max(200).nullable(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const settings = await getUserSettings(user.id);
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // If a default is provided, it must be one of the enabled chat models.
  if (
    body.defaultChatModel &&
    body.chatModels.length > 0 &&
    !body.chatModels.includes(body.defaultChatModel)
  ) {
    return NextResponse.json(
      { error: "default_not_in_enabled" },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { error } = await admin.from("user_settings").upsert(
    {
      user_id: user.id,
      chat_models: body.chatModels,
      default_chat_model: body.defaultChatModel,
      embedding_model: body.embeddingModel,
      reranker_model: body.rerankerModel,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
