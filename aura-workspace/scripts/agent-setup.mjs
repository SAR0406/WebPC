// One-time pairing: links this home PC to your AURA account and generates AGENT_SECRET.
// Usage (password via env so `$` never touches shell parsing):
//   $env:AURA_USERNAME='sarthak'; $env:AURA_PASSWORD='...'; $env:SUPABASE_URL='...'; $env:SUPABASE_ANON_KEY='...'
//   npm run agent:setup
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const username = (process.env.AURA_USERNAME || "").trim().toLowerCase();
const password = process.env.AURA_PASSWORD || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const ANON = process.env.SUPABASE_ANON_KEY || "";

if (!username || !password) {
  console.error("Set AURA_USERNAME and AURA_PASSWORD env vars first.");
  process.exit(1);
}
if (!SUPABASE_URL || !ANON) {
  console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY env vars first.");
  process.exit(1);
}

// 1. Log in to the local gateway to resolve the user id.
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
if (!login.ok) {
  console.error("login failed:", (await login.json().catch(() => ({}))).error || login.status);
  console.error("Hint: create the account first (npm run admin:create) and keep npm run dev running.");
  process.exit(1);
}
const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } }).then((r) => r.json());
if (!me.user) {
  console.error("Could not resolve user. Is the gateway running with Supabase env?");
  process.exit(1);
}

// 2. Fetch numeric user id from Supabase.
const res = await fetch(
  `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/aura_users?username=eq.${encodeURIComponent(username)}&select=id&limit=1`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
);
const rows = await res.json();
const userId = rows[0]?.id;
if (!userId) {
  console.error("User not found in cloud DB.");
  process.exit(1);
}

// 3. Generate secret + merge into .env.local (never committed).
const secret = crypto.randomBytes(32).toString("hex");
const envPath = path.join(ROOT, ".env.local");
let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const set = (k, v) => {
  const re = new RegExp(`^${k}=.*$`, "m");
  content = re.test(content) ? content.replace(re, `${k}=${v}`) : `${content.trim()}\n${k}=${v}\n`;
};
set("SUPABASE_URL", SUPABASE_URL);
set("SUPABASE_ANON_KEY", ANON);
set("AGENT_SECRET", secret);
set("AURA_USER_ID", String(userId));
fs.writeFileSync(envPath, content.trim() + "\n");

console.log(`Paired as '${username}' (id ${userId}). .env.local updated.`);
console.log("\n--- Paste these into Vercel → Project → Settings → Environment Variables ---");
console.log(`SUPABASE_URL=${SUPABASE_URL}`);
console.log(`SUPABASE_ANON_KEY=${ANON}`);
console.log(`AGENT_SECRET=${secret}`);
console.log("NEXT_PUBLIC_CLOUD=1");
console.log("AURA_VAULT=/tmp/aura-vault");
console.log("-------------------------------------------------------------------------------");
console.log("Then redeploy, and on this PC run:  npm run dev  +  npm run agent");
