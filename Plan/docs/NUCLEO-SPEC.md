# NÚCLEO — Especificação de build (contrato entre API, Agente e Painel)

> Documento que TODOS os agentes de construção seguem à risca, para as peças integrarem.
> Roda tudo LOCAL (Mac com Docker). Fonte de tipos: `packages/contracts` (`@velozplanel/contracts`).

## Portas e serviços
| Serviço | Porta | Origem |
|---|---|---|
| Painel (Next.js) | 3000 | `apps/painel` |
| API (Fastify) | 4000 | `apps/api` |
| Agente (Fastify + dockerode) | 4100 | `apps/agent` |
| Postgres | 5433 (host) → 5432 | `infra/docker-compose.yml` |

DB URL: `postgres://veloz:veloz_dev@localhost:5433/velozpanel`

## Versões (pinar; não usar "latest")
- TypeScript ^5.7, tsx ^4.19 (dev runner), Node >=22.
- API/Agente: fastify ^5.1, @fastify/cors ^10, @fastify/cookie ^11, fastify-type-provider-zod ^4, zod ^3.24, drizzle-orm ^0.38, drizzle-kit ^0.30, postgres ^3.4 (driver `postgres`), dockerode ^4.0, @types/dockerode, pino ^9, pino-pretty ^13.
- Painel: next ^15.5, react ^19, react-dom ^19, tailwindcss ^4, @tailwindcss/postcss ^4, @tanstack/react-query ^5, uplot ^1.6. shadcn/ui: componentes copiados em `src/components/ui`. `transpilePackages: ["@velozplanel/contracts"]` no next.config.

## Auth
- Cookie de sessão httpOnly `vp_session` (JWT assinado, segredo em env `VP_JWT_SECRET`, default dev `dev-secret`).
- Seed (rodar no db:push/seed): usuários `admin@veloz.dev` (role admin) e `client@veloz.dev` (role client), senha ambos `veloz123` (hash bcrypt/argon2). Seed 1 nó local `node-local` (region `local`) representando o agente.

## HTTP da API (`/api/v1`, porta 4000) — usa schemas do contracts
- `POST /auth/login` body `loginInput` → seta cookie, retorna `sessionUser`. 401 se inválido.
- `POST /auth/logout` → limpa cookie, 204.
- `GET  /auth/me` → `sessionUser` | 401.
- `GET  /nodes` → `node[]` (admin).
- `GET  /environments` → `environment[]` (client vê os próprios; admin vê todos).
- `POST /environments` body `createEnvironmentInput` → cria no DB (state `provisioning`), chama Agente `POST /provision`, salva `containerId`+`httpPort`, muda para `running`, retorna `environment`.
- `GET  /environments/:id` → `environment`.
- `POST /environments/:id/pause` → chama Agente `/stop`, state `paused`.
- `POST /environments/:id/start` → chama Agente `/start`, state `running`.
- `DELETE /environments/:id` → chama Agente delete, remove do DB, 204.
- `GET  /environments/:id/metrics?window=15m` → `metricSeries` (amostras do DB).
- CORS: permitir `http://localhost:3000` com `credentials: true`.
- Coletor: a cada 5s, para cada env `running`, chamar Agente `GET /stats/:containerId` e inserir `metric_samples`.

## HTTP do Agente (porta 4100) — driver Docker (dockerode)
- `POST /provision` body `{envId, name, runtime:{kind,version}, limits:{vcpu,memMb}}` →
  cria container:
  - php: imagem `php:<version>-cli`, comando serve `index.php` via `php -S 0.0.0.0:80 -t /var/www` com um index gerado mostrando nome do ambiente, runtime e versão.
  - node: imagem `node:<version>-alpine`, roda um http server inline que responde a mesma página.
  - `HostConfig.Memory = memMb*1024*1024`, `HostConfig.NanoCpus = vcpu*1e9`, publica porta 80 → porta livre do host (retorna em `httpPort`), `RestartPolicy` none, label `vp.env=<envId>`.
  → retorna `{containerId, httpPort}`.
- `POST /start` `{containerId}` → docker start. `POST /stop` `{containerId}` → docker stop.
- `DELETE /container/:containerId` → stop+remove.
- `GET /stats/:containerId` → lê docker stats (uma amostra), calcula `cpuPct` (relativo à cota),
  retorna `{cpuPct, memBytes, memLimitBytes}` (formato de `metricSample` sem `ts`).
- Puxa a imagem se não existir (docker pull) antes de criar.

## DB (Drizzle, owned by API)
Tabelas: `users(id,email,name,role,password_hash,created_at)`,
`nodes(id,name,region,status,vcpu_total,mem_mb_total,last_seen_at)`,
`environments(id,name,owner_id,node_id,plan,runtime_kind,runtime_version,state,container_id,http_port,created_at)`,
`metric_samples(id,env_id,ts,cpu_pct,mem_bytes,mem_limit_bytes)`.
Índice em `metric_samples(env_id, ts)`.

## Painel (Next.js, porta 3000)
Páginas (App Router):
- `/login` — form (email/senha), chama API login, redireciona.
- `/` (dashboard) — lista de ambientes do usuário (card: nome, runtime+versão, estado com cor+ícone+texto,
  botão pausar/iniciar, link abrir o site do container em `http://localhost:<httpPort>`), botão "Criar ambiente".
- `/env/[id]` — detalhe: estado, plano, runtime, botões pausar/iniciar/abrir/excluir, e **2 gráficos** (CPU% e RAM)
  com uPlot, atualizando via TanStack Query (poll 5s) do endpoint metrics.
- `/admin/nodes` — (só admin) lista de nós com status.
- Criar ambiente: modal/página com nome, seletor de plano (PLANS), seletor de runtime (kind + versão de RUNTIME_VERSIONS).
- Estados do ambiente sempre com **cor + ícone + texto** (nunca só cor). Paleta acessível (contraste ≥ 4.5).
- Cliente de API em `src/lib/api.ts` (fetch com `credentials: "include"`, base `http://localhost:4000/api/v1`).

## Como rodar (o dono vai usar isto)
1. `pnpm install`
2. `pnpm dev:db` (sobe Postgres) e `pnpm db:push` (schema + seed)
3. Terminais: `pnpm dev:agent`, `pnpm dev:api`, `pnpm dev:painel`
4. Abrir `http://localhost:3000`, login `client@veloz.dev` / `veloz123`.

## Critério de aceite (o que EU valido antes de chamar o dono)
Login funciona; criar ambiente PHP 8.3 sobe container real e abre a página dele no browser;
pausar para o container (e some da porta); iniciar volta; gráficos de CPU/RAM preenchem; admin vê o nó.
Nenhum erro no console dos 3 serviços.
