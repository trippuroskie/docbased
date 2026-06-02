import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi } from "@/lib/auth";
import { embed } from "@/lib/ai/openrouter";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

// Re-embed all chunks whose embedding_model != current EMBEDDING_MODEL.
// Designed to be called repeatedly until { remaining: 0 } — the route processes
// a single batch each call to stay inside Vercel's timeout.
export async function POST() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const admin = createServiceClient();
  const { data: rows } = await admin
    .from("chunks")
    .select("id, content")
    .neq("embedding_model", env.embeddingModel)
    .limit(100);
  if (!rows || rows.length === 0) {
    return NextResponse.json({ remaining: 0 });
  }

  const embeddings = await embed(rows.map((r) => r.content));
  for (let i = 0; i < rows.length; i++) {
    await admin
      .from("chunks")
      .update({
        embedding: `[${embeddings[i].join(",")}]`,
        embedding_model: env.embeddingModel,
      })
      .eq("id", rows[i].id);
  }

  const { count } = await admin
    .from("chunks")
    .select("id", { count: "exact", head: true })
    .neq("embedding_model", env.embeddingModel);

  return NextResponse.json({ processed: rows.length, remaining: count ?? 0 });
}
