// Tiny in-memory login rate limiter. Resets on restart (fine for v0.1 single host).
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max = 5, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now > cur.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  cur.count += 1;
  return cur.count <= max;
}

export function rateRemaining(key: string, max = 5): number {
  const cur = hits.get(key);
  if (!cur) return max;
  return Math.max(0, max - cur.count);
}
