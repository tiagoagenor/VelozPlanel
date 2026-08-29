import { execFile } from "node:child_process";
import type { Run } from "./ssh.js";

/** Roda um script bash NO MAC (para pipes tipo `ssh a '…' | ssh b '…'`). */
export function localSh(script: string, timeoutMs = 600_000): Promise<Run> {
  return new Promise((resolve) => {
    execFile("bash", ["-lc", script], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ code, out: stdout ?? "", err: stderr ?? "" });
    });
  });
}
