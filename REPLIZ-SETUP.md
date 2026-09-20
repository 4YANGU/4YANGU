# Repliz social layer — setup guide (StoYangu test build)

This build adds the social layer to StoYangu: connect TikTok, Facebook,
Instagram, YouTube and Threads inside the app, post once to all of them, and
manage every DM and comment from the new **Inbox** tab — all powered by the
**Repliz** developer API.

## 1. What runs where

| Piece | Location | Notes |
|---|---|---|
| Repliz adapter (all platform HTTP) | `lib/repliz.js` | Mock + live modes. **Only file you touch for real keys.** |
| Social API (stays inside the 12-function limit) | `api/media.js` → `?action=social` | No new file in `api/` — Hobby plan safe. |
| Inbox UI (DMs + comments + accounts + post history) | `src/components/SocialInbox.tsx` | |
| Post-once-to-all composer | `src/components/PostComposer.tsx` | Opened by the `+` button |
| Bottom nav + inbox styles | `src/manage-redesign.css` | Brand colors only |
| Tables | `social_connections`, `social_posts`, `social_messages` | Migration: `supabase/migrations/202609200001_social_repliz.sql` |

## 2. Demo mode (this build — no keys needed)

- With no `REPLIZ_API_KEY` set, everything runs in **mock mode**:
  connecting accounts, publishing, replies, resolve/read and the unread badge.
- Inbox → **Load demo messages** seeds realistic threads for any store.
- The Inbox header shows **Demo mode**; the composer result screen says
  **Posted (demo mode)** so testers never mistake it for a real post.

## 3. Going live with real Repliz keys (your Vercel)

1. In Vercel → Project → Settings → Environment Variables, add:
   - `REPLIZ_API_KEY` = your Repliz API key (**required** — its presence
     switches `lib/repliz.js` from `mock` to `live`).
   - `REPLIZ_API_BASE_URL` = Repliz API base URL (**only if** it differs from
     the default `https://api.repliz.com`).
2. Redeploy once.
3. The Inbox header flips to **Live**.

> The Repliz API reference PDF was not attached to this build, so the live
> HTTP calls are best-guess adapter stubs. Before relying on live mode,
> verify each **ADAPTER** marker in `lib/repliz.js` against the PDF:

| Adapter function | Verify in the PDF |
|---|---|
| `replizRequest()` | Base URL, auth scheme (Bearer header vs key param), error payload shape |
| `replizPublish()` | Publish path + method, text/media/account field names per platform |
| `replizSendReply()` | Reply path (DM vs comment reply may differ per platform) |
| `replizFetchInbox()` | Inbox sync path + polling/webhook model (reserved for the cron sync step) |

Live replies/publishes always **save locally first**, so a Repliz hiccup never
loses the owner's text — the UI reports per-platform success/failure.

## 4. Database (your Supabase)

Run `supabase/migrations/202609200001_social_repliz.sql` once in SQL Editor.
It also creates `order_archives` (used by the founder power toggle) if your
project predates it. Tables are RLS-locked with no public policies; all access
goes through the service-role API routes.

## 5. Function-count safety

`api/` still contains exactly **12 files** — the social endpoints live inside
the existing `api/media.js` (`?action=social`), and Repliz logic lives in
`lib/` (not counted as functions). The Hobby-plan cleanup workflow is
unaffected.
