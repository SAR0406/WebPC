// Sets/rotates the host PIN for unattended desktop access.
// Usage:  $env:AURA_HOST_PIN='choose-6-plus-chars'; npm run host:pin
// Stores PBKDF2 verifier only — the PIN never touches disk or the server.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

function load(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !(k in process.env)) process.env[k] = v;
  }
}
load(path.join(process.cwd(), ".env.local"));
load(path.join(process.cwd(), ".env"));

const pin = process.env.AURA_HOST_PIN || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const USER_ID = process.env.AURA_USER_ID || "";

if (!pin || pin.length < 6) {
  console.error("Set AURA_HOST_PIN (min 6 chars).");
  process.exit(1);
}
if (!SUPABASE_URL || !ANON || !USER_ID) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY / AURA_USER_ID in .env.local.");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const iters = 600000;
const key = (await scrypt(pin, salt, 32)).toString("hex");
const verifier = crypto.createHash("sha256").update(Buffer.from(key, "hex")).digest("hex");

const res = await fetch(`${SUPABASE_URL}/rest/v1/aura_host_pin`, {
  method: "POST",
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${ANON}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify({ user_id: Number(USER_ID), salt, verifier, iters, updated_at: new Date().toISOString() }),
});
if (!res.ok) {
  console.error("store failed:", (await res.text()).slice(0, 160));
  process.exit(1);
}
console.log("Host PIN set. Desktop sessions now require it (pairing can remember devices).");
