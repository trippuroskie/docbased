// Shared MCP tool definitions — the single source of truth for the docbased
// tool surface. Both shells consume these:
//   • the standalone stdio server  (packages/docbased-mcp, FastMCP)
//   • the remote /mcp route          (src/app/mcp, EdgeFastMCP on Vercel)
//
// Each tool is framework-neutral: it receives an McpCtx (the resolved caller +
// model config) and returns a model-facing string. Auditing is built in. This
// module must NOT import env.ts or any Next-only code — the standalone package
// bundles it too, and gets its config from process.env instead.

import { z } from "zod";

import type { ResolvedCaller } from "./auth";
import { writeAuditLog } from "./audit";
import {
  getChunk,
  getChunkNeighbors,
  getDocument,
  listDocuments,
  listSpaces,
} from "./docs";
import { embedOne } from "./embed";
import { createDocument } from "./save";
import { searchCore } from "./search";
import {
  capResponse,
  isoOrEmpty,
  paginationHint,
  truncate,
  uuidLike,
} from "./format";

/** Everything a tool body needs: who's calling + which models/keys to use. */
export type McpCtx = {
  caller: ResolvedCaller;
  openrouterApiKey: string;
  embeddingModel: string;
  rerankerModel: string;
  appUrl: string;
};

export type McpToolDef = {
  name: string;
  description: string;
  parameters: z.ZodType;
  run: (ctx: McpCtx, args: unknown) => Promise<string>;
};

/** Strongly-typed tool builder; erases the schema generic for the registry. */
function defineTool<S extends z.ZodTypeAny>(def: {
  name: string;
  description: string;
  parameters: S;
  run: (ctx: McpCtx, args: z.infer<S>) => Promise<string>;
}): McpToolDef {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    run: (ctx, raw) => def.run(ctx, def.parameters.parse(raw)),
  };
}

function audit(
  ctx: McpCtx,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return writeAuditLog(ctx.caller.serviceClient, {
    actorId: ctx.caller.userId,
    action,
    targetType,
    targetId,
    source: "mcp",
    metadata: { ...metadata, mode: ctx.caller.mode },
  });
}

async function embedQuery(ctx: McpCtx, text: string): Promise<number[]> {
  return embedOne(
    { apiKey: ctx.openrouterApiKey, model: ctx.embeddingModel, appUrl: ctx.appUrl },
    text,
  );
}

// ───────────────────────────── tools ─────────────────────────────

const listSpacesTool = defineTool({
  name: "list_spaces",
  description:
    "List spaces (knowledge bases) the current user can access. Each space has a stable `slug` you can pass as `space_slug` to other tools.",
  parameters: z.object({}),
  run: async (ctx) => {
    const spaces = await listSpaces(ctx.caller.serviceClient, {
      accessibleSpaceIds: ctx.caller.accessibleSpaceIds,
    });
    if (spaces.length === 0) return "No accessible spaces.";
    const lines = [`Accessible spaces (${spaces.length}):`, ""];
    for (const s of spaces) {
      lines.push(`- **${s.name}** (slug: \`${s.slug}\`)`);
      if (s.description) lines.push(`    ${s.description}`);
    }
    return lines.join("\n");
  },
});

const searchTool = defineTool({
  name: "search_documents",
  description:
    "Hybrid semantic + keyword search across the knowledge base. Returns the most relevant chunks of text from the user's accessible spaces, each with its document title, path, space, chunk id, and a content preview. Use this for substantive content questions; use list_documents/get_document for inventory or full-text needs.",
  parameters: z.object({
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
  }),
  run: async (ctx, args) => {
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

    const queryEmbedding = await embedQuery(ctx, args.query);
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

    if (hits.length === 0) return `No matches for "${args.query}".`;

    const lines: string[] = [];
    lines.push(`Found ${hits.length} chunks for "${args.query}":`, "");
    hits.forEach((h, i) => {
      const heading = h.headingPath.length
        ? ` (${h.headingPath.join(" → ")})`
        : "";
      const { text, truncated } = truncate(h.content);
      lines.push(`### [${i + 1}] ${h.documentTitle}${heading}`);
      lines.push(
        `space: ${h.spaceName}  ·  path: ${h.documentPath}  ·  score: ${h.score.toFixed(3)}`,
      );
      lines.push(`document_id: ${h.documentId}  ·  chunk_id: ${h.chunkId}`, "");
      lines.push(text);
      if (truncated) {
        lines.push(
          "",
          `_(chunk truncated — call get_chunk("${h.chunkId}") or get_document("${h.documentId}") for the full text)_`,
        );
      }
      lines.push("");
    });
    return capResponse(lines.join("\n"));
  },
});

