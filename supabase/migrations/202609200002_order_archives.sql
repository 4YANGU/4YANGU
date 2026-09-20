-- StoYangu order archive used by the founder dashboard ON/OFF switch.
-- Run this ONLY if turning a store off fails with "Could not process that
-- store" — it means this table was never created on your project.
-- Safe to run more than once.

create table if not exists public.order_archives (
  id serial primary key,
  store_id integer not null,
  store_name text not null default '',
  orders jsonb not null default '[]'::jsonb,
  order_count integer not null default 0,
  archived_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_order_archives_store on public.order_archives(store_id, archived_at desc);
