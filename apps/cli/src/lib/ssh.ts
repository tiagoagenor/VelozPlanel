import { execFile } from "node:child_process";
import { ensureHome } from "./paths.js";

export interface Run {
  code: number;
  out: string;
  err: string;
}

// Sem ControlMaster/ControlPersist: via execFile, o master em background segura
// o stdout e trava o processo (e a criação do master retorna 255). Uma conexão
// por chamada é mais lenta mas robusta; os comandos já agrupam passos num ssh só.
const CTRL = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=12"];

/** Executa um script bash de LOGIN no host remoto (ssh target bash -lc '<script>'). */
export function sh(target: string, script: string, opts: { timeoutMs?: number; input?: string; env?: Record<string, string> } = {}): Promise<Run> {
  ensureHome();
  return new Promise((resolve) => {
    // Env remoto: injeta variáveis (ex.: tokens, PGPASSWORD) SEM aparecer em argv.
    let full = script;
    if (opts.env) {
      const exports = Object.entries(opts.env)
        .map(([k, v]) => `export ${k}=${shq(v)}`)
        .join("; ");
      full = `${exports}; ${script}`;
    }
    // Sem input: `-n` redireciona o stdin do ssh de /dev/null. Sem isso, via
    // execFile o ssh fica lendo o pipe de stdin (que nunca fecha) e NÃO sai.
    const stdinArgs = opts.input === undefined ? ["-n"] : [];
    const child = execFile(
      "ssh",
      // O script vai como UM único arg: o ssh concatena os args restantes com
      // espaço, então `bash -c '<script>'` viraria `bash -c <script...>` e
      // quebraria. Passando `full` sozinho, o shell remoto o executa inteiro.
      [...CTRL, ...stdinArgs, target, full],
      { timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        resolve({ code, out: stdout ?? "", err: stderr ?? "" });
      },
    );
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

/** rsync local→remoto com excludes padrão do projeto. */
export function rsync(localDir: string, target: string, remoteDir: string, excludes: string[] = [], timeoutMs = 300_000): Promise<Run> {
  const ex = excludes.flatMap((e) => ["--exclude", e]);
  const src = localDir.endsWith("/") ? localDir : localDir + "/";
  const dst = remoteDir.endsWith("/") ? remoteDir : remoteDir + "/";
  return new Promise((resolve) => {
    execFile(
      "rsync",
      ["-az", "--delete", ...ex, "-e", `ssh ${CTRL.join(" ")}`, src, `${target}:${dst}`],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        resolve({ code, out: stdout ?? "", err: stderr ?? "" });
      },
    );
  });
}

/** Aspas seguras para shell (single-quote). */
export function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
