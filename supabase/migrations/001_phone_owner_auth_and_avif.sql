-- StoYangu update 001
-- Adds WhatsApp-number owner profiles and AVIF/BMP uploads.
-- Safe to run more than once in Supabase SQL Editor.

alter table public.profiles add column if not exists phone text;
alter table public.profiles alter column email drop not null;

update public.profiles as profile
set phone = store.whatsapp
from public.stores as store
where profile.store_id = store.id
  and profile.role = 'owner'
  and profile.phone is null;

create index if not exists idx_profiles_phone on public.profiles(phone) where phone is not null;

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/bmp'
]
where id = 'stoyangu-media';

-- IMPORTANT FOR EXISTING OWNER ACCOUNTS:
-- After this migration, open Founder Dashboard, edit each existing store,
-- confirm the owner's WhatsApp number and set a temporary password once.
-- That action safely adds the phone login to the existing Supabase Auth user.
