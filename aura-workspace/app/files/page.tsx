"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Entry = { name: string; type: "dir" | "file"; size: number; mtime: string };
type Pin = { id: number; label: string; path: string };
type IdxHit = { path: string; type: string; size: number };

// On Vercel (NEXT_PUBLIC_CLOUD=1) traffic goes through /api/remote/* (home tunnel).
const CLOUD = process.env.NEXT_PUBLIC_CLOUD === "1";
const FILES_API = CLOUD ? "/api/remote/files" : "/api/files";
const STATUS_API = CLOUD ? "/api/remote/status" : "/api/agent/status";
const PREVIEW_API = CLOUD ? "/api/remote/files/preview" : "/api/files/preview";

async function api(path: string, init?: RequestInit) {
  // local: direct API. cloud: JSON calls ride /api/remote/exec?to=...
  if (!CLOUD) return fetch(path, init);
  const url = new URL(path, window.location.origin);
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET") {
    const pass = new URLSearchParams();
    url.searchParams.forEach((v, k) => pass.set(k, v));
    return fetch(`/api/remote/exec?to=${encodeURIComponent(url.pathname)}&${pass}`, init);
  }
  if (method === "DELETE") {
    return fetch(`/api/remote/exec?to=${encodeURIComponent(url.pathname)}&id=${encodeURIComponent(url.searchParams.get("id") || "")}`, init);
  }
  return fetch(`/api/remote/exec?to=${encodeURIComponent(url.pathname)}`, init);
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function joinPath(base: string, name: string) {
  if (base === "/") return `/${name}`;
  return `${base}/${name}`;
}

