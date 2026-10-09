import { NextRequest, NextResponse } from "next/server";
import os from "node:os";
import { checkAccess } from "@/lib/guard";
import { vaultRoot } from "@/lib/files";

// Home-gateway status. Guarded by session cookie OR agent secret, so the
// Vercel app can poll it through the tunnel without exposing it publicly.
export async function GET(req: NextRequest) {
  const access = await checkAccess(req);
  if (!access) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  let vault = "";
  let vaultOk = false;
  try {
    vault = vaultRoot();
    vaultOk = true;
  } catch {
    vaultOk = false;
  }
  const mem = process.memoryUsage();
  return NextResponse.json({
    online: true,
    agent: "local",
    host: os.hostname(),
    platform: os.platform(),
    cpu1m: os.loadavg()[0],
    freememMB: Math.round(os.freemem() / 1024 / 1024),
    totalmemMB: Math.round(os.totalmem() / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    vault,
    vaultOk,
    time: new Date().toISOString(),
  });
}
