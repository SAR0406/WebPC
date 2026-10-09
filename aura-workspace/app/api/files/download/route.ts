import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession, clientIp } from "@/lib/session";
import { checkAccess } from "@/lib/guard";
import { getAgent } from "@/lib/files";
import { store } from "@/lib/store";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

export async function GET(req: NextRequest) {
  const access = await checkAccess(req);
  if (!access) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") || "";
  if (!rel || rel === "/") {
    return NextResponse.json({ error: "Pick a file, not a folder." }, { status: 400 });
  }
  try {
    const { abs, size } = await getAgent().readFile(rel);
    const name = path.basename(abs);
    const ext = path.extname(name).toLowerCase();
    // Resumable downloads: honor Range so broken school Wi-Fi can resume.
    let start = 0;
    let end = size - 1;
    let partial = false;
    const range = req.headers.get("range");
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      if (m) {
        if (m[1]) start = Math.min(Number(m[1]), size - 1);
        if (m[2]) end = Math.min(Number(m[2]), size - 1);
        if (end >= start) partial = true;
      }
    }
    const stream = fs.createReadStream(abs, partial ? { start, end } : {});
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (c) => controller.enqueue(c));
        stream.on("end", () => controller.close());
        stream.on("error", (e) => controller.error(e));
      },
      cancel() {
        stream.destroy();
      },
    });
    const user = "user" in access
      ? access.user
      : await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
    store.audit("file.download", `${rel} (${size}b)`, user?.id ?? null, clientIp(req));
    const chunkLen = end - start + 1;
    const headers: Record<string, string> = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": String(chunkLen),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    };
    if (partial) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new NextResponse(webStream as any, { status: partial ? 206 : 200, headers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Download failed." }, { status: 404 });
  }
}