export default function Files() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<any>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [path, setPath] = useState("/");
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [upPct, setUpPct] = useState<number | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [preview, setPreview] = useState<{ path: string; url: string; kind: string } | null>(null);
  const [deck, setDeck] = useState("");
  const [hits, setHits] = useState<IdxHit[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (p: string, query: string) => {
    setErr("");
    const r = await fetch(`${FILES_API}?path=${encodeURIComponent(p)}&q=${encodeURIComponent(query)}`);
    const j = await r.json();
    if (!r.ok) {
      if (r.status === 401) router.replace("/login");
      throw new Error(j.error || "List failed.");
    }
    setEntries(j.entries);
  }, [router]);

  const refreshStatus = useCallback(async () => {
    const t = performance.now();
    try {
      const r = await fetch(STATUS_API);
      setPingMs(Math.round(performance.now() - t));
      setStatus(await r.json());
    } catch {
      setStatus({ online: false });
    }
  }, []);

  const loadPins = useCallback(async () => {
    try {
      const r = await api("/api/pins");
      if (r.ok) setPins((await r.json()).pins || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) return router.replace("/login");
      const j = await r.json();
      setUser(j.user.username);
      setExpiresAt(j.user.expires_at || null);
    });
    refreshStatus();
    load("/", "").catch((e) => setErr(e.message));
    loadPins();
    const t = setInterval(refreshStatus, 15000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [load, loadPins, refreshStatus, router]);

  useEffect(() => {
    const t = setTimeout(() => load(path, q).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [path, q, load]);

  // auto logout when the session expires (school mode)
  useEffect(() => {
    if (expiresAt && new Date(expiresAt).getTime() <= now) router.replace("/login");
  }, [expiresAt, now, router]);

  async function downloadByPath(p: string, name: string) {
    setErr("");
    const r = await fetch(`${FILES_API}/download?path=${encodeURIComponent(p)}`);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || "Download failed.");
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    setUpPct(0);
    setErr("");
    try {
      if (f.size > 8 * 1024 * 1024) {
        // resumable chunked upload, 1MB chunks
        const CH = 1024 * 1024;
        const chunks = Math.ceil(f.size / CH);
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        for (let i = 0; i < chunks; i++) {
          const part = f.slice(i * CH, (i + 1) * CH);
          const qs = new URLSearchParams({ path, name: f.name, chunk: String(i), chunks: String(chunks), id });
          const r = await fetch(`${FILES_API}/upload?${qs}`, { method: "POST", body: part });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `Chunk ${i} failed. Retry — resume is automatic.`);
          setUpPct(Math.round(((i + 1) / chunks) * 100));
        }
      } else {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch(`${FILES_API}/upload?path=${encodeURIComponent(path)}`, { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Upload failed.");
      }
      await load(path, q);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setUpPct(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function openPreview(p: string) {
    setErr("");
    const r = await fetch(`${PREVIEW_API}?path=${encodeURIComponent(p)}`);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || "No preview. Download it instead.");
      return;
    }
    const blob = await r.blob();
    const kind = blob.type.startsWith("image/") ? "img" : blob.type === "application/pdf" ? "pdf" : "text";
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview({ path: p, url: URL.createObjectURL(blob), kind });
  }

  async function indexSearch(query: string) {
    const r = await api(`/api/files/index?q=${encodeURIComponent(query)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Search failed.");
    return (j.results || []) as IdxHit[];
  }

  // --- command deck: intent-first, read-only except explicit mkdir/rename ---
  async function runDeck(e: React.FormEvent) {
    e.preventDefault();
    const raw = deck.trim();
    if (!raw) return;
    setErr("");
    setHits(null);
    const [verb, ...rest] = raw.split(/\s+/);
    const arg = rest.join(" ").trim();
    try {
      switch (verb.toLowerCase()) {
        case "find": {
          if (!arg) throw new Error("Usage: find physics notes");
          setHits(await indexSearch(arg));
          break;
        }
        case "open": {
          if (!arg) throw new Error("Usage: open physics notes");
          const r = await indexSearch(arg);
          if (!r.length) throw new Error("Nothing found.");
          const top = r[0];
          if (top.type === "dir") {
            setPath(top.path);
          } else {
            await openPreview(top.path);
          }
          setHits(r);
          break;
        }
        case "download":
        case "get": {
          if (!arg) throw new Error("Usage: download backup.zip");
          const r = await indexSearch(arg);
          const file = r.find((h) => h.type === "file");
          if (!file) throw new Error("No file found.");
          await downloadByPath(file.path, file.path.split("/").pop() || "file");
          break;
        }
        case "desktop":
        case "screen":
          router.push("/desktop");
          break;
        case "pin": {
          const label = arg || path.split("/").pop() || "vault";
          const r = await api("/api/pins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label, path }),
          });
          if (!r.ok) throw new Error("Pin failed.");
          await loadPins();
          break;
        }
        case "mkdir": {
          if (!arg) throw new Error("Usage: mkdir projects");
          const r = await api("/api/files/manage?action=mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dir: path, name: arg }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "mkdir failed.");
          await load(path, q);
          break;
        }
        case "rename": {
          const [from, to] = arg.split(/\s+/);
          if (!from || !to) throw new Error("Usage: rename old new");
          const r = await api("/api/files/manage?action=rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dir: path, from, name: to }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "rename failed.");
          await load(path, q);
          break;
        }
        case "status":
          await refreshStatus();
          break;
        default:
          setQ(raw);
      }
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  async function killSwitch() {
    if (!confirm("Revoke ALL sessions on every device? You will be logged out.")) return;
    await fetch("/api/auth/revoke-all", { method: "POST" });
    router.replace("/login");
  }

  async function schoolMode() {
    const r = await fetch("/api/auth/shorten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: 30 }),
    });
    if (r.ok) {
      const me = await fetch("/api/auth/me").then((x) => x.json());
      setExpiresAt(me.user.expires_at);
    }
  }

  const crumbs = path.split("/").filter(Boolean);
  const remainMs = expiresAt ? new Date(expiresAt).getTime() - now : null;
  const remain = remainMs == null ? null : `${Math.floor(remainMs / 60000)}:${String(Math.floor((remainMs % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="row">
          <span className={`dot ${status?.online ? "ok" : "bad"}`} />
          <strong>AURA</strong>
          <span className="muted">
            {status?.online ? `Online · ${status.host}` : "Offline"}
            {pingMs != null ? ` · ${pingMs}ms` : ""}
          </span>
        </div>
        <div className="row">
          <span className="muted">{user}{remain ? ` · ${remain}` : ""}</span>
          <button className="ghost" onClick={() => router.push("/desktop")}>Desktop</button>
          <button className="ghost" onClick={schoolMode} title="Shrink this session to 30 minutes">School 30m</button>
          <button className="ghost" onClick={logout}>Log out</button>
          <button className="danger" onClick={killSwitch}>Kill switch</button>
        </div>
      </div>

      <form onSubmit={runDeck} className="row" style={{ marginBottom: 14 }}>
        <input
          placeholder='Command deck: find physics · open notes · download backup · desktop · mkdir x'
          value={deck}
          onChange={(e) => setDeck(e.target.value)}
          style={{ flex: 1 }}
        />
        <button>Run</button>
      </form>

      {hits && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Search results ({hits.length})</strong>
            <button className="ghost" onClick={() => setHits(null)}>Clear</button>
          </div>
          <table>
            <tbody>
              {hits.map((h) => (
                <tr key={h.path}>
                  <td>{h.type === "dir" ? "📁" : "📄"} <code>{h.path}</code></td>
                  <td>
                    {h.type === "dir"
                      ? <button className="ghost" onClick={() => { setPath(h.path); setHits(null); }}>Open</button>
                      : <span className="row">
                        <button className="ghost" onClick={() => openPreview(h.path)}>Preview</button>
                        <button onClick={() => downloadByPath(h.path, h.path.split("/").pop() || "file")}>Download</button>
                      </span>}
                  </td>
                </tr>
              ))}
              {hits.length === 0 && <tr><td className="muted">No matches anywhere in the vault.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pins.length > 0 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="muted">Pinned:</span>
          {pins.map((p) => (
            <span key={p.id} className="row">
              <button className="ghost" onClick={() => setPath(p.path)}>📌 {p.label}</button>
              <button className="ghost" onClick={async () => {
                await api(`/api/pins?id=${p.id}`, { method: "DELETE" });
                await loadPins();
              }}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="crumb">
            <button className="ghost" onClick={() => setPath("/")}>vault /</button>
            {crumbs.map((c, i) => (
              <button key={i} className="ghost" onClick={() => setPath("/" + crumbs.slice(0, i + 1).join("/"))}>
                {c} /
              </button>
            ))}
          </div>
          <input placeholder="Filter this folder…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        </div>

        {err && <p className="err">{err}</p>}

        <table>
          <thead><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead>
          <tbody>
            {path !== "/" && (
              <tr>
                <td><button className="ghost" onClick={() => setPath("/" + crumbs.slice(0, -1).join("/"))}>.. up</button></td>
                <td colSpan={3} className="muted">parent folder</td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.name}>
                <td>{e.type === "dir" ? `📁 ${e.name}` : `📄 ${e.name}`}</td>
                <td className="muted">{e.type === "dir" ? "—" : fmtSize(e.size)}</td>
                <td className="muted">{new Date(e.mtime).toLocaleString()}</td>
                <td>
                  {e.type === "dir"
                    ? <button className="ghost" onClick={() => setPath(joinPath(path, e.name))}>Open</button>
                    : <span className="row">
                      <button className="ghost" onClick={() => openPreview(joinPath(path, e.name))}>Preview</button>
                      <button onClick={() => downloadByPath(joinPath(path, e.name), e.name)}>Download</button>
                    </span>}
                </td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={4} className="muted">Empty folder.</td></tr>}
          </tbody>
        </table>

        <form onSubmit={upload} className="row" style={{ marginTop: 16 }}>
          <input type="file" ref={fileRef} />
          <button disabled={busy}>{busy ? `Uploading… ${upPct ?? 0}%` : "Upload here"}</button>
        </form>
        <p className="muted" style={{ fontSize: 13 }}>
          Vault on host: <code>{status?.vault || "…"}</code> · {status?.freememMB ? `${status.freememMB}MB free RAM` : ""} ·
          Uploads over 8MB resume automatically in 1MB chunks.
        </p>
      </div>

      {preview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
          onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>
          <div className="card" style={{ maxWidth: 900, width: "100%", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <code>{preview.path}</code>
              <span className="row">
                <button onClick={() => downloadByPath(preview.path, preview.path.split("/").pop() || "file")}>Download</button>
                <button className="ghost" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>Close</button>
              </span>
            </div>
            {preview.kind === "img" && <img src={preview.url} style={{ maxWidth: "100%" }} alt="preview" />}
            {preview.kind === "pdf" && <embed src={preview.url} type="application/pdf" style={{ width: "100%", height: "70vh" }} />}
            {preview.kind === "text" && <TextPreview url={preview.url} />}
          </div>
        </div>
      )}
    </main>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState("Loading…");
  useEffect(() => {
    fetch(url).then((r) => r.text()).then((t) => setText(t.slice(0, 200000))).catch(() => setText("Failed to load."));
  }, [url]);
  return <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{text}</pre>;
}
