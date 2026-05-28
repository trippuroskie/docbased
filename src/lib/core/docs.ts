// Pure document/space/chunk reads. No cookies, no Next.js.
// All functions accept the service client and an optional accessibleSpaceIds
// filter; callers do their own auth resolution and pass the allow-list in.

import type { SupabaseClient } from "@supabase/supabase-js";

export type SpaceRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
};

export type DocumentSummary = {
  id: string;
  spaceId: string;
  title: string;
  path: string;
  status: "indexed" | "metadata_only" | "failed" | "pending";
  tags: string[];
  lastEditedAt: string | null;
};

export type DocumentFull = DocumentSummary & {
  rawContent: string | null;
};

export type ChunkRow = {
  id: string;
  documentId: string;
  ordinal: number;
  content: string;
  headingPath: string[];
};

export async function listSpaces(
  supabase: SupabaseClient,
  opts: { accessibleSpaceIds?: string[] } = {},
): Promise<SpaceRow[]> {
  let q = supabase
    .from("spaces")
    .select("id, slug, name, description")
    .order("name");
  if (opts.accessibleSpaceIds) {
    if (opts.accessibleSpaceIds.length === 0) return [];
    q = q.in("id", opts.accessibleSpaceIds);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    id: s.id as string,
    slug: s.slug as string,
    name: s.name as string,
    description: (s.description as string | null) ?? null,
  }));
}

/**
 * Look up a document by id or by `space_slug/path` pair. Returns null if not
 * found, or if found but outside the caller's accessibleSpaceIds.
 */
export async function getDocument(
  supabase: SupabaseClient,
  ref: { id: string } | { spaceId: string; path: string },
  opts: { accessibleSpaceIds?: string[] } = {},
): Promise<DocumentFull | null> {
  let q = supabase
    .from("documents")
    .select(
      "id, space_id, title, path, processing_status, tags, raw_content, last_edited_at",
    )
    .is("deleted_at", null)
    .limit(1);
  if ("id" in ref) {
    q = q.eq("id", ref.id);
  } else {
    q = q.eq("space_id", ref.spaceId).eq("path", ref.path);
  }
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  if (
    opts.accessibleSpaceIds &&
    !opts.accessibleSpaceIds.includes(data.space_id as string)
  ) {
    return null;
  }

  return {
    id: data.id as string,
    spaceId: data.space_id as string,
    title: data.title as string,
    path: data.path as string,
    status: data.processing_status as DocumentFull["status"],
    tags: (data.tags as string[] | null) ?? [],
    rawContent: (data.raw_content as string | null) ?? null,
    lastEditedAt: (data.last_edited_at as string | null) ?? null,
  };
}

export type ListDocumentsArgs = {
  spaceId?: string;
  accessibleSpaceIds?: string[];
  limit?: number;
  /** Opaque cursor; currently `<iso-last-edited>|<id>` ordered descending. */
  cursor?: string;
};

export type ListDocumentsResult = {
  items: DocumentSummary[];
  nextCursor: string | null;
};

export async function listDocuments(
  supabase: SupabaseClient,
  args: ListDocumentsArgs,
): Promise<ListDocumentsResult> {
  const limit = clamp(args.limit ?? 25, 1, 100);
  let q = supabase
    .from("documents")
    .select(
      "id, space_id, title, path, processing_status, tags, last_edited_at",
    )
    .is("deleted_at", null)
    .order("last_edited_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (args.accessibleSpaceIds) {
    if (args.accessibleSpaceIds.length === 0) {
      return { items: [], nextCursor: null };
    }
    q = q.in("space_id", args.accessibleSpaceIds);
  }
  if (args.spaceId) q = q.eq("space_id", args.spaceId);

  if (args.cursor) {
    const parsed = parseCursor(args.cursor);
    if (parsed) {
      // Postgres tuple comparison via .or() — last_edited_at < cursorTs OR
      // (last_edited_at = cursorTs AND id < cursorId).
      q = q.or(
        `last_edited_at.lt.${parsed.ts},and(last_edited_at.eq.${parsed.ts},id.lt.${parsed.id})`,
      );
    }
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items: DocumentSummary[] = page.map((d) => ({
    id: d.id as string,
    spaceId: d.space_id as string,
    title: d.title as string,
    path: d.path as string,
    status: d.processing_status as DocumentSummary["status"],
    tags: (d.tags as string[] | null) ?? [],
    lastEditedAt: (d.last_edited_at as string | null) ?? null,
  }));

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    if (last.lastEditedAt) {
      nextCursor = `${last.lastEditedAt}|${last.id}`;
    }
  }
  return { items, nextCursor };
}

export async function getChunk(
  supabase: SupabaseClient,
  id: string,
  opts: { accessibleSpaceIds?: string[] } = {},
): Promise<(ChunkRow & { spaceId: string; documentTitle: string }) | null> {
  const { data, error } = await supabase
    .from("chunks")
    .select(
      "id, document_id, ordinal, content, heading_path, documents!inner(space_id, title)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // Supabase resolves the embedded relation to an object when using !inner.
  const doc = data.documents as unknown as {
    space_id: string;
    title: string;
  } | null;
  const spaceId = doc?.space_id ?? "";
  if (
    opts.accessibleSpaceIds &&
    !opts.accessibleSpaceIds.includes(spaceId)
  ) {
    return null;
  }
  return {
    id: data.id as string,
    documentId: data.document_id as string,
    ordinal: data.ordinal as number,
    content: data.content as string,
    headingPath: (data.heading_path as string[] | null) ?? [],
    spaceId,
    documentTitle: doc?.title ?? "(untitled)",
  };
}

/**
 * Fetch the chunks on either side of `ordinal` in the same document.
 * Useful for citation context expansion (LLM wants the chunk before/after).
 */
export async function getChunkNeighbors(
  supabase: SupabaseClient,
  chunkId: string,
  opts: { window?: number; accessibleSpaceIds?: string[] } = {},
): Promise<ChunkRow[]> {
  const window = clamp(opts.window ?? 1, 0, 5);
  const center = await getChunk(supabase, chunkId, {
    accessibleSpaceIds: opts.accessibleSpaceIds,
  });
  if (!center) return [];

  const { data, error } = await supabase
    .from("chunks")
    .select("id, document_id, ordinal, content, heading_path")
    .eq("document_id", center.documentId)
    .gte("ordinal", center.ordinal - window)
    .lte("ordinal", center.ordinal + window)
    .order("ordinal", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    documentId: c.document_id as string,
    ordinal: c.ordinal as number,
    content: c.content as string,
    headingPath: (c.heading_path as string[] | null) ?? [],
  }));
}

function parseCursor(s: string): { ts: string; id: string } | null {
  const [ts, id] = s.split("|", 2);
  if (!ts || !id) return null;
  return { ts, id };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
