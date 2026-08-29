import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Base de tudo do CLI no Mac do operador: ~/.jamees */
export const HOME = join(homedir(), ".jamees");
export const CONFIG_PATH = join(HOME, "config");
export const STATE_PATH = join(HOME, "state.json");
export const LOGS_DIR = join(HOME, "logs");
export const SSH_DIR = join(HOME, "ssh"); // sockets do ControlMaster
export const LOCK_DIR = join(HOME, "locks");

/** Garante a árvore ~/.jamees (idempotente). */
export function ensureHome(): void {
  for (const d of [HOME, LOGS_DIR, SSH_DIR, LOCK_DIR]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
  }
}
