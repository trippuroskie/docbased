-- Storage bucket for original uploaded binaries.
-- Bucket is private; downloads use signed URLs minted by the server.

insert into storage.buckets (id, name, public)
values ('originals', 'originals', false)
on conflict (id) do nothing;

-- Allow space members to read originals scoped to their accessible spaces.
-- Storage key format: originals/{space_id}/{document_id}/{filename}
drop policy if exists "originals readable by space members" on storage.objects;
create policy "originals readable by space members"
  on storage.objects for select
  using (
    bucket_id = 'originals'
    and (
      (split_part(name, '/', 2))::uuid in (
        select space_id from space_access where user_id = auth.uid()
      )
      or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
    )
  );

-- Editors and owners can upload to their spaces.
drop policy if exists "originals writable by editors and owners" on storage.objects;
create policy "originals writable by editors and owners"
  on storage.objects for insert
  with check (
    bucket_id = 'originals'
    and (
      (split_part(name, '/', 2))::uuid in (
        select space_id from space_access
        where user_id = auth.uid() and role in ('editor','owner')
      )
      or exists (select 1 from users me where me.id = auth.uid() and me.is_admin)
    )
  );
