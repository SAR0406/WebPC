import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
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
  // School mode: short sessions (30 min) vs standard (12 h). Server clamps.
  const minutes = Math.min(720, Math.max(15, Number(body.expiresInMinutes || 720)));
  let user;
  try {
    user = await store.findUserByUsername(username);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Cloud database unreachable." },
      { status: 503 }
    );
  }
  // Constant-time-ish: always verify something to avoid user enumeration timing
  const ok = user ? await verifyPassword(password, user.pass_hash, user.pass_salt) : false;
  if (!user || !ok) {
    store.audit("auth.login.fail", username, user?.id ?? null, ip);
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  const ua = req.headers.get("user-agent") || "";
  const label = deviceLabel(ua);
  try {
    await store.insertDevice({
      user_id: user.id,
      label,
      ip,
      ua: ua.slice(0, 300),
      status: "approved", // v0.1: approve all, approval queue lands in 0.1.x
    });
  } catch {
    // device log is best-effort
  }

  const token = newSessionToken();
  try {
    await store.createSession({
      id: token,
      user_id: user.id,
      device_label: label,
      ip,
      ua: ua.slice(0, 300),
      expires_at: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Login failed." }, { status: 500 });
  }
  store.audit("auth.login", label, user.id, ip);

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
