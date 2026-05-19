import { createServiceClient } from "@/lib/supabase/server";
import { embed } from "@/lib/ai/openrouter";
import { env } from "@/lib/env";
import {
  extensionOf,
  sourceFormatFor,
  tierFor,
  type Extracted,
  type Tier,
  type UploadFile,
} from "./types";
import { extractMarkdown } from "./extractors/md";
import { extractText } from "./extractors/txt";
import { extractZip } from "./extractors/zip";
import { extractDocx } from "./extractors/docx";
import { chunkMarkdown, type ChunkedPiece } from "./chunker";
import { sha256 } from "./hash";
import { extractWikilinkTargets } from "./wikilinks";

const EMBED_BATCH_SIZE = 100;

export type IngestResult = {
  documentId: string;
  path: string;
  tier: Tier;
  status: "created" | "replaced" | "skipped_unchanged" | "skipped_in_zip";
  chunkCount?: number;
  message?: string;
};

export type IngestOptions = {
  spaceId: string;
  uploaderId: string;
  tags?: string[];
  /** What to do when (space_id, path) already exists. */
  conflict?: "replace" | "skip" | "version";
  /**
   * Optional folder path inside the destination space. Prefixed onto every
   * document's path (including entries inside an uploaded zip), so users can
   * import a vault into a sub-folder without flattening its structure.
   * Leading/trailing slashes are stripped; empty means "space root".
   */
  targetFolder?: string;
};

function normalizeTargetFolder(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  return trimmed
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}

function joinFolder(folder: string, rest: string): string {
  return folder ? `${folder}/${rest}` : rest;
}

export async function ingestUpload(
  file: UploadFile,
  opts: IngestOptions,
): Promise<IngestResult[]> {
  const tier = tierFor(file.filename);
  const ext = extensionOf(file.filename);
  const targetFolder = normalizeTargetFolder(opts.targetFolder);

  if (tier === "metadata_only") {
    return [await ingestMetadataOnly(file, opts, targetFolder)];
  }

  if (ext === ".zip") {
    return ingestZip(file, opts, targetFolder);
  }

  // .md / .markdown / .txt / .docx
  const extracted =
    ext === ".txt"
      ? extractText(file.buffer, file.filename)
      : ext === ".docx"
      ? await extractDocx(file.buffer, file.filename)
      : extractMarkdown(file.buffer, file.filename);

  const treePath = joinFolder(targetFolder, stripExt(file.filename));
  const result = await ingestIndexed({
    spaceId: opts.spaceId,
    uploaderId: opts.uploaderId,
    tags: opts.tags ?? [],
    conflict: opts.conflict ?? "replace",
    path: treePath,
    filename: file.filename,
    sourceFormat: sourceFormatFor(file.filename),
    buffer: file.buffer,
    extracted,
  });

  await resolveWikilinks(opts.spaceId, [result.documentId]);
  return [result];
}

async function ingestZip(
  file: UploadFile,
  opts: IngestOptions,
  targetFolder: string,
): Promise<IngestResult[]> {
  const { entries, skipped } = await extractZip(file.buffer);
  const results: IngestResult[] = [];
  const createdIds: string[] = [];

  for (const entry of entries) {
    const out = await ingestIndexed({
      spaceId: opts.spaceId,
      uploaderId: opts.uploaderId,
      tags: opts.tags ?? [],
      conflict: opts.conflict ?? "replace",
      path: joinFolder(targetFolder, entry.path),
      filename: entry.filename,
      sourceFormat: entry.sourceFormat,
      // No per-file buffer is meaningful to store as the "original" — keep the zip itself.
      buffer: null,
      extracted: entry.extracted,
    });
    results.push(out);
    if (out.status === "created" || out.status === "replaced") {
      createdIds.push(out.documentId);
    }
  }

  for (const s of skipped) {
    results.push({
      documentId: "",
      path: s.name,
      tier: "metadata_only",
      status: "skipped_in_zip",
      message: s.reason,
    });
  }

  // Resolve wikilinks once at the end so intra-batch references resolve.
  if (createdIds.length) {
    await resolveWikilinks(opts.spaceId, createdIds);
  }

  return results;
}

