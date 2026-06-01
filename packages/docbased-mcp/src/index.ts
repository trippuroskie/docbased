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

import { mcpToolDefs } from "@core/mcp-tools";
import { register as registerResources } from "./resources/index.js";
import { register as registerAskPrompt } from "./prompts/ask.js";
import { toolContext, type DocbasedAuth } from "./context.js";
import { makeTokenAuthenticate } from "./auth/token.js";
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

  // Token auth applies to the HTTP transport only. stdio is local/single-user
  // and resolves its caller from env, so it stays unauthenticated by design.
  // Opt out of token auth on HTTP with MCP_AUTH=none (trusted network / dev).
  const requireToken =
    mode === "http" && (process.env.MCP_AUTH ?? "token") !== "none";

  const server = new FastMCP<DocbasedAuth>({
    name: "docbased",
    version: "0.1.0",
    instructions:
      "Search, retrieve, and save documents in the docbased knowledge hub. Use list_spaces to see what's available, search_documents for substantive content, list_documents for inventory, and get_document / get_chunk to fetch full text. Use save_document to persist new markdown (research notes, summaries, generated content) into a space — saved docs are tagged 'agent-authored' so they're filterable later.",
    ...(requireToken ? { authenticate: makeTokenAuthenticate() } : {}),
  });

  // Register the shared tool surface (src/lib/core/mcp-tools.ts) — the same
  // definitions the remote /mcp route uses. The per-call caller comes from the
  // HTTP token auth (session) or the env caller on stdio (toolContext).
  for (const def of mcpToolDefs) {
    server.addTool({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      execute: async (args, { session }) =>
        def.run(await toolContext(session), args),
    });
  }
  registerResources(server);
  registerAskPrompt(server);

  if (mode === "http") {
    if (requireToken) {
      log(
        "token auth enabled — every request needs a docbased access token " +
          "(Authorization: Bearer dbk_…), scoped to that user's spaces.",
      );
    } else {
      log(
        "WARNING: MCP_AUTH=none — the HTTP server is UNAUTHENTICATED and uses " +
          "the env caller for every request. Do not expose this publicly.",
      );
    }
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
