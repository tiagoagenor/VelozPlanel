# 13 — Rede Privada WireGuard (Ciclo 3)

> Autor: Especialista de Redes / VPN / SRE
> Escopo: desenho, configs de exemplo e contratos. **Sem código de produção.**
> Fonte: `00-BRIEFING.md` ADENDO 6 (missão) + ADENDOS 1, 3, 4, 5.
> Documentos que este desenho toca: `03` §1/§1.6, `04` §6/§8, `06` §2/§3/§8, `08` §6, `09` §1/§5, `12` §3/§8.

## 0. Sumário executivo das decisões

| # | Decisão | Escolha | Descartado |
|---|---------|---------|-----------|
| W1 | Topologia | **Hub-and-spoke (hub = control plane) + arestas diretas seletivas** (spoke↔spoke só onde há caminho de dados: o par nó-público↔nó-local da Opção A) | Mesh completa (O(n²), blast radius, sem ganho para 2–5 nós) |
| W2 | Faixa privada | **`10.77.0.0/16`** (dentro de `10.0.0.0/8`, que o egress de container já bloqueia — defesa em profundidade de graça) | `10.60.0.0/16` (já é a rede dos containers), `192.168.*` (colide com LAN residencial do nó local) |
| W3 | WG é obrigatória? | **Obrigatória para nó local atrás de NAT** (não há outro caminho). **Padrão recomendado para nó público** (tira o endpoint do agente da internet), com **fallback mTLS público** documentado. **Módulo opcional** (`mod-rede-wireguard`) | WG obrigatória para todos; WG proibida (mantém lacuna "sem rede privada") |
| W4 | Transporte CP↔agente | **Passa a ir por dentro da WG** (long-poll HTTPS + WebSocket de log), **mTLS mantido por cima** (defesa em profundidade). Melhora superfície e resolve NAT; piora = gerência depende da WG | Trocar mTLS por "confiar na WG" (nunca) |
| W5 | Opção A — onde termina o TLS | **No nó público (borda)**, e repassa **HTTP em claro pela WG** (a WG já cifra com ChaCha20). Sem re-cifrar | Re-cifrar (proxy_ssl) na perna WG: dobra CPU de cripto, cert no nó local, zero ganho |
| W6 | Segmentação | **Container do cliente NUNCA entra na WG.** `AllowedIPs` mínimos por peer + nftables por peer. Nó comprometido não varre a rede | WG como rede plana onde todos se enxergam |
| W7 | Migração/backup pela WG? | **Não.** Migração entre nós continua SSH direto pela internet (`06` §8.2). Backup vai **direto** para object storage. A WG carrega só control plane + tráfego da Opção A | Hairpin de backup/migração pelo hub (desperdício de banda do hub) |
| W8 | Banco do cliente pela WG? | **Não muda nada.** Acesso é **local ao nó** (Adminer/túnel SSH), conta amarrada ao IP do container `10.60.0.x`. A WG não toca o banco do cliente | Expor banco na WG |
| W9 | NAT traversal / IP residencial | Nó local **sempre inicia** o handshake; `PersistentKeepalive=25`; roaming do WireGuard reendereça sozinho quando o IP muda. **DDNS não é necessário** | DDNS obrigatório; abrir porta no roteador residencial |
| W10 | Modo padrão de servir site | **Nó público direto.** Opção A (wg-proxy) só para o servidor local sem IP público. Cloudflare Tunnel como exceção | Opção A como padrão (adiciona 2 dependências a todo site) |

---

## 1. Modelo de rede WireGuard

### 1.1 Topologia — hub-and-spoke com arestas diretas seletivas

**Decisão (W1): o control plane é o hub; cada nó é um spoke que peia com o hub. Além disso, criam-se
arestas WG diretas spoke↔spoke APENAS onde existe um caminho de dados real — na prática, só o par
`nó público ↔ nó local` que implementa a Opção A.**

Comparação honesta para 2–5 nós em provedores diferentes + nós locais atrás de NAT:

| Critério | Hub-and-spoke (+arestas seletivas) | Mesh completa |
|---|---|---|
| Chaves a gerenciar | **n** peers no hub + 1 aresta por par Opção A | **n·(n−1)/2** pares |
| Blast radius de nó comprometido | vê **só o hub** (e o par Opção A, se houver) | vê **todos** |
| NAT traversal do nó local | trivial (disca para hub e para 1 nó público, ambos com IP fixo) | precisa alcançar todos, vários atrás de NAT = impossível sem relay |
| Config de um nó novo | 1 peer (hub) + registro automático | reconfigurar **todos** os nós |
| Tráfego de servir site (Opção A) | **direto** pela aresta seletiva, **não** faz hairpin no hub | direto |
| Control plane (heartbeat/jobs/log) | naturalmente hub↔spoke | passa a existir tráfego lateral inútil |
| Ponto único | **o hub** (ver §1.2) | nenhum, mas custo alto |

**Por que não mesh completa:** com 2–5 nós ela é sobre-engenharia — O(n²) chaves, cada nó exposto a
cada nó (o oposto de `04` §8.2, que isola até containers do mesmo nó), e nós atrás de NAT não
conseguem discar uns para os outros sem um servidor de relay. O único caminho lateral que o produto
realmente precisa é o da Opção A, e esse é **um par específico e declarado**, não uma malha.

**Por que não hub-and-spoke puro (tudo pelo hub):** na Opção A o tráfego de todo visitante do site
passaria `nó público → hub → nó local → hub → nó público`. Isso põe o link e a banda do control plane
(uma VPS de 2 vCPU/4 GB, `03` §1.2) no caminho de request de visitante — proibido por `03` §1.6.
Por isso a aresta `nó público ↔ nó local` da Opção A é **direta** (spoke↔spoke), fora do hub.

```
                       ┌───────────────────────────┐
                       │   HUB = Control Plane      │
                       │   10.77.0.1  (IP público)  │
                       │   admin.velozpanel.com.br  │
                       └───┬───────────┬────────┬───┘
       control plane       │           │        │  control plane
       (mTLS sobre WG)     │           │        │  (mTLS sobre WG)
                 ┌─────────┘           │        └─────────┐
                 ▼                     ▼                  ▼
        ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
        │  node-01       │   │  node-02       │   │ node-local-01  │
        │  10.77.1.1     │   │  10.77.1.2     │   │  10.77.2.1     │
        │  IP público    │   │  IP público    │   │  ATRÁS DE NAT  │
        └──────┬─────────┘   └────────────────┘   └───────┬────────┘
               │      aresta DIRETA WG (Opção A)           │
               └──────────────────────────────────────────┘
                 tráfego de visitante NÃO passa pelo hub
```

### 1.2 O hub como ponto único — e como mitigar

O hub é o control plane, que **já é** ponto único de falha assumido e documentado (`03` R1, `08` §6.4:
"CP fora = ninguém gerencia, mas os sites continuam"). A WG **não piora** isso para o tráfego de
visitante, porque:

1. **Servir site não depende do hub.** Nó público serve visitante pela borda (config em disco, `03`
   §1.6). A WG nem entra.
2. **Opção A não depende do hub.** A aresta `nó público ↔ nó local` é direta; com o hub fora, ela
   continua de pé e a Opção A continua servindo (ver §7).
3. **O que o hub fora derruba é gerência** (criar/pausar/resize, login, faturamento) — igual a hoje.

Mitigações do hub, na ordem custo→benefício:
- **Fase 1:** aceitar e documentar RTO de 60 min (idêntico a `08` §6.4). A config WG do hub
  (`/etc/wireguard/wg0.conf` + chave privada) entra no backup do CP (pgBackRest/cofre). Reprovisionar
  = restaurar `wg0.conf` e `wg-quick up wg0`; os spokes rediscam sozinhos (roaming) sem tocar em nenhum nó.
- **Fase 2 (gatilho >8 nós):** hub WG em standby quente na segunda VPS de CP, mesma chave privada
  restaurada do cofre, mesmo endereço `10.77.0.1` anunciado por DNS de baixo TTL.
- **Chave do hub no cofre offline** (junto da CA e da chave do cofre de `08` §6.4). Perder a chave do
  hub = gerar novo par e reregistrar peers; não há perda de dado, só trabalho.

### 1.3 Plano de endereçamento privado

**Faixa: `10.77.0.0/16`.** Escolha deliberada: está dentro de `10.0.0.0/8`, que a regra de egress de
container (`04` §8.2: `iif $LAN oif $WAN ip daddr {10.0.0.0/8,...} drop`) **já bloqueia** — logo,
nenhum container alcança a WG mesmo que uma regra futura erre. Não colide com a rede dos containers
(`10.60.0.0/16`) nem com faixas residenciais comuns (`192.168.*`, `10.0.0.*` de roteador doméstico —
por isso `10.77`, não `10.0`).

