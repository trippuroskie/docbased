import matter from "gray-matter";
import type { Extracted } from "../types";

export function extractMarkdown(buffer: Buffer, filename: string): Extracted {
  const raw = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;

  const title =
    (typeof fm.title === "string" && fm.title.trim()) ||
    extractFirstHeading(parsed.content) ||
    stripExtension(filename);

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
