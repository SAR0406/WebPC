"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
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
      const pc = new RTCPeerConnection({ iceServers: STUN });
      pcRef.current = pc;
      pc.addTransceiver("video", { direction: "recvonly" });

      const dc = pc.createDataChannel("aura-input");
      dcRef.current = dc;
      dc.onopen = () => {
        setStatus("live");
        setProfile(qualityRef.current === "Auto" ? "720p" : qualityRef.current);
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
          {status === "live" ? <button className="danger" onClick={stop}>Disconnect</button>
            : <button onClick={start}>Connect</button>}
          <button className="ghost" onClick={() => router.push("/files")}>Files</button>
        </div>
      </div>

      {err && <p className="err">{err}</p>}

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
