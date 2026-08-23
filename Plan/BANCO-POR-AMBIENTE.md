# SOLUÇÃO ÚNICA — "Banco por Ambiente" com Sub-Rede por Usuário (VelozPanel)

Documento de arquitetura para validação do dono. Sintetiza as 4 rodadas de convergência entre os especialistas de Rede e de Docker. Onde os dois ainda divergiam (sysctl de bridge, medição de disco, DB_HOST, prefixo elástico), o veredito de síntese está marcado **[decisão]**.

---

## 1. RESUMO EXECUTIVO

O banco de dados vira um **ambiente** de tipo `database` (engine `postgres`|`mysql`), com dados em **volume nomeado `veloz-db-<envId>`** (recria sem perder dados), medido e cobrado pelo mesmo pipeline de métrica/plano dos ambientes de app. Cada **(dono, nó)** ganha uma **bridge Docker própria com um `/24` inteiro e chato**: todos os ambientes daquele dono naquele nó (app + banco + outros) vivem nesse `/24`, se falam em **L2 puro** (custo zero) e ficam **isolados de outros donos** por roteamento L3 + regra única de drop. App e banco do mesmo dono em **nós diferentes da mesma região** se falam por **rota `/24` sobre a malha WireGuard existente** com `AllowedIPs` estrito — sem publicar porta. A porta HTTP publicada em `0.0.0.0` (furo norte-sul de hoje) **é eliminada**: o ingress passa a ser reverse-proxy no host discando o IP fixo do ambiente.

---

## 2. ENDEREÇAMENTO — `/24` chato por (dono,nó), leases `/16` de pool realocável

**[decisão] Prefixo elástico morto. `/24` fixo, provisionado inteiro desde o primeiro ambiente do dono no nó.** A crítica do Docker de que "subnet de rede Docker é imutável, crescer /28→/26 força migração de bridge com downtime" fica **resolvida por não existir crescimento**: um `/24` tem 253 hosts úteis e o teto real de densidade do nó é **~200–500 containers no total (TODOS os donos somados)** — é fisicamente impossível um único dono passar de 253 num nó sem estourar a densidade do nó inteiro antes. Logo o `/24` **nunca subdivide, nunca redimensiona, zero lógica de prefixo**.

```
10.0.0.0/8  = FABRIC de containers — autoridade única = control-plane; IP NUNCA infere posição física
  ├─ RESERVADO (fora do pool alocável):
  │     10.77.0.0/16   → malha WireGuard de transporte (produção já usa 10.77.0.0/24)
  │     10.255.0.0/16  → infra / agente / reserva
  └─ POOL alocável = 254 blocos /16
        ├─ node_subnet(nodeId, cidr=/16)  → cada nó ARRENDA ≥1 /16 (linha de tabela, não ordinal)
        └─ dentro do /16 do nó:
              owner_subnet(ownerId, nodeId, cidr=/24)  → UM /24 por (dono,nó)
                 .1 = gateway do bridge · .2–.254 = ambientes · IP fixo em environments.ip
```

**Números fechados:**
- **/16 por nó = 256 `/24`s = 256 donos por nó.** O nó satura por densidade muito antes de esgotar 256 donos → **endereçamento nunca é o primeiro a apertar dentro do nó**.
- **/24 por dono = 253 ambientes úteis** — teto que nenhum dono alcança sem estourar a densidade do nó.
- **Teto de nós:** 254 leases `/16` no `10/8`. Nó denso pega 1 `/16`; nó gigante pega vários. **Ceiling honesto ≈ 254 nós densos.** Capacidade teórica do fabric ≈ 254 × 256 × 253 = **~16,4 milhões de ambientes**; o gargalo real que sempre aparece antes é densidade de nó.
- **Colisão:** impossível por construção — `owner_subnet` tem PK lógica `(ownerId,nodeId)` + `UNIQUE(nodeId,cidr)`, alocação sob advisory lock (§4). **`owner_subnet.cidr` é a ÚNICA verdade**; nenhuma regra infere IP de posição.

