Anchors confirmed against real code. Here is the execution-ready architecture document.

---

# VelozPanel — Ambientes de Serviço, UIs internas liga/desliga e Preço por Tipo
## Documento de Arquitetura — pronto para execução

---

## 1. RESUMO

Estendemos o VelozPanel para além de apps php/node com deploy Git. Adicionamos **ambientes de serviço sem pipeline** (redis, mysql, mariadb, postgres, rabbitmq) e **stacks prontas com UI própria** (n8n, wordpress), construídos sobre o desenho de rede já aprovado (`Plan/BANCO-POR-AMBIENTE.md`): `/24` por (dono,nó), IP fixo por container, **zero porta pública**, isolamento L2 intra-dono / DROP inter-dono, cross-node só mesma-região via WireGuard.

Quatro entregas encadeadas:
- **Rede (gate absoluto):** bridge por dono + IP fixo por container + livro-razão de IPAM. Sem isto, nenhum serviço é alcançável (não há porta pública).
- **Serviços/Docker:** caminho `provisionService()` novo (imagem stock, entrypoint nativo, volume nomeado, readiness por `exec`), sem tocar em `provision()`.
- **UIs liga/desliga:** phpMyAdmin/Adminer/RedisInsight/RabbitMQ-mgmt acessíveis por **proxy autenticado** (hub→agente→IP interno) só quando ligadas; OFF é atômico (flag+container+IP+rota).
- **Preço por tipo:** catálogo dinâmico `env_types` com preço editável pelo super admin, integrado ao billing/planos/créditos existentes.

**Decisão de modelo travada:** n8n/wordpress = **ambiente-raiz + banco-filho vinculado** (dois `environments`, `parentEnvId`), **não** sidecar. O filho não conta no `maxEnvironments`, mas é cobrado pela sua própria type-price. Injeção app↔banco por **IP fixo** (do livro-razão), nunca DNS Docker.

Sequência: **Rede antes de tudo**. Duas fatias andam em paralelo sem depender da rede: **preço-por-tipo** (control-plane puro) e **UI-proxy** (salto hub↔nó já existe na WG).

---

## 2. DECISÕES TRAVADAS

### 2.1 Rede
- **Bridge `veloz-u<slot>` por (dono,nó)**, subnet `/24`, `--internal=false` (o host/gateway `.1` precisa alcançar para proxy/ingress).
- **IP fixo por container** via `EndpointsConfig[net].IPAMConfig.IPv4Address` no `createContainer`. Invariante: **um IP por container**, todos do mesmo `/24` do dono (não "um IP por ambiente").
- **Livro-razão de IPAM** obrigatório: `environments.ip` (uma coluna) não basta — um ambiente pode ter N containers (app + tool). Tabela `env_addresses(nodeId, envId, role, ip, containerId)`.
- **Zero `PortBindings` / zero `ExposedPorts` no host.** O `PortBindings 0.0.0.0` de `docker.ts:413` é o furo a remover, não copiar. Único listener norte-sul possível: Caddy-do-nó para domínio público opcional (só wordpress).
- **Isolamento confirmado:** app↔db, tool→db, proxy→tool são todos **mesma bridge = L2** → com `bridge-nf-call-iptables=0` os frames não sobem para `DOCKER-USER`, o DROP nem é avaliado. Inter-dono é L3 roteado entre `/24`s → atravessa FORWARD/`DOCKER-USER` linha 4 = DROP.
- **Afinidade same-node OBRIGATÓRIA** para o par app↔banco. Cross-node permanece inerte no R1 (`AllowedIPs=10.77.0.1/32`, sem `wg_routes`). `pickNodeForNewEnv` retorna `no_node_for_bundle` se nenhum nó couber o par.

