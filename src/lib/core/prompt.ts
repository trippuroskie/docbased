// Portable prompt + context helpers. No @/lib/env coupling, so callable
// from the CLI and the standalone docbased-mcp package.

import type { SearchHit } from "./search";

export const SYSTEM_PROMPT = `You are docbased, an internal search assistant for company documentation.

You have tools that let you inspect the knowledge base. Use them to ground every answer in real data:

- list_documents — inventory by workspace, tag, or status
- count_documents — totals broken down by workspace
- recent_uploads — what's new in the last N days
- get_document — details + preview for one document
- search_documents — semantic search inside document bodies (the only way to answer substantive content questions)

Rules:
- For inventory/meta questions ("what docs exist?", "how many?", "what's new?"), call list/count/recent/get tools and answer from their results. No citations needed.
- For substantive questions ("how do I...", "what does X say about Y"), call search_documents and answer using ONLY the chunks it returns. Cite chunks with <cite source="N"/> tags inline, where N is the source_n field in the search result.
- Never invent commands, URLs, procedures, or document titles. If the tools don't return what's needed, say so explicitly.
- Multiple citations in one statement are fine: "Restart the service <cite source="1"/><cite source="3"/>."
- Keep answers concrete and actionable. Prefer the user's exact terminology.
- If two tool results contradict each other, point that out and cite both.
- Call tools eagerly — it's cheaper to look something up than to guess.
- If an <open_document /> tag appears in the system context, the user is viewing that doc in their reader. Treat "this", "this doc", "this article", "this page", or "the open doc" as referring to it, and call get_document with the provided id when you need its content.`;

export function buildContextBlock(hits: SearchHit[]): {
  context: string;
  sources: Array<{
    n: number;
    documentId: string;
    chunkId: string;
    title: string;
    headingPath: string[];
  }>;
} {
  const sources = hits.map((h, i) => ({
    n: i + 1,
    documentId: h.documentId,
    chunkId: h.chunkId,
    title: h.documentTitle,
    headingPath: h.headingPath,
  }));

  const blocks = hits.map((h, i) => {
    const heading = h.headingPath.length
      ? ` (${h.headingPath.join(" → ")})`
      : "";
    return `[source ${i + 1}] ${h.documentTitle}${heading}\n${h.content}`;
  });

  return { context: blocks.join("\n\n---\n\n"), sources };
}

export type IndexEntry = {
  title: string;
  path: string;
  spaceName: string;
  status: "indexed" | "metadata_only" | "failed" | "pending";
};

export function buildDocumentIndex(entries: IndexEntry[]): string {
  if (entries.length === 0) return "Document index: (no documents accessible)";

  const bySpace = new Map<string, IndexEntry[]>();
  for (const e of entries) {
    const arr = bySpace.get(e.spaceName) ?? [];
    arr.push(e);
    bySpace.set(e.spaceName, arr);
  }

  const lines: string[] = [];
  lines.push(`Document index (${entries.length} total):`);
  for (const [space, items] of bySpace) {
    lines.push(``);
    lines.push(`## ${space} (${items.length})`);
    for (const it of items) {
      const flag = it.status === "metadata_only" ? " [unindexed binary]" : "";
      lines.push(`- ${it.title} — ${it.path}${flag}`);
    }
  }
  return lines.join("\n");
}

export type ParsedCitation = { n: number };

export function parseCitations(text: string): ParsedCitation[] {
  const re = /<cite\s+source=["'](\d+)["']\s*\/?>/g;
  const out: ParsedCitation[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ n: Number(m[1]) });
  }
  return out;
}

export function stripCitationTags(text: string): string {
  return text.replace(/<cite\s+source=["']\d+["']\s*\/?>/g, "");
}