**Crescer além de 254 nós — [decisão] sem remendo:** **não** se roda `172.16/12` em paralelo (dois esquemas = a colisão que estamos matando). A saída única e limpa é **re-home do fabric inteiro para `100.64.0.0/10` (CGNAT, ~4,2 mi `/24`s ⇒ ~16 mil nós densos)**, um só esquema, prefixo maior. Como `owner_subnet.cidr` já é a única verdade, migrar = reescrever a coluna + repintar rotas, não redesenhar. E aos 254 nós × ~250 containers ≈ 63 mil containers já se está re-arquitetando de qualquer forma.

**Dono em nós diferentes (mesma região):** **não existe `/24` flutuante multi-nó.** O dono é `10.a.a.0/24` no nó A e `10.b.b.0/24` no nó B (subnets distintas, tiradas do lease de cada nó). App+banco **no mesmo nó** = mesmo `/24` (caso comum, barato). App no nó A ↔ banco no nó B = rota L3 sobre WG instalada **só para aquele par** (§3).

---

## 3. TOPOLOGIA DE REDE

**Hoje:** zero `NetworkMode` no código → todo container cai no `docker0` compartilhado; porta publicada em `0.0.0.0:<efêmera>` alcançável por qualquer interface (inclusive a WG).

**Novo:** **um bridge Docker por (dono,nó)** `veloz-u<slot>` (`slot` = octeto do `/24` dentro do `/16` do nó), criado lazy no 1º ambiente do dono no nó (padrão `ensureVolume`), `--subnet` **explícito vindo do control-plane**, nome de iface fixo `brv<hash≤10>` (glob nft `brv*`, cabe no IFNAMSIZ), `enable_icc=true`, `enable_ip_masquerade=false`. Cada container anexa com **IP fixo** (`environments.ip`).

### Os 4 caminhos (com `bridge-nf-call-iptables=0`)

**[decisão] `bridge-nf-call-iptables=0`.** Racional definitivo que encerra a divergência entre os especialistas: com `/24`-por-dono, **app e banco do mesmo dono estão na MESMA subnet/bridge → tráfego bridged L2**, e o isolamento inter-dono é **roteado L3** (subnets diferentes). Roteamento **sempre** passa por `FORWARD` **independente do sysctl**. Portanto o isolamento **não depende do sysctl** — o que o sysctl muda é só o path bridged L2 (app↔db). Com `=0`, o **fluxo dominante (app↔db) não cria conntrack**, aliviando o table exatamente na densidade-alvo. **O sysctl é asserido no boot (node-doctor + agente recusa provisionar se drift), fail-closed, para ninguém "ganhar PPS" virando `=1` e inchar conntrack.**

| # | Caminho | Mecânica | Veredito |
|---|---------|----------|----------|
| 1 | **Intra-dono, mesmo nó** (app↔db, mesmo /24) | Bridged L2, `icc=true`, `=0` bypassa netfilter | **Permitido, custo zero, sem conntrack** — caminho quente |
| 2 | **Inter-dono, mesmo nó** (`brvA`→`brvB`) | Subnets ≠ → L3-roteado → `FORWARD→DOCKER-USER` (sempre, independe do sysctl) | **DROP** — regra única |
| 3 | **Intra-dono, cross-node, mesma região** | Roteado sobre `wg0`; `brv↔wg0` liberado só p/ o par do dono; WG `AllowedIPs` descarta o resto no kernel | **Permitido, sem publicar porta** |
| 4 | **Inter-dono, cross-node** | Sem rota, sem `AllowedIPs` | **WG descarta no kernel — fail-closed** |

Regras em `DOCKER-USER` (Docker garante salto primeiro; não faz flush no restart):
```
1. ct state established,related                          accept   # fast-path
2. iifname "brv*" oifname "wg0"  <map cross-node do par> accept   # §5, só mesmo-dono/mesma-região
3. iifname "wg0"  oifname "brv*"  <map cross-node do par> accept
4. iifname "brv*" oifname "brv*"                         drop     # INTER-DONO MESMO NÓ = SEMPRE
5. drop
```
A linha 4 nega todo leste-oeste inter-dono no nó em **O(1) no nº de donos** (não regra-por-par). Intra-dono mesmo-nó **nem chega aqui** (é L2). Com `/24`-por-dono, `brv→brv` roteado **é sempre** inter-dono — daí a regra ser correta e simples.

