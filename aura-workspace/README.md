# AURA Workspace — v0.1 Personal Portal

> Open one website on any computer you are allowed to use. Your digital workspace comes with you.

v0.1 vertical slice: **password login (no Google) → host online status → list one approved folder → secure download.** Nothing to install on the school computer. Home PC runs one Node process.

## Quick start (home PC)

```powershell
cd aura-workspace
npm install
copy .env.example .env.local
# set AURA_VAULT to your real folder, e.g. AURA_VAULT=F:/AURA_Vault
npm run dev
# first run only — 10+ char password:
npm run init:admin -- --username=aura --password=YOUR_LONG_PASSWORD_HERE
# open http://localhost:3000/login
```

School test checklist:

1. Expose `http://localhost:3000` via Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) or Tailscale. No router port-forward of RDP.
2. On school browser open the tunnel URL → `/login`. No install, no Google button.
3. Log in, see green Online dot + hostname.
4. Open vault, search `physics`, download `physics-half-yearly-notes.txt`. Byte-identical.
5. Upload a small file. Try `../../` paths — must be rejected.
6. Press Kill switch — all sessions log out immediately.

## Design (fits i3 / 8GB, $0)

- Single Next.js process serves dashboard + API. No Docker, no VPS, no indexer in v0.1.
- Auth: scrypt-hashed password, opaque session cookie (`httpOnly`, `SameSite=Lax`), 12h expiry, login rate-limit 5/10min, device log, `revoke-all` kill switch. TOTP columns already in schema for 0.1.x.
- Files: `LocalAgent` behind `AgentClient` interface. `GET /api/files`, `GET /api/files/download` (stream), `POST /api/files/upload` (100MB cap). `resolveSafePath` blocks traversal + escaping symlinks. Audit log for login/download/upload.
- DB: `node:sqlite` file at `data/aura.db` (zero deps). Tables: users, sessions, devices, audit.

## API

- `GET/POST /api/auth/init` — first-run admin
- `POST /api/auth/login|logout` `GET /api/auth/me` `POST /api/auth/revoke-all`
- `GET /api/agent/status` — online, host, RAM, vault path
- `GET /api/files?path=/&q=` `GET /api/files/download?path=` `POST /api/files/upload?path=/`
- `GET /api/devices` — recent devices + sessions

## Limits (honest)

- Home PC must be awake. Offline files need sync (0.3).
- $0 P2P 40-60ms desktop needs school UDP allowed; blocked networks fall back to slower TCP in 0.2.
- Do not use to evade school policy if remote-access tools are prohibited.

## Next (0.2 Live Desktop)

LAN WebRTC prototype with QuickSync H.264, Auto/Highest quality switch, stats overlay — only after this slice passes the checklist above.
