"""
Loopback test for the AURA desktop streamer.
Acts as a headless viewer (aiortc): offer → answer → ICE → 6s of video →
profile switch → input message → bye. Prints measured FPS and PASS/FAIL.

Usage:  C:\\...\\python.exe agent\\loopback-test.py
Needs: desktop.py running on this PC, .env.local with SUPABASE_* + AURA_USER_ID.
"""
import asyncio
import base64
import json
import os
import sys
import time
import urllib.request
import uuid

from aiortc import RTCIceCandidate, RTCPeerConnection, RTCSessionDescription
from aiortc import RTCConfiguration, RTCIceServer


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

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
USER_ID = os.environ.get("AURA_USER_ID", "")
HDRS = {"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"}


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


async def main():
    code = str(uuid.uuid4())
    pc = RTCPeerConnection(configuration=RTCConfiguration(
        iceServers=[RTCIceServer(urls="stun:stun.l.google.com:19302")]))
    got_channel = asyncio.Event()
    got_clip = asyncio.Event()
    need_pin = asyncio.Event()
    verified = asyncio.Event()
    frames = []

    @pc.on("datachannel")
    def on_dc(ch):
        pass  # viewer creates the channel; streamer handles it

    dc = pc.createDataChannel("aura-input")
    pc.addTransceiver("video", direction="recvonly")

    @dc.on("open")
    def _open():
        got_channel.set()

    @dc.on("message")
    def _msg(m):
        import hashlib
        try:
            o = json.loads(m)
            if o.get("t") == "clip":
                got_clip.set()
            elif o.get("t") == "pin-req":
                need_pin.set()
                # host PIN gate: prove possession without revealing the PIN on signaling
                test_pin = os.environ.get("AURA_TEST_PIN", "")
                if not test_pin:
                    print("PIN required but AURA_TEST_PIN unset")
                    return
                key = hashlib.pbkdf2_hmac("sha256", test_pin.encode(),
                                          bytes.fromhex(o["salt"]), o["iters"], 32).hex()
                dc.send(json.dumps({"t": "pin-key", "key": key, "nonce": o["nonce"]}))
            elif o.get("t") == "pin-ok":
                verified.set()
        except Exception as e:
            print("msg err", e)

    @pc.on("track")
    def on_track(track):
        async def consume():
            # gate: pin-ok, or 3s of open channel with no pin-req (open mode)
            try:
                await asyncio.wait_for(verified.wait(), timeout=3)
            except asyncio.TimeoutError:
                if need_pin.is_set():
                    print("PIN gate blocked (wrong/missing AURA_TEST_PIN?)")
                    return
            t0 = time.monotonic()
            while time.monotonic() - t0 < 6:
                try:
                    f = await asyncio.wait_for(track.recv(), timeout=5)
                    frames.append((f.pts, f.time_base))
                except Exception:
                    break
        asyncio.ensure_future(consume())

    @pc.on("icecandidate")
    async def on_ice(c):
        if c is None:
            return
        sb("POST", "/aura_signals", {"code": code, "user_id": int(USER_ID), "kind": "ice-viewer",
            "payload": json.dumps({"sdpMid": c.sdpMid, "sdpMLineIndex": c.sdpMLineIndex,
                "foundation": c.foundation, "component": c.component, "protocol": c.protocol,
                "priority": c.priority, "ip": c.ip, "port": c.port, "type": c.type})})

    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sb("POST", "/aura_signals", {"code": code, "user_id": int(USER_ID), "kind": "offer",
        "payload": base64.b64encode(pc.localDescription.sdp.encode()).decode()})

    after = 0
    answered = False
    t0 = time.monotonic()
    while time.monotonic() - t0 < 40 and not (answered and got_channel.is_set() and len(frames) >= 30):
        rows = sb("GET", f"/aura_signals?code=eq.{code}&user_id=eq.{USER_ID}"
                         f"&id=gt.{after}&select=id,kind,payload&order=id.asc&limit=100") or []
        for r in rows:
            after = max(after, r["id"])
            if r["kind"] == "answer" and not answered:
                sdp = base64.b64decode(r["payload"]).decode()
                await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="answer"))
                answered = True
            elif r["kind"] == "ice-agent":
                o = json.loads(r["payload"])
                await pc.addIceCandidate(RTCIceCandidate(
                    sdpMid=o.get("sdpMid"), sdpMLineIndex=o.get("sdpMLineIndex"),
                    foundation=o.get("foundation", ""), component=o.get("component", 1),
                    protocol=o.get("protocol", "udp"), priority=o.get("priority", 0),
                    ip=o.get("ip", ""), port=o.get("port", 0), type=o.get("type", "host")))
        await asyncio.sleep(0.4)

    ok = answered and len(frames) >= 30
    # exercise control plane: profile switch + input + clipboard fetch
    if got_channel.is_set() and ok:
        dc.send(json.dumps({"t": "profile", "name": "720p"}))
        await asyncio.sleep(1)
        dc.send(json.dumps({"t": "move", "x": 0.5, "y": 0.5}))
        dc.send(json.dumps({"t": "clip-get"}))
        try:
            await asyncio.wait_for(got_clip.wait(), timeout=5)
            clip_ok = True
        except asyncio.TimeoutError:
            clip_ok = False
    else:
        clip_ok = False

    dt = (frames[-1][0] * frames[-1][1] - frames[0][0] * frames[0][1]) if len(frames) > 1 else 0
    fps = (len(frames) - 1) / float(dt) if dt else 0
    print(f"frames={len(frames)} measured_fps={fps:.1f} datachannel={got_channel.is_set()} clip={clip_ok}")

    sb("POST", "/aura_signals", {"code": code, "user_id": int(USER_ID), "kind": "bye", "payload": ""})
    await pc.close()
    sb("DELETE", f"/aura_signals?code=eq.{code}&user_id=eq.{USER_ID}")

    ok = answered and len(frames) >= 30 and clip_ok
    if ok:
        print("LOOPBACK PASS")
    else:
        print("LOOPBACK FAIL")
        sys.exit(1)


asyncio.run(main())
