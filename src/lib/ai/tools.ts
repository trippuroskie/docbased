// Typed tools the chat LLM can call to inspect the knowledge base.
//
// Every tool internally enforces that results are scoped to the spaces the
// user can access (passed in via ctx.accessibleSpaceIds). The model never
// sees space IDs it shouldn't have — even if it asks for one explicitly,
// we drop unauthorized IDs before querying.

import type OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase/server";
import { search as semanticSearch } from "@/lib/search";

export type ToolContext = {
  userId: string;
  accessibleSpaceIds: string[];
  /** id -> name */
  spaceNameById: Map<string, string>;
  /**
   * Full metadata for the spaces in `accessibleSpaceIds`, used to resolve a
   * model-supplied `space_id` that may be a name or slug rather than a UUID
   * (the model never sees raw UUIDs — see resolveScope).
   */
  spaces: Array<{ id: string; name: string; slug: string }>;
};

export type ToolResult =
  | { ok: true; data: unknown; summary: string }
  | { ok: false; error: string };

// ---------- Tool specs (sent to the model) ----------

export const TOOL_SPECS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_documents",
      description:
        "List documents in the user's accessible workspaces. Use for inventory questions like 'what documents exist?' or 'show me docs in IT'. Returns title, path, workspace, tags, and last-edited timestamp. Does NOT return document bodies — use search_documents or get_document for content.",
      parameters: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description:
              "Optional workspace to restrict to — pass its name or slug (e.g. \"Ecomm\" or \"ecomm\") exactly as listed in the accessible-workspaces context. Omit to list across all accessible workspaces.",
          },
          status: {
            type: "string",
            enum: ["indexed", "metadata_only", "any"],
            description:
              "Filter by processing status. 'indexed' = searchable markdown; 'metadata_only' = stored binaries (PDF/docx/etc) findable by name only. Default 'any'.",
          },
          tag: {
            type: "string",
            description: "Filter to documents that have this exact tag.",
          },
          limit: {
            type: "number",
            description: "Max results (1-100). Default 50.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_documents",
      description:
        "Count documents in accessible workspaces, broken down by workspace. Use for 'how many docs in IT?' or 'which workspace has the most'.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["indexed", "metadata_only", "any"],
            description: "Filter by processing status. Default 'any'.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_uploads",
      description:
        "Return the most recently uploaded documents across accessible workspaces. Use for 'what got uploaded recently' or 'what's new'.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description:
              "Only include documents uploaded within the last N days. Default 30.",
          },
          limit: {
            type: "number",
            description: "Max results (1-50). Default 10.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_document",
      description:
        "Fetch a single document's metadata plus a short content preview. Use after list_documents when you need details on a specific doc.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document UUID." },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_documents",
      description:
        "Semantic + keyword search for content INSIDE documents. Use when the user asks a substantive question that needs body text (e.g. 'how do I rotate the VPN key?'). Returns chunk excerpts with source citations.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query." },
          space_id: {
            type: "string",
            description:
              "Optional workspace to restrict to — pass its name or slug (e.g. \"Ecomm\" or \"ecomm\") exactly as listed in the accessible-workspaces context. Omit to search all accessible workspaces.",
          },
          limit: {
            type: "number",
            description: "Max chunks to return (1-20). Default 8.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

// ---------- Tool implementations ----------

/**
 * Resolve a model-supplied `space_id` to a set of accessible space UUIDs.
 *
 * The model is given workspace *names* and *slugs* (never raw UUIDs), so it
 * naturally passes e.g. "Ecomm" or "ecomm" as space_id. Match case-insensitively
 * against UUID, slug, then name. An omitted scope means "all accessible". An
 * unresolvable token returns an error listing valid workspaces — far better than
 * silently returning an empty scope, which reads to the model as "nothing here".
 */
function resolveScope(
  requested: string | undefined,
  ctx: ToolContext,
): { ids: string[] } | { error: string } {
  if (!requested) return { ids: ctx.accessibleSpaceIds };
  const token = requested.trim().toLowerCase();
  const match = ctx.spaces.find(
    (s) =>
      s.id.toLowerCase() === token ||
      s.slug.toLowerCase() === token ||
      s.name.toLowerCase() === token,
  );
  if (match && ctx.accessibleSpaceIds.includes(match.id)) {
    return { ids: [match.id] };
  }
  const valid = ctx.spaces
    .filter((s) => ctx.accessibleSpaceIds.includes(s.id))
    .map((s) => s.name)
    .join(", ");
  return {
    error: `Unknown or inaccessible workspace "${requested}". Valid workspaces: ${valid || "(none)"}. Omit space_id to search all accessible workspaces.`,
  };
}

async function listDocuments(
  args: {
    space_id?: string;
    status?: "indexed" | "metadata_only" | "any";
    tag?: string;
    limit?: number;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const scope = resolveScope(args.space_id, ctx);
  if ("error" in scope) return { ok: false, error: scope.error };
  if (scope.ids.length === 0) {
    return { ok: true, data: { documents: [] }, summary: "No accessible workspaces." };
  }
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);

  const admin = createServiceClient();
  let q = admin
    .from("documents")
    .select("id, title, path, space_id, processing_status, tags, last_edited_at")
    .in("space_id", scope.ids)
    .is("deleted_at", null)
    .order("title")
    .limit(limit);

  if (args.status && args.status !== "any") {
    q = q.eq("processing_status", args.status);
  }
  if (args.tag) {
    q = q.contains("tags", [args.tag]);
  }

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  const docs = (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    path: d.path,
    workspace: ctx.spaceNameById.get(d.space_id as string) ?? "(unknown)",
    status: d.processing_status,
    tags: d.tags ?? [],
    last_edited_at: d.last_edited_at,
  }));

  return {
    ok: true,
    data: { documents: docs },
    summary: `Returned ${docs.length} document${docs.length === 1 ? "" : "s"}.`,
  };
}

