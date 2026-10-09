import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";

// School mode: shrink THIS session's lifetime (15–720 min, server-clamped).
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await getUserBySession(token);
  if (!user || !token) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const minutes = Math.min(720, Math.max(15, Number(body.minutes || 30)));
  try {
    await store.shortenSession(user.sessionId, user.id, minutes);
    return NextResponse.json({ ok: true, minutes });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed." }, { status: 500 });
  }
}
