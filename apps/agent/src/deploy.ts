import { PassThrough } from "node:stream";
import Docker from "dockerode";
import ssh2 from "ssh2";
import { createHash } from "node:crypto";
import { applyNodeStart, applyPhpRoot, applyPythonStart, applyPythonCmd, applyDotnetCmd, restartDotnet, restartApp } from "./docker.js";

const { utils } = ssh2;
const docker = new Docker();

/**
 * Motor de deploy por Git. Roda o BUILD num container efêmero IRMÃO (RAM própria,
 * não compete com os 512MB do app) montando um volume por ambiente
 * (veloz-deploy-<envId>) que guarda o checkout + node_modules/cache + a deploy key.
 * Depois COLOCA os arquivos buildados no container do app (sem recriá-lo).
 */

export interface EnvPair { key: string; value: string }
export interface HttpCreds { username: string; password: string }
export interface DeployStepSpec { kind: string; command?: string | null; cwd?: string | null; enabled: boolean }
export interface RunDeployArgs {
  envId: string;
  image: string; // imagem base do runtime do ambiente (tem git/toolchain)
  appContainerId: string;
  workdir: string; // /var/www (php) | /app (node)
  repoUrl: string;
  branch: string;
  steps: DeployStepSpec[];
  buildEnv: EnvPair[]; // vars build-time (NEXT_PUBLIC_*, etc.)
  framework: string; // none|nextjs
  runModel: string; // standalone|next_start
  http?: HttpCreds;
  subdir?: string | null; // pasta do projeto no repo (monorepo)
  runId: string; // id da execução (deploy_run) para streaming do log
  nodeStartFile?: string | null; // arquivo de start do Node/Python (restart pós-deploy)
  historyLimit?: number; // quantos logs manter em /veloz/deploys (0 = todos)
  runtimeKind?: string; // php|node|python|static|dotnet — distingue node de python no place/restart
  pythonCmd?: string | null; // comando avançado do Python (Django) — restart pós-deploy
  dotnetCmd?: string | null; // comando avançado do .NET — restart pós-deploy
}
export interface RunDeployResult {
  status: "success" | "failed";
  exitCode: number;
  log: string;
  commitSha: string | null;
}

const volName = (envId: string) => `veloz-deploy-${envId}`;
const BUILD_MEM_MB = 2048;

async function ensureVolume(envId: string): Promise<void> {
  try {
    await docker.getVolume(volName(envId)).inspect();
  } catch {
    await docker.createVolume({ Name: volName(envId), Labels: { "vp.env": envId } });
  }
}

/** Executa um comando num container e devolve {exitCode, out}. */
async function execIn(containerId: string, cmd: string[]): Promise<{ code: number; out: string }> {
  const c = docker.getContainer(containerId);
  const ex = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false });
  const stream = await ex.start({ hijack: true, stdin: false });
  const chunks: Buffer[] = [];
  const sink = new PassThrough();
  sink.on("data", (d) => chunks.push(Buffer.from(d)));
  await new Promise<void>((resolve) => {
    docker.modem.demuxStream(stream, sink, sink);
    stream.on("end", resolve);
    stream.on("close", resolve);
  });
  const info = await ex.inspect();
  return { code: info.ExitCode ?? 0, out: Buffer.concat(chunks).toString("utf8") };
}

/**
 * Escolhe a imagem do container de BUILD. Só precisa do toolchain (git + node/
 * python/php), não da versão EXATA do app. Se a base custom pedida não existir no
 * nó (ex.: velozplanel/node:24 num nó que só tem :22), cai em OUTRA base do mesmo
 * tipo que exista localmente — assim o deploy funciona sem exigir todas as
 * versões pré-buildadas em todo nó.
 */
async function resolveBuildImage(image: string): Promise<string> {
  try {
    await docker.getImage(image).inspect();
    return image; // versão exata presente
  } catch {
    /* não existe local — tenta fallback do mesmo tipo */
  }
  const m = /^velozplanel\/([^:]+):/.exec(image);
  if (m) {
    const prefix = `velozplanel/${m[1]}:`;
    try {
      const imgs = await docker.listImages();
      const tags = imgs.flatMap((i) => i.RepoTags ?? []).filter((t) => t.startsWith(prefix));
      if (tags.length) return tags.sort().reverse()[0]!; // mais recente-ish
    } catch {
      /* ignora */
    }
  }
  return image; // deixa o createContainer falhar/pull normalmente
}

