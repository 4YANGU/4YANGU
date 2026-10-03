# StoYangu Part B — WhatsApp Business integration

WhatsApp pairing, inbox messaging and founder-status monitoring. **The `api/`
folder stays at exactly 12 files** so Vercel Hobby continues to deploy.

## Security notes (read first)

- `WHATSAPP_APP_SECRET` is **required** for the webhook. Any `POST` to
  `/api/cron?job=whatsapp-webhook` that is missing or has an invalid
  `X-Hub-Signature-256` header is rejected with HTTP 401 before any payload
  is parsed. Inbound messages are deduped by WhatsApp message ID (`wamid`) in
  BOTH `social_messages` and `whatsapp_messages` so Meta retries never create
  duplicates. The webhook returns HTTP 200 immediately so retries stay short.
- `/api/cron` routes still enforce `CRON_SECRET` for `daily`, `send`, `inbox`
  jobs. The only two public jobs are `repliz-webhook` (verifies
  `REPLIZ_WEBHOOK_SECRET` with constant-time compare) and `whatsapp-webhook`
  (verifies `X-Hub-Signature-256` against `WHATSAPP_APP_SECRET`).
- Owner-only RLS on `social_messages`, `social_connections`, `orders` and
  `whatsapp_pairs`/`whatsapp_messages` — an owner can only see/touch their own
  store's rows; founders see all.
- The 24-hour WhatsApp customer care window is enforced client-side and
  server-side: if a customer hasn't messaged in over 24 hours the reply is
  saved to the outbox but not sent, and the inbox shows a clear message
  ("customer care window closed — open WhatsApp directly to restart") rather
  than "delivery failed".

## Install

1. Upload / merge these files into your repository root (same level as
   `package.json`), overwriting matches. No new files are added inside `api/`.
2. Run `supabase/migrations/202610030001_whatsapp_partb.sql` in Supabase SQL
   Editor. Additive, safe to re-run.
3. Add these Vercel environment variables:
   - `WHATSAPP_ACCESS_TOKEN` — Cloud API permanent or short-lived token
   - `WHATSAPP_APP_SECRET` — Meta App secret (**required**, used for HMAC
     verification of `X-Hub-Signature-256`)
   - `WHATSAPP_PHONE_NUMBER_ID` — default phone-number id from your WhatsApp
     Business Account
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — a ≥8-char random string you pick
4. In Meta → WhatsApp → Configuration → Webhook, set the callback URL to
   `https://<your-domain>/api/cron?job=whatsapp-webhook` and subscribe to the
   `messages` field. Use the same verify token you set above.
5. Redeploy. Without these env vars the app falls back to **mock mode** so you
   can test pairing, inbox, and replies end-to-end without sending real
   messages.

## What changed

| File | Why |
|---|---|
| `supabase/migrations/202610030001_whatsapp_partb.sql` | `whatsapp_pairs` + `whatsapp_messages` tables; tightens owner-only RLS; `whatsapp_status_summary()` founder SQL view; Realtime publication. |
| `lib/whatsapp.js` | New adapter — pairing codes, Cloud API v21.0 send, inbound ingestion, delivery receipts, 24-hour window enforcement, dedupe-by-wamid, relink alerts, signature verification, mock mode. |
| `server/media.js` | `?action=whatsapp` (status/pair/send/disconnect), WhatsApp thread replies routed through the Cloud API, WhatsApp threads in unified inbox + status response. |
| `server/cron.js` | `?job=whatsapp-webhook` mounted alongside the existing `repliz-webhook`; other cron jobs keep `CRON_SECRET`. Webhook responds 200 immediately, processes + pushes in the background. |
| `server/dashboard.js` | Returns a WhatsApp summary for founders and a `whatsapp_pair` per store. |
| `api/cron.js` | Raw-body buffering for webhook signature verification; `X-Hub-Signature-256` allowed header. |
| `api/media.js` | Adds `X-Hub-Signature-256` to CORS headers (public webhook callback routes via cron, not media). |
| `src/types.ts` | `WhatsAppPair`, `WhatsAppPairStatus`, `WhatsAppStatusSummary` types; `whatsapp_wamid`/`whatsapp_status`/`media_mime` on `SocialMessage`. |
| `src/components/WhatsAppPairing.tsx` | New pairing screen with consent, 6-digit code, copy, deep link, disconnect, relink warnings. |
| `src/components/SocialInbox.tsx` | Delivery receipts (sending/sent/delivered/read/failed/window-closed) on WhatsApp bubbles; clear 24-hour-window error; in-app WhatsApp replies. |
| `src/pages/StoreDashboard.tsx` | Mounts the WhatsApp pairing card under Connected Accounts. |
| `src/pages/FounderDashboard.tsx` | WhatsApp status card: counts, 24-hour metrics, per-store relink list. |
| `src/manage-redesign.css` | Styles for the pairing panel and founder status card. |
| `src/lib/socialPlatforms.ts` | Social platform constant list (unchanged; included to keep imports consistent). |

## How the 6-digit pairing code routes an incoming message

When the owner taps "Start WhatsApp pairing" the server generates a random
6-digit code, stores it in `whatsapp_pairs` (store_id ↔ pairing_code ↔ status
=pending), and shows it to the owner. The owner enters it in WhatsApp Business
→ Linked devices → Link a device, or taps the deep-link button. Once Meta
completes the embedded-signing flow and sends a webhook for that phone
number:

1. The webhook hits `/api/cron?job=whatsapp-webhook`, the `X-Hub-Signature-256`
   header is verified against `WHATSAPP_APP_SECRET`, and Meta's
   `hub.challenge` subscribe flow returns 200 with the challenge if the
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches.
2. The payload includes `metadata.phone_number_id`. The adapter looks up the
   store by `whatsapp_pairs.phone_number_id` first, then by
   `whatsapp_pairs.display_phone`, then by `stores.whatsapp` as a fallback.
   The pairing flow records `phone_number_id` on the `whatsapp_pairs` row and
   flips its status to `paired` when the first inbound event arrives for that
   number (in production the Cloud API embed calls a register-number endpoint
   on the store's pair row when the code is approved — in mock mode the
   webhook handler pairs the first number that writes against the store).
3. Every subsequent inbound event from that `phone_number_id` is deterministically
   routed to the same store by step 2, and `thread_key = whatsapp:<E.164>` keeps
   each customer's messages in the correct conversation.

The 6-digit code therefore authenticates the linking ceremony itself (the owner
types it on their own device proving ownership of the WhatsApp number); after
linking, routing is by Meta's verified `phone_number_id`, which can't be
spoofed because the webhook signature has already been verified.

## File count

`api/` after install: **12 files** (unchanged)
```
applications.js   cron.js          media.js       orders.js
products.js       seo.js           storefront.js  stores.js
subscriptions.js  track.js         dashboard.js   notifications.js
```
