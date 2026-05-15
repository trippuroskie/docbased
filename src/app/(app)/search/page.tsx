import Link from "next/link";
import { search } from "@/lib/search";
import { Badge } from "@/components/ui/badge";

type Props = {
  searchParams: Promise<{ q?: string; space?: string | string[] }>;
};

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const spaces = !params.space
    ? []
    : Array.isArray(params.space)
      ? params.space
      : [params.space];

  const hits = q ? await search(q, { spaceIds: spaces.length ? spaces : undefined, limit: 30 }) : [];

  // Group by document for readability.
  const byDoc = new Map<string, typeof hits>();
  for (const h of hits) {
    if (!byDoc.has(h.documentId)) byDoc.set(h.documentId, []);
    byDoc.get(h.documentId)!.push(h);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-sm text-muted-foreground">
          {q ? <>Results for <strong>“{q}”</strong></> : "Type a query to search."}
        </p>
      </header>

      {byDoc.size === 0 && q && (
        <p className="text-sm text-muted-foreground">No matches in your accessible spaces.</p>
      )}

      <ul className="space-y-4">
        {Array.from(byDoc.entries()).map(([docId, docHits]) => {
          const first = docHits[0];
          return (
            <li key={docId} className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/doc/${docId}`} className="font-medium hover:underline">
                  {first.documentTitle}
                </Link>
                <Badge variant="secondary">{first.spaceName}</Badge>
              </div>
              <ul className="mt-2 space-y-2">
                {docHits.slice(0, 3).map((h) => (
                  <li key={h.chunkId} className="text-sm">
                    {h.headingPath.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {h.headingPath.join(" → ")}
                      </p>
                    )}
                    <p className="line-clamp-3 text-muted-foreground">{h.content}</p>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
