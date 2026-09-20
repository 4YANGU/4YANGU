# Repliz social layer — setup guide (StoYangu woyoyo-003 build)

This build runs the social layer on the **public Repliz API**: connect TikTok,
Facebook, Instagram, YouTube and Threads inside the app, post once to all of them
automatically, and manage every DM and comment from the **Inbox** tab.

## 1. What runs where

| Piece | Location | Notes |
|---|---|---|
| Repliz adapter (all platform HTTP) | `lib/repliz.js` | Real API + mock fallback. **Only file you touch for API changes.** |
| Social API (stays inside the 12-function limit) | `api/media.js` → `?action=social` | No new file in `api/` — Hobby plan safe. |
| Inbox UI (DMs + comments + accounts pop-up) | `src/components/SocialInbox.tsx` | Messages-only; DMs / Comments tabs. |
| Platform logo labels | `src/components/PlatformLogo.tsx` | Inline SVG badges per message. |
| Post-once-to-all composer | `src/components/PostComposer.tsx` | Auto-posts everywhere; product attach-or-add. |
| Shared product form | `src/components/ProductModal.tsx` | Used by the shelf (edit) and the composer (add). |
| Bottom nav + inbox styles | `src/manage-redesign.css` | Brand colors only |
| Tables | `social_connections`, `social_posts`, `social_messages` | Migrations: `..._social_repliz.sql` + `..._woyoyo003.sql` |

## 2. Keys (your Vercel)

In Vercel → Project → Settings → Environment Variables:

- `REPLIZ_ACCESS_KEY` = your Repliz access key (**required for live mode**).
- `REPLIZ_SECRET_KEY` = your Repliz secret key (**required for live mode**).
- Aliases `REPLIZ_API_KEY` / `REPLIZ_API_SECRET` also work.
- `REPLIZ_API_BASE_URL` = Repliz API base URL (**only if** it differs from the
  default `https://api.repliz.com`).

With no (or dummy) keys, everything runs in **mock mode**: connecting accounts,
publishing, replies, resolve/read and the unread badge all work against local
demo data so the whole flow can be tested end to end. Inbox → **Load sample
messages** seeds realistic threads for any store.

## 3. Connecting accounts (the inbox Accounts pop-up)

Tapping **Connect** on a platform binds the store to the **real Repliz-side
account** over the public API (Basic `access:secret` auth against
`GET /v1/accounts`): the handle and account id are pulled from Repliz — the
owner never types a username. If that platform is not connected in the Repliz
workspace yet, the app says so and links to Repliz; the owner connects it there
(Repliz owns the platform OAuth), comes back, and taps **Refresh from Repliz**.

## 4. Posting (always everywhere)

The composer posts to **every connected platform automatically** — it never asks
which ones. Drafts still save from the composer. Live delivery is per-account:
the result screen shows success/failure for each platform, and replies are always
**saved locally first**, so a Repliz hiccup never loses the owner's text.

## 5. Going live checklist (your Vercel + Supabase)

1. Add the two Repliz keys above and redeploy once.
2. Run `supabase/migrations/202609200003_woyoyo003.sql` once in SQL Editor
   (safe to re-run; adds the comment-source columns).
3. Open a store → Inbox → Accounts → Connect each of the 5 platforms.
4. If Repliz ever renames an endpoint, only `lib/repliz.js` changes — every live
   HTTP call is marked `ADAPTER-VERIFY` in that one file.

## 6. Function-count safety

`api/` still contains exactly **12 files** — the social endpoints live inside
the existing `api/media.js` (`?action=social`), and Repliz logic lives in
`lib/` (not counted as functions). The Hobby-plan cleanup workflow is
unaffected.
