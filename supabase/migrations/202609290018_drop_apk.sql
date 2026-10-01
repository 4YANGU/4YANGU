-- APP-001 removal: the signed-APK build pipeline is retired. Store owners
-- now install the hosted site as a web app (PWA) from Chrome, with the
-- store's logo as the app icon — no Android builds, no APK downloads.
--
-- Run this in Supabase SQL Editor (safe even if the old table was never
-- created). It removes the store_apks policy and table.
drop policy if exists read_own_store_apk on public.store_apks;
drop table if exists public.store_apks;
