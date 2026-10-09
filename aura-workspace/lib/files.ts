import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type FileEntry = {
  name: string;
  type: "dir" | "file";
  size: number;
  mtime: string;
};

// Agent abstraction: v0.1 uses LocalAgent. v0.2+ can add RemoteAgent
// without changing the Gateway routes.
export interface AgentClient {
  readonly kind: string;
  listDir(rel: string, query?: string): Promise<FileEntry[]>;
  readFile(rel: string): Promise<{ abs: string; size: number }>;
}

export function vaultRoot(): string {
  const v = process.env.AURA_VAULT || "./vault";
  const abs = path.resolve(process.cwd(), v);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

// Resolve user-supplied relative path strictly inside vault.
// Throws on traversal, absolute paths, or symlink escape.
export async function resolveSafePath(rel: string): Promise<string> {
  const root = vaultRoot();
  const cleaned = (rel || "/").replace(/\\/g, "/");
  if (cleaned.includes("\0")) throw new Error("Bad path.");
  // Strip leading slashes, resolve against root
  const relPart = cleaned.replace(/^\/+/, "").replace(/^(\.\/)+/, "");
  if (/(^|\/)\.\.(\/|$)/.test(relPart)) throw new Error("Path escapes vault.");
  const abs = path.resolve(root, relPart || ".");
  const rootReal = await fsp.realpath(root);
  // abs may not exist yet (upload target); check nearest existing parent
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) {
    probe = path.dirname(probe);
  }
  const probeReal = await fsp.realpath(probe);
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (probeReal !== rootReal && !probeReal.startsWith(rootWithSep)) {
    throw new Error("Path escapes vault.");
  }
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    // abs doesn't exist yet but must still be under root
    throw new Error("Path escapes vault.");
  }
  // If target exists and is symlink, resolve and re-check
  if (fs.existsSync(abs)) {
    const st = await fsp.lstat(abs);
    if (st.isSymbolicLink()) {
      const real = await fsp.realpath(abs);
      if (real !== rootReal && !real.startsWith(rootWithSep)) {
        throw new Error("Link escapes vault.");
      }
      return real;
    }
  }
  return abs;
}

export const LocalAgent: AgentClient = {
  kind: "local",
  async listDir(rel: string, query?: string): Promise<FileEntry[]> {
    const abs = await resolveSafePath(rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st || !st.isDirectory()) throw new Error("Folder not found.");
    const names = await fsp.readdir(abs);
    const q = (query || "").toLowerCase().trim();
    const max = Number(process.env.AURA_MAX_LIST || 500);
    const out: FileEntry[] = [];
    for (const name of names) {
      if (name === ".keep") continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      const child = path.join(abs, name);
      let s;
      try {
        s = await fsp.stat(child);
      } catch {
        continue;
      }
      // Skip symlinks that escape (defense in depth)
      if (s.isSymbolicLink()) continue;
      out.push({
        name,
        type: s.isDirectory() ? "dir" : "file",
        size: s.isDirectory() ? 0 : s.size,
        mtime: s.mtime.toISOString(),
      });
      if (out.length >= max) break;
    }
    out.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1
    );
    return out;
  },
  async readFile(rel: string) {
    const abs = await resolveSafePath(rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st || !st.isFile()) throw new Error("File not found.");
    const maxBytes = 500 * 1024 * 1024;
    if (st.size > maxBytes) throw new Error("File too large to download.");
    return { abs, size: st.size };
  },
};

export function getAgent(): AgentClient {
  return LocalAgent;
}
