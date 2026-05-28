// get_document — full document body by id or space-slug/path.

import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { getDocument, listSpaces } from "@core/docs";
import { audit, getContext } from "../context.js";
import { capResponse, uuidLike } from "../util.js";

const InputSchema = z.object({
  ref: z
    .string()
    .min(1)
    .describe(
      "Document UUID, or a `space-slug/path` pair (e.g. 'it/Sisense to Power BI Migration Guide').",
    ),
});

export function register(server: FastMCP) {
  server.addTool({
    name: "get_document",
    description:
      "Fetch the full body of a single document by id or by space-slug/path. Returns title, metadata, tags, and the raw markdown content. Pair with search_documents (use the document_id from a hit).",
    parameters: InputSchema,
    execute: async (args) => {
      const ctx = await getContext();
      const { caller } = ctx;

      let doc;
      if (uuidLike(args.ref)) {
        doc = await getDocument(
          caller.serviceClient,
          { id: args.ref },
          { accessibleSpaceIds: caller.accessibleSpaceIds },
        );
      } else {
        const [slug, ...rest] = args.ref.split("/");
        const path = rest.join("/");
        if (!slug || !path) {
          return "ref must be a UUID or 'space-slug/path'.";
        }
        const space = (
          await listSpaces(caller.serviceClient, {
            accessibleSpaceIds: caller.accessibleSpaceIds,
          })
        ).find((s) => s.slug === slug);
        if (!space) {
          return `No accessible space with slug '${slug}'.`;
        }
        doc = await getDocument(
          caller.serviceClient,
          { spaceId: space.id, path },
          { accessibleSpaceIds: caller.accessibleSpaceIds },
        );
      }
      if (!doc) {
        return `Document not found (or not accessible): ${args.ref}`;
      }

      await audit(ctx, "read", "document", doc.id, {
        path: doc.path,
        status: doc.status,
      });

      const space = caller.spaceNamesById.get(doc.spaceId) ?? "?";
      const header = [
        `# ${doc.title}`,
        `space: ${space}  ·  path: ${doc.path}  ·  status: ${doc.status}`,
        doc.tags.length ? `tags: ${doc.tags.join(", ")}` : "",
        `document_id: ${doc.id}`,
        "",
      ]
        .filter(Boolean)
        .join("\n");

      const body =
        doc.status === "metadata_only"
          ? "_(binary document; only metadata is indexed)_"
          : doc.rawContent ?? "_(no content)_";

      return capResponse(`${header}\n${body}`);
    },
  });
}
