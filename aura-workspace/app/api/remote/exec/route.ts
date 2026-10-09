import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession } from "@/lib/session";
import { getOnlineAgent, agentSecret } from "@/lib/remote";

// Vercel → home PC: generic JSON proxy (preview meta, index, manage, pins).
// `to` must be a relative /api path on the home gateway (no host allowed).
async function proxy(req: NextRequest, to: string, init?: RequestInit) {
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  if (!to.startsWith("/api/") || to.includes("://")) {
    return NextResponse.json({ error: "Bad target." }, { status: 400 });
  }
  const agent = await getOnlineAgent(user.id);
  if (!agent) {
    return NextResponse.json({ error: "Home PC is offline. Start the gateway + agent at home." }, { status: 502 });
  }
  try {
    const r = await fetch(agent.url.replace(/\/$/, "") + to, {
      ...init,
      headers: {
        "x-aura-agent-secret": agentSecret(),
        "content-type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Home PC unreachable through tunnel." }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || "";
  const pass = new URLSearchParams();
  url.searchParams.forEach((v, k) => {
    if (k !== "to") pass.set(k, v);
  });
  const qs = pass.toString();
  return proxy(req, to + (qs ? `?${qs}` : ""));
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || "";
  const body = await req.text();
  return proxy(req, to, { method: "POST", body });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || "";
  const id = url.searchParams.get("id") || "";
  return proxy(req, to + (id ? `?id=${encodeURIComponent(id)}` : ""), { method: "DELETE" });
}
