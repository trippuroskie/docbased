# docbased

Internal documentation search and chat for multiple knowledge spaces (IT, Ecomm, personal notes), with per-user role-based access, hybrid semantic + keyword search, and RAG chat with citations.

The full design is in [docs/PROJECT_PLAN_v2.md](docs/PROJECT_PLAN_v2.md). This README is the operational runbook — how to deploy it, recover it, and keep it running.

## Stack

- Next.js 16 (App Router, TypeScript strict) on Vercel
- shadcn/ui + Tailwind 4
- Supabase (Postgres 15, pgvector, pg_trgm, unaccent, Storage, Auth)
- Drizzle ORM (schema source of truth in TS; SQL migrations applied directly)
- OpenRouter for embeddings (`openai/text-embedding-3-small`, 1536 dims) and chat
- Hybrid retrieval = pgvector cosine + Postgres FTS fused via Reciprocal Rank Fusion, optionally reranked with `cohere/rerank-3.5`

## Deploy from scratch

### 1. Supabase

1. Create a Supabase project in the **org** account (not personal — single point of failure otherwise).
2. From Project Settings → API, copy the URL, anon key, and service role key into `.env.local` (see `.env.example`).
3. From Project Settings → Database → Connection string, copy the Transaction-mode pooler URL into `DATABASE_URL`.
4. Apply schema + RLS:
   ```
   npm run db:migrate
   ```
   This runs every `.sql` file in `supabase/migrations/` in order, idempotently. Source of truth:
   - `0001_extensions.sql` — vector / pg_trgm / unaccent
   - `0002_schema.sql` — tables and indexes
   - `0003_rls.sql` — every Row Level Security policy. **Do not edit live; change the file and re-run.**
   - `0004_hybrid_search.sql` — the `hybrid_search()` function
   - `0005_storage.sql` — `originals` bucket and storage policies

### 2. OpenRouter

1. Create an OpenRouter account in the org.
2. Add credits and **set a hard monthly spend ceiling** in the dashboard.
3. Generate an API key, put it in `OPENROUTER_API_KEY`.

### 3. Seed the first admin

```
npm run seed your-email@company.com
```

This invites the email (magic link goes to your inbox), marks the user as admin, and creates the IT / Ecomm / Notes spaces with owner access.

### 4. Run locally

```
npm install
cp .env.example .env.local   # fill in
npm run dev
```

Open http://localhost:3000, click your magic link, you're in.

### 5. Deploy to Vercel

1. Push to GitHub.
2. Import the repo in Vercel (org account, not personal).
3. Add every variable from `.env.example` as a Vercel env var.
4. Deploy. The cron in `vercel.json` will fire weekly.

## Operations

### Backups

`scripts/backup.ts` runs `pg_dump` and uploads the result to a private Supabase Storage bucket named `backups`. Create the bucket once in the Supabase dashboard. Run on a host that has `pg_dump` available (GitHub Actions cron, or a long-running VM); `npm run backup`. The Vercel cron at `/api/cron/backup` is a heartbeat that can POST to an external webhook (`CRON_BACKUP_WEBHOOK`) to trigger your runner — Vercel functions can't shell out to `pg_dump` themselves.

### Restoring from backup

1. Create a fresh Supabase project.
2. Download the latest `weekly/kb-*.sql` from the `backups` bucket.
3. `psql $DATABASE_URL < kb-<date>.sql`.
4. Re-apply RLS policies if your snapshot pre-dates a policy change: `npm run db:migrate` is safe to run on a restore.

### Swapping embedding models

1. Update `EMBEDDING_MODEL` in the env (must produce 1536-dim vectors, or migrate the `chunks.embedding` column).
2. In the app, hit `POST /api/admin/reembed` repeatedly until `{ remaining: 0 }`. Each call processes 100 chunks.
3. Budget: ~$0.50–$3 for a few thousand chunks at small-3.

### Escalating cost

If OpenRouter spend approaches the ceiling:
1. Tighten `CHAT_DAILY_LIMIT` (defaults to 50/user/day).
2. Disable the reranker temporarily: `RERANKER_ENABLED=false`.
3. Swap the default chat model to a cheaper one (e.g. `anthropic/claude-haiku-4.5`).
4. Inspect per-user usage at `/admin/usage`.

### Adding new admins

Two paths:
- From `/admin/users`, click "Make admin" on the row.
- Or directly: `update users set is_admin = true where email = '…';`

**Always keep at least two admins.** Don't ship to a real user base with only one.

### Verifying RLS

Pick two test users (A in space X, B in space Y) and confirm via SQL that A can't see B's data — using the user's JWT as the connection context, not the service-role key. Do this before any real content goes in. Without this check, you're trusting that the policies in `0003_rls.sql` were written correctly; with it, you have evidence.

### Programmatic access (CLI & remote MCP)

Two surfaces let agents and scripts reach the knowledge base. They authenticate differently.

**CLI** (`npm run docbased -- <cmd>`) authenticates via **env vars**, not tokens. Service mode (default) needs `SUPABASE_URL` + `SUPABASE_SECRET_KEY` + `OPENROUTER_API_KEY` and acts as the first admin (or `--as <email>`). Add `DOCBASED_EMAIL` + `DOCBASED_PASSWORD` (+ the publishable key) to run scoped to a real user. Force the mode with `--mode service|user|auto`. See `scripts/cli.ts --help`.

**Remote MCP** is served at **`https://www.docbased.dev/mcp`** (Streamable HTTP) and authenticates with a **personal access token** (`Authorization: Bearer dbk_…`). Mint one in **Settings → Access tokens** (shown once); revoke there too. The Settings page also shows the canonical URL and a copy-paste config.

- Claude Code: `claude mcp add --transport http docbased https://www.docbased.dev/mcp --header "Authorization: Bearer dbk_…"`
- Claude Desktop: use the `mcp-remote` bridge (see the Settings → Access tokens snippet), then fully restart the app.

> **Always use the `www.` host.** The apex `docbased.dev` is served by the app (no platform redirect) precisely so `/mcp` works — but if a platform redirect is ever re-enabled, the apex→www hop is cross-origin and strips the `Authorization` header, silently breaking MCP. Canonicalization of *pages* (not `/mcp` or `/api`) is handled in [`src/proxy.ts`](src/proxy.ts).

## v1.5 / v2 backlog

See [docs/PROJECT_PLAN_v2.md §9](docs/PROJECT_PLAN_v2.md). Tier 2 (metadata-only) documents automatically become Tier 1 (indexed) as rich-format extractors ship.

## Repo layout

```
src/
  app/
    (app)/              shell-wrapped routes (auth required)
      page.tsx          home
      space/[slug]/     space browse view
      doc/[id]/         viewer + edit
      chat/[id]/        chat thread + /chat/new
      search/           full search results
      admin/            upload, users, spaces, access, audit, usage
    api/                route handlers
    login/              magic-link sign-in
    auth/callback/      OAuth exchange
  components/           UI: sidebar, top bar, chat panel, command palette, markdown
  lib/
    auth.ts             session helpers
    env.ts              centralized env access
    supabase/           server + browser + middleware clients
    db/                 Drizzle schema (mirrors SQL)
    ingest/             extractors, chunker, pipeline, hash, wikilinks
    ai/openrouter.ts    embeddings + chat client
    search.ts           hybrid_search wrapper + optional reranker
    chat.ts             system prompt, context builder, citation parsing
    tree.ts             space tree builder for the sidebar
supabase/migrations/    SQL — source of truth for schema, RLS, hybrid_search
scripts/                apply-migrations, seed, backup
```
