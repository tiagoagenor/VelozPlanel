import Docker from "dockerode";
import { Writable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir as fsMkdir, writeFile, rm, readFile, open, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import * as unzipper from "unzipper";
import { createExtractorFromData } from "node-unrar-js";
import * as tar from "tar";
import { FileError } from "./files.js";

/**
 * Descompactação de arquivos .zip/.rar que estão DENTRO de um container de
 * ambiente, feita NO HOST (Node) e reinjetada no container.
 *
 * POR QUE NO HOST:
 *   As imagens base (`php:*-cli` Debian, `node:*-alpine`, `caddy:2-alpine`)
 *   normalmente NÃO trazem `unzip`/`unrar`. Então lemos os bytes do arquivo de
 *   dentro do container (via `docker exec cat`, em streaming), descompactamos
 *   no host com bibliotecas puras (unzipper / node-unrar-js WASM) e devolvemos
 *   o resultado empacotado num tar via `putArchive`.
 *
 * SEGURANÇA (defesa em profundidade):
 *   - Caminho absoluto e sem `..` (mesmo estilo de files.ts).
 *   - Zip-slip: cada entrada é confinada dentro da pasta de saída; nomes
 *     absolutos ou com segmento `..` são rejeitados.
 *   - Bomba de descompressão: limites de bytes totais e de número de arquivos.
 */

const docker = new Docker(); // /var/run/docker.sock

/** Teto do arquivo compactado (lido para o host). */
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024; // 200 MiB
/** Teto do total DESCOMPRIMIDO (anti-bomba). */
const MAX_TOTAL_UNCOMPRESSED = 2 * 1024 * 1024 * 1024; // 2 GiB
/** Teto de número de arquivos extraídos (anti-bomba). */
const MAX_FILES = 20000;

/* ─────────────── Utilitários (replicados de files.ts) ─────────────── */

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

/** Executa um comando no container e captura stdout/stderr/exit code (bufferizado). */
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

/**
 * Copia os bytes de um arquivo de dentro do container para um arquivo no host,
 * em STREAMING (`docker exec cat`), sem passar tudo pela memória.
 */
async function streamFileFromContainer(
  containerId: string,
  srcPath: string,
  destFile: string,
): Promise<void> {
  const container = docker.getContainer(containerId);
  const ex = await container.exec({
    Cmd: ["cat", srcPath],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await ex.start({ hijack: true, stdin: false });

  const out = createWriteStream(destFile);
  const errChunks: Buffer[] = [];
  const errW = new Writable({
    write(chunk, _enc, cb) {
      errChunks.push(Buffer.from(chunk));
      cb();
    },
  });
  docker.modem.demuxStream(stream, out, errW);

  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  // demuxStream não fecha o destino: encerra e espera o flush.
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });

  const info = await ex.inspect();
  if ((info.ExitCode ?? 0) !== 0) {
    throw new FileError(
      404,
      Buffer.concat(errChunks).toString("utf8").trim() ||
        "não foi possível ler o arquivo compactado no container",
    );
  }
}

/** Nome base do arquivo (POSIX) sem a extensão .zip/.rar (case-insensitive). */
function baseNameNoExt(archivePath: string): string {
  const idx = archivePath.lastIndexOf("/");
  const file = idx >= 0 ? archivePath.slice(idx + 1) : archivePath;
  return file.replace(/\.(zip|rar)$/i, "");
}

/** Diretório pai (POSIX) de um caminho absoluto. Ex.: /app/www/a.zip -> /app/www */
function parentDirOf(archivePath: string): string {
  const idx = archivePath.lastIndexOf("/");
  return idx <= 0 ? "/" : archivePath.slice(0, idx);
}

/**
 * Resolve, com proteção contra zip-slip, o destino ABSOLUTO no host de uma
 * entrada do arquivo, confinado dentro de `outDir`. Lança FileError se escapar.
 */
function safeJoin(outDir: string, entryName: string): string {
  // Normaliza separadores (RAR do Windows pode vir com `\`).
  const normalized = entryName.replace(/\\/g, "/");
  // Rejeita nomes absolutos ou com segmento `..`.
  if (normalized.startsWith("/")) {
    throw new FileError(400, `entrada com caminho absoluto rejeitada: ${entryName}`);
  }
  if (normalized.split("/").some((seg) => seg === "..")) {
    throw new FileError(400, `entrada com ".." rejeitada (zip-slip): ${entryName}`);
  }
  const dest = resolve(outDir, normalized);
  const root = resolve(outDir);
  if (dest !== root && !dest.startsWith(root + sep)) {
    throw new FileError(400, `entrada escapa do destino (zip-slip): ${entryName}`);
  }
  return dest;
}

/** Acumulador dos limites anti-bomba. */
interface Budget {
  bytes: number;
  files: number;
}

/** Contabiliza e valida os limites; lança FileError(413) ao estourar. */
function account(budget: Budget, size: number): void {
  budget.bytes += size;
  budget.files += 1;
  if (budget.bytes > MAX_TOTAL_UNCOMPRESSED) {
    throw new FileError(
      413,
      "arquivo descompactado excede o limite de tamanho (bomba de descompressão)",
    );
  }
  if (budget.files > MAX_FILES) {
    throw new FileError(
      413,
      "arquivo contém arquivos demais (bomba de descompressão)",
    );
  }
}

/* ─────────────── Detecção de formato ─────────────── */

type Format = "zip" | "rar";

/** Detecta o formato pelos magic bytes; cai para a extensão como fallback. */
async function detectFormat(localArchive: string, archivePath: string): Promise<Format> {
  const fh = await open(localArchive, "r");
  try {
    const buf = Buffer.alloc(8);
    const { bytesRead } = await fh.read(buf, 0, 8, 0);
    const head = buf.subarray(0, bytesRead);
    // ZIP: PK\x03\x04 | PK\x05\x06 (vazio) | PK\x07\x08 (spanned)
    if (
      head.length >= 4 &&
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      ((head[2] === 0x03 && head[3] === 0x04) ||
        (head[2] === 0x05 && head[3] === 0x06) ||
        (head[2] === 0x07 && head[3] === 0x08))
    ) {
      return "zip";
    }
    // RAR: "Rar!\x1a\x07" (RAR4 e RAR5 começam igual)
    if (
      head.length >= 6 &&
      head[0] === 0x52 &&
      head[1] === 0x61 &&
      head[2] === 0x72 &&
      head[3] === 0x21 &&
      head[4] === 0x1a &&
      head[5] === 0x07
    ) {
      return "rar";
    }
  } finally {
    await fh.close();
  }
  // Fallback: extensão.
  if (/\.zip$/i.test(archivePath)) return "zip";
  if (/\.rar$/i.test(archivePath)) return "rar";
  throw new FileError(400, "formato não suportado (esperado .zip ou .rar)");
}

/* ─────────────── Extratores ─────────────── */

/** Extrai um .zip para `outDir` (host), aplicando zip-slip e limites. */
async function extractZip(
  localArchive: string,
  outDir: string,
  budget: Budget,
): Promise<void> {
  let directory: unzipper.CentralDirectory;
  try {
    directory = await unzipper.Open.file(localArchive);
  } catch {
    throw new FileError(400, "não foi possível abrir o ZIP (corrompido ou inválido)");
  }
  for (const entry of directory.files) {
    const isDir = entry.type === "Directory" || entry.path.endsWith("/");
    const dest = safeJoin(outDir, entry.path);
    if (isDir) {
      await fsMkdir(dest, { recursive: true });
      continue;
    }
    account(budget, entry.uncompressedSize || 0);
    await fsMkdir(dirname(dest), { recursive: true });
    const content = await entry.buffer();
    // Recheca com o tamanho real (o header pode mentir sobre uncompressedSize).
    if (content.length > MAX_TOTAL_UNCOMPRESSED) {
      throw new FileError(413, "arquivo descompactado excede o limite de tamanho");
    }
    await writeFile(dest, content);
  }
}

/** Extrai um .rar para `outDir` (host), aplicando zip-slip e limites. */
async function extractRar(
  localArchive: string,
  outDir: string,
  budget: Budget,
): Promise<void> {
  const raw = await readFile(localArchive);
  const data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  try {
    const extractor = await createExtractorFromData({ data });
    const extracted = extractor.extract();
    for (const file of extracted.files) {
      const header = file.fileHeader;
      if (header.flags.encrypted) {
        throw new FileError(
          400,
          "não foi possível abrir o RAR (protegido por senha)",
        );
      }
      const dest = safeJoin(outDir, header.name);
      if (header.flags.directory) {
        await fsMkdir(dest, { recursive: true });
        continue;
      }
      const content = file.extraction;
      if (!content) continue; // sem conteúdo (não deveria ocorrer para arquivo)
      account(budget, content.length);
      await fsMkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
    }
  } catch (err) {
    // Preserva nossos erros de segurança/limite; mapeia o resto para msg amigável.
    if (err instanceof FileError) throw err;
    throw new FileError(
      400,
      "não foi possível abrir o RAR (protegido ou formato não suportado)",
    );
  }
}

/* ─────────────── Fluxo principal ─────────────── */

/**
 * Descompacta `archivePath` (um .zip/.rar DENTRO do container) e injeta o
 * resultado de volta no container.
 *
 * @param containerId  container do ambiente
 * @param archivePath  caminho absoluto do arquivo DENTRO do container
 * @param mode         "here" extrai na mesma pasta; "folder" cria subpasta
 * @returns { files, dir } — nº de arquivos extraídos e a pasta destino (no container)
 */
export async function extractArchive(
  containerId: string,
  archivePath: string,
  mode: "here" | "folder",
): Promise<{ files: number; dir: string }> {
  assertSafePath(archivePath);
  if (mode !== "here" && mode !== "folder") {
    throw new FileError(400, "modo inválido (esperado 'here' ou 'folder')");
  }

  // Confere tipo e tamanho do arquivo compactado ANTES de trazer para o host.
  const statRes = await exec(containerId, ["stat", "-c", "%F|%s", archivePath]);
  if (statRes.exitCode !== 0) {
    throw new FileError(404, statRes.stderr || "arquivo não encontrado");
  }
  const [fType, sizeStr] = statRes.stdout.toString("utf8").trim().split("|");
  if (fType === "directory") {
    throw new FileError(400, "o caminho é um diretório, não um arquivo");
  }
  const archiveSize = Number(sizeStr) || 0;
  if (archiveSize > MAX_ARCHIVE_BYTES) {
    throw new FileError(
      413,
      `arquivo compactado muito grande (máx ${MAX_ARCHIVE_BYTES} bytes)`,
    );
  }

  // Área temporária no host (limpa no finally).
  const workDir = await mkdtemp(join(tmpdir(), "veloz-extract-"));
  const localArchive = join(workDir, "archive");
  const outDir = join(workDir, "out");

  try {
    await fsMkdir(outDir, { recursive: true });
    await streamFileFromContainer(containerId, archivePath, localArchive);

    // Confere o tamanho realmente escrito (guarda extra).
    const local = await stat(localArchive);
    if (local.size > MAX_ARCHIVE_BYTES) {
      throw new FileError(413, "arquivo compactado muito grande");
    }

    const format = await detectFormat(localArchive, archivePath);
    const budget: Budget = { bytes: 0, files: 0 };
    if (format === "zip") {
      await extractZip(localArchive, outDir, budget);
    } else {
      await extractRar(localArchive, outDir, budget);
    }

    // Pasta destino DENTRO do container.
    const parent = parentDirOf(archivePath);
    let dir: string;
    if (mode === "here") {
      dir = parent;
    } else {
      const base = baseNameNoExt(archivePath);
      dir = parent === "/" ? `/${base}` : `${parent}/${base}`;
    }

    // Garante que o destino exista no container.
    const mk = await exec(containerId, ["sh", "-c", `mkdir -p ${sq(dir)}`]);
    if (mk.exitCode !== 0) {
      throw new FileError(400, mk.stderr || "não foi possível criar a pasta destino");
    }

    // Empacota o CONTEÚDO de out/ num tar e injeta no container.
    const packStream = tar.create(
      { cwd: outDir, gzip: false, portable: true },
      ["."],
    ) as unknown as NodeJS.ReadableStream;
    const container = docker.getContainer(containerId);
    await container.putArchive(packStream, { path: dir });

    return { files: budget.files, dir };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
