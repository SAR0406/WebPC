import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await getUserBySession(token);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  let expires_at: string | null = null;
  try {
    const s = await store.getSession(user.sessionId);
    expires_at = s?.expires_at || null;
  } catch {}
  return NextResponse.json({ user: { username: user.username, device: user.deviceLabel, expires_at } });
}
