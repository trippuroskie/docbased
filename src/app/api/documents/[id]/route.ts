import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { embed } from "@/lib/ai/openrouter";
import { chunkMarkdown } from "@/lib/ingest/chunker";
import { sha256 } from "@/lib/ingest/hash";
import { env } from "@/lib/env";

const Patch = z.object({
  title: z.string().min(1).max(500),
  content: z.string(),
  tags: z.array(z.string()).optional(),
});

import { getAccessibleSpaces } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const accessible = await getAccessibleSpaces();
  const accessibleIds = new Set(accessible.map((s) => s.id));

  const admin = createServiceClient();
  const { data: doc } = await admin
    .from("documents")
    .select(
      "id, title, path, space_id, processing_status, tags, raw_content",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!accessibleIds.has(doc.space_id as string)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const workspace =
    accessible.find((s) => s.id === doc.space_id)?.name ?? "(unknown)";

  const rawContent = (doc.raw_content as string | null) ?? "";
  const content = await rewriteAssetPaths(
    admin,
    doc.space_id as string,
    doc.id as string,
    rawContent,
  );

  return NextResponse.json({
    document: {
      id: doc.id,
      title: doc.title,
      path: doc.path,
      workspace,
      status: doc.processing_status,
      tags: doc.tags ?? [],
      content,
    },
  });
}

const ASSET_PATH_RE = /(!\[[^\]]*\]\()(_assets\/[^\s)]+)(\))/g;
const ASSET_URL_TTL_SECONDS = 60 * 60; // 1 hour

type AdminClient = ReturnType<typeof createServiceClient>;

async function rewriteAssetPaths(
  admin: AdminClient,
  spaceId: string,
  documentId: string,
  markdown: string,
): Promise<string> {
  const refs = new Set<string>();
  for (const m of markdown.matchAll(ASSET_PATH_RE)) refs.add(m[2]);
  if (refs.size === 0) return markdown;

  const objectPaths = Array.from(refs).map((p) => `${spaceId}/${documentId}/${p}`);
  const { data: signed } = await admin.storage
    .from("originals")
    .createSignedUrls(objectPaths, ASSET_URL_TTL_SECONDS);

  const urlByRef = new Map<string, string>();
  for (let i = 0; i < objectPaths.length; i++) {
    const ref = Array.from(refs)[i];
    const url = signed?.[i]?.signedUrl;
    if (url) urlByRef.set(ref, url);
  }

  return markdown.replace(ASSET_PATH_RE, (_full, prefix, ref, suffix) => {
    const url = urlByRef.get(ref);
    return url ? `${prefix}${url}${suffix}` : "";
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Read existing doc with the user's session so RLS gates edit permission.
  const { data: doc, error: readErr } = await supabase
    .from("documents")
    .select("id, space_id, processing_status")
    .eq("id", id)
    .single();
  if (readErr || !doc) {
    return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }
  if (doc.processing_status !== "indexed") {
    return NextResponse.json({ error: "metadata_only_cannot_edit" }, { status: 400 });
  }

  const body = Patch.parse(await request.json());
  const newHash = sha256(body.content);

  const admin = createServiceClient();
  await admin
    .from("documents")
    .update({
      title: body.title,
      raw_content: body.content,
      content_hash: newHash,
      tags: body.tags ?? [],
      last_edited_at: new Date().toISOString(),
      last_edited_by: user.id,
    })
    .eq("id", id);

  // Re-chunk and re-embed.
  await admin.from("chunks").delete().eq("document_id", id);
  const pieces = chunkMarkdown(body.content);
  const embedTargets = pieces.filter((p) => !p.isLargeCode);
  const embeddings = await embedInBatches(embedTargets.map((p) => p.content));

  let idx = 0;
  const rows = pieces.map((p) => ({
    document_id: id,
    ordinal: p.ordinal,
    content: p.content,
    token_count: p.tokenCount,
    heading_path: p.headingPath,
    embedding: p.isLargeCode ? null : toVectorLiteral(embeddings[idx++]),
    embedding_model: env.embeddingModel,
  }));

  for (let i = 0; i < rows.length; i += 200) {
    await admin.from("chunks").insert(rows.slice(i, i + 200));
  }

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "edit",
    target_type: "document",
    target_id: id,
    metadata: { chunks: pieces.length },
  });

  return NextResponse.json({ ok: true, chunks: pieces.length });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const admin = createServiceClient();
  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "delete",
    target_type: "document",
    target_id: id,
  });

  return NextResponse.json({ ok: true });
}

async function embedInBatches(texts: string[]) {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const slice = texts.slice(i, i + 100);
    out.push(...(await embed(slice)));
  }
  return out;
}

function toVectorLiteral(v: number[]) {
  return `[${v.join(",")}]`;
}
