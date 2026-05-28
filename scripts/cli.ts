// docbased CLI — query spaces, docs, chunks, and ask the knowledge base.
// Usage:
//   npm run docbased -- <command> [args]
//
// Commands:
//   spaces                                  List accessible spaces
//   search <query> [--space slug] [--limit N] [--rerank]
//   doc get <id|space-slug/path>
//   doc list [--space slug] [--limit N] [--cursor STR]
//   doc save --space slug --title "..." [--path p] [--tags a,b]
//            [--conflict replace|skip|version] [--file f|--content "..."|stdin]
//            [--agent-name name] [--no-agent-marker] [--as email]
//   chunk get <id>
//   chunk neighbors <id> [--window N]
//   ask <question> [--space slug] [--limit N] [--model M]
//   import <folder> --space slug [--folder prefix] [--ext md,markdown,txt,docx]
//                   [--tags a,b] [--conflict replace|skip|version] [--no-recurse]
//                   [--vault path] [--no-vault] [--as email] [--dry-run]
//                   Resolves images referenced by ![[...]] or ![](...) and
//                   uploads them as assets alongside each note. Image source:
//                   --vault if given, else any .obsidian/ ancestor, else
//                   <folder> itself. --no-vault skips image resolution.
//
// Global flags:
//   --format json|text   (default json)
//   --mode service|user|auto   (default auto; user mode if DOCBASED_EMAIL+PASSWORD set)
//   -h, --help

import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

import { parseArgs } from "node:util";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

import {
  callerEnvFromProcessEnv,
  resolveCaller,
  type ResolvedCaller,
} from "@/lib/core/auth";
import { searchCore, type SearchHit } from "@/lib/core/search";
import {
  getDocument,
  listDocuments,
  listSpaces,
  getChunk,
  getChunkNeighbors,
} from "@/lib/core/docs";
import { embedOne } from "@/lib/core/embed";
import { buildContextBlock, SYSTEM_PROMPT } from "@/lib/core/prompt";
import { writeAuditLog } from "@/lib/core/audit";
import { createDocument } from "@/lib/core/save";
import type { UploadAsset } from "@/lib/ingest/types";

const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
const DEFAULT_CHAT_MODEL =
  process.env.DEFAULT_CHAT_MODEL ?? "anthropic/claude-sonnet-4.5";
const RERANKER_MODEL = process.env.RERANKER_MODEL ?? "cohere/rerank-3.5";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://docbased.local";

type GlobalFlags = {
  format: "json" | "text";
};

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    printHelp();
    process.exit(0);
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  try {
    switch (cmd) {
      case "spaces":
        return await cmdSpaces(rest);
      case "search":
        return await cmdSearch(rest);
      case "doc":
        return await cmdDoc(rest);
      case "chunk":
        return await cmdChunk(rest);
      case "ask":
        return await cmdAsk(rest);
      case "import":
        return await cmdImport(rest);
      default:
        fail(`Unknown command: ${cmd}. Run with --help.`);
    }
  } catch (err) {
    fail((err as Error).message ?? String(err));
  }
}

// ───────────────────────── commands ─────────────────────────

async function cmdSpaces(rest: string[]) {
  const { values } = parseArgs({
    args: rest,
    options: { format: { type: "string", default: "json" } },
    allowPositionals: false,
  });
  const flags = pickGlobal(values);
  const caller = await resolveCaller(callerEnvFromProcessEnv());
  const spaces = await listSpaces(caller.serviceClient, {
    accessibleSpaceIds: caller.accessibleSpaceIds,
  });

  if (flags.format === "text") {
    for (const s of spaces) {
      console.log(`${s.slug.padEnd(24)} ${s.name}`);
    }
    return;
  }
  output({ mode: caller.mode, count: spaces.length, spaces });
}

