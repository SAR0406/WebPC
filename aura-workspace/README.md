# AURA Workspace — your personal computer, accessible from anywhere

> Open one website on any computer you are allowed to use. Your digital workspace comes with you.

No Google login. No USB. Nothing to install on the school computer. The home PC does the heavy work; the site is your command center.

## What works today

- **Command deck** (`/files` top bar): `find physics` searches the whole vault, `open notes` previews the best match, `download backup` fetches it, `desktop` jumps to screen share, `pin / mkdir / rename` manage files. Read-only by default; writes need explicit commands.
- **Memory vault**: browse, filter, PDF/image/text previews in a sandboxed modal, downloads with **resume** (HTTP Range), uploads over 8MB **resume automatically** in 1MB chunks.
- **Pinned projects**: `pin` command or Deck; one-click jump, unpin anytime.
- **Live desktop** (`/desktop`): full screen share in the browser with mouse/keyboard control, YouTube-style quality (Auto/720p/720p60/1080p/Highest), live stats (RTT/fps/bitrate), explicit two-way clipboard, auto quality that steps down on bad networks.
- **Personal security**: password + scrypt, short sessions, school-computer 30-minute sessions with countdown + auto-logout, device log, one-click **kill switch** (revokes sessions AND drops the tunnel).
- **Connection quality**: latency dot next to Online status everywhere.

## Run it (home PC)

```powershell
cd aura-workspace
npm install
# .env.local needs: SUPABASE_URL, SUPABASE_ANON_KEY, AURA_VAULT=./vault
npm run dev            # gateway + dashboard  (terminal 1)
npm run agent          # free Cloudflare tunnel + heartbeat (terminal 2)
npm run desktop        # screen-share streamer (terminal 3, needs pip pkgs below)
```

```powershell
# first time only
$env:AURA_USERNAME='sarthak'; $env:AURA_PASSWORD='...'
npm run admin:create   # creates the login
npm run agent:setup    # pairs this PC, prints Vercel env vars
$env:AURA_HOST_PIN='choose-6-plus-chars'; npm run host:pin  # PIN for desktop access
C:\...\Python312\python.exe -m pip install -r agent\requirements-desktop.txt
```

Optional: `AURA_ICE='[{"urls":"turn:host:3478","username":"u","credential":"p"}]'`
in `.env.local` (+ same as `NEXT_PUBLIC_ICE` on Vercel) if a school network blocks
direct UDP. `AURA_LOCK_ON_DISCONNECT=1` locks the PC when a desktop session ends.

## Deploy (Vercel)

1. Run `supabase-setup.sql` once in your Supabase SQL Editor.
2. Push this folder's git repo; set Vercel project root to `aura-workspace` if needed.
3. Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AGENT_SECRET` (from setup), `NEXT_PUBLIC_CLOUD=1`, `AURA_VAULT=/tmp/aura-vault`.
4. Redeploy. Log in as `sarthak` from any browser.

## Honest limits

- Screen share is P2P WebRTC over UDP. School networks that block UDP need a TURN relay (a ~$4/mo upgrade); the UI says so instead of spinning forever.
- Home i3 encodes 720p30 in software (~16ms/frame). Highest 1080p60 will auto-step-down; that is the hardware telling the truth, not a bug.
- Home PC must be awake. Offline files need sync (planned).
- Do not use to evade school policy if remote-access tools are prohibited.
