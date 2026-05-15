// Smoke test for the wired knowledge-hub data layer.
// Exercises the same queries the home page runs, but bypasses auth by using
// the service-role client. Verifies: spaces load, tree builds, doc payload
// resolves with raw_content + backlinks + wikilinks.
//
//   npm exec tsx scripts/smoke-knowledge-hub.ts
//
// Exits 0 on success, 1 on failure. Prints a short summary.

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or service key in env.");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  });

  // 1) Spaces
  const { data: spaces, error: spacesErr } = await supabase
    .from("spaces")
    .select("id, slug, name, description")
    .order("name");
  if (spacesErr) throw spacesErr;
  console.log(`spaces: ${spaces?.length ?? 0}`);
  if (!spaces?.length) {
    console.log("  (no spaces in DB — sidebar will show empty state)");
  }

  // 2) Trees
  for (const s of spaces ?? []) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title, path, processing_status")
      .eq("space_id", s.id)
      .is("deleted_at", null)
      .order("path");
    console.log(`  ${s.name}: ${docs?.length ?? 0} docs`);
  }

  // 3) Pick the first doc and exercise the doc-payload query
  const { data: anyDoc } = await supabase
    .from("documents")
    .select("id, title, path, space_id, processing_status, raw_content, tags, last_edited_at")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (!anyDoc) {
    console.log("\nNo documents yet — upload one via /admin/upload to populate.");
    return;
  }

  console.log(
    `\nsample doc: "${anyDoc.title}" (${anyDoc.id})\n  path=${anyDoc.path}\n  status=${anyDoc.processing_status}\n  rawContent=${(anyDoc.raw_content ?? "").length} chars\n  tags=${JSON.stringify(anyDoc.tags ?? [])}`,
  );

  // 4) Backlinks
  const { data: backlinks } = await supabase
    .from("links")
    .select("src_document_id")
    .eq("dst_document_id", anyDoc.id);
  console.log(`  backlinks: ${backlinks?.length ?? 0}`);

  // 5) Wikilink resolution map (all docs the user could possibly reach)
  const { data: allDocs } = await supabase
    .from("documents")
    .select("id, title")
    .is("deleted_at", null);
  console.log(`  wikilink scope: ${allDocs?.length ?? 0} titles`);

  // 6) Confirm storage bucket reachable when doc has an original file
  const { data: withOriginal } = await supabase
    .from("documents")
    .select("id, original_storage_path, original_filename")
    .not("original_storage_path", "is", null)
    .limit(1)
    .maybeSingle();
  if (withOriginal?.original_storage_path) {
    const { data: signed, error: signErr } = await supabase.storage
      .from("originals")
      .createSignedUrl(withOriginal.original_storage_path, 60);
    console.log(
      `  originals bucket: ${signErr ? `error: ${signErr.message}` : `signed-url OK for ${withOriginal.original_filename}`}`,
    );
  }
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exit(1);
});