### 2.2 Serviços / Apps
- **Bifurcar, não adaptar:** `provisionService()` novo; `provision()` (php/node) intacto. `provision()` é inservível (exige :80 publicada, `waitForPort` dá `throw` em `docker.ts:425`, injeta supervisor stub, não monta volume).
- **Imagem stock + entrypoint nativo:** sem `Cmd`, sem `cmdFor`, sem stub.
- **Volume de dados nomeado** `veloz-data-<envId>` (molde `ensureVolume`, `deploy.ts:47`), montado em `type.dataPath`, **preservado no delete** (purge explícito).
- **Readiness por `exec`** (reusa `execCapture`, `docker.ts:459`): `redis-cli ping`, `mariadb-admin ping`, `pg_isready`, `rabbitmq-diagnostics ping`, `curl -sf localhost:<port>` (n8n/wp). **Nunca `waitForPort`.**
- **Endurecimento:** manter `RestartPolicy unless-stopped` + `Init:true`; adicionar `PidsLimit`, `no-new-privileges`, `CapDrop [NET_RAW, NET_ADMIN]` (mata ARP-spoof L2 no `/24` compartilhado).
- **`diskUsage` mede o VOLUME**, não `SizeRw` (`docker.ts:561`) — senão o dado stateful some da métrica e da cobrança de disco-pausado.

### 2.3 n8n / WordPress + banco
- **Ambiente-raiz + banco-filho vinculado** (env separado, `parentEnvId=raiz`, mesmo dono/nó). **Não sidecar.**
- **Ordem de provisionamento:** filho primeiro (obtém `child.ip`) → raiz injetando `WORDPRESS_DB_HOST=<child.ip>` / `DB_POSTGRESDB_HOST=<child.ip>` + credenciais do filho.
- **Credenciais gerenciadas namespaced `VP_`** (mescladas pelo agente, read-only no painel) — **não** env-vars comuns, senão o PUT-substitui de `env-vars.ts` as apaga na próxima edição do cliente.
- **`maxEnvironments` intacto:** contagem em `environments.ts` filtra `parentEnvId IS NULL`. WordPress = 1 slot.
- **Lifecycle cascateia** raiz→filho (start/stop/delete). Delete preserva volumes salvo purge.
- **Domínio público OPCIONAL só wordpress.** n8n `allowsPublicDomain=false` — a tela pública do n8n É o painel de automação; expor furaria o `forward_auth`.

### 2.4 UIs liga/desliga
- Tabela `env_tools(envId, kind, enabled, containerId, ip, targetIp, targetPort)` (molde `sshConfigs.enabled`).
- Mapeamento: mysql/mariadb→**phpMyAdmin**, postgres→**Adminer**, redis→**RedisInsight**, rabbitmq→**mgmt embutida** (não sobe container-irmão).
- **OFF de UI-sidecar** (phpMyAdmin/Adminer/RedisInsight) = atômico: flag `authz=false` + stop/rm do container + **libera IP no `env_addresses`** + rota morre. **OFF de UI-embutida** (rabbitmq-mgmt/wp-admin/n8n) = **só revoga authz** (não há container para matar; porta interna segue escutando, inócua sem caminho público). Distinção declarada explicitamente.
- **ON só publica a rota após readiness** da ferramenta (evita 502 autenticado pendurado).
- **Acesso:** ticket assinado curto por sessão-de-tool (JWT/HMAC, escopo `envId+kind+exp`), cookie **host-only no subdomínio da ferramenta** — **não** esticar `vp_session` para `Domain=.<paneldomain>`.

### 2.5 Preço por Tipo
- **TIPO é dono do preço de compute.** Em `runBilling`: `env.typeId` → `envType.priceMonthCents/720`; fallback `plan.priceMonthCents` (legado).
- **Disco-em-pausa fica no PLANO** (`plan.diskGb*25/720`) — sem cobrança dupla.
- **PLANO continua** tier de recurso (vcpu/mem/disk) + dono do `maxEnvironments` + rate de disco-pausa.
- **Stack = soma de dois type-prices** (wordpress + mariadb), ambos editáveis, exibidos com quebra.
- **Super admin edita** via `POST/PATCH/DELETE /admin/env-types` espelhando `/admin/plans` (`requireAdmin`+`recordAudit`, 409 `type_in_use` no delete).
- **Seed** popula php/node com o preço atual → não altera cobrança de quem já existe.

