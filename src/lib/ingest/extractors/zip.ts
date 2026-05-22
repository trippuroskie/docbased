import JSZip from "jszip";
import { extractMarkdown } from "./md";
import { extractText } from "./txt";
import { extractDocx } from "./docx";
import { extensionOf, type Extracted, type UploadAsset } from "../types";

export type ZipEntry = {
  /** Folder path inside the zip, used for the document tree (e.g. "Networking/VLANs/Site VPN"). */
  path: string;
  filename: string;
  extracted: Extracted;
  sourceFormat: "md" | "txt" | "docx";
};

export type ZipResult = {
  entries: ZipEntry[];
  skipped: { name: string; reason: string }[];
};

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

export async function extractZip(buffer: Buffer): Promise<ZipResult> {
  const zip = await JSZip.loadAsync(buffer);
  const entries: ZipEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];

  // Pass 1: collect candidate image assets from the zip. We match them to
  // markdown entries by basename in pass 2, the same way the .md extractor
  // does for direct multi-file uploads.
  const imageAssets: UploadAsset[] = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (shouldSkipNoise(name)) continue;
    const ext = extensionOf(name);
    if (!IMAGE_EXTS.has(ext)) continue;
    const baseName = name.split("/").pop() ?? name;
    const buf = Buffer.from(await file.async("uint8array"));
    imageAssets.push({
      filename: baseName,
      buffer: buf,
      contentType: CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream",
    });
  }

  // Pass 2: process text entries, passing the image pool through to the
  // markdown extractor so it can rewrite references and attach matched images.
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (shouldSkipNoise(name)) continue;

    const ext = extensionOf(name);
    if (IMAGE_EXTS.has(ext)) continue; // handled in pass 1

    const innerBuf = Buffer.from(await file.async("uint8array"));
    const baseName = name.split("/").pop() ?? name;
    const folderPath = name.includes("/")
      ? name.slice(0, name.lastIndexOf("/"))
      : "";
    const treePath = folderPath
      ? `${folderPath}/${stripExt(baseName)}`
      : stripExt(baseName);

    if (ext === ".md" || ext === ".markdown") {
      entries.push({
        path: treePath,
        filename: baseName,
        extracted: extractMarkdown(innerBuf, baseName, imageAssets),
        sourceFormat: "md",
      });
    } else if (ext === ".txt") {
      entries.push({
        path: treePath,
        filename: baseName,
        extracted: extractText(innerBuf, baseName),
        sourceFormat: "txt",
      });
    } else if (ext === ".docx") {
      entries.push({
        path: treePath,
        filename: baseName,
        extracted: await extractDocx(innerBuf, baseName),
        sourceFormat: "docx",
      });
    } else {
      // v1: skip non-text files inside zip. v1.5 will surface these as Tier 2 documents.
      skipped.push({ name, reason: `non-text file (${ext || "no ext"})` });
    }
  }

  disambiguateTitles(entries);

  return { entries, skipped };
}

function shouldSkipNoise(name: string): boolean {
  // Skip macOS / Obsidian metadata noise.
  if (name.includes("__MACOSX") || name.endsWith(".DS_Store")) return true;
  if (name.startsWith(".obsidian/") || name.includes("/.obsidian/")) return true;
  return false;
}

/**
 * Obsidian-style vaults often share boilerplate H1s across many notes (e.g.
 * every daily note starts with `# To do`). The first-heading-as-title heuristic
 * then produces N documents with identical titles. When that happens, prefer
 * the filename for the colliding entries — it's almost always the real title.
 */
function disambiguateTitles(entries: ZipEntry[]) {
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.extracted.title, (counts.get(e.extracted.title) ?? 0) + 1);
  }
  for (const e of entries) {
    if ((counts.get(e.extracted.title) ?? 0) > 1) {
      e.extracted.title = stripExt(e.filename);
    }
  }
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
