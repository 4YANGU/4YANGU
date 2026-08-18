# StoYangu — Vmedone Pack (the final, deploy-ready fix)

This pack restores your repo's **original file arrangement** (the one that has
always deployed fine on the Vercel Hobby plan) and keeps the **install fix**.

## ⚠️ WHY THE PREVIOUS PACKS FAILED ON YOUR VERCEL

Vercel turns **every file inside `api/` into one Serverless Function**, and a
zip can only ADD or OVERWRITE files — it can never delete files from your
repo. After applying the previous pack, your repo's `api/` folder contained
**16 files**:

    applications.js  cron.js        notifications.js  track.js      ← originals (still there)
    batch.js         engage.js      db-client.js      db-wake.js    ← added by the old pack
    dashboard.js     media.js       orders.js         products.js
    seo.js           storefront.js  stores.js         subscriptions.js

16 functions > the Hobby limit of 12 → the deploy was refused.

## ✅ BEFORE YOU EXTRACT THIS PACK — DO THIS ONE CLEANUP STEP

Delete these 4 files from your repo (they must not exist):

    api/engage.js
    api/batch.js
    api/db-client.js
    api/db-wake.js

The simplest, safest way: **delete your entire `api/` folder**, then copy the
`api/` folder from this pack in its place. Afterwards your `api/` folder must
contain **exactly these 12 files** — the exact arrangement your repo has
always deployed with:

    applications.js   cron.js         media.js        orders.js
    products.js       seo.js          storefront.js   stores.js
    subscriptions.js  track.js        dashboard.js    notifications.js

You may also delete the now-outdated `VFIXED-README.md` from your repo root.

## WHAT THIS PACK CHANGES vs YOUR CURRENT REPO

- `api/` — back to the original 12 files, byte-for-byte. No merges, no
  aliases. Exactly 12 Serverless Functions = deploys on the Hobby plan.
- `vercel.json` — back to the original routes/headers/schedules only, with
  **no env block** (as SETUP-GUIDE.md documents, environment values belong in
  the Vercel dashboard, never in this file).
- The **install fix** stays in place:
  - `public/favicon-192.png` + `public/icon-maskable-512.png` restored — the
    missing icons were why phones only made a home-screen shortcut instead of
    installing StoYangu as a real app in the app list.
  - `public/sw.js` cache bumped (`stoyangu-app-vfixed-1`) so phones drop old
    caches.
  - `src/main.tsx` + `src/pages/StoreDashboard.tsx` remember the installation
    (standalone detection + local record + server record), so refreshing
    "manage my store" never shows the Install button again after a real
    install.

## ENVIRONMENT VARIABLES (Vercel dashboard → Project Settings)

Because `vercel.json` carries no env values, make sure these are set in your
Vercel project (they already are if your site was working before):

    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY
    VITE_SUPABASE_URL
    VITE_SUPABASE_ANON_KEY

Optional, only for push notifications (see SETUP-GUIDE.md):
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.

## DEMO LOGINS

- **Founder:** tap **"Open founder demo"** on the login page — no password.
- **Store owner** (to test the install flow): WhatsApp `0793 825 499`,
  password `BestonDemo123!` (Beston Kicks).

## CHECKLIST BEFORE YOU DEPLOY

1. [ ] Deleted `api/engage.js`, `api/batch.js`, `api/db-client.js`,
      `api/db-wake.js` (or replaced the whole `api/` folder).
2. [ ] `api/` contains exactly 12 `.js` files.
3. [ ] Extracted this pack over the repo (all other files simply overwrite).
4. [ ] Supabase env vars present in the Vercel dashboard.
5. [ ] Deploy — it will pass the Hobby-plan limit.