/** Sobe um container efêmero (sleep) da imagem base montando o volume de build. */
async function startBuildContainer(envId: string, image: string, env: EnvPair[], http?: HttpCreds): Promise<Docker.Container> {
  await ensureVolume(envId);
  const buildImage = await resolveBuildImage(image);
  const c = await docker.createContainer({
    Image: buildImage,
    Cmd: ["sh", "-c", "sleep 3600"],
    Env: [
      "GIT_TERMINAL_PROMPT=0",
      "GIT_SSH_COMMAND=ssh -i /workspace/.ssh/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/workspace/.ssh/known_hosts",
      ...(http ? [`GIT_USER=${http.username}`, `GIT_PASS=${http.password}`] : []),
      ...env.filter((e) => !e.key.startsWith("VP_")).map((e) => `${e.key}=${e.value}`),
    ],
    HostConfig: {
      Memory: BUILD_MEM_MB * 1024 * 1024,
      Binds: [`${volName(envId)}:/workspace`],
      AutoRemove: false,
    },
    WorkingDir: "/workspace",
    Labels: { "vp.env": envId, "vp.role": "build" },
  });
  await c.start();
  if (http) {
    // credential helper lê GIT_USER/GIT_PASS do ambiente (injeção-safe: Env do Docker).
    await execIn(c.id, ["sh", "-c",
      `git config --global credential.helper '!f() { test "$1" = get && printf "username=%s\npassword=%s\n" "$GIT_USER" "$GIT_PASS"; }; f'`]);
  }
  return c;
}

/** Importa uma chave PRIVADA fornecida pelo usuário: valida, guarda no volume e deriva a pública. */
export async function importDeployKey(
  envId: string,
  image: string,
  privateKey: string,
): Promise<{ publicKey: string; fingerprint: string }> {
  const c = await startBuildContainer(envId, image, []);
  try {
    const b64 = Buffer.from(privateKey.endsWith("\n") ? privateKey : privateKey + "\n", "utf8").toString("base64");
    await execIn(c.id, ["sh", "-c",
      `mkdir -p /workspace/.ssh && chmod 700 /workspace/.ssh && printf '%s' '${b64}' | base64 -d > /workspace/.ssh/id_ed25519 && chmod 600 /workspace/.ssh/id_ed25519 && ` +
      `ssh-keyscan -t rsa,ecdsa,ed25519 github.com gitlab.com bitbucket.org > /workspace/.ssh/known_hosts 2>/dev/null || true`]);
    const pub = await execIn(c.id, ["sh", "-c", "ssh-keygen -y -f /workspace/.ssh/id_ed25519 2>&1"]);
    if (!/^(ssh-|ecdsa-)/.test(pub.out.trim())) {
      throw new Error("chave privada inválida ou protegida por senha");
    }
    const parts = pub.out.trim().split(/\s+/);
    const publicKey = `${parts[0]} ${parts[1]} velozplanel-deploy`;
    const raw = Buffer.from(parts[1] ?? "", "base64");
    const fingerprint = "SHA256:" + createHash("sha256").update(raw).digest("base64").replace(/=+$/, "");
    return { publicKey, fingerprint };
  } finally {
    await killContainer(c);
  }
}

async function killContainer(c: Docker.Container): Promise<void> {
  await c.remove({ force: true }).catch(() => {});
}

/** Gera a deploy key ed25519, guarda a privada no volume de build e devolve a pública. */
export async function generateDeployKey(
  envId: string,
  image: string,
): Promise<{ publicKey: string; fingerprint: string }> {
  const pair = utils.generateKeyPairSync("ed25519");
  const parts = pair.public.trim().split(/\s+/);
  const publicKey = `${parts[0]} ${parts[1]} velozplanel-deploy`;
  const raw = Buffer.from(parts[1] ?? "", "base64");
  const fingerprint = "SHA256:" + createHash("sha256").update(raw).digest("base64").replace(/=+$/, "");

  const c = await startBuildContainer(envId, image, []);
  try {
    const privB64 = Buffer.from(pair.private, "utf8").toString("base64");
    await execIn(c.id, [
      "sh",
      "-c",
      `mkdir -p /workspace/.ssh && chmod 700 /workspace/.ssh && ` +
        `printf '%s' '${privB64}' | base64 -d > /workspace/.ssh/id_ed25519 && chmod 600 /workspace/.ssh/id_ed25519 && ` +
        `ssh-keyscan -t ed25519 github.com gitlab.com bitbucket.org > /workspace/.ssh/known_hosts 2>/dev/null || true`,
    ]);
  } finally {
    await killContainer(c);
  }
  return { publicKey, fingerprint };
}

/** Sonda um repositório: reachable / público / privado (sem gravar nada). */
function parseDefaultBranch(out: string): string | null {
  const m = /ref:\s+refs\/heads\/(\S+)\s+HEAD/.exec(out);
  return m ? m[1]! : null;
}

