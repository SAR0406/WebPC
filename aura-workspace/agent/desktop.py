"""
AURA desktop streamer (home PC).
Captures the primary monitor, H.264-encodes (QuickSync if present, else
x264 ultrafast), and serves exactly one viewer at a time over WebRTC P2P.
Signaling + ownership go through Supabase; media is peer-to-peer ($0).

Run:  C:\\...\\python.exe agent\\desktop.py   (or: npm run desktop)
Env (from .env.local): SUPABASE_URL, SUPABASE_ANON_KEY, AURA_USER_ID
"""
import asyncio
import fractions
import json
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from mss import MSS

import av

from aiortc import RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from aiortc import RTCConfiguration, RTCIceServer

try:
    from aiortc.mediastreams import VIDEO_CLOCK_RATE
except ImportError:
    VIDEO_CLOCK_RATE = 90000

# ---------------------------------------------------------------- env

def load_env(path):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        t = line.strip()
        if not t or t.startswith("#") or "=" not in t:
            continue
        k, v = t.split("=", 1)
        k, v = k.strip(), v.strip().strip("\"'")
        if k and k not in os.environ:
            os.environ[k] = v

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_env(os.path.join(ROOT, ".env.local"))
load_env(os.path.join(ROOT, ".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
USER_ID = os.environ.get("AURA_USER_ID", "")

if not SUPABASE_URL or not ANON or not USER_ID:
    print("Missing SUPABASE_URL / SUPABASE_ANON_KEY / AURA_USER_ID. Run npm run agent:setup first.")
    sys.exit(1)

HDRS = {"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"}

# ------------------------------------------------------------ profiles
# Auto starts at 720p30; viewer ("Auto" mode) or user picks the rest.
PROFILES = {
    "auto":     {"w": 1280, "h": 720, "fps": 30, "bps": 2_500_000},
    "720p":     {"w": 1280, "h": 720, "fps": 30, "bps": 2_500_000},
    "720p60":   {"w": 1280, "h": 720, "fps": 60, "bps": 4_000_000},
    "1080p":    {"w": 1920, "h": 1080, "fps": 30, "bps": 5_000_000},
    "highest":  {"w": 1920, "h": 1080, "fps": 60, "bps": 8_000_000},
}

STUN = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
]

# Encoder preference, probed once (QSV missing from most Windows wheels).
_CODEC_ORDER = ["h264_qsv", "libx264"]

# ---------------------------------------------------------------- rest

def sb(method, path, body=None, timeout=15):
    req = urllib.request.Request(
        SUPABASE_URL + "/rest/v1" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=HDRS,
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None

# ---------------------------------------------------------------- input

class Input:
    def __init__(self, w, h):
        self.w, self.h = w, h
        import pyautogui
        pyautogui.FAILSAFE = False
        pyautogui.PAUSE = 0
        self.pg = pyautogui

    KEYS = {
        "enter": "enter", "backspace": "backspace", "tab": "tab", "escape": "esc",
        "arrowup": "up", "arrowdown": "down", "arrowleft": "left", "arrowright": "right",
        "delete": "delete", " ": "space",
    }

    def handle(self, msg):
        try:
            t = msg.get("t")
            pg = self.pg
            if t == "move":
                pg.moveTo(int(msg["x"] * self.w), int(msg["y"] * self.h))
            elif t == "down":
                pg.mouseDown(button={0: "left", 1: "middle", 2: "right"}.get(msg.get("b", 0), "left"))
            elif t == "up":
                pg.mouseUp(button={0: "left", 1: "middle", 2: "right"}.get(msg.get("b", 0), "left"))
            elif t == "wheel":
                pg.scroll(int(msg.get("d", 0)))
            elif t == "key":
                k = str(msg.get("k", ""))
                down = bool(msg.get("down", True))
                name = self.KEYS.get(k.lower(), k if len(k) == 1 else None)
                if name:
                    (pg.keyDown if down else pg.keyUp)(name)
        except Exception:
            pass

# ---------------------------------------------------------------- video

class ScreenTrack(MediaStreamTrack):
    kind = "video"

    def __init__(self):
        super().__init__()
        self.sct = MSS()
        self.mon = self.sct.monitors[1]  # primary
        self.host_w, self.host_h = self.mon["width"], self.mon["height"]
        self.input = Input(self.host_w, self.host_h)
        self.profile_name = "auto"
        self._pts = 0
        self._last = 0.0
        p = PROFILES[self.profile_name]
        print(f"[video] {self.profile_name} {p['w']}x{p['h']}@{p['fps']} (aiortc H.264)", flush=True)

    def set_profile(self, name):
        if name in PROFILES and name != self.profile_name:
            self.profile_name = name
            p = PROFILES[name]
            print(f"[video] {name} {p['w']}x{p['h']}@{p['fps']}", flush=True)

    def _grab_frame(self):
        p = PROFILES[self.profile_name]
        raw = self.sct.grab(self.mon)
        arr = np.frombuffer(raw.bgra, dtype=np.uint8).reshape(raw.height, raw.width, 4)
        # nearest-neighbor downscale (no cv2 dependency); BGRA -> RGB
        sy = max(1, raw.height // p["h"])
        sx = max(1, raw.width // p["w"])
        small = arr[::sy, ::sx][:, :, 2::-1]
        small = small[: p["h"], : p["w"]]
        frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(small), format="rgb24")
        return frame.reformat(p["w"], p["h"], "yuv420p")

    async def recv(self):
        # aiortc>=1.14 removed MediaStreamTrack.next_timestamp(): pace + stamp here.
        p = PROFILES[self.profile_name]
        loop = asyncio.get_event_loop()
        frame = await loop.run_in_executor(None, self._grab_frame)
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, VIDEO_CLOCK_RATE)
        self._pts += VIDEO_CLOCK_RATE // p["fps"]
        now = time.monotonic()
        wait = max(0.0, 1.0 / p["fps"] - (now - self._last))
        self._last = now + wait
        if wait:
            await asyncio.sleep(wait)
        return frame

# ---------------------------------------------------------------- session

async def post_signal(code, kind, payload):
    await asyncio.get_event_loop().run_in_executor(
        None, lambda: sb("POST", "/aura_signals",
                         {"code": code, "user_id": int(USER_ID), "kind": kind, "payload": payload}))

async def poll_signals(code, after):
    rows = await asyncio.get_event_loop().run_in_executor(
        None, lambda: sb("GET", f"/aura_signals?code=eq.{code}&user_id=eq.{USER_ID}"
                               f"&id=gt.{after}&select=id,kind,payload&order=id.asc&limit=100"))
    return rows or []

async def cleanup(code):
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: sb("DELETE", f"/aura_signals?code=eq.{code}&user_id=eq.{USER_ID}"))
    except Exception:
        pass

def candidate_from_json(o):
    # aiortc needs foundation/component/protocol/priority/ip/port/type (+ sdpMid/Mid)
    return RTCIceCandidate(
        sdpMid=o.get("sdpMid"), sdpMLineIndex=o.get("sdpMLineIndex"),
        foundation=o.get("foundation", ""), component=o.get("component", 1),
        protocol=o.get("protocol", "udp"), priority=o.get("priority", 0),
        ip=o.get("ip", ""), port=o.get("port", 0), type=o.get("type", "host"),
    )

def with_bandwidth(sdp, kbps):
    """Pin the video section's target bitrate (aiortc honors b=AS)."""
    out = []
    in_video = False
    for line in sdp.splitlines():
        if line.startswith("m="):
            in_video = line.startswith("m=video")
        if in_video and line.startswith("b=AS:"):
            continue
        out.append(line)
        if in_video and line.startswith("c="):
            out.append(f"b=AS:{kbps}")
    return "\r\n".join(out) + "\r\n"

async def serve_offer(code, offer_b64):
    import base64
    pc = RTCPeerConnection(configuration=RTCConfiguration(
        iceServers=[RTCIceServer(urls=u) for u in STUN]))
    track = ScreenTrack()

    @pc.on("datachannel")
    def on_dc(ch):
        print(f"[input] channel '{ch.label}' open", flush=True)
        track.channel = ch

        @ch.on("message")
        def on_msg(msg):
            try:
                m = json.loads(msg)
            except Exception:
                return
            if m.get("t") == "profile":
                track.set_profile(m.get("name", "auto"))
            elif m.get("t") == "clip-get":
                # Remote -> viewer. User-initiated on both ends (explicit button).
                try:
                    import pyperclip
                    text = str(pyperclip.paste() or "")[:100_000]
                    try:
                        ch.send(json.dumps({"t": "clip", "text": text}))
                    except Exception:
                        pass
                except Exception:
                    pass
            elif m.get("t") == "clip-set":
                # Viewer -> remote. Typed at the cursor; never overwrites remote clipboard.
                try:
                    track.input.pg.typewrite(str(m.get("text", ""))[:5_000], interval=0.0)
                except Exception:
                    pass
            else:
                track.input.handle(m)

    @pc.on("icecandidate")
    async def on_ice(c):
        if c is None:
            return
        await post_signal(code, "ice-agent", json.dumps({
            "sdpMid": c.sdpMid, "sdpMLineIndex": c.sdpMLineIndex,
            "foundation": c.foundation, "component": c.component,
            "protocol": c.protocol, "priority": c.priority,
            "ip": c.ip, "port": c.port, "type": c.type,
        }))

    pc.addTrack(track)
    offer = RTCSessionDescription(sdp=base64.b64decode(offer_b64).decode(), type="offer")
    await pc.setRemoteDescription(offer)
    # Re-assert sendonly: the offer is recvonly, so bind explicitly.
    for t in pc.getTransceivers():
        if t.sender.track is track and t.direction in (None, "recvonly"):
            try:
                t.direction = "sendonly"
            except Exception:
                pass
    answer = await pc.createAnswer()
    kbps = max(500, PROFILES[track.profile_name]["bps"] // 1000)
    answer.sdp = with_bandwidth(answer.sdp, kbps)
    await pc.setLocalDescription(answer)
    await post_signal(code, "answer",
                      __import__("base64").b64encode(pc.localDescription.sdp.encode()).decode())

    after = 0
    closed = asyncio.Event()
    pc.on("connectionstatechange")(lambda: closed.set() if pc.connectionState in ("closed", "failed") else None)
    while not closed.is_set():
        try:
            rows = await asyncio.wait_for(poll_signals(code, after), timeout=30)
        except Exception:
            continue
        for r in rows:
            after = max(after, r["id"])
            if r["kind"] == "ice-viewer":
                try:
                    o = json.loads(r["payload"])
                    if o.get("ip") and o.get("port"):
                        await pc.addIceCandidate(candidate_from_json(o))
                except Exception as e:
                    print(f"[ice] skip candidate: {e}", flush=True)
            elif r["kind"] == "bye":
                closed.set()
    await pc.close()
    await cleanup(code)
    print("[session] closed", flush=True)

async def main():
    print(f"[agent] desktop streamer up (user {USER_ID}). Waiting for viewers…", flush=True)
    seen_offer = 0
    while True:
        try:
            offers = await asyncio.wait_for(asyncio.get_event_loop().run_in_executor(
                None, lambda: sb("GET", f"/aura_signals?user_id=eq.{USER_ID}&kind=eq.offer"
                                       f"&id=gt.{seen_offer}&select=id,code,payload&order=id.asc&limit=5")),
                timeout=30)
        except Exception:
            await asyncio.sleep(2)
            continue
        for o in offers or []:
            seen_offer = max(seen_offer, o["id"])
            print(f"[session] viewer joined ({o['code'][:8]}…)", flush=True)
            try:
                await serve_offer(o["code"], o["payload"])
            except Exception:
                import traceback
                traceback.print_exc()
                await cleanup(o["code"])
            print("[agent] waiting for viewers…", flush=True)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