### O que muda na regra `docker0` atual

**Nada — e ela fica inócua para ambientes.** A regra de host `-i docker0 -o docker0 -j DROP` casa literalmente `docker0`; ambientes agora vivem em `brv*`, **nunca casam**. `docker0` carrega só agente/infra. **Invariante mandatório: `provision()` EXIGE `NetworkMode: veloz-u<slot>`** — corpo do `/provision` sem rede → **400**. Container sem bridge-de-dono seria buraco no `docker0`.

**Anti-spoof:** intra-`/24` não há (aceito — dano contido: o dono só falsifica hosts do próprio par app+db). No perímetro que importa (inter-dono, cross-node), o anti-spoof vem do **cryptokey routing do WG** (`AllowedIPs` estrito) + **`rp_filter` estrito** em `wg0`.

---

## 4. MECÂNICA DOCKER (funções reais)

### Autoridade e lock (fecha o race, sem serializar o nó)

**[decisão]** O advisory lock cobre **só a alocação de IPAM** (resolver `owner_subnet` + alocar o octeto `H` livre gravando em `environments.ip`), em **milissegundos**, e é **liberado ANTES de qualquer chamada ao agente**. O provisionamento fica **lock-free, idempotente, chaveado pelo IP pré-alocado**. (Rejeitado o lock segurado através do HTTP ao agente: 10 creates concorrentes serializariam ~5 min de `initdb` de Postgres atrás de um lock global-por-nó.)

```
environments.ts:
  pg_advisory_xact_lock(hashtext('ipam:'||nodeId))
    resolve owner_subnet(ownerId,nodeId,cidr)  -- cria lease se 1º ambiente do dono no nó
    aloca H livre  →  environments.ip = cidr.host(H)
  COMMIT (solta o lock)                          -- agente recebe subnet+gw+IP prontos
  → agent.ensureUserNetwork / provisionDb / provision   (lock-free)
```

### `ensureUserNetwork(slot, cidr, gw)` — nova, espelha `ensureVolume` (deploy.ts:47)
```js
docker.createNetwork({
  Name: `veloz-u${slot}`, Driver: "bridge", CheckDuplicate: true,
  IPAM: { Driver: "default", Config: [{ Subnet: cidr, Gateway: gw }] },
  Options: {
    "com.docker.network.bridge.name": `brv${hash}`,
    "com.docker.network.bridge.enable_icc": "true",
    "com.docker.network.bridge.enable_ip_masquerade": "false",
  },
  Labels: { "vp.owner": ownerId },
});
```
Custo do libnetwork (lock global + reescrita iptables no create) é **amortizado O(donos-por-nó)** — só o 1º ambiente do dono no nó paga; os demais só anexam.

### `provision()` (app) — docker.ts:380, alterações
- **Remove `PortBindings`** (hoje `0.0.0.0`/HostPort `""` na :413) — o furo norte-sul inteiro. Identidade deixa de ser `httpPort` efêmero e passa a ser `environments.ip` fixo.
- **`NetworkMode: veloz-u<slot>` obrigatório** + IP fixo via `NetworkingConfig.EndpointsConfig['veloz-u'+slot].IPAMConfig.IPv4Address = environments.ip`.
- **`start()` não relê/regrava `httpPort`** (some do fluxo; `waitForPort` some do caminho do app).
- **Endurecimento:** `PidsLimit: 512`, `Ulimits:[{nofile 4096/8192}]`, `CapDrop:['NET_RAW','NET_ADMIN']` (mata ARP-spoof L2 de dentro do container — a bridge é compartilhada app↔db do dono), `SecurityOpt:['no-new-privileges']`.

