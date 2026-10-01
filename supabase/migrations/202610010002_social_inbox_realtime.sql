-- Near-instant owner inbox refreshes for new Repliz messages and comments.
-- Run once in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- Owners can only receive rows for their own store; founders retain access.

grant select on table public.social_messages to authenticated;

drop policy if exists "Store members read inbox messages" on public.social_messages;
create policy "Store members read inbox messages"
  on public.social_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles as profile
      where profile.user_id = auth.uid()
        and (
          profile.role = 'founder'
          or profile.store_id = public.social_messages.store_id
        )
    )
  );

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'social_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.social_messages';
  end if;
end
$$;
