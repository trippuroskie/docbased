// Resources let MCP clients (Claude Desktop, Cursor) expose docbased
// content as @-mentionable items without forcing a tool call. We expose:
//
//   docbased://space/{slug}     → table of contents for one space
//   docbased://document/{id}    → full body of one document
//
// Both are read-only; access control mirrors the tools' (the caller's
// accessibleSpaceIds resolved at server start).

import type { FastMCP } from "fastmcp";
import { getDocument, listDocuments, listSpaces } from "@core/docs";
import { audit, getContext } from "../context.js";
import { capResponse, isoOrEmpty } from "../util.js";

export function register(server: FastMCP) {
  server.addResourceTemplate({
    uriTemplate: "docbased://space/{slug}",
    name: "Space — document index",
    description:
      "Browse a single docbased space: list of documents with title, path, and last-edited timestamp.",
    mimeType: "text/markdown",
    arguments: [
      {
        name: "slug",
        description: "Space slug (e.g. 'it', 'ecomm').",
        required: true,
      },
    ],
    load: async ({ slug }) => {
      const ctx = await getContext();
      const spaces = await listSpaces(ctx.caller.serviceClient, {
        accessibleSpaceIds: ctx.caller.accessibleSpaceIds,
      });
      const space = spaces.find((s) => s.slug === slug);
      if (!space) {
        return { text: `No accessible space with slug '${slug}'.` };
      }
      // Pull up to 200 documents — anything bigger spills past sensible
      // resource sizes anyway, and a focused search is the right next move.
      const docs = await listDocuments(ctx.caller.serviceClient, {
        spaceId: space.id,
        accessibleSpaceIds: ctx.caller.accessibleSpaceIds,
        limit: 100,
      });
      await audit(ctx, "list", "document", null, {
        via: "resource:space",
        space_slug: slug,
        returned: docs.items.length,
      });
      const lines: string[] = [];
      lines.push(`# ${space.name}`);
      if (space.description) lines.push(space.description);
      lines.push("");
      lines.push(`${docs.items.length} documents${docs.nextCursor ? " (truncated)" : ""}:`);
      lines.push("");
      for (const d of docs.items) {
        const flag = d.status === "metadata_only" ? " [binary]" : "";
        lines.push(
          `- **${d.title}**${flag} — \`${d.path}\` · edited ${isoOrEmpty(d.lastEditedAt)} · id \`${d.id}\``,
        );
      }
      if (docs.nextCursor) {
        lines.push("");
        lines.push(
          `_More documents available — use the list_documents tool with cursor="${docs.nextCursor}"._`,
        );
      }
      return { text: capResponse(lines.join("\n")) };
    },
  });

  server.addResourceTemplate({
    uriTemplate: "docbased://document/{id}",
    name: "Document — full body",
    description: "Full markdown body and metadata for a single document.",
    mimeType: "text/markdown",
    arguments: [
      {
        name: "id",
        description: "Document UUID.",
        required: true,
      },
    ],
    load: async ({ id }) => {
      const ctx = await getContext();
      const doc = await getDocument(
        ctx.caller.serviceClient,
        { id },
        { accessibleSpaceIds: ctx.caller.accessibleSpaceIds },
      );
      if (!doc) {
        return { text: `Document not found or not accessible: ${id}` };
      }
      await audit(ctx, "read", "document", doc.id, {
        via: "resource:document",
        path: doc.path,
        status: doc.status,
      });
      const space = ctx.caller.spaceNamesById.get(doc.spaceId) ?? "?";
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
      return { text: capResponse(`${header}\n${body}`) };
    },
  });
}
