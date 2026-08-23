All load-bearing facts confirmed against the real code: postgres **3.4.9** installed with `sql.reserve()` present (16 refs); `db/client.ts` is a single default pool (`max 10`); `allocateAddress` does an unconditional `insert` with no unique on `(env_id, role)` (furo 2 real); `agent.ts` `call()` uses `fetch` **sem `signal`** (furo 5.3 real); `environments.nodeId` já é nullable e não existe `error_message`; enum de estados completo no contracts.

---

# DOCUMENTO DE IMPLEMENTAÇÃO — Fila de provisionamento/remoção assíncrona (VelozPanel)

## 1. RESUMO

Criar e deletar ambiente deixam de ser síncronos. As rotas passam a **gravar o estado (`provisioning`/`deleting`) + enfileirar um job numa tabela `jobs` no Postgres, num único commit, e responder na hora**. Um **worker em loop no processo da API** (mesmo template do `startBillingScheduler`) reclama jobs com `FOR UPDATE SKIP LOCKED`, serializa por ambiente com **advisory lock de sessão sobre conexão reservada (`sql.reserve()`)**, executa handlers **reconciliadores** (`agent.provision`/`remove` idempotentes) e materializa o resultado final (`running`/`error`, ou linha removida). O estado é **persistente**: sobrevive ao F5. Retry com backoff exponencial cobre nó/agente offline sem piscar "error"; job preso é recuperado por reaper + auto-release do lock no crash da conexão.

## 2. DECISÕES TRAVADAS

| Tema | Decisão | Porquê (curto) |
|---|---|---|
| **Fila: Postgres vs Redis** | **Postgres** (tabela `jobs`, `FOR UPDATE SKIP LOCKED`). | Já é a fonte de verdade na WireGuard; advisory lock já é padrão do projeto (`ipam.ts:29`). **Atomicidade decisiva:** gravar `state='provisioning'` + enfileirar o job têm de ser **um commit** — impossível cruzando Postgres+Redis. O Redis que o painel provisiona é **container do cliente**, não infra de controle. Volume real (dezenas/dia) torna BullMQ over-engineering. |
| **Onde roda o worker** | Loop `setInterval` (~2s) no processo da API, plugado em `server.ts` ao lado de `startBilling`/`startMetrics`; `handle.unref?.()`. | Zero processo/porta novos. Escala horizontal grátis: cada réplica roda o worker, `SKIP LOCKED` + advisory lock evitam colisão. Vira entrypoint standalone depois, se preciso, sem duplicar código. |
| **Serialização por env** | **`sql.reserve()` + `pg_try_advisory_lock` de sessão** (não `xact`), pool **dedicado** do worker. | Lock e unlock **na mesma conexão física** (o pool default quebraria isso → lock vazado). Auto-libera no crash do worker (TCP cai → backend termina → lock some). Garante ≤1 job por env cluster-wide (provision-vs-delete, retry-vs-original, reaper-vs-vivo). |
| **Retry / backoff** | Exponencial com jitter: `run_after = now() + least(300s, 2^attempts · 5s) + random()·2s`. `provision max_attempts=8`, `delete max_attempts=20`. Erros classificados: `PermanentJobError` → falha direto; transitório → retry. | Nó/agente offline não deve queimar tentativas nem piscar "error". Delete tem horizonte de horas (não vazar recurso do dono). |
| **Recuperação de job preso** | (a) **auto-release** do advisory lock no crash (conexão cai); (b) **reaper** re-enfileira `jobs` `running` com `heartbeat_at < now()-90s`; (c) **heartbeat** de 20s mantém job longo vivo; (d) **timeout** `AbortSignal.timeout` no `agent.call` (provision 600s, status 15s) como teto anti-hang. | O `await agent.provision` é um único ponto longo; sem heartbeat o reaper o mataria; sem timeout um TCP pendurado trava o worker para sempre. |
| **Delete com agente offline** | **Nunca purgar a linha** deixando container/volume/IP órfãos. `DELETE`+`releaseAddresses` só **depois** de `agent.remove` confirmar (ou inspect provar que sumiu). Exausto → `error` + `audit env.delete_stuck`, linha fica em `deleting`. | Billing só cobra `running|paused`; env preso em `deleting` não custa ao cliente, mas órfão no nó vaza recurso pago do dono (é o bug atual do `DELETE` com `agentUrl=null`). |
| **Contrato DELETE** | `204` → **`202` + `environmentSchema`** (estado `deleting`). | O front precisa do estado transitório para pintar "Removendo…". |

## 3. MODELO DA TABELA `jobs`

