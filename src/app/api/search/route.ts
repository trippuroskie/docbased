import { NextResponse } from "next/server";
import { search, type SearchHit } from "@/lib/search";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const spaces = searchParams.getAll("space");
  const rerank = searchParams.get("rerank") === "true";
  const limit = Number(searchParams.get("limit") ?? 30);

  if (!q) {
    return NextResponse.json({
      hits: [],
      grouped: {},
      totals: { all: 0 },
    });
  }

  const hits = await search(q, {
    spaceIds: spaces.length ? spaces : undefined,
    limit,
    rerank,
  });

  // Group by document — one row per doc, keep the top-scored chunk preview.
  // `hits` arrives sorted by score from the RPC, so first occurrence wins.
  const bestByDoc = new Map<string, SearchHit>();
  for (const h of hits) {
    if (!bestByDoc.has(h.documentId)) bestByDoc.set(h.documentId, h);
  }
  const docHits = Array.from(bestByDoc.values());

  const grouped: Record<string, { name: string; hits: SearchHit[] }> = {};
  const totals: Record<string, number> = { all: docHits.length };
  for (const h of docHits) {
    if (!grouped[h.spaceId]) {
      grouped[h.spaceId] = { name: h.spaceName, hits: [] };
      totals[h.spaceId] = 0;
    }
    grouped[h.spaceId].hits.push(h);
    totals[h.spaceId] += 1;
  }

  return NextResponse.json({ hits: docHits, grouped, totals });
}
