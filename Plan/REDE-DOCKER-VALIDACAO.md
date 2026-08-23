# Runbook de Validação — Rede, Docker e WireGuard (Jamees / velozPanel)

> Auditoria **somente-leitura** realizada em 2026-08-23. Este documento permite a um
> operador futuro revalidar a pilha inteira (control plane ↔ hub WireGuard ↔ nós/agentes)
> sem alterar infraestrutura. **Segredos ficam sempre REDIGIDOS** — nunca cole tokens/senhas reais.
>
> Convenção: `<REDIGIDO>` = valor sensível que você lê da `.env`/ambiente, mas não escreve aqui.

---

## 0. Resumo do estado (última auditoria — 2026-08-23)

| # | Item | Resultado | Observação |
|---|------|-----------|------------|
| 1 | WireGuard (hub + peers) | **PASS** | 2 peers ativos com handshake fresco; 1 peer órfão `10.100.0.2` |
| 2 | Host → agentes (/health) | **PASS** | `.4`=148ms, `.3`=16ms; `.2` 100% perda |
| 3 | Container API → agentes | **PASS** | 200 nos dois agentes via `node -e` |
| 4 | Docker control plane | **PASS** | 8 containers Up, 0 restarts; 3x HTTP 502 recentes (env `ca-maria`) |
| 5 | Lado-nó (best effort) | **PARCIAL** | `ca-remoto` SSH OK; `sp-local` SSH indisponível (só via WG — agente OK) |
| 6 | Sanidade do banco | **PASS** | 3 running / 3 paused; billing OFF; 0 usuários suspensos |
| 7 | **Heartbeat (prioridade)** | **FAIL** | **Não existe mecanismo de heartbeat** — ver Seção 7 |
| 8 | iptables / forwarding | **PASS** | Regras persistem (wg-quick habilitado + docker) |

### Problemas encontrados (por severidade)

- **[MÉDIA] Sem heartbeat/liveness real.** `nodes.status` e `nodes.last_seen_at` são valores
  **estáticos gravados só no seed** (`push-and-seed.ts`), nunca atualizados em runtime.
  Nenhum poller do control plane consulta os agentes para atualizar `last_seen_at`, e o agente
  **não envia** heartbeat. O `last_seen_at` velho (2026-08-21) é o carimbo do seed, não um
  updater quebrado. Consequência: o "online" exibido no painel é **decorativo** e não reflete
  a realidade. Não é uma queda atual (os agentes estão saudáveis), mas o indicador de saúde é
  não-confiável. Ver Seção 7 para a causa-raiz e a recomendação.
- **[BAIXA] Peer WireGuard órfão `10.100.0.2`.** Sem handshake há 6d+; endpoint é o mesmo IP
  público do `sp-local` (`186.232.132.205`) porém em outra porta; não consta na tabela `nodes`
  nem em `wg_peers`. É um peer duplicado/desativado do `sp-local`. Recomenda-se remover de
  `/etc/wireguard/wg0.conf` (bloco `[Peer]` com `AllowedIPs = 10.100.0.2/32`).
- **[BAIXA–MÉDIA] Ambiente `ca-maria` falha ao iniciar.** 3x HTTP 502 na última hora em
  `POST /environments/03933a17-.../start` (uma tentativa levou 4.5s e retornou 502). O ambiente
  segue `paused`. Investigar o agente do `ca-remoto` (container `2efb27d07902`) — read-only:
  `docker logs velozplanel-agent` no nó.
- **[BAIXA] Tabela `wg_peers` vazia.** O WireGuard é gerenciado no host (`wg0.conf`), não no
  banco. A tela admin "Rede/WireGuard" não tem fonte de dados.
- **[INFO] `sp-local` sem SSH público** (máquina doméstica atrás de NAT; `alert_message` já avisa
  que é instável). Alcançável apenas via WireGuard — use a API do agente sobre WG.
- **[INFO] Sem pacote de persistência de iptables** (`netfilter-persistent`/`iptables-persistent`
  ausentes; `/etc/iptables` não existe). Hoje é irrelevante (a única regra custom vive no
  `PostUp` do wg-quick e o resto é gerenciado pelo Docker), mas qualquer regra manual futura
  **não sobreviveria a um reboot**.