DDL exato (em `push-and-seed.ts:createSchema`, estilo `CREATE TABLE IF NOT EXISTS`; espelhar tipo drizzle em `schema.ts`):

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,                  -- 'provision_env' | 'delete_env'
  env_id        uuid NOT NULL,                  -- SEM FK (delete apaga a linha do env)
  payload       jsonb NOT NULL DEFAULT '{}',    -- { category, region, template } (dados imutáveis do pedido)
  status        text NOT NULL DEFAULT 'queued', -- queued|running|done|failed|canceled
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 8,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_by     text,
  locked_at     timestamptz,
  heartbeat_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (run_after) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS jobs_env_idx   ON jobs (env_id, created_at DESC);
```

**Estados (`status`):** `queued` (aguardando) → `running` (reclamado, com lock) → `done` | `failed` | `canceled`. Transições: reaper `running→queued`; retry `running→queued` (com `run_after` futuro); sucesso `→done`; exausto/permanente `→failed`; delete cancela provision pendente `queued→canceled`.

**Claim atômico** (uma instrução, N workers):
```sql
WITH next AS (
  SELECT id FROM jobs
   WHERE status='queued' AND run_after <= now()
   ORDER BY run_after, created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1
)
UPDATE jobs j
   SET status='running', locked_by=$1, locked_at=now(),
       heartbeat_at=now(), attempts=attempts+1, updated_at=now()
  FROM next WHERE j.id = next.id
