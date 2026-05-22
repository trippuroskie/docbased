import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ingestUpload } from "@/lib/ingest/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // RLS on public.users blocks the user-session read; use service client to
  // verify admin (auth already happened via supabase.auth.getUser above).
  const admin = createServiceClient();
  const { data: me } = await admin
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const spaceId = form.get("spaceId") as string | null;
  const tagsRaw = form.get("tags") as string | null;
  const conflict = (form.get("conflict") as string | null) ?? "replace";
  const targetFolder = (form.get("targetFolder") as string | null) ?? "";
  const assetFiles = form.getAll("assets").filter((v): v is File => v instanceof File);

  if (!file || !spaceId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const tags = tagsRaw ? (JSON.parse(tagsRaw) as string[]) : [];
  const buf = Buffer.from(await file.arrayBuffer());

  const assets = await Promise.all(
    assetFiles.map(async (af) => ({
      filename: af.name,
      buffer: Buffer.from(await af.arrayBuffer()),
      contentType: af.type || "application/octet-stream",
    })),
  );

  console.log("[upload]", {
    file: file.name,
    bytes: buf.length,
    assets: assets.map((a) => ({ name: a.filename, bytes: a.buffer.length })),
  });

  try {
    const results = await ingestUpload(
      {
        filename: file.name,
        buffer: buf,
        mimeType: file.type,
        assets: assets.length ? assets : undefined,
      },
      {
        spaceId,
        uploaderId: user.id,
        tags,
        conflict: conflict as "replace" | "skip" | "version",
        targetFolder,
      },
    );
    return NextResponse.json({ results });
  } catch (err) {
    console.error("upload failed", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "ingest_failed" },
      { status: 500 },
    );
  }
}