---

## 1. Visão geral da arquitetura

```
                 Internet
                    │
      ┌─────────────┴──────────────────────────┐
      │  CONTROL PLANE  host root@187.127.49.205 │
      │  /opt/velozplanel/control-plane/         │
      │  docker-compose.prod.yml + .env          │
      │                                          │
      │  Rede docker bridge: velozplanel-control_vpnet
      │    subnet 172.18.0.0/16  gw 172.18.0.1   │
      │    api container = 172.18.0.4            │
      │                                          │
      │  Containers:                             │
      │   velozplanel-control-api-1     :4000    │  (Fastify; publica em 10.100.0.1:4000)
      │   velozplanel-control-painel-1  :3000    │  (Next.js)
      │   velozplanel-control-postgres-1 :5432   │  (estado do painel)
      │   velozplanel-control-mariadb-1 :3306    │  (10.100.0.1:3306)
      │   velozplanel-control-caddy-1   :80/443  │  (proxy público; bloqueia /api/v1/internal/*)
      │   velozplanel-control-pdns-1    :53      │  (PowerDNS autoritativo)
      │   vp-ssh-fwd-sp-local  :2222             │  (gateway SSH p/ nó)
      │   vp-sftp-fwd-sp-local :2223             │  (gateway SFTP p/ nó)
      │                                          │
      │  HUB WireGuard NO HOST (não em container):
      │   iface wg0 = 10.100.0.1/24  (porta 51820)
      └───────────────┬──────────────────────────┘
                      │  túnel WireGuard (10.100.0.0/24)
        ┌─────────────┼───────────────────────────┐
        │                                          │
   ┌────┴───────────────────┐        ┌─────────────┴──────────────┐
   │ NÓ ca-remoto           │        │ NÓ sp-local                │
   │ WG 10.100.0.4          │        │ WG 10.100.0.3              │
   │ público 184.107.115.183│        │ público 186.232.132.205    │
   │ agente :4100           │        │ agente :4100               │
   │ id 0ff22aee-…          │        │ id 3f2fd64d-…              │
   │ SSH público: OK        │        │ SSH público: indisponível  │
   │                        │        │ (só via WG; máq. doméstica)│
   └────────────────────────┘        └────────────────────────────┘

   Peer órfão: 10.100.0.2  (sem handshake 6d+, endpoint = IP do sp-local:17041) → limpar
```

- **Agente** (`apps/agent`): HTTP na porta **4100**. `GET /health` é **aberto** (`{"ok":true}`).
  Todos os demais endpoints exigem o header `x-agent-token: <REDIGIDO>` (senão **401**).
  O token é `VP_INTERNAL_TOKEN`, compartilhado entre control plane e agentes (lido da `.env`).
- **Control plane → agente**: o container da API resolve a URL do agente por nó
  (`nodes.agent_url`, ex.: `http://10.100.0.4:4100`) e injeta `x-agent-token` (`apps/api/src/agent.ts`).
- **Caminho de rede container→agente**: pacote sai do container (172.18.0.x) → roteado para `wg0`
  → **MASQUERADE** reescreve origem para `10.100.0.1` → túnel WG → `10.100.0.x:4100`.
  O retorno chega em `10.100.0.1` e é des-NATeado de volta ao container.

### Pegadinha de testes (importante)

`wget`, `curl`, `nslookup`, `ip` **não estão instalados no container da API**. Para testar
conectividade **de dentro do container**, use o Node:

```bash
docker exec velozplanel-control-api-1 node -e '
const http=require("http");
[["10.100.0.4",4100],["10.100.0.3",4100]].forEach(([h,p])=>{
  const req=http.get({host:h,port:p,path:"/health",timeout:8000},res=>{
    let d="";res.on("data",c=>d+=c);res.on("end",()=>console.log(h,res.statusCode,d));});
  req.on("error",e=>console.log(h,"ERR",e.message));
  req.on("timeout",()=>{console.log(h,"TIMEOUT");req.destroy();});
});'
```

