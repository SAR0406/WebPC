import { NextRequest, NextResponse } from "next/server";
import { getUserBySession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = getUserBySession(token);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: { username: user.username, device: user.deviceLabel } });
}
