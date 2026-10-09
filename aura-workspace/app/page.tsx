"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [msg, setMsg] = useState("Connecting to your home PC…");
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? router.replace("/files") : router.replace("/login")))
      .catch(() => setMsg("Home PC is offline. Start it with `npm run dev` and reopen this page."));
  }, [router]);
  return (
    <main className="wrap">
      <div className="card">
        <h1>AURA Workspace</h1>
        <p className="muted">{msg}</p>
      </div>
    </main>
  );
}
