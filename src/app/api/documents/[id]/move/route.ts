import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Body = z.object({
  newPath: z.string().min(1).max(1024),
});

// Matches NUL through ASCII 0x1F plus DEL (0x7F). Listed via String.fromCharCode
// to keep literal control bytes out of the source file.
const CONTROL_CHARS = (() => {
  const codes = [];
  for (let i = 0; i <= 0x1f; i++) codes.push(i);
  codes.push(0x7f);
  return new Set(codes);
})();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Read with the user's session so RLS enforces "editor/owner or admin".
  const { data: doc, error: readErr } = await supabase
    .from("documents")
    .select("id, space_id, path")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (readErr || !doc) {
    return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const normalized = normalizePath(parsed.data.newPath);
  if (!normalized) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }
  if (normalized === doc.path) {
    return NextResponse.json({ ok: true, path: normalized, unchanged: true });
  }

  const admin = createServiceClient();

  // Collision check against the (space_id, path) unique constraint.
  const { data: collision } = await admin
    .from("documents")
    .select("id")
    .eq("space_id", doc.space_id)
    .eq("path", normalized)
    .is("deleted_at", null)
    .maybeSingle();
  if (collision) {
    return NextResponse.json({ error: "path_conflict" }, { status: 409 });
  }

  const { error: updErr } = await admin
    .from("documents")
    .update({ path: normalized })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "move",
    target_type: "document",
    target_id: id,
    metadata: { from: doc.path, to: normalized },
  });

  return NextResponse.json({ ok: true, path: normalized });
}

function normalizePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const segments = trimmed
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (seg === "." || seg === "..") return null;
    for (let i = 0; i < seg.length; i++) {
      if (CONTROL_CHARS.has(seg.charCodeAt(i))) return null;
    }
  }
  return segments.join("/");
}
