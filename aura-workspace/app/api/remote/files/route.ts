import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";
import { getOnlineAgent, agentSecret } from "@/lib/remote";

// Vercel → home PC: folder listing through the agent tunnel.
export async function GET(req: NextRequest) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const agent = await getOnlineAgent(user.id);
  if (!agent) {
    return NextResponse.json({ error: "Home PC is offline. Start the gateway + agent at home." }, { status: 502 });
  }
  const url = new URL(req.url);
  const qs = new URLSearchParams({
    path: url.searchParams.get("path") || "/",
    q: url.searchParams.get("q") || "",
  });
  try {
    const r = await fetch(`${agent.url.replace(/\/$/, "")}/api/files?${qs}`, {
      headers: { "x-aura-agent-secret": agentSecret() },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Home PC unreachable through tunnel." }, { status: 502 });
  }
}