### 2.6 Segurança
- `CapDrop [NET_RAW, NET_ADMIN]`, `no-new-privileges`, `PidsLimit`/`Ulimits` por engine em todo container de serviço.
- Credenciais cifradas com `encryptSecret` (`crypto.ts`, `"v1:"+base64`) em `service_credentials` — **ao contrário de `databases.ts` que descarta a senha**, aqui persiste (necessária p/ injetar no app e autenticar a UI-tool).
- **Senha de serviço re-exibível** (Mostrar/Ocultar) + Reset para rotação — porque o sistema persiste a senha; "1×" seria desonesto. *(Pendência de sign-off 2.6: se política exigir 1×-only, reverte ao padrão reveal-SSH.)*
- Caddy-do-nó (se domínio público): **ACME DNS-01** (sem inbound :80), allowlist estrita de `server_name`, disca **só o IP do app** — jamais db/tool, jamais wildcard. Versionado e coberto por `node-doctor`.

---

## 3. CATÁLOGO DE TIPOS (`env_types`)

Tabela dinâmica com CRUD admin (irmã de `plans`). `priceMonthCents` editável pelo super admin.

| id (slug) | category | image | internalPort | dataPath | temUI? (defaultTool) | precisaBanco? (childType) | allowsPublicDomain | preço (super admin) |
|---|---|---|---|---|---|---|---|---|
| `php` | app | `velozplanel/php:<v>` | 80 | (deploy volume) | não | não | não | = preço atual (seed) |
| `node` | app | `velozplanel/node:<v>` | 80 | (deploy volume) | não | não | não | = preço atual (seed) |
| `redis` | service | `redis:7-alpine` | 6379 | `/data` | RedisInsight *(ou nenhum)* | não | não | **editável** |
| `mysql` | service | `mysql:8` | 3306 | `/var/lib/mysql` | phpMyAdmin | não | não | **editável** |
| `mariadb` | service | `mariadb:11` | 3306 | `/var/lib/mysql` | phpMyAdmin | não | não | **editável** |
| `postgres` | service | `postgres:16-alpine` | 5432 | `/var/lib/postgresql/data` | Adminer | não | não | **editável** |
| `rabbitmq` | service | `rabbitmq:3-management` | 5672 (mgmt 15672) | `/var/lib/rabbitmq` | mgmt **embutida** | não | não | **editável** |
| `n8n` | stack | `docker.n8n.io/n8nio/n8n` | 5678 | `/home/node/.n8n` | UI própria (embutida) | **postgres** | **não** | **editável** |
| `wordpress` | stack | `wordpress:php8.3-apache` | 80 | `/var/www/html` | wp-admin (embutida) | **mariadb** | **sim** | **editável** |

Colunas da tabela: `id (PK slug)`, `label`, `category`, `image`, `internalPort`, `dataPath`, `needsDb`, `childType`, `defaultTool`, `allowsPublicDomain`, `priceMonthCents`, `active`, `sortOrder`.

---

## 4. CHECKLIST DE IMPLEMENTAÇÃO (ordenado por dependência)

Legenda tamanho: **S** ≤ meio dia · **M** ~1-2 dias · **L** ~3+ dias. Ordem = REDE primeiro; `[preço]` e `[ui-proxy]` podem correr em paralelo (marcados ∥).

### FASE 0 — [infra/rede/host] — GATE ABSOLUTO
- [ ] **S** Versionar `deploy/node/daemon.json`: `bridge-nf-call-iptables=0`, `icc:false` global, log driver. Alvo: `deploy/node/`.
- [ ] **M** Versionar chain `DOCKER-USER` (nft): DROP inter-bridge (linha 4), ACCEPT intra-bridge. Alvo: `deploy/node/nft/`.
- [ ] **S** Script `node-doctor` que valida daemon.json + nft + Caddy-do-nó presentes. Alvo: `deploy/node/node-doctor.sh`.
- [ ] **S** Confirmar em cada nó: `sysctl net.bridge.bridge-nf-call-iptables=0` persistente.

