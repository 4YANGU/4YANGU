# StoYangu — Vfixed Pack

This is the **fixed** build of the StoYangu app. The issue fixed in this pack
is the **PWA / "Install app"** problem.

## The problem that was fixed

When a store owner tapped **Install app**, the phone only offered to add a
*home-screen shortcut* instead of installing StoYangu as a **real app** that
shows up in the phone's app list / launcher. On top of that, refreshing the
**Manage my store** page made the **Install app** button reappear, because the
app had no durable record that an install had already happened.

### Root causes

1. **Broken installability signals.** For a browser to offer a *real* install
   (an app entry in the launcher, not just a bookmark shortcut) the PWA must
   satisfy the installability checklist: a valid `manifest.webmanifest` whose
   icons ALL actually exist (192px + 512px `any`, plus a `maskable` icon), a
   registered service worker, and a `start_url` that resolves. The manifest
   referenced `/favicon-192.png` and `/icon-maskable-512.png`, but neither file
   existed in `public/` anymore — so Chrome could not complete a real install
   and downgraded the flow to a plain "Add to Home screen" shortcut.
2. **No persistent "installed" state.** The dashboard only checked
   `display-mode: standalone` at runtime. After a refresh in a normal browser
   tab that check is false, so the **Install app** button showed again even for
   owners who had already installed.

### What changed (the Vfixed diff)

- `public/favicon-192.png` and `public/icon-maskable-512.png` — restored /
  regenerated, so every icon referenced by `manifest.webmanifest` now resolves
  with a real image. This is what makes Chrome install StoYangu as a real app
  (WebAPK) that appears in the app list.
- `public/sw.js` — cache generation bumped to `stoyangu-app-vfixed-1` so every
  client drops the old broken caches and picks up the fixed shell.
- `src/main.tsx` — records the installation in `localStorage` the moment the
  OS fires `appinstalled` (on any page), and also when the app boots in
  standalone display mode.
- `src/pages/StoreDashboard.tsx` — one persistent `appInstalled` flag that
  combines (a) running standalone, (b) the local record, and (c) the
  server-side installation record (`pwa_installations`). The **Install app**
  button and the install card both hide as soon as any of those is true, so a
  refresh no longer brings the button back after a real install.
- `index.html` — manifest/icon cache-busting versions bumped so phones refetch
  the corrected manifest.

## Result

- Tapping **Install app** now triggers a genuine install; StoYangu appears in
  the phone's app list / launcher like a normal app.
- Once installed, refreshing **Manage my store** no longer shows the
  **Install app** button.

## Demo logins

- **Founder:** use the **"Open founder demo"** button on the login page — no
  password needed.
- **Store owner (to test the install flow):** login with WhatsApp number
  `0793 825 499` and password `BestonDemo123!` (Beston Kicks store).

## Run it yourself

```
npm install
npm run dev      # local development
npm run build    # production build (outputs to dist/)
```

Before deploying: run `supabase/setup.sql` (+ `supabase/migrations/*`) in your
Supabase SQL editor, and put your Supabase keys into `vercel.json`
(placeholder values included) or your host's environment variables.
