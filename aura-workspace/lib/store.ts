// Cloud store: Supabase PostgREST over fetch. No local files, no native
// modules — safe on Vercel serverless and shared between the Vercel app
// and the home-PC gateway. Keys stay in server env vars (never NEXT_PUBLIC).

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}. See .env.example.`);
  return v;
}

function base(): string {
  return env("SUPABASE_URL").replace(/\/$/, "") + "/rest/v1";
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: env("SUPABASE_ANON_KEY"),
    Authorization: `Bearer ${env("SUPABASE_ANON_KEY")}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sb<T = any>(
  path: string,
  opts: { method?: string; body?: any; prefer?: string } = {}
): Promise<T> {
  const res = await fetch(base() + path, {
    method: opts.method || "GET",
    headers: headers(opts.prefer ? { Prefer: opts.prefer } : {}),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Store error ${res.status}: ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

export type UserRow = {
  id: number;
  username: string;
  pass_hash: string;
  pass_salt: string;
  created_at: string;
};

export type SessionRow = {
  id: string;
  user_id: number;
  device_label: string;
  ip: string;
  ua: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type AgentRow = {
  user_id: number;
  url: string;
  secret_hash: string;
  host: string;
  last_seen: string;
  created_at: string;
};

export const store = {
  async countUsers(): Promise<number> {
    const res = await fetch(base() + "/aura_users?select=id", {
      headers: { ...headers(), Prefer: "count=exact" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Store error ${res.status}`);
    const range = res.headers.get("content-range"); // "0-4/5"
    const total = range?.split("/")[1];
    return total && total !== "*" ? Number(total) : 0;
  },

  async findUserByUsername(username: string): Promise<UserRow | null> {
    const rows = await sb<UserRow[]>(
      `/aura_users?username=eq.${encodeURIComponent(username)}&select=id,username,pass_hash,pass_salt,created_at&limit=1`
    );
    return rows[0] || null;
  },

  async createUser(username: string, hash: string, salt: string): Promise<UserRow> {
    const rows = await sb<UserRow[]>("/aura_users", {
      method: "POST",
      prefer: "return=representation",
      body: { username, pass_hash: hash, pass_salt: salt },
    });
    if (!rows[0]) throw new Error("User insert failed.");
    return rows[0];
  },

  async insertDevice(d: {
    user_id: number;
    label: string;
    ip: string;
    ua: string;
    status: string;
  }): Promise<void> {
    await sb("/aura_devices", { method: "POST", body: d });
  },

  async createSession(s: {
    id: string;
    user_id: number;
    device_label: string;
    ip: string;
    ua: string;
    expires_at: string;
  }): Promise<void> {
    await sb("/aura_sessions", { method: "POST", body: s });
  },

  async getSession(id: string): Promise<SessionRow | null> {
    const rows = await sb<SessionRow[]>(
      `/aura_sessions?id=eq.${encodeURIComponent(id)}&select=id,user_id,device_label,expires_at,revoked_at&limit=1`
    );
    return rows[0] || null;
  },

  async getUsername(userId: number): Promise<string | null> {
    const rows = await sb<{ username: string }[]>(
      `/aura_users?id=eq.${userId}&select=username&limit=1`
    );
    return rows[0]?.username || null;
  },

  async revokeSession(id: string): Promise<void> {
    await sb(`/aura_sessions?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { revoked_at: new Date().toISOString() },
    });
  },

  async revokeAllSessions(userId: number): Promise<void> {
    await sb(
      `/aura_sessions?user_id=eq.${userId}&revoked_at=is.null`,
      { method: "PATCH", body: { revoked_at: new Date().toISOString() } }
    );
  },

  async listDevices(userId: number): Promise<any[]> {
    return sb(
      `/aura_devices?user_id=eq.${userId}&select=id,label,ip,status,created_at&order=id.desc&limit=20`
    );
  },

  async listSessions(userId: number): Promise<any[]> {
    return sb(
      `/aura_sessions?user_id=eq.${userId}&select=id,device_label,ip,created_at,expires_at,revoked_at&order=created_at.desc&limit=20`
    );
  },

  async upsertAgent(a: {
    user_id: number;
    url: string;
    secret_hash: string;
    host: string;
  }): Promise<void> {
    await sb("/aura_agents", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { ...a, last_seen: new Date().toISOString() },
    });
  },

  async heartbeat(userId: number, url: string): Promise<void> {
    await sb(`/aura_agents?user_id=eq.${userId}`, {
      method: "PATCH",
      body: { url, last_seen: new Date().toISOString() },
    });
  },

  async getAgent(userId: number): Promise<AgentRow | null> {
    const rows = await sb<AgentRow[]>(`/aura_agents?user_id=eq.${userId}&limit=1`);
    return rows[0] || null;
  },

  async deleteAgent(userId: number): Promise<void> {
    await sb(`/aura_agents?user_id=eq.${userId}`, { method: "DELETE" }).catch(() => null);
  },

  async postSignal(s: { code: string; user_id: number; kind: string; payload: string }): Promise<void> {
    await sb("/aura_signals", { method: "POST", body: s });
  },

  async getSignals(code: string, userId: number, afterId = 0): Promise<any[]> {
    return sb(
      `/aura_signals?code=eq.${encodeURIComponent(code)}&user_id=eq.${userId}&id=gt.${afterId}&select=id,kind,payload,created_at&order=id.asc&limit=100`
    );
  },

  async deleteSignals(code: string, userId: number): Promise<void> {
    await sb(`/aura_signals?code=eq.${encodeURIComponent(code)}&user_id=eq.${userId}`, {
      method: "DELETE",
    }).catch(() => null);
  },

  async listPins(userId: number): Promise<any[]> {
    return sb(`/aura_pins?user_id=eq.${userId}&select=id,label,path,created_at&order=id.asc&limit=50`);
  },

  async addPin(userId: number, label: string, p: string): Promise<void> {
    await sb("/aura_pins", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: userId, label: label.slice(0, 80), path: p.slice(0, 500) },
    });
  },

  async deletePin(userId: number, id: number): Promise<void> {
    await sb(`/aura_pins?user_id=eq.${userId}&id=eq.${id}`, { method: "DELETE" }).catch(() => null);
  },

  async shortenSession(sessionId: string, userId: number, minutes: number): Promise<void> {
    const exp = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    await sb(`/aura_sessions?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${userId}`, {
      method: "PATCH",
      body: { expires_at: exp },
    });
  },

  async getHostPin(userId: number): Promise<{ salt: string; verifier: string; iters: number } | null> {
    const rows = await sb<any[]>(`/aura_host_pin?user_id=eq.${userId}&select=salt,verifier,iters&limit=1`);
    return rows[0] || null;
  },

  async setHostPin(userId: number, salt: string, verifier: string, iters: number): Promise<void> {
    await sb("/aura_host_pin", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: userId, salt, verifier, iters, updated_at: new Date().toISOString() },
    });
  },

  async addPairing(userId: number, tokenHash: string, label: string): Promise<void> {
    await sb("/aura_pairings", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: userId, token_hash: tokenHash, label: label.slice(0, 80) },
    });
  },

  async findPairing(userId: number, tokenHash: string): Promise<boolean> {
    const rows = await sb<any[]>(
      `/aura_pairings?user_id=eq.${userId}&token_hash=eq.${encodeURIComponent(tokenHash)}&select=id&limit=1`
    );
    return (rows || []).length > 0;
  },

  async deletePairings(userId: number): Promise<void> {
    await sb(`/aura_pairings?user_id=eq.${userId}`, { method: "DELETE" }).catch(() => null);
  },

  audit(action: string, detail = "", userId: number | null = null, ip = ""): void {
    // Fire-and-forget: audit must never break requests.
    sb("/aura_audit", {
      method: "POST",
      body: { user_id: userId, action, detail: detail.slice(0, 2000), ip },
    }).catch(() => {});
  },
};
