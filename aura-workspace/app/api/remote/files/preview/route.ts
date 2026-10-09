import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";
import { getOnlineAgent, agentSecret } from "@/lib/remote";

// Vercel → home PC: preview bytes streamed through (inline display).
export async function GET(req: NextRequest) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const agent = await getOnlineAgent(user.id);
  if (!agent) {
    return NextResponse.json({ error: "Home PC is offline. Start the gateway + agent at home." }, { status: 502 });
  }
  const url = new URL(req.url);
  const qs = new URLSearchParams({ path: url.searchParams.get("path") || "" });
  try {
    const r = await fetch(`${agent.url.replace(/\/$/, "")}/api/files/preview?${qs}`, {
      headers: { "x-aura-agent-secret": agentSecret() },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !r.body || !ct || ct.includes("application/json")) {
      const j = await r.json().catch(() => ({}));
      return NextResponse.json(j, { status: r.status || 502 });
    }
    const headers: Record<string, string> = { "content-type": ct };
    for (const h of ["content-length", "content-disposition"]) {
      const v = r.headers.get(h);
      if (v) headers[h] = v;
    }
    headers["x-content-type-options"] = "nosniff";
    headers["content-security-policy"] = "sandbox";
    return new NextResponse(r.body as any, { headers });
  } catch {
    return NextResponse.json({ error: "Home PC unreachable through tunnel." }, { status: 502 });
  }
}