async function cmdSearch(rest: string[]) {
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      space: { type: "string" },
      limit: { type: "string" },
      rerank: { type: "boolean", default: false },
      format: { type: "string", default: "json" },
    },
    allowPositionals: true,
  });
  const flags = pickGlobal(values);
  const query = positionals.join(" ").trim();
  if (!query) fail("search: query is required.");

  const caller = await resolveCaller(callerEnvFromProcessEnv());
  const scopeSpaceIds = await resolveSpaceScope(caller, values.space);
  const queryEmbedding = await embedQuery(query);
  const limit = values.limit ? Number(values.limit) : 20;

  const hits = await searchCore(caller.serviceClient, query, {
    accessibleSpaceIds: caller.accessibleSpaceIds,
    spaceNamesById: caller.spaceNamesById,
    scopeSpaceIds,
    limit,
    rerank: values.rerank,
    queryEmbedding,
    openrouterApiKey: requireOpenrouterKey(),
    rerankerModel: RERANKER_MODEL,
    appUrl: APP_URL,
  });

  await audit(caller, "search", "query", null, {
    query,
    limit,
    rerank: Boolean(values.rerank),
    space_slug: values.space ?? null,
    hits: hits.length,
  });

  if (flags.format === "text") {
    printSearchHitsText(hits);
    return;
  }
  output({ query, count: hits.length, hits });
}

async function cmdDoc(rest: string[]) {
  const sub = rest[0];
  const subRest = rest.slice(1);
  if (sub === "get") return cmdDocGet(subRest);
  if (sub === "list") return cmdDocList(subRest);
  if (sub === "save") return cmdDocSave(subRest);
  fail(
    `doc: unknown subcommand '${sub ?? ""}'. Try 'doc get', 'doc list', or 'doc save'.`,
  );
}

async function cmdDocGet(rest: string[]) {
  const { values, positionals } = parseArgs({
    args: rest,
    options: { format: { type: "string", default: "json" } },
    allowPositionals: true,
  });
  const flags = pickGlobal(values);
  const ref = positionals[0];
  if (!ref) fail("doc get: id or space-slug/path is required.");

  const caller = await resolveCaller(callerEnvFromProcessEnv());

  let doc;
  if (isUuid(ref)) {
    doc = await getDocument(
      caller.serviceClient,
      { id: ref },
      { accessibleSpaceIds: caller.accessibleSpaceIds },
    );
  } else {
    const [slug, ...pathParts] = ref.split("/");
    const path = pathParts.join("/");
    if (!slug || !path) {
      fail("doc get: expected <uuid> or <space-slug>/<path>.");
    }
    const space = (
      await listSpaces(caller.serviceClient, {
        accessibleSpaceIds: caller.accessibleSpaceIds,
      })
    ).find((s) => s.slug === slug);
    if (!space) fail(`doc get: no accessible space with slug '${slug}'.`);
    doc = await getDocument(
      caller.serviceClient,
      { spaceId: space.id, path },
      { accessibleSpaceIds: caller.accessibleSpaceIds },
    );
  }
  if (!doc) fail("doc get: not found or not accessible.");

  await audit(caller, "read", "document", doc.id, {
    path: doc.path,
    status: doc.status,
  });

  if (flags.format === "text") {
    console.log(`# ${doc.title}`);
    console.log(`path: ${doc.path}   status: ${doc.status}`);
    if (doc.tags.length) console.log(`tags: ${doc.tags.join(", ")}`);
    console.log("");
    console.log(doc.rawContent ?? "(no content)");
    return;
  }
  output({ document: doc });
}