| Sub-bloco | Uso | Máscara por peer (`AllowedIPs`) |
|---|---|---|
| `10.77.0.0/24` | **Control plane / hub.** `10.77.0.1` = hub. `.2`–`.9` reserva p/ standby de CP | `/32` |
| `10.77.1.0/24` | **Nós de produção públicos.** `node-01=10.77.1.1`, `node-02=10.77.1.2`, … | `/32` |
| `10.77.2.0/24` | **Nós locais atrás de NAT.** `node-local-01=10.77.2.1`, … | `/32` |
| `10.77.3.0/24` | **Nós de teste/homologação** (`08`/ADENDO 3) | `/32` |
| `10.77.9.0/24` | **Serviços internos futuros** (coletor externo, bastion) | `/32` |

Regra dura: **cada peer recebe um único `/32`**. O hub roteia; ninguém anuncia `/24` (isso reabriria
o caminho lateral que a topologia fecha). Atribuição é **determinística e persistida** na tabela
`wg_peers` (§3, DDL) — o CP aloca o próximo `/32` livre no sub-bloco do papel do nó.

**DNS interno (nomes estáveis).** Zona interna `*.wg.veloz.internal`, servida pelo próprio PowerDNS do
CP (`12` §8) numa view interna, ou — mais simples na fase 1 — um `/etc/hosts` versionado distribuído
pelo `mod-rede-wireguard` a cada mudança de peer:

```
# /etc/veloz/wg-hosts  (gerado pelo CP, aplicado pelo agente)
10.77.0.1   hub.wg.veloz.internal   cp.wg
10.77.1.1   node-01.wg.veloz.internal
10.77.1.2   node-02.wg.veloz.internal
10.77.2.1   node-local-01.wg.veloz.internal
```

O agente e o coletor de métricas usam o **nome**, nunca o IP literal — assim reendereçar um nó é uma
linha na tabela, não uma caçada por IPs no código (a mesma disciplina de `03`).

### 1.4 NAT traversal para o nó local (sem IP público)

O nó local está atrás do NAT residencial, sem porta aberta. WireGuard resolve isso nativamente, desde
que o desenho respeite quatro regras:

1. **Quem inicia o handshake é sempre o nó local.** Ele conhece os endpoints públicos do hub
   (`wg.velozpanel.com.br:51820`) e do nó público que o fronteia (Opção A). O hub e o nó público
   **não** declaram `Endpoint` para o nó local — aprendem o endereço:porta do NAT no primeiro pacote
   e respondem para lá (roaming do WireGuard).
2. **`PersistentKeepalive = 25` no lado do nó local**, para todos os seus peers. Mantém o mapeamento
   NAT aberto (a maioria dos NATs residenciais expira UDP em 30–120 s). Sem keepalive, o hub não
   consegue enviar comando depois de alguns minutos de silêncio.
3. **IP residencial mudou?** WireGuard **reendereça sozinho**: no próximo keepalive vindo do novo IP,
   o hub/nó público atualizam o endpoint aprendido. Janela de indisponibilidade = até o intervalo de
   keepalive (25 s) + re-handshake. **DDNS não é necessário**, porque nada disca *para dentro* do nó
   local — ele é sempre quem inicia. (DDNS só faria falta se algum peer precisasse do nome do nó local
   como `Endpoint`, e nenhum precisa.)
4. **MTU e fragmentação.** Overhead do WireGuard: ~60 bytes (IPv4) / ~80 (IPv6). Num link residencial
   PPPoE (MTU 1492) ou com CGNAT/duplo-NAT, o padrão 1420 pode fragmentar. Recomendação:
   - `wg0` entre **dois nós de datacenter**: **MTU 1420**.
   - `wg0` quando há **link residencial/PPPoE no caminho**: **MTU 1380** (margem para PPPoE + encap),
     e **MSS clamp** no forward da perna WG→container (evita PMTUD quebrado por ICMP bloqueado):
     `tcp flags syn tcp option maxseg size set rt mtu` no nftables do nó local (§4).

### 1.5 Configs de exemplo — `wg0.conf`

> Portas: **UDP/51820** (padrão WG). Chaves geradas **em cada nó** com `wg genkey | tee privatekey | wg pubkey`;
> a chave privada nunca sai do nó (mesma disciplina do certificado mTLS, `08` §6.3). Uma **chave por peer**.

**(a) Hub — control plane (`10.77.0.1`, IP público):**

```ini
# /etc/wireguard/wg0.conf  —  HUB (control plane)  — GERADO por mod-rede-wireguard
[Interface]
Address    = 10.77.0.1/32
ListenPort = 51820
PrivateKey = <HUB_PRIVATE_KEY>            # do cofre; nunca versionar
# roteamento interno é entre /32; o hub NÃO faz NAT nem repassa spoke->spoke
# (sem PostUp de masquerade: o hub não é gateway de internet de ninguém)

# --- node-01 (público) ---
[Peer]
PublicKey           = <NODE01_PUBLIC_KEY>
AllowedIPs          = 10.77.1.1/32        # SÓ o /32 do node-01. Nada de /24.
Endpoint            = 203.0.113.10:51820  # opcional: hub também sabe discar (ambos têm IP fixo)

# --- node-02 (público) ---
[Peer]
PublicKey           = <NODE02_PUBLIC_KEY>
AllowedIPs          = 10.77.1.2/32
Endpoint            = 203.0.113.11:51820

# --- node-local-01 (atrás de NAT) ---
[Peer]
PublicKey           = <NODELOCAL01_PUBLIC_KEY>
AllowedIPs          = 10.77.2.1/32        # o hub aprende o Endpoint no 1o handshake (roaming)
# SEM Endpoint aqui: o nó local é quem disca. PersistentKeepalive fica no lado dele.
```

**(b) Spoke público — `node-01` (`10.77.1.1`, IP público):**

```ini
# /etc/wireguard/wg0.conf  —  node-01 (spoke público)
[Interface]
Address    = 10.77.1.1/32
ListenPort = 51820
PrivateKey = <NODE01_PRIVATE_KEY>

# --- hub (control plane) ---
[Peer]
PublicKey           = <HUB_PUBLIC_KEY>
AllowedIPs          = 10.77.0.1/32        # SÓ o hub. node-01 não fala com node-02 pela WG.
Endpoint            = wg.velozpanel.com.br:51820
PersistentKeepalive = 25                  # opcional aqui (tem IP fixo), mas barato e ajuda se o hub reiniciar

# --- ARESTA DIRETA Opção A: node-local-01 (só se node-01 fronteia algum ambiente dele) ---
[Peer]
PublicKey           = <NODELOCAL01_PUBLIC_KEY>
AllowedIPs          = 10.77.2.1/32        # exatamente o /32 do nó local que ele proxeia
# SEM Endpoint: o nó local disca; node-01 aprende no handshake.
```

**(c) Spoke local atrás de NAT — `node-local-01` (`10.77.2.1`):**

```ini
# /etc/wireguard/wg0.conf  —  node-local-01 (atrás de NAT, SEM IP público)
[Interface]
Address    = 10.77.2.1/32
ListenPort = 51820                        # porta local; o NAT mapeia dinamicamente
PrivateKey = <NODELOCAL01_PRIVATE_KEY>
MTU        = 1380                         # residencial/PPPoE (ver §1.4)

# --- hub (control plane) ---
[Peer]
PublicKey           = <HUB_PUBLIC_KEY>
AllowedIPs          = 10.77.0.1/32
Endpoint            = wg.velozpanel.com.br:51820
PersistentKeepalive = 25                  # OBRIGATÓRIO: mantém o furo no NAT aberto

# --- ARESTA DIRETA Opção A: node-01 é quem fronteia meus sites ---
[Peer]
PublicKey           = <NODE01_PUBLIC_KEY>
AllowedIPs          = 10.77.1.1/32        # só o nó que me proxeia
Endpoint            = 203.0.113.10:51820  # o nó local disca para o nó público (que tem IP fixo)
PersistentKeepalive = 25
```

Observação: o nó local **não** tem `10.77.0.0/16` em nenhum `AllowedIPs` — só os `/32` de quem ele
realmente fala (hub + o nó público que o fronteia). É isso que impede um nó local comprometido de
varrer a WG.

---

## 2. Impacto no transporte CP↔agente

