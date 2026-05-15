import type { Extracted } from "../types";

export function extractText(buffer: Buffer, filename: string): Extracted {
  const text = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const title = filename.replace(/\.[^.]+$/, "");
  return {
    markdown: text,
    frontmatter: {},
    title,
    tags: [],
  };
}