export async function probeRepo(
  envId: string,
  image: string,
  repoUrl: string,
  http?: HttpCreds,
): Promise<{ reachable: boolean; isPrivate: boolean | null; message: string; defaultBranch: string | null }> {
  const c = await startBuildContainer(envId, image, [], http);
  try {
    await execIn(c.id, ["sh", "-c", "mkdir -p /workspace/.ssh && ssh-keyscan -t ed25519 github.com gitlab.com bitbucket.org > /workspace/.ssh/known_hosts 2>/dev/null || true"]);
    // --symref traz a branch padrão (HEAD) sem o usuário digitar.
    const r = await execIn(c.id, ["sh", "-c", `timeout 25 git ls-remote --symref -- '${repoUrl}' HEAD 2>&1; echo "RC=$?"`]);
    const rc = /RC=(\d+)/.exec(r.out)?.[1];
    if (rc === "0") return { reachable: true, isPrivate: false, message: "Repositório público acessível.", defaultBranch: parseDefaultBranch(r.out) };
    const out = r.out.toLowerCase();
    if (out.includes("permission denied") || out.includes("authentication") || out.includes("could not read")) {
      return { reachable: true, isPrivate: true, message: "Repositório privado — vou gerar uma deploy key.", defaultBranch: null };
    }
    if (out.includes("not found") || out.includes("does not exist") || out.includes("repository not found")) {
      return { reachable: true, isPrivate: true, message: "Não encontrado ou privado — confira a URL e a deploy key.", defaultBranch: null };
    }
    return { reachable: false, isPrivate: null, message: "Não foi possível alcançar o repositório.", defaultBranch: null };
  } finally {
    await killContainer(c);
  }
}

/** Testa a conexão git usando a deploy key já gravada no volume. */
export async function testGit(
  envId: string,
  image: string,
  repoUrl: string,
  http?: HttpCreds,
): Promise<{ ok: boolean; message: string; defaultBranch: string | null }> {
  const c = await startBuildContainer(envId, image, [], http);
  try {
    const r = await execIn(c.id, ["sh", "-c", `timeout 25 git ls-remote --symref -- '${repoUrl}' HEAD 2>&1; echo "RC=$?"`]);
    const ok = /RC=0/.test(r.out);
    return { ok, message: ok ? "Conectado ✓" : "Ainda não autentica — confirme que colou a deploy key no repositório.", defaultBranch: ok ? parseDefaultBranch(r.out) : null };
  } finally {
    await killContainer(c);
  }
}

const GIT_REF_RE_AGENT = /^[A-Za-z0-9._/-]+$/;

/** Lista as branches do repositório (usa a chave/creds já salvos). */
export async function listBranches(
  envId: string, image: string, repoUrl: string, http?: HttpCreds,
): Promise<{ ok: boolean; branches: string[]; message: string }> {
  const c = await startBuildContainer(envId, image, [], http);
  try {
    await execIn(c.id, ["sh", "-c", "mkdir -p /workspace/.ssh && ssh-keyscan -t ed25519 github.com gitlab.com bitbucket.org > /workspace/.ssh/known_hosts 2>/dev/null || true"]);
    const r = await execIn(c.id, ["sh", "-c", `timeout 25 git ls-remote --heads -- '${repoUrl}' 2>&1; echo "RC=$?"`]);
    if (!/RC=0/.test(r.out)) return { ok: false, branches: [], message: "Não consegui listar as branches — confirme a conexão." };
    const branches = r.out.split("\n")
      .map((l) => /\srefs\/heads\/(.+)$/.exec(l)?.[1])
      .filter((b): b is string => !!b)
      .filter((b) => GIT_REF_RE_AGENT.test(b));
    return { ok: true, branches, message: `${branches.length} branch(es)` };
  } finally {
    await killContainer(c);
  }
}

