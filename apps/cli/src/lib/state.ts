import { readFileSync, writeFileSync } from "node:fs";
import { STATE_PATH, ensureHome } from "./paths.js";

/** Estado local não-secreto: imagens deployadas por serviço (para rollback). */
export interface DeployState {
  imageId: string; // IMAGE ID da imagem carregada agora (não digest — save|load zera o digest)
  prevImageId: string | null; // imagem anterior (tag :prev no hub), para rollback
  lastDeployAt: string;
}

export interface State {
  deploys: Record<string, DeployState>; // serviço -> estado
}

export function loadState(): State {
  try {
    const raw = readFileSync(STATE_PATH, "utf8");
    const s = JSON.parse(raw) as Partial<State>;
    return { deploys: s.deploys ?? {} };
  } catch {
    return { deploys: {} };
  }
}

export function saveState(s: State): void {
  ensureHome();
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function recordDeploy(service: string, imageId: string, prevImageId: string | null, at: string): void {
  const s = loadState();
  s.deploys[service] = { imageId, prevImageId, lastDeployAt: at };
  saveState(s);
}
