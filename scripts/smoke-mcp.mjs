// Local smoke test for packages/docbased-mcp.
// Spawns the built server over stdio, runs the MCP initialize handshake,
// then calls tools/list and a couple of real tools against the live DB.
//
//   node scripts/smoke-mcp.mjs
//
// Loads .env.local first so SUPABASE_URL etc. are present.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

async function loadEnv(path) {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {}
}
await loadEnv(".env.local");
await loadEnv(".env");

const child = spawn("node", ["packages/docbased-mcp/dist/index.mjs"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

child.stderr.on("data", (d) => process.stderr.write(`[mcp-stderr] ${d}`));

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else {
        process.stderr.write(`[mcp-event] ${line}\n`);
      }
    } catch {
      process.stderr.write(`[mcp-non-json] ${line}\n`);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, (resp) => {
      if (resp.error) reject(new Error(JSON.stringify(resp.error)));
      else resolve(resp.result);
    });
    child.stdin.write(JSON.stringify(msg) + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
  );
}

async function run() {
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "docbased-smoke", version: "0.0.1" },
  });
  console.log("initialize.serverInfo:", init.serverInfo);
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  console.log(
    "tools:",
    tools.tools.map((t) => t.name),
  );

  const spaces = await rpc("tools/call", {
    name: "list_spaces",
    arguments: {},
  });
  console.log("\nlist_spaces:");
  console.log(spaces.content?.[0]?.text ?? spaces);

  const resources = await rpc("resources/templates/list", {});
  console.log(
    "\nresource templates:",
    resources.resourceTemplates?.map((r) => r.uriTemplate),
  );

  const prompts = await rpc("prompts/list", {});
  console.log("prompts:", prompts.prompts.map((p) => p.name));

  const search = await rpc("tools/call", {
    name: "search_documents",
    arguments: { query: "power bi report", limit: 2 },
  });
  console.log("\nsearch_documents (truncated):");
  const out = search.content?.[0]?.text ?? "";
  console.log(out.slice(0, 600) + (out.length > 600 ? "…" : ""));

  child.stdin.end();
  child.kill();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("smoke failed:", err);
    child.kill();
    process.exit(1);
  });
