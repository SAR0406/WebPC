import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await getUserBySession(token);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: { username: user.username, device: user.deviceLabel } });
}
