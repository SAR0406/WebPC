import { getDb } from "./db";

export type CurrentUser = {
  id: number;
  username: string;
  sessionId: string;
  deviceLabel: string;
};

export function getUserBySession(token: string | undefined | null): CurrentUser | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id as sid, s.user_id, s.expires_at, s.revoked_at, s.device_label, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
    )
    .get(token) as any;
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.user_id, username: row.username, sessionId: row.sid, deviceLabel: row.device_label };
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