Hoje (pós-crítica do Ciclo 1, `criticas/ciclo-1-critica.md` Conflito 4): **Postgres é a fila**
(`jobs`/`job_steps`), o **agente faz long-poll HTTPS com certificado de cliente (mTLS)**, o **log ao
vivo vai por WebSocket retomável**, e **métricas por remote-write** para o VictoriaMetrics — tudo pela
**internet pública**.

Com a WG: **o mesmo transporte, mas o agente disca para o endereço WG do hub** (`https://10.77.0.1/agent/v1/...`)
em vez do IP público. **O mTLS é mantido por cima** (defesa em profundidade): a WG autentica a máquina
(chave), o mTLS autentica o **nó** (certificado com `CN=node_id`, `08` §6.3). Uma camada não substitui
a outra.

**O que melhora:**
- **Superfície de ataque.** O endpoint `/agent/v1/*` do CP passa a **bindar em `10.77.0.1`**, some da
  internet pública. Some também o alvo "porta 443 administrativa do painel exposta" — sobra na
  internet só o painel web humano (`admin.velozpanel.com.br`) e o `/install/node.sh`. Casa com a lição
  central de `02` §7.3 ("o painel é o alvo mais valioso") e com o corte do NATS (não expor um segundo
  serviço de rede).
- **NAT.** Resolve o nó local sem IP público sem gambiarra (era impossível antes: o agente disca de
  saída, mas para a Opção A precisávamos de um caminho de volta — a WG dá isso).
- **IP do nó muda?** Irrelevante para o transporte — o agente fala com `10.77.0.1`, endereço estável.

**O que piora:**
- **Gerência passa a depender da WG.** Se a WG do nó cai, o CP perde a **gerência** daquele nó (não os
  sites — ver §7). É uma dependência nova no caminho de administração.
- **Mais uma peça no bootstrap** e no node-doctor (§6).

**Obrigatória ou opcional? (W3, recomendação):**

| Tipo de nó | WG | Justificativa |
|---|---|---|
| **Nó local atrás de NAT** | **Obrigatória** | Não há outro caminho de entrada. Sem WG, o nó não existe no produto. |
| **Nó público de produção** | **Recomendada (padrão)**, com **fallback mTLS público** | Tira o endpoint do agente da internet. Mas não pode ser um ponto de falha duro de gerência. |
| **Nó de teste** | Opcional | Vantagem de engenharia, não crítico. |

**Recomendação:** o **feature** é modular (`mod-rede-wireguard`), mas quando instalado num nó público
ele vira o **caminho preferencial** do transporte. Mantém-se um **endpoint mTLS público de fallback**
no CP, **firewallado só para os IPs dos nós** e com rate-limit, para o qual o agente volta se o
handshake WG falhar por >5 min. Trade-off explícito: o fallback reabre uma pequena superfície pública,
mas evita que um bug de WG deixe você **cego** para um nó em produção. Para o nó local não há fallback
(ele não tem IP público de entrada) — a WG é a vida dele, e isso é o preço de não ter IP público.

---

## 3. Opção A — nó sem IP público servindo sites via proxy reverso sobre WG

### 3.1 Fluxo ponta a ponta

```
Visitante  ──HTTPS(443)──►  node-01 (nginx de BORDA, TLS aqui)
                               │  proxy_pass http://10.77.2.1:8071   (HTTP em claro, mas dentro da WG)
                               ▼
                          [ túnel WireGuard, cifrado ChaCha20 ]
                               ▼
                          node-local-01: nginx (escuta 10.77.2.1:8071)
                               │  proxy_pass http://10.60.0.71:80     (rede de container local)
                               ▼
                          container do cliente (php-fpm / node) — env-0071
```

Repare que há **dois nginx**: o da **borda do nó público** (termina TLS, é a face da internet) e o do
**nó local** (escuta na `wg0`, entrega ao container). Isso reaproveita a borda que `04` §6 e `06` §2
já especificam nos dois lados — nada novo, só um `proxy_pass` apontando para um IP WG.

### 3.2 Geração do `upstream`/`proxy_pass` no nó público

Vhost gerado no **nó público** (`node-01`), variante da Opção A do template de `04` §6.3:

```nginx
# /etc/nginx/veloz/sites/env-0071.conf  — GERADO (serving_mode = wg-proxy, front = node-01)
upstream env_0071_wg {
    server 10.77.2.1:8071;          # IP WG do node-local-01 + porta do ambiente
    keepalive 16;
}

server {
    listen 443 ssl;
    listen 443 quic reuseport;
    http2 on;
    server_name loja.cliente.com.br www.loja.cliente.com.br;

    # TLS TERMINA AQUI (ver §3.3). Certificado no nó público, emitido por DNS-01 (12 §3.5.1).
    ssl_certificate     /etc/velozpanel/certs/loja.cliente.com.br/fullchain.pem;
    ssl_certificate_key /etc/velozpanel/certs/loja.cliente.com.br/privkey.pem;
    include /etc/nginx/veloz/global/ssl.conf;
    add_header Alt-Svc 'h3=":443"; ma=86400' always;

    include /etc/nginx/veloz/state/env-0071.conf;   # pause/suspenso (04 §6.3)
    limit_req  zone=perip burst=40 nodelay;
    client_max_body_size 128m;

    location / {
        proxy_pass http://env_0071_wg;              # HTTP em claro, mas cifrado pela WG
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        # cabeçalhos para o app do cliente ver o VISITANTE, não a borda (§3.4)
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # o link do nó local pode cair — falhar rápido e servir página branded (§3.5)
        proxy_connect_timeout 5s;
        proxy_read_timeout    30s;
        proxy_next_upstream   error timeout http_502 http_503 http_504;
        error_page 502 503 504 = @wg_offline;
    }

    location @wg_offline {
        internal;
        root /etc/nginx/veloz/branded;
        try_files /wg-offline.html =503;            # 503 branded, não o erro cru do nginx
    }
}
```

No **nó local** (`node-local-01`), o listener na `wg0` que entrega ao container:

```nginx
# /etc/nginx/veloz/sites/env-0071.conf  — GERADO no NÓ LOCAL
server {
    listen 10.77.2.1:8071;              # escuta SÓ na wg0 (nunca em 0.0.0.0)
    server_name loja.cliente.com.br;

    # o app precisa enxergar o IP real do visitante, não o IP WG do nó público:
    set_real_ip_from 10.77.1.1;         # confia no XFF vindo do nó público (node-01)
    real_ip_header    X-Forwarded-For;
    real_ip_recursive on;

    location / {
        proxy_pass http://10.60.0.71:80;            # container do env-0071 na rede vlz0 local
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;   # já é o real, por causa do set_real_ip_from
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    }
}
```

### 3.3 Onde termina o TLS — recomendação

**Recomendação (W5): o TLS termina na borda do nó público, e o tráfego trafega em HTTP claro pela
WG.** Motivo: a WG já cifra a perna `nó público → nó local` com ChaCha20-Poly1305 autenticado.
Re-cifrar (proxy_ssl na perna WG) só adicionaria uma segunda camada de TLS **dentro** de um túnel já
cifrado — dobra CPU de cripto, exige emitir e renovar certificado também no nó local, e não protege
contra nenhuma ameaça que a WG não cubra (quem está na WG já é peer autenticado por chave).

- Certificado vive **no nó público** que fronteia. Emitido por **ACME DNS-01 com delegação**
  (`12` §3.5.1, zona `acme-cd.veloz.app`) — funciona mesmo antes do DNS do cliente apontar para o nó
  público e sem tocar o CP. É o mesmo mecanismo da migração (`06` §8.2, detalhe 2).
- Exceção (rara): se um requisito de conformidade exigir "cifrado fim-a-fim até o container", aí sim
  `proxy_ssl` na perna WG com um cert interno — mas isso é exceção documentada, não o padrão.

### 3.4 Cabeçalhos — o app vê o IP real do visitante

A cadeia de dois proxies precisa preservar o IP do visitante:

1. **Nó público** injeta `X-Forwarded-For: <ip_visitante>`, `X-Forwarded-Proto: https`, `Host` original.
2. **Nó local** usa `set_real_ip_from 10.77.1.1` (o IP WG do nó público, **o único** que ele confia
   para XFF) + `real_ip_header X-Forwarded-For`. Assim `$remote_addr` dentro do container vira o IP do
   visitante, e o WordPress/Laravel/Node do cliente loga e limita por IP real.

**Regra de segurança:** o nó local **só** confia em XFF vindo do `/32` do nó público que o fronteia
(`set_real_ip_from 10.77.1.1`), nunca em `0.0.0.0/0`. Como o listener está na `wg0` e a `wg0` só aceita
o peer do nó público (`AllowedIPs`), não há como um terceiro forjar XFF.