const listDocumentsTool = defineTool({
  name: "list_documents",
  description:
    "List documents in the knowledge base, ordered by most-recently-edited first. Use for inventory questions ('what docs exist about X?', 'show me the latest IT docs'). For substantive content, use search_documents instead.",
  parameters: z.object({
    space_slug: z
      .string()
      .optional()
      .describe(
        "Restrict to a single space. Omit to list across every accessible space.",
      ),
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
  }),
  run: async (ctx, args) => {
    const { caller } = ctx;
    let spaceId: string | undefined;
    if (args.space_slug) {
      const spaces = await listSpaces(caller.serviceClient, {
        accessibleSpaceIds: caller.accessibleSpaceIds,
      });
      const match = spaces.find((s) => s.slug === args.space_slug);
      if (!match) return `No accessible space with slug '${args.space_slug}'.`;
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

    if (result.items.length === 0) return "No documents found.";

    const lines: string[] = [`Documents (${result.items.length}):`, ""];
    for (const d of result.items) {
      const space = caller.spaceNamesById.get(d.spaceId) ?? "?";
      const flag = d.status === "metadata_only" ? " [unindexed binary]" : "";
      lines.push(`- **${d.title}**${flag}`);
      lines.push(
        `    space: ${space} · path: ${d.path} · edited: ${isoOrEmpty(d.lastEditedAt)}`,
      );
      lines.push(`    document_id: ${d.id}`);
    }
    return capResponse(
      lines.join("\n") + paginationHint(result.nextCursor, "list_documents"),
    );
  },
});

const getDocumentTool = defineTool({
  name: "get_document",
  description:
    "Fetch the full body of a single document by id or by space-slug/path. Returns title, metadata, tags, and the raw markdown content. Pair with search_documents (use the document_id from a hit).",
  parameters: z.object({
    ref: z
      .string()
      .min(1)
      .describe(
        "Document UUID, or a `space-slug/path` pair (e.g. 'it/Sisense to Power BI Migration Guide').",
      ),
  }),
  run: async (ctx, args) => {
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
      if (!slug || !path) return "ref must be a UUID or 'space-slug/path'.";
      const space = (
        await listSpaces(caller.serviceClient, {
          accessibleSpaceIds: caller.accessibleSpaceIds,
        })
      ).find((s) => s.slug === slug);
      if (!space) return `No accessible space with slug '${slug}'.`;
      doc = await getDocument(
        caller.serviceClient,
        { spaceId: space.id, path },
        { accessibleSpaceIds: caller.accessibleSpaceIds },
      );
    }
    if (!doc) return `Document not found (or not accessible): ${args.ref}`;

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

const getChunkTool = defineTool({
  name: "get_chunk",
  description:
    "Fetch a single chunk by id. Returns the chunk's text plus its heading path and the parent document title. Use to read a search hit in full.",
  parameters: z.object({ chunk_id: z.string().uuid() }),
  run: async (ctx, args) => {
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

const getChunkNeighborsTool = defineTool({
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
  run: async (ctx, args) => {
    const chunks = await getChunkNeighbors(
      ctx.caller.serviceClient,
      args.chunk_id,
      { window: args.window, accessibleSpaceIds: ctx.caller.accessibleSpaceIds },
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
      if (c.headingPath.length) out.push(`heading: ${c.headingPath.join(" → ")}`);
      out.push("", c.content, "");
    }
    return capResponse(out.join("\n"));
  },
});

const saveDocumentTool = defineTool({
  name: "save_document",
  description:
    "Save a new markdown document into a docbased space. Tagged as agent-authored (filterable later). Use this when capturing research notes, summaries, or generated content for future retrieval via search_documents.",
  parameters: z.object({
    space: z
      .string()
      .min(1)
      .describe(
        "Space slug (e.g. 'it') or UUID. Must be a space the caller has access to.",
      ),
    title: z
      .string()
      .min(1)
      .describe(
        "Document title — used as h1, in frontmatter, and as the default path slug.",
      ),
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
  }),
  run: async (ctx, args) => {
    const { caller } = ctx;

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

    return [
      `Saved: ${result.path} (${result.status})`,
      `document_id: ${result.documentId}`,
      result.chunkCount ? `chunks: ${result.chunkCount}` : "",
      `space: ${spaceLabel}`,
      "tagged: agent-authored",
    ]
      .filter(Boolean)
      .join("\n");
  },
});

/**
 * Uploader id for save_document: the signed-in user, else (service mode) the
 * first admin so the uploaded_by FK resolves. Agent authorship is captured
 * separately via frontmatter + tag.
 */
async function resolveUploaderId(caller: ResolvedCaller): Promise<string> {
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
      "no admin user found — cannot record uploaded_by. Run in user mode (a token or DOCBASED_EMAIL/PASSWORD).",
    );
  }
  return (data as { id: string }).id;
}

/** The full docbased tool surface, in registration order. */
export const mcpToolDefs: McpToolDef[] = [
  searchTool,
  listSpacesTool,
  listDocumentsTool,
  getDocumentTool,
  getChunkTool,
  getChunkNeighborsTool,
  saveDocumentTool,
];
