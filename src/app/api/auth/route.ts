import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await ensureSeed();
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string; action?: string };

  if (body.action === "logout") {
    const response = Response.json({ ok: true });
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return response;
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return Response.json({ error: "Enter the demo email and password." }, { status: 400 });

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.email, email), eq(accounts.password, password)))
    .limit(1);

  if (!account) return Response.json({ error: "Those demo details are not correct." }, { status: 401 });

  const response = Response.json({ ok: true, role: account.role, redirect: account.role === "founder" ? "/founder" : "/owner" });
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${account.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
  );
  return response;
}