### 3.5 Custo: latência, banda e queda de link

**Latência do pulo extra:** RTT `nó público ↔ nó local` pela WG. Se os dois estão na mesma cidade/país
(o caso típico: nó local é a casa/escritório do dono, nó público é uma VPS BR), **~5–30 ms**. Se o nó
público está em outro continente, some a isso a latência transcontinental (`12` §3) — Opção A
cross-region é desaconselhada.

**Banda — o risco real (quantificar):** **todo** o tráfego do site sobe pelo **upload residencial** do
nó local. É a resposta HTTP inteira que percorre `container → nó local → WG → nó público → visitante`.
O gargalo é o **upload** residencial, tipicamente 20–50 Mbps no Brasil (e simétrico só em fibra boa).

| Cenário | Página média | Req/s sustentável no upload | Veredito |
|---|---:|---:|---|
| Blog/institucional, 300 KB/página, cache na borda | 300 KB | ~10 req/s @ 25 Mbps up (cache absorve o resto) | **OK** |
| Loja dinâmica, 1,5 MB/página, pouco cacheável | 1,5 MB | ~2 req/s @ 25 Mbps up | **limítrofe** |
| Site com mídia/download, 5 MB | 5 MB | <1 req/s | **impróprio para Opção A** |

Mitigação parcial: o **cache de página na borda do nó público** (`04` §6.4, `proxy_cache`) serve HTML
cacheável **sem** tocar o link residencial — só o *miss* sobe pelo upload. Ainda assim: **Opção A é
para sites de baixo tráfego / dev / staging / projeto pessoal**, e a UI precisa dizer isso na hora de
escolher o modo.