### `provisionDb(args)` — nova, irmã de `provision()`
- **Imagem stock** `postgres:16-alpine`/`mariadb:11` via `resolveImage`/`ensureImage`. **Sem supervisor** (entrypoint oficial gerencia o processo).
- **Volume `veloz-db-<envId>`** via `ensureDbVolume()` (padrão `ensureVolume`), `Labels:{vp.env}`, `Binds:['veloz-db-<envId>:/var/lib/postgresql/data'|'/var/lib/mysql']`. Resolve a persistência que o app não tem.
- **Sem `PortBindings`.** `NetworkMode` obrigatório + IP fixo; `Aliases:['db-'+dbSlug]` (não `db` cru).
- **Senha root cifrada** reusando `crypto.ts` (esquema `v1:`), decifrada **no control-plane** e passada no corpo do `/provision-db` como `POSTGRES_PASSWORD`/`MARIADB_ROOT_PASSWORD`. **A chave de cifra NUNCA vive no agente** (§5).
- **Readiness por exec** (padrão `execCapture`, docker.ts:459), **não** `waitForPort`: poll `pg_isready`/`mariadb-admin ping`, backoff até ~20s (initdb da 1ª subida do volume vazio).
- Mesmo endurecimento; DB: `PidsLimit:256`, `Ulimits nofile 8192/16384`.

### Reconciliação no boot do agente — nova rota `/reconcile`
Fecha a dupla-contabilidade CP↔Docker (endpoint órfão pós-crash do daemon segurando um `H`). Para cada `veloz-u*`: `network.inspect()` → endpoints vivos; CP cruza com `environments.ip`, **expulsa órfão** (`network disconnect --force`) e marca `H` real em uso, **antes** de alocar novo `H` num nó reconectado.

### Ciclo de vida (banco antes do app)
- **Create:** lock IPAM → `owner_subnet`+`H` (CP) → `ensureUserNetwork` → `ensureDbVolume` → **banco** (`provisionDb`, readiness exec) → **app** (`provision`, injeta **`DB_HOST=environments.ip`**). Banco antes para o par já resolver quando o app sobe.
- **[decisão] `DB_HOST = environments.ip`, não alias DNS Docker.** O alias `db-<slug>` (DNS interno `127.0.0.11`) é **same-node-only** e quebraria a própria migração cross-node. O IP de fabric é estável e roteável same-node (L2) **e** cross-node (WG). O alias fica só como conveniência same-node; **o valor injetado é o IP**. Injeção automática via `env-vars.ts` (hoje `databases.ts` **não** injeta — cliente cola à mão).
- **Start:** `startDb()` = `start()` + readiness exec.
- **Stop:** independentes; parar o banco derruba a conexão do app do dono → **avisar no painel, não bloquear**.
- **Delete:** **preserva `veloz-db-<envId>` por padrão** (recria sem perder dados — objetivo do dono); só apaga em purge explícito. Após o **último** container do dono no nó (count sob o mesmo lock = 0) → GC da rede `veloz-u<slot>` + libera lease. **[decisão] Lease só é liberado com deleção de rede CONFIRMADA**; se `removeNetwork` no-opar (endpoint zumbi), **mantém o lease** e deixa o reconciliador reconvergir — nunca `DELETE owner_subnet` incondicional (evita vazar `/24` e travar provisionamento futuro).

### Métrica de disco do volume (habilita cobrar banco)
`diskUsage()` (docker.ts:561) hoje só lê `SizeRw` do container. **[decisão] Medir por contabilidade de filesystem — project quota (`xfs_quota`/`repquota`) ou `df` no mountpoint do volume — O(1), sem walk, sem poluir page cache.** (Rejeitado `du -sb` no datadir vivo: a 200 bancos/nó são 200 varreduras completas de inode/min disputando IO com as próprias queries.) Fallback, onde quota indisponível: container `alpine` efêmero montando o volume read-only, `du -sb`, **`NetworkMode:'none'`** (zero veth, zero reescrita de iptables). Grava em novo campo de disco em `metricSamples`.

---

## 5. SEGURANÇA

**Garantias:**
1. **Inter-dono mesmo nó:** DROP na linha 4 do `DOCKER-USER` (roteado, sysctl-independente). O(1).
2. **Inter-dono cross-node:** sem rota, sem `AllowedIPs` → **descartado no kernel do WG**. Fail-closed.
3. **Norte-sul:** **zero `PortBindings`**; reverse-proxy **no netns do host** disca `environments.ip:80`. `AllowedIPs` nunca inclui IP de host de nó para alcance de tenant → nenhum tenant chega em `IP-do-nó:porta`.
4. **Anti-spoof de perímetro:** cryptokey routing WG (`AllowedIPs` estrito por par) + `rp_filter` estrito.
5. **Escape de container (uid 0):** `CapDrop NET_RAW/NET_ADMIN` + `no-new-privileges` + `userns-remap=default` (só pela mitigação de escape, **não** pelo inotify).