/** Detecta o stack a partir do checkout no volume. `kind` = runtime do ambiente. */
export async function detectStack(
  envId: string,
  image: string,
  repoUrl: string,
  branch: string,
  kind: string,
  http?: HttpCreds,
): Promise<{ framework: string; runModel: string; serverEntry: string; hasComposer: boolean; hasPackageJson: boolean; hasRequirements: boolean; suggestedStartFile: string | null; suggestedPythonCmd: string | null }> {
  const c = await startBuildContainer(envId, image, [], http);
  try {
    // clona (shallow) se ainda não houver checkout — o detect precisa do código.
    await execIn(c.id, ["sh", "-c", "mkdir -p /workspace/.ssh && ssh-keyscan -t ed25519 github.com gitlab.com bitbucket.org > /workspace/.ssh/known_hosts 2>/dev/null || true"]);
    await execIn(c.id, ["sh", "-c", `if [ ! -d /workspace/repo/.git ]; then timeout 60 git clone --depth 1 --branch '${branch}' -- '${repoUrl}' /workspace/repo 2>/dev/null; fi`]);
    const pkg = await execIn(c.id, ["sh", "-c", "cat /workspace/repo/package.json 2>/dev/null || echo ''"]);
    const composer = await execIn(c.id, ["sh", "-c", "test -f /workspace/repo/composer.json && echo YES || echo NO"]);
    const composerJson = await execIn(c.id, ["sh", "-c", "cat /workspace/repo/composer.json 2>/dev/null || echo ''"]);
    const artisan = await execIn(c.id, ["sh", "-c", "test -f /workspace/repo/artisan && echo YES || echo NO"]);
    const hasPackageJson = pkg.out.trim().startsWith("{");
    const hasComposer = composer.out.includes("YES");
    const hasBuildScript = /"scripts"\s*:\s*{[^}]*"build"\s*:/.test(pkg.out);

    let framework = "none";
    let runModel = "standalone";
    let hasRequirements = false;
    let suggestedStartFile: string | null = null;
    let suggestedPythonCmd: string | null = null;

    if (kind === "python") {
      const reqs = await execIn(c.id, ["sh", "-c", "cat /workspace/repo/requirements.txt 2>/dev/null || echo ''"]);
      const managePy = await execIn(c.id, ["sh", "-c", "test -f /workspace/repo/manage.py && echo YES || echo NO"]);
      const pyproj = await execIn(c.id, ["sh", "-c", "cat /workspace/repo/pyproject.toml 2>/dev/null || echo ''"]);
      const pyEntry = await execIn(c.id, ["sh", "-c", "for f in app.py main.py wsgi.py server.py; do [ -f /workspace/repo/$f ] && { echo $f; break; }; done"]);
      hasRequirements = reqs.out.trim().length > 0;
      const isDjango = managePy.out.includes("YES") && (/django/i.test(reqs.out) || /django/i.test(pyproj.out) || true);
      if (managePy.out.includes("YES") && isDjango) {
        framework = "django";
        suggestedPythonCmd = "python manage.py runserver 0.0.0.0:80 --insecure --noreload";
      } else {
        framework = "python";
        suggestedStartFile = pyEntry.out.trim() || "app.py";
      }
    } else if (kind === "static") {
      framework = hasPackageJson && hasBuildScript ? "spa" : "static";
    } else if (kind === "dotnet") {
      const csproj = await execIn(c.id, ["sh", "-c", "find /workspace/repo -maxdepth 3 -name '*.csproj' | head -1"]);
      const sln = await execIn(c.id, ["sh", "-c", "find /workspace/repo -maxdepth 2 -name '*.sln' | head -1"]);
      framework = csproj.out.trim() || sln.out.trim() ? "dotnet" : "none";
    } else if (hasPackageJson && /"next"\s*:/.test(pkg.out)) {
      framework = "nextjs";
      runModel = "standalone";
    } else if (hasComposer && artisan.out.includes("YES") && /laravel\/framework/.test(composerJson.out)) {
      framework = "laravel";
    }
    return { framework, runModel, serverEntry: "server.js", hasComposer, hasPackageJson, hasRequirements, suggestedStartFile, suggestedPythonCmd };
  } finally {
    await killContainer(c);
  }
}

