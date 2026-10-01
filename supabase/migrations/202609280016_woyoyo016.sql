-- WOYOYO-016: one optional video per product, kept separate from the photo gallery.
create table if not exists public.product_media (
  id serial primary key,
  product_id integer not null references public.products(id) on delete cascade,
  store_id integer not null references public.stores(id) on delete cascade,
  media_type text not null,
  url text not null,
  created_at timestamptz not null default now()
);
create index if not exists product_media_product_idx on public.product_media(product_id);
alter table public.product_media enable row level security;
-- Repeatable: Postgres has no CREATE POLICY IF NOT EXISTS, so a rerun (or a database where
-- this policy was already created) failed with SQLSTATE 42710. Drop and recreate the policy
-- with the same definition so it always converges on the intended read-only scope.
drop policy if exists "read_assigned_product_media" on public.product_media;
create policy "read_assigned_product_media" on public.product_media for select using (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
);
