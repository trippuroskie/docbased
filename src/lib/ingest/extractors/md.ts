import matter from "gray-matter";
import type { Extracted } from "../types";

export function extractMarkdown(buffer: Buffer, filename: string): Extracted {
  const raw = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;

  const fmTitle =
    typeof fm.title === "string" ? cleanTitle(fm.title) : null;
  const h1 = extractFirstHeading(parsed.content);
  const cleanedH1 = h1 ? cleanTitle(h1) : null;
  const title = fmTitle || cleanedH1 || stripExtension(filename);

  const tags = normalizeTags(fm.tags ?? fm.tag);

  return {
    markdown: parsed.content,
    frontmatter: fm,
    title,
    tags,
  };
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
