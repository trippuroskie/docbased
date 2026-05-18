import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Body = z.object({
  folderPath: z.string().min(1).max(1024),
});

// Same control-byte filter the move endpoint uses.
const CONTROL_CHARS = (() => {
  const codes: number[] = [];
  for (let i = 0; i <= 0x1f; i++) codes.push(i);
  codes.push(0x7f);
  return new Set(codes);
})();

function normalizeFolderPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const segments = trimmed.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (seg === "." || seg === "..") return null;
    for (let i = 0; i < seg.length; i++) {
      if (CONTROL_CHARS.has(seg.charCodeAt(i))) return null;
    }
  }
  return segments.join("/");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const folderPath = normalizeFolderPath(parsed.data.folderPath);
  if (!folderPath) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  // Auth check in app code: RLS would otherwise trip the recursive users
  // policy when it checks `is_admin`.
  const admin = createServiceClient();
  const { data: me } = await admin
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  let allowed = me?.is_admin === true;
  if (!allowed) {
    const { data: access } = await admin
      .from("space_access")
      .select("role")
      .eq("user_id", user.id)
      .eq("space_id", spaceId)
      .maybeSingle();
    allowed = access?.role === "editor" || access?.role === "owner";
  }
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const prefix = `${folderPath}/`;
  const { data: matches, error: readErr } = await admin
    .from("documents")
    .select("id, path")
    .eq("space_id", spaceId)
    .is("deleted_at", null);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const ids = (matches ?? [])
    .filter((d) => typeof d.path === "string" && (d.path as string).startsWith(prefix))
    .map((d) => d.id as string);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const { error: updErr } = await admin
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "delete",
    target_type: "folder",
    target_id: spaceId,
    metadata: { folder: folderPath, document_ids: ids },
  });

  return NextResponse.json({ ok: true, count: ids.length });
}
