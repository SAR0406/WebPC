import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  try {
    return NextResponse.json({ pins: await store.listPins(user.id) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "").trim().slice(0, 80);
  const path = String(body.path || "/").slice(0, 500);
  if (!label || !path.startsWith("/")) {
    return NextResponse.json({ error: "Need label + /path." }, { status: 400 });
  }
  try {
    await store.addPin(user.id, label, path);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Pin failed." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id") || 0);
  if (id) await store.deletePin(user.id, id);
  return NextResponse.json({ ok: true });
}
