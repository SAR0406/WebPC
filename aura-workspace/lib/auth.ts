import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = "aura_session";
export const SESSION_HOURS = Number(process.env.AURA_SESSION_HOURS || 12);

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  if (password.length < 10) throw new Error("Password must be at least 10 characters.");
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
}

export function deviceLabel(ua: string): string {
  const s = (ua || "").slice(0, 120);
  if (/mobile|android/i.test(s)) return `Mobile · ${s.slice(0, 40)}`;
  if (/windows/i.test(s)) return `Windows · ${s.slice(0, 40)}`;
  if (/macintosh/i.test(s)) return `Mac · ${s.slice(0, 40)}`;
  if (/linux/i.test(s)) return `Linux · ${s.slice(0, 40)}`;
  return s ? s.slice(0, 60) : "Unknown device";
}
