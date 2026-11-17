/**
 * Resolve the Python executable. On Windows, `python3` is often a
 * WindowsApps stub that doesn't work; `python` is the real one.
 * On Linux/macOS, `python3` is the standard name.
 */
import { spawnSync } from "node:child_process";

let cached: string | null = null;

export function resolvePython(): string {
  if (cached) return cached;
  for (const candidate of ["python", "python3"]) {
    try {
      const r = spawnSync(candidate, ["-c", "import sys; print(sys.version)"], { encoding: "utf8", timeout: 5000 });
      if (r.status === 0 && r.stdout.includes("Python")) {
        cached = candidate;
        return cached;
      }
    } catch { /* candidate not found */ }
  }
  // Fallback to python (Windows default)
  cached = "python";
  return cached;
}
