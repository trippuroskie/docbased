// get_chunk + get_chunk_neighbors — chunk-level reads, mainly used after
// search_documents to expand context around a hit.

import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { getChunk, getChunkNeighbors } from "@core/docs";
import { audit, getContext } from "../context.js";
import { capResponse } from "../util.js";

export function register(server: FastMCP) {
  server.addTool({
    name: "get_chunk",
    description:
      "Fetch a single chunk by id. Returns the chunk's text plus its heading path and the parent document title. Use to read a search hit in full.",
    parameters: z.object({
      chunk_id: z.string().uuid(),
    }),
    execute: async (args) => {
      const ctx = await getContext();
      const c = await getChunk(ctx.caller.serviceClient, args.chunk_id, {
        accessibleSpaceIds: ctx.caller.accessibleSpaceIds,
      });
      if (!c) return `Chunk not found (or not accessible): ${args.chunk_id}`;
      await audit(ctx, "read", "chunk", c.id, {
        document_id: c.documentId,
        ordinal: c.ordinal,
      });
      const header = [
        `# ${c.documentTitle} — chunk #${c.ordinal}`,
        c.headingPath.length ? `heading: ${c.headingPath.join(" → ")}` : "",
        `document_id: ${c.documentId}  ·  chunk_id: ${c.id}`,
        "",
      ]
        .filter(Boolean)
        .join("\n");
      return capResponse(`${header}\n${c.content}`);
    },
  });

  server.addTool({
    name: "get_chunk_neighbors",
    description:
      "Fetch the chunks immediately surrounding a target chunk inside the same document. Use to expand context around a search hit when one chunk isn't enough.",
    parameters: z.object({
      chunk_id: z.string().uuid(),
      window: z
        .number()
        .int()
        .min(0)
        .max(5)
        .default(1)
        .describe("How many chunks to fetch on each side (0-5, default 1)."),
    }),
    execute: async (args) => {
      const ctx = await getContext();
      const chunks = await getChunkNeighbors(
        ctx.caller.serviceClient,
        args.chunk_id,
        {
          window: args.window,
          accessibleSpaceIds: ctx.caller.accessibleSpaceIds,
        },
      );
      await audit(ctx, "read", "chunk", args.chunk_id, {
        window: args.window,
        returned: chunks.length,
      });
      if (chunks.length === 0) {
        return `No neighbors found for chunk ${args.chunk_id}.`;
      }
      const out: string[] = [];
      for (const c of chunks) {
        out.push(`### chunk #${c.ordinal} (id: ${c.id})`);
        if (c.headingPath.length) {
          out.push(`heading: ${c.headingPath.join(" → ")}`);
        }
        out.push("");
        out.push(c.content);
        out.push("");
      }
      return capResponse(out.join("\n"));
    },
  });
}
