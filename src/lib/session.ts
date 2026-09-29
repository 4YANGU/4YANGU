import { cookies } from "next/headers";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";

export const SESSION_COOKIE = "woyoyo_demo_session";

export type Session = {
  id: number;
  email: string;
  role: string;
  displayName: string;
  storeId: number | null;
};

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!row) return null;
  return { id: row.id, email: row.email, role: row.role, displayName: row.displayName, storeId: row.storeId };
}
