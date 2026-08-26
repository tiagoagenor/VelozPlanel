# Arquitetura do Jamees (velozPanel) — estado atual

> Painel de hospedagem **multi-tenant** próprio. Marca visível: **Jamees** (roxo `#634ca8`).
> Identificadores internos/infra continuam `velozPanel`/`velozplanel/*` (não renomear).
>
> Documento gerado a partir de um levantamento por especialistas (um por camada) sobre o
> código **como está hoje**. Diagrama: `docs/arquitetura.png`.

---

## 1. Visão geral

O Jamees é um "mini-cloud" que deixa o cliente criar ambientes (sites/apps e serviços de
banco) que rodam em **containers Docker** espalhados por vários **nós de hospedagem**. Um
**plano de controle** central orquestra tudo (banco de controle, API, painel, DNS, borda
HTTPS) e fala com um **agente** em cada nó por uma malha privada **WireGuard**.

Dois grandes tipos de ambiente:
- **Código** (`category: app`): `static`, `node`, `php`, `python`, `dotnet` — cada um roda o
  app do cliente na porta 80 do seu container.
- **Serviço/Stack** (`service`/`stack`): `mysql`, `mariadb`, `postgres`, `mongodb`, `redis`,
  `rabbitmq`, e stacks `n8n`/`wordpress` (app + banco-filho).

---

## 2. Monorepo

pnpm workspaces (Node ≥22), sem turbo — build/typecheck por pacote (`tsc --noEmit`), runtime
via `tsx` (api/agent) e `next` (painel).

```
apps/
  api/      @velozplanel/api      — Fastify 5 + Drizzle (Postgres). O "cérebro".
  agent/    @velozplanel/agent    — Fastify 5 + dockerode. Um por NÓ; fala com o docker.sock.
  painel/   @velozplanel/painel   — Next.js 15 (App Router) + React Query. A UI.
packages/
  contracts/    @velozplanel/contracts   — FONTE DA VERDADE (Zod): tipos e validação.
  db-console/   @velozplanel/db-console  — motor do Jamees Studio (protocolo de banco).
```

- **`contracts`** é importado por **api + painel + agente**: os mesmos schemas Zod validam a
  request/response na API, tipam o painel e definem o "contrato de fio" com o agente. Os
  `Record<RuntimeKind, …>` são exaustivos → adicionar um runtime novo quebra o typecheck até
  cobrir todos os mapas (foi o que garantiu o .NET completo).
- **`db-console`** é a lógica ÚNICA de banco do Studio (classify → build → parse), usada pela
  API (valida) e pelo agente (executa via `docker exec`).

---

## 3. Topologia de produção

Três servidores numa malha **WireGuard `10.100.0.0/24`** (o hub tem porta pública; os nós
conectam nele, então nó atrás de NAT funciona sem porta de entrada).

```
                                   INTERNET
              80/443 (sites/painel) │ 53 (DNS) │ 51820/udp (WireGuard)
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  CONTROL-PLANE / HUB  (público)          WireGuard hub 10.100.0.1      │
│  docker compose (rede vpnet):                                          │
│    caddy :80/:443  ──/api/*──▶ api :4000   ──resto──▶ painel :3000     │
│    postgres (controle)   mariadb (bancos legados, só no IP WG :3306)   │
│    pdns / PowerDNS (:53 público+WG; HTTP API :8081 só interna)         │
└───────────────┬──────────────────────────────────────────────────────┘
                │  WireGuard 10.100.0.0/24  —  tráfego de GESTÃO
                │  API → agente :4100   (x-agent-token)
     ┌──────────┴───────────────────────────────┐
     ▼                                           ▼
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ NÓ público 10.100.0.4        │     │ NÓ caseiro (NAT) 10.100.0.3 │
│ agent :4100 (só no IP WG)    │     │ agent :4100 (só no IP WG)   │
│ monta /var/run/docker.sock   │     │ monta docker.sock           │
│ Caddy nativo (ingress domínio│     │ SSH gw :2222 via forward    │
│ SSH/SFTP gw :2222/:2223      │     │  do hub                     │
│ + host de build das imagens  │     │                             │
│                              │     │                             │
│ bridges POR-DONO (isoladas): │     │ bridges por-dono idem       │
│   veloz-u0  10.201.0.0/24    │     │   veloz-u1  10.201.1.0/24   │
│   veloz-u1  10.201.1.0/24 …  │     │   (app+banco do MESMO dono  │
│   IP fixo por container      │     │    se falam; outros donos   │
│   app ⇄ banco do MESMO dono  │     │    ficam isolados)          │
└─────────────────────────────┘     └─────────────────────────────┘
```

