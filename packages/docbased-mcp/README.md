# docbased-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for the **docbased** knowledge hub. Lets MCP-capable LLMs (Claude Code, Claude Desktop, Cursor, anything that speaks MCP) search documents, fetch chunks, and browse spaces in your docbased instance.

## Install

```jsonc
// claude_desktop_config.json / .mcp.json / cursor settings
{
  "mcpServers": {
    "docbased": {
      "command": "npx",
      "args": ["-y", "docbased-mcp"],
      "env": {
        "SUPABASE_URL": "https://<project>.supabase.co",
        "SUPABASE_SECRET_KEY": "sb_secret_...",
        "OPENROUTER_API_KEY": "sk-or-..."
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `list_spaces` | Enumerate spaces the caller can read |
| `search_documents(query, space_slug?, limit?, rerank?)` | Hybrid pgvector + FTS search |
| `list_documents(space_slug?, cursor?, limit?)` | Inventory ordered by most-recently-edited |
| `get_document(ref)` | Full markdown body (id or `space-slug/path`) |
| `get_chunk(chunk_id)` | One chunk with heading path |
| `get_chunk_neighbors(chunk_id, window?)` | Adjacent chunks for context expansion |

## Resources

- `docbased://space/{slug}` — table of contents for one space (top 100 docs)
- `docbased://document/{id}` — full body of one document

## Prompts

- `docbased-ask` — slash-command template that primes the model with the docbased system prompt + the user's question.

## Auth modes

How the caller is resolved depends on the transport.

### Local (stdio) — env caller

Picked automatically based on env:

- **service** (default) — `SUPABASE_SECRET_KEY` set → bypass RLS, every space accessible.
- **user** — `DOCBASED_EMAIL` + `DOCBASED_PASSWORD` set → sign in, resolve `accessibleSpaceIds` against `users.is_admin` and `space_access`.

Override with `DOCBASED_MODE=service|user|auto`. This is a single caller for the whole process — fine for one person on their own machine, **not** for a shared remote server.

### Remote (HTTP) — personal access tokens

Started with `--http`, the server requires a docbased **personal access token** on every request: `Authorization: Bearer dbk_…`. The user mints the token from the docbased web UI (Settings → Access tokens) and pastes it into their MCP client / CLI config. The server hashes the token, looks it up, and resolves the owning user — so each request runs with **that user's** space access. Unknown, revoked, or expired tokens get a `401`.

No extra env is needed beyond what the server already requires (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENROUTER_API_KEY`): the service client validates the token and performs reads after the per-user `accessibleSpaceIds` check (the same RLS-recursion workaround the web app uses).

```jsonc
// A remote MCP client pointing at the hosted server
{
  "mcpServers": {
    "docbased": {
      "url": "https://mcp.docbased.example.com/mcp",
      "headers": { "Authorization": "Bearer dbk_your_token_here" }
    }
  }
}
```

| Env | Required | Meaning |
|---|---|---|
| `MCP_AUTH` | no | `token` (default) requires a PAT; `none` disables auth (trusted network / dev only — logs a warning) |

> ⚠️ `--http` with `MCP_AUTH=none` runs unauthenticated using the env caller. Never expose that publicly.

## Transports

- `docbased-mcp` — stdio (default; what Claude Code / Desktop / Cursor expect for local use).
- `docbased-mcp --http --port 3333` — Streamable HTTP for hosting this package as a standalone long-lived container (Fly/Railway/Render/VM) behind TLS.

> **Deploying on Vercel?** You don't need this package as a container. The main app serves the same tool surface at **`/mcp`** ([src/app/mcp/route.ts](../../src/app/mcp/route.ts)), built on `fastmcp/edge` and protected by the same `dbk_…` tokens. The tool bodies are shared via [src/lib/core/mcp-tools.ts](../../src/lib/core/mcp-tools.ts) — one core, two shells. This package remains the right choice for **local stdio** and for non-Vercel container hosting.

## License

MIT.
