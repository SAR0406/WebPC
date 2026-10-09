import { NextRequest, NextResponse } from "next/server";
import { getDb, audit } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { clientIp } from "@/lib/session";

// First-run admin creation. Disabled once any user exists.
export async function POST(req: NextRequest) {
  const db = getDb();
  const count = (db.prepare("SELECT COUNT(*) as c FROM users").get() as any).c as number;
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
  db.prepare(
    "INSERT INTO users (username, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?)"
  ).run(username, hash, salt, new Date().toISOString());
  audit("auth.init", `admin ${username} created`, null, clientIp(req));
  return NextResponse.json({ ok: true, username });
}

export async function GET() {
  const db = getDb();
  const count = (db.prepare("SELECT COUNT(*) as c FROM users").get() as any).c as number;
  return NextResponse.json({ initialized: count > 0 });
}