- **Control-plane / hub**: servidor público. Postgres (banco de controle) + MariaDB
  (compartilhado, bancos "legados" dos clientes) + API + Painel + Caddy (borda 80/443) +
  PowerDNS autoritativo. É o hub WireGuard.
- **Nós de hospedagem**: rodam **só o agente**, que cria os containers dos clientes no
  `docker.sock` local. Um deles (público, mais parrudo) também é o **host de build** das
  imagens da plataforma. O nó caseiro está atrás de NAT e só sai pela WireGuard.

> Observação: os *templates* versionados em `deploy/` usam sub-redes de exemplo (`10.77.x`);
> a malha **em produção hoje** é `10.100.0.0/24` (hub `.1`, nós `.3`/`.4`) e as bridges por
> dono são `10.201.<slot>.0/24`.

---

## 4. As camadas

### 4.1 Painel (frontend) — `apps/painel`
- **Next.js 15 (App Router)**, React 19, Tailwind v4 (CSS-first), **React Query**, gráficos
  com uPlot, ícones lucide + PNGs de tecnologia (`public/img/tech`).
- Fala **direto** com a API (`http(s)://<host>:4000/api/v1`), sem proxy, com cookie de
  sessão httpOnly **`vp_session`** (`credentials: include`). Middleware redireciona a `/login`
  se não houver cookie.
- Dois grupos de rota:
  - **`(app)`** — cliente: lista de ambientes, `/env/[id]` com abas (Visão geral, Domínio &
    DNS, Configurações, Arquivos, SSL, SSH, SFTP, Deploy, Variáveis, **Data Studio**, Logs,
    Backups), `/dominios`, `/financeiro`. Guard `AuthGuard` + `AppShell`.
  - **`(admin)`** — super admin (`role==="admin"`): visão geral da frota, nós, usuários,
    ambientes de qualquer dono, rede (WireGuard), DNS global, **Planos e Preços**,
    Faturamento, auditoria. Guard `AdminAuthGuard` + `AdminShell`.
- Padrão de dados: `useQuery` → `lib/api.ts` → API; mutations invalidam as queries. Logs e
  Redis pub/sub usam **SSE**. Ambiente em `provisioning`/`deleting` faz polling (3s).

### 4.2 API / Control-plane — `apps/api`
- **Fastify 5 + Zod** (via `fastify-type-provider-zod`), **Drizzle** sobre **Postgres**
  (`postgres-js`), porta 4000, prefixo `/api/v1`.
- **Auth**: JWT em cookie httpOnly (`vp_session`), senhas bcrypt. **Segredos em repouso**
  cifrados com AES-256-GCM (env vars, credenciais de serviço, chaves de deploy).
- **Provisionamento assíncrono**: a API só enfileira `jobs` (`provision_env`/`delete_env`);
  um **worker** (fila persistente com `FOR UPDATE SKIP LOCKED` + advisory lock por env)
  reconcilia chamando o agente do nó. Escala horizontal "de graça" (cada réplica roda os
  loops; a fila evita colisão).
- **4 loops de fundo**: coletor de métricas (5s), cobrança (checa a cada 30s), worker da fila,
  verificador de DNS (~5min).
- **IPAM** (`ipam.ts`): cada `(dono, nó)` recebe um `/24` (`10.201.<slot>.0/24`, bridge
  `veloz-u<slot>`); cada container ganha IP fixo. Livro-razão em `owner_networks` /
  `env_addresses`.
- **DNS**: gerencia o **PowerDNS** pela HTTP API (nunca escreve no SQL do pdns).
- **Ingress**: publica `<sub>.jamees.top` no Caddy do control-plane; domínios próprios do
  cliente vão no Caddy de cada nó (via agente).
- **Billing**: pró-rata por hora (preço do plano + adicional do tipo)/720; acerto ao deletar
  com **cortesia** configurável (`billingFreeMinutes`); rollup horário.

### 4.3 Agente do nó + Runtimes — `apps/agent`
- **Fastify + dockerode**, um por nó, escuta só no IP WireGuard `:4100`, toda rota exige
  `x-agent-token`. Fala com o `docker.sock` local. **O controle chama o agente** (o agente
  quase não faz chamadas de saída, exceto os gateways SSH/SFTP consultando a API interna).
