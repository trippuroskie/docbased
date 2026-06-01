<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

The most likely traps in Next.js 16 for this repo: `middleware.ts` is now [`proxy.ts`](src/proxy.ts) with an `export async function proxy()` (see `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`); `cookies()` and `params` are async; `fetch` no longer caches by default. When in doubt, grep `node_modules/next/dist/docs/` before writing.

## What this app is

docbased — internal docs search + RAG chat for multiple "spaces" (IT, Ecomm, personal notes) with per-user role-based access. Operational runbook is in [README.md](README.md); product spec in [docs/PROJECT_PLAN_v2.md](docs/PROJECT_PLAN_v2.md).

## Stack

- Next.js 16.2 (App Router, RSC, Server Actions, TS strict) on Vercel
- React 19.2, shadcn/ui, Tailwind 4, Radix
- Supabase (Postgres 15, pgvector, pg_trgm, unaccent, Storage, Auth)
- Drizzle ORM for types; **SQL files in [supabase/migrations/](supabase/migrations/) are the source of truth for schema, RLS, and the `hybrid_search()` RPC**
- OpenRouter for embeddings (`text-embedding-3-small`, 1536 dims) and chat — single SDK via OpenAI-compatible baseURL

## Layout

```
src/
  app/
    (app)/         auth-required routes; wrapped by AppShell w/ persistent sidebar
    api/           route handlers (chat is Node runtime, 60s maxDuration)
    login/, auth/  magic-link sign-in + OAuth callback
  components/      sidebar, top-bar, chat panel, command palette, docbased/*
  lib/
    auth.ts       requireUser / requireAdmin / getAccessibleSpaces (cached)
    env.ts        centralized env access — fail loud at boot
    supabase/     server, browser, middleware clients
    db/schema.ts  Drizzle mirror of the SQL
    ingest/       extractors, chunker, pipeline, wikilinks, hash
    ai/           openrouter client, model allowlist, tool specs
    search.ts     hybrid_search wrapper + optional Cohere reranker
    chat.ts       system prompt, context builder, citation parsing
    settings.ts   per-user model overrides over env defaults
    tree.ts       space tree builder for the sidebar
  proxy.ts        Next 16 "middleware" — refreshes Supabase session cookies
supabase/migrations/  SQL — schema, RLS, hybrid_search, storage policies
scripts/              apply-migrations, seed, backup, loginlink, setpassword, upload-obsidian
docs/                 PROJECT_PLAN_v2 and UI reference
```

## Commands

- `npm run dev` — start the dev server
- `npm run typecheck` — `tsc --noEmit`; run this before claiming a TS change works (no test suite)
- `npm run db:migrate` — apply every `.sql` in `supabase/migrations/` idempotently
- `npm run db:generate` — drizzle-kit generate (for inspection only; see "Don't" below)
- `npm run seed <email>` — invite + admin + create the three default spaces
- `npm run upload-obsidian` — bulk-import an Obsidian vault zip
- `npm run backup` — pg_dump → Supabase Storage `backups` bucket

## Auth & RLS — read this before touching data access

There is a **known recursion bug** in the `users` SELECT policy: it self-references and silently returns null. See memory [[rls-users-recursion]]. Consequences encoded in the codebase:

- App-code auth checks for users/documents/spaces use the **service client** ([createServiceClient](src/lib/supabase/server.ts#L27)) after an explicit `requireUser()` / `requireAdmin()` check, **not** the user-scoped client relying on RLS.
- [getCurrentUserRecord](src/lib/auth.ts#L19) and [getAccessibleSpaces](src/lib/auth.ts#L38) both go through the service client by design — don't "fix" this by switching to the RLS client.
- The user-scoped [`createClient()`](src/lib/supabase/server.ts#L5) is still correct for `auth.getUser()` (session validation) and for places where RLS is known to behave (chunks, audit_log inserts as the user). Pattern: validate auth via the user client, then read/write data via the service client.

## Env

All env access goes through [src/lib/env.ts](src/lib/env.ts). Two things to remember:

1. **NEXT_PUBLIC_* must be referenced as static property access** (`process.env.NEXT_PUBLIC_FOO`), never dynamic indexing. Turbopack/Next only inline the static form into the client bundle.
2. **Supabase key naming**: prefer the new `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`; the env module falls back to the legacy `ANON_KEY` / `SERVICE_ROLE_KEY` for now.

User-selectable models are gated by `CHAT_MODEL_ALLOWLIST` in the same file — keep it in sync with [openrouter-models.ts](src/lib/ai/openrouter-models.ts).

## Ingest

[src/lib/ingest/pipeline.ts](src/lib/ingest/pipeline.ts) is the single entry point. Two tiers:

- **Indexed** (`.md`, `.markdown`, `.txt`, `.docx`, `.zip` of those): extract → chunk via `llm-text-splitter` → embed in batches of 100 → upsert `documents`, replace `chunks`, resolve wikilinks. Embeddings are stored as the `vector` column on `chunks`; large code blocks are stored unembedded.
- **Metadata-only** (`.pdf`, `.pptx`, `.xlsx`, etc.): upload to Storage `originals` bucket, insert a `documents` row with `processing_status = 'metadata_only'`, no chunks. These are findable by title/tag but not semantically.

Content hash short-circuits unchanged re-uploads. Conflict policy is `replace | skip | version` per call. Audit rows are written on every create/replace.

## Search & chat

- [`search()`](src/lib/search.ts) embeds the query (using the user's effective embedding model), calls the `hybrid_search` RPC (pgvector cosine + FTS fused via RRF), hydrates document metadata, then optionally reranks the top results via OpenRouter's `/rerank` endpoint (Cohere). The reranker is best-effort — failures fall back to RRF order.
- Chat is in [src/app/api/chat/route.ts](src/app/api/chat/route.ts). Streams from OpenRouter, supports tool calls (see [src/lib/ai/tools.ts](src/lib/ai/tools.ts)) with a 6-iteration cap, enforces the model allowlist per-user.

## Don't

- **Don't generate Drizzle SQL migrations to mutate the live DB.** Edit [supabase/migrations/*.sql](supabase/migrations/) and re-run `npm run db:migrate`. The Drizzle schema in `src/lib/db/schema.ts` is a typing mirror; if you change one, change the other.
- **Don't rely on RLS** for reads/writes against `users`, `documents`, or `spaces` from app code — do the auth check yourself and use the service client. See "Auth & RLS" above.
- **Don't dynamically index `process.env`** for `NEXT_PUBLIC_*` vars.
- **Don't add new chat models** without putting them in both `CHAT_MODEL_ALLOWLIST` and `openrouter-models.ts`.
- **Don't change `chunks.embedding` dimensionality** without a migration — the index and the `hybrid_search` function both assume 1536.
- **Don't add tests for the sake of it** — there's no test suite; for UI changes, run `npm run dev` and use the feature.

## Verification

- TS changes: `npm run typecheck`.
- DB changes: edit the SQL file, run `npm run db:migrate`, confirm with `db:studio` or a `psql` round-trip.
- RLS changes: run the two-user verification described in README §Verifying RLS before shipping.
- UI changes: `npm run dev`, exercise the feature, watch the browser console.