async function cmdDocList(rest: string[]) {
  const { values } = parseArgs({
    args: rest,
    options: {
      space: { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
      format: { type: "string", default: "json" },
    },
    allowPositionals: false,
  });
  const flags = pickGlobal(values);
  const caller = await resolveCaller(callerEnvFromProcessEnv());
  const spaceScope = await resolveSpaceScope(caller, values.space);
  const result = await listDocuments(caller.serviceClient, {
    spaceId: spaceScope?.length === 1 ? spaceScope[0] : undefined,
    accessibleSpaceIds: spaceScope ?? caller.accessibleSpaceIds,
    limit: values.limit ? Number(values.limit) : 25,
    cursor: values.cursor,
  });

  await audit(caller, "list", "document", null, {
    space_slug: values.space ?? null,
    returned: result.items.length,
    has_more: result.nextCursor !== null,
  });

  if (flags.format === "text") {
    for (const d of result.items) {
      const space = caller.spaceNamesById.get(d.spaceId) ?? "?";
      console.log(`${d.id}  [${space}]  ${d.title}  —  ${d.path}`);
    }
    if (result.nextCursor) {
      console.log(`\n# next cursor: ${result.nextCursor}`);
    }
    return;
  }
  output(result);
}

async function cmdDocSave(rest: string[]) {
  const { values, positionals: _ } = parseArgs({
    args: rest,
    options: {
      space: { type: "string" },
      title: { type: "string" },
      path: { type: "string" },
      tags: { type: "string" },
      conflict: { type: "string", default: "version" },
      file: { type: "string" },
      content: { type: "string" },
      "agent-name": { type: "string" },
      "no-agent-marker": { type: "boolean", default: false },
      as: { type: "string" },
      format: { type: "string", default: "json" },
    },
    allowPositionals: true,
  });
  const flags = pickGlobal(values);

  if (!values.space) fail("doc save: --space <slug> is required.");
  if (!values.title) fail("doc save: --title is required.");

  const conflict = values.conflict as "replace" | "skip" | "version";
  if (!["replace", "skip", "version"].includes(conflict)) {
    fail(`doc save: --conflict must be replace|skip|version, got '${conflict}'.`);
  }

  // Content priority: --content > --file > stdin.
  let content: string;
  if (typeof values.content === "string") {
    content = values.content;
  } else if (typeof values.file === "string") {
    const filePath = path.resolve(
      process.env.DOCBASED_INVOCATION_CWD ?? process.cwd(),
      values.file,
    );
    content = (await readFile(filePath)).toString("utf8");
  } else {
    content = await readAllStdin();
    if (!content.trim()) {
      fail(
        "doc save: no content provided. Pass --content, --file, or pipe markdown to stdin.",
      );
    }
  }

  const caller = await resolveCaller(callerEnvFromProcessEnv());
  const spaces = await listSpaces(caller.serviceClient, {
    accessibleSpaceIds: caller.accessibleSpaceIds,
  });
  const space = spaces.find((s) => s.slug === values.space);
  if (!space) fail(`doc save: no accessible space with slug '${values.space}'.`);

  const uploaderId = await resolveUploaderId(caller, values.as);

  const tags = values.tags
    ? (values.tags as string).split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const result = await createDocument(caller.serviceClient, {
    spaceId: space.id,
    uploaderId,
    title: values.title as string,
    content,
    path: values.path as string | undefined,
    tags,
    conflict,
    markAsAgent: !values["no-agent-marker"],
    agentName: (values["agent-name"] as string | undefined) ?? "cli",
    source: "cli",
    embedding: {
      apiKey: requireOpenrouterKey(),
      model: EMBEDDING_MODEL,
      appUrl: APP_URL,
    },
  });

  if (flags.format === "text") {
    console.log(`[${result.status}] ${result.path}`);
    console.log(`document_id: ${result.documentId}`);
    if (result.chunkCount) console.log(`chunks: ${result.chunkCount}`);
    return;
  }
  output({ space: values.space, ...result });
}

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function cmdChunk(rest: string[]) {
  const sub = rest[0];
  const subRest = rest.slice(1);
  if (sub === "get") return cmdChunkGet(subRest);
  if (sub === "neighbors") return cmdChunkNeighbors(subRest);
  fail(`chunk: unknown subcommand '${sub ?? ""}'. Try 'chunk get' or 'chunk neighbors'.`);
}

async function cmdChunkGet(rest: string[]) {
  const { values, positionals } = parseArgs({
    args: rest,
    options: { format: { type: "string", default: "json" } },
    allowPositionals: true,
  });
  const flags = pickGlobal(values);
  const id = positionals[0];
  if (!id) fail("chunk get: id is required.");

  const caller = await resolveCaller(callerEnvFromProcessEnv());
  const chunk = await getChunk(caller.serviceClient, id, {
    accessibleSpaceIds: caller.accessibleSpaceIds,
  });
  if (!chunk) fail("chunk get: not found or not accessible.");

  await audit(caller, "read", "chunk", chunk.id, {
    document_id: chunk.documentId,
    ordinal: chunk.ordinal,
  });

  if (flags.format === "text") {
    console.log(`# ${chunk.documentTitle} — ordinal ${chunk.ordinal}`);
    if (chunk.headingPath.length) {
      console.log(`heading: ${chunk.headingPath.join(" → ")}`);
    }
    console.log("");
    console.log(chunk.content);
    return;
  }
  output({ chunk });
}

async function cmdChunkNeighbors(rest: string[]) {
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      window: { type: "string" },
      format: { type: "string", default: "json" },
    },
    allowPositionals: true,
  });
  const flags = pickGlobal(values);
  const id = positionals[0];
  if (!id) fail("chunk neighbors: id is required.");

  const caller = await resolveCaller(callerEnvFromProcessEnv());
  const chunks = await getChunkNeighbors(caller.serviceClient, id, {
    window: values.window ? Number(values.window) : 1,
    accessibleSpaceIds: caller.accessibleSpaceIds,
  });

  await audit(caller, "read", "chunk", id, {
    window: values.window ? Number(values.window) : 1,
    returned: chunks.length,
  });

  if (flags.format === "text") {
    for (const c of chunks) {
      console.log(`--- ordinal ${c.ordinal} ---`);
      console.log(c.content);
      console.log("");
    }
    return;
  }
  output({ count: chunks.length, chunks });
}

