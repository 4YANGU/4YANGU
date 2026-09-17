# StoYangu — Vwueh Pack

Fixes the **"Custom app notification"** failure on the founder dashboard,
on top of everything the previous packs delivered.

## The problem that was fixed

On the founder dashboard → Notification centre → "Send a separate message",
sending a notification to all installed owners or chosen accounts always
failed with **"Something went wrong. Please try again."**

### Root cause

The dashboard was calling an endpoint that **does not exist**:
`POST /api/custom-notifications`. There was never a file for it in the
`api/` folder, so every send hit a 404 and the app showed the generic error.

### The fix (Hobby-plan safe — NO new Serverless Function)

- `api/notifications.js` now contains the custom-broadcast logic
  (`POST /api/notifications` with `{ action: "custom", title, body, store_ids }`).
- `src/pages/FounderDashboard.tsx` now calls that existing endpoint.
- What a send does now:
  1. Every recipient store gets a **"Message from StoYangu" card** on its
     manage-my-store page (works even when push is not allowed yet).
  2. Every device subscribed through the installed app gets a **push ping**
     (requires the one-time VAPID keys from SETUP-GUIDE; without them the
     dashboard cards still deliver, and the sender tells you so).
  3. "All installed owners" = every active store; "Choose accounts" = only
     the checked stores.
- The api/ folder still contains exactly **12 functions** — the Vercel
  Hobby limit is respected.

## STILL IMPORTANT — the 4 extra api files

For Vercel to deploy at all, your repo's api/ folder must contain exactly
12 files. If these 4 files are still there, delete them once (see
0-READ-ME-FIRST.txt for the 1-minute options):

    api/batch.js  api/engage.js  api/db-client.js  api/db-wake.js

## Everything else in this pack

- The original 12 api routes (with the notification fix inside notifications.js).
- vercel.json with routes/headers/schedules only — no env block.
- The install fix: restored app icons, bumped service-worker cache,
  persistent installed-state (StoYangu installs fully into the phone's app
  list; the Install button never reappears after a refresh).
- Demo founder login: "Open founder demo" — no password.
- Owner test login: WhatsApp 0793 825 499 / password BestonDemo123!
