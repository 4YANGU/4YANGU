-- WOYOYO-012: additive, repeatable update. Does not change stores, accounts, or passwords.
-- Run in your existing Supabase project's SQL Editor before deploying this update.
create table if not exists public.social_oauth_states (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  token text not null,
  platform text not null,
  data jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.social_oauth_states add column if not exists status text not null default 'pending';
create index if not exists idx_social_oauth_states_token on public.social_oauth_states(token);
create index if not exists idx_social_oauth_states_expiry on public.social_oauth_states(expires_at);
alter table public.social_oauth_states enable row level security;
-- State rows contain temporary provider tokens: service-role access only.
revoke all on table public.social_oauth_states from anon, authenticated;
-- Expired approvals are safe to remove; live connection records are untouched.
delete from public.social_oauth_states where expires_at < now();

-- Ensure signed uploads work on projects where the video bucket was never created.
-- Existing buckets are preserved, including their existing limits and policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stoyangu-media','stoyangu-media',true,6291456,array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','image/bmp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stoyangu-posts','stoyangu-posts',true,78643200,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;
