// list_documents — inventory by space, with opaque cursor pagination.

import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { listDocuments, listSpaces } from "@core/docs";
import { audit, getContext } from "../context.js";
import { capResponse, isoOrEmpty, paginationHint } from "../util.js";

const InputSchema = z.object({
  space_slug: z
    .string()
    .optional()
    .describe("Restrict to a single space. Omit to list across every accessible space."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Number of documents to return (default 25, max 100)."),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous call. Pass to fetch the next page in the same sort order.",
    ),
});

export function register(server: FastMCP) {
  server.addTool({
    name: "list_documents",
    description:
      "List documents in the knowledge base, ordered by most-recently-edited first. Use for inventory questions ('what docs exist about X?', 'show me the latest IT docs'). For substantive content, use search_documents instead.",
    parameters: InputSchema,
    execute: async (args) => {
      const ctx = await getContext();
      const { caller } = ctx;

      let spaceId: string | undefined;
      if (args.space_slug) {
        const spaces = await listSpaces(caller.serviceClient, {
          accessibleSpaceIds: caller.accessibleSpaceIds,
        });
        const match = spaces.find((s) => s.slug === args.space_slug);
        if (!match) {
          return `No accessible space with slug '${args.space_slug}'.`;
        }
        spaceId = match.id;
      }

      const result = await listDocuments(caller.serviceClient, {
        spaceId,
        accessibleSpaceIds: caller.accessibleSpaceIds,
        limit: args.limit,
        cursor: args.cursor,
      });

      await audit(ctx, "list", "document", null, {
        space_slug: args.space_slug ?? null,
        limit: args.limit,
        returned: result.items.length,
        has_more: result.nextCursor !== null,
      });

      if (result.items.length === 0) {
        return "No documents found.";
      }

      const lines: string[] = [];
      lines.push(`Documents (${result.items.length}):`);
      lines.push("");
      for (const d of result.items) {
        const space = caller.spaceNamesById.get(d.spaceId) ?? "?";
        const flag = d.status === "metadata_only" ? " [unindexed binary]" : "";
        lines.push(`- **${d.title}**${flag}`);
        lines.push(
          `    space: ${space} · path: ${d.path} · edited: ${isoOrEmpty(d.lastEditedAt)}`,
        );
        lines.push(`    document_id: ${d.id}`);
      }

      const hint = paginationHint(result.nextCursor, "list_documents");
      return capResponse(lines.join("\n") + hint);
    },
  });
}