**Mecanismo cross-node escolhido — [decisão] malha WireGuard única + cryptokey routing estrito + gerador a partir de `wg_routes`.** Por quê (avaliadas 3):
- **mTLS por ambiente — rejeitado:** exigiria todo app arbitrário + o wire-protocol MySQL/PG falarem TLS de cliente. Não transparente.
- **Overlay/túnel por tenant — rejeitado:** `N_donos × N_nós` túneis, dupla encapsulação (MTU/conntrack).
- **✅ Malha WG existente:** transporte já cifrado; alcance cross-node = **rota de `/24` sobre o túnel**, instalada **só** onde há par app+banco dividido. Fecha o furo do brief ("expor porta na WG = qualquer tenant alcança") porque **não se publica porta nenhuma**.
  - **`AllowedIPs` apertado:** para o peer nó A, o nó B lista só as `/24`s de dono que vivem em A e cujo par vive em B. **JAMAIS `10.0.0.0/8`.**
  - **Barreira de região = invariante duro:** o gerador faz `JOIN nodes a,b ON a.region=b.region`. Região diferente **nunca** produz rota → residência de região é **fail-closed no roteamento**, não convenção.
  - **Custo de migração:** `wg set peer <pub> allowed-ips <cidrs>` + `ip route replace` = **4 ops netlink sub-ms, sem flap de túnel**. Semântica **add-before-remove, health-gated, idempotente**: aloca `/24` novo → adiciona rotas (velho E novo alcançáveis) → corta `DB_HOST` p/ IP novo → só após health remove o velho. Falha no meio → **reconciliador regenera `AllowedIPs` COMPLETO de `wg_routes`** e converge. Sem hand-edit parcial.

**[decisão] Chave de cifra das senhas root NÃO vive no agente.** O CP decifra e injeta a senha **só no corpo do `/provision-db`**; o agente nunca guarda a chave. Sem isso, agente comprometido (`docker.sock`) leria a senha root de todo banco do nó — o blast radius real do modelo "proxy/agente no host".

**Pré-requisito bloqueante (confirmado inexistente hoje):** `wg_peers` é inerte (`AllowedIPs = 10.77.0.1/32`, nós **não se roteiam**). Entrega obrigatória: tabela `wg_routes(srcNodeId,dstNodeId,cidr)` + **gerador que materializa `AllowedIPs` por peer via `wg set` idempotente com a barreira de região**, disparado só em mudança de placement.

---

## 6. ESCALA

**Gargalos de densidade por nó (ordem de quem estoura primeiro — NÃO é rede):**
1. **inotify (~128–200 containers).** Todo container é uid 0 e compartilha `fs.inotify.max_user_instances` (default **128**). **Fix: subir os sysctls do host** (`max_user_instances`→dezenas de milhares; `max_user_watches`→centenas de milhares). `userns-remap` **não** resolve (colapsa tudo no mesmo UID `dockremap`).
2. **RAM baseline dobra:** "banco = ambiente" cria app + banco por dono. Postgres idle ~15–30 MB; MariaDB ~80–120 MB. 200 donos = 400 containers → vários GB de baseline fora do plano do app.
3. **PIDs:** `PidsLimit` (app 512, db 256) — sem isso um fork-bomb esgota `pid_max` global.
4. **nofile:** `Ulimits` — sem isso Node + banco batem EMFILE.
5. **veth/bridges:** ~400 containers ≈ 800 veth, ≤256 bridges/nó; kernel aguenta milhares; STP off; GC de bridge órfã sob lock.
6. **conntrack:** com `=0`, o hot-path app↔db **não** entra (alívio grande); só egress NAT + hairpin WG criam entrada. `nf_conntrack_max ≥ 1M`, hashsize proporcional, métrica por nó.
7. **overlay2/inodes:** `df -i` estoura antes de `df -h` com `node_modules`; monitorar inodes.