**Esperado:** `10.100.0.3 200 {"ok":true}` e `10.100.0.4 200 {"ok":true}`.

Do **host**, `curl`/`ping` existem normalmente.

---

## 2. Checklist de validação passo-a-passo

Todos os comandos partem **desta máquina** (SSH passwordless para o control plane já configurado).
Prefixo comum: `ssh root@187.127.49.205 '<comando>'`.

### Check 1 — WireGuard (hub + peers)

```bash
ssh root@187.127.49.205 'wg show; echo ---; ip addr show wg0; echo ---; ip route | grep wg0'
```

**Esperado:**
- `interface: wg0`, `listening port: 51820`.
- Peer `10.100.0.4/32` (ca-remoto, endpoint `184.107.115.183`): **latest handshake < ~2 min**,
  transfer nos dois sentidos (received **e** sent > 0).
- Peer `10.100.0.3/32` (sp-local, endpoint `186.232.132.205`): idem.
- `inet 10.100.0.1/24 scope global wg0`.
- Rota `10.100.0.0/24 dev wg0 proto kernel scope link src 10.100.0.1`.

**Peer órfão a identificar:** `allowed ips: 10.100.0.2/32` com `latest handshake` de **dias**
(na auditoria: 6d 14h) e transferência estagnada. É um resíduo do `sp-local` (mesmo IP público,
porta diferente). **Não deve ter tráfego** — candidato a remoção.

### Check 2 — Host → agentes

```bash
ssh root@187.127.49.205 '
  curl -s -m 8 http://10.100.0.4:4100/health; echo;
  curl -s -m 8 http://10.100.0.3:4100/health; echo;
  ping -c2 -W2 10.100.0.4; ping -c2 -W2 10.100.0.3; ping -c2 -W2 10.100.0.2'
```

**Esperado:** ambos `/health` → `{"ok":true}`. Pings para `.4` e `.3` com **0% de perda**.
`10.100.0.2` deve dar **100% packet loss** (peer órfão — normal estar morto).

### Check 3 — Container da API → agentes

Use o snippet `node -e` da Seção 1 (Pegadinha de testes).
**Esperado:** `200 {"ok":true}` nos dois. Confirma o caminho bridge→wg0 + MASQUERADE.

### Check 4 — Docker (control plane)

```bash
ssh root@187.127.49.205 '
  docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}";
  echo ---;
  for n in $(docker ps -a --format "{{.Names}}" | grep velozplanel); do
    echo "$n restarts=$(docker inspect -f "{{.RestartCount}}" $n) health=$(docker inspect -f "{{.State.Health.Status}}" $n 2>/dev/null)";
  done'
```

**Esperado:** todos `Up`; `api`, `painel`, `postgres`, `mariadb` = **healthy**;
`caddy`/`pdns` sem healthcheck definido (mostra vazio — OK). **restarts=0** em todos
(restart alto = crash loop → investigar `docker logs`).

Erros recentes voltados ao agente:

```bash
ssh root@187.127.49.205 'docker logs --since 1h velozplanel-control-api-1 2>&1 | grep -c "\"statusCode\": 502"'
```

**Esperado:** idealmente `0`. Na auditoria retornou `3` — todos em `POST .../start` e `/metrics`
do ambiente `ca-maria` (paused). Se aparecer 502, correlacione com o env alvo (ver Troubleshooting).

### Check 5 — Lado-nó (best effort)

```bash
# ca-remoto (SSH público disponível):
ssh -o ConnectTimeout=8 root@184.107.115.183 'hostname; docker ps --format "{{.Names}} {{.Status}}"'
# sp-local (SSH público NÃO responde — use a API do agente sobre WG a partir do control plane):
ssh root@187.127.49.205 'curl -s -m8 -H "x-agent-token: <REDIGIDO>" http://10.100.0.3:4100/containers'
```

**Esperado:**
- `ca-remoto`: SSH conecta; `velozplanel-agent` = **Up**; containers de cliente presentes.
- `sp-local`: SSH **timeout** (esperado — máquina doméstica/NAT). A saúde é confirmada pelo
  `/health` sobre WG (Check 2) e, com token, pelo endpoint de listagem do agente.

