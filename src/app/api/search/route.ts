import { NextResponse } from "next/server";
import { search } from "@/lib/search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const spaces = searchParams.getAll("space");
  const rerank = searchParams.get("rerank") !== "false";
  const limit = Number(searchParams.get("limit") ?? 20);

  if (!q) return NextResponse.json({ hits: [] });

  const hits = await search(q, {
    spaceIds: spaces.length ? spaces : undefined,
    limit,
    rerank,
  });
  return NextResponse.json({ hits });
}
