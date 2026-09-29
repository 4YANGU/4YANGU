import { redirect } from "next/navigation";
import { db } from "@/db";
import { messages, products, stores, threads } from "@/db/schema";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { getSession } from "@/lib/session";
import OwnerWorkspace, { type DemoMessage, type DemoThread } from "./OwnerWorkspace";

export const dynamic = "force-dynamic";

export default async function OwnerPage() {
  await ensureSeed();
  const session = await getSession();
  if (!session) redirect("/login");
  const storeId = session.storeId;
  if (!storeId) redirect("/founder");

  const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) redirect("/login");

  const productRows = await db.select().from(products).where(eq(products.storeId, storeId)).orderBy(asc(products.id));
  const threadRows = await db.select().from(threads).where(eq(threads.storeId, storeId)).orderBy(desc(threads.lastAt));
  const messageRows = threadRows.length
    ? await db.select().from(messages).where(inArray(messages.threadId, threadRows.map((row) => row.id))).orderBy(asc(messages.createdAt))
    : [];

  const hydrated: DemoThread[] = threadRows.map((thread) => ({
    id: thread.id,
    platform: thread.platform,
    kind: thread.kind,
    senderName: thread.senderName,
    senderHandle: thread.senderHandle,
    sourceTitle: thread.sourceTitle,
    lastAt: thread.lastAt.toISOString(),
    messages: messageRows
      .filter((message) => message.threadId === thread.id)
      .map<DemoMessage>((message) => ({
        id: message.id,
        threadId: message.threadId,
        direction: message.direction,
        body: message.body,
        attachmentName: message.attachmentName,
        createdAt: message.createdAt.toISOString(),
      })),
  }));

  return (
    <OwnerWorkspace
      store={{
        id: store.id,
        name: store.name,
        slug: store.slug,
        logoUrl: store.logoUrl,
        visitorTotal: store.visitorTotal,
        visitorToday: store.visitorToday,
        ordersTotal: store.ordersTotal,
        ordersToday: store.ordersToday,
        customers: store.customers,
      }}
      products={productRows.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        images: product.images ?? [],
        videoUrl: product.videoUrl,
        colors: product.colors ?? [],
        sizes: product.sizes ?? [],
        viewsTotal: product.viewsTotal,
        viewsToday: product.viewsToday,
        ordersTotal: product.ordersTotal,
        ordersToday: product.ordersToday,
      }))}
      threads={hydrated}
    />
  );
}
