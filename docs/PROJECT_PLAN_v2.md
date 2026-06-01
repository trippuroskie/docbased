# docbased — Project Plan v2

A shadcn-styled documentation and search tool for multiple knowledge "spaces" (IT, Ecomm, personal notes, future departments), with semantic search and RAG chat scoped to each user's access. Built for two audiences: (1) the person backfilling the author's IT role, and (2) the author in their new Ecomm role, using the same tool to make accumulated knowledge searchable.

This document is the source of truth for v1. It is intended to be handed to an implementation agent (Claude Code, Cursor, etc.) and executed phase by phase.

---

## 1. Scope and goals

**v1 in scope**
- Multiple knowledge "spaces" with per-user role-based access (viewer/editor/owner).
- Manual upload with two tiers:
  - **Fully indexed** (semantic search + chat): `.md`, `.txt`, and `.zip` containing `.md`/`.txt` (bulk import of Obsidian vault exports).
  - **Metadata only** (findable by filename and tags, downloadable, but not semantically searchable): any other format including `.pdf`, `.docx`, `.pptx`, `.xlsx`. These files are stored in Supabase Storage and listed in the document tree with a 📎 attachment badge.
- Originals always preserved in Supabase Storage regardless of tier.
- In-app markdown editing for indexed docs (basic editor).
- Hybrid semantic + keyword search across accessible spaces, with cmd-K palette.
- RAG chat with citations, scoped to accessible spaces, with user-selectable chat model.
- Admin: invite users, manage spaces, assign roles, view audit log.
- Magic-link auth (Supabase built-in email, invite-only signup).

