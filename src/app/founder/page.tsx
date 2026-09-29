import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { notifications, products, stores } from "@/db/schema";
import { asc, desc, sql } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { getSession } from "@/lib/session";
import SignOutButton from "./SignOutButton";

export const dynamic = "force-dynamic";

export default async function FounderPage() {
  await ensureSeed();
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "founder") redirect("/owner");

  const storeRows = await db.select().from(stores).orderBy(asc(stores.id));
  const counts = await db
    .select({ storeId: products.storeId, total: sql<number>`count(*)::int` })
    .from(products)
    .groupBy(products.storeId);
  const alerts = await db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(8);

  const totals = storeRows.reduce(
    (accumulator, store) => ({
      visitors: accumulator.visitors + store.visitorTotal,
      orders: accumulator.orders + store.ordersTotal,
      customers: accumulator.customers + store.customers,
    }),
    { visitors: 0, orders: 0, customers: 0 },
  );

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#5a966e]">Founder dashboard</span>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">StoYangu overview</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/" className="rounded-xl border border-[#dfe4dc] bg-white px-4 py-2 text-[13px] font-extrabold text-[#2f4a37]">
            Release notes
          </Link>
          <SignOutButton />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {[
          [totals.customers, "customers"],
          [totals.visitors, "visitors"],
          [totals.orders, "orders"],
        ].map(([value, label]) => (
          <div key={String(label)} className="rounded-2xl border border-[#e3e8df] bg-white p-4 text-center">
            <strong className="block text-2xl font-black">{Number(value).toLocaleString()}</strong>
            <span className="text-[12px] text-[#7d8a80]">{String(label)}</span>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-black tracking-tight">All stores</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {storeRows.map((store) => (
          <article key={store.id} className="flex items-center gap-3 rounded-2xl border border-[#e3e8df] bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={store.logoUrl} alt={`${store.name} logo`} className="h-12 w-12 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-[14.5px] font-extrabold">{store.name}</strong>
              <small className="block truncate text-[12px] text-[#7d8a80]">{store.slug}.stoyangu.com</small>
              <small className="block text-[11px] font-bold text-[#5a966e]">
                {counts.find((entry) => entry.storeId === store.id)?.total ?? 0} products · {store.ordersTotal} orders
              </small>
            </div>
          </article>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-black tracking-tight">Notification centre</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-[#56655a]">
        Fix 7 — every one of these now reaches the phone: DMs, comments, store orders, posts that went through and the 7:30 PM
        daily update. They are raised through the service worker, which is the only route Android allows.
      </p>
      <ul className="mt-3 grid gap-2">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex items-start gap-3 rounded-xl border border-[#e3e8df] bg-white p-3">
            <span className="text-lg">{alert.kind === "order" ? "🧾" : alert.kind === "comment" ? "💬" : alert.kind === "post" ? "🚀" : "✉️"}</span>
            <div className="min-w-0">
              <strong className="block text-[13.5px] font-extrabold">{alert.title}</strong>
              <small className="block text-[12.5px] text-[#65736a]">{alert.body}</small>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8 rounded-2xl border border-[#e3e8df] bg-white p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.12em] text-[#40714f]">Test the owner screens</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#56655a]">
          Sign out and use the demo store owner login to see fixes 1, 2, 3 and 4 in action.
        </p>
        <Link href="/login" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-[#5a966e] px-5 text-[14px] font-extrabold text-white">
          Go to the login screen
        </Link>
      </div>
    </main>
  );
}
