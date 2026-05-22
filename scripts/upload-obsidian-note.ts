// Upload a single Obsidian note + only the images it actually references.
//
// Walks up from the note path to find the vault root (the folder containing
// `.obsidian/`), parses `![[...]]` and `![](...)` references in the note,
// scans the vault recursively for image files matching those basenames, and
// pushes the .md + matched images through the same ingest pipeline the admin
// upload UI uses.
//
// Usage:
//   npm run upload-obsidian -- \
//     --note "/path/to/vault/Notes/Power BI - Semantic Model.md" \
//     --space it \
//     [--as tripp.uroskie@skullcandy.com] \
//     [--folder Notes/Power BI] \
//     [--tags powerbi,semantic-model] \
//     [--conflict replace|skip|version] \
//     [--vault /path/to/vault]   # only needed if note is outside any .obsidian/ vault

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// IMPORTANT: @/lib/ingest/pipeline transitively imports @/lib/env, which
// throws at module-load if env vars are missing. Defer until after dotenv
// runs above. Types are erased at runtime so they're safe to import statically.
import type { UploadAsset } from "@/lib/ingest/types";

const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
  ".tif", ".tiff", ".avif",
]);

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".avif": "image/avif",
};

const STD_IMG_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const OBSIDIAN_EMBED_RE = /!\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;