async function countDocuments(
  args: { status?: "indexed" | "metadata_only" | "any" },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.accessibleSpaceIds.length === 0) {
    return { ok: true, data: { total: 0, by_workspace: [] }, summary: "No accessible workspaces." };
  }

  const admin = createServiceClient();
  let q = admin
    .from("documents")
    .select("space_id")
    .in("space_id", ctx.accessibleSpaceIds)
    .is("deleted_at", null);
  if (args.status && args.status !== "any") {
    q = q.eq("processing_status", args.status);
  }
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const k = row.space_id as string;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const by_workspace = Array.from(counts.entries())
    .map(([id, count]) => ({
      workspace: ctx.spaceNameById.get(id) ?? "(unknown)",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const total = by_workspace.reduce((acc, x) => acc + x.count, 0);
  return {
    ok: true,
    data: { total, by_workspace },
    summary: `${total} total across ${by_workspace.length} workspace${by_workspace.length === 1 ? "" : "s"}.`,
  };
}

async function recentUploads(
  args: { days?: number; limit?: number },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.accessibleSpaceIds.length === 0) {
    return { ok: true, data: { uploads: [] }, summary: "No accessible workspaces." };
  }
  const days = Math.min(Math.max(args.days ?? 30, 1), 365);
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("documents")
    .select("id, title, space_id, processing_status, last_edited_at")
    .in("space_id", ctx.accessibleSpaceIds)
    .is("deleted_at", null)
    .gte("last_edited_at", since)
    .order("last_edited_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message };

  const uploads = (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    workspace: ctx.spaceNameById.get(d.space_id as string) ?? "(unknown)",
    status: d.processing_status,
    uploaded_at: d.last_edited_at,
  }));
  return {
    ok: true,
    data: { uploads, window_days: days },
    summary: `${uploads.length} upload${uploads.length === 1 ? "" : "s"} in the last ${days} day${days === 1 ? "" : "s"}.`,
  };
}

