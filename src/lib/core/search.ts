// Pure search core. No cookies, no Next.js, no auth resolution — those are
// caller responsibilities. The web app, CLI, and MCP server all funnel here.

import type { SupabaseClient } from "@supabase/supabase-js";

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

export type SearchCoreOptions = {
  /** Pre-resolved set of space IDs the caller may read. Empty array => no hits. */
  accessibleSpaceIds: string[];
  /** Optional human-friendly names keyed by space id; used to populate `spaceName`. */
  spaceNamesById?: Map<string, string>;
  /** Optional sub-filter — must be a subset of accessibleSpaceIds. */
  scopeSpaceIds?: string[];
  limit?: number;
  /** If true, attempt OpenRouter rerank. Caller decides whether reranking is enabled overall. */
  rerank?: boolean;
  /** Pre-computed 1536-dim query embedding. Caller owns the embedding model choice. */
  queryEmbedding: number[];
  /** Bearer token for OpenRouter rerank; pass only if rerank=true. */
  openrouterApiKey?: string;
  /** Reranker model id (e.g. "cohere/rerank-3.5"). Required only when rerank=true. */
  rerankerModel?: string;
  /** Sent as HTTP-Referer to OpenRouter; falls back to a generic id. */
  appUrl?: string;
};

/**
 * Hybrid search against the `hybrid_search` Postgres RPC, hydrated with
 * document metadata, with optional Cohere/OpenRouter rerank.
 *
 * The caller is responsible for:
 *   - Authentication and admin/space-access resolution → `accessibleSpaceIds`
 *   - Picking the embedding model and producing `queryEmbedding`
 *   - Picking the reranker model + deciding whether reranking is enabled
 *
 * This function never throws on rerank failure — it falls back to RRF order.
 */
export async function searchCore(
  supabase: SupabaseClient,
  query: string,
  opts: SearchCoreOptions,
): Promise<SearchHit[]> {
  if (opts.accessibleSpaceIds.length === 0) return [];

  const scope =
    opts.scopeSpaceIds && opts.scopeSpaceIds.length
      ? opts.accessibleSpaceIds.filter((id) => opts.scopeSpaceIds!.includes(id))
      : opts.accessibleSpaceIds;
  if (scope.length === 0) return [];

  const { data: rows, error } = await supabase.rpc("hybrid_search", {
    query_text: query,
    query_embedding: toVectorLiteral(opts.queryEmbedding),
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
    const spaceId = (d?.space_id as string) ?? "";
    return {
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentTitle: (d?.title as string) ?? "(untitled)",
      documentPath: (d?.path as string) ?? "",
      spaceId,
      spaceName: opts.spaceNamesById?.get(spaceId) ?? "",
      headingPath: r.heading_path ?? [],
      content: r.content,
      score: r.score,
    };
  });

  if (
    opts.rerank &&
    opts.openrouterApiKey &&
    opts.rerankerModel &&
    hits.length > 1
  ) {
    hits = await rerank(query, hits, {
      apiKey: opts.openrouterApiKey,
      model: opts.rerankerModel,
      appUrl: opts.appUrl ?? "http://localhost",
    });
  }

  return hits;
}

async function rerank(
  query: string,
  hits: SearchHit[],
  cfg: { apiKey: string; model: string; appUrl: string },
): Promise<SearchHit[]> {
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": cfg.appUrl,
        "X-Title": "Knowledge Hub",
      },
      body: JSON.stringify({
        model: cfg.model,
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
