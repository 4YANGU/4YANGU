import Link from "next/link";

export const dynamic = "force-dynamic";

const FIXES = [
  {
    n: 1,
    title: "My Products shows only the main photo",
    body: "The card used to stack the cover photo, a strip of the other photos and an inline video player. Now it is just the main photo with a small media badge. Tapping the product opens a details sheet with every photo, the video, colours, sizes, views, orders, Edit and Delete.",
    files: "src/pages/StoreDashboard.tsx · src/woyoyo-017.css",
  },
  {
    n: 2,
    title: "Chat bar on one row, like WhatsApp",
    body: "Message field, camera and send button now sit left-to-right on a single row: a rounded input with the camera inside it and a round green send button beside it. Attachments show as a chip above the row instead of breaking the layout.",
    files: "src/components/SocialInbox.tsx · src/woyoyo-017.css",
  },
  {
    n: 3,
    title: "Phone Back leaves the chat, not the app",
    body: "Every screen used to listen for back on its own, so Android's handler got there first and closed the whole app. There is now one shared back-stack: the newest open layer (chat, dialog, composer) closes first — exactly like the in-app back arrow. The app only closes from the home screen, after a second deliberate press.",
    files: "src/lib/backButton.ts (new) · SocialInbox · PostComposer · Modal · StoreDashboard",
  },
  {
    n: 4,
    title: '"Day 12/30 · ends 17 Oct" removed',
    body: "That line is gone from the store header. The renewal reminder card still appears in the final days, so nothing important was lost — the header is just clean now.",
    files: "src/pages/StoreDashboard.tsx",
  },
  {
    n: 5,
    title: '"Copy caption" button removed',
    body: "The caption is copied automatically the moment you post, and again when you tap Finish on WhatsApp Status. The button and all of its leftover code are gone.",
    files: "src/components/PostComposer.tsx",
  },
  {
    n: 6,
    title: '"Upload interrupted" fixed — posting works',
    body: "Root cause: the app asked Supabase for ONE signed upload link and retried that same link. Supabase signed links are single-use, so after the first hiccup every retry was dead on arrival. Now each attempt mints a brand-new link, uploads via XMLHttpRequest with a size-scaled timeout, sends x-upsert, and waits for the phone to come back online instead of burning a retry. Destinations are now exactly TikTok post, Facebook post + story, Instagram post + story, then Finish on WhatsApp Status.",
    files: "src/lib/api.ts · server/media.js · src/components/PostComposer.tsx",
  },
  {
    n: 7,
    title: "Notifications actually get requested and actually fire",
    body: "Three stacked bugs: (a) the app used new Notification(...), which Android throws on — everything now goes through the service worker; (b) the permission card hid itself in unexpected states, so the phone was never asked — it now always shows a button that fires the real system prompt; (c) Android 13+ needs POST_NOTIFICATIONS declared, which the APK builder now adds. Alerts cover DMs, comments, orders, finished posts and the 7:30 PM update.",
    files: "src/lib/notifications.ts (new) · public/sw.js · StoreDashboard · SocialInbox · PostComposer · main.tsx",
  },
  {
    n: 8,
    title: "App icon + opening animation = the circular store logo",
    body: "Icons were resized from the original upload in one low-quality step, the adaptive foreground was full-bleed so Android masked 25% off every side, no adaptive icon existed at all, and the splash used fit:contain on a navy sheet — that is where your black bars came from. Now a sharp 1024px Lanczos3 master is masked to a true circle, every density is downscaled from it, a proper mipmap-anydpi-v26 adaptive icon keeps the circle inside Android's 66% safe zone, the backdrop colour is sampled from your own logo, and the splash is that same circle centred full-bleed in portrait and landscape.",
    files: "scripts/prepare-store-apk.mjs",
  },
  {
    n: 9,
    title: "Service worker refreshed",
    body: "Cache bumped to stoyangu-static-v17, push rendering hardened, expired push subscriptions renewed silently, and tapping a notification focuses the app you already have open instead of stacking new windows.",
    files: "public/sw.js",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:py-16">
      <span className="inline-block rounded-full bg-[#5a966e]/12 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#40714f]">
        StoYangu · 4YANGU
      </span>
      <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-5xl">WOYOYO-017 fix pack</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#56655a]">
        All nine requested changes, built and verified against your repo (<code className="rounded bg-white px-1.5 py-0.5 text-[13px]">tsc -b</code> clean,{" "}
        <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">npm run build</code> passing). Download the ZIP, drop the folders into your repo,
        and Vercel redeploys on its own. No database migration, no new npm packages.
      </p>

      <div className="mt-7 flex flex-wrap gap-3">
        <a
          href="/woyoyo-017.zip"
          download
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#5a966e] px-6 text-[15px] font-extrabold text-white shadow-[0_10px_30px_rgba(66,122,88,.24)] transition hover:bg-[#477c59]"
        >
          ⬇ Download woyoyo-017.zip
        </a>
        <Link
          href="/login"
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[#d9dfda] bg-white px-6 text-[15px] font-extrabold text-[#2f4a37] transition hover:border-[#5a966e]"
        >
          Open the live demo →
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border border-[#e3e8df] bg-white p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.12em] text-[#40714f]">Demo logins (this preview only)</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#56655a]">
          Use these to test the changed screens here. They live <strong>only</strong> in this preview — the ZIP you drop into your
          repo contains no demo accounts, no demo seed data and no demo login code at all, so your live app stays safe.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-[#f5f8f3] p-4">
            <strong className="block text-[13px] font-extrabold text-[#24382a]">Demo founder</strong>
            <code className="mt-1 block text-[13px] text-[#44604c]">founder@demo.stoyangu.test</code>
            <code className="block text-[13px] text-[#44604c]">demo1234</code>
          </div>
          <div className="rounded-xl bg-[#f5f8f3] p-4">
            <strong className="block text-[13px] font-extrabold text-[#24382a]">Demo store owner</strong>
            <code className="mt-1 block text-[13px] text-[#44604c]">owner@demo.stoyangu.test</code>
            <code className="block text-[13px] text-[#44604c]">demo1234</code>
          </div>
        </div>
      </div>

      <h2 className="mt-12 text-xl font-black tracking-tight">What changed, and why it was broken</h2>
      <ol className="mt-5 grid gap-4">
        {FIXES.map((fix) => (
          <li key={fix.n} className="rounded-2xl border border-[#e3e8df] bg-white p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#5a966e] text-[13px] font-extrabold text-white">
                {fix.n}
              </span>
              <div className="min-w-0">
                <h3 className="text-[15.5px] font-extrabold tracking-tight">{fix.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[#56655a]">{fix.body}</p>
                <p className="mt-2 break-words text-[12px] font-semibold text-[#8a9589]">{fix.files}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 rounded-2xl border border-[#e3e8df] bg-white p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.12em] text-[#40714f]">How to install (2 minutes)</h2>
        <ol className="mt-3 grid gap-2 pl-5 text-[14px] leading-relaxed text-[#56655a] [list-style:decimal]">
          <li>Unzip the download. You get folders shaped exactly like your repo: src/, server/, public/, scripts/, dist/.</li>
          <li>Drag all of them into the top level of your 4YANGU repo and choose Replace / Merge.</li>
          <li>Commit. Vercel rebuilds automatically. Supabase is untouched.</li>
        </ol>
        <p className="mt-3 text-[13px] text-[#8a9589]">
          The full explanation also ships inside the ZIP as <code>WOYOYO-017-INSTALL.txt</code>.
        </p>
      </div>
    </main>
  );
}