/** Monta o script de build a partir dos steps. Retorna o shell script. */
function buildScript(args: RunDeployArgs): string {
  const lines: string[] = [];
  lines.push("set -o pipefail");
  lines.push("mkdir -p /workspace/repo");
  // git_sync: clona (ou atualiza) no /workspace/repo
  lines.push(
    `echo "::vp:step:git_sync:start"; ` +
      `if [ -d /workspace/repo/.git ]; then cd /workspace/repo && git fetch --depth 1 origin -- '${args.branch}' && git reset --hard FETCH_HEAD; ` +
      `else rm -rf /workspace/repo && git clone --depth 1 --branch '${args.branch}' -- '${args.repoUrl}' /workspace/repo; fi; ` +
      `RC=$?; echo "::vp:step:git_sync:exit:$RC"; [ $RC -eq 0 ] || exit $RC`,
  );
  const base = args.subdir ? `/workspace/repo/${args.subdir}` : "/workspace/repo";
  lines.push(`[ -d '${base}' ] || { echo "::vp:step:project_dir:exit:1"; echo "pasta do projeto nao existe: ${args.subdir ?? ""}"; exit 1; }`);
  lines.push(`cd '${base}'`);
  for (const st of args.steps) {
    if (!st.enabled) continue;
    let cmd = "";
    switch (st.kind) {
      case "git_sync":
        continue;
      case "composer_install":
        cmd = args.framework === "laravel"
          ? "composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist"
          : "composer install --no-dev --no-interaction --prefer-dist";
        break;
      case "npm_ci":
        cmd = "if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; else npm ci; fi";
        break;
      case "npm_build":
        cmd = args.framework === "nextjs" ? "NEXT_PRIVATE_STANDALONE=true npm run build" : "npm run build --if-present";
        break;
      case "pip_install":
        // Vendoriza as deps em .vp-vendor (dentro de /app) → sobrevivem ao recreate.
        cmd = "if [ -f requirements.txt ]; then pip install --no-cache-dir --target=.vp-vendor -r requirements.txt; else echo 'sem requirements.txt — pulei'; fi";
        break;
      case "python_restart":
      case "static_reload":
      case "dotnet_restart":
        continue; // pós-place (rodam no container do app)
      case "dotnet_publish":
        // Publica o projeto (auto-detecta o .csproj) em /workspace/publish. A montagem
        // do artefato (abaixo) copia publish→out. UseAppHost=false → só App.dll (roda
        // via `dotnet App.dll`, sem apphost nativo por-arquitetura).
        cmd =
          "PROJ=\"$(find . -maxdepth 3 -name '*.csproj' | head -1)\"; " +
          "[ -n \"$PROJ\" ] || { echo 'nenhum .csproj encontrado no repo'; exit 1; }; " +
          "rm -rf /workspace/publish && dotnet publish \"$PROJ\" -c Release -o /workspace/publish -p:UseAppHost=false --nologo";
        break;
      case "php_migrate":
      case "artisan_migrate":
      case "artisan_optimize":
      case "artisan_storage_link":
        continue; // artisan roda no container do app (precisa de .env/DB), pós-place
      case "node_restart":
        continue; // feito depois, fora do build
      case "shell":
        cmd = st.command ?? "true";
        break;
      default:
        continue;
    }
    const cwd = st.cwd ? `cd '${base}/${st.cwd}' && ` : "";
    lines.push(
      `echo "::vp:step:${st.kind}:start"; ( ${cwd}${cmd} ); RC=$?; echo "::vp:step:${st.kind}:exit:$RC"; [ $RC -eq 0 ] || exit $RC`,
    );
  }
  // Montagem do artefato final em /workspace/out
  lines.push("rm -rf /workspace/out && mkdir -p /workspace/out");
  if (args.framework === "nextjs" && args.runModel === "standalone") {
    // standalone: server.js + .next/static + public
    lines.push(
      "if [ -d .next/standalone ]; then cp -a .next/standalone/. /workspace/out/ && " +
        "mkdir -p /workspace/out/.next && [ -d .next/static ] && cp -a .next/static /workspace/out/.next/static; " +
        "[ -d public ] && cp -a public /workspace/out/public; " +
        'else echo "AVISO: .next/standalone ausente"; cp -a . /workspace/out/; fi',
    );
  } else if (args.framework === "laravel") {
    // Laravel: separa o public/ (docroot) do resto do framework.
    //   out/www/       = conteúdo do public/  -> /var/www (docroot)
    //   out/framework/ = repo inteiro          -> /var/projeto-laravel (fora do docroot)
    lines.push(
      "mkdir -p /workspace/out/framework /workspace/out/www && " +
        "cp -a . /workspace/out/framework/ && rm -rf /workspace/out/framework/.git && " +
        "cp -a /workspace/out/framework/public/. /workspace/out/www/",
    );
  } else if (args.framework === "spa") {
    // SPA: só o artefato de build vai para /site. Auto-detecta dist|build|out;
    // Angular gera dist/<proj>/ — desce para a subpasta que tem index.html.
    lines.push(
      "OUT=''; for d in dist build out; do [ -d \"$d\" ] && { OUT=\"$d\"; break; }; done; " +
        "if [ -n \"$OUT\" ]; then " +
        "if [ ! -f \"$OUT/index.html\" ]; then SUB=$(find \"$OUT\" -maxdepth 2 -name index.html | head -1); [ -n \"$SUB\" ] && OUT=$(dirname \"$SUB\"); fi; " +
        "cp -a \"$OUT\"/. /workspace/out/; " +
        "else echo 'AVISO: nao achei dist/build/out — publicando a raiz'; cp -a . /workspace/out/ && rm -rf /workspace/out/.git; fi",
    );
  } else if (args.framework === "static" || args.framework === "python" || args.framework === "django") {
    // static "site pronto" → /site inteiro; python → /app inteiro (com .vp-vendor).
    lines.push("cp -a . /workspace/out/ && rm -rf /workspace/out/.git");
  } else if (args.framework === "dotnet") {
    // .NET: o artefato é a SAÍDA do `dotnet publish` (auto-contida), não o repo.
    lines.push(
      "[ -d /workspace/publish ] && cp -a /workspace/publish/. /workspace/out/ || " +
        "{ echo 'AVISO: /workspace/publish ausente (o passo de publish rodou?)'; }",
    );
  } else {
    // genérico: copia o repo inteiro (menos .git)
    lines.push("cp -a . /workspace/out/ && rm -rf /workspace/out/.git");
  }
  lines.push('git -C /workspace/repo rev-parse HEAD > /workspace/out/.veloz-sha 2>/dev/null || true');
  lines.push('echo "::vp:done"');
  return lines.join("\n");
}

