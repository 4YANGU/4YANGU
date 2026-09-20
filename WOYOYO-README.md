# woyoyo-001 — StoYangu update pack (TikTok-style manage-my-store + Repliz social)

This pack is a drop-in update for the `4YANGU/4YANGU` repo. It keeps every existing
feature byte-for-byte and adds:

1. **TikTok-style “Manage my store” redesign** (StoYangu colours: navy `#101f30`,
   green `#5a966e`, gold `#dca050`, cream `#e6dcc8`)
   - Bottom nav bar: **Home** (left) · big **+** post button (centre) · **Inbox** (right).
   - **Home** keeps ALL current features: analytics, latest update, incoming
     orders and the full products section.
   - **Inbox** = the new Repliz-powered DM + comment manager.
   - **+** = post-once-to-all composer (TikTok, Facebook, Instagram, YouTube, Threads).
2. **Repliz integration** (`lib/repliz.js` + social actions inside `api/media.js`)
   - Connect / disconnect the 5 platforms per store.
   - Post once → delivered to every chosen platform.
   - Unified inbox for DMs and comments, with replies routed back correctly.
   - **Mock mode is automatic:** dummy keys ⇒ realistic demo data from Supabase.
     Real keys ⇒ live Repliz API. Zero code changes between environments.
3. **One-tap demo logins** on `/login` (no password):
   - **Demo founder login** → `founder-demo@stoyangu.com`
   - **Demo store owner login** → Beston Kicks (`0793 825 499` account)
4. **Founder “Update pack (.zip)” button** in the dashboard header for quick downloads.

## Vercel Hobby plan — still exactly 12 functions

No new file was added to `api/`. The social endpoints live inside the existing
`api/media.js` as `?action=social&op=...` (status, inbox, history, connect,
disconnect, post, reply, read). `api/` must contain exactly:

```
applications.js   cron.js          media.js       orders.js
products.js       seo.js           storefront.js  stores.js
subscriptions.js  track.js         dashboard.js   notifications.js
```

## How to apply (founder repo)

1. Back up, then overwrite your repo with this zip (it never deletes files).
2. Confirm `api/` still has exactly the 12 files above (delete any stray
   `api/batch.js`, `api/engage.js`, `api/db-client.js`, `api/db-wake.js`).
3. In Supabase SQL Editor run (once each, safe to re-run):
   - `supabase/migrations/202609200001_social.sql` (REQUIRED — new inbox tables)
   - `supabase/migrations/202609200002_order_archives.sql` (only if the ON/OFF
     switch ever failed — otherwise skip)
4. In Vercel → Project Settings → Environment Variables, confirm the Repliz keys:
   - `REPLIZ_ACCESS_KEY` and `REPLIZ_SECRET_KEY` (real keys — never commit them).
   - Aliases `REPLIZ_API_KEY` / `REPLIZ_API_SECRET` also work.
   - Anything dummy/missing ⇒ the app safely serves demo inbox data instead.
5. Redeploy. Done — no frontend or database changes needed beyond step 3.

## Files changed / added

- Added: `lib/repliz.js`, `src/components/SocialInbox.tsx`,
  `src/components/PostComposer.tsx`, `src/social-tiktok.css`,
  `supabase/migrations/202609200001_social.sql`,
  `supabase/migrations/202609200002_order_archives.sql`, `WOYOYO-README.md`
- Edited: `src/pages/StoreDashboard.tsx` (bottom nav + tabs), `src/pages/LoginPage.tsx`
  (demo labels), `src/pages/FounderDashboard.tsx` (zip button), `src/lib/api.ts`
  (`social` upload scope), `api/media.js` (social actions + `social` scope),
  `supabase/setup.sql` (social + archive DDL for fresh installs), `index.html`
  (removed two accidentally-committed Design Arena tracker scripts).
