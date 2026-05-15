// Markdown-aware chunker that preserves heading hierarchy.
//
// Per the plan, heading_path is the single highest-quality retrieval lever for
// IT documentation — a chunk that knows it lives under "Networking → VLANs →
// Step 3" is dramatically more retrievable. So we walk headings as we split.

export type ChunkedPiece = {
  ordinal: number;
  content: string;
  headingPath: string[];
  tokenCount: number;
  /** True if this chunk is a large fenced code block (kept as a keyword-only chunk; do not embed). */
  isLargeCode: boolean;
};

const TARGET_TOKENS = 800;
const OVERLAP_TOKENS = 150;
const LARGE_CODE_TOKENS = 500;
// Coarse 4-chars-per-token rule. Good enough for chunk sizing.
const CHARS_PER_TOKEN = 4;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;
const LARGE_CODE_CHARS = LARGE_CODE_TOKENS * CHARS_PER_TOKEN;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

type Section = {
  headingPath: string[];
  /** Raw markdown body for this heading (excluding the heading line itself). */
  body: string;
};

function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let current: string[] = [];

  // ATX headings only — Obsidian/typical IT docs use them.
  const flush = () => {
    sections.push({
      headingPath: stack.map((s) => s.title),
      body: current.join("\n").trim(),
    });
    current = [];
  };

  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    const m = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      if (current.length) flush();
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: m[2].trim() });
      continue;
    }
    current.push(line);
  }
  flush();

  return sections.filter((s) => s.body.length > 0 || s.headingPath.length > 0);
}

function extractLargeCodeBlocks(body: string): {
  cleaned: string;
  codeBlocks: string[];
} {
  const codeBlocks: string[] = [];
  const cleaned = body.replace(/```[\s\S]*?```/g, (m) => {
    if (m.length >= LARGE_CODE_CHARS) {
      codeBlocks.push(m);
      return "\n[[LARGE_CODE_BLOCK_OMITTED]]\n";
    }
    return m;
  });
  return { cleaned, codeBlocks };
}

function splitProse(body: string): string[] {
  if (body.length <= TARGET_CHARS) return [body];
  const out: string[] = [];
  let i = 0;
  while (i < body.length) {
    const end = Math.min(body.length, i + TARGET_CHARS);
    // Prefer breaking on paragraph or sentence boundary inside the target window.
    let breakAt = end;
    if (end < body.length) {
      const window = body.slice(i, end);
      const para = window.lastIndexOf("\n\n");
      const sent = window.search(/[.!?]\s+[A-Z][^.!?]*$/);
      if (para > TARGET_CHARS / 2) breakAt = i + para;
      else if (sent > TARGET_CHARS / 2) breakAt = i + sent + 1;
    }
    out.push(body.slice(i, breakAt).trim());
    if (breakAt >= body.length) break;
    i = Math.max(breakAt - OVERLAP_CHARS, breakAt);
  }
  return out.filter(Boolean);
}

export function chunkMarkdown(markdown: string): ChunkedPiece[] {
  const sections = parseSections(markdown);
  const pieces: ChunkedPiece[] = [];
  let ordinal = 0;

  for (const section of sections) {
    const { cleaned, codeBlocks } = extractLargeCodeBlocks(section.body);
    const parts = splitProse(cleaned);

    for (const part of parts) {
      if (!part) continue;
      pieces.push({
        ordinal: ordinal++,
        content: part,
        headingPath: section.headingPath,
        tokenCount: approxTokens(part),
        isLargeCode: false,
      });
    }

    for (const code of codeBlocks) {
      pieces.push({
        ordinal: ordinal++,
        content: code,
        headingPath: section.headingPath,
        tokenCount: approxTokens(code),
        isLargeCode: true,
      });
    }
  }

  return pieces;
}