/** Comando de um passo que roda NO CONTAINER DO APP (pós-place). null = não é app-step. */
function appStepCommand(kind: string): string | null {
  // Artisan roda via `docker exec` e NÃO herda o /veloz/env do supervisor; então
  // carregamos as variáveis gerenciadas (KEY=base64(value)) antes de chamar o artisan.
  // Corta só no primeiro '=' (ver LOAD_ENV em docker.ts): IFS='=' comeria o
  // padding '=' final do base64 e truncaria os valores.
  const LOAD =
    `if [ -f /veloz/env ]; then while IFS= read -r line; do ` +
    `k=\${line%%=*}; v=\${line#*=}; ` +
    `[ -n "$k" ] && export "$k=$(printf %s "$v" | base64 -d 2>/dev/null)"; done < /veloz/env; fi; `;
  switch (kind) {
    case "laravel_fix_index":
      // Verifica se o index.php do docroot aponta para o framework; se não, corrige.
      return (
        `F=/var/www/index.php; [ -f "$F" ] || { echo "index.php ausente em /var/www"; exit 1; }; ` +
        `if grep -qF "__DIR__.'/../" "$F"; then ` +
        `sed -i "s#__DIR__\\.'/\\.\\./#'/var/projeto-laravel/#g" "$F"; ` +
        `echo "index.php corrigido: apontando para /var/projeto-laravel"; ` +
        `else echo "index.php OK"; fi`
      );
    case "artisan_storage_link":
      // Symlink no docroot real (o artisan storage:link criaria no lugar errado).
      return `ln -sfn /var/projeto-laravel/storage/app/public /var/www/storage && echo "storage: /var/www/storage -> /var/projeto-laravel/storage/app/public"`;
    case "artisan_clear":
      return `[ -f .env ] || { echo "sem .env — pulei limpeza de cache"; exit 0; }; ${LOAD} php artisan optimize:clear`;
    case "artisan_optimize":
      return `[ -f .env ] || { echo "sem .env — pulei cache"; exit 0; }; ${LOAD} php artisan config:cache && php artisan route:cache && php artisan view:cache`;
    case "php_migrate":
    case "artisan_migrate":
      return `[ -f .env ] || { echo "sem .env — pulei migrate"; exit 0; }; ${LOAD} [ -f artisan ] && php artisan migrate --force`;
    default:
      return null;
  }
}

/** Executa o deploy completo: build no irmão + coloca os arquivos no app. */
// Estado em memória das execuções (streaming do log ao vivo). O log final também
// é persistido no banco pela API quando a execução termina.
interface DeployState { log: string; status: "running" | "success" | "failed"; done: boolean; commitSha: string | null; exitCode: number | null }
const deployState = new Map<string, DeployState>();

function appendLog(runId: string, chunk: string): void {
  const st = deployState.get(runId);
  if (st) st.log = (st.log + chunk).slice(-400000); // teto ~400KB ao vivo
}
function finalize(runId: string, status: "success" | "failed", exitCode: number, commitSha: string | null): void {
  const st = deployState.get(runId);
  if (st) { st.status = status; st.done = true; st.exitCode = exitCode; st.commitSha = commitSha; }
}

/** Como execIn, mas TRANSMITE a saída para o log da execução em tempo real. */
async function execStream(containerId: string, cmd: string[], runId: string): Promise<{ code: number }> {
  const c = docker.getContainer(containerId);
  const ex = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false });
  const stream = await ex.start({ hijack: true, stdin: false });
  const sink = new PassThrough();
  sink.on("data", (d) => appendLog(runId, Buffer.from(d).toString("utf8")));
  await new Promise<void>((resolve) => {
    docker.modem.demuxStream(stream, sink, sink);
    stream.on("end", resolve);
    stream.on("close", resolve);
  });
  const info = await ex.inspect();
  return { code: info.ExitCode ?? 0 };
}

/** Log/estado ao vivo de uma execução. */
export function getDeployLog(runId: string): { log: string; status: string; done: boolean; commitSha: string | null; exitCode: number | null } {
  const st = deployState.get(runId);
  if (!st) return { log: "", status: "running", done: false, commitSha: null, exitCode: null };
  return { log: redact(st.log), status: st.status, done: st.done, commitSha: st.commitSha, exitCode: st.exitCode };
}

/** Dispara o deploy em BACKGROUND (retorna já); o progresso vai para deployState. */
export function startDeploy(args: RunDeployArgs): void {
  deployState.set(args.runId, { log: "", status: "running", done: false, commitSha: null, exitCode: null });
  void runDeployInner(args).catch((err) => { appendLog(args.runId, "\n" + String(err)); finalize(args.runId, "failed", 1, null); });
}

/** Grava o log do deploy DENTRO do ambiente do usuário (/veloz/deploys/<runId>.log)
 *  e poda para manter só os últimos N (0 = nunca apaga). */
async function writeLogToEnv(containerId: string, runId: string, log: string, limit: number): Promise<void> {
  const b64 = Buffer.from(log, "utf8").toString("base64");
  const prune = limit > 0
    ? `cd /veloz/deploys && ls -1t *.log 2>/dev/null | tail -n +${limit + 1} | xargs -r rm -f;`
    : "";
  const script = `mkdir -p /veloz/deploys && (printf '%s' '${b64}' | base64 -d > /veloz/deploys/${runId}.log); ${prune} true`;
  await execIn(containerId, ["sh", "-c", script]);
}

