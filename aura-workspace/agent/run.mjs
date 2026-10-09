// AURA home agent (pure Node, zero deps).
// Opens a free Cloudflare Quick Tunnel to the local gateway, registers the
// public URL in Supabase, and heartbeats so the Vercel app knows you're online.
// Run on the HOME PC:  npm run agent
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const SECRET = process.env.AGENT_SECRET || "";
const USER_ID = process.env.AURA_USER_ID || "";
const PORT = process.env.PORT || "3000";
const LOCAL = `http://localhost:${PORT}`;

if (!SUPABASE_URL || !ANON) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY. Run npm run agent:setup first.");
  process.exit(1);
}
if (!SECRET) {
  console.error("Missing AGENT_SECRET. Run npm run agent:setup first.");
  process.exit(1);
}
if (!USER_ID) {
  console.error("Missing AURA_USER_ID. Run npm run agent:setup first.");
  process.exit(1);
}

const sbHeaders = {
  apikey: ANON,
  Authorization: `Bearer ${ANON}`,
  "Content-Type": "application/json",
};

async function sb(pathname, opts = {}) {
  const res = await fetch(SUPABASE_URL + "/rest/v1" + pathname, {
    method: opts.method || "GET",
    headers: { ...sbHeaders, ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function checkGateway() {
  const res = await fetch(LOCAL + "/api/agent/status", {
    headers: { "x-aura-agent-secret": SECRET },
  }).catch(() => null);
  if (!res || !res.ok) {
    console.error(`Local gateway not reachable at ${LOCAL}. Start it first: npm run dev`);
    process.exit(1);
  }
  console.log("Local gateway OK.");
}

async function ensureCloudflared() {
  const binDir = path.join(ROOT, "agent", "bin");
  const bin = path.join(binDir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  try {
    const v = await new Promise((resolve) => {
      const p = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (c) => resolve(c === 0 ? out.trim() : ""));
      p.on("error", () => resolve(""));
      setTimeout(() => resolve(""), 8000);
    });
    if (v) {
      console.log("cloudflared:", v.split("\n")[0]);
      return bin;
    }
  } catch {}
  if (process.platform !== "win32") {
    console.error("cloudflared not found. Install it (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and re-run.");
    process.exit(1);
  }
  console.log("Downloading cloudflared (one time)...");
  fs.mkdirSync(binDir, { recursive: true });
  const url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("cloudflared download failed");
  const file = fs.createWriteStream(bin);
  await new Promise((resolve, reject) => {
    Readable.fromWeb(res.body).pipe(file);
    file.on("finish", resolve);
    file.on("error", reject);
  });
  console.log("cloudflared ready.");
  return bin;
}

const secretHash = crypto.createHash("sha256").update(SECRET).digest("hex");

async function registerTunnel(tunnelUrl) {
  await sb("/aura_agents", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      user_id: Number(USER_ID),
      url: tunnelUrl,
      secret_hash: secretHash,
      host: os.hostname(),
      last_seen: new Date().toISOString(),
    },
  });
  console.log("Registered tunnel:", tunnelUrl);
}

async function heartbeat(tunnelUrl) {
  await sb(`/aura_agents?user_id=eq.${USER_ID}`, {
    method: "PATCH",
    body: { url: tunnelUrl, last_seen: new Date().toISOString() },
  });
}

async function unregister() {
  try {
    await sb(`/aura_agents?user_id=eq.${USER_ID}`, { method: "DELETE" });
    console.log("Unregistered (offline).");
  } catch {}
}

async function main() {
  await checkGateway();
  const bin = await ensureCloudflared();
  console.log("Opening free Cloudflare tunnel...");
  const cf = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tunnelUrl = "";
  let hb = null;
  const onData = async (d) => {
    const s = String(d);
    if (!tunnelUrl) {
      const m = s.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (m) {
        tunnelUrl = m[0];
        try {
          await registerTunnel(tunnelUrl);
        } catch (e) {
          console.error("Register failed:", e.message);
          process.exit(1);
        }
        hb = setInterval(() => heartbeat(tunnelUrl).catch(() => {}), 25000);
      }
    }
  };
  cf.stdout.on("data", onData);
  cf.stderr.on("data", onData);
  cf.on("close", async (code) => {
    console.error(`tunnel closed (${code}). Re-run npm run agent to reconnect.`);
    if (hb) clearInterval(hb);
    await unregister();
    process.exit(1);
  });
  const cleanup = async () => {
    cf.kill();
    if (hb) clearInterval(hb);
    await unregister();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((e) => {
  console.error("agent failed:", e.message);
  process.exit(1);
});
