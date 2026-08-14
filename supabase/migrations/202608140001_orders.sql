-- StoYangu confirmed orders used by FREE/PRO upkeep and owner order management.
create table if not exists public.orders (
  id bigserial primary key,
  order_key text not null,
  store_id bigint not null,
  product_id bigint not null,
  product_name text not null,
  product_price numeric not null default 0,
  customer_phone text not null,
  color text not null default '',
  size text not null default '',
  fulfilment text not null default 'Delivery',
  note text not null default '',
  status text not null default 'new' check (status in ('new','contacted','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists orders_store_order_key_unique on public.orders(store_id, order_key);
create index if not exists orders_store_created_idx on public.orders(store_id, created_at desc);
create index if not exists orders_store_status_idx on public.orders(store_id, status);