**Explicitly out of scope for v1**
- **Semantic indexing of `.pdf`, `.docx`, `.pptx`, `.xlsx`** — these formats are accepted as uploads in v1, but only stored + metadata-indexed. Full extraction is a v1.5 feature (see §9), added in priority order based on real demand once v1 is in use.
- Automated Obsidian sync (local Obsidian remains the author's primary capture tool; manual upload is the publishing path).
- Automated SharePoint ingest via Graph API.
- Full "capture mode" features (autosave, cmd-N global shortcut, wikilink autocomplete on type, URL clipper).
- Microsoft/Azure AD SSO (Supabase Auth with magic links is sufficient; SSO can be added as an additional provider later without user migration).
- Mobile-native app (responsive web only).
- Real-time collaborative editing.
- Per-document permissions (per-space roles only).
- Custom branding / custom domain (Vercel default domain is fine for v1).

**Success criteria**
- Backfill hire can find an answer to "how do I do X?" via search or chat with a cited source in under 3 seconds.
- Author can publish a new note from local Obsidian to the Ecomm space in under 30 seconds (export → drag → done).
- Setup runbook is concrete enough that another IT-capable person can re-deploy from scratch.

---

## 2. Architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| Framework | Next.js 15 (App Router, RSC, Server Actions) | Best fit for shadcn; Vercel deployment is trivial. |
| UI | shadcn/ui + Tailwind 4 + Radix | Matches author's stated preference; mature component set. |
| Database | Supabase (Postgres 15 + pgvector 0.8+ + pg_trgm + unaccent) | One DB for relational + vectors + storage + auth. pgvector with HNSW is production-grade well past this corpus's scale. |
| ORM | Drizzle | Better pgvector ergonomics than Prisma; faster at edge. |
| AI gateway | OpenRouter | Single API key for embeddings and chat across providers; OpenAI-compatible interface means easy migration if needed. |
| Default embedding model | `openai/text-embedding-3-small` (1536 dims) via OpenRouter | Cheap, strong quality, ubiquitous tooling. Swap to bge-m3 or voyage-context-3 via config later if quality issues emerge. |
| Default chat model | `anthropic/claude-sonnet-4.5` via OpenRouter, user-selectable from allowlist | Strong citation discipline; user can pick alternatives. |
| Search strategy | Hybrid: pgvector cosine + Postgres FTS (`tsvector`) fused via Reciprocal Rank Fusion | Vector-only misses exact terms; FTS misses semantics. RRF is the simple, robust fusion. |
| Auth | Supabase Auth, magic link, invite-only signup, built-in Supabase email | No external dependencies; no IT department involvement; swap email provider to Resend in v2 without user migration. |
| Access control | Row Level Security on documents and chunks | Enforce at the database — every new feature inherits access rules for free. |
| File normalization | Convert all uploads to markdown at ingest; preserve originals in Storage | Better embedding quality, uniform rendering, simpler editing pipeline, future-proof corpus. |

---

## 3. Technology stack

```
Framework        Next.js 15 (App Router, TypeScript strict)
UI               shadcn/ui + Tailwind 4 + Radix
Markdown render  react-markdown + remark-gfm + rehype-shiki + remark-frontmatter
DB               Supabase (Postgres 15, pgvector 0.8+, pg_trgm, unaccent)
ORM              Drizzle
Auth             Supabase Auth (magic link, built-in email for v1)
Storage          Supabase Storage (for original uploaded binaries)
AI gateway       OpenRouter (via OpenAI SDK with custom baseURL)
File extractors  gray-matter (md frontmatter), mammoth (docx→md), 
                 pdf-parse (pdf→text→md), node-pptx-parser (pptx), 
                 xlsx (xlsx→md tables), jszip (zip extraction)
Markdown chunker llm-text-splitter (markdown-aware)
Hosting          Vercel (web app) + Supabase (DB + storage + auth)
Background work  Vercel Cron + Supabase Edge Functions for heavy ingest
```

---

## 4. Data model

```sql
-- Extensions
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Users (extends Supabase auth.users)
create table users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text unique not null,
  display_name  text,
  is_admin      boolean default false,
  created_at    timestamptz default now()
);

-- Knowledge spaces
create table spaces (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  description   text,
  created_at    timestamptz default now()
);

-- Space access (role-based)
create table space_access (
  space_id  uuid references spaces(id) on delete cascade,
  user_id   uuid references users(id) on delete cascade,
  role      text not null check (role in ('viewer','editor','owner')),
  created_at timestamptz default now(),
  primary key (space_id, user_id)
);

-- Documents (every doc lives in exactly one space)
create table documents (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null references spaces(id) on delete cascade,
  title               text not null,
  path                text not null,                    -- for tree display: 'Networking/VLANs/Site VPN'
  source_format       text not null,                    -- 'md','txt','pdf','docx','pptx','xlsx','other'
  processing_status   text not null default 'indexed'   -- 'indexed' = full text + embeddings; 'metadata_only' = file stored, name/tags searchable only
                      check (processing_status in ('indexed','metadata_only','failed','pending')),
  original_filename   text not null,
  original_storage_path text,                           -- Supabase Storage key; null only for inline-created md
  raw_content         text,                             -- markdown; null when processing_status = 'metadata_only'
  content_hash        text,                             -- sha256 of raw_content; null when metadata_only
  frontmatter         jsonb default '{}'::jsonb,
  tags                text[] default '{}',
  embedding_model     text,                             -- null when metadata_only
  uploaded_by         uuid references users(id),
  last_edited_by      uuid references users(id),
  last_viewed_at      timestamptz,
  last_edited_at      timestamptz default now(),
  created_at          timestamptz default now(),
  deleted_at          timestamptz,                      -- soft delete
  unique (space_id, path)
);

create index on documents (space_id) where deleted_at is null;
create index on documents (processing_status);
create index on documents using gin (tags);
create index on documents using gin (to_tsvector('english', coalesce(raw_content, title)));

-- Chunks (the unit of retrieval)
create table chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  ordinal       int not null,
  content       text not null,
  token_count   int,
  heading_path  text[],                                  -- ['Networking','VLANs','Step 3']
  embedding     vector(1536),
  embedding_model text not null default 'openai/text-embedding-3-small',
  fts           tsvector generated always as (to_tsvector('english', content)) stored
);

create index on chunks using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index on chunks using gin (fts);
create index on chunks (document_id);

-- Wikilinks (for backlinks panel; resolved lazily at ingest)
create table links (
  src_document_id uuid references documents(id) on delete cascade,
  dst_title       text not null,
  dst_document_id uuid references documents(id) on delete set null,
  primary key (src_document_id, dst_title)
);

-- Chat
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  title       text,
  space_ids   uuid[] not null,                          -- which spaces are in scope for this chat
  created_at  timestamptz default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  model           text,                                 -- which chat model produced this
  citations       jsonb default '[]'::jsonb,            -- [{document_id, chunk_id, snippet}]
  feedback        text check (feedback in ('up','down')),
  created_at      timestamptz default now()
);

-- Audit log (who did what when)
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references users(id),
  action      text not null,                            -- 'upload','edit','delete','invite','grant_access','revoke_access'
  target_type text not null,                            -- 'document','space','user','space_access'
  target_id   uuid,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create index on audit_log (actor_id, created_at desc);
create index on audit_log (target_type, target_id);

-- Rate limiting (simple per-user-per-day chat counter)
create table chat_usage (
  user_id  uuid references users(id) on delete cascade,
  day      date not null,
  count    int not null default 0,
  primary key (user_id, day)
);
```

### Row Level Security policies

```sql
alter table documents enable row level security;
alter table chunks enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

-- Helper view
create or replace view user_accessible_spaces as
  select user_id, space_id, role from space_access;

create policy "documents readable by space members"
  on documents for select
  using (
    deleted_at is null
    and (
      space_id in (select space_id from user_accessible_spaces where user_id = auth.uid())
      or (select is_admin from users where id = auth.uid())
    )
  );

create policy "documents editable by editors and owners"
  on documents for update
  using (
    space_id in (
      select space_id from user_accessible_spaces
      where user_id = auth.uid() and role in ('editor','owner')
    )
    or (select is_admin from users where id = auth.uid())
  );

create policy "chunks readable when parent document is readable"
  on chunks for select
  using (
    document_id in (select id from documents)  -- RLS on documents cascades here
  );

create policy "conversations are private to the user"
  on conversations for all
  using (user_id = auth.uid());

create policy "messages readable via conversation"
  on messages for all
  using (
    conversation_id in (select id from conversations where user_id = auth.uid())
  );
```

This is the most important design decision in the whole project. Access rules live in the database, not in app code. Every future feature inherits them automatically.

---

## 5. File ingestion pipeline

v1 uses a two-tier ingestion model. The tier is determined by file extension at upload time and reflected in the document's `processing_status`.

### 5.1 Tier 1: Indexed (full semantic search + chat)

Formats: `.md`, `.txt`, and `.zip` containing only `.md` and `.txt` files.

These formats have trivial, lossless extraction — no library quirks, no quality variance, no surprises. They're also the formats your most valuable content already lives in (Obsidian markdown).

### 5.2 Tier 2: Metadata only (stored, downloadable, findable by filename/tags)

Formats: `.pdf`, `.docx`, `.pptx`, `.xlsx`, and any other extension.

These are uploaded, stored in Supabase Storage, and recorded in the `documents` table with `processing_status = 'metadata_only'`. They appear in the document tree with a 📎 badge. They are:
- Searchable by filename, tags, and uploader
- Downloadable via "Open original"
- Listed in space browsing
- **Not** included in semantic search results
- **Not** retrieved during chat
- **Not** previewable in the document viewer (the viewer shows a "This is a binary file — download to view" placeholder)

This tier exists so the v1 corpus can hold all the relevant files even when full extraction isn't built yet. In v1.5, extractors for these formats can be added incrementally — when one ships, a background job re-processes existing files of that type and flips them to `indexed` status. Users see them become semantically searchable without any re-upload.

### 5.3 Upload entry points

- **Drag-and-drop on `/admin/upload`**: pick destination space, drag one or more files of any supported tier. Multi-file is single batch. UI clearly indicates which uploads will be indexed vs metadata-only.
- **Zip extraction (Tier 1 only)**: drop a `.zip` (typically an Obsidian vault export). The extractor walks the zip and processes each `.md` / `.txt` as a document, preserving folder structure as `path`. Non-markdown files inside a zip are skipped in v1 (with a summary count shown to the user); v1.5 changes this to extract them as Tier 2 documents.
- **Re-upload by filename**: if a document with the same `(space_id, path)` already exists, prompt: Replace / Skip / Add as new version. Default Replace.

### 5.4 Tier 1 extractor

| Format | Tool | Notes |
|---|---|---|
| `.md` | gray-matter | Parse frontmatter, normalize line endings. Resolve `[[wikilinks]]` lazily into `links` table after batch upload. |
| `.txt` | none | Wrap as a single markdown body; no transformation. Title from filename. |
| `.zip` | jszip | Walk recursively; each contained `.md` / `.txt` ingested via the rules above; folder structure becomes `path`. |

### 5.5 Tier 2 handling

- File is uploaded to Supabase Storage at `originals/{space_id}/{document_id}/{filename}`.
- Document row created with `processing_status = 'metadata_only'`, `raw_content = null`, `embedding_model = null`.
- Tags can be applied during upload (UI supports a tag picker for batches).
- No chunking, no embedding, no audit-trail-of-extraction.
- Audit log entry records the upload with `metadata: { tier: 'metadata_only' }`.

### 5.6 Chunking (Tier 1 only)

- Markdown-aware splitter (llm-text-splitter, markdown preset).
- Target chunk size: ~800 tokens, 150 token overlap.
- **Preserve heading hierarchy as `heading_path`** on each chunk. This is the single highest-quality lever for IT documentation — a chunk that knows it lives under "Networking → VLANs → Step 3" is dramatically more retrievable.
- Skip embedding code blocks larger than ~500 tokens (they cluster by language, not by purpose); index them as keyword-only chunks.

### 5.7 Embedding (Tier 1 only)

- Call OpenRouter `/v1/embeddings` with `model: 'openai/text-embedding-3-small'`.
- Batch in groups of 100 chunks per request.
- Store `embedding_model` per chunk so we can detect and re-embed when the model changes.

### 5.8 Pipeline summary

```
Upload received
  → File type detection from extension + MIME
  → Tier decision:
     Tier 1 (md/txt/zip):
       → Extract markdown body
       → Upload original to Storage
       → Compute content_hash
       → Skip if hash unchanged
       → Parse frontmatter and tags
       → Chunk markdown (preserving heading_path)
       → Embed chunks via OpenRouter
       → Upsert document with processing_status = 'indexed'
       → Replace chunks
       → Resolve wikilinks in second pass after batch completes
     Tier 2 (everything else):
       → Upload original to Storage
       → Insert document with processing_status = 'metadata_only'
       → Apply tags from upload UI
  → Audit log entry
```

---

## 6. Search and chat

### 6.1 Hybrid search SQL

```sql
create or replace function hybrid_search(
  query_text text,
  query_embedding vector(1536),
  space_ids uuid[],
  match_count int default 20,
  rrf_k int default 60
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  heading_path text[],
  score float
)
language sql stable security invoker
as $$
  with accessible_chunks as (
    select c.id, c.document_id, c.content, c.heading_path, c.embedding, c.fts
    from chunks c
    join documents d on d.id = c.document_id
    where d.space_id = any(space_ids)
      and d.deleted_at is null
  ),
  vec as (
    select id as chunk_id, document_id, content, heading_path,
           row_number() over (order by embedding <=> query_embedding) as rank
    from accessible_chunks
    order by embedding <=> query_embedding
    limit match_count * 2
  ),
  fts as (
    select id as chunk_id, document_id, content, heading_path,
           row_number() over (
             order by ts_rank_cd(fts, websearch_to_tsquery('english', query_text)) desc
           ) as rank
    from accessible_chunks
    where fts @@ websearch_to_tsquery('english', query_text)
    order by ts_rank_cd(fts, websearch_to_tsquery('english', query_text)) desc
    limit match_count * 2
  )
  select
    coalesce(vec.chunk_id, fts.chunk_id) as chunk_id,
    coalesce(vec.document_id, fts.document_id) as document_id,
    coalesce(vec.content, fts.content) as content,
    coalesce(vec.heading_path, fts.heading_path) as heading_path,
    coalesce(1.0/(rrf_k + vec.rank), 0) + coalesce(1.0/(rrf_k + fts.rank), 0) as score
  from vec
  full outer join fts on vec.chunk_id = fts.chunk_id
  order by score desc
  limit match_count;
$$;
```

`security invoker` means the function runs as the calling user, so RLS still applies — defense in depth.

### 6.2 Chat flow

```
User question
  ├─ Check rate limit (chat_usage table; default 50 messages/user/day, configurable)
  ├─ Embed query via OpenRouter
  ├─ Determine accessible space_ids for this user from space_access
  ├─ Apply conversation's space scope (intersect with accessible)
  ├─ Call hybrid_search() with the resulting space_ids
  ├─ Build prompt:
  │    - System: "Answer using only the provided context. 
  │              If the context doesn't contain the answer, say so explicitly.
  │              Cite sources with <cite source='N'>…</cite> tags."
  │    - Context: top chunks with heading_path, document title, and source N labels
  │    - User: the question
  ├─ Stream response from OpenRouter
  ├─ Parse <cite> tags into structured citations
  ├─ Persist message with citations
  └─ Return to UI
```

The "If the context doesn't contain the answer, say so" instruction is critical for IT runbook accuracy. Without it, the model will invent plausible-sounding commands that don't exist.

### 6.3 Optional reranker

After hybrid retrieval returns 20 candidates, send the top 20 to a reranker (`cohere/rerank-3.5` via OpenRouter) and use top 5 as the final context. ~150ms latency, real quality lift. Make this a config flag; on by default.

---

## 7. UI

Three-pane shadcn layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  Top bar: cmd-K search, space scope picker, user menu           │
├──────────────┬─────────────────────────────────┬────────────────┤
│              │                                 │                │
│  Sidebar     │  Document viewer                │  Chat panel    │
│              │                                 │                │
│  Spaces      │  - rendered markdown            │  - thread      │
│  ├ IT        │  - frontmatter chips            │  - citations   │
│  │  └ tree   │  - tag chips                    │    link to     │
│  ├ Ecomm     │  - "Edit" / "View original"     │    center pane │
│  │  └ tree   │  - last edited / uploaded       │  - space scope │
│  └ Notes     │  - stale indicator (12+ mo)     │  - model pick  │
│              │  - backlinks at bottom          │  - thumbs      │
│              │                                 │                │
└──────────────┴─────────────────────────────────┴────────────────┘
```

**Routes**
- `/` — landing: recent edits across your spaces, most-viewed in last 30d, "ask anything" prompt
- `/space/[slug]` — space-scoped browse view with full tree
- `/doc/[id]` — document viewer
- `/doc/[id]/edit` — inline markdown editor (basic textarea or CodeMirror — keep it simple in v1)
- `/search?q=...&spaces=...` — full search results
- `/chat/[id]` — persisted chat thread
- `/admin` — admin home
  - `/admin/upload` — upload UI
  - `/admin/users` — invite, list, last-login, deactivate
  - `/admin/spaces` — create, edit, delete spaces
  - `/admin/access` — assign roles
  - `/admin/audit` — audit log viewer
  - `/admin/usage` — chat usage and embedding cost (read from OpenRouter dashboard link)

**shadcn components to install**
sidebar, command, dialog, tabs, accordion, badge, button, input, textarea, scroll-area, separator, tooltip, dropdown-menu, resizable, skeleton, sonner, alert-dialog, sheet, avatar, hover-card.

**Cmd-K palette**: debounced hybrid search across accessible spaces. Top 5 results selectable by keyboard. "Open" goes to doc viewer; "Ask AI" sends the query to a fresh chat.

**Wikilink rendering**: `[[Note Title]]` resolves via lookup on `documents.title` within the user's accessible spaces. If resolved → `<Link>` to the doc. If not → muted broken-link badge (useful as a corpus-quality signal).

**Stale doc indicator**: documents with `last_edited_at > 12 months ago` show a ⚠️ badge in the viewer and search results. Tooltip explains: "This document hasn't been updated in over a year — verify before relying on it."

---

## 8. Implementation phases

Each phase ends in something runnable. Don't skip ahead.

### Phase 0 — Setup (½ day)

- [ ] Create Supabase project (Org-owned account, **not** personal — see §10).
- [ ] Enable `vector`, `pg_trgm`, `unaccent` extensions.
- [ ] Create OpenRouter account (org-owned), add credits, set monthly spend ceiling, generate API key.
- [ ] Scaffold Next.js 15 app: `pnpm create next-app@latest docbased --typescript --tailwind --app --src-dir`
- [ ] Run `pnpm dlx shadcn@latest init`, install components listed in §7.
- [ ] Install deps: `drizzle-orm`, `postgres`, `@supabase/supabase-js`, `@supabase/ssr`, `openai`, `gray-matter`, `jszip`, `react-markdown`, `remark-gfm`, `remark-frontmatter`, `rehype-shiki`, `llm-text-splitter`. *(Rich-format extractors — mammoth, pdf-parse, node-pptx-parser, xlsx — deferred to v1.5.)*
- [ ] Configure environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `EMBEDDING_MODEL`, `DEFAULT_CHAT_MODEL`, `MONTHLY_SPEND_CEILING`.

### Phase 1 — Data model and auth (1 day)

- [ ] Write Drizzle migrations for all tables in §4.
- [ ] Write and apply RLS policies in §4.
- [ ] Configure Supabase Auth: enable email/magic-link provider, **disable public signup**, configure built-in email templates (login link branding).
- [ ] Build `/login` page: single email input, calls `supabase.auth.signInWithOtp()`.
- [ ] Build `/auth/callback` route for magic link verification.
- [ ] Build Next.js middleware that requires authenticated session on all routes except `/login` and `/auth/callback`.
- [ ] Build admin-only "invite user" endpoint: takes email, creates Supabase auth user, inserts into `users`, sends magic link.

### Phase 2 — Upload and extract (1 day)

- [ ] Build `/admin/upload` page: shadcn dropzone, space picker, multi-file support, tag picker for the batch.
- [ ] In the dropzone UI, badge each file with its expected tier (✓ Indexed for md/txt/zip; 📎 Metadata only for everything else) before the user clicks "Upload."
- [ ] Build `lib/ingest/extractors/`: `md.ts`, `txt.ts`, `zip.ts` only. Each exports `extract(buffer: Buffer): Promise<{ markdown: string, frontmatter, title }>`.
- [ ] Build `lib/ingest/pipeline.ts` that orchestrates: detect tier → run Tier 1 extractor OR store-and-tag for Tier 2 → upload original to Storage → hash → chunk → embed → upsert.
- [ ] Build `lib/ai/openrouter.ts` — single client used for both embeddings and chat, baseURL `https://openrouter.ai/api/v1`.
- [ ] Zip handler walks contents, processes `.md` / `.txt` only, reports count of skipped files to the user with a friendly summary ("12 markdown files indexed, 4 non-text files skipped — these will be indexable once v1.5 ships").
- [ ] Implement re-upload conflict resolution dialog (Replace / Skip / Add as new version).
- [ ] Write `audit_log` entries on every upload including the tier.

### Phase 3 — Browse and view (1 day)

- [ ] Build the three-pane layout with shadcn `resizable`.
- [ ] Sidebar: list spaces, lazy-load tree of documents per space, indicate role. Show ✓ (indexed) or 📎 (metadata-only) badge next to each document.
- [ ] Document viewer (indexed docs): render `raw_content` via react-markdown, frontmatter chips at top, tag chips, "Edit" button (if editor/owner), "Download original" link, stale-doc warning if applicable, backlinks panel from `links` table.
- [ ] Document viewer (metadata-only docs): show file info card with filename, size, uploaded-by, tags, and a prominent "Download original" button. Include a note explaining the file is stored but not yet semantically searchable, with a brief mention that this will improve in v1.5.
- [ ] Edit page (indexed docs only): simple textarea or CodeMirror with markdown mode; on save, update `raw_content`, recompute `content_hash`, re-chunk, re-embed, audit log.
- [ ] Track `last_viewed_at` on document open.

### Phase 4 — Search and chat (1–2 days)

- [ ] Implement `hybrid_search()` SQL function.
- [ ] Build `/api/search` route: takes `q`, embeds via OpenRouter, calls `hybrid_search()` with user's accessible spaces, returns results grouped by document.
- [ ] Build cmd-K palette wired to `/api/search` with 300ms debounce.
- [ ] Build `/search` results page.
- [ ] Build `/api/chat` route: streams from OpenRouter, parses citations, persists messages.
- [ ] Build chat panel UI: message thread, citation pills that scroll the viewer to the cited doc, space-scope picker, model picker (allowlist of 4–5 models), thumbs feedback.
- [ ] Implement chat rate limit via `chat_usage` table.

### Phase 5 — Admin (½ day)

- [ ] User management page: list, last login, invite by email, deactivate, toggle admin.
- [ ] Space management page: create, rename, delete (soft).
- [ ] Access management page: matrix of users × spaces with role dropdowns.
- [ ] Audit log viewer: filterable by actor, action, date range.
- [ ] "Re-embed all" admin action: marks chunks for re-embedding via background processing.

### Phase 6 — Operational (½ day)

- [ ] Configure Vercel: env vars, custom domain optional, password protection as belt-and-suspenders before launch.
- [ ] Set up weekly `pg_dump` to Supabase Storage or external S3 via Vercel Cron + a small script.
- [ ] Verify monthly spend ceiling is set in OpenRouter dashboard.
- [ ] Test full flow end-to-end: invite a fresh user, they log in, get assigned to a space, upload a file, search, chat, edit, see audit log entries.
- [ ] Write `README.md` runbook: how to deploy, how to recover from backup, how to swap embedding models, how to escalate cost if OpenRouter spend ceiling hits.

**Total estimated v1: 4–6 focused days.**

---

## 9. v1.5 and v2 backlog (priority order)

### v1.5 — Rich-format extractors (incremental, ship one at a time)

Tier 2 (metadata-only) documents become Tier 1 (indexed) as extractors land. Each ships independently:

1. **`.docx` extractor** via Mammoth → markdown. Highest expected demand; cleanest extraction quality. Includes image extraction to Storage with rewritten refs. ~½ day.
2. **`.pdf` extractor** via pdf-parse + heading heuristic. Quality depends heavily on PDF type — test against a sample of your real corpus before shipping broadly. v2 candidate: swap to Mistral OCR or LlamaParse for tough PDFs. ~½–1 day.
3. **`.xlsx` extractor** via xlsx library → markdown tables. Each sheet becomes a section. ~½ day.
4. **`.pptx` extractor** via node-pptx-parser. Each slide → `## H2` heading + bullets + speaker notes. ~½ day.

Each extractor includes a background job that finds existing `metadata_only` documents of that type and upgrades them to `indexed` automatically — no re-upload needed.

### v2 — Bigger features

Based on actual usage feedback, expected priority is roughly:

1. **Obsidian sync via GitHub** — Author's local Obsidian auto-commits to a private repo; webhook triggers incremental re-ingest on push. Most likely first v2 feature once manual upload starts feeling tedious. ~2 days.
2. **Automated SharePoint ingest** — Either Microsoft 365 Copilot Retrieval API (if licensed) or Graph API + delta sync. ~1–3 days.
3. **Resend for email** — Drop-in replacement when Supabase built-in email rate limit or deliverability becomes a problem. ~10 minutes config.
4. **Capture mode** — `cmd-N` new note, real markdown editor with shortcuts, wikilink autocomplete on type, URL clipper. Only build if author actually moves capture off Obsidian. ~3 days.
5. **Azure AD SSO** — Add as additional provider alongside magic link; existing users unaffected. ~½ day.
6. **Document versioning** — `document_versions` table with diff viewer. Currently `last_edited_at` is the only history. ~1 day.
7. **Knowledge graph view** — Render the `links` table as an interactive graph. Looks cool, low utility; defer indefinitely unless requested.
8. **Slack bot** — `/ask` slash command wraps the chat endpoint. ~½ day.

---

## 10. Risks and operational notes

| Risk / concern | Mitigation |
|---|---|
| **Sensitive docs uploaded by mistake.** No automated SharePoint sync means everything in the corpus was put there manually — but a user with editor access could still upload something they shouldn't. | Document the upload policy clearly; "if it's HR-confidential, don't upload." Audit log makes it traceable. Per-space access means you can quarantine sensitive content to a small-membership space. |
| **OpenRouter cost runaway.** | Hard monthly spend ceiling in OpenRouter dashboard; per-user daily rate limit on chat endpoint; cheap default embedding model. |
| **Supabase free-tier limits.** Free tier has 500MB DB, 1GB storage, 50K monthly active users. | Plenty for v1. Upgrade to Pro ($25/mo) when DB or storage limits approach. |
| **Account ownership.** Hosted on author's personal accounts = single point of failure when they leave. | **Create org-owned Supabase, Vercel, and OpenRouter accounts from day one.** Author is admin, but accounts belong to the org. This is a Phase 0 task. |
| **Backfill hire can't access if author leaves.** | Org-owned accounts solve this. Also: ensure at least one other admin user exists in the app before launch. |
| **Embedding model lock-in.** Changing models requires re-embedding everything (different dimensions, different vector spaces). | `embedding_model` stored per chunk; admin "Re-embed all" action does it in batches. Budget ~$3 for a one-time re-embed of a few thousand chunks. |
| **Built-in Supabase email rate limits.** ~2–4 emails/hour. | Fine for an audience of 2–5 users. Plan for Resend swap when it bites (~10 min change). |
| **Chat hallucinations on IT runbooks.** | "Doesn't know? Say so" instruction in system prompt; citations prominent in UI; thumbs feedback collected for future quality work. Always show the cited source so users can verify. |
| **Stale documentation.** | `last_edited_at` indicator with ⚠️ badge on docs older than 12 months; backfill hire is trained to verify before relying. |
| **No real backups on free tier.** | Weekly `pg_dump` cron from day one. Backups go to a separate Storage bucket or external location. |
| **Magic link delivered to spam.** | Tell users on first login to check spam; whitelist `noreply@mail.supabase.io` in org email filters if possible; switch to Resend with verified org domain when this becomes annoying. |

### Pre-launch checklist (do before backfill hire arrives)

- [ ] Supabase, Vercel, OpenRouter accounts are org-owned, not personal.
- [ ] At least two admin users exist in the app.
- [ ] OpenRouter monthly spend ceiling is set.
- [ ] Weekly backup is running and a test restore has been performed at least once.
- [ ] Author's "start here" onboarding doc is uploaded to the IT space.
- [ ] Top 10 most-essential IT runbooks are uploaded and marked with priority tags.
- [ ] Tripp's Notes space access is restricted to author only (or whoever should have it).
- [ ] Backfill hire's account is invited with editor role on IT, no access to Tripp's Notes.

---

## 11. Reference links

- shadcn/ui — https://ui.shadcn.com
- Supabase pgvector — https://supabase.com/docs/guides/database/extensions/pgvector
- Supabase Auth (magic link) — https://supabase.com/docs/guides/auth/auth-email-passwordless
- Supabase RLS — https://supabase.com/docs/guides/database/postgres/row-level-security
- OpenRouter embeddings — https://openrouter.ai/docs/api/reference/embeddings
- OpenRouter embedding models — https://openrouter.ai/collections/embedding-models
- Mammoth (docx → markdown) — https://github.com/mwilliamson/mammoth.js
- pgvector HNSW tuning — https://github.com/pgvector/pgvector

---

## 12. Handoff notes for the executing agent

- **Phase order matters.** Don't skip ahead. Phase 1 (data model + RLS + auth) gates everything else, and getting RLS right is the single most important security decision in the project.
- **Test RLS with two real user accounts early.** Create user A with access to space X, user B with access to space Y, and confirm via direct SQL queries that they can't see each other's data even with the service-role key. Get this right before any real content goes in.
- **Markdown is the universal currency.** Every extractor must produce clean markdown. If an extractor produces garbage, fix the extractor — don't paper over it downstream.
- **Citations are not optional.** A chat answer without a working cited link is worse than no answer; it teaches users not to trust the tool.
- **Resist scope creep.** The v2 backlog is real and intentional. Capture mode, Obsidian sync, SharePoint API, document versioning, and graph view are all out of scope for v1. Ship v1, get usage feedback, then decide.
- **Heading hierarchy on chunks is the secret sauce for IT docs.** Make sure the markdown chunker preserves `heading_path` correctly. Test by querying a chunk and confirming its path matches the original document structure.
