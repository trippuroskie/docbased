# docbased

Self-hosted documentation search and RAG chat over multiple knowledge spaces, with per-user access control.

You point it at your markdown (an Obsidian vault, exported docs, `.docx` files), and it gives you hybrid semantic + keyword search, a chat that answers from your own documents with citations back to the source chunk, and per-space permissions so the support team doesn't see the infra runbooks. It also exposes the same corpus over MCP, so coding agents can search your docs directly.

> [!WARNING]
> **This project is not actively maintained.** It was built for one small team's internal use and is published as a reference, not a product. There is no test suite, no release process, no support, and no guarantee that a future Supabase or Next.js release won't break it. Issues and pull requests may go unanswered. Read [Known issues](#known-issues) before deploying it anywhere that matters — in particular, the Row Level Security policies are known to be broken and the app compensates in application code.

## Screenshots

Documents, tree, and chat in one resizable workspace — chat keeps the open document in context.

![The main workspace: space tree on the left, document in the centre, chat on the right](docs/screenshots/workspace.png)

Chat answers from retrieved chunks only, with inline citations that link back to the exact source document.

![A chat answer with numbered inline citations and a source list](docs/screenshots/chat-citations.png)

Hybrid search — pgvector cosine similarity and Postgres full-text search, fused with Reciprocal Rank Fusion, so both "how do I get time off" and an exact error code find their document.

![Search results across spaces with matched snippets highlighted](docs/screenshots/search.png)

Per-space, per-user access as an editable matrix. Spaces a user has no role in are invisible to them, not merely unlinked.

![The admin access matrix mapping users to spaces and roles](docs/screenshots/admin-access.png)

Personal access tokens for the remote MCP endpoint, shown once at mint time.

![Settings page showing the MCP endpoint URL and a minted access token](docs/screenshots/settings-tokens.png)

## How it works

**Ingest** ([`src/lib/ingest/pipeline.ts`](src/lib/ingest/pipeline.ts)) has two tiers:

- **Indexed** — `.md`, `.markdown`, `.txt`, `.docx`, and `.zip` archives of those. Extracted to markdown, chunked on heading and paragraph boundaries, embedded in batches of 100, and written to `documents` + `chunks`. Obsidian-style `[[wikilinks]]` are resolved to real document references. Large code blocks are stored but deliberately not embedded — they dilute the vector space without improving recall.
- **Metadata-only** — `.pdf`, `.pptx`, `.xlsx`, and friends. Uploaded to object storage with a `documents` row and no chunks. Findable by title and tag, but not semantically. These become indexed automatically if you add an extractor for the format.

A content hash short-circuits re-uploads of unchanged files, and every create/replace writes an audit row.

**Retrieval** ([`src/lib/search.ts`](src/lib/search.ts)) embeds the query, then calls the `hybrid_search()` Postgres function, which runs pgvector cosine similarity and Postgres FTS independently and fuses the two rankings with Reciprocal Rank Fusion. RRF reads only *rank*, not score, so it needs no calibration between two systems whose scores aren't comparable. The top results are then optionally reranked by a cross-encoder; a reranker failure falls back to RRF order rather than failing the query.

**Chat** ([`src/app/api/chat/route.ts`](src/app/api/chat/route.ts)) streams from OpenRouter and can call retrieval as a tool, capped at 6 iterations per turn. The system prompt constrains answers to retrieved context, and citations are parsed back out of the response and linked to their source chunk.

Everything routes through a single OpenRouter key — embeddings, chat, and reranking — so there's one bill and one place to set a spend ceiling.

## Stack

- Next.js 16 (App Router, RSC, Server Actions, TypeScript strict), React 19
- shadcn/ui, Tailwind 4, Radix
- Supabase — Postgres 15 with pgvector, pg_trgm and unaccent, plus Storage and Auth
- OpenRouter for embeddings (`openai/text-embedding-3-small`, 1536 dims), chat, and reranking (`cohere/rerank-3.5`)
- Drizzle ORM for TypeScript types only — the SQL in [`supabase/migrations/`](supabase/migrations/) is the schema source of truth
- Deployed on Vercel; the chat route runs on the Node runtime with a 60s max duration

## Setup

You need a Supabase project and an OpenRouter key. Expect a few dollars a month at small scale — embedding a few thousand chunks is well under $1, and chat is whatever model you pick.

### 1. Database

Copy the project URL, publishable key, and secret key from **Project Settings → Data API**, and the transaction-mode pooler connection string from **Project Settings → Database**, into `.env.local`:

```bash
cp .env.example .env.local   # then fill it in
npm install
npm run db:migrate
```

`db:migrate` applies every `.sql` file in [`supabase/migrations/`](supabase/migrations/) in order, idempotently:

| File | Contents |
| --- | --- |
| `0001_extensions.sql` | `vector`, `pg_trgm`, `unaccent` |
| `0002_schema.sql` | Tables and indexes |
| `0003_rls.sql` | Row Level Security policies — see [Known issues](#known-issues) |
| `0004_hybrid_search.sql` | The `hybrid_search()` function |
| `0005_storage.sql` | The `originals` bucket and its storage policies |
| `0006_user_settings.sql` | Per-user model overrides |
| `0007_mcp_tokens.sql` | Hashed personal access tokens |

These files are the source of truth. Change the file and re-run; don't edit policies live, and don't use `drizzle-kit` to generate migrations against the live database — the Drizzle schema in [`src/lib/db/schema.ts`](src/lib/db/schema.ts) is a hand-maintained typing mirror.

### 2. OpenRouter

Create a key, add credits, and **set a hard monthly spend ceiling in the OpenRouter dashboard**. `MONTHLY_SPEND_CEILING` in `.env.local` is informational only — it does not stop spend.

### 3. First admin

```bash
npm run seed you@example.com
```

Invites the email, marks the user admin, and creates three starter spaces with owner access. A magic link goes to that inbox.

On a network where Supabase's built-in SMTP gets quarantined, skip email entirely:

```bash
npm run setpassword you@example.com <password>
```

The `/login` page takes a password as well as a magic link.

### 4. Run

```bash
npm run dev
```

### 5. Deploy

Import the repo in Vercel and add every variable from `.env.example` as a project env var. The weekly cron in [`vercel.json`](vercel.json) starts firing on deploy.

If you serve the app on a bare apex and a `www` host, set `NEXT_PUBLIC_CANONICAL_HOST=www.your-domain.com` and configure the apex to **serve** the app rather than platform-redirect to `www`. [`src/proxy.ts`](src/proxy.ts) then 308s *pages* to the canonical host while leaving `/mcp` and `/api` alone — an apex→www redirect is a cross-origin hop, and fetch strips the `Authorization` header across it, which silently breaks token auth. Leave the variable unset to disable canonicalization entirely.

## Importing content

The admin UI at `/admin/upload` takes individual files and zips. For bulk imports, the CLI is better:

```bash
npm run docbased -- import ./my-vault --space engineering --tags imported
```

It walks a folder, resolves images referenced by `![[...]]` or `![](...)` against the Obsidian vault root, and uploads them as assets alongside each note. `--dry-run` shows what would happen.

## Programmatic access

Two surfaces reach the corpus, with different auth.

**CLI** — authenticates by environment variable, not token. Service mode (the default) uses the Supabase secret key and acts as the first admin, or `--as <email>`. Setting `DOCBASED_EMAIL` and `DOCBASED_PASSWORD` runs it scoped to a real user's permissions instead.

```bash
npm run docbased -- spaces
npm run docbased -- search "database failover" --space engineering --rerank
npm run docbased -- ask "what is the refund window?"
npm run docbased -- doc get engineering/Runbooks/incident-response
```

`npm run docbased -- --help` lists everything. `npm link` makes it available as `docbased` from any directory.

**Remote MCP** — Streamable HTTP at `/mcp`, authenticated with a personal access token (`Authorization: Bearer dbk_…`). Mint one in **Settings → Access tokens**; it's shown once and revocable there. The tools are `list_spaces`, `search_documents`, `list_documents`, `get_document`, `get_chunk`, `get_chunk_neighbors`, and `save_document`, all scoped to the token owner's space access.

```bash
claude mcp add --transport http docbased https://your-domain.com/mcp \
  --header "Authorization: Bearer dbk_..."
```

Claude Desktop needs the `mcp-remote` bridge; the Settings page prints a copy-pasteable config. There's also a standalone stdio server in [`packages/docbased-mcp/`](packages/docbased-mcp/) that shares the same tool definitions ([`src/lib/core/mcp-tools.ts`](src/lib/core/mcp-tools.ts)).

## Operations

**Backups.** [`scripts/backup.ts`](scripts/backup.ts) runs `pg_dump` and uploads to a private `backups` Storage bucket, which you create once by hand. It needs a host that has `pg_dump` — Vercel functions can't shell out to it, so the weekly cron at `/api/cron/backup` is only a heartbeat that POSTs to `CRON_BACKUP_WEBHOOK` to trigger your own runner (GitHub Actions works).

**Restore.** Create a fresh project, download the latest `weekly/kb-*.sql`, `psql $DATABASE_URL < kb-<date>.sql`, then run `npm run db:migrate` — it's safe on a restore and re-applies any policy changes newer than the snapshot.

**Changing embedding model.** Set `EMBEDDING_MODEL` to something that also produces 1536-dim vectors, or migrate the `chunks.embedding` column and the index first — both `hybrid_search()` and the index assume 1536. Then `POST /api/admin/reembed` repeatedly until it returns `{ remaining: 0 }`; each call does 100 chunks.

**Controlling cost.** Lower `CHAT_DAILY_LIMIT` (default 50 messages/user/day), set `RERANKER_ENABLED=false`, or switch `DEFAULT_CHAT_MODEL` to something cheaper. Per-user usage is at `/admin/usage`. New chat models must be added to both `CHAT_MODEL_ALLOWLIST` in [`src/lib/env.ts`](src/lib/env.ts) and [`src/lib/ai/openrouter-models.ts`](src/lib/ai/openrouter-models.ts), or the UI will reject them.

**Admins.** `/admin/users` has a "Make admin" toggle, or `update users set is_admin = true where email = '…'`. Keep at least two — note that admins can see *every* space ([`src/lib/auth.ts`](src/lib/auth.ts)), so admin is not a neutral role.

## Known issues

**The RLS policies are broken, and the app works around them in application code.** The `users` SELECT policy in [`0003_rls.sql`](supabase/migrations/0003_rls.sql) checks for admin with `exists (select 1 from users me where me.id = auth.uid() and me.is_admin)` — a subquery against the very table the policy guards, which recurses. The same self-referencing admin branch is repeated in the `spaces`, `space_access`, and `documents` policies.

The consequence is that the app cannot rely on RLS for those tables. Instead it validates the session with the user-scoped client and then reads and writes through the **service client**, which bypasses RLS, having done the authorization check itself in [`src/lib/auth.ts`](src/lib/auth.ts). That works, but it means **access control lives in application code, not in the database**, so any new query path that forgets its own check is an access-control bug rather than something the database catches. RLS is still load-bearing for `chunks` and `audit_log`.

Fixing this properly means moving the admin lookup into a `security definer` function so the policy doesn't re-enter the table it protects. That has not been done.

**Verify isolation before putting real content in.** Take two users with access to different spaces and confirm from SQL — connecting with each user's JWT as the context, not the service key — that neither can read the other's documents. Without that check you are trusting these policies to be correct, and per the above, they are not.

## Repo layout

```
src/
  app/
    (app)/           auth-required routes, wrapped in the persistent shell
      space/[slug]/  browse a space
      doc/[id]/      viewer and editor
      chat/[id]/     chat threads
      search/        full search results
      admin/         upload, users, spaces, access, audit, usage
    (docs)/docs/     self-hosted documentation site (fumadocs)
    api/             route handlers
    mcp/             remote MCP endpoint
    login/, auth/    magic-link and password sign-in, OAuth callback
  components/        sidebar, top bar, chat panel, command palette, viewer
  lib/
    auth.ts          requireUser / requireAdmin / getAccessibleSpaces
    env.ts           centralized env access, fails loud at boot
    core/            tool bodies shared by the CLI and both MCP servers
    ingest/          extractors, chunker, pipeline, wikilinks, hashing
    ai/              OpenRouter client, model allowlist, tool specs
    search.ts        hybrid_search wrapper and reranker
    chat.ts          system prompt, context builder, citation parsing
    supabase/        server, browser, and proxy clients
    db/schema.ts     Drizzle typing mirror of the SQL
  proxy.ts           Next 16 proxy (formerly middleware) — refreshes sessions
supabase/migrations/ SQL — schema, RLS, hybrid_search, storage policies
packages/docbased-mcp/  standalone stdio MCP server
scripts/             migrations, seed, backup, CLI, bulk import
content/docs/        MDX for the built-in docs site
docs/screenshots/    README images and the shot list that regenerates them
```

There is no test suite. `npm run typecheck` is the only automated check.

## License

MIT — see [LICENSE](LICENSE).
