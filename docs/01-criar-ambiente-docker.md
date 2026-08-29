# 01 — Criar um ambiente: a camada Docker

Como o container de um ambiente é criado no nó. Todo o trabalho com o Docker daemon acontece no **agente** (`apps/agent/src/docker.ts`, via `dockerode`), chamado pela API por HTTP sobre WireGuard. A API decide **o quê**; o agente faz **como**.

Há **três formas** de ambiente, com funções distintas no agente:

| Forma | Função no agente | Exemplos |
|---|---|---|
| **app** (código) | `provision()` — `docker.ts:623-725` | php, node, python, dotnet, static |
| **service** (banco/serviço) | `provisionService()` — `docker.ts:819-873` | redis, mysql, mariadb, postgres, mongodb, rabbitmq |
| **stack** (app + banco-filho) | orquestra 2× `provisionService` — `provisioner.ts:116-162` | n8n, wordpress |

---

## 1. App de código — `provision()`

Ordem (`docker.ts:623-694`):

1. `resolveImage(runtime)` → `ensureImage()` (§4).
2. `removeExistingByEnv(envId)` — remove qualquer container com label `vp.env=<envId>` (idempotência em retry).
3. `lxcfsBinds()` (§6) — binds do LXCFS.
4. Volume de código `veloz-code-<envId>` **só** para python/dotnet (`→/app`) e static (`→/site`) (§5).
5. `pickCpuset(vcpu)` (§6).
6. `ensureNetwork(...)` — bridge do dono (ver [02](02-ambiente-rede.md)).
7. `createContainer(...)` → `start()`.

### Objeto real do `createContainer` (`docker.ts:648-692`)

```ts
{
  Image: image,                                   // resolveImage(runtime) — base rica ou oficial
  ...(runtime.kind === "static" ? { Entrypoint: ["/bin/sh"] } : {}),  // caddy tem ENTRYPOINT próprio
  Cmd: cmdFor(runtime, args.startupScript),       // o SUPERVISOR do runtime (§7)
  Env: [
    `VP_ENV_NAME=${name}`,
    `VP_RUNTIME_KIND=${runtime.kind}`,
    `VP_RUNTIME_VERSION=${runtime.version}`,
    `VP_NODE_START=${startFile || "index.js"}`,    // arquivo de start do Node na 1ª subida
    `VP_PY_START=${startFile || "app.py"}`,
    `VP_PY_CMD=${base64(pythonCmd) | ""}`,         // comando avançado Django/gunicorn (base64)
    `VP_DOTNET_CMD=${base64(dotnetCmd) | ""}`,
    `VP_PAGE_B64=${CONSTRUCTION_B64}`,             // página "em construção" do placeholder
    `VP_PHP_ROOT=${phpRoot || "/var/www"}`,
    ...envVars                                     // env REAL do Docker (do cliente), filtrando
                                                   // RESERVED_ENV e prefixo VP_
  ],
  Labels: { "vp.env": envId },
  ExposedPorts: { "80/tcp": {} },
  HostConfig: {
    Memory:   Math.round(limits.memMb * 1024 * 1024),   // teto de RAM (bytes) — OOM-kill do kernel
    NanoCpus: Math.round(limits.vcpu * 1e9),            // cota de CPU (CFS) — LIMITE REAL
    CpusetCpus: cpuset || undefined,                    // cores VISÍVEIS (cosmético p/ htop/nproc)
    RestartPolicy: { Name: "unless-stopped" },          // volta após crash/OOM/reboot
    Init: true,                                         // tini como PID 1 (reap de zumbis, SIGTERM)
    Binds: binds.length ? binds : undefined,            // LXCFS + veloz-code (se houver)
    PortBindings: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "" }] },  // porta EFÊMERA no host
  },
  ...(attachNet ? { NetworkingConfig: { EndpointsConfig: {
      [network.name]: { IPAMConfig: { IPv4Address: ip } } } } } : {}),  // IP fixo na bridge do dono
}
```

Pós-criação (`docker.ts:694-724`):
- `start()`.
- `writeEnvFileAndRestart` — materializa `/veloz/env` (§7).
- `waitForPort` (`docker.ts:948-960`) — espera a :80 publicar (20× 200 ms). Se não escutar → remove o container e devolve erro **"o app precisa escutar em 0.0.0.0:80"** com o tail do log.
- `readRuntimeVersion` — grava `runtimeVersionFull` (versão real).
- Retorna `{ containerId, httpPort, versionFull, phpNodeVersionFull }`.

