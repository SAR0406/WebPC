"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/init")
      .then((r) => r.json())
      .then((j) => setInitialized(!!j.initialized))
      .catch(() => setInitialized(true));
    fetch("/api/auth/me").then((r) => {
      if (r.ok) router.replace("/files");
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const endpoint = initialized ? "/api/auth/login" : "/api/auth/init";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed.");
      router.replace("/files");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <div className="card" style={{ maxWidth: 440, margin: "8vh auto" }}>
        <h1 style={{ marginTop: 0 }}>AURA Workspace</h1>
        <p className="muted">
          {initialized === false
            ? "First run: create your local admin. No Google login."
            : "Log in from any computer. Nothing to install."}
        </p>
        <form onSubmit={submit} className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <input
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
          <input
            placeholder={initialized === false ? "new password (10+ chars)" : "password"}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={initialized === false ? "new-password" : "current-password"}
            required
          />
          <button disabled={busy || initialized === null}>
            {busy ? "Working…" : initialized === false ? "Create admin" : "Log in"}
          </button>
        </form>
        {err && <p className="err">{err}</p>}
        <p className="muted" style={{ fontSize: 13 }}>
          v0.1 vertical slice: password auth, vault files, kill-switch. TOTP lands in 0.1.x.
        </p>
      </div>
    </main>
  );
}
