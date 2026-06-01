// Package-local helpers. The model-facing string formatters now live in the
// shared core (@core/format) so the stdio package and the remote /mcp route
// stay byte-for-byte identical; only the stdio logger remains here.

/** stdio servers MUST write only JSON-RPC to stdout. Logs go to stderr. */
export function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.error("[docbased-mcp]", ...args);
}
