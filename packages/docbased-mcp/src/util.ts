// Helpers shared by tool implementations. Two themes:
//   1. Truncate model-facing text to keep responses small.
//   2. Add explicit textual pagination hints — LLMs ignore structured cursor
//      fields and need a sentence in the visible output.

const DEFAULT_CHUNK_PREVIEW = 1500;
const HARD_TOOL_OUTPUT_CAP = 24_000;

export function truncate(s: string, max = DEFAULT_CHUNK_PREVIEW): {
  text: string;
  truncated: boolean;
} {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max) + "…", truncated: true };
}

/** Cap entire tool responses; the safety net for long doc bodies. */
export function capResponse(s: string): string {
  if (s.length <= HARD_TOOL_OUTPUT_CAP) return s;
  return (
    s.slice(0, HARD_TOOL_OUTPUT_CAP) +
    `\n\n…[response truncated at ${HARD_TOOL_OUTPUT_CAP} chars — narrow your query or fetch by id]`
  );
}

export function paginationHint(nextCursor: string | null, command: string): string {
  if (!nextCursor) return "";
  return `\n\nMore results available. Call ${command} again with cursor="${nextCursor}".`;
}

export function uuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

export function isoOrEmpty(v: string | null): string {
  return v ?? "—";
}

/** stdio servers MUST write only JSON-RPC to stdout. Logs go to stderr. */
export function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.error("[docbased-mcp]", ...args);
}