> Endpoints do agente que exigem token retornam **401** sem o header. Leia o token de
> `VP_INTERNAL_TOKEN` na `.env` do control plane; **não** o cole em documentos.

### Check 6 — Sanidade do banco (Postgres)

Rode via heredoc para evitar inferno de aspas por SSH (o `.env` tem `POSTGRES_USER/DB/PASSWORD`):

```bash
ssh root@187.127.49.205 'bash -s' <<'EOF'
cd /opt/velozplanel/control-plane
U=$(grep -E "^POSTGRES_USER="     .env|cut -d= -f2)
D=$(grep -E "^POSTGRES_DB="       .env|cut -d= -f2)
P=$(grep -E "^POSTGRES_PASSWORD=" .env|cut -d= -f2)
q(){ docker exec -e PGPASSWORD="$P" velozplanel-control-postgres-1 psql -U "$U" -d "$D" -At -c "$1"; }
echo "== nodes ==";            q "select name||' | '||status||' | last_seen='||coalesce(last_seen_at::text,'NULL') from nodes order by name"
echo "== envs ==";             q "select state||' = '||count(*) from environments group by state order by state"
echo "== platform_settings =="; q "select 'billing_enabled='||billing_enabled||' interval='||billing_interval_minutes||' suspend_on_zero='||suspend_on_zero||' last_run='||coalesce(billing_last_run_at::text,'NULL') from platform_settings"
echo "== suspended users ==";  q "select count(*) from users where status='suspended'"
echo "== audit (8) ==";        q "select to_char(ts,'MM-DD HH24:MI')||' | '||coalesce(actor_email,'-')||' | '||action||' | '||coalesce(target,'') from audit_logs order by ts desc limit 8"
EOF
```

> Dicas de quoting por SSH: evite aspas-duplas dentro de identificadores; use literais de string
> com `'...'`. **Não** use `$$...$$` dentro de um comando SSH entre aspas simples — o shell remoto
> expande `$$` para o PID (erro `trailing junk after numeric literal`). Prefira cast `::text`
> em vez de `to_char(...,'...')` quando possível.

**Esperado / referência da auditoria:**
- `nodes`: `ca-remoto` e `sp-local` ambos `status=online`, **porém `last_seen_at` parado em
  2026-08-21** (ver Check 7 — isso é esperado hoje, pois o campo nunca é atualizado).
- `envs`: `running = 3`, `paused = 3` (os `paused` foram suspensos por `env.suspend_no_balance`
  numa `billing.run_now` manual — visível no audit).
- `platform_settings`: `billing_enabled=false`, `interval=60`, `suspend_on_zero=true`,
  `last_run` recente (o loop de billing roda e carimba `billing_last_run_at` mesmo desligado).
- `users` suspensos: `0`.
- `audit_logs`: sem erros de agente; ações recentes de DNS/billing coerentes.

### Check 7 — Heartbeat (PRIORIDADE)

Ver Seção 7 (causa-raiz). Verificação rápida de que o campo está estático:

```bash
# compare last_seen_at (banco) com o handshake real (wg):
ssh root@187.127.49.205 'wg show wg0 latest-handshakes'
# e o last_seen do banco (Check 6). Se wg mostra handshake de segundos atrás porém
# nodes.last_seen_at está em dias → NÃO é queda; é ausência de updater (esperado hoje).
```

**Esperado (estado atual):** handshake WG fresco (segundos) **e** `last_seen_at` velho (dias).
Divergência é o sintoma da ausência de heartbeat, **não** de um nó offline.

### Check 8 — iptables / forwarding

```bash
ssh root@187.127.49.205 '
  iptables -L FORWARD -n | head;
  echo "-- nat --"; iptables -t nat -L POSTROUTING -n | grep -iE "masq|172.1[78]";
  echo "-- wg rule --"; iptables -S FORWARD | grep -i wg0;
  echo "-- forward --"; sysctl net.ipv4.ip_forward;
  echo "-- persistencia --"; systemctl is-enabled wg-quick@wg0;
  grep -iE "postup|postdown|address" /etc/wireguard/wg0.conf'
```

