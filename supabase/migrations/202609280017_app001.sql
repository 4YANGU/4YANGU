-- APP-001: status and download URL for each store's signed Android build.
-- Apply once in your existing Supabase project before tapping Build app.
create table if not exists public.store_apks (
  store_id integer primary key references public.stores(id) on delete cascade,
  status text not null default 'not_started',
  apk_url text,
  error text,
  version_code integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.store_apks enable row level security;
drop policy if exists read_own_store_apk on public.store_apks;
create policy read_own_store_apk on public.store_apks for select using (
  store_id in (select store_id from public.profiles where user_id = auth.uid())
  or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'founder')
);
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('store-apks','store-apks',true,52428800,array['application/vnd.android.package-archive','application/octet-stream'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;
