import { NextRequest, NextResponse } from "next/server";
import fsp from "node:fs/promises";
import path from "node:path";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserBySession, clientIp } from "@/lib/session";
import { checkAccess } from "@/lib/guard";
import { resolveSafePath } from "@/lib/files";
import { store } from "@/lib/store";

const NAME = /^[\w.\-() +]{1,120}$/;

// Safe file actions (allowlisted): mkdir + rename only. No exec, no delete
// in v1 — every action is path-checked + audit-logged.
export async function POST(req: NextRequest) {
  const access = await checkAccess(req);
  if (!access) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const body = await req.json().catch(() => ({}));
  const dir = String(body.dir || "/");
  const name = String(body.name || "");
  if (!NAME.test(name)) {
    return NextResponse.json({ error: "Bad name (letters, digits, . - _ () + space)." }, { status: 400 });
  }
  try {
    const dirAbs = await resolveSafePath(dir);
    if (action === "mkdir") {
      const target = path.join(dirAbs, name);
      await resolveSafePath(`${dir === "/" ? "" : dir}/${name}`);
      await fsp.mkdir(target, { recursive: false });
    } else if (action === "rename") {
      const from = String(body.from || "");
      if (!NAME.test(path.basename(from))) {
        return NextResponse.json({ error: "Bad source name." }, { status: 400 });
      }
      const srcAbs = await resolveSafePath(`${dir === "/" ? "" : dir}/${path.basename(from)}`);
      const dstAbs = path.join(dirAbs, name);
      await resolveSafePath(`${dir === "/" ? "" : dir}/${name}`);
      await fsp.rename(srcAbs, dstAbs);
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const user = "user" in access
      ? access.user
      : await getUserBySession(req.cookies.get(SESSION_COOKIE)?.value);
    store.audit(`file.${action}`, `${dir}/${name}`, user?.id ?? null, clientIp(req));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Action failed." }, { status: 400 });
  }
}
