// Portable launcher: finds a Python 3.10+ interpreter and runs agent/desktop.py.
// `python` is often missing on PATH (Windows Store shim), so we probe known
// locations before falling back to PATH.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const candidates = [
  process.env.AURA_PYTHON || "",
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311", "python.exe"),
  "C:\\Program Files\\Python312\\python.exe",
  "C:\\Program Files\\Python311\\python.exe",
  "python3",
  "python",
].filter(Boolean);

let picked = "";
for (const c of candidates) {
  try {
    if (c.includes(path.sep) || c.includes("/")) {
      if (fs.existsSync(c)) {
        picked = c;
        break;
      }
    } else {
      picked = c; // PATH lookup, verified below
      break;
    }
  } catch {}
}

if (!picked) {
  console.error("No Python found. Install Python 3.12 from python.org, then: pip install -r agent/requirements-desktop.txt");
  process.exit(1);
}

const child = spawn(picked, [path.join(process.cwd(), "agent", "desktop.py"), ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (e) => {
  console.error(`Failed to start ${picked}: ${e.message}`);
  process.exit(1);
});
