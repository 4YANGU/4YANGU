-- StoYangu update 001
-- Adds WhatsApp-number owner profiles and AVIF/BMP uploads.
-- No Supabase Phone provider or paid SMS provider is required.
-- The app maps each WhatsApp number to a private internal email identifier
-- while owners continue to type only WhatsApp number and password.
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
-- That action safely updates the existing Auth user to the internal login identifier.
