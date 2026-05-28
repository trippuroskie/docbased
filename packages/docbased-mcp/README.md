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

Two modes, picked automatically based on env:

- **service** (default) — `SUPABASE_SECRET_KEY` set → bypass RLS, every space accessible.
- **user** — `DOCBASED_EMAIL` + `DOCBASED_PASSWORD` set → sign in, resolve `accessibleSpaceIds` against `users.is_admin` and `space_access`. Use this when serving multiple humans.

Override with `DOCBASED_MODE=service|user|auto`.

## Transports

- `docbased-mcp` — stdio (default; what Claude Code / Desktop / Cursor expect).
- `docbased-mcp --http --port 3333` — Streamable HTTP for hosted use.

## License

MIT.
