"use client";

import Link from "next/link";
import {
  MoreHorizontal,
  Download,
  Pencil,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import type { DocPayload, SpaceWithTree } from "./types";

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function DocumentViewer({
  doc,
  space,
}: {
  doc: DocPayload | null;
  space: SpaceWithTree | null;
}) {
  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-8">
        Select a document from the sidebar to begin, or use the upload button to
        add one.
      </div>
    );
  }

  const segments = doc.path.split("/").filter(Boolean);
  const titleFromPath =
    segments.length > 0 ? segments[segments.length - 1] : doc.title;
  const folderSegments = segments.slice(0, -1);
  const breadcrumb: string[] = [];
  if (space?.name) breadcrumb.push(space.name);
  breadcrumb.push(...folderSegments);
  breadcrumb.push(titleFromPath || doc.title);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
      {/* Toolbar */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0 gap-3">
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0 overflow-hidden">
          {breadcrumb.map((seg, i) => (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span className="text-muted-foreground/60">›</span>}
              <span
                className={cn(
                  "truncate",
                  i === breadcrumb.length - 1
                    ? "text-foreground"
                    : "hover:text-foreground cursor-default",
                )}
              >
                {seg}
              </span>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          {doc.canEdit && doc.processingStatus === "indexed" && (
            <Link
              href={`/doc/${doc.id}/edit`}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="size-3.5" />
              Edit
            </Link>
          )}
          {doc.downloadUrl && (
            <a
              href={doc.downloadUrl}
              download={doc.originalFilename ?? "document"}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Download className="size-3.5" />
              Download original
            </a>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      {/* Document Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <article className="max-w-3xl mx-auto px-8 py-8">
          <h1 className="text-2xl font-semibold tracking-tight mb-4">
            {doc.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2 mb-8">
            {doc.lastEditedAt && (
              <Badge variant="secondary" className="text-xs font-normal">
                Last edited {formatRelative(doc.lastEditedAt)}
                {doc.lastEditedByName ? ` by ${doc.lastEditedByName}` : ""}
              </Badge>
            )}
            {doc.tags.length > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                Tagged: {doc.tags.join(", ")}
              </Badge>
            )}
            {doc.isStale && (
              <Badge
                variant="outline"
                className="text-xs font-normal border-amber-500/30 text-amber-500 bg-amber-500/10"
              >
                <AlertTriangle className="size-3 mr-1" />
                Stale — verify before relying
              </Badge>
            )}
          </div>

          {doc.processingStatus === "metadata_only" ? (
            <MetadataOnlyCard
              filename={doc.originalFilename ?? "file"}
              downloadUrl={doc.downloadUrl}
            />
          ) : (
            <Markdown source={doc.rawContent} wikilinks={doc.wikilinks} />
          )}

          {doc.backlinks.length > 0 && (
            <div className="mt-12 pt-8 border-t border-border">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Backlinks
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {doc.backlinks.map((b) => (
                  <Link
                    key={b.id}
                    href={`/?doc=${b.id}`}
                    scroll={false}
                    className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-secondary/50 transition-colors group"
                  >
                    <FileText className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {b.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {b.spaceName ? `${b.spaceName} › ` : ""}
                        {b.path}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </article>
      </div>
    </div>
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
    <div className="rounded-md border border-border bg-secondary/30 p-6">
      <p className="text-sm font-medium">{filename}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        This file is stored and findable by name and tags, but its contents
        aren&apos;t semantically searchable yet. Rich-format extraction lands
        in v1.5 — once it ships, this document will become fully searchable
        automatically.
      </p>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={filename}
          className="mt-4 inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Download className="size-3.5" /> Download original
        </a>
      )}
    </div>
  );
}
