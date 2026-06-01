-- Personal access tokens for programmatic access (remote MCP server, CLI).
--
-- The plaintext token is shown to the user exactly once, at creation; only a
-- SHA-256 hash is stored here. A token maps to a single user; the remote MCP
-- server resolves that user's space access on every request (same per-user
-- model as the web app — see resolveCallerForUser in src/lib/core/auth.ts).

create table if not exists mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  name         text not null,
  token_prefix text not null,         -- leading chars for display (e.g. 'dbk_a1b2c3')
  token_hash   text not null unique,  -- sha256(token), hex; the only stored secret material
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz,           -- null = never expires
  revoked_at   timestamptz            -- non-null = revoked, rejected on validate
);

create index if not exists mcp_tokens_user_idx on mcp_tokens (user_id, created_at desc);
create index if not exists mcp_tokens_hash_idx on mcp_tokens (token_hash);

alter table mcp_tokens enable row level security;

-- Owners manage their own tokens. This policy does NOT reference the `users`
-- table, so it avoids the recursion bug documented in AGENTS.md. App code still
-- reads/writes via the service client after an explicit requireUser() check,
-- and the MCP server validates tokens with the service client.
drop policy if exists "mcp_tokens self" on mcp_tokens;
create policy "mcp_tokens self"
  on mcp_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
