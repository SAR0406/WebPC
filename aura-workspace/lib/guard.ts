import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "./auth";
import { getUserBySession, type CurrentUser } from "./session";

export type Access = { user: CurrentUser } | { agent: true };

// Gate for endpoints served by the HOME gateway that the Vercel app may
// call through the tunnel. Allowed when EITHER:
//  - x-aura-agent-secret matches AGENT_SECRET (Vercel proxy → home), OR
//  - a valid login session cookie exists (local dashboard use).
// If AGENT_SECRET is unset (plain local dev), session cookie alone suffices.
export async function checkAccess(req: NextRequest): Promise<Access | null> {
  const configured = process.env.AGENT_SECRET || "";
  const got = req.headers.get("x-aura-agent-secret") || "";
  if (configured && got) {
    const a = crypto.createHash("sha256").update(got).digest();
    const b = crypto.createHash("sha256").update(configured).digest();
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { agent: true };
    }
  }
  const user = await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return { user };
  return null;
}
