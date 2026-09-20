-- StoYangu social (Repliz) + order archives migration
-- Run once in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Adds:
--   public.order_archives    (used by the founder power toggle in api/stores.js)
--   public.social_connections (TikTok/Facebook/Instagram/YouTube/Threads per store)
--   public.social_posts       (post-once-to-all history + drafts)
--   public.social_messages    (unified DMs + comments inbox)

create table if not exists public.order_archives (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  store_name text not null,
  orders jsonb not null default '[]'::jsonb,
  order_count integer not null default 0,
  archived_at timestamptz not null default now()
);

create table if not exists public.social_connections (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  platform text not null,
  account_handle text not null,
  account_id text,
  connection_status text not null default 'mock',
  auth_payload jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_social_connections_store on public.social_connections(store_id);

create table if not exists public.social_posts (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  caption text not null,
  media_urls jsonb not null default '[]'::jsonb,
  platforms jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  results jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_social_posts_store on public.social_posts(store_id, created_at desc);

create table if not exists public.social_messages (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  platform text not null,
  kind text not null,
  thread_key text not null,
  sender_name text not null,
  sender_handle text,
  body text not null,
  direction text not null,
  is_read boolean not null default false,
  is_resolved boolean not null default false,
  external_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_social_messages_store on public.social_messages(store_id, created_at desc);
create index if not exists idx_social_messages_thread on public.social_messages(store_id, thread_key, created_at);

alter table public.order_archives enable row level security;
alter table public.social_connections enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_messages enable row level security;
-- No public policies on purpose: these tables are accessed only through the
-- service-role API routes (/api/media?action=social). The service role
-- bypasses RLS, so the app keeps working while direct access stays locked.