**Ponto-chave:** **a rede aguenta muito além do teto de densidade.** O `/16`-por-nó dá agregação (os `/24`s de um nó cabem em poucos `/16` de rota → tabela de rotas curta mesmo com fleet grande).

**`pickNodeForNewEnv` (nodes.ts:31) — reescrita.** Hoje ordena por **contagem crua** e **ignora `region`/`vcpuTotal`/`memMbTotal`**. Passa a receber `{region, ownerId, kind}` e:
- **(a) filtro de região DURO** — garante "banco na mesma região" na criação.
- **(b) afinidade de bundle (app + o SEU banco) COM teto `nodes.maxContainers`** — co-localização L2 (única topologia barata sem overlay), mas afinidade sem teto vira DoS de nó por um dono grande.
- **(c) headroom real** — soma `plan.vcpu`/`plan.memMb` alocados vs. totais do nó, **incluindo o baseline de banco**.
- **(d) teto `nodes.maxContainers`** (reflete inotify/conntrack/veth, **não** CPU).
- **(e) fallback [decisão]: esgotou headroom in-region → `503 no_region_capacity`, NUNCA split cross-região.** Fail-closed no roteamento **e** no scheduler — senão o provision "sucede" e entrega ambiente morto (app sem rota ao banco).

**Rebalanceamento/migração entre nós:** estado em `veloz-db-<envId>` → `stop` → `tar` do volume via container `NetworkMode:none` → transfere pela WG → restaura no destino com **novo IP fixo** → CP repinta rotas/`AllowedIPs` e a injeção `DB_HOST`. App é stateless (rebuild).

---

## 7. MUDANÇAS NO CÓDIGO (arquivo por arquivo)

| Arquivo | Mudança | Tam |
|---|---|---|
| `apps/api/src/db/schema.ts` | tipo `database` em environments; `environments.ip`; tabelas `node_subnet`, `owner_subnet(ownerId,nodeId,cidr, UNIQUE(nodeId,cidr))`, `wg_routes(srcNodeId,dstNodeId,cidr)`; `nodes.maxContainers`; campo de disco em `metricSamples`; `AllowedIPs` real em `wg_peers` (ou via `wg_routes`) | **M** |
| `apps/api/src/nodes.ts` | `pickNodeForNewEnv`: região dura + afinidade-de-bundle-com-teto + headroom real + `maxContainers` + fallback 503; orquestração IPAM sob advisory lock **curto** (solta antes das chamadas ao agente) | **L** |
| `apps/api/src/routes/environments.ts` | ordem rede→volume→banco→app; injeção `DB_HOST=environments.ip`; GC que só libera lease com deleção de rede confirmada; remover regravação de `httpPort` no start | **L** |
| `apps/agent/src/docker.ts` | `provision()` sem `PortBindings` + `NetworkMode` obrigatório + IP fixo + `PidsLimit`/`Ulimits`/`CapDrop`/`no-new-privileges`; `provisionDb()`, `ensureUserNetwork()`, `ensureDbVolume()`, `startDb()`, `removeNetwork()`, readiness por exec, reconciliação; disco por quota/df (fallback `du` em `NetworkMode:none`) | **L** |
| `apps/agent/src/server.ts` | rotas `/provision-db`, `/start-db`, `/remove-network`, `/reconcile`; `DELETE /container/:id` deixa de fazer GC de rede sozinho (CP orquestra) | **M** |
| `apps/agent/src/deploy.ts` | reuso do padrão `volName`/`ensureVolume` para `veloz-db-<envId>` | **S** |
| `apps/api/src/routes/env-vars.ts` | injeção automática de `DB_HOST`/credenciais do banco nas env-vars gerenciadas | **M** |
| `apps/api/src/crypto.ts` | senha root do banco (esquema `v1:`); garantir que a chave **não** chega ao agente | **S** |
| **Gerador de config WG** (novo, control-plane) | materializa `AllowedIPs` por peer de `wg_routes` via `wg set` idempotente, com barreira de região no JOIN; disparado só em mudança de placement | **M** |
| **Infra de nó (versionar em `deploy/`)** | `daemon.json` (`iptables=true`, `enable_ip_masquerade` das bridges via Options, `bridge-nf-call-iptables=0` asserido), chain `VELOZ-POSTROUTING`, sysctls inotify/conntrack, `node-doctor` recusando provisionar em drift | **M** |
| `apps/painel/...` (env-banco) | UI: criar ambiente tipo banco, escolher nó na mesma região, exibir credenciais uma vez, aviso de "parar banco derruba app" | **M** |

