import Docker from "dockerode";
import ssh2 from "ssh2";
import { loadOrCreateHostKey } from "./ssh.js";

const { Server } = ssh2;

/**
 * Gateway SFTP do nó de hospedagem — MÓDULO SEPARADO do SSH.
 * Escuta na porta 2223 e autentica SÓ por SENHA (verificada no controle via
 * WireGuard). Só serve o subsistema `sftp`: roda o `sftp-server` DENTRO do
 * container do ambiente (`docker exec`), então respeita os arquivos/permissões
 * reais do container. NÃO dá shell/exec — quem tem senha só transfere arquivo
 * (shell é só por chave, no gateway SSH da 2222). Compartilha a MESMA host key
 * do gateway SSH (mesma identidade nas duas portas).
 *
 * Env:
 *   SFTP_GATEWAY_PORT     (default 2223)
 *   VP_API_INTERNAL_URL   base do controle via WG (ex.: http://10.100.0.1:4000)
 *   VP_INTERNAL_TOKEN     token do endpoint interno
 */

const docker = new Docker();

const SFTP_PORT = Number(process.env.SFTP_GATEWAY_PORT ?? 2223);
const API_URL = (process.env.VP_API_INTERNAL_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.VP_INTERNAL_TOKEN ?? "";

const MAX_TRIES_PER_CONN = 3; // tentativas de senha por conexão (anti brute-force)
const HANDSHAKE_TIMEOUT_MS = 15_000; // fecha conexão que não autentica a tempo
const MAX_CONNECTIONS = 100; // teto de conexões simultâneas

interface Logger {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
}

interface VerifyResult {
  ok: boolean;
  containerId?: string;
  workdir?: string;
}

/** Verifica a senha no controle (POST interno via WireGuard). */
async function verifyPassword(username: string, password: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`${API_URL}/api/v1/internal/sftp/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": TOKEN },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as VerifyResult;
  } catch {
    return { ok: false };
  }
}

// Acha o binário sftp-server em qualquer distro e o executa (fail-closed se
// não existir — o canal fecha e o cliente não acessa nada).
const SFTP_SERVER_CMD =
  'for p in /usr/lib/openssh/sftp-server /usr/lib/ssh/sftp-server ' +
  '/usr/libexec/sftp-server /usr/libexec/openssh/sftp-server; do ' +
  '[ -x "$p" ] && exec "$p"; done; ' +
  'echo "sftp-server ausente (instale openssh-sftp-server)" >&2; exit 127';

export function startSftpGateway(log: Logger): void {
  if (!API_URL || !TOKEN) {
    log.warn("gateway SFTP desativado (defina VP_API_INTERNAL_URL e VP_INTERNAL_TOKEN)");
    return;
  }
  const hostKey = loadOrCreateHostKey();
  let openConnections = 0;

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    openConnections += 1;
    if (openConnections > MAX_CONNECTIONS) {
      openConnections -= 1;
      client.end();
      return;
    }

    let resolved: { containerId: string; workdir: string } | null = null;
    let tries = 0;
    let authed = false;

    const handshakeTimer = setTimeout(() => {
      if (!authed) client.end();
    }, HANDSHAKE_TIMEOUT_MS);

    client.on("close", () => {
      clearTimeout(handshakeTimer);
      openConnections -= 1;
    });

    client.on("authentication", (ctx) => {
      void (async () => {
        // SÓ senha. Rejeita publickey, none, keyboard-interactive e qualquer outro.
        if (ctx.method !== "password") return ctx.reject(["password"]);

        tries += 1;
        if (tries > MAX_TRIES_PER_CONN) {
          ctx.reject();
          return client.end();
        }
        try {
          const r = await verifyPassword(ctx.username, ctx.password);
          if (!r.ok || !r.containerId) return ctx.reject();
          resolved = { containerId: r.containerId, workdir: r.workdir || "/" };
          authed = true;
          return ctx.accept();
        } catch (err) {
          log.error({ err }, "gateway SFTP: erro na autenticação");
          return ctx.reject();
        }
      })();
    });

    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        const session = acceptSession();

        // Bloqueia explicitamente tudo que NÃO é o subsistema sftp: nada de
        // shell/exec/pty/porta — senha nunca vira terminal nem execução.
        session.on("pty", (_accept, reject) => reject && reject());
        session.on("shell", (_accept, reject) => reject && reject());
        session.on("exec", (_accept, reject) => reject && reject());

        session.on("subsystem", (accept, reject, info) => {
          if (info.name !== "sftp") return reject && reject();
          const channel = accept();
          void openSftp(channel, log);
        });
      });
    });

    client.on("error", (err: unknown) => log.warn({ err }, "gateway SFTP: erro no cliente"));

    async function openSftp(channel: import("ssh2").ServerChannel, l: Logger): Promise<void> {
      const cid = resolved?.containerId;
      if (!cid) {
        channel.stderr.write("ambiente indisponível\n");
        channel.exit(1);
        return void channel.end();
      }
      try {
        const container = docker.getContainer(cid);
        const exec = await container.exec({
          Cmd: ["/bin/sh", "-c", SFTP_SERVER_CMD],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: false,
          WorkingDir: resolved?.workdir || "/",
        });
        const stream = await exec.start({ hijack: true, stdin: true, Tty: false });
        // Sem TTY: stdout (protocolo SFTP) e stderr vêm multiplexados; separa.
        channel.pipe(stream);
        docker.modem.demuxStream(stream, channel, channel.stderr);
        stream.on("end", async () => {
          let code = 0;
          try {
            const i = await exec.inspect();
            code = i.ExitCode ?? 0;
          } catch {
            /* ignora */
          }
          channel.exit(code);
          channel.end();
        });
      } catch (err) {
        l.error({ err }, "gateway SFTP: falha ao abrir sftp-server no container");
        channel.stderr.write("falha ao abrir SFTP\n");
        channel.exit(1);
        channel.end();
      }
    }
  });

  server.on("error", (err: unknown) => log.error({ err }, "gateway SFTP: erro no servidor"));
  server.listen(SFTP_PORT, "0.0.0.0", () => {
    log.info(`gateway SFTP escutando em :${SFTP_PORT}`);
  });
}