- **Container do app** (`provision`): imagem por runtime, um **supervisor** shell (`cmdFor`)
  que sobe o app na :80 num loop de auto-restart, injeta a página **"site em construção"** se
  não há código, aplica limites reais do kernel (`NanoCpus`, `Memory`, `CpusetCpus`), LXCFS
  (htop/free veem a cota), e nasce com **IP fixo na bridge do dono**.

  | Runtime | Imagem | Como roda na :80 | Volume de código | Deploy |
  |---|---|---|---|---|
  | **static** | `caddy:2-alpine` | Caddy file-server (fallback SPA) | `veloz-code-*` → `/site` | `placeStatic` |
  | **node** | `node:<v>` (base própria) | `node <start>` em loop | — (`/app`) | `placeIntoApp` + start-file |
  | **php** | `php:<v>-cli` (base própria) | `php -S 0.0.0.0:80 -t <docroot>` | — (`/var/www`) | Laravel: `placeLaravel` |
  | **python** | `python:<v>-slim` | `python3 <start>` ou cmd avançado (gunicorn/Django) | `veloz-code-*` → `/app` | `pip --target=.vp-vendor` |
  | **dotnet** | `dotnet/sdk:<v>` | cmd avançado → DLL publicada → `dotnet run` do exemplo | `veloz-code-*` → `/app` | `dotnet publish` → `placeDotnet` |

- **Deploy por git** (`deploy.ts`): sobe um **container de build efêmero irmão** (volume
  `veloz-deploy-*`), clona, roda os passos (`npm`, `composer`, `pip`, `dotnet publish`…),
  monta o artefato e **copia** para o container do app sem recriá-lo. Passos que tocam o banco
  do dono (ex.: `dotnet ef database update`) rodam com o build **ligado à bridge do dono**.
  Chave de deploy é SSH (ed25519), gerada no volume.
- **Serviços** (`provisionService`): container por serviço na bridge do dono, IP fixo, volume
  `veloz-data-*`, **sem porta pública** para bancos, endurecido (`CapDrop NET_RAW/NET_ADMIN`,
  `no-new-privileges`, `PidsLimit`).
- **Gateways** embutidos: **SSH** (`:2222`, só por chave, `docker exec` no container do dono)
  e **SFTP** (`:2223`, só por senha, sem shell).
- **Monitoramento**: `/stats` devolve CPU% **relativo à cota** (travado em 100 — o kernel já
  impõe o teto) e **memória working set** (desconta cache). Logs por snapshot + **SSE**.
- **Jamees Studio**: `/db/exec` executa consultas via `docker exec` usando o `db-console`.

### 4.4 Packages compartilhados
- **`contracts`**: runtimes/versões/labels, planos, ambiente/tipo/categoria, deploy, billing,
  DNS, SSL/SSH/SFTP, admin, e o Jamees Studio. Um símbolo Zod é literalmente o mesmo contrato
  entre as três camadas → zero drift.
- **`db-console`**: `classify` (segurança: statement único, whitelist de verbos, anti-injection,
  read-only por engine), `build` (monta `ExecPlan` por engine; senha nunca interpolada — vem
  por env do container), `parse` (TSV/CSV/EJSON/Redis) e o wrapper estático do Mongo. Ponto
  único de evolução (trocar `docker exec` por um sidecar no futuro).

---

## 5. Fluxos principais

**Criar ambiente** — Painel `POST /environments` → API valida plano/tipo + saldo → grava
`environments (state: provisioning)` + enfileira `provision_env` → **worker** escolhe o nó
menos carregado, aloca IP (IPAM) e chama `agent.provision` → agente cria o container na bridge
do dono, sobe o supervisor na :80 → API grava `containerId/httpPort`, `state: running` e publica
`<sub>.jamees.top` no Caddy.

**Deploy** — Painel conecta o repo (deploy key SSH) → `POST …/deploy/run` → API cria
`deploy_run` e chama `agent.startDeploy` → agente sobe o **build container**, roda os passos e
**coloca** o artefato no container do app → reinicia o app → log via SSE.

**Cobrança** — cron (a cada 30s, respeitando o intervalo) debita pró-rata cada ambiente
`running/paused` em `credit_transactions`; ao **deletar**, faz o acerto do tempo usado com a
cortesia de X minutos; se o saldo zera e `suspendOnZero`, pausa os ambientes.

