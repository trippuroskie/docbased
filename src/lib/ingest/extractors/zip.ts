import JSZip from "jszip";
import { extractMarkdown } from "./md";
import { extractText } from "./txt";
import { extractDocx } from "./docx";
import { extensionOf, type Extracted } from "../types";

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

export async function extractZip(buffer: Buffer): Promise<ZipResult> {
  const zip = await JSZip.loadAsync(buffer);
  const entries: ZipEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    // Skip macOS/Obsidian metadata noise.
    if (name.includes("__MACOSX") || name.endsWith(".DS_Store")) continue;
    if (name.startsWith(".obsidian/") || name.includes("/.obsidian/")) continue;

    const ext = extensionOf(name);
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
        extracted: extractMarkdown(innerBuf, baseName),
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

  return { entries, skipped };
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
