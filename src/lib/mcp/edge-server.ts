// EdgeFastMCP server for the remote /mcp route (Vercel, Node runtime).
//
// EdgeFastMCP speaks web-standard Streamable HTTP (Request → Response), so it
// mounts inside a Next route handler — no long-lived listener. It has no
// per-request `authenticate` hook and tool `execute` receives no context, so we
// carry the resolved caller through AsyncLocalStorage: the route validates the
// access token, resolves the caller, and runs `mcpServer.fetch(req)` inside
// `mcpCtxStore.run(ctx, …)`. Tools read that ctx here.
//
// Tool bodies are the shared definitions in src/lib/core/mcp-tools.ts — the
// same ones the standalone stdio package registers. One core, two shells.

import { AsyncLocalStorage } from "node:async_hooks";

import { EdgeFastMCP } from "fastmcp/edge";

import { mcpToolDefs, type McpCtx } from "@/lib/core/mcp-tools";

export const mcpCtxStore = new AsyncLocalStorage<McpCtx>();

function buildServer(): EdgeFastMCP {
  const server = new EdgeFastMCP({
    name: "docbased",
    version: "0.1.0",
    description:
      "Search, retrieve, and save documents in the docbased knowledge hub.",
    mcpPath: "/mcp",
  });

  for (const def of mcpToolDefs) {
    server.addTool({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      execute: async (args) => {
        const ctx = mcpCtxStore.getStore();
        if (!ctx) {
          throw new Error("docbased MCP: request context missing.");
        }
        return def.run(ctx, args);
      },
    });
  }

  return server;
}

// A single stateless instance, reused across invocations. The per-request
// caller lives in AsyncLocalStorage, never on the server object.
export const mcpServer = buildServer();
