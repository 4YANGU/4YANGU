import { db } from "@/db";
import { accounts, messages, notifications, products, stores, threads } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * Idempotent demo seed. Runs once; afterwards it is a single cheap count query.
 * NOTE: this file — and everything demo-related — is deliberately NOT part of
 * the woyoyo-017.zip that goes into the live repo.
 */
let seeding: Promise<void> | null = null;

export async function ensureSeed() {
  if (!seeding) seeding = run().catch((error) => { seeding = null; throw error; });
  return seeding;
}

async function run() {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(stores);
  if (count > 0) return;

  const inserted = await db.insert(stores).values([
    { name: "Stevo Sportswear", slug: "stevo", logoUrl: "/images/stevo-jersey.jpg", visitorTotal: 4820, visitorToday: 96, ordersTotal: 212, ordersToday: 7, customers: 341 },
    { name: "Lily Boutique", slug: "lily", logoUrl: "/images/lily-logo.jpg", visitorTotal: 2610, visitorToday: 41, ordersTotal: 118, ordersToday: 3, customers: 197 },
    { name: "Kito Kids", slug: "kito", logoUrl: "/images/kito-logo.jpg", visitorTotal: 1390, visitorToday: 22, ordersTotal: 64, ordersToday: 2, customers: 88 },
    { name: "Mali Home", slug: "mali", logoUrl: "/images/mali-logo.jpg", visitorTotal: 990, visitorToday: 12, ordersTotal: 37, ordersToday: 1, customers: 55 },
  ]).returning();

  const stevo = inserted[0];
  const lily = inserted[1];

  await db.insert(accounts).values([
    { email: "founder@demo.stoyangu.test", password: "demo1234", role: "founder", displayName: "Demo Founder", storeId: null },
    { email: "owner@demo.stoyangu.test", password: "demo1234", role: "owner", displayName: "Stevo (Demo Store Owner)", storeId: stevo.id },
  ]);

  await db.insert(products).values([
    {
      storeId: stevo.id, name: "Home Jersey 2025", price: "2800", imageUrl: "/images/stevo-jersey.jpg",
      images: ["/images/stevo-jersey.jpg", "/images/stevo-polo.jpg", "/images/stevo-hoodie.jpg", "/images/stevo-perfume.jpg"],
      videoUrl: "/images/demo.mp4", colors: ["Black", "White", "Navy"], sizes: ["S", "M", "L", "XL"],
      viewsTotal: 1840, viewsToday: 64, ordersTotal: 52, ordersToday: 4,
    },
    {
      storeId: stevo.id, name: "Classic Polo", price: "1650", imageUrl: "/images/stevo-polo.jpg",
      images: ["/images/stevo-polo.jpg", "/images/stevo-jersey.jpg"], videoUrl: "",
      colors: ["Navy", "Beige"], sizes: ["M", "L", "XL"], viewsTotal: 902, viewsToday: 21, ordersTotal: 19, ordersToday: 1,
    },
    {
      storeId: stevo.id, name: "Heavy Hoodie", price: "3400", imageUrl: "/images/stevo-hoodie.jpg",
      images: ["/images/stevo-hoodie.jpg", "/images/kito-hoodie.jpg", "/images/stevo-polo.jpg"], videoUrl: "/images/demo.mp4",
      colors: ["Black", "Green"], sizes: ["M", "L", "XL", "XXL"], viewsTotal: 1220, viewsToday: 38, ordersTotal: 31, ordersToday: 2,
    },
    {
      storeId: stevo.id, name: "Signature Perfume", price: "2100", imageUrl: "/images/stevo-perfume.jpg",
      images: ["/images/stevo-perfume.jpg"], videoUrl: "", colors: [], sizes: [],
      viewsTotal: 410, viewsToday: 9, ordersTotal: 8, ordersToday: 0,
    },
    {
      storeId: lily.id, name: "Summer Dress", price: "2450", imageUrl: "/images/lily-dress.jpg",
      images: ["/images/lily-dress.jpg", "/images/lily-blouse.jpg", "/images/lily-set.jpg"], videoUrl: "",
      colors: ["Pink", "Beige"], sizes: ["S", "M", "L"], viewsTotal: 640, viewsToday: 17, ordersTotal: 14, ordersToday: 1,
    },
  ]);

  const nowMinus = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  const t = await db.insert(threads).values([
    { storeId: stevo.id, platform: "whatsapp", kind: "dm", senderName: "Brian K.", senderHandle: "+254712345678", lastAt: nowMinus(4) },
    { storeId: stevo.id, platform: "instagram", kind: "comment", senderName: "wanjiku_254", senderHandle: "@wanjiku_254", sourceTitle: "Home Jersey 2025 reel", lastAt: nowMinus(38) },
    { storeId: stevo.id, platform: "storefront", kind: "dm", senderName: "+254701998877", senderHandle: "+254701998877", sourceTitle: "Heavy Hoodie", lastAt: nowMinus(120) },
    { storeId: stevo.id, platform: "tiktok", kind: "comment", senderName: "mwas.official", senderHandle: "@mwas.official", sourceTitle: "Classic Polo clip", lastAt: nowMinus(400) },
  ]).returning();

  await db.insert(messages).values([
    { threadId: t[0].id, direction: "in", body: "Niaje, hiyo jersey ya home iko size L?", createdAt: nowMinus(9) },
    { threadId: t[0].id, direction: "out", body: "Poa Brian! Ndio, L iko. KES 2,800 na delivery ni 200 CBD.", createdAt: nowMinus(7) },
    { threadId: t[0].id, direction: "in", body: "Sawa nitatuma pesa leo jioni. Unaweza nitumia picha zingine?", createdAt: nowMinus(4) },
    { threadId: t[1].id, direction: "in", body: "Price? 😍", createdAt: nowMinus(38) },
    { threadId: t[2].id, direction: "in", body: "Store Order: Heavy Hoodie · KES 3,400 · Black · L. Delivery. Please deliver to Kasarani.", createdAt: nowMinus(120) },
    { threadId: t[3].id, direction: "in", body: "Do you ship to Kisumu?", createdAt: nowMinus(400) },
    { threadId: t[3].id, direction: "out", body: "Yes we do — 2 days by courier.", createdAt: nowMinus(380) },
  ]);

  await db.insert(notifications).values([
    { storeId: stevo.id, title: "New message", body: "Brian K.: Sawa nitatuma pesa leo jioni…", kind: "dm", createdAt: nowMinus(4) },
    { storeId: stevo.id, title: "New comment", body: "wanjiku_254: Price? 😍", kind: "comment", createdAt: nowMinus(38) },
    { storeId: stevo.id, title: "New store order", body: "Heavy Hoodie · KES 3,400 · Black · L", kind: "order", createdAt: nowMinus(120) },
    { storeId: stevo.id, title: "Your post went through 🎉", body: "TikTok post, Facebook post + story, Instagram post + story accepted.", kind: "post", createdAt: nowMinus(200) },
  ]);
}