---

## 8. RISCOS e DECISÕES QUE O DONO PRECISA VALIDAR

**Decisões travadas nesta síntese (confirmar que concorda):**
1. **`/24` inteiro por (dono,nó), provisionado desde o 1º ambiente** — desperdiça IP (o `/8` comporta), em troca de **zero migração de bridge**. ✅ recomendado.
2. **`bridge-nf-call-iptables=0`** — app↔db do mesmo dono não entra no conntrack; isolamento inter-dono é roteado (independe do sysctl). Asserido no boot, fail-closed.
3. **`DB_HOST = IP de fabric do banco** (`environments.ip`), não alias DNS Docker** — estável same-node e cross-node.
4. **Disco medido por project quota/`df`**, não `du` — O(1), não disputa IO com o banco.
5. **Fallback de scheduler = `503 no_region_capacity`**, nunca split cross-região (evita ambiente "provisionado" mas morto).
6. **Volume de banco preservado no delete** (só apaga em purge explícito).

**Riscos que exigem trabalho de infra FORA do código (hoje não versionado):**
- **A. WireGuard não roteia nós entre si hoje** (`AllowedIPs = 10.77.0.1/32`, `wg_peers` inerte). **Sem o gerador de `wg_routes`, cross-node não existe** — é pré-requisito bloqueante para banco/app em nós diferentes.
- **B. Isolamento container↔container atual (`icc:false`, `DOCKER-USER` drop) é config de host manual, não versionada.** O novo desenho **depende** de `daemon.json` + chain nft + sysctls corretos no nó. Precisa ir para `deploy/` com o `node-doctor` recusando provisionar se algo divergir.
- **C. Sysctls de host (inotify, conntrack, pid_max)** precisam ser elevados **antes** de mirar ~200+ containers/nó — é o gargalo real, não CPU.
- **D. Discrepância de endereçamento na doc** (`10.100/24` no MEMORY vs. `10.77/24` real em `deploy/`). O fabric novo é `10.0.0.0/8`; **alinhar o MEMORY ao `10.77` real** e reservar o `/16` da malha antes de alocar leases.
- **E. Reverse-proxy no host vira a fronteira norte-sul** — o host é gateway `.1` de toda bridge de dono. Comprometer o agente (`docker.sock`) = comprometer todos os tenants do nó. A mitigação implementável agora é **não guardar a chave de cifra no agente** (decisão travada); o resto é higiene de acesso ao host.

**Ponto de escala de longo prazo (não bloqueia agora):** aos ~254 nós densos o `10/8` satura → re-home planejado para `100.64/10`. Table-driven (`owner_subnet.cidr` é a única verdade), mas é um evento de fleet a agendar quando o fabric passar de ~60 mil containers.

---

Arquivos-âncora citados (todos verificados contra o repo nas 4 rodadas): `/Users/tiago.agenor/www/velozPanel/apps/agent/src/docker.ts` (provision :380, PortBindings :413, diskUsage :561), `/Users/tiago.agenor/www/velozPanel/apps/agent/src/deploy.ts` (ensureVolume :47), `/Users/tiago.agenor/www/velozPanel/apps/api/src/nodes.ts` (pickNodeForNewEnv :31), `/Users/tiago.agenor/www/velozPanel/apps/api/src/routes/environments.ts`, `/Users/tiago.agenor/www/velozPanel/apps/api/src/db/schema.ts`, `/Users/tiago.agenor/www/velozPanel/apps/agent/src/server.ts`, `/Users/tiago.agenor/www/velozPanel/apps/api/src/routes/databases.ts`, `/Users/tiago.agenor/www/velozPanel/apps/api/src/crypto.ts`.