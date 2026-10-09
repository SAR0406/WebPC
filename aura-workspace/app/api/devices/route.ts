import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  try {
    const [devices, sessions] = await Promise.all([
      store.listDevices(user.id),
      store.listSessions(user.id),
    ]);
    return NextResponse.json({
      devices,
      sessions: (sessions as any[]).map((s) => ({ ...s, active: !s.revoked_at })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed." }, { status: 503 });
  }
}
