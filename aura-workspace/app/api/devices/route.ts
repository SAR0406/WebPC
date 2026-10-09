import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const user = getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const db = getDb();
  const devices = db
    .prepare("SELECT id, label, ip, status, created_at FROM devices WHERE user_id = ? ORDER BY id DESC LIMIT 20")
    .all(user.id);
  const sessions = db
    .prepare("SELECT id, device_label, ip, created_at, expires_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(user.id);
  return NextResponse.json({ devices, sessions: (sessions as any[]).map((s) => ({ ...s, active: !s.revoked_at })) });
}
