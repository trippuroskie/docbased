// save_document — create a new markdown document in a space. The doc is
// marked as agent-authored (frontmatter `agent_authored: true` + the
// `agent-authored` tag) so it can be filtered out later if desired.

import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { listSpaces } from "@core/docs";
import { createDocument } from "@core/save";
import { audit, getContext } from "../context.js";
import { uuidLike } from "../util.js";

const InputSchema = z.object({
  space: z
    .string()
    .min(1)
    .describe(
      "Space slug (e.g. 'it') or UUID. Must be a space the caller has access to.",
    ),
  title: z
    .string()
    .min(1)
    .describe("Document title — used as h1, in frontmatter, and as the default path slug."),
  content: z
    .string()
    .min(1)
    .describe(
      "Markdown body. Pass plain markdown — do NOT include a `---` frontmatter block; structured metadata (title, tags, path) goes via the other parameters and any leading frontmatter is stripped.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Optional path inside the space (slash-separated, no extension). Defaults to a slug of the title. Use a folder prefix like 'From Agent/2026-05-28-summary' to organize.",
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Extra tags. 'agent-authored' is always added, so you don't need to include it.",
    ),
  conflict: z
    .enum(["replace", "skip", "version"])
    .optional()
    .describe(
      "What to do if (space, path) already exists. Default 'version' (safe — never destroys existing content; creates path-v2, path-v3, etc). 'skip' returns the existing doc unchanged. 'replace' overwrites.",
    ),
  agent_name: z
    .string()
    .optional()
    .describe(
      "Identifier of the agent (e.g. your model ID). Recorded in frontmatter as `agent_name`. Default: 'mcp'.",
    ),
});

export function register(server: FastMCP) {
  server.addTool({
    name: "save_document",
    description:
      "Save a new markdown document into a docbased space. Tagged as agent-authored (filterable later). Use this when capturing research notes, summaries, or generated content for future retrieval via search_documents.",
    parameters: InputSchema,
    execute: async (args) => {
      const ctx = await getContext();
      const { caller } = ctx;

      // Resolve space (slug or UUID).
      let spaceId: string;
      let spaceLabel: string;
      if (uuidLike(args.space)) {
        if (!caller.accessibleSpaceIds.includes(args.space)) {
          return `No access to space '${args.space}'.`;
        }
        spaceId = args.space;
        spaceLabel = caller.spaceNamesById.get(args.space) ?? args.space;
      } else {
        const spaces = await listSpaces(caller.serviceClient, {
          accessibleSpaceIds: caller.accessibleSpaceIds,
        });
        const match = spaces.find((s) => s.slug === args.space);
        if (!match) return `No accessible space with slug '${args.space}'.`;
        spaceId = match.id;
        spaceLabel = match.name;
      }

      // Uploader id: signed-in user in user mode; in service mode, fall back
      // to the first admin so the row's uploaded_by FK resolves. Agent
      // authorship is captured separately via frontmatter + tag.
      const uploaderId = await resolveUploaderId(caller);

      const result = await createDocument(caller.serviceClient, {
        spaceId,
        uploaderId,
        title: args.title,
        content: args.content,
        path: args.path,
        tags: args.tags,
        conflict: args.conflict ?? "version",
        markAsAgent: true,
        agentName: args.agent_name ?? "mcp",
        source: "mcp",
        embedding: {
          apiKey: ctx.openrouterApiKey,
          model: ctx.embeddingModel,
          appUrl: ctx.appUrl,
        },
      });

      await audit(ctx, "save_document", "document", result.documentId, {
        space: spaceLabel,
        path: result.path,
        status: result.status,
        chunks: result.chunkCount,
      });

      const lines = [
        `Saved: ${result.path} (${result.status})`,
        `document_id: ${result.documentId}`,
        result.chunkCount ? `chunks: ${result.chunkCount}` : "",
        `space: ${spaceLabel}`,
        "tagged: agent-authored",
      ].filter(Boolean);
      return lines.join("\n");
    },
  });
}

async function resolveUploaderId(
  caller: Awaited<ReturnType<typeof getContext>>["caller"],
): Promise<string> {
  if (caller.userId) return caller.userId;
  const { data, error } = await caller.serviceClient
    .from("users")
    .select("id")
    .eq("is_admin", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`admin lookup failed: ${error.message}`);
  if (!data) {
    throw new Error(
      "no admin user found — cannot record uploaded_by. Run docbased-mcp in user mode (DOCBASED_EMAIL + DOCBASED_PASSWORD).",
    );
  }
  return (data as { id: string }).id;
}
