import { NextRequest, NextResponse } from "next/server";
import { getDb, audit } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession, clientIp } from "@/lib/session";

// Kill switch: revoke every session for this user immediately.
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = getUserBySession(token);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  getDb()
    .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), user.id);
  audit("auth.revoke-all", "kill switch used", user.id, clientIp(req));
  const res = NextResponse.json({ ok: true, revoked: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
