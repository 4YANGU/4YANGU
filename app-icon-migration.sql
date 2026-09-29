-- Adds an optional, separate "app icon" photo per store. When set, the APK
-- builder (server/store-apk.js) uses this instead of the regular store
-- logo for the app icon and opening splash. Leave it empty and the app
-- keeps using the regular logo, so nothing breaks for existing stores.
alter table stores add column if not exists app_icon_url text;
