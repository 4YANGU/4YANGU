-- StoYangu social inbox (Repliz) tables.
-- Run once in Supabase Dashboard → SQL Editor → New query.
-- Safe to run more than once. Lets each store connect TikTok, Facebook,
-- Instagram, YouTube and Threads, post once to all of them, and manage
-- every DM + comment from one inbox.

create table if not exists public.social_accounts (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  platform text not null check (platform in ('tiktok','facebook','instagram','youtube','threads')),
  handle text not null,
  display_name text not null default '',
  avatar_url text not null default '',
  repliz_account_id text not null default '',
  status text not null default 'connected',
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.social_posts (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  caption text not null,
  media_urls jsonb not null default '[]'::jsonb,
  platforms jsonb not null default '[]'::jsonb,
  repliz_post_id text not null default '',
  status text not null default 'published',
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.social_messages (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  platform text not null,
  conversation_id text not null,
  sender text not null default '',
  sender_handle text not null default '',
  body text not null,
  direction text not null default 'in',
  kind text not null default 'dm',
  post_ref text not null default '',
  repliz_id text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_social_accounts_store on public.social_accounts(store_id, platform);
create index if not exists idx_social_posts_store on public.social_posts(store_id, created_at desc);
create index if not exists idx_social_messages_store on public.social_messages(store_id, created_at desc);
create index if not exists idx_social_messages_convo on public.social_messages(store_id, conversation_id);