RETURNING j.*;
```
A serialização **por env NÃO fica no claim** (subselect `env_id NOT IN (...)` é TOCTOU sob READ COMMITTED) — fica no advisory lock (item [worker]).

`env_id` **sem FK** é deliberado: o `delete_env` apaga a linha de `environments`; com CASCADE o job se apagaria. Assim ele sobrevive à remoção, fica auditável e o "Tentar de novo" ainda o acha. Índice de claim **parcial** (`WHERE status='queued'`) fica pequeno mesmo com histórico.

## 4. CHECKLIST DE IMPLEMENTAÇÃO (ordenado por dependência)

### [schema/db]
- [ ] **(S)** `push-and-seed.ts:createSchema` — `CREATE TABLE IF NOT EXISTS jobs` + os dois índices acima.
- [ ] **(S)** `push-and-seed.ts` — `CREATE UNIQUE INDEX IF NOT EXISTS env_addresses_env_role_key ON env_addresses (env_id, role);` (fecha o vazamento de IP por retry).
- [ ] **(S)** `push-and-seed.ts` — `ALTER TABLE environments ADD COLUMN IF NOT EXISTS error_message text;`
- [ ] **(S)** `schema.ts` — tabela drizzle `jobs` (ao lado de `deployRuns`) + `errorMessage: text("error_message")` em `environments`.

### [api/fila+worker]
- [ ] **(M)** `ipam.ts:allocateAddress` — get-or-create idempotente: no topo do `sql.begin`, `SELECT ip FROM env_addresses WHERE env_id=$env AND role=$role` → se existe, **reusa** (retorna `Allocation` com IP + bridge via `ownerNetworkFor`). `insert` final vira `... ON CONFLICT (env_id, role) DO NOTHING`.
- [ ] **(S)** `agent.ts:call` — adicionar `signal: AbortSignal.timeout(ms)` no `fetch` (provision/service `600_000`; status/stats/remove `15_000`). Estouro = throw = retry.
- [ ] **(M)** `apps/agent/src/docker.ts` — `provision`/`provisionService`: antes de `createContainer`, `docker.listContainers({ all:true, filters:{ label:['vp.env='+envId] } })` + `remove({force:true})` em cada. (Container já é criado com `Labels:{'vp.env':envId}` em `docker.ts:397`.)
- [ ] **(L)** **novo** `apps/api/src/provisioner.ts`:
  - `PermanentJobError` (classe).
  - `runProvisionJob(job)` — **reconciliador**: carrega grupo (raiz + filhos por `parentEnvId`); para cada linha **não `running`**: se `nodeId` null → `pickNodeForNewEnv` e grava; `allocateAddress` (idempotente); `agent.provision`/`provisionService` (idempotente por label); grava `containerId/httpPort/state='running'`. Linha já `running` com container vivo → pula. `getPlan(env.plan)` relido no job. Reusa os blocos de `environments.ts` (provision `391-433`, `createServiceEnv:154-190`, `createStackEnv:221-275`) guiados pelo **estado atual**, não pela ordem.
  - `runDeleteJob(job)` — corpo do `DELETE:536-556`, mas `DELETE`+`releaseAddresses` **só depois** de `agent.remove` confirmar (ou inspect provar ausência). Agente fora → throw → retry.
- [ ] **(L)** **novo** `apps/api/src/worker.ts` — `startProvisionWorker(log): () => void`:
  - Pool dedicado `const wsql = postgres(DATABASE_URL, { max: WORKER_CONCURRENCY + 2 })`.
  - `setInterval(~2000ms)` + `handle.unref?.()`; contador `inFlight` (não booleano).
  - **Reaper** (antes do claim): `UPDATE jobs SET status='queued', locked_by=null, locked_at=null, last_error=coalesce(last_error,'')||' [reaped]' WHERE status='running' AND heartbeat_at < now()-interval '90 seconds'`.
  - **Claim** (via `wsql`) enquanto `inFlight < WORKER_CONCURRENCY` (env, default 2); dispara `void runJob(job)`; `inFlight++`/`finally --`.
  - **Poda**: `DELETE FROM jobs WHERE status IN ('done','canceled') AND finished_at < now()-interval '7 days'`.
  - `runJob(job)`: `const conn = await wsql.reserve()` → `pg_try_advisory_lock(hashtextextended(envId,0))`; se não pegar → devolve job (`queued`, `run_after=now()+5s`), `conn.release()`, sai. Senão: inicia **heartbeat** `setInterval(20s)` (`UPDATE jobs SET heartbeat_at=now()` pelo `db` normal); executa handler; sucesso → `done`+`finished_at`; falha → `PermanentJobError`→`failed`, senão `attempts<max`→`queued`+backoff+`last_error`, senão `failed`; terminal → espelha efeito no env (§estado). `finally`: limpa heartbeat, `pg_advisory_unlock(...)` **na mesma `conn`**, `conn.release()`.
  - **Backoff**: `run_after = now() + least(interval '300 seconds', pow(2,attempts)*interval '5 seconds') + random()*interval '2 seconds'`.
- [ ] **(S)** `apps/api/src/server.ts` (~155) — `const stopWorker = startProvisionWorker(app.log);` ao lado de `stopBilling`; chamar `stopWorker()` no `shutdown` (SIGINT/SIGTERM, ~157-165); fechar `wsql` no stop.

### [api/rotas create+delete]
- [ ] **(M)** `environments.ts:POST /environments` — manter síncrono só o que erra na hora (`requireUser`, `getPlan` 400, limite `409 env_limit_reached`, validação `type`/`runtime`). Depois `db.transaction`: `INSERT environments state='provisioning', nodeId=null`; template nextjs (`378-387`, só DB); `INSERT jobs (kind='provision_env', env_id, payload)`; commit → **200 + Environment** (`provisioning`). `pickNodeForNewEnv`+`allocateAddress` **saem** para o job.
- [ ] **(M)** `environments.ts:DELETE /environments/:id` — `loadEnvironmentForUser` (403/404); `db.transaction`: `UPDATE environments SET state='deleting'` raiz **e** filhos; `UPDATE jobs SET status='canceled', finished_at=now() WHERE env_id=$id AND kind='provision_env' AND status='queued'`; `INSERT jobs (kind='delete_env', env_id)`; **202 + environmentSchema** (`deleting`).
- [ ] **(M)** **novo** `POST /environments/:id/retry` — guarda anti-duplo-enfileiramento (`SELECT 1 FROM jobs WHERE env_id=$id AND status IN ('queued','running')` → `409` se houver); senão re-enfileira o `kind` do último job (`ORDER BY created_at DESC LIMIT 1`) e volta `state` para `provisioning`/`deleting`.
- [ ] **(S)** `environments.ts:toEnvironment` (~46) — expor `errorMessage`.

### [contracts]
- [ ] **(S)** `packages/contracts/src/index.ts` — `errorMessage: z.string().nullable().optional()` no `environment`; ajustar response do DELETE `204`→`202`+`environmentSchema`; (opcional) schema de `job`/retry.

### [painel/UX]
- [ ] **(S)** `lib/api.ts` — `deleteEnvironment` passa a ler o `202`+body; novo `retryEnvironment(id)`.
- [ ] **(S)** `page.tsx:50` — `refetchInterval: (q) => q.state.data?.some(e => e.state==='provisioning'||e.state==='deleting') ? 3000 : false`.
- [ ] **(S)** `env/[id]/layout.tsx:98` — mesmo poll condicional no `["environment", id]`.
- [ ] **(S)** `env/[id]/layout.tsx:125` — delete mutation espera **202**; `onSuccess`: invalida `["environments"]`, toast "Removendo…", **fica na tela** (linha some sozinha quando o poll deixa de trazê-la); **não** `router.replace` imediato.
- [ ] **(M)** `layout.tsx` — desabilitar ações (abrir/pausar/iniciar/deletar/trocar-runtime) quando `state ∈ {provisioning, deleting}`.
- [ ] **(S)** `EnvStateBadge`/card — em `error`, mostrar `errorMessage` (tooltip) + botão **"Tentar de novo"** (chama `retryEnvironment`). Badges dos 5 estados já existem.

## 5. FLUXO DE TESTE PONTA-A-PONTA

1. **Criar → provisionando:** `POST /environments`. Resposta imediata (200) com `state='provisioning'`. Card mostra "Provisionando" (spinner). No DB: 1 linha `environments provisioning` + 1 `jobs queued`.
2. **F5 mantém:** recarregar a lista → ainda "Provisionando" (estado persistente, não em memória). Poll de 3s ativo.
3. **Fica running:** worker reclama o job (`running`, lock por env), `pickNodeForNewEnv`+`allocateAddress`+`agent.provision`, grava `running`. Em ≤3s o card vira "Ativo"; job vira `done`. Poll para (nenhum transitório).
4. **Deletar → removendo → some:** `DELETE`. Resposta 202, `state='deleting'`, toast "Removendo…", usuário fica na tela. F5 mantém "Excluindo". Worker roda `delete_env`: `agent.remove` confirma → `DELETE` linhas + `releaseAddresses`. Linha some do poll; lista atualiza sozinha.
5. **Falha → error com mensagem:** forçar erro permanente (plano inválido) ou esgotar tentativas → `state='error'` + `errorMessage`. Card mostra badge de erro + tooltip + "Tentar de novo". Clicar → volta a `provisioning`, re-enfileira, guarda 409 se já houver job vivo.
6. **Agente offline → retry sem piscar:** derrubar o agente do nó antes do worker pegar o job. `agent.provision` lança `agent_unreachable` → job volta a `queued` com backoff; env **permanece `provisioning`** entre tentativas (não vira "error"). Subir o agente → próxima tentativa conclui → `running`. Verificar que **não** houve IP/container duplicado (idempotência de `allocateAddress` + label `vp.env`).
7. **Job preso (worker morto):** matar o processo da API no meio de um provision. Reiniciar. Confirmar: lock de sessão auto-liberado (conexão caiu); reaper re-enfileira o `jobs running` após 90s; job retomado; reconciliador pula linhas já `running` e completa as pendentes.

## 6. RISCOS E PONTOS DE ATENÇÃO

- **`sql.reserve()` obrigatório na MESMA conexão** para lock+unlock. Confirmado: postgres **3.4.9** instalado, `reserve()` presente. Nunca usar o `db`/`sql` compartilhado para o par lock/unlock — reintroduz o lock vazado.
- **Pool dedicado do worker (`wsql`)**: conexões reservadas ficam seguras por minutos (provision inclui pull de imagem). Se saírem do pool da API (`max 10`), esfomeiam os handlers HTTP. Dimensionar `max = WORKER_CONCURRENCY + 2` e fechar no shutdown.
- **`allocateAddress` idempotente + unique `(env_id, role)`**: sem isso, cada retry insere um 2º IP e `toEnvironment` (`find(a=>a.role==='service')`) lê IP fantasma. É o furo mais silencioso — verificar o `ON CONFLICT` e o unique index antes de habilitar retry.
- **`agent.provision` idempotente por label**: retry sem a limpeza `vp.env=<id>` deixa container órfão duplicado. Depende da mudança no **agente** (`docker.ts`) — coordenar deploy dos dois lados.
- **Timeout finito mas generoso**: 600s no provision para cobrir `ensureImage`/pull na 1ª subida; heartbeat de 20s mantém o job vivo (reaper 90s não o mata). Timeout curto demais = retries eternos na primeira imagem grande.
- **Delete não-destrutivo**: jamais apagar a linha sem confirmação do agente — é o vazamento atual (`DELETE` com `agentUrl=null`). `max_attempts=20` + `deleting` persistente; exausto vira `error`+`audit env.delete_stuck`, sem apagar.
- **Reconciliação de stacks**: `createStackEnv` é sequencial (filho→app); o handler deve decidir por **linha `environments`** (não reexecutar o corpo linear), senão retry reprovisiona o filho já `running`.
- **`env_id` sem FK**: intencional; lembrar que nenhum CASCADE limpa `jobs` — a poda de 7 dias é a única limpeza. Monitorar crescimento se o volume subir.
- **Migração de contrato DELETE 204→202**: quebra clientes que esperam corpo vazio; ajustar `lib/api.ts` e a mutation juntos.
- **Múltiplas réplicas de API**: cada uma roda o worker; `locked_by` deve ser único por processo (ex.: `hostname:pid`) para diagnóstico. `SKIP LOCKED` + advisory lock já garantem exclusão mútua.