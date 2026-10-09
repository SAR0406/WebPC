// Usage: AURA_ADMIN=aura PORT=3000 node scripts/init-admin.mjs
// Or: npm run init:admin -- --username=aura --password=... (min 10 chars)
// Creates the first admin via POST /api/auth/init. Must run while `npm run dev` is up,
// or set BASE_URL to the tunnel URL.
const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

function arg(name) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : process.env[`AURA_${name.toUpperCase()}`];
}

const username = (arg("username") || arg("admin") || "aura").toLowerCase();
const password = arg("password") || "";

if (!password || password.length < 10) {
  console.error("Set a 10+ char password: npm run init:admin -- --username=aura --password=YOUR_LONG_PASSWORD");
  process.exit(1);
}

const res = await fetch(`${BASE}/api/auth/init`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("init failed:", body.error || res.status);
  process.exit(1);
}
console.log(`Admin '${body.username}' created. Log in at ${BASE}/login`);
