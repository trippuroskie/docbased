-- Per-user model preferences. One row per user, lazily upserted on first save.
-- All columns nullable except user_id — server falls back to env defaults
-- (CHAT_MODEL_ALLOWLIST / EMBEDDING_MODEL / RERANKER_MODEL) for anything unset.

create table if not exists user_settings (
  user_id            uuid primary key references users(id) on delete cascade,
  chat_models        text[] not null default '{}',
  default_chat_model text,
  embedding_model    text,
  reranker_model     text,
  updated_at         timestamptz default now()
);

alter table user_settings enable row level security;

drop policy if exists "user_settings self" on user_settings;
create policy "user_settings self"
  on user_settings for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