> **A porta do app é sempre a :80 do container**, publicada numa **porta efêmera do host** (`HostPort: ""` → o Docker escolhe). O agente lê a porta real via `inspect()` (`NetworkSettings.Ports["80/tcp"][0].HostPort`) e devolve como `httpPort`, que a API persiste em `environments.http_port`. É esse `httpPort` que o Caddy do control-plane usa como upstream (ver [02](02-ambiente-rede.md)).

---

## 2. Serviço (banco) — `provisionService()`

Diferenças-chave vs app: usa **imagem stock** (não a base de runtime), monta **volume de dados**, roda o **entrypoint nativo** da imagem (sem supervisor/`Cmd`), readiness por **exec** (não por porta), **não publica porta** no host (salvo painel embutido), e aplica **mais hardening**.

Ordem (`docker.ts:819-862`): `removeExistingByEnv` → `ensureImage` → `ensureNetwork` → volume `veloz-data-<envId>` no `dataPath` → filtra env → `pickCpuset` → `createContainer` → `start` → `waitReady`.

### Objeto real (`docker.ts:837-860`)

```ts
{
  Image: args.image,                                 // et.image, ex.: "rabbitmq:3-management"
  Env: env.length ? env : undefined,                 // credenciais do serviço (RABBITMQ_DEFAULT_USER…)
  Labels: { "vp.env": envId, "vp.role": role ?? "service" },
  ExposedPorts: pubKey ? { [pubKey]: {} } : undefined,   // só se publishPort setado
  HostConfig: {
    Memory:   Math.round(memMb * 1024 * 1024),
    NanoCpus: Math.round(vcpu * 1e9),
    CpusetCpus: cpuset || undefined,
    RestartPolicy: { Name: "unless-stopped" },
    Init: true,
    PidsLimit: 512,                                   // teto de PIDs (anti fork-bomb) — cgroup
    CapDrop: ["NET_RAW", "NET_ADMIN"],                // mata ARP-spoof L2 na bridge compartilhada
    SecurityOpt: ["no-new-privileges"],              // sem escalada via binário setuid
    Binds: binds.length ? binds : undefined,         // veloz-data (se dataPath)
    PortBindings: pubKey ? { [pubKey]: [{ HostIp:"0.0.0.0", HostPort:"" }] } : undefined,
  },
  NetworkingConfig: { EndpointsConfig: { [network.name]: { IPAMConfig: { IPv4Address: ip } } } },
}
```

- `pubKey = publishPort ? "<publishPort>/tcp" : null`. Bancos puros = `null` (nenhuma porta no host; só alcançáveis pelo IP interno da bridge). **Exceção:** serviços com painel web embutido publicam essa porta — ex.: RabbitMQ publica a **15672** (a UI de management), enquanto a **5672** (AMQP) fica interna. Ver [painel de serviço](../apps/api/src/service-panel.ts).
- Readiness: `waitReady(readiness)` (`docker.ts:784-792`) roda o comando via `sh -lc` até 40× (1 s de intervalo) até exit 0. Comandos por engine em `apps/api/src/services.ts`:
  - redis: `redis-cli ping | grep -q PONG`
  - mysql/mariadb: `mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" ... alive`
  - postgres: `pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q`
  - rabbitmq: `rabbitmq-diagnostics -q ping`
  - mongodb: `mongosh --quiet --eval "db.adminCommand('ping').ok"`

> ⚠️ **Assimetria de hardening (documentar!):** `PidsLimit`, `CapDrop` e `SecurityOpt` estão **só** no container de **serviço** (`provisionService`). O container de **app** (`provision`, `docker.ts:678-687`) **não** aplica nenhum deles hoje — só `Memory`, `NanoCpus`, `CpusetCpus`, `Init` e `RestartPolicy`. Se for endurecer apps, é aqui.

---

## 3. Stack (app + banco-filho) — `provisionStackEnv()`

`apps/api/src/provisioner.ts:116-162`. Um ambiente-stack tem **duas linhas** em `environments` (a raiz + a `-db` filha, ligada por `parentEnvId`) e **dois containers**:

1. **Banco-filho primeiro** (`:128-146`): `allocateAddress(childEnv.id, "service")`, credenciais próprias, `provisionService(role:"service")` sem publishPort. Grava container/estado do filho.
2. **App da stack** (`:149-161`): `allocateAddress(root.id, "app")`; reconstrói as credenciais reais do filho (`rebuildCreds`) e injeta no app via `stackAppEnv(...)` (ex.: `DB_POSTGRESDB_HOST/PORT/USER/PASSWORD` para o n8n, `services.ts:129-133`); `provisionService(role:"app", publishPort: et.internalPort, readiness: null)`. O app publica a porta web (n8n=5678, wordpress=80) e recebe `httpPort` → ganha subdomínio.

---

## 4. Resolução de imagem

`apps/agent/src/docker.ts`:

- `customImage(runtime)` (`:192-194`): `velozplanel/<kind>:<version>` — a **base rica** (composer/extensões/git/toolchain/pnpm).
- `officialImage(runtime)` (`:197-215`): fallback cru — `php:<v>-cli`, `python:<v>-slim`, `node:<v>-alpine`, `static → caddy:2-alpine`, `dotnet → mcr.microsoft.com/dotnet/sdk:<v>` (major 1–4 → `dotnet/core/sdk`).
- `resolveImage(runtime)` (`:222-230`): tenta `inspect` da base rica localmente; se existe usa, senão cai na oficial. Permite **rollout incremental** das bases por nó.
- `ensureImage(image)` (`:174-189`): `inspect`; se faltar, `docker.pull` (`followProgress`).

### Base images — `deploy/base-images/`

- `php.Dockerfile` — `FROM php:<v>-cli` + composer 2 + git/unzip/zip/rsync/libs-dev + extensões `pdo_mysql mysqli zip gd intl bcmath exif soap pcntl` + PECL `igbinary redis`.
- `node.Dockerfile` — `FROM node:<v>-slim` (Debian; evita node-gyp/musl do Alpine) + git/curl/python3/build-essential/tini + pnpm + openssh.
- `python.Dockerfile` — `FROM python:<v>-slim` + git/build-essential/tini + gunicorn/whitenoise; alias `python→python3`.
- Build: `deploy/base-images/build-base.sh <php|node|python> <versões...>` → `docker build --build-arg <KIND>_VERSION=$V -t velozplanel/<kind>:$V`.

### Versões suportadas — `packages/contracts/src/index.ts:21-27` (`RUNTIME_VERSIONS`)

```
php:    5.6, 7.0, 7.2, 7.3, 7.4, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5
node:   18, 20, 22, 24, 25, 26
python: 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14
static: ["1"]  (pseudovalor — estático não tem versão)
dotnet: 3.0, 3.1, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0
```

`RECOMMENDED_VERSION` (`:30-36`): php 8.3, node 24, python 3.12, dotnet 8.0. Enum `runtimeKind` em `:14`. **Adicionar um runtime/versão novo:** editar `RUNTIME_VERSIONS`/`runtimeKind` nos contracts, tratar o `kind` em `resolveImage`/`officialImage`/`cmdFor` (agente) e, se tiver base rica, buildar via `build-base.sh` e distribuir a imagem para os nós.

---

## 5. Volumes — o que sobrevive a quê

`ensureNamedVolume(name, envId)` (`docker.ts:761-767`): `inspect`; se faltar, cria com label `vp.env=<envId>`.

| Volume | Quando | Conteúdo |
|---|---|---|
| `veloz-code-<envId>` | apps **python / dotnet** (`→/app`) e **static** (`→/site`) | o código buildado |
| `veloz-data-<envId>` | serviços com `dataPath` (`envTypes.dataPath`) | datadir do banco (ex.: rabbitmq `/var/lib/rabbitmq`) |
| `veloz-deploy-<envId>` | container de build efêmero (`→/workspace`) | repo clonado, chave SSH, artefato (ver [03](03-deploy.md)) |

**Node e PHP NÃO têm volume de código** — o código vive no rootfs do container e é a fonte-da-verdade o **git** (deploy).

### Restart × recreate (durabilidade)

- **Reiniciar / pausar-iniciar / reboot do nó (mesmo container):** preserva **tudo** — volume ou não. `RestartPolicy: unless-stopped` faz o container voltar sozinho após crash/OOM/reboot.
- **Recriar o container (recreate)** — ex.: troca de versão de runtime, ou o toggle do painel que republica a porta: **só o que está em volume nomeado** sobrevive:
  - Serviços → dados em `veloz-data` ✅
  - Python/.NET/Static → código em `veloz-code` ✅
  - Node/PHP → código no rootfs ❌ (perde no recreate; restaurado pelo **deploy git**)
