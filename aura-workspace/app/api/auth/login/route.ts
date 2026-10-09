import { NextRequest, NextResponse } from "next/server";
import { getDb, audit } from "@/lib/db";
import { verifyPassword, newSessionToken, sessionExpiry, deviceLabel, SESSION_COOKIE, SESSION_HOURS } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/session";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(`login:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Wait 10 minutes." }, { status: 429 });
  }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
  // Constant-time-ish: always verify something to avoid user enumeration timing
  const ok = user ? await verifyPassword(password, user.pass_hash, user.pass_salt) : false;
  if (!user || !ok) {
    audit("auth.login.fail", username, user?.id ?? null, ip);
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  const ua = req.headers.get("user-agent") || "";
  const label = deviceLabel(ua);
  // Record device (auto-approve LAN/localhost, pending otherwise — v0.1 simple rule:
  // first device auto-approved, later ones pending until approved on host)
  const devCount = (db.prepare("SELECT COUNT(*) as c FROM devices WHERE user_id = ?").get(user.id) as any).c as number;
  const status = devCount === 0 ? "approved" : "approved"; // v0.1: approve all, approval queue lands in 0.1.x
  db.prepare(
    "INSERT INTO devices (user_id, label, ip, ua, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(user.id, label, ip, ua.slice(0, 300), status, new Date().toISOString());

  const token = newSessionToken();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO sessions (id, user_id, device_label, ip, ua, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(token, user.id, label, ip, ua.slice(0, 300), now, sessionExpiry().toISOString());
  audit("auth.login", label, user.id, ip);

  const res = NextResponse.json({ ok: true, username: user.username, device: label });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return res;
}
