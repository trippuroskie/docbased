import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Download, AlertTriangle } from "lucide-react";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getCurrentUserRecord } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";

export const dynamic = "force-dynamic";

const STALE_MS = 12 * 30 * 24 * 60 * 60 * 1000; // ~12 months

export default async function DocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const me = await getCurrentUserRecord();

  const { data: doc } = await supabase
    .from("documents")
    .select(
      "id, title, path, space_id, source_format, processing_status, original_filename, original_storage_path, raw_content, frontmatter, tags, last_edited_at, last_edited_by",
    )
    .eq("id", id)
    .single();

  if (!doc) notFound();

  // Touch last_viewed_at (best effort).
  await supabase
    .from("documents")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", id);

  const { data: space } = await supabase
    .from("spaces")
    .select("id, slug, name")
    .eq("id", doc.space_id)
    .single();

  const { data: accessRow } = await supabase
    .from("space_access")
    .select("role")
    .eq("space_id", doc.space_id)
    .eq("user_id", me?.id ?? "")
    .maybeSingle();

  const canEdit =
    me?.is_admin || accessRow?.role === "editor" || accessRow?.role === "owner";

  // Backlinks: documents that link TO this title.
  const { data: backlinkRows } = await supabase
    .from("links")
    .select("src_document_id")
    .eq("dst_document_id", doc.id);
  const backlinkIds = (backlinkRows ?? []).map((r) => r.src_document_id);
  const { data: backlinkDocs } = backlinkIds.length
    ? await supabase
        .from("documents")
        .select("id, title")
        .in("id", backlinkIds)
    : { data: [] as { id: string; title: string }[] };

  // Wikilink resolution within the user's accessible scope.
  const { data: allAccessibleDocs } = await supabase
    .from("documents")
    .select("id, title")
    .is("deleted_at", null);
  const wikilinks = Object.fromEntries(
    (allAccessibleDocs ?? []).map((d) => [d.title.toLowerCase(), d.id]),
  );

  const isStale =
    doc.last_edited_at &&
    Date.now() - new Date(doc.last_edited_at).getTime() > STALE_MS;

  let downloadUrl: string | null = null;
  if (doc.original_storage_path) {
    const admin = createServiceClient();
    const { data: signed } = await admin.storage
      .from("originals")
      .createSignedUrl(doc.original_storage_path, 60 * 10);
    downloadUrl = signed?.signedUrl ?? null;
  }

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <header className="space-y-3">
          <p className="text-xs text-muted-foreground">
            <Link href={`/space/${space?.slug ?? ""}`} className="hover:underline">
              {space?.name}
            </Link>
            {" / "}
            {doc.path}
          </p>
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
            <div className="flex items-center gap-1">
              {canEdit && doc.processing_status === "indexed" && (
                <Button size="sm" variant="outline" render={<Link href={`/doc/${doc.id}/edit`} />}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              )}
              {downloadUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  render={<a href={downloadUrl} download={doc.original_filename} />}
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> Original
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {(doc.tags ?? []).map((t: string) => (
              <Badge key={t} variant="secondary" className="text-[10px]">
                #{t}
              </Badge>
            ))}
            {doc.frontmatter &&
              Object.entries(doc.frontmatter as Record<string, unknown>)
                .filter(([k]) => k !== "title" && k !== "tags" && k !== "tag")
                .slice(0, 8)
                .map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[10px]">
                    {k}: {String(v).slice(0, 40)}
                  </Badge>
                ))}
          </div>

          {isStale && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>
                This document hasn&apos;t been updated in over a year. Verify
                before relying on it.
              </p>
            </div>
          )}
        </header>

        {doc.processing_status === "metadata_only" ? (
          <MetadataOnlyCard
            filename={doc.original_filename}
            downloadUrl={downloadUrl}
          />
        ) : (
          <Markdown source={doc.raw_content ?? ""} wikilinks={wikilinks} />
        )}

        {backlinkDocs && backlinkDocs.length > 0 && (
          <section className="border-t pt-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Linked from
            </h2>
            <ul className="space-y-1 text-sm">
              {backlinkDocs.map((b) => (
                <li key={b.id}>
                  <Link href={`/doc/${b.id}`} className="hover:underline">
                    {b.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function MetadataOnlyCard({
  filename,
  downloadUrl,
}: {
  filename: string;
  downloadUrl: string | null;
}) {
  return (
    <div className="rounded-lg border p-6">
      <p className="text-sm font-medium">{filename}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        This file is stored and findable by name and tags, but its contents
        aren&apos;t semantically searchable yet. Rich-format extraction lands
        in v1.5 — once it ships, this document will become fully searchable
        automatically.
      </p>
      {downloadUrl && (
        <Button
          className="mt-4"
          size="sm"
          render={<a href={downloadUrl} download={filename} />}
        >
          <Download className="mr-1 h-3.5 w-3.5" /> Download original
        </Button>
      )}
    </div>
  );
}
