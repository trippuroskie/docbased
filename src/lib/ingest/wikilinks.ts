// Extracts wikilink targets from markdown.
// Resolved lazily into the `links` table after batch upload completes,
// so cross-document references in the same batch can be matched.

const WIKILINK_RE = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;

export function extractWikilinkTargets(markdown: string): string[] {
  const seen = new Set<string>();
  for (const match of markdown.matchAll(WIKILINK_RE)) {
    const target = match[1].trim();
    if (target) seen.add(target);
  }
  return Array.from(seen);
}
