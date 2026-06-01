import OpenAI from "openai";
import { env } from "@/lib/env";

// Lazy singleton. The OpenAI SDK throws if apiKey is missing at construction
// time, so we defer instantiation until the first request — keeps `next build`
// happy when env vars haven't been set on the build host.
let _client: OpenAI | null = null;
export function openrouter(): OpenAI {
  if (_client) return _client;
  if (!env.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  _client = new OpenAI({
    apiKey: env.openrouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": env.appUrl,
      "X-Title": "docbased",
    },
  });
  return _client;
}

export async function embed(
  texts: string[],
  opts: { model?: string } = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const resp = await openrouter().embeddings.create({
    model: opts.model ?? env.embeddingModel,
    input: texts,
  });
  return resp.data.map((d) => d.embedding as number[]);
}

export async function embedOne(
  text: string,
  opts: { model?: string } = {},
): Promise<number[]> {
  const [v] = await embed([text], opts);
  return v;
}
