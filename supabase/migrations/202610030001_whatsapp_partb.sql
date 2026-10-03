-- Part B: WhatsApp Business pairing for StoYangu
-- Run once in Supabase Dashboard → SQL Editor → New query. Safe to re-run.
-- Adds WhatsApp pairing records, extends social_messages with media columns
-- used by the WhatsApp adapter, and adds strict owner-only RLS so an owner
-- can only read/modify their own store's rows.

create table if not exists public.whatsapp_pairs (
  id serial primary key,
  store_id integer not null unique references public.stores(id) on delete cascade,
  pairing_code text not null,
  consent_given_at timestamptz not null default now(),
  consent_text text not null default 'I agree to let StoYangu send and receive WhatsApp messages on behalf of this store for customer replies and order updates. I can disconnect at any time.',
  status text not null default 'pending' check (status in ('pending','paired','failed','relink_required')),
  phone_number_id text,
  waba_id text,
  business_account_id text,
  display_phone text,
  verified_name text,
  webhook_verify_token text,
  access_token_cipher text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_error text not null default '',
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_pairs_store on public.whatsapp_pairs(store_id);
create index if not exists idx_whatsapp_pairs_code on public.whatsapp_pairs(pairing_code) where status = 'pending';
create index if not exists idx_whatsapp_pairs_status on public.whatsapp_pairs(status);

alter table public.whatsapp_pairs enable row level security;

create policy "owner reads own whatsapp pair" on public.whatsapp_pairs for select
  using (
    store_id in (select store_id from public.profiles where user_id = auth.uid())
    or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
  );

create policy "owner updates own whatsapp pair" on public.whatsapp_pairs for update
  using (
    store_id in (select store_id from public.profiles where user_id = auth.uid())
    or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
  )
  with check (
    store_id in (select store_id from public.profiles where user_id = auth.uid())
    or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
  );

revoke all on table public.whatsapp_pairs from anon, authenticated;
grant select, update on table public.whatsapp_pairs to authenticated;
grant all on table public.whatsapp_pairs to service_role;
revoke all on sequence public.whatsapp_pairs_id_seq from anon, authenticated;
grant usage, select on sequence public.whatsapp_pairs_id_seq to service_role;

create table if not exists public.whatsapp_messages (
  id bigserial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  social_message_id integer references public.social_messages(id) on delete set null,
  direction text not null check (direction in ('in','out')),
  wamid text,
  customer_phone text not null,
  customer_name text not null default '',
  message_type text not null default 'text',
  body text not null default '',
  media_url text,
  media_mime text,
  media_name text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed','received')),
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_messages_store_created
  on public.whatsapp_messages(store_id, created_at desc);
create index if not exists idx_whatsapp_messages_wamid
  on public.whatsapp_messages(wamid) where wamid is not null;
create index if not exists idx_whatsapp_messages_social
  on public.whatsapp_messages(social_message_id) where social_message_id is not null;

alter table public.whatsapp_messages enable row level security;
revoke all on table public.whatsapp_messages from anon, authenticated;
grant select on table public.whatsapp_messages to authenticated;
grant all on table public.whatsapp_messages to service_role;
revoke all on sequence public.whatsapp_messages_id_seq from anon, authenticated;
grant usage, select on sequence public.whatsapp_messages_id_seq to service_role;

create policy "owner reads own whatsapp log" on public.whatsapp_messages for select
  using (
    store_id in (select store_id from public.profiles where user_id = auth.uid())
    or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
  );

alter table public.social_messages add column if not exists media_mime text;
alter table public.social_messages add column if not exists whatsapp_wamid text;
alter table public.social_messages add column if not exists whatsapp_status text not null default '';
create index if not exists idx_social_messages_whatsapp_wamid
  on public.social_messages(whatsapp_wamid) where whatsapp_wamid is not null and whatsapp_wamid <> '';

drop policy if exists "users read assigned products" on public.products;
create policy "users read assigned products" on public.products for select using (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
);

drop policy if exists "owner inbox access" on public.social_messages;
create policy "owner inbox access" on public.social_messages for all using (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
) with check (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
);

drop policy if exists "owner social connections access" on public.social_connections;
create policy "owner social connections access" on public.social_connections for all using (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
) with check (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
);

drop policy if exists "owner orders access" on public.orders;
create policy "owner orders access" on public.orders for all using (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
) with check (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'social_messages') then
    alter publication supabase_realtime add table public.social_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_pairs') then
    alter publication supabase_realtime add table public.whatsapp_pairs;
  end if;
end $$;

create or replace function public.whatsapp_status_summary()
returns jsonb
language sql
stable security definer set search_path = public, pg_temp
as $$
  with stats as (
    select
      count(*)::int as total_stores,
      count(*) filter (where p.status = 'paired')::int as paired_stores,
      count(*) filter (where p.status = 'pending')::int as pending_stores,
      count(*) filter (where p.status = 'relink_required')::int as relink_stores,
      count(*) filter (where p.status = 'failed')::int as failed_stores,
      count(*) filter (where m.direction = 'in' and m.created_at > now() - interval '24 hours')::int as inbound_last_24h,
      count(*) filter (where m.direction = 'out' and m.created_at > now() - interval '24 hours')::int as outbound_last_24h,
      count(*) filter (where m.status = 'failed' and m.created_at > now() - interval '24 hours')::int as failed_last_24h
    from public.stores s
    left join public.whatsapp_pairs p on p.store_id = s.id
    left join public.whatsapp_messages m on m.store_id = s.id
    where s.is_active = true
  )
  select coalesce(jsonb_build_object(
    'total_stores', total_stores,
    'paired_stores', paired_stores,
    'pending_stores', pending_stores,
    'relink_required', relink_stores,
    'failed_stores', failed_stores,
    'inbound_last_24h', inbound_last_24h,
    'outbound_last_24h', outbound_last_24h,
    'failed_last_24h', failed_last_24h
  ), '{}'::jsonb) from stats;
$$;
revoke all on function public.whatsapp_status_summary() from public, anon;
grant execute on function public.whatsapp_status_summary() to authenticated;