**Esperado:**
- `Chain FORWARD (policy DROP)` — política **DROP** (gerenciada pelo Docker).
- Cadeias `DOCKER-USER` e `DOCKER-FORWARD` presentes + regra final `ACCEPT`.
- NAT: `MASQUERADE 172.18.0.0/16` (e `172.17.0.0/16`) → habilita container→WG.
- `FORWARD -i wg0 -o wg0 -j ACCEPT` (adicionada pelo `PostUp` do wg-quick).
- `net.ipv4.ip_forward = 1`.
- `wg-quick@wg0` = **enabled** (sobrevive a reboot).
- `wg0.conf` com `PostUp = iptables -A FORWARD -i wg0 -o wg0 -j ACCEPT` /
  `PostDown = ... -D ...`.

**Persistência — resumo:**
- O que faz o forwarding funcionar sobrevive a reboot porque:
  1. **Docker** recria `DROP` + `DOCKER-*` + `MASQUERADE 172.18/172.17` a cada start do daemon.
  2. **wg-quick@wg0** (habilitado) recria `wg0` + a regra `-i wg0 -o wg0 ACCEPT` no boot.
- **Não há** `netfilter-persistent`/`iptables-persistent` nem `/etc/iptables`. Isso é aceitável
  **hoje** (nenhuma regra manual fora do `PostUp`/Docker), mas é uma fragilidade: qualquer regra
  adicionada manualmente com `iptables -A ...` (fora do `wg0.conf`) **se perde no reboot**.
  Regras novas devem ir no `PostUp` do `wg0.conf` ou num serviço de persistência.

---

## 7. Causa-raiz do heartbeat (documentação, sem correção)

**Sintoma relatado:** `nodes.last_seen_at` parado em 2026-08-21, embora os agentes respondam a
`/health`.

**Causa-raiz (confirmada no código):** **não existe mecanismo de heartbeat.** O campo
`last_seen_at` (e também `nodes.status`) é gravado **apenas uma vez, no seed**:

- `apps/api/src/db/push-and-seed.ts:517` → `lastSeenAt: new Date()` (carimbo do momento do seed).
- **Nenhum** outro ponto do código escreve `last_seen_at`/`lastSeenAt` (busca em
  `apps/api/src` e `apps/agent/src` só encontra leituras em `routes/nodes.ts` e a definição de
  schema em `db/schema.ts:41`).
- O **coletor de métricas** (`apps/api/src/metrics-collector.ts`) tem um `setInterval` de 5s, mas
  ele só consulta `agent.stats(...)` por **container de ambiente** e grava `metric_samples` —
  **nunca toca em `nodes`**.
- O **agente** (`apps/agent/src/*`) **não envia** heartbeat/registro para o control plane. Suas
  únicas chamadas de saída são para `/api/v1/internal/ssh/*` e `/internal/sftp/verify`
  (`apps/agent/src/ssh.ts`, `sftp.ts`) — verificação de acesso, não liveness.

**Conclusão:** o `last_seen_at` velho **não** é um updater quebrado com erro nos logs — o updater
**nunca existiu**. `2026-08-21` é simplesmente quando o seed rodou por último. Da mesma forma,
`nodes.status = 'online'` é um valor estático de seed, **não** reconciliado com a realidade. O
selecionador de nós (`apps/api/src/nodes.ts`) escolhe nós por `where status='online'`, ou seja,
confia num valor que ninguém mantém.

**Impacto:** "tudo OK" no painel para status de nó é **decorativo**. Hoje coincide com a realidade
(os dois agentes estão de fato saudáveis — Checks 1–3 provam), mas o indicador **não é confiável**:
se um nó cair, o painel continuará mostrando `online` com `last_seen` antigo.

**Recomendação (fora do escopo desta auditoria — não aplicada):** implementar liveness real, por
uma das vias:
- **Pull:** um loop no control plane (à la `metrics-collector`) que faz `GET /health` em cada
  `nodes.agent_url` a cada N s e faz `UPDATE nodes SET last_seen_at=now(), status=...`; marca
  `offline` quando o `/health` falha por X ciclos.