type Args = {
  note: string;
  space: string;
  as?: string;
  folder?: string;
  tags?: string;
  conflict: "replace" | "skip" | "version";
  vault?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { conflict: "replace" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--note":
        out.note = next;
        i++;
        break;
      case "--space":
        out.space = next;
        i++;
        break;
      case "--as":
        out.as = next;
        i++;
        break;
      case "--folder":
        out.folder = next;
        i++;
        break;
      case "--tags":
        out.tags = next;
        i++;
        break;
      case "--vault":
        out.vault = next;
        i++;
        break;
      case "--conflict":
        if (next === "replace" || next === "skip" || next === "version") {
          out.conflict = next;
        } else {
          throw new Error(`--conflict must be replace|skip|version, got ${next}`);
        }
        i++;
        break;
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (!out.note) throw new Error("--note is required");
  if (!out.space) throw new Error("--space is required");
  return out as Args;
}

async function findVaultRoot(notePath: string): Promise<string | null> {
  let dir = path.dirname(path.resolve(notePath));
  while (true) {
    try {
      const s = await stat(path.join(dir, ".obsidian"));
      if (s.isDirectory()) return dir;
    } catch {
      // not here, keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const ents = await readdir(root, { withFileTypes: true });
  for (const ent of ents) {
    if (ent.name === ".obsidian" || ent.name === ".trash") continue;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      yield* walkFiles(full);
    } else if (ent.isFile()) {
      yield full;
    }
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function extractReferencedImageBasenames(markdown: string): Set<string> {
  const refs = new Set<string>();
  for (const m of markdown.matchAll(STD_IMG_RE)) {
    const base = basename(safeDecode(m[1])).toLowerCase();
    if (IMAGE_EXTS.has(extOf(base))) refs.add(base);
  }
  for (const m of markdown.matchAll(OBSIDIAN_EMBED_RE)) {
    const base = basename(safeDecode(m[1].trim())).toLowerCase();
    if (IMAGE_EXTS.has(extOf(base))) refs.add(base);
  }
  return refs;
}

async function resolveAssetsInVault(
  vaultRoot: string,
  referencedBasenames: Set<string>,
): Promise<{ assets: UploadAsset[]; missing: string[] }> {
  if (referencedBasenames.size === 0) return { assets: [], missing: [] };

  const found = new Map<string, string>(); // lowercase basename -> absolute path
  for await (const file of walkFiles(vaultRoot)) {
    const b = basename(file).toLowerCase();
    if (referencedBasenames.has(b) && !found.has(b)) {
      found.set(b, file);
    }
    if (found.size === referencedBasenames.size) break;
  }

  const assets: UploadAsset[] = [];
  for (const [b, full] of found) {
    const buf = await readFile(full);
    assets.push({
      filename: basename(full),
      buffer: buf,
      contentType: CONTENT_TYPE_BY_EXT[extOf(b)] ?? "application/octet-stream",
    });
  }

  const missing: string[] = [];
  for (const b of referencedBasenames) {
    if (!found.has(b)) missing.push(b);
  }
  return { assets, missing };
}

type SbClient = ReturnType<typeof createClient<any, "public", "public">>;

async function resolveSpaceId(
  client: SbClient,
  spaceArg: string,
): Promise<string> {
  // Accept either a UUID or a slug.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spaceArg)) {
    return spaceArg;
  }
  const { data, error } = await client
    .from("spaces")
    .select("id")
    .eq("slug", spaceArg)
    .maybeSingle();
  if (error) throw new Error(`space lookup failed: ${error.message}`);
  if (!data) throw new Error(`no space with slug "${spaceArg}"`);
  return (data as { id: string }).id;
}

async function resolveUploaderId(
  client: SbClient,
  asArg: string | undefined,
): Promise<string> {
  if (asArg) {
    const { data, error } = await client
      .from("users")
      .select("id")
      .eq("email", asArg)
      .maybeSingle();
    if (error) throw new Error(`user lookup failed: ${error.message}`);
    if (!data) throw new Error(`no user with email "${asArg}"`);
    return (data as { id: string }).id;
  }
  // Default: first admin.
  const { data, error } = await client
    .from("users")
    .select("id")
    .eq("is_admin", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`admin lookup failed: ${error.message}`);
  if (!data) throw new Error("no admin user found; pass --as <email>");
  return (data as { id: string }).id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const notePath = path.resolve(args.note);
  try {
    const s = await stat(notePath);
    if (!s.isFile()) throw new Error(`not a file: ${notePath}`);
  } catch (e) {
    throw new Error(`cannot read note: ${notePath} (${(e as Error).message})`);
  }
  if (![".md", ".markdown"].includes(extOf(notePath))) {
    throw new Error(`expected a .md / .markdown file, got ${extOf(notePath)}`);
  }

  const vaultRoot =
    (args.vault && path.resolve(args.vault)) ??
    (await findVaultRoot(notePath));
  if (!vaultRoot) {
    throw new Error(
      `could not find vault root (no .obsidian/ folder found walking up from the note). Pass --vault explicitly.`,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) in .env.local",
    );
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const spaceId = await resolveSpaceId(client, args.space);
  const uploaderId = await resolveUploaderId(client, args.as);

  const noteBuf = await readFile(notePath);
  const markdown = noteBuf.toString("utf8");
  const referenced = extractReferencedImageBasenames(markdown);

  console.log(`vault: ${vaultRoot}`);
  console.log(`note:  ${notePath}`);
  console.log(`refs:  ${referenced.size} image reference(s)`);
  for (const r of referenced) console.log(`       - ${r}`);

  const { assets, missing } = await resolveAssetsInVault(vaultRoot, referenced);
  console.log(`found: ${assets.length} / ${referenced.size}`);
  if (missing.length) {
    console.log(`missing in vault:`);
    for (const m of missing) console.log(`       - ${m}`);
  }

  const tags = args.tags
    ? args.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  // Dynamic import: see note at top of file.
  const { ingestUpload } = await import("@/lib/ingest/pipeline");

  const results = await ingestUpload(
    {
      filename: basename(notePath),
      buffer: noteBuf,
      mimeType: "text/markdown",
      assets: assets.length ? assets : undefined,
    },
    {
      spaceId,
      uploaderId,
      tags,
      conflict: args.conflict,
      targetFolder: args.folder,
    },
  );

  console.log("");
  for (const r of results) {
    console.log(
      `[${r.status}] ${r.path}${r.chunkCount ? ` (${r.chunkCount} chunks)` : ""}${r.message ? ` — ${r.message}` : ""}`,
    );
  }
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
