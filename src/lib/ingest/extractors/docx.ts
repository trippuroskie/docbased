import mammoth from "mammoth";
import TurndownService from "turndown";
import type { Extracted, ExtractedImage } from "../types";
import { cleanTitle } from "./md";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
});

// Strip Word's inline anchor/bookmark spans that turndown would otherwise
// preserve as empty links.
turndown.addRule("stripEmptyAnchors", {
  filter: (node) =>
    node.nodeName === "A" && !node.getAttribute("href") && !node.textContent?.trim(),
  replacement: () => "",
});

// Drop any <img> with no resolvable src — these are bookmark/anchor artifacts
// Word sometimes emits, and they'd otherwise produce `![]()` that crashes
// next/image in the renderer.
turndown.addRule("stripEmptySrcImages", {
  filter: (node) => {
    if (node.nodeName !== "IMG") return false;
    const src = node.getAttribute("src");
    return !src || src.trim() === "";
  },
  replacement: () => "",
});

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/x-emf": "emf",
  "image/x-wmf": "wmf",
};

export async function extractDocx(
  buffer: Buffer,
  filename: string,
): Promise<Extracted> {
  const images: ExtractedImage[] = [];

  const imageConverter = mammoth.images.imgElement(async (image) => {
    try {
      const buf = await image.readAsBuffer();
      const contentType = image.contentType || "application/octet-stream";
      const ext = CONTENT_TYPE_TO_EXT[contentType] ?? "bin";
      const n = images.length + 1;
      const path = `_assets/img-${n}.${ext}`;
      images.push({ path, buffer: buf, contentType });
      return { src: path };
    } catch {
      // Returning an empty src tells our turndown rule to drop the image.
      return { src: "" };
    }
  });

  const { value: html } = await mammoth.convertToHtml(
    { buffer },
    { convertImage: imageConverter },
  );
  const markdown = turndown.turndown(html).replace(/\r\n/g, "\n").trim();

  const rawH1 = extractFirstHeading(markdown);
  const cleaned = rawH1 ? cleanTitle(rawH1) : null;
  const title = cleaned || stripExt(filename);

  return {
    markdown,
    frontmatter: {},
    title,
    tags: [],
    images,
  };
}

function extractFirstHeading(md: string): string | null {
  const m = md.match(/^#{1,6}\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