async function cmdAsk(rest: string[]) {
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      space: { type: "string" },
      limit: { type: "string" },
      model: { type: "string" },
      format: { type: "string", default: "text" },
    },
    allowPositionals: true,
  });
  const flags = pickGlobal(values);
  const question = positionals.join(" ").trim();
  if (!question) fail("ask: question is required.");

  const caller = await resolveCaller(callerEnvFromProcessEnv());
  const scopeSpaceIds = await resolveSpaceScope(caller, values.space);
  const queryEmbedding = await embedQuery(question);

  const hits = await searchCore(caller.serviceClient, question, {
    accessibleSpaceIds: caller.accessibleSpaceIds,
    spaceNamesById: caller.spaceNamesById,
    scopeSpaceIds,
    limit: values.limit ? Number(values.limit) : 8,
    rerank: true,
    queryEmbedding,
    openrouterApiKey: requireOpenrouterKey(),
    rerankerModel: RERANKER_MODEL,
    appUrl: APP_URL,
  });

  const { context, sources } = buildContextBlock(hits);
  const model = values.model ?? DEFAULT_CHAT_MODEL;

  const client = new OpenAI({
    apiKey: requireOpenrouterKey(),
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": APP_URL,
      "X-Title": "docbased-cli",
    },
  });
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: `Context retrieved for this question:\n\n${context}`,
      },
      { role: "user", content: question },
    ],
  });
  const answer = completion.choices[0]?.message?.content ?? "";

  await audit(caller, "ask", "query", null, {
    question,
    model,
    space_slug: values.space ?? null,
    hits: hits.length,
    sources: sources.length,
  });

  if (flags.format === "json") {
    output({ question, model, answer, sources, hits });
    return;
  }
  console.log(answer);
  if (sources.length) {
    console.log("\nSources:");
    for (const s of sources) {
      console.log(`  [${s.n}] ${s.title}`);
    }
  }
}

