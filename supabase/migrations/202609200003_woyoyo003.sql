-- Woyoyo-003: comment source context for the inbox.
-- Safe to re-run. Additive only — no existing data is touched.
--
-- Comment threads carry the original video/post they came from so the
-- conversation header can show its source (title + link back).

alter table public.social_messages add column if not exists post_ref text not null default '';
alter table public.social_messages add column if not exists post_title text not null default '';
alter table public.social_messages add column if not exists post_url text not null default '';
alter table public.social_messages add column if not exists sender_avatar text;

create index if not exists idx_social_messages_source on public.social_messages(store_id, kind, created_at desc);
