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

  if (!file || !spaceId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const tags = tagsRaw ? (JSON.parse(tagsRaw) as string[]) : [];
  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const results = await ingestUpload(
      { filename: file.name, buffer: buf, mimeType: file.type },
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
