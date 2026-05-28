// Portable OpenRouter embedding. No process.env reads — caller passes
// credentials explicitly so this is usable from the CLI and from the
// standalone docbased-mcp package without dragging in @/lib/env.

import OpenAI from "openai";

export type EmbedConfig = {
  apiKey: string;
  model: string;
  /** Sent as HTTP-Referer to OpenRouter. Defaults to a generic identifier. */
  appUrl?: string;
  /** Override for tests / non-OpenRouter providers. */
  baseUrl?: string;
};

export async function embed(
  cfg: EmbedConfig,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl ?? "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": cfg.appUrl ?? "https://docbased.local",
      "X-Title": "docbased",
    },
  });
  const resp = await client.embeddings.create({
    model: cfg.model,
    input: texts,
  });
  return resp.data.map((d) => d.embedding as number[]);
}

export async function embedOne(
  cfg: EmbedConfig,
  text: string,
): Promise<number[]> {
  const [v] = await embed(cfg, [text]);
  return v;
}
