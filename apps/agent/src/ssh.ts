import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Docker from "dockerode";
import ssh2 from "ssh2";

const { Server, utils } = ssh2;

/**
 * Gateway SSH do nó de hospedagem. Escuta na porta pública 2222, autentica o
 * cliente pela CHAVE PÚBLICA cadastrada no painel (consultada no controle via
 * WireGuard) e o coloca num shell DENTRO do container do ambiente dele
 * (`docker exec`), isolado. username = `env_<hex>`.
 *
 * Env:
 *   SSH_GATEWAY_PORT      (default 2222)
 *   VP_API_INTERNAL_URL   base do controle via WG, ex.: http://10.100.0.1:4000
 *   VP_INTERNAL_TOKEN     token compartilhado do endpoint interno
 *   SSH_HOST_KEY_PATH     onde persistir a host key (default /data/ssh_host_key)
 * Sem VP_API_INTERNAL_URL/VP_INTERNAL_TOKEN o gateway não sobe (dev).
 */

const docker = new Docker();

const SSH_PORT = Number(process.env.SSH_GATEWAY_PORT ?? 2222);
const API_URL = (process.env.VP_API_INTERNAL_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.VP_INTERNAL_TOKEN ?? "";
const HOST_KEY_PATH = process.env.SSH_HOST_KEY_PATH ?? "/data/ssh_host_key";

interface ResolveResult {
  enabled: boolean;
  containerId: string | null;
  workdir?: string; // pasta onde a sessão abre (PHP → /var, Node → /app)
  state: string | null;
  accessScope: string;
  allowlist: string[];
  keys: string[];
  idleTimeoutSeconds?: number; // desconexão por inatividade; 0/ausente = desativado
}

interface Logger {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
}

/**
 * Carrega a host key persistida ou gera uma ed25519 nova (estável entre
 * reinícios). A host key é a IDENTIDADE do gateway: se ela mudar, todo cliente
 * recebe "REMOTE HOST IDENTIFICATION HAS CHANGED" e — pior — se um dia a chave
 * for regenerada por engano, abre-se janela de MITM (o cliente confia na
 * fingerprint fixada no known_hosts). Por isso:
 *  - o diretório é criado 0700 e o arquivo 0600 (evita leitura por outra conta);
 *  - com SSH_HOST_KEY_REQUIRED=1 (produção) o gateway FALHA-FECHADO: se o arquivo
 *    sumir, recusa subir em vez de cunhar uma identidade nova silenciosamente.
 */
export function loadOrCreateHostKey(): string {
  if (existsSync(HOST_KEY_PATH)) return readFileSync(HOST_KEY_PATH, "utf8");
  if (process.env.SSH_HOST_KEY_REQUIRED === "1") {
    throw new Error(
      `host key ausente em ${HOST_KEY_PATH} e SSH_HOST_KEY_REQUIRED=1: ` +
        "recusando subir para não trocar a identidade do gateway (risco de MITM). " +
        "Restaure a host key persistida antes de iniciar.",
    );
  }
  const pair = utils.generateKeyPairSync("ed25519");
  mkdirSync(dirname(HOST_KEY_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(HOST_KEY_PATH, pair.private, { mode: 0o600 });
  return pair.private;
}

async function resolveUser(username: string): Promise<ResolveResult | null> {
  const res = await fetch(
    `${API_URL}/api/v1/internal/ssh/resolve/${encodeURIComponent(username)}`,
    { headers: { "x-internal-token": TOKEN } },
  );
  if (!res.ok) return null;
  return (await res.json()) as ResolveResult;
}

export function startSshGateway(log: Logger): void {
  if (!API_URL || !TOKEN) {
    log.warn("gateway SSH desativado (defina VP_API_INTERNAL_URL e VP_INTERNAL_TOKEN)");
    return;
  }
  const hostKey = loadOrCreateHostKey();

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    let resolved: ResolveResult | null = null;

    client.on("authentication", (ctx) => {
      void (async () => {
        if (ctx.method !== "publickey") return ctx.reject(["publickey"]);
        try {
          const r = await resolveUser(ctx.username);
          if (!r || !r.enabled || !r.containerId) return ctx.reject();

          let matched: ReturnType<typeof utils.parseKey> | null = null;
          for (const kstr of r.keys) {
            let parsed = utils.parseKey(kstr);
            if (Array.isArray(parsed)) parsed = parsed[0];
            if (!parsed || parsed instanceof Error) continue;
            const pub = parsed.getPublicSSH();
            if (ctx.key.algo === parsed.type && Buffer.compare(ctx.key.data, pub) === 0) {
              matched = parsed;
              break;
            }
          }
          if (!matched || matched instanceof Error) return ctx.reject();

          if (ctx.signature && ctx.blob) {
            const ok = matched.verify(ctx.blob, ctx.signature, ctx.hashAlgo);
            if (!ok) return ctx.reject();
          }
          resolved = r;
          return ctx.accept();
        } catch (err) {
          log.error({ err }, "gateway SSH: erro na autenticação");
          return ctx.reject();
        }
      })();
    });

    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        const session = acceptSession();
        let pty: { rows: number; cols: number; term: string } | null = null;

        session.on("pty", (accept, _reject, info) => {
          pty = { rows: info.rows, cols: info.cols, term: (info as { term?: string }).term ?? "xterm" };
          if (accept) accept();
        });

        const run = async (channel: import("ssh2").ServerChannel, command: string[] | null) => {
          const cid = resolved?.containerId;
          if (!cid) {
            channel.stderr.write("ambiente indisponível\n");
            channel.exit(1);
            return channel.end();
          }
          try {
            const container = docker.getContainer(cid);
            const useTty = pty !== null;
            const exec = await container.exec({
              // Shell interativo: bash de LOGIN + INTERATIVO (-il) → readline
              // (setinhas/histórico) + /etc/profile.d/* (aliases). NÃO redirecionar
              // o stderr do bash: se fd2 não for um TTY, o bash não é interativo e
              // o readline desliga. Cai para sh só se não houver bash.
              Cmd:
                command ??
                ["/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash -il; else exec /bin/sh; fi"],
              AttachStdin: true,
              AttachStdout: true,
              AttachStderr: true,
              Tty: useTty,
              WorkingDir: resolved?.workdir || "/", // abre na pasta do runtime (PHP /var, Node /app)
              Env: [`TERM=${pty?.term ?? "xterm"}`],
            });
            const stream = await exec.start({ hijack: true, stdin: true, Tty: useTty });

            // Desconexão por inatividade — SÓ em sessões interativas (TTY). Comandos
            // batch (exec sem tty) não são derrubados. O valor vem do controle a cada
            // login (super admin). Reseta a cada byte (tecla do usuário ou saída do app).
            let clearIdle: () => void = () => {};

            if (useTty) {
              // Com TTY o stream é multiplexado num só canal.
              channel.pipe(stream);
              stream.pipe(channel);
              if (pty) {
                try {
                  await exec.resize({ h: pty.rows, w: pty.cols });
                } catch {
                  /* ignora */
                }
              }
              session.on("window-change", (accept, _reject, info) => {
                exec.resize({ h: info.rows, w: info.cols }).catch(() => {});
                if (accept) accept();
              });

              const idleMs = Math.max(0, Math.floor(resolved?.idleTimeoutSeconds ?? 0)) * 1000;
              if (idleMs > 0) {
                let idleTimer: ReturnType<typeof setTimeout> | null = null;
                clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };
                const touch = () => {
                  clearIdle();
                  idleTimer = setTimeout(() => {
                    try { channel.write("\r\n\x1b[33mSessão encerrada por inatividade.\x1b[0m\r\n"); } catch { /* ignora */ }
                    try { channel.end(); } catch { /* ignora */ }
                    try { client.end(); } catch { /* ignora */ }
                  }, idleMs);
                };
                channel.on("data", touch); // teclas do usuário
                stream.on("data", touch);  // saída do app
                channel.on("close", clearIdle);
                touch(); // arma
              }
            } else {
              // Sem TTY: stdout/stderr vêm multiplexados; separa nos canais.
              channel.pipe(stream);
              docker.modem.demuxStream(stream, channel, channel.stderr);
            }

            stream.on("end", async () => {
              clearIdle();
              let code = 0;
              try {
                const info = await exec.inspect();
                code = info.ExitCode ?? 0;
              } catch {
                /* ignora */
              }
              channel.exit(code);
              channel.end();
            });
          } catch (err) {
            log.error({ err }, "gateway SSH: falha ao abrir sessão no container");
            channel.stderr.write("falha ao abrir sessão\n");
            channel.exit(1);
            channel.end();
          }
        };

        session.on("shell", (accept) => {
          void run(accept(), null);
        });
        session.on("exec", (accept, _reject, info) => {
          void run(accept(), ["/bin/sh", "-c", info.command]);
        });
      });
    });

    client.on("error", (err: unknown) => log.warn({ err }, "gateway SSH: erro no cliente"));
  });

  server.on("error", (err: unknown) => log.error({ err }, "gateway SSH: erro no servidor"));
  server.listen(SSH_PORT, "0.0.0.0", () => {
    log.info(`gateway SSH escutando em :${SSH_PORT}`);
  });
}