async function ingestMetadataOnly(
  file: UploadFile,
  opts: IngestOptions,
  targetFolder: string,
): Promise<IngestResult> {
  const admin = createServiceClient();
  const documentId = crypto.randomUUID();
  const storagePath = `${opts.spaceId}/${documentId}/${file.filename}`;

  const { error: upErr } = await admin.storage
    .from("originals")
    .upload(storagePath, file.buffer, {
      contentType: file.mimeType ?? "application/octet-stream",
      upsert: true,
    });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  const path = joinFolder(targetFolder, stripExt(file.filename));
  const { data, error } = await admin
    .from("documents")
    .upsert(
      {
        id: documentId,
        space_id: opts.spaceId,
        title: stripExt(file.filename),
        path,
        source_format: sourceFormatFor(file.filename),
        processing_status: "metadata_only",
        original_filename: file.filename,
        original_storage_path: storagePath,
        raw_content: null,
        content_hash: null,
        tags: opts.tags ?? [],
        embedding_model: null,
        uploaded_by: opts.uploaderId,
        last_edited_by: opts.uploaderId,
      },
      { onConflict: "space_id,path" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`document upsert failed: ${error.message}`);

  await admin.from("audit_log").insert({
    actor_id: opts.uploaderId,
    action: "upload",
    target_type: "document",
    target_id: data.id,
    metadata: { tier: "metadata_only", filename: file.filename },
  });

  return {
    documentId: data.id,
    path,
    tier: "metadata_only",
    status: "created",
  };
}

type IngestIndexedInput = {
  spaceId: string;
  uploaderId: string;
  tags: string[];
  conflict: "replace" | "skip" | "version";
  path: string;
  filename: string;
  sourceFormat: string;
  /** When null, no original is uploaded (e.g. files inside a zip). */
  buffer: Buffer | null;
  extracted: Extracted;
};

async function ingestIndexed(input: IngestIndexedInput): Promise<IngestResult> {
  const admin = createServiceClient();
  const documentId = crypto.randomUUID();
  const contentHash = sha256(input.extracted.markdown);

  // Conflict detection: look up existing doc at (space_id, path).
  const { data: existing } = await admin
    .from("documents")
    .select("id, content_hash, path")
    .eq("space_id", input.spaceId)
    .eq("path", input.path)
    .maybeSingle();

  if (existing) {
    if (input.conflict === "skip") {
      return {
        documentId: existing.id,
        path: input.path,
        tier: "indexed",
        status: "skipped_unchanged",
      };
    }
    if (existing.content_hash === contentHash) {
      return {
        documentId: existing.id,
        path: input.path,
        tier: "indexed",
        status: "skipped_unchanged",
      };
    }
    if (input.conflict === "version") {
      // v1 has no version table; treat as new path with a -N suffix.
      const versioned = nextVersionPath(input.path);
      input = { ...input, path: versioned };
    }
  }

  let storagePath: string | null = null;
  if (input.buffer) {
    storagePath = `${input.spaceId}/${documentId}/${input.filename}`;
    const { error } = await admin.storage
      .from("originals")
      .upload(storagePath, input.buffer, {
        contentType: contentTypeFor(input.sourceFormat),
        upsert: true,
      });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }

  const tags = mergeTags(input.tags, input.extracted.tags);

  const { data: doc, error: docErr } = await admin
    .from("documents")
    .upsert(
      {
        id: existing && input.conflict === "replace" ? existing.id : documentId,
        space_id: input.spaceId,
        title: input.extracted.title,
        path: input.path,
        source_format: input.sourceFormat,
        processing_status: "indexed",
        original_filename: input.filename,
        original_storage_path: storagePath,
        raw_content: input.extracted.markdown,
        content_hash: contentHash,
        frontmatter: input.extracted.frontmatter,
        tags,
        embedding_model: env.embeddingModel,
        uploaded_by: input.uploaderId,
        last_edited_by: input.uploaderId,
        last_edited_at: new Date().toISOString(),
      },
      { onConflict: "space_id,path" },
    )
    .select("id")
    .single();
  if (docErr) throw new Error(`document upsert failed: ${docErr.message}`);

  // Upload any inline images extracted from the source (e.g. .docx).
  // Images are stored alongside the doc under "_assets/" and referenced by
  // relative path in raw_content; the document GET handler rewrites those to
  // signed URLs at read time.
  for (const img of input.extracted.images ?? []) {
    const objectPath = `${input.spaceId}/${doc.id}/${img.path}`;
    const { error: imgErr } = await admin.storage
      .from("originals")
      .upload(objectPath, img.buffer, {
        contentType: img.contentType,
        upsert: true,
      });
    if (imgErr) {
      console.warn(`image upload failed (${img.path}):`, imgErr.message);
    }
  }

  // Replace chunks atomically: delete then insert.
  await admin.from("chunks").delete().eq("document_id", doc.id);

  const pieces = chunkMarkdown(input.extracted.markdown);
  const embedTargets = pieces.filter((p) => !p.isLargeCode);
  const embeddings = await embedInBatches(embedTargets.map((p) => p.content));

  let embedIdx = 0;
  const rows = pieces.map((p) => {
    const embedding = p.isLargeCode ? null : embeddings[embedIdx++];
    return {
      document_id: doc.id,
      ordinal: p.ordinal,
      content: p.content,
      token_count: p.tokenCount,
      heading_path: p.headingPath,
      embedding: embedding ? toVectorLiteral(embedding) : null,
      embedding_model: env.embeddingModel,
    };
  });

  if (rows.length) {
    // Insert in batches of 200 to stay within payload limits.
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      const { error } = await admin.from("chunks").insert(slice);
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    }
  }

  await admin.from("audit_log").insert({
    actor_id: input.uploaderId,
    action: existing ? "edit" : "upload",
    target_type: "document",
    target_id: doc.id,
    metadata: {
      tier: "indexed",
      filename: input.filename,
      chunks: pieces.length,
    },
  });

  return {
    documentId: doc.id,
    path: input.path,
    tier: "indexed",
    status: existing ? "replaced" : "created",
    chunkCount: pieces.length,
  };
}

