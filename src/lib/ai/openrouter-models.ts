import { env } from "@/lib/env";

// Trimmed shape of the OpenRouter /models payload. Their full response has 20+
// fields per model — we keep only what the picker needs so the client bundle
// stays small. Provider is derived from the id prefix (`anthropic/...`).
export type OpenRouterModel = {
  id: string;
  name: string;
  provider: string;
  description: string | null;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  pricing: {
    prompt: string | null;
    completion: string | null;
  };
};

type RawModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string };
};

let cache: { models: OpenRouterModel[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — model list rarely changes

export async function listOpenRouterModels(opts: {
  forceRefresh?: boolean;
} = {}): Promise<OpenRouterModel[]> {
  if (
    !opts.forceRefresh &&
    cache &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.models;
  }

  const headers: Record<string, string> = {
    "HTTP-Referer": env.appUrl,
    "X-Title": "docbased",
  };
  // The /models endpoint is public, but sending the key gives access to any
  // org-private models the workspace has access to.
  if (env.openrouterApiKey) {
    headers.Authorization = `Bearer ${env.openrouterApiKey}`;
  }

  const resp = await fetch("https://openrouter.ai/api/v1/models", {
    headers,
    // Cache at the fetch layer too — Next will dedupe identical requests on
    // the server during a single render tree.
    next: { revalidate: 3600 },
  });
  if (!resp.ok) {
    throw new Error(`OpenRouter models fetch failed: ${resp.status}`);
  }
  const json = (await resp.json()) as { data: RawModel[] };

  const models: OpenRouterModel[] = (json.data ?? []).map((m) => {
    const slash = m.id.indexOf("/");
    const provider = slash >= 0 ? m.id.slice(0, slash) : "unknown";
    return {
      id: m.id,
      name: m.name ?? m.id,
      provider,
      description: m.description ?? null,
      contextLength: m.context_length ?? null,
      inputModalities: m.architecture?.input_modalities ?? [],
      outputModalities: m.architecture?.output_modalities ?? [],
      supportedParameters: m.supported_parameters ?? [],
      pricing: {
        prompt: m.pricing?.prompt ?? null,
        completion: m.pricing?.completion ?? null,
      },
    };
  });

  cache = { models, fetchedAt: Date.now() };
  return models;
}

// Heuristic classifiers. OpenRouter doesn't categorize models, so we tag them
// by id/name/supported_parameters signatures. Embeddings/rerankers don't
// appear under /models (different endpoint family on OpenRouter), so we keep
// a hand-maintained shortlist as a fallback.
export function isLikelyEmbeddingModel(m: OpenRouterModel): boolean {
  const idLow = m.id.toLowerCase();
  return (
    idLow.includes("embed") ||
    idLow.includes("/text-embedding") ||
    idLow.endsWith("-embed")
  );
}

export function isLikelyRerankerModel(m: OpenRouterModel): boolean {
  const idLow = m.id.toLowerCase();
  return idLow.includes("rerank");
}

// Known embedding models on OpenRouter (the /models endpoint is chat-focused,
// so users can't always discover these through the picker). Keep dim-aware:
// only 1536-dim models are safe to swap in without re-embedding the corpus.
export const EMBEDDING_MODEL_OPTIONS: Array<{
  id: string;
  name: string;
  dimensions: number;
  provider: string;
}> = [
  {
    id: "openai/text-embedding-3-small",
    name: "OpenAI text-embedding-3-small",
    dimensions: 1536,
    provider: "openai",
  },
  {
    id: "openai/text-embedding-3-large",
    name: "OpenAI text-embedding-3-large",
    dimensions: 3072,
    provider: "openai",
  },
  {
    id: "openai/text-embedding-ada-002",
    name: "OpenAI text-embedding-ada-002",
    dimensions: 1536,
    provider: "openai",
  },
];

export const RERANKER_MODEL_OPTIONS: Array<{
  id: string;
  name: string;
  provider: string;
}> = [
  { id: "cohere/rerank-3.5", name: "Cohere Rerank 3.5", provider: "cohere" },
  {
    id: "cohere/rerank-english-v3.0",
    name: "Cohere Rerank English v3.0",
    provider: "cohere",
  },
  {
    id: "cohere/rerank-multilingual-v3.0",
    name: "Cohere Rerank Multilingual v3.0",
    provider: "cohere",
  },
];
