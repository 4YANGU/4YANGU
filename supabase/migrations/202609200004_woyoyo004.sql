-- Woyoyo-004: OAuth state table for official platform connections.
-- Safe to re-run. Additive only — no existing data is touched.
--
-- When an owner taps Connect, the server stores a short-lived state token
-- here (store + platform), then opens the platform's official authorization
-- page. The platform sends the owner back to
-- /api/media?action=social-callback&state=...&code=..., which verifies the
-- token before binding the account. Tokens expire after 30 minutes.

create table if not exists public.social_oauth_states (
  id serial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  token text not null,
  platform text not null,
  data jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_social_oauth_states_token on public.social_oauth_states(token);

alter table public.social_oauth_states enable row level security;
-- No public policies on purpose: this table is accessed only through the
-- service-role API routes. The service role bypasses RLS, so the app keeps
-- working while direct access stays locked.