### FASE 1 — [schema/db]
- [ ] **S** Tabela `env_types` (§3). Alvo: `apps/api/src/db/schema.ts`.
- [ ] **S** Tabela `env_addresses(id, nodeId, envId, role, ip, containerId)`, unique `(nodeId, ip)`. `role ∈ {app, db, tool:<kind>}`.
- [ ] **S** Tabela `env_tools(envId, kind, enabled default false, containerId, ip, targetIp, targetPort)`.
- [ ] **S** Tabela `service_credentials(envId, key, valueEncrypted)`.
- [ ] **S** `environments`: adicionar `typeId text` (FK env_types), `parentEnvId text` (FK environments, null=raiz), `publicDomain text` (opt-in). Alvo: `schema.ts:43`.
- [ ] **S** Seed `env_types`: php/node com preço atual; services/stacks com preço inicial. Alvo: `apps/api/src/db/push-and-seed.ts`.

### FASE 2 — [contracts]
- [ ] **S** `createEnvironmentInput`: adicionar `type: z.string()`; `runtime` exigido só quando `category="app"`. Alvo: `packages/contracts/src/index.ts:434`.
- [ ] **S** `environmentSchema`: expor `type`, `category`, `tools?`, `dbLinkedEnvId?`. Alvo: `:117`.
- [ ] **S** `createEnvTypeInput`/`updateEnvTypeInput` espelhando `createPlanInput`/`updatePlanInput` (`:61`/`:77`).
- [ ] **S** `Section` ganha `categories?: EnvCategory[]` no contrato de navegação.

### FASE 3 — [agent/docker] — depende de FASE 0
- [ ] **L** `ensureBridge(ownerId, nodeId)`: cria/reusa `veloz-u<slot>`, subnet `/24`, IPAM. Alvo: `apps/agent/src/docker.ts`.
- [ ] **M** IP fixo via `EndpointsConfig.IPAMConfig.IPv4Address` no createContainer (helper compartilhado app+service).
- [ ] **L** `provisionService(args)`: imagem stock, sem `Cmd`/`PortBindings`/`ExposedPorts`, volume `veloz-data-<envId>` em `dataPath`, readiness por `exec`, endurecimento (`PidsLimit`/`no-new-privileges`/`CapDrop`). Alvo: `docker.ts` (novo, ao lado de `provision():380`).
- [ ] **M** `startTool(envId,kind)`/`stopTool(envId,kind)`: sobe/derruba container-irmão (sem porta), Env `PMA_HOST`/etc. das `service_credentials`, aloca/libera IP em `env_addresses`.
- [ ] **M** `uiProxy(envId, kind, req)`: salto final agente→`ip:targetPort` (irmã de `/files/*`).
- [ ] **S** `diskUsage`: ler tamanho do volume nomeado, não `SizeRw`. Alvo: `docker.ts:561`.
- [ ] **S** Purge de volume no delete (opt-in). 

### FASE 4 — [agent/server] — rotas
- [ ] **S** `POST /provision-service`. Alvo: `apps/agent/src/server.ts:148`.
- [ ] **S** `POST /tool/start`, `POST /tool/stop`.
- [ ] **M** `ALL /uiproxy/:envId/:kind/*` (stream + websocket, molde `/files/*`).
- [ ] **S** Delete cascateia raiz→filho; libera IPs de `env_addresses`.

