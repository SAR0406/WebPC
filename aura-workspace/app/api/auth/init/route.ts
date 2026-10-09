import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { hashPassword } from "@/lib/auth";
import { clientIp } from "@/lib/session";

// First-run admin creation. Disabled once any user exists.
export async function POST(req: NextRequest) {
  let count = 0;
  try {
    count = await store.countUsers();
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Cloud database unreachable." },
      { status: 503 }
    );
  }
  if (count > 0) {
    return NextResponse.json({ error: "Already initialized. Use login." }, { status: 403 });
  }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return NextResponse.json({ error: "Username: 3-32 chars, a-z 0-9 . _ -" }, { status: 400 });
  }
  if (password.length < 10) {
    return NextResponse.json({ error: "Password must be at least 10 characters." }, { status: 400 });
  }
  const { hash, salt } = await hashPassword(password);
  try {
    await store.createUser(username, hash, salt);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Create failed." }, { status: 500 });
  }
  store.audit("auth.init", `admin ${username} created`, null, clientIp(req));
  return NextResponse.json({ ok: true, username });
}

export async function GET() {
  try {
    const count = await store.countUsers();
    return NextResponse.json({ initialized: count > 0 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Cloud database unreachable." },
      { status: 503 }
    );
  }
}