async function runDeployInner(args: RunDeployArgs): Promise<void> {
  const runId = args.runId;
  const c = await startBuildContainer(args.envId, args.image, args.buildEnv, args.http);
  let commitSha: string | null = null;
  try {
    appendLog(runId, "::vp:phase:build\n");
    const script = buildScript(args);
    const b64 = Buffer.from(script, "utf8").toString("base64");
    const r = await execStream(c.id, ["bash", "-lc", `printf '%s' '${b64}' | base64 -d > /workspace/build.sh && bash /workspace/build.sh`], runId);
    if (r.code !== 0) { finalize(runId, "failed", r.code, null); return; }

    const sha = await execIn(c.id, ["sh", "-c", "cat /workspace/out/.veloz-sha 2>/dev/null | tr -d '\\n'"]);
    commitSha = sha.out.trim() || null;

    appendLog(runId, "\n::vp:phase:place\ncolocando os arquivos no ambiente…\n");
    if (args.framework === "laravel") await placeLaravel(c, args.appContainerId);
    else if (args.framework === "spa" || args.framework === "static") await placeStatic(c, args.appContainerId, args.workdir);
    else if (args.framework === "dotnet") await placeDotnet(c, args.appContainerId);
    else await placeIntoApp(c, args.appContainerId, args.workdir);
    appendLog(runId, "::vp:placed\n");

    // Laravel: artisan/.env vivem em /var/projeto-laravel (fora do docroot).
    const artisanDir = args.framework === "laravel" ? "/var/projeto-laravel" : args.workdir;
    for (const st of args.steps) {
      if (!st.enabled) continue;
      const acmd = appStepCommand(st.kind);
      if (!acmd) continue;
      appendLog(runId, `\n::vp:step:${st.kind}:start\n`);
      const r2 = await execStream(args.appContainerId, ["sh", "-c", `cd '${artisanDir}' && ${acmd}`], runId);
      appendLog(runId, `\n::vp:step:${st.kind}:exit:${r2.code}\n`);
      if (r2.code !== 0) { finalize(runId, "failed", r2.code, commitSha); return; }
    }

    // Pós-deploy: reinicia o app com o novo código / aponta docroot.
    appendLog(runId, "\n::vp:phase:restart\n");
    try {
      if (args.framework === "nextjs") {
        await applyNodeStart(args.appContainerId, "server.js");
      } else if (args.runtimeKind === "python") {
        if (args.framework === "django") await applyPythonCmd(args.appContainerId, args.pythonCmd || "python manage.py runserver 0.0.0.0:80 --insecure --noreload");
        else await applyPythonStart(args.appContainerId, args.nodeStartFile || "app.py");
      } else if (args.runtimeKind === "dotnet") {
        // .NET: comando avançado (se houver) OU redetecção da DLL publicada (*.runtimeconfig.json).
        if (args.dotnetCmd && args.dotnetCmd.trim()) await applyDotnetCmd(args.appContainerId, args.dotnetCmd);
        else await restartDotnet(args.appContainerId);
      } else if (args.framework === "spa" || args.framework === "static") {
        await restartApp(args.appContainerId); // caddy relê /site
      } else if (args.workdir === "/app") {
        await applyNodeStart(args.appContainerId, args.nodeStartFile || "index.js"); // node
      }
      if (args.framework === "laravel") await applyPhpRoot(args.appContainerId, "/var/www", true);
    } catch (e) { appendLog(runId, "aviso: " + String(e) + "\n"); }

    appendLog(runId, "::vp:done\n");
    finalize(runId, "success", 0, commitSha);
  } catch (err) {
    appendLog(runId, "\n" + String(err));
    finalize(runId, "failed", 1, commitSha);
  } finally {
    await killContainer(c);
    try { await writeLogToEnv(args.appContainerId, runId, deployState.get(runId)?.log ?? "", args.historyLimit ?? 10); } catch { /* não falha o deploy por causa do log */ }
  }
}

/**
 * Coloca /workspace/out (no container de build) dentro do workdir do app, SEM
 * recriar o app: getArchive do build -> putArchive num temp do app -> cp -a.
 * cp -a sobrepõe (não apaga) → preserva uploads/.env do cliente.
 */
async function placeIntoApp(buildC: Docker.Container, appContainerId: string, workdir: string): Promise<void> {
  const app = docker.getContainer(appContainerId);
  await execIn(appContainerId, ["sh", "-c", "rm -rf /.veloz-incoming && mkdir -p /.veloz-incoming"]);
  const tar = await buildC.getArchive({ path: "/workspace/out" }); // entrega tar com prefixo out/
  await app.putArchive(tar as unknown as NodeJS.ReadableStream, { path: "/.veloz-incoming" });
  await execIn(appContainerId, [
    "sh",
    "-c",
    `if [ -d /.veloz-incoming/out ]; then cp -a /.veloz-incoming/out/. '${workdir}'/ ; fi; rm -rf /.veloz-incoming`,
  ]);
}

/**
 * Estático (SPA/site pronto): deploy LIMPO — apaga o docroot (/site) preservando
 * só os arquivos internos /.vp-* (Caddyfile) e copia o artefato novo.
 */