async function cmdImport(rest: string[]) {
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      space: { type: "string" },
      folder: { type: "string" },
      tags: { type: "string" },
      conflict: { type: "string", default: "replace" },
      ext: { type: "string", default: "md,markdown" },
      "no-recurse": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      vault: { type: "string" },
      "no-vault": { type: "boolean", default: false },
      as: { type: "string" },
      format: { type: "string", default: "json" },
    },
    allowPositionals: true,
  });
  const flags = pickGlobal(values);

  const dir = positionals[0];
  if (!dir) fail("import: <folder> path is required.");
  if (!values.space) fail("import: --space <slug> is required.");

  const conflict = values.conflict as "replace" | "skip" | "version";
  if (!["replace", "skip", "version"].includes(conflict)) {
    fail(`import: --conflict must be replace|skip|version, got '${conflict}'.`);
  }

  const allowedExts = new Set(
    (values.ext as string)
      .split(",")
      .map((e) => "." + e.trim().toLowerCase().replace(/^\./, ""))
      .filter((e) => e !== "."),
  );

  // When invoked via the `docbased` bin wrapper, cwd is forced to the project
  // root so dotenv + tsx path aliases work; the original cwd is preserved here
  // so relative folder arguments still resolve where the user expects.
  const invocationCwd = process.env.DOCBASED_INVOCATION_CWD ?? process.cwd();
  const root = path.resolve(invocationCwd, dir);
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    fail(`import: not a directory: ${root}`);
  }

  const files = await collectFiles(root, allowedExts, !values["no-recurse"]);

  const relFiles = files.map((f) => toPosix(path.relative(root, f)));

  if (values["dry-run"]) {
    if (flags.format === "text") {
      for (const r of relFiles) console.log(r);
      console.log(`\n${relFiles.length} file(s) would be imported.`);
      return;
    }
    output({
      dryRun: true,
      folder: root,
      space: values.space,
      targetFolder: values.folder ?? "",
      count: relFiles.length,
      files: relFiles,
    });
    return;
  }

  if (files.length === 0) {
    if (flags.format === "text") {
      console.log(`No files matching .${[...allowedExts].join(", .")} under ${root}.`);
      return;
    }
    output({ ok: true, folder: root, count: 0, results: [] });
    return;
  }

  // Image-source resolution: when a note references an image, we need a root
  // directory to walk for that image. Priority:
  //   1. --vault <path>    → user-asserted root
  //   2. .obsidian/ ancestor of <folder> → actual Obsidian vault
  //   3. <folder> itself   → "plain folder with images next to notes"
  // --no-vault disables all of the above.
  let imageRoot: string | null = null;
  let imageRootKind: "vault" | "folder" | null = null;
  let imageIndex: Map<string, string> | null = null;
  if (!values["no-vault"]) {
    if (values.vault) {
      imageRoot = path.resolve(invocationCwd, values.vault as string);
      imageRootKind = "vault";
    } else {
      const detected = await findVaultRoot(root);
      if (detected) {
        imageRoot = detected;
        imageRootKind = "vault";
      } else {
        imageRoot = root;
        imageRootKind = "folder";
      }
    }
    imageIndex = await buildVaultImageIndex(imageRoot);
    if (flags.format === "text" && imageIndex.size > 0) {
      const label = imageRootKind === "vault" ? "vault" : "image source";
      console.log(
        `${label}: ${imageRoot} (${imageIndex.size} image(s) indexed)`,
      );
    }
  }

  const caller = await resolveCaller(callerEnvFromProcessEnv());
  const spaces = await listSpaces(caller.serviceClient, {
    accessibleSpaceIds: caller.accessibleSpaceIds,
  });
  const space = spaces.find((s) => s.slug === values.space);
  if (!space) fail(`import: no accessible space with slug '${values.space}'.`);

  const uploaderId = await resolveUploaderId(caller, values.as);

  const tags = values.tags
    ? (values.tags as string).split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const targetFolderArg = (values.folder as string | undefined) ?? "";

  // Defer to dotenv-after-import: env.ts throws at module load if vars missing.
  const { ingestUpload } = await import("@/lib/ingest/pipeline");

  const results: Array<{
    source: string;
    documentId?: string;
    path?: string;
    status?: string;
    chunkCount?: number;
    tier?: string;
    assets?: number;
    missingAssets?: string[];
    error?: string;
  }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rel = relFiles[i];
    const buf = await readFile(file);
    const filename = path.posix.basename(rel);
    const relDir = path.posix.dirname(rel);
    const effectiveFolder = joinPosixFolder(
      targetFolderArg,
      relDir === "." ? "" : relDir,
    );

    let assets: UploadAsset[] | undefined;
    let missing: string[] = [];
    if (imageIndex && isMarkdownFilename(filename)) {
      const refs = extractImageRefs(buf.toString("utf8"));
      const resolved = await resolveVaultAssets(imageIndex, refs);
      assets = resolved.assets.length ? resolved.assets : undefined;
      missing = resolved.missing;
    }

    try {
      const out = await ingestUpload(
        { filename, buffer: buf, assets },
        {
          spaceId: space.id,
          uploaderId,
          tags,
          conflict,
          targetFolder: effectiveFolder,
        },
      );
      for (const r of out) {
        results.push({
          source: rel,
          documentId: r.documentId,
          path: r.path,
          status: r.status,
          chunkCount: r.chunkCount,
          tier: r.tier,
          assets: assets?.length,
          missingAssets: missing.length ? missing : undefined,
        });
        if (flags.format === "text") {
          const chunks = r.chunkCount ? ` (${r.chunkCount} chunks)` : "";
          const imgs = assets?.length ? ` +${assets.length} image(s)` : "";
          console.log(`[${r.status}] ${rel} → ${r.path}${chunks}${imgs}`);
          for (const m of missing) {
            console.log(`         missing image: ${m}`);
          }
        }
      }
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      results.push({ source: rel, error: message });
      if (flags.format === "text") {
        console.log(`[error] ${rel}: ${message}`);
      }
    }
  }

  await audit(caller, "import", "document", null, {
    folder: root,
    space_slug: values.space,
    target_folder: targetFolderArg || null,
    image_root: imageRoot,
    image_root_kind: imageRootKind,
    count: results.length,
    errors: results.filter((r) => r.error).length,
  });

  if (flags.format === "text") {
    const errs = results.filter((r) => r.error).length;
    console.log(
      `\nimported ${results.length - errs} file(s)${errs ? `, ${errs} error(s)` : ""}.`,
    );
    return;
  }
  output({
    space: values.space,
    folder: root,
    targetFolder: targetFolderArg || null,
    imageRoot,
    imageRootKind,
    count: results.length,
    results,
  });
}

