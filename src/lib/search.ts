import { createServiceClient } from "@/lib/supabase/server";
import { getAccessibleSpaces, getSession } from "@/lib/auth";
import { embedOne } from "@/lib/ai/openrouter";
import { env } from "@/lib/env";
import {
  effectiveEmbeddingModel,
  effectiveRerankerModel,
  getUserSettings,
} from "@/lib/settings";

export type SearchHit = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentPath: string;
  spaceId: string;
  spaceName: string;
  headingPath: string[];
  content: string;
  score: number;
};

export type SearchOptions = {
  spaceIds?: string[];
  limit?: number;
  rerank?: boolean;
};

export async function search(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  // Access control: getAccessibleSpaces is admin-aware and bypasses the
  // user-session RLS that was returning empty here.
  const accessible = await getAccessibleSpaces();
  const accessibleIds = accessible.map((s) => s.id);
  const nameById = new Map(accessible.map((s) => [s.id, s.name]));

  // Resolve the caller's preferred embedding + reranker models. Embedding
  // model must produce 1536-dim vectors to match the index — we trust the
  // user's saved pick; mismatches surface as visible failures rather than
  // silently degraded results.
  const user = await getSession();
  const settings = user
    ? await getUserSettings(user.id)
    : { chatModels: [], defaultChatModel: null, embeddingModel: null, rerankerModel: null };
  const embeddingModel = effectiveEmbeddingModel(settings);
  const rerankerModel = effectiveRerankerModel(settings);

  // Data queries: use service client since access is enforced above.
  const supabase = createServiceClient();

  const scope =
    opts.spaceIds && opts.spaceIds.length
      ? accessibleIds.filter((id) => opts.spaceIds!.includes(id))
      : accessibleIds;

  if (scope.length === 0) return [];

  const queryEmbedding = await embedOne(query, { model: embeddingModel });

  const { data: rows, error } = await supabase.rpc("hybrid_search", {
    query_text: query,
    query_embedding: toVectorLiteral(queryEmbedding),
    space_ids: scope,
    match_count: opts.limit ?? 20,
  });
  if (error) throw new Error(error.message);

  const chunkRows = (rows ?? []) as Array<{
    chunk_id: string;
    document_id: string;
    content: string;
    heading_path: string[] | null;
    score: number;
  }>;

  if (chunkRows.length === 0) return [];

  // Hydrate document metadata in one round-trip.
  const docIds = Array.from(new Set(chunkRows.map((r) => r.document_id)));
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, path, space_id")
    .in("id", docIds);

  const docById = new Map((docs ?? []).map((d) => [d.id, d]));

  let hits: SearchHit[] = chunkRows.map((r) => {
    const d = docById.get(r.document_id);
    return {
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentTitle: (d?.title as string) ?? "(untitled)",
      documentPath: (d?.path as string) ?? "",
      spaceId: (d?.space_id as string) ?? "",
      spaceName: nameById.get(d?.space_id as string) ?? "",
      headingPath: r.heading_path ?? [],
      content: r.content,
      score: r.score,
    };
  });

  if (opts.rerank && env.rerankerEnabled && hits.length > 1) {
    hits = await rerank(query, hits, rerankerModel);
  }

  return hits;
}

async function rerank(
  query: string,
  hits: SearchHit[],
  model: string,
): Promise<SearchHit[]> {
  try {
    // OpenRouter exposes Cohere reranker via the same endpoint family.
    // We use fetch directly because the SDK doesn't model rerank.
    const resp = await fetch("https://openrouter.ai/api/v1/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.appUrl,
        "X-Title": "Knowledge Hub",
      },
      body: JSON.stringify({
        model,
        query,
        documents: hits.map((h) => h.content),
        top_n: Math.min(hits.length, 5),
      }),
    });
    if (!resp.ok) return hits.slice(0, 5);
    const json = (await resp.json()) as {
      results: { index: number; relevance_score: number }[];
    };
    const ranked = json.results
      .map((r) => ({ ...hits[r.index], score: r.relevance_score }))
      .filter(Boolean);
    return ranked.length ? ranked : hits.slice(0, 5);
  } catch {
    return hits.slice(0, 5);
  }
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export { embedOne };
