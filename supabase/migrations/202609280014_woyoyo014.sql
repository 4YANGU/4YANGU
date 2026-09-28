-- Apply once in Supabase SQL Editor for existing StoYangu databases.
-- Does not alter existing users, passwords, stores or orders.
alter table public.social_messages add column if not exists attachment_url text;
alter table public.social_messages add column if not exists attachment_name text;
create index if not exists idx_social_messages_store_thread on public.social_messages(store_id, thread_key, created_at desc);
