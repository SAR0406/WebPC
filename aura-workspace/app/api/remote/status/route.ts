import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";
import { getOnlineAgent, agentSecret } from "@/lib/remote";

// Vercel → home PC: live status through the agent tunnel.
export async function GET(req: NextRequest) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  let agent;
  try {
    agent = await getOnlineAgent(user.id);
  } catch (e: any) {
    return NextResponse.json({ online: false, error: e?.message || "Store unreachable." });
  }
  if (!agent) return NextResponse.json({ online: false });
  try {
    const r = await fetch(agent.url.replace(/\/$/, "") + "/api/agent/status", {
      headers: { "x-aura-agent-secret": agentSecret() },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return NextResponse.json({ online: false });
    const j = await r.json();
    return NextResponse.json({ ...j, via: "tunnel" });
  } catch {
    return NextResponse.json({ online: false });
  }
}
