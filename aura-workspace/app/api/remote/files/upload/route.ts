import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";
import { getOnlineAgent, agentSecret } from "@/lib/remote";

// Vercel → home PC: upload forwarded raw (multipart body passes through).
export async function POST(req: NextRequest) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const agent = await getOnlineAgent(user.id);
  if (!agent) {
    return NextResponse.json({ error: "Home PC is offline. Start the gateway + agent at home." }, { status: 502 });
  }
  const url = new URL(req.url);
  // forward the full query string (path + resumable chunk params)
  const qs = url.searchParams.toString();
  try {
    const body = await req.arrayBuffer();
    const r = await fetch(`${agent.url.replace(/\/$/, "")}/api/files/upload?${qs}`, {
      method: "POST",
      headers: {
        "x-aura-agent-secret": agentSecret(),
        "content-type": req.headers.get("content-type") || "application/octet-stream",
      },
      body,
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Home PC unreachable through tunnel." }, { status: 502 });
  }
}
