import { store } from "./store";

export type CurrentUser = {
  id: number;
  username: string;
  sessionId: string;
  deviceLabel: string;
};

export async function getUserBySession(
  token: string | undefined | null
): Promise<CurrentUser | null> {
  if (!token) return null;
  let sess;
  try {
    sess = await store.getSession(token);
  } catch {
    return null;
  }
  if (!sess) return null;
  if (sess.revoked_at) return null;
  if (new Date(sess.expires_at).getTime() < Date.now()) return null;
  const username = await store.getUsername(sess.user_id).catch(() => null);
  if (!username) return null;
  return {
    id: sess.user_id,
    username,
    sessionId: sess.id,
    deviceLabel: sess.device_label,
  };
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
