-- StoYangu fresh Supabase setup
-- Run this once in Supabase Dashboard → SQL Editor → New query.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
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

create index if not exists idx_products_store on public.products(store_id);
create index if not exists idx_store_aliases_slug on public.store_aliases(slug);
create index if not exists idx_product_images_product on public.product_images(product_id,sort_order);
create index if not exists idx_events_store_created on public.store_events(store_id,created_at);
create index if not exists idx_notifications_batch on public.notifications(batch_key);
create index if not exists idx_notification_highlights_note on public.notification_highlights(notification_id);
create index if not exists idx_scheduled_due on public.scheduled_notifications(status,send_at);
create index if not exists idx_subscriptions_store on public.push_subscriptions(store_id);
create index if not exists idx_limits_lookup on public.api_rate_limits(key_hash,action,window_started_at);

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
values ('stoyangu-media','stoyangu-media',true,6291456,array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
on conflict (id) do update set public=true, file_size_limit=6291456;

-- AFTER creating your founder in Authentication → Users, replace the values below and run only this insert:
-- insert into public.profiles(user_id,email,full_name,role,store_id)
-- values ('PASTE-AUTH-USER-UUID','you@example.com','Your Name','founder',null);
