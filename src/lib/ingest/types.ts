export type Tier = "indexed" | "metadata_only";

export type ExtractedImage = {
  /** Path used as the image src in the produced markdown, e.g. "_assets/img-1.png". */
  path: string;
  buffer: Buffer;
  contentType: string;
};

export type Extracted = {
  markdown: string;
  frontmatter: Record<string, unknown>;
  title: string;
  tags: string[];
  images?: ExtractedImage[];
};

export type UploadAsset = {
  filename: string;
  buffer: Buffer;
  contentType: string;
};

export type UploadFile = {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
  /**
   * Companion files that should travel with this document (e.g. images
   * referenced by a markdown file). Used by the markdown extractor to rewrite
   * `![](filename.png)` references to `_assets/filename.png` and attach the
   * image binaries for upload.
   */
  assets?: UploadAsset[];
};

export const TIER_1_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".zip",
  ".docx",
]);

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

export function tierFor(filename: string): Tier {
  return TIER_1_EXTENSIONS.has(extensionOf(filename))
    ? "indexed"
    : "metadata_only";
}

// Inferred source_format value stored on the document row.
export function sourceFormatFor(filename: string): string {
  const ext = extensionOf(filename).replace(/^\./, "");
  if (ext === "markdown") return "md";
  if (["md", "txt", "pdf", "docx", "pptx", "xlsx"].includes(ext)) return ext;
  return "other";
}
