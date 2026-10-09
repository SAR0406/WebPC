import { NextRequest, NextResponse } from "next/server";
import fsp from "node:fs/promises";
import path from "node:path";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession, clientIp } from "@/lib/session";
import { checkAccess } from "@/lib/guard";
import { resolveSafePath } from "@/lib/files";
import { store } from "@/lib/store";

export async function POST(req: NextRequest) {
  const access = await checkAccess(req);
  if (!access) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const url = new URL(req.url);
  const dir = url.searchParams.get("path") || "/";
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Use multipart form with field 'file'." }, { status: 400 });
  const file = form.get("file") as File | null;
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Missing file field." }, { status: 400 });
  }
  const maxMB = Number(process.env.AURA_MAX_UPLOAD_MB || 100);
  if (file.size > maxMB * 1024 * 1024) {
    return NextResponse.json({ error: `File exceeds ${maxMB}MB cap.` }, { status: 413 });
  }
  const safeName = path.basename(file.name).replace(/[^\w.\-() +]/g, "_").slice(0, 180) || "upload.bin";
  try {
    const dirAbs = await resolveSafePath(dir);
    const target = path.join(dirAbs, safeName);
    // Re-validate final target stays in vault
    await resolveSafePath(path.relative(process.cwd(), target).startsWith("..") ? "/" + safeName : (dir === "/" ? "/" + safeName : dir + "/" + safeName));
    const buf = Buffer.from(await file.arrayBuffer());
    await fsp.writeFile(target, buf);
    const user = "user" in access
      ? access.user
      : await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
    store.audit("file.upload", `${dir}/${safeName} (${file.size}b)`, user?.id ?? null, clientIp(req));
    return NextResponse.json({ ok: true, name: safeName, size: file.size });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Upload failed." }, { status: 400 });
  }
}
