-- docbased schema. See docs/PROJECT_PLAN_v2.md §4.

create table if not exists users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text unique not null,
  display_name  text,
  is_admin      boolean default false,
  created_at    timestamptz default now()
);

create table if not exists spaces (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  description   text,
  created_at    timestamptz default now()
);

create table if not exists space_access (
  space_id   uuid references spaces(id) on delete cascade,
  user_id    uuid references users(id) on delete cascade,
  role       text not null check (role in ('viewer','editor','owner')),
  created_at timestamptz default now(),
  primary key (space_id, user_id)
);

create table if not exists documents (
  id                    uuid primary key default gen_random_uuid(),
  space_id              uuid not null references spaces(id) on delete cascade,
  title                 text not null,
  path                  text not null,
  source_format         text not null,
  processing_status     text not null default 'indexed'
                        check (processing_status in ('indexed','metadata_only','failed','pending')),
  original_filename     text not null,
  original_storage_path text,
  raw_content           text,
  content_hash          text,
  frontmatter           jsonb default '{}'::jsonb,
  tags                  text[] default '{}',
  embedding_model       text,
  uploaded_by           uuid references users(id),
  last_edited_by        uuid references users(id),
  last_viewed_at        timestamptz,
  last_edited_at        timestamptz default now(),
  created_at            timestamptz default now(),
  deleted_at            timestamptz,
  unique (space_id, path)
);

create index if not exists documents_space_active_idx
  on documents (space_id) where deleted_at is null;
create index if not exists documents_status_idx
  on documents (processing_status);
create index if not exists documents_tags_idx
  on documents using gin (tags);
create index if not exists documents_fts_idx
  on documents using gin (to_tsvector('english', coalesce(raw_content, title)));

create table if not exists chunks (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references documents(id) on delete cascade,
  ordinal         int not null,
  content         text not null,
  token_count     int,
  heading_path    text[],
  embedding       vector(1536),
  embedding_model text not null default 'openai/text-embedding-3-small',
  fts             tsvector generated always as (to_tsvector('english', content)) stored
);

create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists chunks_fts_idx
  on chunks using gin (fts);
create index if not exists chunks_document_idx
  on chunks (document_id);

create table if not exists links (
  src_document_id uuid references documents(id) on delete cascade,
  dst_title       text not null,
  dst_document_id uuid references documents(id) on delete set null,
  primary key (src_document_id, dst_title)
);

create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  title      text,
  space_ids  uuid[] not null,
  created_at timestamptz default now()
);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  model           text,
  citations       jsonb default '[]'::jsonb,
  feedback        text check (feedback in ('up','down')),
  created_at      timestamptz default now()
);

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references users(id),
  action      text not null,
  target_type text not null,
  target_id   uuid,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create index if not exists audit_log_actor_idx on audit_log (actor_id, created_at desc);
create index if not exists audit_log_target_idx on audit_log (target_type, target_id);

create table if not exists chat_usage (
  user_id uuid references users(id) on delete cascade,
  day     date not null,
  count   int not null default 0,
  primary key (user_id, day)
);
