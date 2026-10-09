import { NextRequest, NextResponse } from "next/server";
import fsp from "node:fs/promises";
import path from "node:path";
import { checkAccess } from "@/lib/guard";
import { resolveSafePath, vaultRoot } from "@/lib/files";

// Recursive filename index across the vault (no daemon, built per query).
// Caps keep the i3 happy: max depth 6, 5000 files, 2s budget.
export async function GET(req: NextRequest) {
  const access = await checkAccess(req);
  if (!access) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") || "").toLowerCase().trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  const root = vaultRoot();
  const results: { path: string; type: string; size: number }[] = [];
  const deadline = Date.now() + 2000;
  let scanned = 0;

  async function walk(dirAbs: string, rel: string, depth: number): Promise<void> {
    if (depth > 6 || results.length >= 100 || scanned > 5000 || Date.now() > deadline) return;
    let names: string[];
    try {
      names = await fsp.readdir(dirAbs);
    } catch {
      return;
    }
    for (const name of names) {
      if (results.length >= 100 || scanned > 5000 || Date.now() > deadline) return;
      if (name.startsWith(".")) continue;
      scanned++;
      const child = path.join(dirAbs, name);
      let st;
      try {
        st = await fsp.stat(child);
        if (st.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const childRel = (rel === "/" ? `/${name}` : `${rel}/${name}`).replace(/\\/g, "/");
      if (name.toLowerCase().includes(q)) {
        results.push({ path: childRel, type: st.isDirectory() ? "dir" : "file", size: st.isDirectory() ? 0 : st.size });
      }
      if (st.isDirectory()) await walk(child, childRel, depth + 1);
    }
  }

  // stay strictly inside vault
  const abs = await resolveSafePath("/").catch(() => null);
  if (!abs) return NextResponse.json({ error: "Vault unavailable." }, { status: 500 });
  await walk(root, "/", 0);
  return NextResponse.json({ results, scanned });
}