**Acesso do cliente ao site** — 100% **público por domínio**: o Caddy do nó (ou do
control-plane, para `<sub>.jamees.top`) faz `reverse_proxy` para o container, com HTTPS
Let's Encrypt automático. Não depende da WireGuard.

---

## 6. Rede: GESTÃO vs PÚBLICO

- **Gestão** (privado, só WireGuard): API → agente (`:4100`), app → MariaDB compartilhado
  (`10.100.0.1:3306`), gateways SSH/SFTP consultando `/internal/*`. Portas 4100/3306 e os
  endpoints `/internal/*` **nunca** ficam públicos (o Caddy bloqueia `/internal/*` com 403).
- **Público** (cliente final): Caddy em cada nó/control-plane serve os sites por domínio com
  HTTPS automático. O site do nó continua no ar mesmo se o control-plane cair.

---

## 7. Segurança & isolamento multi-tenant

- **Rede por dono**: cada dono tem bridges `veloz-u<slot>` isoladas; app e serviços do MESMO
  dono se falam (IP fixo), donos diferentes ficam separados. Bancos sem porta no host.
- **Agente**: toda a API `:4100` exige `x-agent-token` (defesa em profundidade).
- **Segredos**: env vars e credenciais cifradas em repouso (AES-256-GCM); a senha do banco
  **nunca** sai do container (nem a API decifra para o Studio — o comando referencia a env).
- **Serviços endurecidos**: `CapDrop NET_RAW/NET_ADMIN` (anti ARP-spoof na bridge),
  `no-new-privileges`, `PidsLimit`.
- **Gateways**: SSH só por chave, SFTP só por senha, ambos confinados ao container do dono
  via `docker exec` (nunca shell no host).

---

## 8. Persistência (o que sobrevive a recreate)

- **Control-plane**: `pgdata` (controle), `mariadata` (bancos legados), `caddy_data/config`.
- **Por ambiente** (nos nós): `veloz-code-*` (código de python/static/dotnet), `veloz-data-*`
  (dados de serviço/banco), `veloz-deploy-*` (workspace de build). O container do cliente é
  recriado na **mesma bridge/IP** (via `owner_networks`/`env_addresses`).
- Config de MySQL: como não há `my.cnf` montado, o jeito durável ao recreate é
  `SET PERSIST/PERSIST_ONLY` (grava em `mysqld-auto.cnf`, dentro do volume de dados).

---

## 9. Modelo de dados (control-plane / Postgres)

Sem migrations — schema por `CREATE TABLE IF NOT EXISTS` + seed idempotente (`pnpm db:push`).
Colunas de enum são `text`, validadas na borda pelos contratos.

- **Identidade/infra**: `users`, `nodes` (região, capacidade, `agentUrl` WG), `wg_peers`.
- **Ambientes**: `environments` (central), `metric_samples`, `env_vars` (cifradas),
  `service_credentials` (cifradas), `env_tools`, `databases`.
- **Catálogo (super admin)**: `plans` (recurso/preço), `env_types` (categoria/adicional/mín.),
  `reserved_subdomains`.
- **Rede/IPAM**: `owner_networks`, `env_addresses`.
- **Deploy**: `deploy_configs`, `deploy_steps`, `deploy_runs`.
- **Acesso**: `ssl_configs`, `ssh_configs`, `ssh_keys`, `sftp_configs`.
- **Fila/operação**: `jobs` (fila persistente), `audit_logs`.
- **DNS**: `dns_zones_meta`, `env_domains` (o resto no DB `pdns`).
- **Billing**: `credit_transactions`, `platform_settings`, `billing_run_hours`.

---

## 10. Pipeline de deploy das imagens

- Imagens da plataforma: `velozplanel/{api,painel,agent}:prod`, buildadas na raiz do monorepo
  no **nó de build** (mais parrudo, para não pesar no hub).
- Transferência: `docker save | ssh <destino> 'docker load'` (api/painel → control-plane;
  agent → cada nó), depois `docker compose up -d` no control-plane e `docker run` (agente) nos
  nós.
- Imagens base ricas dos runtimes de cliente: `deploy/base-images/{php,node,python}.Dockerfile`
  (com git/toolchain) via `build-base.sh`. Runtime .NET usa a SDK oficial diretamente.

---

*Marca visível: Jamees. Núcleo/infra: velozPanel. Este documento reflete o código em produção
na data da geração; o diagrama visual está em `docs/arquitetura.png`.*
