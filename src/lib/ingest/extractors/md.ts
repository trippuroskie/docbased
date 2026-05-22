import matter from "gray-matter";
import type { Extracted, ExtractedImage, UploadAsset } from "../types";

export function extractMarkdown(
  buffer: Buffer,
  filename: string,
  assets?: UploadAsset[],
): Extracted {
  const raw = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;

  const fmTitle =
    typeof fm.title === "string" ? cleanTitle(fm.title) : null;
  const h1 = extractFirstHeading(parsed.content);
  const cleanedH1 = h1 ? cleanTitle(h1) : null;
  const title = fmTitle || cleanedH1 || stripExtension(filename);

  const tags = normalizeTags(fm.tags ?? fm.tag);

  const { markdown, images } = attachAssets(parsed.content, assets);

  return {
    markdown,
    frontmatter: fm,
    title,
    tags,
    images,
  };
}

const STD_IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const OBSIDIAN_EMBED_RE = /!\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|avif)$/i;

function attachAssets(
  content: string,
  assets: UploadAsset[] | undefined,
): { markdown: string; images: ExtractedImage[] } {
  if (!assets || assets.length === 0) {
    return { markdown: content, images: [] };
  }

  const byBasename = new Map<string, UploadAsset>();
  for (const a of assets) {
    byBasename.set(basename(a.filename).toLowerCase(), a);
  }
  const usedFilenames = new Set<string>();

  let rewritten = content.replace(STD_IMG_RE, (full, alt, src) => {
    const decoded = safeDecode(String(src));
    const base = basename(decoded).toLowerCase();
    const asset = byBasename.get(base);
    if (!asset) return full;
    usedFilenames.add(asset.filename);
    return `![${alt}](_assets/${asset.filename})`;
  });

  // Obsidian embed syntax: ![[image.png]] or ![[image.png|alt]]. Only rewrite
  // when the target looks like an image — otherwise it's a document embed,
  // which is out of scope here.
  rewritten = rewritten.replace(OBSIDIAN_EMBED_RE, (full, target, alias) => {
    const decoded = safeDecode(String(target).trim());
    const base = basename(decoded).toLowerCase();
    if (!IMAGE_EXT_RE.test(base)) return full;
    const asset = byBasename.get(base);
    if (!asset) return full;
    usedFilenames.add(asset.filename);
    const alt = alias ? String(alias).trim() : "";
    return `![${alt}](_assets/${asset.filename})`;
  });

  const images: ExtractedImage[] = [];
  for (const a of assets) {
    if (usedFilenames.has(a.filename)) {
      images.push({
        path: `_assets/${a.filename}`,
        buffer: a.buffer,
        contentType: a.contentType,
      });
    }
  }

  return { markdown: rewritten, images };
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

function extractFirstHeading(md: string): string | null {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * Strip markdown formatting and HTML from a heading so it can be used as a
 * plain-text document title. Obsidian notes commonly wrap headings in `<font
 * color>` / `<span style>` tags and bold markers (e.g. `**<font ...>To
 * do</font>**`), which look terrible in a sidebar otherwise.
 */
export function cleanTitle(raw: string): string {
  let s = raw.trim();
  // Strip HTML tags (font, span, mark, em, strong, sub, sup, …).
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  // Obsidian highlight markers ==text== → text.
  s = s.replace(/==(.+?)==/g, "$1");
  // Wikilinks: [[Page|Display]] → Display, [[Page]] → Page.
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");
  // Standard markdown links: [text](url) → text.
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Bold / italic markers.
  s = s.replace(/(\*\*|__)(.+?)\1/g, "$2");
  s = s.replace(/(\*|_)(.+?)\1/g, "$2");
  // Inline code ticks.
  s = s.replace(/`([^`]+)`/g, "$1");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normalizeTags(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.filter((t): t is string => typeof t === "string");
  }
  if (typeof input === "string") {
    return input
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}
