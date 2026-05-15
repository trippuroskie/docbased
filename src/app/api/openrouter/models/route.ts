import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  EMBEDDING_MODEL_OPTIONS,
  RERANKER_MODEL_OPTIONS,
  listOpenRouterModels,
} from "@/lib/ai/openrouter-models";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const models = await listOpenRouterModels();
    return NextResponse.json({
      chatModels: models,
      embeddingModels: EMBEDDING_MODEL_OPTIONS,
      rerankerModels: RERANKER_MODEL_OPTIONS,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
