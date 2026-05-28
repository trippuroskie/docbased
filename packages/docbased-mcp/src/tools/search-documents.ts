// search_documents — hybrid pgvector + FTS search, optionally reranked.

import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { searchCore } from "@core/search";
import { listSpaces } from "@core/docs";
import { embedOne } from "@core/embed";
import { audit, getContext } from "../context.js";
import { capResponse, truncate } from "../util.js";

const InputSchema = z.object({
  query: z.string().min(1).describe("Natural-language search query."),
  space_slug: z
    .string()
    .optional()
    .describe(
      "Restrict to a single space (e.g. 'it', 'ecomm'). Omit to search all accessible spaces.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe("Maximum number of chunks to return (default 8, max 20)."),
  rerank: z
    .boolean()
    .default(true)
    .describe("Rerank top hits with Cohere; falls back to RRF on failure."),
});

export function register(server: FastMCP) {
  server.addTool({
    name: "search_documents",
    description:
      "Hybrid semantic + keyword search across the knowledge base. Returns the most relevant chunks of text from the user's accessible spaces, each with its document title, path, space, chunk id, and a content preview. Use this for substantive content questions; use list_documents/get_document for inventory or full-text needs.",
    parameters: InputSchema,
    execute: async (args) => {
      const ctx = await getContext();
      const { caller } = ctx;

      let scopeSpaceIds: string[] | undefined;
      if (args.space_slug) {
        const spaces = await listSpaces(caller.serviceClient, {
          accessibleSpaceIds: caller.accessibleSpaceIds,
        });
        const match = spaces.find((s) => s.slug === args.space_slug);
        if (!match) {
          return `No accessible space with slug '${args.space_slug}'. Call list_spaces to see available slugs.`;
        }
        scopeSpaceIds = [match.id];
      }

      const queryEmbedding = await embedOne(
        {
          apiKey: ctx.openrouterApiKey,
          model: ctx.embeddingModel,
          appUrl: ctx.appUrl,
        },
        args.query,
      );

      const hits = await searchCore(caller.serviceClient, args.query, {
        accessibleSpaceIds: caller.accessibleSpaceIds,
        spaceNamesById: caller.spaceNamesById,
        scopeSpaceIds,
        limit: args.limit,
        rerank: args.rerank,
        queryEmbedding,
        openrouterApiKey: ctx.openrouterApiKey,
        rerankerModel: ctx.rerankerModel,
        appUrl: ctx.appUrl,
      });

      await audit(ctx, "search", "query", null, {
        query: args.query,
        limit: args.limit,
        rerank: args.rerank,
        space_slug: args.space_slug ?? null,
        hits: hits.length,
      });

      if (hits.length === 0) {
        return `No matches for "${args.query}".`;
      }

      const lines: string[] = [];
      lines.push(`Found ${hits.length} chunks for "${args.query}":`);
      lines.push("");
      hits.forEach((h, i) => {
        const heading = h.headingPath.length
          ? ` (${h.headingPath.join(" → ")})`
          : "";
        const { text, truncated } = truncate(h.content);
        lines.push(`### [${i + 1}] ${h.documentTitle}${heading}`);
        lines.push(
          `space: ${h.spaceName}  ·  path: ${h.documentPath}  ·  score: ${h.score.toFixed(3)}`,
        );
        lines.push(`document_id: ${h.documentId}  ·  chunk_id: ${h.chunkId}`);
        lines.push("");
        lines.push(text);
        if (truncated) {
          lines.push("");
          lines.push(
            `_(chunk truncated — call get_chunk("${h.chunkId}") or get_document("${h.documentId}") for the full text)_`,
          );
        }
        lines.push("");
      });

      return capResponse(lines.join("\n"));
    },
  });
}