async function placeStatic(buildC: Docker.Container, appContainerId: string, docroot: string): Promise<void> {
  const app = docker.getContainer(appContainerId);
  await execIn(appContainerId, ["sh", "-c", "rm -rf /.veloz-incoming && mkdir -p /.veloz-incoming"]);
  const tar = await buildC.getArchive({ path: "/workspace/out" });
  await app.putArchive(tar as unknown as NodeJS.ReadableStream, { path: "/.veloz-incoming" });
  await execIn(appContainerId, [
    "sh",
    "-c",
    `if [ -d /.veloz-incoming/out ]; then ` +
      `find '${docroot}' -mindepth 1 -maxdepth 1 ! -name '.vp-*' -exec rm -rf {} + ; ` +
      `cp -a /.veloz-incoming/out/. '${docroot}'/ ; fi; rm -rf /.veloz-incoming`,
  ]);
}

/**
 * .NET: deploy LIMPO em /app — a saída do `dotnet publish` é auto-contida, então
 * DLLs antigas não podem sobrar (senão o supervisor acharia o runtimeconfig errado).
 * Apaga tudo em /app (os marcadores /.vp-* vivem em /, fora do volume) e copia o novo.
 */
async function placeDotnet(buildC: Docker.Container, appContainerId: string): Promise<void> {
  const app = docker.getContainer(appContainerId);
  await execIn(appContainerId, ["sh", "-c", "rm -rf /.veloz-incoming && mkdir -p /.veloz-incoming"]);
  const tar = await buildC.getArchive({ path: "/workspace/out" });
  await app.putArchive(tar as unknown as NodeJS.ReadableStream, { path: "/.veloz-incoming" });
  await execIn(appContainerId, [
    "sh",
    "-c",
    `if [ -d /.veloz-incoming/out ]; then ` +
      `find /app -mindepth 1 -maxdepth 1 -exec rm -rf {} + ; ` +
      `cp -a /.veloz-incoming/out/. /app/ ; fi; rm -rf /.veloz-incoming`,
  ]);
}

/**
 * Colocação do layout Laravel: separa o artefato em dois destinos no MESMO
 * container do app (o build entrega out/www e out/framework):
 *   /var/www              = conteúdo do public/ (docroot) — recriado por inteiro a cada deploy.
 *   /var/projeto-laravel  = o framework — recriado, mas PRESERVA storage/ e .env (estado do cliente).
 * Assim o código/.env ficam FORA do docroot (nunca são servidos) e /var/www nunca acumula lixo.
 */
async function placeLaravel(buildC: Docker.Container, appContainerId: string): Promise<void> {
  const app = docker.getContainer(appContainerId);
  await execIn(appContainerId, ["sh", "-c", "rm -rf /.veloz-incoming && mkdir -p /.veloz-incoming"]);
  const tar = await buildC.getArchive({ path: "/workspace/out" });
  await app.putArchive(tar as unknown as NodeJS.ReadableStream, { path: "/.veloz-incoming" });
  const reorg = [
    "set -e",
    "mkdir -p /var/projeto-laravel",
    // framework: atualiza o código, preservando storage/ (uploads/logs) e .env (segredos)
    "find /var/projeto-laravel -mindepth 1 -maxdepth 1 ! -name storage ! -name .env -exec rm -rf {} +",
    "cp -a /.veloz-incoming/out/framework/. /var/projeto-laravel/",
    "cp /.veloz-incoming/out/.veloz-sha /var/projeto-laravel/.veloz-sha 2>/dev/null || true",
    // diretórios graváveis garantidos (inclusive no 1º deploy)
    "mkdir -p /var/projeto-laravel/storage/app/public /var/projeto-laravel/storage/framework/cache /var/projeto-laravel/storage/framework/sessions /var/projeto-laravel/storage/framework/views /var/projeto-laravel/bootstrap/cache",
    "chmod -R ug+rwX /var/projeto-laravel/storage /var/projeto-laravel/bootstrap/cache",
    // www: substitui 100% (uploads ficam no storage do framework, via symlink)
    "find /var/www -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
    "cp -a /.veloz-incoming/out/www/. /var/www/",
    "ln -sfn /var/projeto-laravel/storage/app/public /var/www/storage",
    "rm -rf /.veloz-incoming",
  ].join("; ");
  await execIn(appContainerId, ["sh", "-c", reorg]);
}

/** Limpa tudo do deploy no nó: containers de build + volume (checkout, chave, node_modules). */
export async function resetDeploy(envId: string): Promise<void> {
  try {
    const list = await docker.listContainers({ all: true, filters: { label: [`vp.env=${envId}`, "vp.role=build"] } });
    for (const c of list) await docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
  } catch { /* ignora */ }
  await docker.getVolume(volName(envId)).remove({ force: true }).catch(() => {});
}

/** Redige segredos óbvios do log (valores longos após = de chaves *_KEY/_TOKEN/_SECRET/PASS). */
function redact(log: string): string {
  return log
    .replace(/([A-Z0-9_]*(KEY|TOKEN|SECRET|PASS|PASSWORD)[A-Z0-9_]*=)\S+/gi, "$1[redacted]")
    .slice(-64000);
}
