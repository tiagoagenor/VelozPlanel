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
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // ~25 MiB — teto de download

export interface FileEntry {
  name: string;
  type: "file" | "dir";
  size: number;
  mtime: number; // epoch ms
  mode: string; // permissões octais, ex.: "644"
}

export interface DownloadResult {
  base64: string;
  name: string;
  size: number;
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
    `stat -c "%n|%F|%s|%Y|%a" "$e"; done`;
  const { stdout, stderr, exitCode } = await exec(containerId, ["sh", "-c", script]);
  if (exitCode !== 0) {
    throw new FileError(404, stderr || "diretório não encontrado");
  }

  const entries: FileEntry[] = [];
  for (const line of stdout.toString("utf8").split("\n")) {
    if (!line) continue;
    // Nome pode conter `|`; os 4 últimos campos são fixos.
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const modeStr = parts.pop() as string;
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
      mode: modeStr.trim(),
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

/**
 * Renomeia (move dentro do mesmo diretório) um arquivo/pasta.
 * Deriva o diretório de `path` e monta `<dir>/<newName>`. `newName` não pode
 * conter `/` (nem `..`) para confinar a operação ao mesmo diretório.
 */
export async function rename(
  containerId: string,
  path: string,
  newName: string,
): Promise<void> {
  assertSafePath(path);
  if (path === "/") {
    throw new FileError(400, "não é permitido renomear a raiz");
  }
  if (
    typeof newName !== "string" ||
    newName.length === 0 ||
    newName.includes("/") ||
    newName === "." ||
    newName === ".."
  ) {
    throw new FileError(400, "nome inválido (sem barras)");
  }
  // Diretório pai de `path` (POSIX). Ex.: /var/www/a.txt -> /var/www
  const idx = path.lastIndexOf("/");
  const dir = idx <= 0 ? "/" : path.slice(0, idx);
  const dest = dir === "/" ? `/${newName}` : `${dir}/${newName}`;
  const { stderr, exitCode } = await exec(containerId, [
    "mv",
    "-n",
    "--",
    path,
    dest,
  ]);
  if (exitCode !== 0) {
    throw new FileError(400, stderr || "não foi possível renomear");
  }
}

/** Altera permissões (chmod) de um arquivo/pasta. `mode` octal 3–4 dígitos. */
export async function chmod(
  containerId: string,
  path: string,
  mode: string,
): Promise<void> {
  assertSafePath(path);
  if (path === "/") {
    throw new FileError(400, "não é permitido alterar a raiz");
  }
  if (!/^[0-7]{3,4}$/.test(mode)) {
    throw new FileError(400, "modo octal inválido (ex.: 644 ou 755)");
  }
  const { stderr, exitCode } = await exec(containerId, ["chmod", mode, "--", path]);
  if (exitCode !== 0) {
    throw new FileError(400, stderr || "não foi possível alterar permissões");
  }
}

/**
 * Baixa um arquivo, retornando o conteúdo em base64. Rejeita diretórios e
 * arquivos maiores que `maxBytes`. Verifica o tamanho antes de ler (via stat)
 * para não trazer arquivos gigantes para a memória do agente.
 */
export async function download(
  containerId: string,
  path: string,
  maxBytes = MAX_DOWNLOAD_BYTES,
): Promise<DownloadResult> {
  assertSafePath(path);
  // Confere tipo + tamanho primeiro (portável Debian/BusyBox).
  const statRes = await exec(containerId, ["stat", "-c", "%F|%s", path]);
  if (statRes.exitCode !== 0) {
    throw new FileError(404, statRes.stderr || "arquivo não encontrado");
  }
  const [fType, sizeStr] = statRes.stdout.toString("utf8").trim().split("|");
  if (fType === "directory") {
    throw new FileError(400, "não é possível baixar um diretório");
  }
  const size = Number(sizeStr) || 0;
  if (size > maxBytes) {
    throw new FileError(
      413,
      `arquivo muito grande para download (máx ${maxBytes} bytes)`,
    );
  }
  // `base64 <path>` funciona no coreutils e no BusyBox.
  const { stdout, stderr, exitCode } = await exec(containerId, [
    "base64",
    path,
  ]);
  if (exitCode !== 0) {
    throw new FileError(400, stderr || "não foi possível baixar o arquivo");
  }
  const idx = path.lastIndexOf("/");
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  return {
    base64: stdout.toString("utf8").replace(/\s+/g, ""),
    name,
    size,
  };
}
