// Framework-free document creation. Builds the markdown payload, chunks it,
// embeds the chunks, and upserts the `documents` + `chunks` rows directly.
// Used by:
//   - the CLI `doc save` subcommand
//   - the docbased-mcp `save_document` tool
//
// The file-based upload path (drag-and-drop in the admin UI, `docbased import`)
// still goes through src/lib/ingest/pipeline.ts because it also handles asset
// attachments, zips, .docx extraction, etc. This module is the lean variant
// for the "agent has some markdown, save it" case.
//
// To stay usable from the standalone docbased-mcp package without dragging in
// @/lib/env or @/lib/supabase/server, every dependency (Supabase client,
// embedding credentials) is passed in by the caller. Relative imports are
// used for sibling modules so the same file resolves under both `@/*` (Next)
// and `@core/*` (MCP) tsconfig path conventions.

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkMarkdown } from "../ingest/chunker";
import { embed, type EmbedConfig } from "./embed";
import { writeAuditLog, type AuditSource } from "./audit";

const AGENT_TAG = "agent-authored";
const EMBED_BATCH_SIZE = 100;
const CHUNK_INSERT_BATCH_SIZE = 200;

export type CreateDocumentInput = {
  spaceId: string;
  /** User id recorded on the row's uploaded_by / last_edited_by columns. */
  uploaderId: string;
  /** Document title — h1, frontmatter, default path slug. */
  title: string;
  /** Markdown body. Any leading frontmatter block is stripped; structured
   *  metadata goes through the parameters of this call instead. */
  content: string;
  /** Path inside the space (slash-separated, no extension).
   *  Default: slugify(title). */
  path?: string;
  /** Extra tags to apply. agent-authored is added automatically when
   *  markAsAgent is true. */
  tags?: string[];
  /** What to do if (space_id, path) already exists. Default: 'version'
   *  (safest — never destroys existing content). */
  conflict?: "replace" | "skip" | "version";
  /** When true (default), stamps agent_authored: true in frontmatter, the
   *  agent-authored tag, and records the agent name in frontmatter. */
  markAsAgent?: boolean;
  /** Identifier of the agent — e.g. "mcp", "cli", "claude-opus-4-7". */
  agentName?: string;
  /** Provenance for the audit row. */
  source: AuditSource;
  /** Embedding config — required because we don't read process.env. */
  embedding: EmbedConfig;
};

export type CreateDocumentResult = {
  documentId: string;
  path: string;
  status: "created" | "replaced" | "skipped_unchanged";
  chunkCount: number;
};

