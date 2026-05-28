// Web-app entry point for search. Resolves the caller's session, model
// preferences, and accessible spaces, then delegates to the pure core.

import { createServiceClient } from "@/lib/supabase/server";
import { getAccessibleSpaces, getSession } from "@/lib/auth";
import { embedOne } from "@/lib/ai/openrouter";
import { env } from "@/lib/env";
import {
  effectiveEmbeddingModel,
  effectiveRerankerModel,
  getUserSettings,
} from "@/lib/settings";
import { searchCore, type SearchHit } from "@/lib/core/search";

export type { SearchHit };

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
  const spaceNamesById = new Map(accessible.map((s) => [s.id, s.name]));

  // Resolve the caller's preferred embedding + reranker models. Embedding
  // model must produce 1536-dim vectors to match the index — we trust the
  // user's saved pick; mismatches surface as visible failures rather than
  // silently degraded results.
  const user = await getSession();
  const settings = user
    ? await getUserSettings(user.id)
    : {
        chatModels: [],
        defaultChatModel: null,
        embeddingModel: null,
        rerankerModel: null,
      };
  const embeddingModel = effectiveEmbeddingModel(settings);
  const rerankerModel = effectiveRerankerModel(settings);

  const queryEmbedding = await embedOne(query, { model: embeddingModel });

  return searchCore(createServiceClient(), query, {
    accessibleSpaceIds: accessibleIds,
    spaceNamesById,
    scopeSpaceIds: opts.spaceIds,
    limit: opts.limit,
    rerank: opts.rerank && env.rerankerEnabled,
    queryEmbedding,
    openrouterApiKey: env.openrouterApiKey,
    rerankerModel,
    appUrl: env.appUrl,
  });
}

export { embedOne };