### FASE 5 — [api/rotas] — orquestração
- [ ] **M** `routes/environments.ts` POST: ramo service/stack — resolve `env_types`, provisiona filho→raiz (ordem), injeta `VP_*` cifradas. Alvo: `:120`, `:169`.
- [ ] **S** `maxEnvironments`: contagem filtra `parentEnvId IS NULL`. Alvo: `:120-134`.
- [ ] **M** `pickNodeForNewEnv({region, ownerId, typeId, parentEnvId?})`: filtro de região dura + headroom (`vcpuTotal`/`memMbTotal`) + afinidade de dono + co-locação do par; erro `no_node_for_bundle`. Alvo: `apps/api/src/nodes.ts:31`.
- [ ] **M** Rota `POST /env/:id/tools/:kind` (enabled true/false) → chama agente + atualiza `env_tools` + emite ticket. 
- [ ] **M** Rota `GET /internal/authz?host=<sub>`: valida ticket + dono==owner(env) + `env_tools.enabled`. Alvo: `apps/api/src/routes/internal.ts`.
- [ ] **S** Rota `POST /env/:id/link-service`: liga ambiente-código a serviço (injeta `VP_DB_HOST`/`VP_REDIS_URL`/`VP_AMQP_URL` gerenciadas).
- [ ] **S** Rota reset de senha de serviço (rotaciona `service_credentials`, re-injeta nos linkados).
- [ ] **S** Injeção `VP_*` no merge de env-vars pelo agente (read-only, não apagável pelo PUT). Alvo: `apps/api/src/routes/env-vars.ts`.

### FASE 6 — [super-admin/preço] ∥ (sem dep. de rede)
- [ ] **S** `plans.ts` equivalente para env_types: `getEnvType`, `listEnvTypes`. Alvo: `apps/api/src/`.
- [ ] **M** `POST/PATCH/DELETE /admin/env-types` espelhando `/admin/plans` (`admin.ts:388/417/438`), `requireAdmin`+`recordAudit`, 409 `type_in_use`.
- [ ] **M** `billing.ts runBilling`: `ratePerHour(running)` usa `envType.priceMonthCents/720` (fallback plano); disco-pausa fica no plano; cobra filhos. Alvo: `apps/api/src/billing.ts:74-82`.
- [ ] **S** `/balance monthlyBurn` soma type-prices incluindo filhos. Alvo: `apps/api/src/routes/plans.ts:45`.

### FASE 7 — [painel/UX]
- [ ] **S** Promover `components/ui/copy-field.tsx` (de `ssh/page.tsx`, prop `secret?`).
- [ ] **S** Promover `components/ui/switch.tsx` (de `ssh/page.tsx:327-347`).
- [ ] **M** `TypePicker` (radiogroup 2-D) + corpo B do `CreateEnvironmentDialog` (Segmented Código/Serviço, preço com quebra p/ needsDb).
- [ ] **M** `SECTIONS` por categoria em `env/[id]/layout.tsx:55-60`; toolbar contextual (`:176`).
- [ ] **M** Telas serviço: Visão geral, Conexão (`/conexao`), Ferramenta (`/ferramenta`).
- [ ] **M** Telas stack: Painel, Banco vinculado (read-only), Domínio & DNS (switch público).
- [ ] **S** `EnvCard` por categoria (ícone/subtítulo/ação/badge). Alvo: `app/(app)/page.tsx:151-302`.
- [ ] **S** Dialog de exclusão: Segmented "Manter/Apagar dados". Alvo: `layout.tsx:269-315`.
- [ ] **M** Página super admin `/admin/precos` (espelho de `admin/planos/page.tsx`).

### FASE 8 — [infra/rede/host] — ingress
- [ ] **M** Caddy hub: vhost `*.ui.<domain>` + `forward_auth`→api + `reverse_proxy`→api. Alvo: `deploy/control-plane/Caddyfile`.
- [ ] **M** Novo Caddy-de-nó (ACME **DNS-01**, allowlist `server_name`, disca só IP do app) para `publicDomain`. Alvo: `deploy/node/`.

