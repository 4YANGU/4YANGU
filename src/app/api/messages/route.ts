import { db } from "@/db";
import { messages, notifications, threads } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureSeed();
  const session = await getSession();
  if (!session?.storeId) return Response.json({ error: "Sign in as the demo store owner." }, { status: 401 });
  const threadId = Number(new URL(request.url).searchParams.get("threadId") || 0);
  if (!threadId) return Response.json({ messages: [] });
  const rows = await db.select().from(messages).where(eq(messages.threadId, threadId)).orderBy(asc(messages.createdAt));
  return Response.json({ messages: rows });
}

export async function POST(request: Request) {
  await ensureSeed();
  const session = await getSession();
  if (!session?.storeId) return Response.json({ error: "Sign in as the demo store owner." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { threadId?: number; body?: string; attachmentName?: string };
  const threadId = Number(body.threadId || 0);
  const text = String(body.body || "").trim().slice(0, 2000);
  const attachmentName = String(body.attachmentName || "").slice(0, 160);
  if (!threadId || (!text && !attachmentName)) return Response.json({ error: "Write a reply first." }, { status: 400 });

  const [message] = await db.insert(messages).values({ threadId, direction: "out", body: text, attachmentName, isRead: true }).returning();
  await db.update(threads).set({ lastAt: new Date() }).where(eq(threads.id, threadId));
  await db.insert(notifications).values({
    storeId: session.storeId,
    title: "Reply sent",
    body: text.slice(0, 120) || attachmentName,
    kind: "dm",
  });
  return Response.json({ message });
}
