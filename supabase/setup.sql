-- StoYangu fresh Supabase setup
-- Run this once in Supabase Dashboard → SQL Editor → New query.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text,
  full_name text not null,
  role text not null check (role in ('founder','owner')),
  store_id integer,
  created_at timestamptz not null default now()
);
create table if not exists public.applications (
  id serial primary key, name text not null, phone text not null,
  status text not null default 'new', created_at timestamptz not null default now()
);
create table if not exists public.stores (
  id serial primary key, name text not null, slug text not null unique,
  owner_name text not null, owner_email text not null, whatsapp text not null, phone text not null,
  logo_url text not null default '', categories jsonb not null default '[]'::jsonb,
  design_json jsonb not null default '{}'::jsonb, is_active boolean not null default true,
  billing_started_at timestamptz, billing_paid_until timestamptz,
  visitor_total bigint not null default 0, visitor_today integer not null default 0,
  orders_total bigint not null default 0, orders_today integer not null default 0,
  metrics_date text not null default to_char(now() at time zone 'Africa/Nairobi','YYYY-MM-DD'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.store_aliases (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  slug text not null unique, active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.products (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  name text not null, price numeric not null check (price > 0), category text not null,
  colors jsonb not null default '[]'::jsonb, sizes jsonb not null default '[]'::jsonb,
  image_url text not null, views_total bigint not null default 0, views_today integer not null default 0,
  orders_total bigint not null default 0, orders_today integer not null default 0,
  metrics_date text not null default to_char(now() at time zone 'Africa/Nairobi','YYYY-MM-DD'),
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.product_images (
  id serial primary key, product_id integer not null references public.products(id) on delete cascade,
  store_id integer not null references public.stores(id) on delete cascade,
  url text not null, sort_order integer not null default 0, created_at timestamptz not null default now(),
  unique(product_id, sort_order), check (sort_order between 0 and 6)
);
create table if not exists public.store_events (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  product_id integer not null default 0, event_type text not null,
  session_id text not null, created_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  batch_key text not null, store_name text not null, title text not null, body text not null,
  edited_body text not null default '', status text not null default 'draft',
  sent_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.notification_highlights (
  id serial primary key, notification_id integer not null references public.notifications(id) on delete cascade,
  store_id integer not null references public.stores(id) on delete cascade,
  batch_key text not null, winner_product_id integer references public.products(id) on delete set null,
  needs_product_id integer references public.products(id) on delete set null,
  created_at timestamptz not null default now(), unique(notification_id)
);
create table if not exists public.daily_batches (
  id serial primary key, batch_key text not null unique, status text not null default 'draft',
  combined_text text not null, confirmed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique, subscription jsonb not null, created_at timestamptz not null default now()
);
create table if not exists public.pwa_installations (
  id serial primary key, user_id uuid not null references auth.users(id) on delete cascade,
  store_id integer not null references public.stores(id) on delete cascade,
  installed boolean not null default false, notifications_enabled boolean not null default false,
  user_agent text not null default '', welcome_sent_at timestamptz, last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), unique(user_id)
);
create table if not exists public.scheduled_notifications (
  id serial primary key, batch_key text not null, send_at timestamptz not null,
  status text not null default 'scheduled', combined_text text not null,
  created_by uuid not null references auth.users(id), sent_at timestamptz,
  result jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.api_rate_limits (
  id serial primary key, key_hash text not null, action text not null,
  request_count integer not null default 1, window_started_at timestamptz not null default now()
);
create table if not exists public.orders (
  id bigserial primary key, order_key text not null, store_id bigint not null, product_id bigint not null,
  product_name text not null, product_price numeric not null default 0, customer_phone text not null,
  color text not null default '', size text not null default '', fulfilment text not null default 'Delivery',
  note text not null default '', status text not null default 'new' check (status in ('new','contacted','completed','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists orders_store_order_key_unique on public.orders(store_id, order_key);
create index if not exists orders_store_created_idx on public.orders(store_id, created_at desc);
create index if not exists orders_store_status_idx on public.orders(store_id, status);
create table if not exists public.order_archives (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  store_name text not null default '', orders jsonb not null default '[]'::jsonb,
  order_count integer not null default 0, archived_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table if not exists public.social_connections (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  platform text not null, account_handle text not null, account_id text,
  connection_status text not null default 'mock', auth_payload jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.social_posts (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  caption text not null, media_urls jsonb not null default '[]'::jsonb, platforms jsonb not null default '[]'::jsonb,
  status text not null default 'draft', results jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz, posted_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.social_messages (
  id serial primary key, store_id integer not null references public.stores(id) on delete cascade,
  platform text not null, kind text not null, thread_key text not null, sender_name text not null,
  sender_handle text, body text not null, direction text not null,
  is_read boolean not null default false, is_resolved boolean not null default false, external_id text,
  post_ref text not null default '', post_title text not null default '', post_url text not null default '', sender_avatar text,
  created_at timestamptz not null default now()
);

create index if not exists idx_products_store on public.products(store_id);
create index if not exists idx_profiles_phone on public.profiles(phone) where phone is not null;
create index if not exists idx_store_aliases_slug on public.store_aliases(slug);
create index if not exists idx_product_images_product on public.product_images(product_id,sort_order);
create index if not exists idx_events_store_created on public.store_events(store_id,created_at);
create index if not exists idx_notifications_batch on public.notifications(batch_key);
create index if not exists idx_notification_highlights_note on public.notification_highlights(notification_id);
create index if not exists idx_scheduled_due on public.scheduled_notifications(status,send_at);
create index if not exists idx_subscriptions_store on public.push_subscriptions(store_id);
create index if not exists idx_limits_lookup on public.api_rate_limits(key_hash,action,window_started_at);
create index if not exists idx_social_connections_store on public.social_connections(store_id);
create index if not exists idx_social_posts_store on public.social_posts(store_id, created_at desc);
create index if not exists idx_social_messages_store on public.social_messages(store_id, created_at desc);
create index if not exists idx_social_messages_thread on public.social_messages(store_id, thread_key, created_at);
create index if not exists idx_social_messages_source on public.social_messages(store_id, kind, created_at desc);
create index if not exists idx_order_archives_store on public.order_archives(store_id, archived_at desc);

alter table public.profiles enable row level security;
alter table public.applications enable row level security;
alter table public.stores enable row level security;
alter table public.store_aliases enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.store_events enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_highlights enable row level security;
alter table public.daily_batches enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.pwa_installations enable row level security;
alter table public.scheduled_notifications enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.orders enable row level security;
alter table public.order_archives enable row level security;
alter table public.social_connections enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_messages enable row level security;

create policy "users read own profile" on public.profiles for select using (auth.uid() = user_id);
create policy "users read assigned store" on public.stores for select using (
  id in (select store_id from public.profiles where user_id=auth.uid()) or
  exists (select 1 from public.profiles where user_id=auth.uid() and role='founder')
);
create policy "founder reads store aliases" on public.store_aliases for select using (
  exists (select 1 from public.profiles where user_id=auth.uid() and role='founder')
);
create policy "users read assigned products" on public.products for select using (
  store_id in (select store_id from public.profiles where user_id=auth.uid()) or
  exists (select 1 from public.profiles where user_id=auth.uid() and role='founder')
);
create policy "users read assigned product photos" on public.product_images for select using (
  store_id in (select store_id from public.profiles where user_id=auth.uid()) or
  exists (select 1 from public.profiles where user_id=auth.uid() and role='founder')
);
create policy "users own subscriptions" on public.push_subscriptions for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "users read store notifications" on public.notifications for select using (
  store_id in (select store_id from public.profiles where user_id=auth.uid()) or
  exists (select 1 from public.profiles where user_id=auth.uid() and role='founder')
);
create policy "users read store notification highlights" on public.notification_highlights for select using (
  store_id in (select store_id from public.profiles where user_id=auth.uid()) or
  exists (select 1 from public.profiles where user_id=auth.uid() and role='founder')
);
create policy "users read own installation" on public.pwa_installations for select using (
  auth.uid()=user_id or exists (select 1 from public.profiles where user_id=auth.uid() and role='founder')
);
create policy "founder reads schedules" on public.scheduled_notifications for select using (
  exists (select 1 from public.profiles where user_id=auth.uid() and role='founder')
);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('stoyangu-media','stoyangu-media',true,6291456,array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','image/bmp'])
on conflict (id) do update set public=true, file_size_limit=6291456;

-- AFTER creating your founder in Authentication → Users, replace the values below and run only this insert:
-- insert into public.profiles(user_id,email,full_name,role,store_id)
-- values ('PASTE-AUTH-USER-UUID','you@example.com','Your Name','founder',null);


-- M-Pesa upkeep tables and callback processor (also in supabase/migrations/202610010001_mpesa_upkeep.sql).
-- StoYangu Daraja STK Push payments for KES 200 / 14-day upkeep.
-- Run once in Supabase Dashboard → SQL Editor → New query. Safe to re-run.
-- Payment records are private; all writes and callback processing use the
-- server-side Supabase service role. Sandbox successes are test-only and never
-- change billing. A validated production callback updates billing in the same
-- database transaction, so duplicate callbacks cannot double-credit.

create table if not exists public.mpesa_payments (
  id bigserial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  phone text not null check (phone ~ '^254[17][0-9]{8}$'),
  amount integer not null default 200 check (amount = 200),
  account_reference text not null unique,
  merchant_request_id text,
  checkout_request_id text unique,
  billing_period integer not null default 0 check (billing_period >= 0),
  grant_until timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'sandbox_paid', 'failed', 'expired', 'review')),
  result_code integer,
  result_description text not null default '',
  receipt_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_mpesa_payments_store_created
  on public.mpesa_payments(store_id, created_at desc);
create unique index if not exists idx_mpesa_payments_one_pending_per_store
  on public.mpesa_payments(store_id) where status = 'pending';
create unique index if not exists idx_mpesa_payments_receipt_unique
  on public.mpesa_payments(receipt_number)
  where receipt_number is not null and receipt_number <> '';

alter table public.mpesa_payments enable row level security;
revoke all on table public.mpesa_payments from anon, authenticated;
grant all on table public.mpesa_payments to service_role;
revoke all on sequence public.mpesa_payments_id_seq from anon, authenticated;
grant usage, select on sequence public.mpesa_payments_id_seq to service_role;

create or replace function public.stoyangu_mpesa_process_callback(
  p_checkout_request_id text,
  p_merchant_request_id text,
  p_result_code integer,
  p_result_description text,
  p_amount bigint,
  p_phone text,
  p_receipt_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_row public.mpesa_payments%rowtype;
  callback_description text := left(coalesce(p_result_description, ''), 300);
  callback_receipt text := nullif(trim(coalesce(p_receipt_number, '')), '');
begin
  select *
    into payment_row
    from public.mpesa_payments
   where checkout_request_id = nullif(trim(coalesce(p_checkout_request_id, '')), '')
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_found', 'duplicate', false);
  end if;

  if payment_row.status = 'paid' then
    return jsonb_build_object('ok', true, 'status', 'paid', 'duplicate', true);
  end if;

  if payment_row.status not in ('pending', 'expired') then
    return jsonb_build_object('ok', true, 'status', payment_row.status, 'duplicate', true);
  end if;

  if payment_row.merchant_request_id is distinct from nullif(trim(coalesce(p_merchant_request_id, '')), '') then
    update public.mpesa_payments
       set status = 'review',
           result_code = p_result_code,
           result_description = 'The callback request identifiers did not match.',
           updated_at = now(),
           completed_at = now()
     where id = payment_row.id;
    return jsonb_build_object('ok', false, 'status', 'review', 'duplicate', false);
  end if;

  if p_result_code is distinct from 0 then
    update public.mpesa_payments
       set status = 'failed',
           result_code = p_result_code,
           result_description = callback_description,
           updated_at = now(),
           completed_at = now()
     where id = payment_row.id;
    return jsonb_build_object('ok', true, 'status', 'failed', 'duplicate', false);
  end if;

  if p_amount is distinct from payment_row.amount::bigint
     or p_phone is distinct from payment_row.phone
     or callback_receipt is null then
    update public.mpesa_payments
       set status = 'review',
           result_code = p_result_code,
           result_description = 'The callback amount, phone number or receipt did not match.',
           updated_at = now(),
           completed_at = now()
     where id = payment_row.id;
    return jsonb_build_object('ok', false, 'status', 'review', 'duplicate', false);
  end if;

  if payment_row.environment = 'sandbox' then
    update public.mpesa_payments
       set status = 'sandbox_paid',
           result_code = p_result_code,
           result_description = callback_description,
           receipt_number = callback_receipt,
           updated_at = now(),
           completed_at = now()
     where id = payment_row.id;
    return jsonb_build_object('ok', true, 'status', 'sandbox_paid', 'duplicate', false);
  end if;

  update public.mpesa_payments
     set status = 'paid',
         result_code = p_result_code,
         result_description = callback_description,
         receipt_number = callback_receipt,
         updated_at = now(),
         completed_at = now()
   where id = payment_row.id;

  update public.stores
     set billing_paid_until = case
           when billing_paid_until is null or billing_paid_until < payment_row.grant_until
             then payment_row.grant_until
           else billing_paid_until + interval '14 days'
         end,
         updated_at = now()
   where id = payment_row.store_id;

  return jsonb_build_object('ok', true, 'status', 'paid', 'duplicate', false);
end;
$$;

revoke all on function public.stoyangu_mpesa_process_callback(text, text, integer, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.stoyangu_mpesa_process_callback(text, text, integer, text, bigint, text, text)
  to service_role;
