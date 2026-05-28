// docbased-mcp — MCP server entrypoint.
//
// Defaults to stdio (the transport every local MCP client uses).
// --http enables Streamable HTTP on PORT (default 3333) for hosted use.
//
// Env (see README):
//   SUPABASE_URL                         required
//   SUPABASE_SECRET_KEY                  required (bypasses RLS for reads)
//   OPENROUTER_API_KEY                   required (embeddings + rerank)
//   DOCBASED_EMAIL / DOCBASED_PASSWORD   optional → switches to user mode
//   DOCBASED_MODE=service|user|auto      default auto
//   EMBEDDING_MODEL, RERANKER_MODEL      optional model overrides
//
// stdio is sacred: only JSON-RPC frames on stdout. All logs go to stderr.

import { FastMCP } from "fastmcp";

import { register as registerSearch } from "./tools/search-documents.js";
import { register as registerListSpaces } from "./tools/list-spaces.js";
import { register as registerListDocuments } from "./tools/list-documents.js";
import { register as registerGetDocument } from "./tools/get-document.js";
import { register as registerChunks } from "./tools/get-chunk.js";
import { register as registerSaveDocument } from "./tools/save-document.js";
import { register as registerResources } from "./resources/index.js";
import { register as registerAskPrompt } from "./prompts/ask.js";
import { log } from "./util.js";

type Mode = "stdio" | "http";

function parseFlags(argv: string[]): { mode: Mode; port: number } {
  let mode: Mode = "stdio";
  let port = Number(process.env.PORT ?? 3333);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--http") mode = "http";
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
  }
  return { mode, port };
}

function printHelp() {
  process.stderr.write(`docbased-mcp — MCP server for the docbased knowledge hub

Usage:
  docbased-mcp                       Run on stdio (default)
  docbased-mcp --http [--port N]    Run on Streamable HTTP (default port 3333)
  docbased-mcp --help

Required env:
  SUPABASE_URL
  SUPABASE_SECRET_KEY
  OPENROUTER_API_KEY

Optional env:
  DOCBASED_EMAIL + DOCBASED_PASSWORD   switch to user-scoped mode
  DOCBASED_MODE=service|user|auto       default auto
  EMBEDDING_MODEL                       default openai/text-embedding-3-small
  RERANKER_MODEL                        default cohere/rerank-3.5
`);
}

async function main() {
  const { mode, port } = parseFlags(process.argv.slice(2));

  const server = new FastMCP({
    name: "docbased",
    version: "0.1.0",
    instructions:
      "Search, retrieve, and save documents in the docbased knowledge hub. Use list_spaces to see what's available, search_documents for substantive content, list_documents for inventory, and get_document / get_chunk to fetch full text. Use save_document to persist new markdown (research notes, summaries, generated content) into a space — saved docs are tagged 'agent-authored' so they're filterable later.",
  });

  registerSearch(server);
  registerListSpaces(server);
  registerListDocuments(server);
  registerGetDocument(server);
  registerChunks(server);
  registerSaveDocument(server);
  registerResources(server);
  registerAskPrompt(server);

  if (mode === "http") {
    log(`starting HTTP transport on :${port}`);
    await server.start({
      transportType: "httpStream",
      httpStream: { port },
    });
  } else {
    await server.start({ transportType: "stdio" });
    log("stdio transport ready");
  }
}

main().catch((err) => {
  // stdio servers must never emit non-JSON on stdout. Errors to stderr.
  process.stderr.write(
    `[docbased-mcp] fatal: ${(err as Error).message ?? err}\n`,
  );
  process.exit(1);
});
