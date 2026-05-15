-- Row Level Security. The single most important security boundary in this project.
-- Every new feature inherits these policies for free — keep that invariant.

alter table users enable row level security;
alter table spaces enable row level security;
alter table space_access enable row level security;
alter table documents enable row level security;
alter table chunks enable row level security;
alter table links enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table audit_log enable row level security;
alter table chat_usage enable row level security;

create or replace view user_accessible_spaces
with (security_invoker = true) as
  select user_id, space_id, role from space_access;

-- users
drop policy if exists "users read own row or admin reads all" on users;
create policy "users read own row or admin reads all"
  on users for select
  using (
    id = auth.uid()
    or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
  );

drop policy if exists "users update own row" on users;
create policy "users update own row"
  on users for update
  using (id = auth.uid());

-- spaces
drop policy if exists "spaces visible to members or admin" on spaces;
create policy "spaces visible to members or admin"
  on spaces for select
  using (
    id in (select space_id from user_accessible_spaces where user_id = auth.uid())
    or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
  );

-- space_access
drop policy if exists "space_access self or admin" on space_access;
create policy "space_access self or admin"
  on space_access for select
  using (
    user_id = auth.uid()
    or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
  );

-- documents
drop policy if exists "documents readable by space members" on documents;
create policy "documents readable by space members"
  on documents for select
  using (
    deleted_at is null
    and (
      space_id in (select space_id from user_accessible_spaces where user_id = auth.uid())
      or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
    )
  );

drop policy if exists "documents editable by editors and owners" on documents;
create policy "documents editable by editors and owners"
  on documents for update
  using (
    space_id in (
      select space_id from user_accessible_spaces
      where user_id = auth.uid() and role in ('editor','owner')
    )
    or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
  );

drop policy if exists "documents insertable by editors and owners" on documents;
create policy "documents insertable by editors and owners"
  on documents for insert
  with check (
    space_id in (
      select space_id from user_accessible_spaces
      where user_id = auth.uid() and role in ('editor','owner')
    )
    or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
  );

drop policy if exists "documents deletable by owners or admin" on documents;
create policy "documents deletable by owners or admin"
  on documents for delete
  using (
    space_id in (
      select space_id from user_accessible_spaces
      where user_id = auth.uid() and role = 'owner'
    )
    or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
  );

-- chunks (cascade from documents)
drop policy if exists "chunks readable when parent document is readable" on chunks;
create policy "chunks readable when parent document is readable"
  on chunks for select
  using (document_id in (select id from documents));

drop policy if exists "chunks writable when parent document is writable" on chunks;
create policy "chunks writable when parent document is writable"
  on chunks for all
  using (
    document_id in (
      select d.id from documents d
      where d.space_id in (
        select space_id from user_accessible_spaces
        where user_id = auth.uid() and role in ('editor','owner')
      )
    )
    or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
  );

-- links
drop policy if exists "links readable when source document is readable" on links;
create policy "links readable when source document is readable"
  on links for select
  using (src_document_id in (select id from documents));

-- conversations
drop policy if exists "conversations are private to the user" on conversations;
create policy "conversations are private to the user"
  on conversations for all
  using (user_id = auth.uid());

-- messages
drop policy if exists "messages readable via conversation" on messages;
create policy "messages readable via conversation"
  on messages for all
  using (
    conversation_id in (select id from conversations where user_id = auth.uid())
  );

-- audit_log: read-only for admins; insert allowed for authenticated users (server uses service role for writes)
drop policy if exists "audit_log readable by admin" on audit_log;
create policy "audit_log readable by admin"
  on audit_log for select
  using (exists (select 1 from users me where me.id = auth.uid() and me.is_admin));

-- chat_usage: each user reads/writes their own row (server uses service role)
drop policy if exists "chat_usage self" on chat_usage;
create policy "chat_usage self"
  on chat_usage for all
  using (user_id = auth.uid());