async function embedInBatches(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const slice = texts.slice(i, i + EMBED_BATCH_SIZE);
    const vecs = await embed(slice);
    out.push(...vecs);
  }
  return out;
}

function contentTypeFor(sourceFormat: string): string {
  switch (sourceFormat) {
    case "md":
      return "text/markdown";
    case "txt":
      return "text/plain";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

function toVectorLiteral(v: number[]): string {
  // pgvector accepts the textual form '[0.1,0.2,...]'.
  return `[${v.join(",")}]`;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function nextVersionPath(path: string): string {
  const m = path.match(/^(.*)-v(\d+)$/);
  if (!m) return `${path}-v2`;
  return `${m[1]}-v${Number(m[2]) + 1}`;
}

function mergeTags(a: string[], b: string[]): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

async function resolveWikilinks(spaceId: string, documentIds: string[]) {
  if (!documentIds.length) return;
  const admin = createServiceClient();

  const { data: docs } = await admin
    .from("documents")
    .select("id, raw_content")
    .in("id", documentIds);

  if (!docs?.length) return;

  // Titles available in this space, for resolution.
  const { data: spaceDocs } = await admin
    .from("documents")
    .select("id, title")
    .eq("space_id", spaceId);
  const byTitle = new Map(
    (spaceDocs ?? []).map((d) => [d.title.toLowerCase(), d.id]),
  );

  const rows: { src_document_id: string; dst_title: string; dst_document_id: string | null }[] = [];
  for (const d of docs) {
    if (!d.raw_content) continue;
    const targets = extractWikilinkTargets(d.raw_content);
    for (const t of targets) {
      rows.push({
        src_document_id: d.id,
        dst_title: t,
        dst_document_id: byTitle.get(t.toLowerCase()) ?? null,
      });
    }
  }

  if (!rows.length) return;
  // Clear and rewrite this batch's links.
  await admin
    .from("links")
    .delete()
    .in("src_document_id", documentIds);
  await admin.from("links").insert(rows);
}