async function getDocument(
  args: { id: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const admin = createServiceClient();
  const { data: doc } = await admin
    .from("documents")
    .select(
      "id, title, path, space_id, processing_status, tags, raw_content, last_edited_at",
    )
    .eq("id", args.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!doc) return { ok: false, error: "Document not found." };
  if (!ctx.accessibleSpaceIds.includes(doc.space_id as string)) {
    return { ok: false, error: "Access denied for this document." };
  }

  const raw = (doc.raw_content as string | null) ?? "";
  return {
    ok: true,
    data: {
      id: doc.id,
      title: doc.title,
      path: doc.path,
      workspace: ctx.spaceNameById.get(doc.space_id as string) ?? "(unknown)",
      status: doc.processing_status,
      tags: doc.tags ?? [],
      last_edited_at: doc.last_edited_at,
      content_preview: raw.slice(0, 1500),
      content_truncated: raw.length > 1500,
    },
    summary: `Fetched "${doc.title}".`,
  };
}

async function searchDocuments(
  args: { query: string; space_id?: string; limit?: number },
  ctx: ToolContext,
): Promise<{
  result: ToolResult;
  /** Hits in source-card shape for the UI. Null when the tool failed. */
  uiSources: Array<{
    n: number;
    documentId: string;
    chunkId: string;
    title: string;
    headingPath: string[];
  }> | null;
}> {
  const scope = resolveScope(args.space_id, ctx);
  if ("error" in scope) {
    return { result: { ok: false, error: scope.error }, uiSources: null };
  }
  if (scope.ids.length === 0) {
    return {
      result: { ok: true, data: { hits: [] }, summary: "No accessible workspaces." },
      uiSources: [],
    };
  }
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);

  const hits = await semanticSearch(args.query, {
    spaceIds: scope.ids,
    limit: 20,
    rerank: true,
  });
  const top = hits.slice(0, limit);

  // Result for the model — chunk preview + citation index.
  const data = {
    hits: top.map((h, i) => ({
      source_n: i + 1,
      doc_id: h.documentId,
      title: h.documentTitle,
      workspace: h.spaceName,
      heading_path: h.headingPath,
      excerpt: h.content.slice(0, 700),
    })),
  };

  // UI source list (full chunk metadata so the panel can render cards).
  const uiSources = top.map((h, i) => ({
    n: i + 1,
    documentId: h.documentId,
    chunkId: h.chunkId,
    title: h.documentTitle,
    headingPath: h.headingPath,
  }));

  return {
    result: {
      ok: true,
      data,
      summary: `${top.length} chunk${top.length === 1 ? "" : "s"} found.`,
    },
    uiSources,
  };
}

// ---------- Dispatcher ----------

export type DispatchResult = ToolResult & {
  /** Citation-shaped sources if this was a search_documents call. */
  uiSources?: Array<{
    n: number;
    documentId: string;
    chunkId: string;
    title: string;
    headingPath: string[];
  }>;
};

export async function dispatchTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<DispatchResult> {
  let args: Record<string, unknown>;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { ok: false, error: "Invalid JSON arguments." };
  }

  try {
    switch (name) {
      case "list_documents":
        return await listDocuments(args as Parameters<typeof listDocuments>[0], ctx);
      case "count_documents":
        return await countDocuments(args as Parameters<typeof countDocuments>[0], ctx);
      case "recent_uploads":
        return await recentUploads(args as Parameters<typeof recentUploads>[0], ctx);
      case "get_document":
        return await getDocument(args as Parameters<typeof getDocument>[0], ctx);
      case "search_documents": {
        const { result, uiSources } = await searchDocuments(
          args as Parameters<typeof searchDocuments>[0],
          ctx,
        );
        return { ...result, uiSources: uiSources ?? undefined };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
