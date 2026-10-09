import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { checkAccess } from "@/lib/guard";
import { resolveSafePath } from "@/lib/files";

// Inline preview for safe types only (pdf, images, plain text).
// Everything else must use /download (attachment). Never sniffed as HTML.
const INLINE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json",
};

export async function GET(req: NextRequest) {
  const access = await checkAccess(req);
  if (!access) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const rel = new URL(req.url).searchParams.get("path") || "";
  if (!rel || rel === "/") return NextResponse.json({ error: "Pick a file." }, { status: 400 });
  try {
    const abs = await resolveSafePath(rel);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error("Not a file.");
    const ext = path.extname(abs).toLowerCase();
    const mime = INLINE[ext];
    if (!mime) return NextResponse.json({ error: "No preview for this type. Download it.", preview: false }, { status: 415 });
    if (st.size > 30 * 1024 * 1024) {
      return NextResponse.json({ error: "Too large to preview. Download it.", preview: false }, { status: 413 });
    }
    const buf = fs.readFileSync(abs);
    return new NextResponse(buf as any, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(st.size),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Preview failed." }, { status: 404 });
  }
}