### FASE 9 — TESTE PONTA-A-PONTA
1. **Serviço puro:** criar `mysql` → provisiona container stock na bridge, IP fixo, volume, sem porta host. Tela Conexão mostra host interno/porta/user/senha. `docker ps` no nó: **sem `0.0.0.0:*`**.
2. **Isolamento:** de um env de outro dono, `nc <mysql-ip> 3306` → **falha** (DROP). Do mesmo dono → **conecta** (L2).
3. **Link:** ligar env-código ao mysql → aparecem `VP_DB_*` read-only; editar env-vars do cliente **não** apaga as `VP_*`.
4. **Ferramenta:** ligar phpMyAdmin → readiness → botão "Abrir" habilita → subdomínio autenticado abre; usuário de outra conta → **403**. Desligar → container some, IP liberado em `env_addresses`, link morre (**erro/403**).
5. **Stack:** criar `wordpress` → provisiona mariadb-filho primeiro, depois app com `WORDPRESS_DB_HOST=<child.ip>`; `maxEnvironments` conta **1**; wp instala e conecta ao banco.
6. **Domínio público wordpress:** ligar `publicDomain` → A-record → Caddy-do-nó (DNS-01) serve o site; db **inalcançável** da internet.
7. **Preço:** super admin edita preço do mysql → `runBilling` debita nova taxa/720h; stack = wordpress+mariadb somados; `/balance` reflete. Auditoria registra a edição.
8. **Persistência:** stop→start do serviço mantém dados (volume). Delete "Manter dados" preserva volume; recriar reaproveita.
9. **Regressão php/node:** criar app node com deploy Git → fluxo atual **byte-a-byte inalterado**.

---

## 5. SPEC DE UX (resumida)

**Criar ambiente** — um Dialog, Segmented "Código | Serviço/App". Corpo Código = form atual (zero regressão). Corpo Serviço = `TypePicker` (grade 2-D), card selecionado `border-brand bg-brand-soft text-brand-strong`. Preço needsDb com quebra: *"R$ 40,00 + banco MariaDB R$ 20,00 = R$ 60,00/mês · R$ 0,0833/h ativo"*. Faixa neutra (`border-border-subtle bg-bg` + `ShieldCheck text-info`): *"Sem porta pública. Acessível só pela rede interna. Ferramentas abrem por acesso autenticado — só quando você ligar."* Erros: `409 env_limit_reached` (msg API), `409 no_node_for_bundle` → *"Nenhum servidor tem espaço para o app e o banco juntos agora."*

**Serviço · Conexão** — CopyField host interno/porta/usuário/banco/URL; senha `CopyField secret` (Mostrar/Ocultar). Reset com faixa `warning`: *"A senha atual para de valer na hora."* Card "Conectar um ambiente": radiogroup de envs-código + "Ligar automaticamente" + chip *"Variáveis `VP_` são só leitura e não são apagadas quando você edita as suas."*

**Serviço · Ferramenta** — `ui/switch` OFF por padrão. Estados: Ligando (`Loader2`, botão "Abrir" disabled até readiness), ON (`Badge success` "Ligada" + "Abrir phpMyAdmin"), Erro (faixa `danger`). ON→OFF confirma: *"O link para de funcionar na hora. Nenhum dado do banco é afetado."* UI-embutida (rabbitmq/wp/n8n): *"Ligar libera o acesso autenticado; desligar bloqueia — o serviço continua rodando."*

**Stack** — Painel ("Abrir o WordPress"/"Abrir painel do n8n"), Banco vinculado (read-only, "não conta no seu limite"), Domínio (switch "Tornar público" OFF, faixa `warning` *"Público significa exposto à internet"*; n8n sem público).

**Super admin · Preços por tipo** (`/admin/precos`, nav "Preços por tipo", ícone `Tags`) — espelho 1:1 de `admin/planos`. Tabela: `Tipo | Slug | Categoria | Imagem | R$/mês | R$/h ativo | Status | ações`. Dialog edita **label, preço mensal, status**; read-only slug/imagem/porta/dataPath/needsDb. Header: *"Cada tipo de ambiente tem seu próprio preço mensal. Vale para novos ambientes e para a cobrança dos existentes."* Delete 409: *"Há ambientes usando este tipo. Desative-o em vez de excluir."*