**Se o link do nó local cair:** o `proxy_pass` do nó público recebe *connection refused*/timeout →
`proxy_next_upstream` → `error_page 502 503 504 @wg_offline` → **página 503 branded** ("site
temporariamente indisponível"), não o erro cru. **O site fica fora** enquanto o link não volta — e
isso é intrínseco à Opção A (o dado vive no nó local). Só os ambientes em Opção A daquele nó local
caem; tudo que é servido direto pelo nó público continua no ar.

### 3.6 Como o painel sabe o modo e roteia certo

Campo no modelo de dados (DDL em §5 desta seção → consolidado abaixo):

```sql
-- enum de modo de servir
CREATE TYPE serving_mode AS ENUM ('direct', 'wg-proxy', 'cf-tunnel');

ALTER TABLE environments
  ADD COLUMN serving_mode   serving_mode NOT NULL DEFAULT 'direct',
  ADD COLUMN front_node_id  text REFERENCES nodes(id),   -- nó público que fronteia (só wg-proxy)
  ADD COLUMN wg_upstream_ip inet,                        -- IP WG do nó local (só wg-proxy), ex. 10.77.2.1
  ADD COLUMN wg_upstream_port int;                       -- porta no nó local, ex. 8071
-- invariante (CHECK): serving_mode='wg-proxy' EXIGE front_node_id, wg_upstream_ip, wg_upstream_port
ALTER TABLE environments ADD CONSTRAINT env_wgproxy_complete CHECK (
  serving_mode <> 'wg-proxy'
  OR (front_node_id IS NOT NULL AND wg_upstream_ip IS NOT NULL AND wg_upstream_port IS NOT NULL)
);
```

O **scheduler** (`03` §1.1) e o gerador de vhost passam a ler `serving_mode`:
- `direct` → vhost normal, `proxy_pass http://10.60.0.<n>:80` no próprio nó (comportamento de hoje).
- `wg-proxy` → o CP emite **dois** jobs: um para o `front_node_id` (gera o vhost com `proxy_pass` para
  `wg_upstream_ip:wg_upstream_port` + cert) e um para o nó local (gera o listener na `wg0` + container).
- `cf-tunnel` → vhost aponta para o conector Cloudflare local; TLS na borda da Cloudflare (§8).

---

## 4. Segurança — a WG não pode virar rede plana

### 4.1 Regra inegociável: o container do cliente NUNCA entra na WG

Três barreiras independentes garantem isso (defesa em profundidade — se uma falhar, as outras seguram):

1. **A WG está em `10.77.0.0/16`, dentro de `10.0.0.0/8`**, que a regra de egress de container de
   `04` §8.2 **já derruba** (`iif $LAN oif $WAN ip daddr {10.0.0.0/8,...} drop`). Container que tente
   alcançar a WG bate nessa regra.
2. **A `wg0` não é membro da bridge `vlz0`.** São interfaces separadas; não há L2 entre container e WG.
3. **Regra explícita de forward `vlz0 → wg0` = drop** (adicionada ao ruleset de `04` §8.2, abaixo).

### 4.2 Segmentação por `AllowedIPs` + nftables por peer

**`AllowedIPs` já é a primeira firewall** (roteamento criptográfico do WireGuard): um peer só consegue
**enviar** para IPs listados no `AllowedIPs` dele, e o hub só **roteia** o que couber no `AllowedIPs`
daquele peer. Com `/32` por peer e sem `/24`, **spoke não alcança spoke** pela WG — exceto a aresta
direta da Opção A, que é o único par declarado.

Sobre isso, **nftables por peer** restringe *portas* dentro da WG:

```nft
# ADIÇÃO ao /etc/nftables.conf de CADA NÓ (complementa 04 §8.2)
define WG      = wg0
define WG_HUB  = 10.77.0.1

table inet filter {
    chain input {
        # ... regras de 04 §8.2 ...
        udp dport 51820 accept                         # handshake WireGuard (o único UDP admin exposto)

        # DENTRO da WG: só o que o papel do nó precisa
        iif $WG ip saddr $WG_HUB tcp dport 443 accept  # agente<->CP (mTLS sobre WG): SÓ do hub
        # (nó público que faz Opção A: aceitar a porta do ambiente vinda do nó local — ver forward)
        iif $WG drop                                   # nada mais entra pela WG
    }

    chain forward {
        # ... regras de 04 §8.2 (isolamento de container) ...
        # BARREIRA 3: container NUNCA alcança a WG
        iif $LAN oif $WG drop
        oif $LAN iif $WG drop

        # Opção A (só no nó público que fronteia): permitir a perna WG->local para o ambiente
        #   e no nó local: permitir wg0 -> container do ambiente servido, com MSS clamp
        # (regras geradas por ambiente pelo mod-rede-wireguard; exemplo do lado do nó local:)
        iif $WG oif $LAN ip daddr 10.60.0.71 tcp dport 80 accept
        iif $WG tcp flags syn tcp option maxseg size set rt mtu    # MSS clamp (§1.4)
    }
}
```

O nó público que faz Opção A **origina** a conexão para `10.77.2.1:8071` a partir do próprio nginx
(processo do host), então é tráfego de *output* do host, não de *forward* — não precisa de regra de
forward do lado dele, só do lado do nó local (que repassa para o container).

**Um nó comprometido não varre a rede** porque: (a) o `AllowedIPs` do peer comprometido só lista o hub
(e, se for par de Opção A, um `/32`); (b) mesmo que ele forje pacotes para outros `10.77.x`, o hub não
os roteia (não estão no `AllowedIPs` daquele peer); (c) o nftables do hub só aceita `tcp/443` na `wg0`,
então nem o hub é uma superfície ampla.

### 4.3 Rotação e revogação de chave de peer (remover um nó)

**Rotacionar a chave de um nó** (comprometimento suspeito, rotação periódica):
```bash
# no nó:
wg genkey | tee /etc/wireguard/privatekey.new | wg pubkey > /etc/wireguard/publickey.new
# o agente envia a nova pubkey ao CP (POST /agent/v1/wireguard/rotate)
# o CP atualiza o peer no hub e devolve confirmação; então o nó troca a chave e reinicia wg0
```

**Revogar/remover um peer** (nó desativado, `velozctl node forget`):
```bash
# no hub (feito pelo mod-rede-wireguard a partir de um job do CP):
wg set wg0 peer <NODE_PUBLIC_KEY> remove
wg-quick save wg0                      # persiste
# + remover linha em wg_peers, + revogar o certificado mTLS do nó (08 §6.3),
# + remover do wg-hosts e do DNS interno
```

Isso casa 1:1 com o `velozctl node forget` de `40` Runbook 2 (Caso E): remover o nó já implica remover
o peer WG **e** revogar o cert mTLS. São a mesma operação atômica no CP.

### 4.4 Interação com o egress SMTP bloqueado e o CrowdSec

- **Egress SMTP (`04` §8.3):** **nada muda.** O bloqueio de 25/465/587 é na perna `container → WAN`.
  A WG é outra interface; o container nem a alcança (§4.1). O relay SMTP do painel continua o único
  caminho legítimo. A WG **não** vira um bypass do bloqueio de spam.
- **CrowdSec (`04` §8.2, `set ban4`):** continua vigiando a **borda pública** (`eth0`, 80/443). A
  `wg0` **não** precisa de CrowdSec — só entra peer autenticado por chave + mTLS, não há tráfego
  anônimo para bruteforçar. Recomenda-se, isso sim, um cenário CrowdSec para o **endpoint do agente**
  (tentativas de mTLS inválido) e para a UDP/51820 (floods de handshake): ban por `/32` na borda,
  sem tocar peers legítimos.

---

## 5. Impacto em banco, backup e métricas

### 5.1 Banco do cliente — **não muda** (confirmação)

O acesso do cliente ao próprio banco **continua local ao nó** e **não passa pela WG**. Como em
`04` §8.4 e `09` §1: o MySQL/Postgres roda no host, binda em `10.60.0.1`, e a conta é amarrada ao **IP
do container** (`'e0071'@'10.60.0.71'`). O cliente acessa por **Adminer no painel** (nível 0) ou
**túnel SSH** (nível 1, `09` §1.6) — nenhum dos dois usa a WG dos nós.

> Nuance importante para não confundir dois WireGuards: `09` §1.6 nível 3 cita "**WireGuard do
> cliente** (add-on)". Isso é uma **interface separada** (ex.: `wg-cliente`), um produto de acesso do
> cliente ao **seu** `10.60.0.1`, **não** a `wg0` de mesh dos nós. Os dois nunca se cruzam: o cliente
> jamais recebe peer na `wg0`, e a `wg-cliente` jamais enxerga outro nó. Manter os nomes distintos no
> código evita o pior erro possível aqui (dar a um cliente uma rota para a malha da plataforma).

### 5.2 Backup — vai **direto** ao object storage, não pela WG

`09` §5.1 define destinos **Backblaze B2** e **Magalu Cloud (BR)** — serviços externos com IP público.
Backup **não** usa a WG: seria um hairpin sem sentido (a WG não chega no B2). A cópia local nível 1
(restic em `/var/backups/veloz`, `09` §5.1) fica no próprio nó. A cópia entre nós **foi rejeitada** por
`09` §5.1 (mesmo domínio de confiança) — logo não há backup nó↔nó para a WG carregar.

**Confirmação:** a WG **não altera** o pipeline de backup. O que muda é só a conta de banda (§5.4).

### 5.3 Heartbeat / usage / métricas — passam pela WG

Estes **passam** a trafegar pela WG, porque são exatamente o transporte CP↔agente (§2):
- **Heartbeat** e **eventos de uso**: dentro do long-poll/POST do agente para `10.77.0.1`.
- **Métricas** (remote-write para o VictoriaMetrics, `03` D9 / `11`): o agente empurra para o
  endereço WG do CP. Ganho: o VictoriaMetrics **sai da internet pública** (bindando em `10.77.0.1`).

### 5.4 Recálculo de banda — economia ou custo?

Volumes de `12` §3.2: métricas ~2 KB/min/ambiente comprimido → **<100 MB/mês/nó**; heartbeat e usage
são menores. A WG adiciona **~4–5% de overhead de encapsulamento** por pacote. Então:

| Fluxo | Antes (internet pública) | Depois (WG) | Δ |
|---|---|---|---|
| Métricas+heartbeat+usage | <100 MB/mês/nó | <105 MB/mês/nó | **+~5%** (encap) |
| Log ao vivo (efêmero, sob demanda) | idem | idem +5% | +~5% |
| **Backup** | direto ao B2 (o grosso da banda) | **inalterado** (não usa WG) | 0 |
| **Tráfego de visitante (Opção A)** | não existia | **novo custo**, sobe pelo upload residencial (§3.5) | **novo** |

**Veredito:** não há economia de banda pela WG — há um **custo pequeno** (+5% de encap no control
plane, irrelevante contra a cota da VPS) e um **custo novo e relevante** (o tráfego de visitante da
Opção A no link residencial, §3.5). O ganho da WG é **segurança e habilitar o nó local**, não banda.

---

## 6. Bootstrap e node-doctor

### 6.1 O que muda no `bootstrap.sh`

Princípio de `08` §6 preservado: `bootstrap.sh` faz o **mínimo irredutível**; o resto converge por
módulos. A WG **é um módulo de nó** (`mod-rede-wireguard`), convergido na FASE 4 (`08` §6.3). Porém há
uma **ordem de ovo-e-galinha para o nó local** que precisa estar escrita:

- **Nó público:** enroll acontece pela internet pública (o CP tem IP público). Depois, na convergência,
  `mod-rede-wireguard` sobe `wg0`, registra o peer no hub, e o transporte **migra** para o endereço WG.
  Nada de especial no `bootstrap.sh`.
- **Nó local atrás de NAT:** também enrola **pela internet pública** contra o endpoint público do CP
  (o nó local tem saída para a internet, só não tem entrada). Só **depois** de `wg0` de pé o transporte
  passa a preferir a WG. Ou seja: **não** é preciso "subir wg0 antes do agente" para enrolar — o enroll
  é sempre possível pela internet de saída. A ordem `wg0 antes do agente` só vale se você quiser que o
  **primeiro** long-poll já vá pela WG; é opcional e o módulo cuida disso.

Sequência de convergência do `mod-rede-wireguard` (FASE 4 de `08` §6.3, entra logo após `mod-node-base`):

```
1. apt-get install -y wireguard wireguard-tools        # kernel WG + ferramenta 'wg'
2. wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey   (0600)
3. POST /agent/v1/wireguard/register {node_id, public_key, has_public_ip, listen_port}
     -> CP aloca /32 no sub-bloco do papel, devolve {wg_address, hub_pubkey, hub_endpoint,
        allowed_ips, peers_da_aresta_opcao_A?}     (idempotente por node_id)
4. gerar /etc/wireguard/wg0.conf a partir do retorno (templates do §1.5)
5. systemctl enable --now wg-quick@wg0              # SOBE wg0
6. verificar handshake: wg show wg0 latest-handshakes   (espera < 3 min)
7. (se preferência = WG) reconfigurar o agente para discar https://10.77.0.1/agent/v1/...
8. health.sh: interface up + handshake recente + ping 10.77.0.1
```

### 6.2 Itens novos no `veloz-node-doctor.sh`

Adicionar uma **seção 9** ao script (`Plan/scripts/veloz-node-doctor.sh`). WG é **opcional/modular**,
então as checagens saem como **ATENÇÃO** (não CRÍTICO) — um nó sem WG ainda serve como público-direto:

```bash
echo "== 9. WireGuard (necessário p/ mod-rede-wireguard e p/ nó atrás de NAT) =="
if modprobe -n wireguard 2>/dev/null; then
  ok   "modprobe wireguard" "módulo disponível no kernel"
else
  warn "modprobe wireguard" "ausente — kernel sem WG; usar wireguard-go (userspace) ou pular WG"
fi
if ip link add wgdoctor type wireguard 2>/dev/null; then
  ok "ip link add type wireguard" "funciona"; ip link del wgdoctor 2>/dev/null
else
  warn "criar interface wireguard" "NEGADO — sem WG nativo neste nó"
fi
command -v wg >/dev/null \
  && ok   "ferramenta wg" "$(wg --version 2>/dev/null)" \
  || warn "ferramenta wg" "ausente — apt install wireguard-tools"
# UDP de saída para o hub (handshake). Nó atrás de NAT precisa disso funcionando.
if command -v nc >/dev/null && timeout 3 nc -u -z -w2 wg.velozpanel.com.br 51820 2>/dev/null; then
  ok   "UDP/51820 de saída" "alcança o hub"
else
  warn "UDP/51820 de saída" "não confirmado — checar firewall do provedor / roteador residencial"
fi
info "MTU sugerida p/ wg0" "1420 (datacenter) · 1380 (residencial/PPPoE)"
```

Notas:
- **WARN, não CRIT**, é proposital: WG é opcional. **Exceção operacional:** para um nó que **será**
  local-atrás-de-NAT, uma falha aqui é bloqueante *de fato* (sem WG ele não existe) — mas isso é regra
  de negócio do instalador, não do doctor genérico.
- O doctor semanal (`08` §6.2, uso 3) passa a pegar regressão: um `kernel upgrade` do provedor que tire
  o módulo `wireguard` derruba a `wg0` silenciosamente; o WARN semanal avisa antes do cliente.

---

## 7. Failure modes e a regra "painel cai, sites no ar"

A regra (`03` §1.6, elevada a intercontinental em `12` §3.5) **continua válida**. Prova por caso:

| Evento | Nó público (site direto) | Nó local (Opção A) | Gerência |
|---|---|---|---|
| **Hub (CP) cai** | **no ar** (borda em disco, não usa WG) | **no ar** (a aresta WG nó-público↔nó-local é DIRETA, não passa pelo hub) | para (igual hoje) |
| **WG cai (toda)** | **no ar** (não depende da WG para servir) | **502/503 branded** (proxy não alcança o container) | para; agente volta ao fallback mTLS público se habilitado (§2) |
| **Nó local perde link** | **no ar** | **502/503 branded** só dos ambientes daquele nó local | inalterada para os demais nós |
| **IP residencial muda** | **no ar** | reconecta em ~25 s (roaming, §1.4); breve 502 | reconecta sozinha |

**O trade-off explícito (W10):** um site **direto** no nó público depende de **1** coisa (o nó
público). Um site em **Opção A** depende de **3**: (a) o nó público que fronteia, (b) a aresta WG, (c)
o link do nó local. É **estritamente menos disponível** — e é o preço de hospedar num servidor sem IP
público. Só o nó local-atrás-de-NAT carrega essa dependência; o tráfego de visitante do nó **público**
não depende da WG nem do painel, como exige o ADENDO 6 item 8.

**Alerta que não pode viajar pelo link que caiu** (casa com `12` §3.5.3): o watchdog do agente
(`03` §1.6) e o `mod-alerts` do nó local mandam o alarme por um caminho **local** (webhook direto
ntfy/Telegram pela internet de saída do nó local), **nunca** pela WG nem pelo CP — senão o alerta morre
junto com a coisa que caiu.

---

## 8. Matriz de decisão — qual modo usar

| Critério | **Nó público direto** (padrão) | **Nó via WG / Opção A** | **Cloudflare Tunnel** |
|---|---|---|---|
| **Quando usar** | Todo nó que **tem IP público** | Servidor **local sem IP público** que você controla (casa/escritório) | Sem IP público **e** você não quer rodar um nó público seu na frente **e** quer esconder o IP de origem / proteção DDoS |
| **Latência** | mínima (0 pulos extras) | +1 pulo WG (~5–30 ms local; ruim cross-region) | +1 pulo até o PoP Cloudflare (varia) |
| **Banda** | banda da VPS | **upload residencial** é o teto (§3.5) | sobe pelo link local também, mas com PoP e cache CF na frente |
| **Custo** | só a VPS | VPS pública (fronte) + luz/link de casa | grátis (plano free) a pago; sem VPS de fronte |
| **Complexidade** | baixa (é o desenho base) | média (2 nginx, aresta WG, `serving_mode`) | baixa-média (rodar `cloudflared`; conta CF) |
| **Risco** | nenhum novo | 3 dependências (§7); banda; IP muda | **dependência de terceiro**; **TLS termina na Cloudflare** (CF vê o claro); ToS da CF restringe servir conteúdo não-HTML pesado no free |
| **Onde termina o TLS** | borda do nó | borda do nó público (§3.3) | **borda da Cloudflare** (fora do seu controle) |

**Recomendação:**
- **Padrão: nó público direto.** É o desenho base; use sempre que o nó tiver IP público.
- **Exceção 1 — Opção A:** para o **servidor local sem IP público** do próprio dono (o caso do ADENDO
  6). Requer um nó público seu como fronte. Bom para dev/staging/baixo tráfego.
- **Exceção 2 — Cloudflare Tunnel:** quando você **não** quer rodar/expor um nó público próprio na
  frente, quer **esconder o IP de origem** ou **proteção DDoS de graça**, e aceita que a Cloudflare
  **termina o TLS** e vê o tráfego em claro. Não recomendado como padrão por criar dependência de
  terceiro no caminho de todo request e pelas restrições de ToS. É `serving_mode = 'cf-tunnel'` no
  modelo de dados — previsto, mas não é fase 1.

---

## 9. Empacotar como módulo `mod-rede-wireguard`

Coerente com o sistema modular (`08` §2). Escopo `node` (instalado em nós específicos), `tier: optional`.

### 9.1 Manifesto `module.yaml`

```yaml
apiVersion: veloz.panel/v1
kind: Module
metadata:
  name: mod-rede-wireguard
  version: 1.0.0
  displayName: "Rede Privada (WireGuard)"
  description: "Malha privada WireGuard entre control plane e nós, hub-and-spoke, com Opção A (proxy reverso sobre WG) para nó sem IP público."
  vendor: "VelozPanel"
  license: "Apache-2.0"
  categories: [network]
  scope: node
  tier: optional

spec:
  delivery: builtin
  compat: { core: ">=1.4.0 <2.0.0", sdk: "1", agent: ">=1.0.0" }

  requires:
    - { capability: node.base, version: "1" }      # nftables, systemd, borda nginx

  provides:
    capabilities:
      - name: network.overlay          # o roteador/gerador de vhost consulta p/ resolver Opção A
        version: "1"
        attributes:
          topology: "hub-and-spoke"
          cidr: "10.77.0.0/16"
    meters: []                          # a WG não fatura por si; a banda da Opção A é do metering de tráfego

  nodeRequirements:
    os: ["debian>=13"]
    arch: ["amd64","arm64"]
    minMemoryMB: 64
    kernelFeatures: ["wireguard"]       # o node-doctor §9 valida; fallback wireguard-go se ausente
    ports: []                           # UDP/51820 é saída (nó local) / entrada só no hub
    systemPackages: ["wireguard-tools"]

  rollout:
    strategy: canary
    canarySoakMinutes: 10
    requireNodes: selected              # NÃO é 'all': instala só nos nós que vão entrar na malha
    onNodeFailure: abort
    onNodeOffline: defer
    deferTimeoutHours: 72

  configSchema:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    additionalProperties: false
    properties:
      role:            { type: string, enum: [public, local, test], default: public, title: "Papel na malha" }
      hub_endpoint:    { type: string, default: "wg.velozpanel.com.br:51820", title: "Endpoint do hub" }
      listen_port:     { type: integer, default: 51820 }
      mtu:             { type: integer, minimum: 1280, maximum: 1420, default: 1420, title: "MTU (1380 p/ residencial)" }
      persistent_keepalive: { type: integer, minimum: 0, maximum: 120, default: 25 }
      prefer_wg_transport:  { type: boolean, default: true, title: "Agente disca pela WG (fallback mTLS público)" }
    required: [role]

  secrets:
    - { key: WG_PRIVATE_KEY, label: "Chave privada WireGuard do nó", required: true, rotatable: true, generateIfMissing: true }

  hostApi:
    scopes: [jobs.emit, events.emit, secrets.read, secrets.write, config.read, config.write]

  hooks:
    preflight:   { run: "node/preflight.sh",  timeout: 60s,  mustBeIdempotent: true }  # roda o doctor §9
    install:     { run: "node/install.sh",    timeout: 300s }                          # apt, genkey
    postInstall: { run: "node/post-install.sh", timeout: 120s }                        # register no hub
    enable:      { run: "node/enable.sh",     timeout: 120s }                          # wg-quick up wg0
    configure:   { run: "node/configure.sh",  timeout: 120s }                          # regenerar wg0.conf
    disable:     { run: "node/disable.sh",    timeout: 60s }                           # wg-quick down + fallback mTLS
    uninstall:   { run: "node/uninstall.sh",  timeout: 120s }                          # remove peer no hub, apaga chave
    rollback:    { run: "node/rollback.sh",   timeout: 120s }
    health:      { run: "node/health.sh",     intervalSeconds: 30, timeoutSeconds: 10, failureThreshold: 3 }

  tasks:
    - { name: wg.register_peer,  run: "node/tasks/register.sh",  idempotent: true, lock: node, timeout: 60s, requiredPermission: "admin.nodes.manage" }
    - { name: wg.rotate_key,     run: "node/tasks/rotate.sh",    idempotent: true, lock: node, timeout: 60s, requiredPermission: "admin.nodes.manage" }
    - { name: wg.add_optionA,    run: "node/tasks/add_edge.sh",  idempotent: true, lock: node, timeout: 60s, requiredPermission: "admin.nodes.manage" }
    - { name: wg.remove_optionA, run: "node/tasks/rm_edge.sh",   idempotent: true, lock: node, timeout: 60s, requiredPermission: "admin.nodes.manage" }

  # endpoint no CP para o auto-registro do §6.1 (o hub aloca /32, adiciona o peer, devolve config)
  api:
    basePath: "/api/v1/modules/rede-wireguard"
    routes:
      - { method: POST, path: "/agent/register", permission: "internal.agent", audit: true }
      - { method: POST, path: "/agent/rotate",   permission: "internal.agent", audit: true }
      - { method: GET,  path: "/nodes/{node_id}/peers", permission: "admin.nodes.manage" }
      - { method: GET,  path: "/status", permission: "admin.nodes.read" }

  database:
    schema: mod_rede_wireguard
    migrations: "migrations/"          # cria wg_peers (ver §10 DDL)

  ui:
    mounts:
      - { slot: "admin.section", id: "rede", label: "Rede (WireGuard)", icon: "network", order: 60, route: "/admin/rede", component: "RedeOverviewPage", permission: "admin.nodes.read" }
      - { slot: "admin.node.tabs", id: "wg-node", label: "WireGuard", component: "WgNodePage", permission: "admin.nodes.manage", order: 30 }

  permissions:
    - { key: "admin.nodes.read",   label: "Ver status da rede",       defaultRoles: ["owner","admin"] }
    - { key: "admin.nodes.manage", label: "Gerenciar peers WireGuard", defaultRoles: ["owner","admin"] }

  healthcheck:
    node: { run: "node/health.sh", intervalSeconds: 30, timeoutSeconds: 10, failureThreshold: 3 }
    degradedPolicy: "alert_only"       # WG degradada NÃO derruba o site; só alerta e (se público) usa fallback

  uninstall:
    dataPolicy: "purge"
    blockIf:
      - "environments_serving_via_this_node_optionA > 0"   # não remova WG se há site em Opção A dependendo dela
    dropSchema: false

  telemetry:
    metrics: ["wg_up","wg_last_handshake_seconds","wg_rx_bytes","wg_tx_bytes","wg_peer_count"]
    logs: ["wg.error"]

  docs:
    operator: "docs/operator.md"
    runbook:  "docs/runbook.md"
```

### 9.2 O que instala no nó
`wireguard-tools`, `/etc/wireguard/wg0.conf` (gerado), unit `wg-quick@wg0`, as regras nftables do §4.2,
e o `wg-hosts` (§1.3). Não instala serviço novo exposto na internet além da UDP/51820 (que no nó local
é só saída).

### 9.3 O que expõe no painel (tela de rede)
`Admin → Rede`: lista de peers com **status do handshake** (verde se `latest-handshake < 3 min`),
**latência** (ping WG hub↔nó), **RX/TX** por peer, **papel** (public/local/test) e **quem fronteia
quem** na Opção A. Por nó (`admin.node.tabs`): a `wg0.conf` efetiva (sem a chave privada), botão
**rotacionar chave** e **remover da malha**. Isso alimenta o Runbook de túnel caído (§10, docs/40).

### 9.4 Contrato de capability
`network.overlay v1` — consumida pelo **gerador de vhost / roteador** para resolver, dado um
`environment` com `serving_mode='wg-proxy'`, o par `(front_node_id, wg_upstream_ip, wg_upstream_port)`
e emitir os dois jobs (nó público + nó local). É a única capability nova; a WG em si é infraestrutura,
não fatura por si.

---

## 10. Atualização dos manuais

### 10.1 `docs/20-INSTALAR-NO-ZERO.md` — nova sub-etapa (inserir como **Etapa 4.5**, logo após "Etapa 4 — Primeiro nó" e antes de "Etapa 5 — Módulos obrigatórios")

```markdown
## Etapa 4.5 — Rede privada WireGuard (opcional, 20 min)

Este passo é **opcional para nós com IP público** (deixa a gerência mais segura) e **obrigatório
para um servidor sem IP público** (ex.: máquina em casa) que você queira usar como nó.

**Quando pular:** se você só tem VPS com IP público e quer o caminho mais curto, pule — pode ligar a
rede depois sem refazer nada.

**4.5.1** No painel: `Admin → Módulos → Catálogo → mod-rede-wireguard → Instalar`. Escolha os nós.
Para cada nó, informe o **papel**:
- `público` — VPS com IP público (o padrão).
- `local` — servidor sem IP público, atrás de NAT (casa/escritório).

**4.5.2** O módulo, sozinho: instala o WireGuard, gera a chave **no nó** (a privada nunca sai de lá),
registra o nó no hub (o control plane), sobe a interface `wg0` e confirma o handshake.

**4.5.3** Confirme em `Admin → Rede`: o nó aparece com **handshake verde** e uma latência até o hub.
A partir daí, a conversa entre o painel e o nó passa a ir **por dentro da rede privada**.

**4.5.4 — Só para nó `local` (sem IP público):** escolha qual nó **público** vai ficar na frente dele
(o "fronte" da Opção A). Os sites daquele servidor local passam a ser servidos assim:
`visitante → nó público → rede WireGuard → servidor local`. Leia o aviso de banda antes: **todo o
tráfego do site sobe pela sua internet de casa** — use só para sites de baixo tráfego, dev ou teste.

> **MTU:** se o servidor local usa internet residencial (PPPoE), deixe a MTU em **1380** (o painel já
> sugere). Datacenter pode ficar em 1420.
```

### 10.2 `docs/40-OPERACAO-DIARIA.md` — novo **Runbook 11 — Rede WireGuard** (inserir após o "Runbook 10 — Control plane fora do ar", antes de "Rotina")

```markdown
## Runbook 11 — Rede WireGuard (túnel/peer)

**Antes de tudo:** a WireGuard é o caminho de **gerência** e o caminho da **Opção A**. Se a WG cai:
os sites **diretos** (nós com IP público) **continuam no ar**; só os sites em **Opção A** (servidor
sem IP público) caem, mostrando a página "temporariamente indisponível".

### Adicionar um nó à malha
1. `Admin → Módulos → mod-rede-wireguard → Instalar` no nó (ou `Admin → Rede → Adicionar à malha`).
2. Escolha o papel (`público`/`local`). O resto é automático (chave, registro no hub, `wg0`).
3. Confirme handshake verde em `Admin → Rede`. Pronto.

### Remover um peer (nó desativado)
```bash
velozctl node forget node-03 --confirm node-03
# isso remove o peer no hub (wg set wg0 peer <pubkey> remove), revoga o certificado mTLS,
# e limpa a tabela de peers e o wg-hosts — tudo numa operação.
```
Nunca edite `/etc/wireguard/wg0.conf` do hub à mão para remover — use o comando, senão a tabela e a
config saem de sincronia.

### Diagnosticar túnel caído
No painel `Admin → Rede`, o peer está **vermelho** (handshake > 3 min). No nó:
```bash
wg show wg0                          # 'latest handshake' antigo? 'transfer' parado?
systemctl status wg-quick@wg0
ping -c3 10.77.0.1                    # alcança o hub?
journalctl -u wg-quick@wg0 -n 50 --no-pager
```
| Sintoma | Causa provável | Ação |
|---|---|---|
| `wg0` não existe | módulo do kernel sumiu (upgrade do provedor) | `modprobe wireguard`; rode o node-doctor; reinstale `wireguard` |
| Handshake nunca acontece (nó local) | UDP/51820 de saída bloqueado, ou roteador residencial | teste `nc -u -z wg.velozpanel.com.br 51820`; libere no roteador/provedor |
| Handshake ok, mas site em Opção A dá 503 | link do servidor local caiu, ou nginx do nó local parado | veja o link de casa; `systemctl status nginx` no nó local |
| Cai e volta, pacotes grandes travam | MTU alta demais (PPPoE) | baixe a MTU para 1380 em `Admin → Rede → nó → MTU` |
| Gerência do nó público parou, site no ar | WG do nó caiu; o agente foi para o fallback mTLS público | normal; conserte a WG sem pressa — o nó não ficou cego |

### IP residencial mudou (servidor local)
Não faça nada: o WireGuard reconecta sozinho em ~25 segundos (ele redescobre o novo IP). Se demorar
mais que 2 min, no servidor local: `systemctl restart wg-quick@wg0`. **Não** é preciso DDNS.

### Como saber que resolveu
Handshake verde em `Admin → Rede` · `wg show wg0` com handshake recente e `transfer` subindo ·
site em Opção A abre · `velozctl node check node-0X --strict` limpo.
```

---

## Decisões fechadas

- **D-W1.** Topologia **hub-and-spoke** (hub = control plane) **com arestas diretas seletivas**
  spoke↔spoke apenas para o par nó-público↔nó-local da Opção A. Mesh completa recusada.
- **D-W2.** Faixa **`10.77.0.0/16`**, `/32` por peer, sub-blocos por papel, atribuição determinística
  em `wg_peers`. DNS interno `*.wg.veloz.internal` (fase 1: `wg-hosts` distribuído).
- **D-W3.** WG **obrigatória para nó local atrás de NAT**; **padrão recomendado para nó público** com
  **fallback mTLS público firewallado**; **feature opcional/modular** (`mod-rede-wireguard`).
- **D-W4.** Transporte CP↔agente passa **por dentro da WG** (`https://10.77.0.1/agent/v1/...`), **mTLS
  mantido por cima**. Endpoint do agente e o VictoriaMetrics saem da internet pública.
- **D-W5.** Opção A: **TLS termina na borda do nó público**, tráfego em **HTTP claro pela WG** (já
  cifrada). Cert por **ACME DNS-01 delegado** (`12` §3.5.1). Nada de re-cifrar.
- **D-W6.** **Container do cliente NUNCA na WG** — três barreiras (faixa `10/8` já bloqueada, `wg0`
  fora da bridge, forward `vlz0↔wg0` = drop). `AllowedIPs` `/32` + nftables por peer. Nó comprometido
  não varre a rede.
- **D-W7.** Migração entre nós continua **SSH direto** (`06` §8.2); backup vai **direto ao object
  storage**. A WG carrega **só** control plane + tráfego da Opção A.
- **D-W8.** Banco do cliente **inalterado**: acesso local ao nó, conta amarrada ao IP do container. A
  "WireGuard do cliente" (`09` §1.6 nível 3) é interface **separada**, jamais a `wg0` de mesh.
- **D-W9.** NAT traversal: nó local **sempre inicia**; `PersistentKeepalive=25`; roaming cobre troca de
  IP residencial; **DDNS dispensado**. MTU 1420 (datacenter) / 1380 (residencial) + MSS clamp.
- **D-W10.** `serving_mode` = `direct` (padrão) | `wg-proxy` (Opção A, exceção para nó local) |
  `cf-tunnel` (exceção, fora da fase 1).

### DDL das mudanças

```sql
-- 1) modo de servir do ambiente (roteamento)
CREATE TYPE serving_mode AS ENUM ('direct', 'wg-proxy', 'cf-tunnel');
ALTER TABLE environments
  ADD COLUMN serving_mode    serving_mode NOT NULL DEFAULT 'direct',
  ADD COLUMN front_node_id   text REFERENCES nodes(id),
  ADD COLUMN wg_upstream_ip  inet,
  ADD COLUMN wg_upstream_port int;
ALTER TABLE environments ADD CONSTRAINT env_wgproxy_complete CHECK (
  serving_mode <> 'wg-proxy'
  OR (front_node_id IS NOT NULL AND wg_upstream_ip IS NOT NULL AND wg_upstream_port IS NOT NULL)
);

-- 2) peers da malha (schema do módulo: mod_rede_wireguard)
CREATE TABLE mod_rede_wireguard.wg_peers (
  node_id            text PRIMARY KEY REFERENCES nodes(id),
  role               text NOT NULL CHECK (role IN ('hub','public','local','test')),
  wg_address         inet NOT NULL UNIQUE,          -- /32 alocado, ex. 10.77.2.1
  wg_public_key      text NOT NULL,
  wg_endpoint        text,                          -- host:porta; NULL p/ nó atrás de NAT
  has_public_ip      boolean NOT NULL DEFAULT true,
  persistent_keepalive int NOT NULL DEFAULT 0,      -- 25 no nó local
  mtu                int NOT NULL DEFAULT 1420,
  allowed_ips        text[] NOT NULL,               -- /32(s) que este peer pode alcançar
  last_handshake_at  timestamptz,
  status             text NOT NULL DEFAULT 'pending',-- pending|up|degraded|revoked
  created_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz
);

-- 3) arestas diretas da Opção A (par nó-público <-> nó-local)
CREATE TABLE mod_rede_wireguard.wg_optiona_edges (
  front_node_id      text NOT NULL REFERENCES nodes(id),   -- nó público que fronteia
  local_node_id      text NOT NULL REFERENCES nodes(id),   -- nó local servido
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (front_node_id, local_node_id)
);
```

---

## O que isto muda nos documentos existentes

**`03-arquitetura.md`**
- §1.4/§1.6: o transporte CP↔agente (já revisto para Postgres+long-poll+WebSocket na crítica do Ciclo 1)
  ganha uma **camada de rede**: disca para `10.77.0.1` por dentro da WG, mTLS mantido. Anotar que o
  endpoint do agente e o VictoriaMetrics **bindam na `wg0`** quando a WG está ligada, com fallback
  mTLS público firewallado. **Corrigir**: §1.4/§12 §3.2 ainda citam "publica no **NATS**" — resquício;
  o transporte é Postgres+long-poll (Conflito 4). Trocar "NATS" por "fila Postgres / long-poll".
- §1.6: acrescentar que a regra "painel cai, sites no ar" ganha o caso Opção A (nó local depende da WG
  + nó público fronte) — ver §7 deste doc. R1 permanece; o hub WG **não** piora o blast radius de
  tráfego.

**`04-infra-linux.md`**
- §8.2 (nftables): **adicionar** as três barreiras de container↔WG (`iif $LAN oif $WG drop` etc.), a
  regra `udp dport 51820 accept`, e as regras por peer da `wg0` (§4.2 deste doc). A faixa `10.77.0.0/16`
  já cai na regra de egress `10.0.0.0/8` existente — documentar como defesa em profundidade.
- §6.3 (geração de vhost): novo **template Opção A** (`serving_mode='wg-proxy'`) com `upstream` para o
  IP WG, `error_page @wg_offline` branded, e o listener na `wg0` do nó local (§3.2 deste doc).
- §8.4: reforçar que o acesso ao banco **não** usa a WG (segue local ao nó).

**`06-multitenancy-runtime.md`**
- §2.1: registrar que, em Opção A, o **container roda no nó local** e a **borda que termina TLS roda no
  nó público** — a "borda no host serve estático" vale no nó local (que também tem borda na `wg0`).
- §8.2 (migração): confirmar que a migração **continua SSH direto pela internet**, **não** pela WG
  (banda dedicada, sem hairpin no hub). §8.3 (evacuação): idem.
- Acrescentar que um ambiente pode ter `serving_mode` e que evacuar um nó local exige mover para um nó
  que também tenha (ou passa a `direct` se ganhar IP público).

**`08-modulos-instalacao.md`**
- §6.2/§6.3: `veloz-node-doctor.sh` ganha a **seção 9 (WireGuard)** (§6.2 deste doc). `bootstrap.sh`
  inalterado no núcleo; `mod-rede-wireguard` converge a WG na FASE 4, com a ordem ovo-e-galinha do nó
  local documentada (enroll pela internet pública, WG depois).
- Catálogo (§1.2): **adicionar `mod-rede-wireguard`** (scope `node`, tier `optional`, categoria
  `network`).

**`09-banco-backup.md`**
- §1.6: distinguir explicitamente a "**WireGuard do cliente** (add-on, nível 3)" — interface separada
  `wg-cliente` — da `wg0` de mesh dos nós. O cliente **nunca** entra na `wg0`.
- §5: confirmar que backup vai **direto ao object storage** (B2/Magalu), **não** pela WG; a cópia local
  nível 1 fica no nó.

**`12-multiregiao-dominios.md`**
- §3.5: a WG **não** substitui o ACME DNS-01 delegado — pelo contrário, o cert da Opção A também usa a
  delegação `acme-cd.veloz.app`. A regra "painel cai, sites no ar" cross-region ganha o caso Opção A.
- §3.2: corrigir o resquício "publica no NATS" (mesmo ponto do `03`).
- Anotar que Opção A **cross-region é desaconselhada** (latência do pulo WG + transcontinental somam).

**`docs/20-INSTALAR-NO-ZERO.md`**
- Inserir **Etapa 4.5 — Rede privada WireGuard** (texto pronto em §10.1 deste doc), entre a Etapa 4 e a 5.

**`docs/40-OPERACAO-DIARIA.md`**
- Inserir **Runbook 11 — Rede WireGuard** (texto pronto em §10.2 deste doc), após o Runbook 10.
- Atualizar o **Índice** e o **Runbook 2 (Nó não responde)** para citar: "gerência caiu mas WG pode ser
  a causa — ver Runbook 11".
```
