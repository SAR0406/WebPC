"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
function iceConfig(): RTCConfiguration {
  // Optional TURN for symmetric NATs: NEXT_PUBLIC_ICE='[{"urls":"turn:h:3478","username":"u","credential":"p"}]'
  try {
    const raw = process.env.NEXT_PUBLIC_ICE || "";
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return { iceServers: arr };
    }
  } catch {}
  return { iceServers: STUN };
}
const PROFILES = ["Auto", "720p", "720p60", "1080p", "Highest"] as const;
const LADDER = ["720p", "720p60", "1080p", "Highest"];
const toAgentName = (p: string) => ({ Auto: "auto", "720p": "720p", "720p60": "720p60", "1080p": "1080p", Highest: "highest" }[p]);

const b64e = (s: string) => btoa(unescape(encodeURIComponent(s)));

type Stats = { rtt: number; fps: number; jitter: number; bitrate: number; state: string };

export default function Desktop() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const codeRef = useRef("");
  const afterRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRef = useRef({ profile: "720p", goodStreak: 0 });
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");
  const [quality, setQuality] = useState<(typeof PROFILES)[number]>("Auto");
  const [stats, setStats] = useState<Stats>({ rtt: 0, fps: 0, jitter: 0, bitrate: 0, state: "-" });
  const [showStats, setShowStats] = useState(true);
  const [control, setControl] = useState(true);
  const [clip, setClip] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [pinReq, setPinReq] = useState<{ salt: string; iters: number; nonce: string } | null>(null);
  const [pinErr, setPinErr] = useState("");
  const [verified, setVerified] = useState(false);
  const verifiedRef = useRef(false);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  useEffect(() => {
    fetch("/api/auth/me").then((r) => {
      if (!r.ok) router.replace("/login");
    });
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signal(kind: string, payload: string) {
    await fetch("/api/desktop/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeRef.current, kind, payload }),
    });
  }

  function sendInput(m: any) {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(m));
  }

  function setProfile(p: string) {
    autoRef.current.profile = p;
    sendInput({ t: "profile", name: toAgentName(p) });
  }

  async function start() {
    setErr("");
    setStatus("signaling…");
    try {
      const code = crypto.randomUUID();
      codeRef.current = code;
      afterRef.current = 0;
      const pc = new RTCPeerConnection(iceConfig());
      pcRef.current = pc;
      pc.addTransceiver("video", { direction: "recvonly" });

      const dc = pc.createDataChannel("aura-input");
      dcRef.current = dc;
      dc.onopen = () => {
        setStatus("verifying…");
        // video stays black + input locked until the host accepts PIN/pairing
      };
      dc.onmessage = async (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.t === "clip") {
            setClip(String(m.text || "").slice(0, 100000));
            navigator.clipboard?.writeText(String(m.text || "")).catch(() => {});
          } else if (m.t === "pin-req") {
            // paired device? try token first, else ask for the host PIN
            const saved = localStorage.getItem("aura-pair-token");
            if (saved) {
              dc.send(JSON.stringify({ t: "pair", token: saved }));
            } else {
              setPinReq({ salt: m.salt, iters: m.iters, nonce: m.nonce });
              setStatus("pin required");
            }
          } else if (m.t === "pin-ok") {
            if (m.token) localStorage.setItem("aura-pair-token", m.token);
            verifiedRef.current = true;
            setVerified(true);
            setPinReq(null);
            setPinErr("");
            setStatus("live");
            setProfile(qualityRef.current === "Auto" ? "720p" : qualityRef.current);
          } else if (m.t === "pin-no") {
            localStorage.removeItem("aura-pair-token");
            setPinErr(`Wrong PIN${m.left != null ? ` — ${m.left} tries left` : ""}.`);
          }
        } catch {}
      };

      pc.ontrack = (e) => {
        if (videoRef.current) {
          videoRef.current.srcObject = e.streams[0];
          videoRef.current.play().catch(() => {});
        }
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) signal("ice-viewer", JSON.stringify(e.candidate.toJSON()));
      };
      pc.onconnectionstatechange = () => {
        setStats((s) => ({ ...s, state: pc.connectionState }));
        if (pc.connectionState === "failed") {
          setErr("P2P blocked: your network forbids direct UDP (needs a TURN relay — a $4/mo upgrade). Files still work.");
          setStatus("failed");
        }
        if (pc.connectionState === "disconnected") setStatus("reconnecting…");
        if (pc.connectionState === "connected") setStatus("live");
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await signal("offer", b64e(pc.localDescription!.sdp));

      // poll answer + agent ICE
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/desktop/signal?code=${code}&after=${afterRef.current}`);
          if (!r.ok) return;
          const j = await r.json();
          for (const s of j.signals || []) {
            afterRef.current = Math.max(afterRef.current, s.id);
            if (s.kind === "answer" && !pc.remoteDescription) {
              const sdp = decodeURIComponent(escape(atob(s.payload)));
              await pc.setRemoteDescription({ type: "answer", sdp });
            } else if (s.kind === "ice-agent") {
              try {
                await pc.addIceCandidate(JSON.parse(s.payload));
              } catch {}
            }
          }
        } catch {}
      }, 700);

      statsLoop(pc);
    } catch (e: any) {
      setErr(e.message || "Start failed.");
      setStatus("idle");
    }
  }

  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let lastBytes = 0;
  let lastT = 0;
  function statsLoop(pc: RTCPeerConnection) {
    if (statsTimer) clearInterval(statsTimer);
    lastBytes = 0;
    lastT = performance.now();
    statsTimer = setInterval(async () => {
      try {
        const rep = await pc.getStats();
        let rtt = 0, fps = 0, jitter = 0;
        rep.forEach((r: any) => {
          if (r.type === "candidate-pair" && r.state === "succeeded") rtt = (r.currentRoundTripTime || 0) * 1000;
          if (r.type === "inbound-rtp" && r.kind === "video") {
            fps = r.framesPerSecond || 0;
            jitter = (r.jitter || 0) * 1000;
            const now = performance.now();
            const br = lastBytes ? ((r.bytesReceived - lastBytes) * 8) / ((now - lastT) / 1000) / 1e6 : 0;
            lastBytes = r.bytesReceived;
            lastT = now;
            setStats((s) => ({ ...s, fps: Math.round(fps), jitter: Math.round(jitter), bitrate: +br.toFixed(2) }));
          }
        });
        if (rtt) setStats((s) => ({ ...s, rtt: Math.round(rtt) }));
        autoControl(rtt, fps);
      } catch {}
    }, 2000);
  }

  function autoControl(rtt: number, fps: number) {
    if (qualityRef.current !== "Auto") return;
    const a = autoRef.current;
    const i = LADDER.indexOf(a.profile);
    if ((rtt > 150 && rtt > 0) || (fps > 0 && fps < 15)) {
      if (i > 0) {
        setProfile(LADDER[i - 1]);
        a.goodStreak = 0;
      }
    } else if (rtt > 0 && rtt < 60 && fps > 25 && i < LADDER.length - 1) {
      a.goodStreak += 1;
      if (a.goodStreak >= 3) {
        setProfile(LADDER[i + 1]);
        a.goodStreak = 0;
      }
    } else {
      a.goodStreak = 0;
    }
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinReq || !pin) return;
    setPinErr("");
    try {
      const enc = new TextEncoder();
      const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
      const salt = Uint8Array.from(Buffer.from(pinReq.salt, "hex"));
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: pinReq.iters, hash: "SHA-256" },
        base,
        256
      );
      const key = Buffer.from(bits).toString("hex");
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") {
        dc.send(JSON.stringify({ t: "pin-key", key, nonce: pinReq.nonce, remember }));
        setStatus("verifying…");
      }
      setPin("");
    } catch {
      setPinErr("This browser blocked crypto. Use Chrome/Edge.");
    }
  }

  async function stop() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (statsTimer) clearInterval(statsTimer);
    try {
      if (codeRef.current) {
        await signal("bye", "");
        await fetch(`/api/desktop/signal?code=${codeRef.current}`, { method: "DELETE" });
      }
    } catch {}
    dcRef.current?.close();
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    codeRef.current = "";
    verifiedRef.current = false;
    setVerified(false);
    setPinReq(null);
    setPin("");
    setStatus("idle");
  }

  function rel(e: React.MouseEvent) {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  return (
    <main className="wrap" style={{ maxWidth: 1100 }}>
      <div className="topbar">
        <div className="row">
          <span className={`dot ${status === "live" ? "ok" : "bad"}`} />
          <strong>Live Desktop</strong>
          <span className="muted">{status}{status === "live" ? ` · ${autoRef.current.profile}` : ""}</span>
        </div>
        <div className="row">
          <select value={quality} onChange={(e) => {
            const q = e.target.value as typeof quality;
            setQuality(q);
            if (status === "live" && q !== "Auto") setProfile(q);
            if (q === "Auto") { autoRef.current.goodStreak = 0; }
          }}>
            {PROFILES.map((p) => <option key={p} value={p}>{p === "Auto" ? "Auto (recommended)" : p}</option>)}
          </select>
          <button className="ghost" onClick={() => setShowStats(!showStats)}>Stats</button>
          <button className="ghost" onClick={() => setControl(!control)}>{control ? "Control: on" : "Control: off"}</button>
          <button className="ghost" onClick={() => sendInput({ t: "clip-get" })} title="Fetch remote clipboard (explicit)">Copy ⬅ remote</button>
          <button className="ghost" onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (text) sendInput({ t: "clip-set", text: text.slice(0, 5000) });
            } catch {
              const text = prompt("Text to type on the remote PC:");
              if (text) sendInput({ t: "clip-set", text: text.slice(0, 5000) });
            }
          }} title="Type local text at the remote cursor (explicit)">Paste remote ➡</button>
          {status === "live" || status.startsWith("verifying") || status === "pin required" ? (
            <span className="row">
              <button className="danger" onClick={stop}>Disconnect</button>
              <button className="ghost" onClick={async () => { await stop(); await start(); }} title="Fresh ICE + new session">Reconnect</button>
            </span>
          ) : <button onClick={start}>Connect</button>}
          <button className="ghost" onClick={() => router.push("/files")}>Files</button>
        </div>
      </div>

      {pinReq && !verified && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}
          onClick={() => {}}>
          <form onSubmit={submitPin} className="card" style={{ width: 340 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Host PIN</h3>
            <p className="muted" style={{ fontSize: 13 }}>This PC is locked. Enter the PIN you set on the host. It never leaves this browser in plaintext.</p>
            <input type="password" placeholder="••••••" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus style={{ width: "100%", marginBottom: 10 }} />
            <label className="row muted" style={{ fontSize: 13, marginBottom: 10 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 16 }} />
              Remember this device
            </label>
            <button style={{ width: "100%" }}>Unlock</button>
            {pinErr && <p className="err">{pinErr}</p>}
            <p className="row" style={{ marginTop: 10 }}>
              <button type="button" className="ghost" onClick={stop}>Cancel</button>
            </p>
          </form>
        </div>
      )}

      {err && <p className="err">{err}</p>}

      {clip != null && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Remote clipboard</strong>
            <button className="ghost" onClick={() => setClip(null)}>Clear</button>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 160, overflow: "auto" }}>{clip || "(empty)"}</pre>
        </div>
      )}

      <div className="card" style={{ padding: 8, position: "relative" }}>
        <video
          ref={videoRef}
          style={{ width: "100%", borderRadius: 8, background: "#000", aspectRatio: "16/9" }}
          playsInline
          muted
          onMouseMove={(e) => control && sendInput({ t: "move", ...rel(e) })}
          onMouseDown={(e) => control && sendInput({ t: "down", b: e.button, ...rel(e) })}
          onMouseUp={(e) => control && sendInput({ t: "up", b: e.button, ...rel(e) })}
          onWheel={(e) => control && sendInput({ t: "wheel", d: Math.sign(e.deltaY) * -3 })}
          onContextMenu={(e) => e.preventDefault()}
          tabIndex={0}
          onKeyDown={(e) => {
            if (!control) return;
            e.preventDefault();
            sendInput({ t: "key", k: e.key, down: true });
          }}
          onKeyUp={(e) => control && sendInput({ t: "key", k: e.key, down: false })}
        />
        {showStats && (
          <div style={{ position: "absolute", top: 16, left: 16, background: "rgba(0,0,0,.72)", padding: "8px 12px", borderRadius: 8, fontSize: 13, fontFamily: "monospace" }}>
            RTT {stats.rtt}ms · {stats.fps}fps · {stats.bitrate}Mbps · jitter {stats.jitter}ms · {stats.state}
          </div>
        )}
        {status !== "live" && (
          <div className="muted" style={{ padding: 24, textAlign: "center" }}>
            {status === "idle" ? "Press Connect. Home PC must run: npm run dev + npm run agent + npm run desktop" : status}
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Click the video first so keystrokes go to the remote PC. Kill-switch in Files revokes everything instantly.
      </p>
    </main>
  );
}
