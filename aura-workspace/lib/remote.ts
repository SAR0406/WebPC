import { store, type AgentRow } from "./store";

export const AGENT_TIMEOUT_MS = 75_000; // heartbeat freshness window

export async function getOnlineAgent(userId: number): Promise<AgentRow | null> {
  let row: AgentRow | null = null;
  try {
    row = await store.getAgent(userId);
  } catch {
    return null;
  }
  if (!row?.url) return null;
  if (Date.now() - new Date(row.last_seen).getTime() > AGENT_TIMEOUT_MS) return null;
  if (!/^https:\/\//.test(row.url)) return null; // tunnel URLs are always https
  return row;
}

export function agentSecret(): string {
  const s = process.env.AGENT_SECRET || "";
  if (!s) throw new Error("Agent link not configured (AGENT_SECRET missing).");
  return s;
}