- Os volumes só são apagados no **delete job** (ver [04](04-ciclo-de-vida.md)).

---

## 6. LXCFS, cpuset e limites de recurso

- **LXCFS** (`docker.ts:560-572`, ligado por `VP_LXCFS`): bind-mounts de `/var/lib/lxcfs/proc/{cpuinfo,meminfo,stat,uptime,loadavg,diskstats,swaps}` sobre `/proc/*`. Efeito: dentro do container, `htop`/`top`/`free`/`nproc` mostram os recursos **do plano**, não do host. Se o nó não tiver lxcfs instalado, deixar `VP_LXCFS` desligado.
- **cpuset** (`pickCpuset`, `docker.ts:597-621`, só com LXCFS): escolhe `ceil(vcpu)` cores (mín 1, máx = cores do host), os **menos usados** pelos outros containers `vp.env` (espalha carga). É **cosmético** (quantos cores o `nproc`/htop mostram); a **cota real de CPU continua sendo `NanoCpus`**.
- **Limites kernel-enforced** (não são cosméticos): `Memory` (cgroup memory → OOM-kill), `NanoCpus` (CFS quota → limite real de CPU), `PidsLimit` (cgroup pids, só serviços), `CapDrop`/`SecurityOpt` (capabilities/no-new-privileges, só serviços). Ver a nota sobre monitoramento (CPU% travado em 100, memória = working set) em `Plan/`/histórico.

---

## 7. Supervisor, startup script e injeção de env

Apps de código não rodam o processo direto: o `Cmd` é um **supervisor** shell (`cmdFor`, `docker.ts:265-374`) que:

1. **startup_script (1ª subida)** — `setupPrefix` (`docker.ts:241-249`): grava o script do cliente em base64 (à prova de aspas) em `/veloz-startup.sh` e roda **uma vez**, guardado pelo marcador `/.veloz-init-done`. Falha no script não derruba o app.
2. **carrega `/veloz/env`** — `LOAD_ENV` (`docker.ts:260-263`): lê linhas `KEY=base64(valor)`, corta só no 1º `=` (`k=${line%%=*}; v=${line#*=}`) e `export "$k=$(printf %s "$v" | base64 -d)"`. **Nunca** usa `source`/`set -a` → injeção de shell é impossível (o valor vem base64).
3. **loop do processo** — relança o app (relendo os arquivos de controle `/.vp-node-start`, `/.vp-python-cmd`, `/.vp-php-root`, etc. e o `/veloz/env`) sempre que ele cai. O "restart" pós-deploy = matar o PID em `/.vp-app-pid` (o supervisor relança) — **não** recria o container.

### Injeção de variáveis de ambiente (duas vias)

1. **Env real do Docker** na 1ª subida (`Env[]` do createContainer), filtrando `RESERVED_ENV` (`PATH,LD_PRELOAD,LD_LIBRARY_PATH,NVM_DIR,HOME,PWD,SHELL,IFS,ENV,BASH_ENV,PS4`, `docker.ts:254`) e o prefixo `VP_`.
2. **`/veloz/env`** materializado por `writeEnvFileAndRestart` (`docker.ts:397-408`), `chmod 600`, relido pelo supervisor a cada subida. Marcador `/.veloz-env-capable` indica que dá para **re-aplicar env ao vivo** (sem recriar). Se ausente (container legado), a resposta é `applied:false, reason:"recreate_required"`.

---

## Resumo — app × service × stack

| | app (`provision`) | service (`provisionService`) | stack |
|---|---|---|---|
| imagem | `resolveImage(runtime)` | `et.image` stock | `child.image` + `et.image` |
| Cmd | supervisor `cmdFor` | entrypoint nativo | entrypoint nativo |
| porta no host | sempre :80 (efêmera) | só se painel (`publishPort`) | app publica `et.internalPort` |
| volume | `veloz-code` (py/dotnet/static) | `veloz-data` (dataPath) | filho `veloz-data`; app conforme tipo |
| hardening | Memory/NanoCpus/Init/Cpuset | + PidsLimit/CapDrop/no-new-privileges | idem service |
| readiness | `waitForPort` :80 | `waitReady` (exec) | filho exec; app readiness null |
| containers | 1 | 1 | 2 |

Continua em: [02 — Ambiente na rede](02-ambiente-rede.md) · [04 — Ciclo de vida](04-ciclo-de-vida.md).
