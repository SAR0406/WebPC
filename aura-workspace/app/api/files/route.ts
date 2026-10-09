import { NextRequest, NextResponse } from "next/server";
import { checkAccess } from "@/lib/guard";
import { getAgent } from "@/lib/files";

export async function GET(req: NextRequest) {
  const access = await checkAccess(req);
  if (!access) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") || "/";
  const q = url.searchParams.get("q") || "";
  try {
    const entries = await getAgent().listDir(rel, q);
    return NextResponse.json({ path: rel, entries });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "List failed." }, { status: 400 });
  }
}
