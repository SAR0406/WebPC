import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession, clientIp } from "@/lib/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await getUserBySession(token);
  if (token) {
    await store.revokeSession(token).catch(() => {});
  }
  if (user) store.audit("auth.logout", "", user.id, clientIp(req));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