**Glossário:** "sem porta pública" / "rede interna" / "host interno fixo"; "Ligar/Desligar" (ferramenta) vs "Ativar/Desativar" (catálogo); preço sempre "R$ X/mês · R$ Y/h ativo", stack com quebra. Faixas: neutra=`border-subtle bg-bg`+`text-info`; cautela=`warning/5`; irreversível=`danger/5`. **Nunca `info/5`.**

---

## 6. RISCOS E AÇÕES NO HOST DE PRODUÇÃO

| Risco | Impacto | Ação no host |
|---|---|---|
| **Gate de rede não versionado** (bloqueio B: `daemon.json`/nft ausentes em `deploy/`) | Sem bridge/IP fixo, nenhum serviço existe; sem DROP, vazamento inter-dono | Entregar FASE 0 **antes** de qualquer `provisionService`. Rodar `node-doctor` em cada nó; recusar provisionar em nó que não passa. |
| **`bridge-nf-call-iptables` volta a 1** após reboot/update do kernel | DROP inter-dono passa a avaliar tráfego L2 intra-dono → app perde o próprio banco | `sysctl` persistente + check no `node-doctor` + alarme. |
| **Esgotamento do `/24`** (tools consomem IPs, muitos envs) | Falha ao ligar ferramenta/criar env | Contabilizar tools na capacidade do `/24`; liberar IP no OFF (atômico); alertar em >80% de ocupação. |
| **Caddy-do-nó reabre inbound na NIC pública** (único furo N-S) | Superfície de ataque cross-tenant (roda no host, alcança todas as bridges) | **ACME DNS-01** (sem inbound :80), allowlist estrita `server_name`, disca só IP do app. Versionar + cobrir no `node-doctor`. Só quando `publicDomain` ligado. |
| **`VP_*` apagadas pelo PUT-substitui** de `env-vars.ts` | App perde conexão ao banco silenciosamente | Chaves `VP_*` gerenciadas, mescladas pelo agente, read-only no painel — nunca gravadas como env-var comum. |
| **Afinidade same-node fragmenta capacidade** | Stack não entra mesmo com dois nós livres | `pickNodeForNewEnv` → `no_node_for_bundle` claro; monitorar headroom por nó; migração cross-node fica para depois do `wg_routes`. |
| **Delete apaga volume por engano** | Perda de dados do cliente | Default "Manter dados"; "Apagar tudo" exige confirmação por nome + faixa `danger`. Volume preservado por padrão. |
| **Billing dobra ou zera na migração** | Cobrança errada de quem já existe | Seed php/node com preço atual (fallback plano intacto); testar `runBilling` em staging com envs legados antes de ligar em prod. Nó local 111 pendente — validar lá primeiro. |
| **Cross-node ainda inerte** (`AllowedIPs=10.77.0.1/32`, sem `wg_routes`) | Qualquer desenho que assuma app/db em nós diferentes quebra | R1 é single-node obrigatório para o par. Não construir nada que dependa de cross-node nesta fase. |

**Pendências de sign-off do dono:** (a) senha de serviço re-exibível vs 1×-only; (b) stack cobrado como soma de dois type-prices vs preço único do tipo; (c) redis com/sem RedisInsight (`defaultTool`).

**Arquivos-âncora confirmados:** `schema.ts` (environments:43, ip:262, wgPeers:267, plans:280, priceMonthCents:286, maxEnvironments:287, creditTransactions:294, sshConfigs:119); `contracts/index.ts` (runtimeKind:11, createPlanInput:61, updatePlanInput:77, createEnvironmentInput:434); `docker.ts` (provision:380, ExposedPorts:404, PortBindings:413, waitForPort throw:425, execCapture:459, diskUsage:561, cmdFor:184); `deploy.ts` (ensureVolume:47); `server.ts` (/provision:148); `nodes.ts` (pickNodeForNewEnv:31); `billing.ts` (74-82); `admin.ts` (plans 388/417/438); `deploy/wireguard/wg-node.conf.example` (AllowedIPs=10.77.0.1/32).