import type { Config } from "../config.js";
import { sh, shq } from "./ssh.js";

/** Prefixo do docker compose no hub (projeto + arquivo). */
export function composeCmd(cfg: Config): string {
  return `cd ${cfg.paths.controlCompose} && docker compose -f ${cfg.paths.composeFile}`;
}

/** IMAGE ID (sha256) atual em execução de um serviço do compose no hub. */
export async function currentImageId(cfg: Config, svc: string): Promise<string | null> {
  const r = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} ps -q ${shq(svc)} | head -1 | xargs -r docker inspect -f '{{.Image}}'`);
  const id = r.out.trim();
  return id.startsWith("sha256:") ? id : null;
}

/** Re-tag de uma imagem (por IMAGE ID) para um repo:tag no hub. */
export async function tagImage(cfg: Config, imageId: string, repoTag: string): Promise<boolean> {
  const r = await sh(cfg.hosts.control.ssh, `docker tag ${shq(imageId)} ${shq(repoTag)}`);
  return r.code === 0;
}

export interface PsRow {
  name: string;
  service: string;
  state: string;
  status: string;
  health: string;
  image: string;
}

/** `compose ps --format json` tolerante a NDJSON (linha-a-linha) E array. */
export async function composePs(cfg: Config, svc?: string): Promise<PsRow[]> {
  const r = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} ps --format json ${svc ? shq(svc) : ""}`.trim());
  return parsePs(r.out);
}

export function parsePs(out: string): PsRow[] {
  const rows: PsRow[] = [];
  const push = (o: Record<string, unknown>) => {
    rows.push({
      name: String(o.Name ?? o.name ?? ""),
      service: String(o.Service ?? o.service ?? ""),
      state: String(o.State ?? o.state ?? ""),
      status: String(o.Status ?? o.status ?? ""),
      health: String(o.Health ?? o.health ?? ""),
      image: String(o.Image ?? o.image ?? ""),
    });
  };
  const trimmed = out.trim();
  if (!trimmed) return rows;
  // Tenta array JSON inteiro.
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as Record<string, unknown>[];
      arr.forEach(push);
      return rows;
    } catch {
      /* cai para NDJSON */
    }
  }
  // NDJSON: um objeto por linha.
  for (const line of trimmed.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      /* ignora linha malformada */
    }
  }
  return rows;
}

export interface HealthResult {
  state: "healthy" | "unhealthy" | "starting" | "exited" | "unknown" | "no-healthcheck";
  waitedSec: number;
  source: string;
}

/**
 * Poll da coluna Health do compose até healthy/unhealthy/exit ou deadline.
 * Deadline DERIVADO do healthcheck (start_period+interval*retries+margem), nunca
 * do --timeout global. Ausência de healthcheck NÃO é falha (no-healthcheck).
 */
export async function pollHealth(cfg: Config, svc: string, port?: number): Promise<HealthResult> {
  const deadline = await healthDeadlineSec(cfg, svc);
  const start = Date.now();
  const source = "compose-ps";
  let last: HealthResult["state"] = "unknown";
  while ((Date.now() - start) / 1000 < deadline) {
    const rows = await composePs(cfg, svc);
    const row = rows.find((r) => r.service === svc || r.name.includes(svc));
    const waitedSec = Math.round((Date.now() - start) / 1000);
    if (!row) {
      last = "unknown";
    } else if (/exited|dead/i.test(row.state)) {
      return { state: "exited", waitedSec, source };
    } else {
      const h = (row.health || "").toLowerCase();
      if (h === "healthy") return { state: "healthy", waitedSec, source };
      if (h === "unhealthy") return { state: "unhealthy", waitedSec, source };
      if (!h) {
        // Sem coluna Health: se rodando e temos porta, testa net.connect via docker exec.
        if (/up|running/i.test(row.status + row.state) && port) {
          const okConn = await execConnect(cfg, svc, port);
          return { state: okConn ? "healthy" : "starting", waitedSec, source: "docker-exec" };
        }
        return { state: "no-healthcheck", waitedSec, source };
      }
      last = "starting";
    }
    await sleep(3000);
  }
  return { state: last === "unknown" ? "starting" : last, waitedSec: Math.round((Date.now() - start) / 1000), source };
}

async function execConnect(cfg: Config, svc: string, port: number): Promise<boolean> {
  const script = `require('net').connect(${port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))`;
  const r = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T ${shq(svc)} node -e ${shq(script)}`);
  return r.code === 0;
}

/** Lê start_period+interval*retries do healthcheck (docker inspect); fallback 160s. */
async function healthDeadlineSec(cfg: Config, svc: string): Promise<number> {
  const fmt = "{{if .Config.Healthcheck}}{{.Config.Healthcheck.StartPeriod}}|{{.Config.Healthcheck.Interval}}|{{.Config.Healthcheck.Retries}}{{end}}";
  const r = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} ps -q ${shq(svc)} | head -1 | xargs -r docker inspect -f ${shq(fmt)}`);
  const t = r.out.trim();
  if (!t) return 160;
  const [sp, iv, rt] = t.split("|");
  const spS = nsToSec(sp), ivS = nsToSec(iv), rtN = Number(rt) || 12;
  const total = spS + ivS * rtN + 20; // margem
  return total > 30 ? total : 160;
}

function nsToSec(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / 1e9; // Go durations em nanossegundos
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
