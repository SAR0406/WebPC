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
type Zoom = "fit" | "one";

const glass: React.CSSProperties = {
  background: "rgba(16,22,34,.62)",
  backdropFilter: "blur(18px) saturate(1.5)",
  WebkitBackdropFilter: "blur(18px) saturate(1.5)",
  border: "1px solid rgba(255,255,255,.09)",
  boxShadow: "0 12px 40px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.08)",
};

const dockBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid transparent",
  color: "inherit",
  padding: "8px 12px",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export default function Desktop() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const codeRef = useRef("");
  const afterRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRef = useRef({ profile: "720p", goodStreak: 0 });
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");
  const [quality, setQuality] = useState<(typeof PROFILES)[number]>("Auto");
  const [liveProfile, setLiveProfile] = useState("720p");
  const [stats, setStats] = useState<Stats>({ rtt: 0, fps: 0, jitter: 0, bitrate: 0, state: "-" });
  const [showStats, setShowStats] = useState(true);
  const [control, setControl] = useState(true);
  const [clip, setClip] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [pinReq, setPinReq] = useState<{ salt: string; iters: number; nonce: string } | null>(null);
  const [pinErr, setPinErr] = useState("");
  const [verified, setVerified] = useState(false);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [isFs, setIsFs] = useState(false);
  const [vAspect, setVAspect] = useState("16 / 9");
  const verifiedRef = useRef(false);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  const live = status === "live";
  const active = live || status.startsWith("verifying") || status === "pin required";

  useEffect(() => {
    fetch("/api/auth/me").then((r) => {
      if (!r.ok) router.replace("/login");
    });
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
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
    setLiveProfile(p);
    sendInput({ t: "profile", name: toAgentName(p) });
  }

  function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => setErr("Fullscreen blocked by the browser."));
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
        if (pc.connectionState === "connected" && verifiedRef.current) setStatus("live");
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
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: isFs ? 0 : "20px" }}>
      {/* window bar */}
      {!isFs && (
        <div className="wrap" style={{ width: "100%", maxWidth: 1200, paddingBottom: 12 }}>
          <div className="card" style={{ ...glass, borderRadius: 16, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div className="row">
              <span style={{ display: "flex", gap: 6 }}>
                <i className={`dot ${live ? "ok" : "bad"}`} style={{ margin: 0, animation: live ? "pulse 1.6s infinite" : "none" }} />
              </span>
              <strong style={{ fontSize: 16, letterSpacing: ".2px" }}>Live Desktop</strong>
              <span className="muted" style={{ fontSize: 13 }}>
                {live ? `${liveProfile} · ${stats.rtt}ms · ${stats.fps}fps` : status}
              </span>
            </div>
            <div className="row">
              <select value={quality} onChange={(e) => {
                const q = e.target.value as typeof quality;
                setQuality(q);
                if (live && q !== "Auto") setProfile(q);
                if (q === "Auto") { autoRef.current.goodStreak = 0; }
              }} style={{ background: "rgba(255,255,255,.06)" }}>
                {PROFILES.map((p) => <option key={p} value={p}>{p === "Auto" ? "✨ Auto" : p}</option>)}
              </select>
              <button className="ghost" onClick={() => router.push("/files")}>Files</button>
              {active ? (
                <span className="row">
                  <button className="danger" onClick={stop}>Disconnect</button>
                  <button className="ghost" onClick={async () => { await stop(); await start(); }}>Reconnect</button>
                </span>
              ) : <button onClick={start}>Connect</button>}
            </div>
          </div>
        </div>
      )}

      {err && <div className="wrap" style={{ maxWidth: 1200, width: "100%" }}><p className="err">{err}</p></div>}

      {clip != null && !isFs && (
        <div className="wrap" style={{ maxWidth: 1200, width: "100%" }}>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>Remote clipboard</strong>
              <button className="ghost" onClick={() => setClip(null)}>Clear</button>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 140, overflow: "auto" }}>{clip || "(empty)"}</pre>
          </div>
        </div>
      )}

      {/* stage */}
      <div className="wrap" style={{ width: "100%", maxWidth: 1200, flex: 1, display: "flex", paddingBottom: isFs ? 0 : 20 }}>
        <div ref={stageRef} style={{
          ...glass, position: "relative", flex: 1, borderRadius: isFs ? 0 : 20, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#000", minHeight: isFs ? "100vh" : 420,
        }}>
          {active ? (
            <div style={{ width: "100%", height: isFs ? "100vh" : "72vh", overflow: zoom === "one" ? "auto" : "hidden", display: "flex", alignItems: zoom === "one" ? "flex-start" : "center", justifyContent: zoom === "one" ? "flex-start" : "center" }}>
              <video
                ref={videoRef}
                style={{
                  width: zoom === "one" ? "auto" : "100%",
                  height: zoom === "one" ? "auto" : "100%",
                  maxWidth: zoom === "one" ? "none" : "100%",
                  objectFit: "contain",
                  aspectRatio: zoom === "one" ? undefined : vAspect,
                  background: "#000",
                  cursor: control && live ? "none" : "default",
                }}
                playsInline
                muted
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth) setVAspect(`${v.videoWidth} / ${v.videoHeight}`);
                }}
                onMouseMove={(e) => control && live && sendInput({ t: "move", ...rel(e) })}
                onMouseDown={(e) => control && live && sendInput({ t: "down", b: e.button, ...rel(e) })}
                onMouseUp={(e) => control && live && sendInput({ t: "up", b: e.button, ...rel(e) })}
                onWheel={(e) => control && live && sendInput({ t: "wheel", d: Math.sign(e.deltaY) * -3 })}
                onContextMenu={(e) => e.preventDefault()}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (!control || !live) return;
                  e.preventDefault();
                  sendInput({ t: "key", k: e.key, down: true });
                }}
                onKeyUp={(e) => control && live && sendInput({ t: "key", k: e.key, down: false })}
              />
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 48 }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🖥️</div>
              <h2 style={{ margin: "0 0 8px" }}>Your PC, right here</h2>
              <p className="muted" style={{ margin: "0 0 20px" }}>Home PC must run: <code>npm run dev</code> + <code>npm run agent</code> + <code>npm run desktop</code></p>
              <button onClick={start} style={{ fontSize: 16, padding: "12px 32px" }}>Connect</button>
            </div>
          )}

          {showStats && active && (
            <div style={{ position: "absolute", top: 14, left: 14, ...glass, borderRadius: 12, padding: "8px 14px", fontSize: 12.5, fontFamily: "monospace", zIndex: 5 }}>
              {stats.rtt}ms · {stats.fps}fps · {stats.bitrate}Mbps · {stats.state}
            </div>
          )}

          {zoom === "one" && active && (
            <div style={{ position: "absolute", top: 14, right: 14, ...glass, borderRadius: 12, padding: "8px 14px", fontSize: 12.5, zIndex: 5 }}>
              1:1 — drag to pan
            </div>
          )}

          {/* glass dock */}
          {active && (
            <div style={{
              position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
              ...glass, borderRadius: 18, padding: "8px 10px", display: "flex", gap: 4, alignItems: "center",
              zIndex: 6, maxWidth: "96%", overflowX: "auto",
            }}>
              <button style={dockBtn} onClick={() => setZoom(zoom === "fit" ? "one" : "fit")} title="Toggle fit / 1:1 pixels">
                {zoom === "fit" ? "🔍 Fit" : "🔍 1:1"}
              </button>
              <button style={dockBtn} onClick={toggleFullscreen} title="Fullscreen (Esc exits)">
                {isFs ? "🗗 Exit" : "⛶ Full"}
              </button>
              <span style={{ width: 1, height: 22, background: "rgba(255,255,255,.12)" }} />
              <button style={{ ...dockBtn, opacity: control ? 1 : 0.55 }} onClick={() => setControl(!control)} title="Remote keyboard + mouse">
                {control ? "🖱️ On" : "🖱️ Off"}
              </button>
              <button style={dockBtn} onClick={() => sendInput({ t: "clip-get" })} title="Fetch remote clipboard">📋 ⬅</button>
              <button style={dockBtn} onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text) sendInput({ t: "clip-set", text: text.slice(0, 5000) });
                } catch {
                  const text = prompt("Text to type on the remote PC:");
                  if (text) sendInput({ t: "clip-set", text: text.slice(0, 5000) });
                }
              }} title="Type at the remote cursor">📋 ➡</button>
              <span style={{ width: 1, height: 22, background: "rgba(255,255,255,.12)" }} />
              <button style={dockBtn} onClick={() => setShowStats(!showStats)} title="Stats overlay">📊</button>
              <button style={{ ...dockBtn, color: "#ff8080" }} onClick={stop} title="End session">⏻</button>
            </div>
          )}
        </div>
      </div>

      {/* PIN modal */}
      {pinReq && !verified && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(4,8,16,.72)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <form onSubmit={submitPin} className="card" style={{ ...glass, width: 350, borderRadius: 20, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 36, textAlign: "center" }}>🔐</div>
            <h3 style={{ margin: "8px 0 4px", textAlign: "center" }}>Host PIN</h3>
            <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>This PC is locked. It never leaves this browser in plaintext.</p>
            <input type="password" placeholder="••••••" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus style={{ width: "100%", marginBottom: 10, textAlign: "center", fontSize: 20, letterSpacing: 6 }} />
            <label className="row muted" style={{ fontSize: 13, marginBottom: 12, justifyContent: "center" }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 16 }} />
              Remember this device
            </label>
            <button style={{ width: "100%" }}>Unlock</button>
            {pinErr && <p className="err" style={{ textAlign: "center" }}>{pinErr}</p>}
            <p className="row" style={{ marginTop: 10, justifyContent: "center" }}>
              <button type="button" className="ghost" onClick={stop}>Cancel</button>
            </p>
          </form>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }`}</style>
    </main>
  );
}
