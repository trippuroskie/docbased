import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: space } = await supabase
    .from("spaces")
    .select("id, slug, name, description")
    .eq("slug", slug)
    .single();
  if (!space) notFound();

  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, path, processing_status, last_edited_at, tags")
    .eq("space_id", space.id)
    .is("deleted_at", null)
    .order("path");

  const total = docs?.length ?? 0;
  const indexed = docs?.filter((d) => d.processing_status === "indexed").length ?? 0;

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{space.name}</h1>
          {space.description && (
            <p className="text-sm text-muted-foreground">{space.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {total} documents · {indexed} indexed · {total - indexed} metadata-only
          </p>
        </header>

        <ul className="divide-y rounded-lg border">
          {(docs ?? []).map((d) => (
            <li key={d.id}>
              <Link
                href={`/doc/${d.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {d.processing_status === "metadata_only" ? (
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="truncate font-medium">{d.title}</span>
                  <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                    {d.path}
                  </span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-1">
                  {(d.tags ?? []).slice(0, 2).map((t: string) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      #{t}
                    </Badge>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