export async function createDocument(
  supabase: SupabaseClient,
  input: CreateDocumentInput,
): Promise<CreateDocumentResult> {
  const markAsAgent = input.markAsAgent ?? true;
  const conflict = input.conflict ?? "version";

  const body = stripLeadingFrontmatter(input.content);

  const tags = Array.from(
    new Set([...(input.tags ?? []), ...(markAsAgent ? [AGENT_TAG] : [])]),
  );

  const frontmatter: Record<string, unknown> = {
    title: input.title,
    tags,
  };
  if (markAsAgent) {
    frontmatter.agent_authored = true;
    if (input.agentName) frontmatter.agent_name = input.agentName;
    frontmatter.created_at = new Date().toISOString();
  }

  const finalMarkdown = `${emitFrontmatter(frontmatter)}${body}`;
  const contentHash = sha256(finalMarkdown);

  let path =
    input.path?.trim().replace(/^\/+|\/+$/g, "") || slugify(input.title);

  const existing = await fetchExistingDoc(supabase, input.spaceId, path);
  if (existing) {
    if (conflict === "skip" || existing.content_hash === contentHash) {
      return {
        documentId: existing.id,
        path,
        status: "skipped_unchanged",
        chunkCount: 0,
      };
    }
    if (conflict === "version") {
      path = await pickVersionedPath(supabase, input.spaceId, path);
    }
  }

  const documentId =
    existing && conflict === "replace" ? existing.id : randomUUID();

  // `documents.original_filename` is NOT NULL in the schema (every other path
  // — admin upload, `docbased import`, the obsidian script — comes from a real
  // file). Agent-authored docs have no source file, so synthesize one from
  // the resolved path; it mirrors what `import` would have produced for the
  // same markdown delivered as a file.
  const filenameSegment = path.split("/").pop() || "document";
  const originalFilename = `${filenameSegment}.md`;

  const { error: upErr } = await supabase.from("documents").upsert(
    {
      id: documentId,
      space_id: input.spaceId,
      title: input.title,
      path,
      source_format: "md",
      processing_status: "indexed",
      original_filename: originalFilename,
      original_storage_path: null,
      raw_content: finalMarkdown,
      content_hash: contentHash,
      frontmatter,
      tags,
      embedding_model: input.embedding.model,
      uploaded_by: input.uploaderId,
      last_edited_by: input.uploaderId,
      last_edited_at: new Date().toISOString(),
    },
    { onConflict: "space_id,path" },
  );
  if (upErr) throw new Error(`document upsert failed: ${upErr.message}`);

  // Atomic chunk replace.
  await supabase.from("chunks").delete().eq("document_id", documentId);

  const pieces = chunkMarkdown(finalMarkdown);
  const embedTargets = pieces.filter((p) => !p.isLargeCode);
  const vectors = await embedInBatches(
    input.embedding,
    embedTargets.map((p) => p.content),
  );

  let vi = 0;
  const rows = pieces.map((p) => ({
    document_id: documentId,
    ordinal: p.ordinal,
    content: p.content,
    token_count: p.tokenCount,
    heading_path: p.headingPath,
    embedding: p.isLargeCode ? null : toVectorLiteral(vectors[vi++]),
    embedding_model: input.embedding.model,
  }));

  for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH_SIZE) {
    const slice = rows.slice(i, i + CHUNK_INSERT_BATCH_SIZE);
    const { error } = await supabase.from("chunks").insert(slice);
    if (error) throw new Error(`chunk insert failed: ${error.message}`);
  }

  await writeAuditLog(supabase, {
    actorId: input.uploaderId,
    action: existing && conflict === "replace" ? "save_replace" : "save_create",
    targetType: "document",
    targetId: documentId,
    source: input.source,
    metadata: {
      path,
      chunks: pieces.length,
      agent_authored: markAsAgent,
      agent_name: input.agentName ?? null,
    },
  });

  return {
    documentId,
    path,
    status: existing && conflict === "replace" ? "replaced" : "created",
    chunkCount: pieces.length,
  };
}

async function fetchExistingDoc(
  supabase: SupabaseClient,
  spaceId: string,
  path: string,
): Promise<{ id: string; content_hash: string | null } | null> {
  const { data } = await supabase
    .from("documents")
    .select("id, content_hash")
    .eq("space_id", spaceId)
    .eq("path", path)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    content_hash: (data.content_hash as string | null) ?? null,
  };
}

async function pickVersionedPath(
  supabase: SupabaseClient,
  spaceId: string,
  basePath: string,
): Promise<string> {
  // Strip an existing -vN suffix so we always count from the bare base.
  const base = basePath.replace(/-v\d+$/, "");
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-v${n}`;
    const { data } = await supabase
      .from("documents")
      .select("id")
      .eq("space_id", spaceId)
      .eq("path", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error(
    `Could not find an unused version suffix for ${basePath} (1000 tries).`,
  );
}

async function embedInBatches(
  cfg: EmbedConfig,
  texts: string[],
): Promise<number[][]> {
  if (!texts.length) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const slice = texts.slice(i, i + EMBED_BATCH_SIZE);
    const vecs = await embed(cfg, slice);
    out.push(...vecs);
  }
  return out;
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

function emitFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const items = v.map((x) => yamlScalar(String(x))).join(", ");
      lines.push(`${k}: [${items}]`);
    } else if (typeof v === "boolean" || typeof v === "number") {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${yamlScalar(String(v))}`);
    }
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

function yamlScalar(s: string): string {
  if (
    s.length > 0 &&
    /^[a-zA-Z0-9_\-./:T+ ]+$/.test(s) &&
    !/^(true|false|null|yes|no|on|off)$/i.test(s)
  ) {
    return s;
  }
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function stripLeadingFrontmatter(content: string): string {
  const trimmed = content.replace(/^﻿/, "");
  const m = trimmed.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!m) return trimmed;
  return trimmed.slice(m[0].length);
}
