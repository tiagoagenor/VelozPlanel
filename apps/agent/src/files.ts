import Docker from "dockerode";
import { Writable } from "node:stream";

/**
 * Operações de arquivo dentro do container do ambiente, via `docker exec`.
 *
 * ESTRATÉGIA:
 *   Não usamos bind mounts (não funcionam bem no Docker Desktop). Cada operação
 *   roda um `sh -c` dentro do container e nós lemos stdout/stderr desmultiplexados
 *   (demux) do stream de exec. Os comandos são portáveis entre o Debian das
 *   imagens `php:*-cli` e o Alpine (BusyBox) das imagens `node:*-alpine`.
 *
 * SEGURANÇA (defesa em profundidade):
 *   A API já confina o caminho à raiz do ambiente (/var/www ou /app) antes de
 *   chamar o Agente. Aqui reforçamos: exigimos caminho absoluto e rejeitamos
 *   qualquer segmento `..`; nunca deixamos apagar a raiz `/`.
 */

const docker = new Docker(); // /var/run/docker.sock (Docker Desktop no Mac)

const MAX_READ_BYTES = 512 * 1024; // 512 KiB — teto de leitura no editor
const MAX_WRITE_BYTES = 1024 * 1024; // ~1 MiB — teto de gravação

export interface FileEntry {
  name: string;
  type: "file" | "dir";
  size: number;
  mtime: number; // epoch ms
}

export interface ReadResult {
  content: string;
  truncated: boolean;
}

/** Erro de operação de arquivo com status HTTP sugerido (mapeado no server). */
export class FileError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "FileError";
  }
}

/* ─────────────── Utilitários ─────────────── */

/** Garante caminho absoluto e sem `..` (nem segmentos escapando). */
function assertSafePath(path: string): void {
  if (typeof path !== "string" || path.length === 0 || path[0] !== "/") {
    throw new FileError(400, "caminho deve ser absoluto (começar com /)");
  }
  if (path.split("/").some((seg) => seg === "..")) {
    throw new FileError(400, "caminho inválido (contém ..)");
  }
}

/** Aspas simples seguras para shell: fecha, escapa a aspa, reabre. */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Executa um comando no container e captura stdout/stderr/exit code. */
async function exec(
  containerId: string,
  cmd: string[],
): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
  const container = docker.getContainer(containerId);
  const ex = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await ex.start({ hijack: true, stdin: false });

  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  const outW = new Writable({
    write(chunk, _enc, cb) {
      outChunks.push(Buffer.from(chunk));
      cb();
    },
  });
  const errW = new Writable({
    write(chunk, _enc, cb) {
      errChunks.push(Buffer.from(chunk));
      cb();
    },
  });
  docker.modem.demuxStream(stream, outW, errW);

  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const info = await ex.inspect();
  return {
    stdout: Buffer.concat(outChunks),
    stderr: Buffer.concat(errChunks).toString("utf8").trim(),
    exitCode: info.ExitCode ?? 0,
  };
}

/* ─────────────── Operações ─────────────── */

/**
 * Lista o conteúdo de um diretório.
 * Usa um loop de shell + `stat` (portável Debian/BusyBox): imprime
 * `nome|tipo|tamanho|mtime` por entrada. `.[!.]*` pega dotfiles menos `.`/`..`.
 */
export async function list(containerId: string, path: string): Promise<FileEntry[]> {
  assertSafePath(path);
  const script =
    `cd ${sq(path)} && for e in * .[!.]*; do ` +
    `[ -e "$e" ] || continue; ` +
    `stat -c "%n|%F|%s|%Y" "$e"; done`;
  const { stdout, stderr, exitCode } = await exec(containerId, ["sh", "-c", script]);
  if (exitCode !== 0) {
    throw new FileError(404, stderr || "diretório não encontrado");
  }

  const entries: FileEntry[] = [];
  for (const line of stdout.toString("utf8").split("\n")) {
    if (!line) continue;
    // Nome pode conter `|`; os 3 últimos campos são fixos.
    const parts = line.split("|");
    if (parts.length < 4) continue;
    const mtimeSec = parts.pop() as string;
    const sizeStr = parts.pop() as string;
    const fType = parts.pop() as string;
    const name = parts.join("|");
    if (name === "." || name === "..") continue;
    entries.push({
      name,
      type: fType === "directory" ? "dir" : "file",
      size: Number(sizeStr) || 0,
      mtime: (Number(mtimeSec) || 0) * 1000,
    });
  }
  // Pastas primeiro, depois alfabético (case-insensitive).
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}

/**
 * Lê um arquivo (até `maxBytes`). Lê `maxBytes + 1` para detectar truncamento.
 */
export async function read(
  containerId: string,
  path: string,
  maxBytes = MAX_READ_BYTES,
): Promise<ReadResult> {
  assertSafePath(path);
  // `head -c N` funciona no coreutils e no BusyBox.
  const script = `head -c ${maxBytes + 1} ${sq(path)}`;
  const { stdout, stderr, exitCode } = await exec(containerId, ["sh", "-c", script]);
  if (exitCode !== 0) {
    throw new FileError(404, stderr || "arquivo não encontrado ou ilegível");
  }
  const truncated = stdout.length > maxBytes;
  const buf = truncated ? stdout.subarray(0, maxBytes) : stdout;
  return { content: buf.toString("utf8"), truncated };
}

/**
 * Grava conteúdo em um arquivo (cria/sobrescreve). Transporta em base64 para
 * não sofrer com quoting: `printf %s <b64> | base64 -d > arquivo`.
 */
export async function write(
  containerId: string,
  path: string,
  content: string,
): Promise<void> {
  assertSafePath(path);
  const raw = Buffer.from(content, "utf8");
  if (raw.length > MAX_WRITE_BYTES) {
    throw new FileError(413, `arquivo muito grande (máx ${MAX_WRITE_BYTES} bytes)`);
  }
  const b64 = raw.toString("base64");
  const script = `printf %s ${sq(b64)} | base64 -d > ${sq(path)}`;
  const { stderr, exitCode } = await exec(containerId, ["sh", "-c", script]);
  if (exitCode !== 0) {
    throw new FileError(400, stderr || "não foi possível gravar o arquivo");
  }
}

/** Cria um diretório (recursivo). */
export async function mkdir(containerId: string, path: string): Promise<void> {
  assertSafePath(path);
  const { stderr, exitCode } = await exec(containerId, ["mkdir", "-p", path]);
  if (exitCode !== 0) {
    throw new FileError(400, stderr || "não foi possível criar a pasta");
  }
}

/** Remove um arquivo ou diretório (recursivo). Nunca a raiz `/`. */
export async function remove(containerId: string, path: string): Promise<void> {
  assertSafePath(path);
  if (path === "/") {
    throw new FileError(400, "não é permitido apagar a raiz");
  }
  const { stderr, exitCode } = await exec(containerId, ["rm", "-rf", path]);
  if (exitCode !== 0) {
    throw new FileError(400, stderr || "não foi possível excluir");
  }
}
