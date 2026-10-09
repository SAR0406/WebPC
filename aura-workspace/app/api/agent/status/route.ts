import { NextResponse } from "next/server";
import os from "node:os";
import { vaultRoot } from "@/lib/files";

export async function GET() {
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
