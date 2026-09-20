# woyoyo-003 — StoYangu update pack (auto-post everywhere + messages-only inbox)

This pack is a drop-in update for the `4YANGU/4YANGU` repo. It keeps every existing
feature and applies the founder's change list on top of woyoyo-001:

1. **Posting always goes to ALL connected platforms.** The composer no longer asks
   which platforms to use — it shows the connected accounts and posts to every
   one of them automatically (`PostComposer.tsx` + `publish` in `api/media.js`).
2. **Inbox is messages-only.** The Messages/Posts view switch is gone; the inbox
   shows conversations only. Drafts still save from the composer.
3. **DMs / Comments tabs.** The platform filter row (TikTok, Instagram, Facebook…)
   is removed. The inbox now has two tabs — DMs and Comments — and every message
   bubble carries a small platform logo label showing where it came from.
4. **Comment source context.** Opening a comment conversation shows which video or
   post the comment came from (title + view link). New `post_*` columns on
   `social_messages` (migration `202609200003_woyoyo003.sql`).
5. **Accounts pop-up.** A single Accounts button on the inbox opens a pop-up with
   the 5 platforms. Connecting binds the store to the REAL Repliz-side account
   using the public Repliz API (`REPLIZ_ACCESS_KEY` + `REPLIZ_SECRET_KEY` from
   Vercel) — no more typed usernames. A Refresh button re-syncs from Repliz.
6. **No demo-mode wording.** All “demo mode / powered by” labels are removed
   from the inbox and composer.
7. **Home + Products merged.** Manage My Store has one clean Home page (analytics,
   updates, orders, products) — the Home/Products tabs are gone.
8. **Products are added while posting.** The Add-product buttons are removed from
   the products shelf. The composer lets the owner attach an existing product or
   add one on the spot (same full product form); it auto-attaches to the post.
9. **Personalized Manage header.** The StoYangu logo on Manage My Store is replaced
   with the store's own logo (falls back to the brand logo when a store has none).
10. **One-tap demo logins stay.** `/login` keeps the no-password demo founder and
    demo store-owner buttons (staging/preview hosts only).

## Vercel Hobby plan — still exactly 12 functions

No new file was added to `api/`. The social endpoints live inside the existing
`api/media.js` as `?action=social&op=...` (status, inbox, posts, connect,
disconnect, sync_accounts, publish, save_draft, reply, read, resolve, seed_demo).
`api/` must contain exactly:

```
applications.js   cron.js          media.js       orders.js
products.js       seo.js           storefront.js  stores.js
subscriptions.js  track.js         dashboard.js   notifications.js
```

## How to apply (founder repo)

1. Back up, then overwrite your repo with this zip (it never deletes files).
2. Confirm `api/` still has exactly the 12 files above (delete any stray
   `api/batch.js`, `api/engage.js`, `api/db-client.js`, `api/db-wake.js`).
3. In Supabase SQL Editor run once (safe to re-run):
   - `supabase/migrations/202609200001_social_repliz.sql` (if not run before)
   - `supabase/migrations/202609200003_woyoyo003.sql` (REQUIRED — new inbox columns)
4. In Vercel → Project Settings → Environment Variables, confirm the Repliz keys:
   - `REPLIZ_ACCESS_KEY` and `REPLIZ_SECRET_KEY` (real keys — never commit them).
   - Aliases `REPLIZ_API_KEY` / `REPLIZ_API_SECRET` also work.
   - Optional: `REPLIZ_API_BASE_URL` (only if Repliz gives you another host).
   - Missing/dummy keys ⇒ the app safely serves local demo data instead.
5. Redeploy. Done.

## Files changed / added

- Added: `src/components/PlatformLogo.tsx`, `src/components/ProductModal.tsx`,
  `supabase/migrations/202609200003_woyoyo003.sql`, `WOYOYO-003-README.md`
- Edited: `src/components/SocialInbox.tsx`, `src/components/PostComposer.tsx`,
  `src/pages/StoreDashboard.tsx`, `src/types.ts`, `src/manage-redesign.css`,
  `src/order-update.css`, `lib/repliz.js`, `api/media.js`, `REPLIZ-SETUP.md`,
  `index.html` (removed accidentally-committed tracker scripts)
