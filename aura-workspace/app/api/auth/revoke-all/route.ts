import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession, clientIp } from "@/lib/session";

// Kill switch: revoke every session AND drop the home-PC tunnel
// registration, so remote access dies immediately everywhere.
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await getUserBySession(token);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  await store.revokeAllSessions(user.id).catch(() => {});
  await store.deleteAgent(user.id);
  store.audit("auth.revoke-all", "kill switch used", user.id, clientIp(req));
  const res = NextResponse.json({ ok: true, revoked: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
