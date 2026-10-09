// Creates the AURA account directly in Supabase (used before first login).
// Usage (password via env so `$` never touches shell parsing):
//   $env:AURA_USERNAME='sarthak'; $env:AURA_PASSWORD='...'; npm run admin:create
import crypto from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const scrypt = promisify(crypto.scrypt);

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const username = (process.env.AURA_USERNAME || "").trim().toLowerCase();
const password = process.env.AURA_PASSWORD || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error("Set AURA_USERNAME (3-32 chars, a-z 0-9 . _ -).");
  process.exit(1);
}
if (!password || password.length < 10) {
  console.error("Set AURA_PASSWORD (10+ chars) via env var.");
  process.exit(1);
}
if (!SUPABASE_URL || !ANON) {
  console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY first (see .env.example).");
  process.exit(1);
}

const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };

// Refuse if any user exists (use /login afterwards instead).
const countRes = await fetch(`${SUPABASE_URL}/rest/v1/aura_users?select=id`, {
  headers: { ...H, Prefer: "count=exact" },
});
const total = (countRes.headers.get("content-range") || "").split("/")[1];
if (total && total !== "*" && Number(total) > 0) {
  console.error("An account already exists. Log in instead of creating.");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = (await scrypt(password, salt, 64)).toString("hex");
const ins = await fetch(`${SUPABASE_URL}/rest/v1/aura_users`, {
  method: "POST",
  headers: { ...H, Prefer: "return=representation" },
  body: JSON.stringify({ username, pass_hash: hash, pass_salt: salt }),
});
if (!ins.ok) {
  console.error("create failed:", (await ins.text()).slice(0, 200));
  process.exit(1);
}
console.log(`Account '${username}' created in cloud DB. Log in at /login.`);
