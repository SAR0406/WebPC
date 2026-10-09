"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Entry = { name: string; type: "dir" | "file"; size: number; mtime: string };

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function joinPath(base: string, name: string) {
  if (base === "/") return `/${name}`;
  return `${base}/${name}`;
}

// On Vercel (NEXT_PUBLIC_CLOUD=1) file traffic goes through /api/remote/*,
// which proxies to the home PC over its tunnel. Locally it hits /api/* direct.
const CLOUD = process.env.NEXT_PUBLIC_CLOUD === "1";
const FILES_API = CLOUD ? "/api/remote/files" : "/api/files";
const STATUS_API = CLOUD ? "/api/remote/status" : "/api/agent/status";

export default function Files() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [status, setStatus] = useState<any>(null);
  const [path, setPath] = useState("/");
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) return router.replace("/login");
      const j = await r.json();
      setUser(j.user.username);
    });
    fetch(STATUS_API)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ online: false }));
    load("/", "").catch((e) => setErr(e.message));
    const t = setInterval(() => {
      fetch(STATUS_API).then((r) => r.json()).then(setStatus).catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, [load, router]);

  useEffect(() => {
    const t = setTimeout(() => load(path, q).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [path, q, load]);

  async function download(name: string) {
    setErr("");
    const p = joinPath(path, name);
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
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(`${FILES_API}/upload?path=${encodeURIComponent(path)}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed.");
      await load(path, q);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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

  const crumbs = path.split("/").filter(Boolean);

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="row">
          <span className={`dot ${status?.online ? "ok" : "bad"}`} />
          <strong>AURA</strong>
          <span className="muted">{status?.online ? `Online · ${status.host}` : "Offline"}</span>
        </div>
        <div className="row">
          <span className="muted">{user}</span>
          <button className="ghost" onClick={logout}>Log out</button>
          <button className="danger" onClick={killSwitch}>Kill switch</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="crumb">
            <button className="ghost" onClick={() => setPath("/")}>vault /</button>
            {crumbs.map((c, i) => (
              <button
                key={i}
                className="ghost"
                onClick={() => setPath("/" + crumbs.slice(0, i + 1).join("/"))}
              >
                {c} /
              </button>
            ))}
          </div>
          <input placeholder="Search filenames…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
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
                    : <button onClick={() => download(e.name)}>Download</button>}
                </td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={4} className="muted">Empty folder.</td></tr>}
          </tbody>
        </table>

        <form onSubmit={upload} className="row" style={{ marginTop: 16 }}>
          <input type="file" ref={fileRef} />
          <button disabled={busy}>{busy ? "Uploading…" : "Upload here"}</button>
        </form>
        <p className="muted" style={{ fontSize: 13 }}>
          Vault on host: <code>{status?.vault || "…"}</code> · {status?.freememMB ? `${status.freememMB}MB free RAM` : ""} ·
          Live desktop + JARVIS land in 0.2–0.4. This slice proves auth → list → download.
        </p>
      </div>
    </main>
  );
}