// ───────────────────────── helpers ─────────────────────────

function pickGlobal(values: Record<string, unknown>): GlobalFlags {
  const fmt = (values.format as string) ?? "json";
  if (fmt !== "json" && fmt !== "text") {
    fail(`--format must be 'json' or 'text', got '${fmt}'.`);
  }
  return { format: fmt };
}

function audit(
  caller: ResolvedCaller,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
) {
  return writeAuditLog(caller.serviceClient, {
    actorId: caller.userId,
    action,
    targetType,
    targetId,
    source: "cli",
    metadata: { ...metadata, mode: caller.mode },
  });
}

// ───────────────────────── obsidian vault helpers ─────────────────────────

const VAULT_IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
  ".tif", ".tiff", ".avif",
]);

const VAULT_IMAGE_CONTENT_TYPES: Record<string, string> = {
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

// `![alt](path "title")` — standard markdown image
const STD_IMG_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// `![[Image.png|alt#anchor]]` — Obsidian embed
const OBSIDIAN_EMBED_RE = /!\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;

function isMarkdownFilename(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

function imageBasename(p: string): string {
  // Tolerate both POSIX and Windows separators inside the reference.
  return p.split(/[\\/]/).pop() ?? p;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function findVaultRoot(start: string): Promise<string | null> {
  let dir = path.resolve(start);
  while (true) {
    const marker = path.join(dir, ".obsidian");
    const s = await stat(marker).catch(() => null);
    if (s?.isDirectory()) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function buildVaultImageIndex(
  vaultRoot: string,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  async function walk(dir: string) {
    const ents = await readdir(dir, { withFileTypes: true });
    for (const ent of ents) {
      if (ent.name === ".obsidian" || ent.name === ".trash") continue;
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (VAULT_IMAGE_EXTS.has(ext)) {
          const key = ent.name.toLowerCase();
          // First-wins: keep the deterministic match for duplicate basenames.
          if (!index.has(key)) index.set(key, full);
        }
      }
    }
  }
  await walk(vaultRoot);
  return index;
}

function extractImageRefs(markdown: string): Set<string> {
  const refs = new Set<string>();
  for (const m of markdown.matchAll(STD_IMG_RE)) {
    const base = imageBasename(safeDecode(m[1])).toLowerCase();
    if (VAULT_IMAGE_EXTS.has(path.extname(base))) refs.add(base);
  }
  for (const m of markdown.matchAll(OBSIDIAN_EMBED_RE)) {
    const base = imageBasename(safeDecode(m[1].trim())).toLowerCase();
    if (VAULT_IMAGE_EXTS.has(path.extname(base))) refs.add(base);
  }
  return refs;
}

async function resolveVaultAssets(
  index: Map<string, string>,
  refs: Set<string>,
): Promise<{ assets: UploadAsset[]; missing: string[] }> {
  const assets: UploadAsset[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const abs = index.get(ref);
    if (!abs) {
      missing.push(ref);
      continue;
    }
    const buf = await readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    assets.push({
      filename: path.basename(abs),
      buffer: buf,
      contentType: VAULT_IMAGE_CONTENT_TYPES[ext] ?? "application/octet-stream",
    });
  }
  return { assets, missing };
}

// ───────────────────────── filesystem helpers ─────────────────────────

async function collectFiles(
  root: string,
  allowedExts: Set<string>,
  recurse: boolean,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const ents = await readdir(dir, { withFileTypes: true });
    for (const ent of ents) {
      // Skip dotfolders (.git, .obsidian, .trash, .DS_Store, etc.).
      if (ent.name.startsWith(".")) continue;
      if (ent.name === "node_modules") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (recurse) await walk(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (allowedExts.has(ext)) out.push(full);
      }
    }
  }
  await walk(root);
  return out.sort();
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function joinPosixFolder(a: string, b: string): string {
  const clean = (s: string) => s.replace(/^\/+|\/+$/g, "").trim();
  const ca = clean(a);
  const cb = clean(b);
  if (!ca) return cb;
  if (!cb) return ca;
  return `${ca}/${cb}`;
}

async function resolveUploaderId(
  caller: ResolvedCaller,
  asEmail: string | undefined,
): Promise<string> {
  if (asEmail) {
    const { data, error } = await caller.serviceClient
      .from("users")
      .select("id")
      .eq("email", asEmail)
      .maybeSingle();
    if (error) fail(`user lookup failed: ${error.message}`);
    if (!data) fail(`no user with email '${asEmail}'.`);
    return (data as { id: string }).id;
  }
  if (caller.userId) return caller.userId;
  // Service mode without --as: fall back to first admin (same as upload-obsidian).
  const { data, error } = await caller.serviceClient
    .from("users")
    .select("id")
    .eq("is_admin", true)
    .limit(1)
    .maybeSingle();
  if (error) fail(`admin lookup failed: ${error.message}`);
  if (!data) fail("no admin user found; pass --as <email>.");
  return (data as { id: string }).id;
}

async function resolveSpaceScope(
  caller: ResolvedCaller,
  slug: string | undefined,
): Promise<string[] | undefined> {
  if (!slug) return undefined;
  const spaces = await listSpaces(caller.serviceClient, {
    accessibleSpaceIds: caller.accessibleSpaceIds,
  });
  const match = spaces.find((s) => s.slug === slug);
  if (!match) fail(`No accessible space with slug '${slug}'.`);
  return [match.id];
}

async function embedQuery(text: string): Promise<number[]> {
  return embedOne(
    {
      apiKey: requireOpenrouterKey(),
      model: EMBEDDING_MODEL,
      appUrl: APP_URL,
    },
    text,
  );
}

function requireOpenrouterKey(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) fail("OPENROUTER_API_KEY is required.");
  return k;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function output(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(msg: string): never {
  process.stderr.write(
    JSON.stringify({ error: { message: msg } }) + "\n",
  );
  process.exit(1);
}

function printSearchHitsText(hits: SearchHit[]) {
  for (const h of hits) {
    const heading = h.headingPath.length
      ? ` (${h.headingPath.join(" → ")})`
      : "";
    console.log(`[${h.score.toFixed(3)}] ${h.documentTitle}${heading}`);
    console.log(`  ${h.spaceName} :: ${h.documentPath}`);
    console.log(`  chunk: ${h.chunkId}`);
    const preview = h.content.replace(/\s+/g, " ").slice(0, 200);
    console.log(`  ${preview}${h.content.length > 200 ? "…" : ""}`);
    console.log("");
  }
}

function printHelp() {
  process.stdout.write(`docbased CLI

Usage:
  npm run docbased -- <command> [args]

Commands:
  spaces                                       List accessible spaces
  search <query> [--space slug] [--limit N] [--rerank]
  doc get <id|space-slug/path>
  doc list [--space slug] [--limit N] [--cursor STR]
  doc save --space slug --title "..." [--path p] [--tags a,b]
           [--conflict replace|skip|version] [--file f|--content "..."|stdin]
           [--agent-name name] [--no-agent-marker] [--as email]
  chunk get <id>
  chunk neighbors <id> [--window N]
  ask <question> [--space slug] [--limit N] [--model M]
  import <folder> --space slug [--folder prefix] [--ext md,markdown,txt,docx]
                  [--tags a,b] [--conflict replace|skip|version] [--no-recurse]
                  [--vault path] [--no-vault] [--as email] [--dry-run]
                  (Resolves ![[...]] and ![](...) image refs and uploads them
                  as assets. Image source: --vault if given, else a .obsidian/
                  ancestor, else <folder> itself. --no-vault skips this.)

Global flags:
  --format json|text     (search/spaces/doc/chunk/import default json; ask defaults text)
  -h, --help

Auth (env):
  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
  OPENROUTER_API_KEY
  DOCBASED_EMAIL + DOCBASED_PASSWORD   (optional, switches to user mode)
  DOCBASED_MODE=service|user|auto       (default auto)
`);
}

main();