- **Push:** o agente faz `POST` periódico para um endpoint interno (protegido por
  `VP_INTERNAL_TOKEN`) que carimba `last_seen_at`/`status`.

---

## Troubleshooting (sintoma → causa provável → o que checar)

| Sintoma | Causa provável | O que checar |
|---|---|---|
| **`start`/`stop` de ambiente retorna 502** | Agente do nó fora do ar, sem token, ou erro no container alvo | `GET /health` do nó (Check 2); handshake WG (Check 1); `docker logs velozplanel-agent` no nó; confirmar `x-agent-token` (agente responde 401 sem ele). Ex.: `ca-maria` deu 502 — checar container `2efb27d07902` no `ca-remoto`. |
| **Nó aparece "online" mas `last_seen_at` é antigo** | **Ausência de heartbeat** (ver Seção 7) — não é queda | Confirmar handshake WG fresco (`wg show`) e `/health` OK. Se ambos OK, o nó **está** vivo; o campo é estático por design atual. |
| **Nó realmente offline** | Túnel WG caído / agente parado / nó desligado | `wg show` (handshake em minutos/dias); `ping 10.100.0.x`; `/health`; no nó: `systemctl`/`docker ps` do agente. `nodes.status` **não** avisa (é estático). |
| **Container da API não alcança o agente, mas o host alcança** | MASQUERADE/forward do docker→wg0 quebrado | Rodar o snippet `node -e` (Check 3). Se falha: `iptables -t nat -L POSTROUTING -n \| grep 172.18`; `iptables -S FORWARD`; `sysctl net.ipv4.ip_forward` (Check 8). |
| **Nada funciona após reboot** | `wg-quick@wg0` ou docker não subiu | `systemctl status wg-quick@wg0 docker`; `wg show`; `iptables -S FORWARD \| grep wg0`. Regras manuais fora do `PostUp`/Docker se perdem no reboot (sem `iptables-persistent`). |
| **Peer WG com transferência mas sem handshake recente** | Endpoint mudou / peer desativado | Comparar `endpoint` e `latest handshake` no `wg show`. O peer `10.100.0.2` é órfão conhecido (limpar do `wg0.conf`). |
| **Ambiente `paused` inesperadamente** | Billing suspendeu por saldo zero | `platform_settings.billing_enabled`; `audit_logs` por `env.suspend_no_balance`/`billing.run_now`. Hoje billing=OFF; suspensões foram de um `run_now` manual. |
| **Tela admin "Rede/WireGuard" vazia** | Tabela `wg_peers` não é populada | `select count(*) from wg_peers` (=0). O WG é gerenciado no host (`wg0.conf`), não no banco. |
| **`psql` por SSH: `trailing junk after numeric literal`** | `$$` expandiu para o PID do shell remoto | Use heredoc `<<'EOF'`; troque `to_char(...,'...')` por `::text`; use literais `'...'`. |
| **`wget: not found` / `curl: not found` dentro do container** | Ferramentas não instaladas na imagem da API | Use o snippet `node -e` (Seção 1). Do host, `curl`/`ping` existem. |

---

## Apêndice — Referências de arquivos (código)

- Heartbeat/seed: `apps/api/src/db/push-and-seed.ts` (linha ~517, `lastSeenAt: new Date()`).
- Schema `nodes`: `apps/api/src/db/schema.ts` (linha ~41, `last_seen_at`).
- Leitura/derivação de status do nó: `apps/api/src/routes/nodes.ts`.
- Seleção de nó por `status='online'`: `apps/api/src/nodes.ts`.
- Coletor de métricas (não atualiza `nodes`): `apps/api/src/metrics-collector.ts`.
- Cliente do agente (injeta `x-agent-token`): `apps/api/src/agent.ts`.
- Auth do agente (401 sem token, `/health` aberto): `apps/agent/src/server.ts`.
- Rotas internas máquina-a-máquina: `apps/api/src/routes/internal.ts`.
- WireGuard host: `/etc/wireguard/wg0.conf` (no control plane; `PostUp`/`PostDown`).
