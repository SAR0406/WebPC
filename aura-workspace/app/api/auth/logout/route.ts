import { NextRequest, NextResponse } from "next/server";
import { getDb, audit } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession, clientIp } from "@/lib/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = getUserBySession(token);
  if (token) {
    getDb().prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), token);
  }
  if (user) audit("auth.logout", "", user.id, clientIp(req));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
