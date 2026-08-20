# Especialista de Observabilidade — VelozPanel (Ciclo 2)

> Documento nº 11. Responde ao **requisito 8** (gráficos do ambiente do cliente), ao requisito implícito
> do super admin (saúde da frota), e aos buracos apontados na `criticas/ciclo-1-critica.md`:
> Achado 8.1 (*"ninguém desenhou o pipeline de requisições"*), Achado 6.4 (banda não orçada),
> Achado 6.5 (suporte é o custo dominante → alerta proativo é infraestrutura de sobrevivência),
> Achado 0.2 (densidade real de 16 GB) e C8 (sem Grafana, sem Loki).
>
> **Premissa que governa tudo neste documento:** *cada 512 MB residentes no host custam 1 ambiente
> vendável (~R$ 35/mês)*. Toda peça de observabilidade aqui é justificada em **ambientes perdidos**,
> não em megabytes abstratos.

## Sumário de decisões (leia isto se só tiver 2 minutos)

| # | Decisão | Alternativa descartada |
|---|---|---|
| O1 | **VictoriaMetrics single-node, 1 instância, só no control plane**, com `-memory.allowedBytes=256MB` e `-retentionPeriod=21d` | Prometheus (5–10× RAM), Netdata (200–500 MB/nó), Timescale (extensão + tuning) |
| O2 | **Sem `vmagent` e sem `node_exporter`.** O `vp-agent` (que já existe para faturar) coleta cgroup **e** host, e faz push em texto para `/api/v1/import/prometheus` | vmagent (+60–100 MB no nó), node_exporter (+25 MB/nó + porta exposta na internet pública) |
| O3 | **Sem Grafana, sem Loki, sem Alertmanager, sem vmalert.** A avaliação de alerta é um job de 60 s no `vp-scheduler` que consulta a API do VM e escreve na tabela `alerts` | Stack Grafana (multi-tenancy inviável, C8) e vmalert+Alertmanager (+70 MB por 14 regras) |
| O4 | **Série de 15 s vive no VM (21 dias, descartável). Série horária vive no Postgres (13 meses, backupada).** O rollup horário **é** a base da fatura e a base do gráfico de 30 d/13 m | Downsampling do VM — **é feature Enterprise**, não existe no open-source. Fingir que existe seria o bug de planejamento mais caro deste documento |
| O5 | **Os últimos 5 minutos nunca vêm do banco de métricas** — vêm do buffer em RAM do agente por SSE | Polling de 5 s contra o VM (multiplica carga por aba aberta) |
| O6 | **O navegador nunca fala com o VictoriaMetrics e o cliente nunca escreve PromQL.** O cliente escolhe séries de um catálogo; o CP monta a query e injeta `env=` | Proxy "transparente" de PromQL — é vazamento entre tenants por construção |
| O7 | **Requisições, latência, 5xx e egress saem do log de acesso do nginx**, agregados **no agente** em janela de 60 s. Linha crua de log nunca vira série | Enviar log para o CP e agregar lá (banda + CPU do CP) |
| O8 | Alertas: **13 regras no MVP**, com histerese, inibição hierárquica e teto de renotificação. Canal P1 = Telegram; P2 = e-mail; P3 = sino no painel | E-mail para tudo (fadiga garantida em 2 semanas) |

**Consumo total prometido:** **≤ 470 MB de RAM na frota inteira** (≈ 0,9 ambiente de 512 MB ≈ R$ 32/mês),
**≤ 1,5 GB de disco de métricas** e **< 1,5% de um core por nó**.

---

## 1. Orçamento de recursos — o teto, antes do desenho

### 1.1 O teto

Regra fixada, e todo componente novo precisa caber nela sem exceção:

| Escopo | Teto de RAM | Teto de CPU | Teto de disco |
|---|---|---|---|
| **Nó de dados** (VPS 16 GB, ~20 ambientes) | **40 MB** *adicionais* sobre o agente | 1,5% de 1 core (regime) | 8 GB (logs) + 1 GB (buffer/outbox) |
| **Control plane** (métricas + alerta + rollup) | **350 MB** | 5% de 1 core | 4 GB (TSDB) + 2 GB (rollups no PG) |
| **Frota (3 nós + CP)** | **470 MB** | — | ~30 GB |

Traduzido para dinheiro, que é a única unidade que importa aqui:

```
470 MB / 512 MB = 0,92 ambiente de plano P1
0,92 × R$ 35/mês  =  R$ 32,20/mês  de receita renunciada
Referência de comparação (Achado 6.5): 1 ticket de suporte = 15–40 min.
A R$ 60/h de custo-oportunidade do dono, 1 ticket/mês ≈ R$ 15–40.
```

> **Critério de aprovação da observabilidade: ela precisa evitar ≥ 1 ticket por mês para se pagar.**
> A tela de logs com dica de correção (§8.5) e os alertas proativos (§7) sozinhos fazem isso.
> Um Grafana de 400 MB **não** faz — por isso está fora.

### 1.2 Onde cada MB vai

**Nó de dados (o que é adicional ao `vp-agent`, que já existiria para faturar):**

| Item | RAM | Observação |
|---|---|---|
| Buffers de amostra (ring de 5 min × 25 ambientes × 45 séries) | ~3 MB | `Float64Array`, pré-alocado, nunca cresce |
| Tail + parser do log de acesso (25 arquivos, 64 KB de buffer cada) | ~4 MB | buffer do nginx é `buffer=64k flush=5s` |
| Agregadores de 60 s (contadores + t-digest de latência por env) | ~2 MB | t-digest de 100 centroides = 1,6 KB/env |
| Outbox de telemetria (SQLite/arquivo, mmap contido) | ~8 MB | 72 h de rollup horário cabem em disco, não em RAM |
| Overhead de gzip + TLS no envio | ~5 MB | picos de 1 s a cada 15 s |
| **Total adicional** | **~22 MB** | dentro do teto de 40 MB, e dentro do `MemoryMax=128M` do agente |

**Nada disso é um processo novo no nó.** É o mesmo `vp-agent`, o mesmo `MemoryMax=128M`, o mesmo
`Restart=always`. Zero unidades systemd novas, zero portas escutando, zero binário para atualizar.
Esse é o ganho estrutural de cortar `node_exporter` e `vmagent`: em três nós em três provedores
diferentes, **cada serviço a mais é três instalações, três atualizações e três superfícies de ataque
na internet pública**.

**Control plane:**

| Item | RAM | Como é imposto |
|---|---|---|
| VictoriaMetrics single-node | **150–250 MB** | `-memory.allowedBytes=256MB` + `MemoryMax=320M` no systemd |
| Avaliador de alertas (dentro do `vp-scheduler`, já existente) | ~15 MB | 14 queries a cada 60 s |
| Job de rollup horário (dentro do `vp-scheduler`) | ~10 MB | 1× por hora, streaming, sem carregar tudo |
| Cache de resposta da API de gráficos (LRU) | **32 MB** | teto explícito, `max-size` em bytes |
| **Total** | **~310 MB** | teto 350 MB |

> **Alerta de configuração que a IA vai errar se não for escrito aqui:** o VictoriaMetrics, por padrão,
> usa `-memory.allowedPercent=60` — numa VPS de 16 GB isso é **9,6 GB de cache**, ou seja,
> **19 ambientes vendáveis queimados em cache de um banco que tem 3.000 séries**. A flag
> `-memory.allowedBytes=256MB` é **obrigatória** e vira item de checklist com critério de aceite
> (`RSS do processo < 320 MB após 7 dias com carga real`).

### 1.3 VictoriaMetrics cabe? Sim, com folga de duas ordens de grandeza

A recomendação do `02` (~300–600 MB) foi feita para **150 ambientes com vmagent e node_exporter**.
Recalculando para a realidade do ADENDO (Achado 0.2: 18–25 ambientes por nó de 16 GB) e para a stack
enxuta deste documento:

```
Séries ativas na frota (detalhamento em §2.4):
  20 ambientes/nó × 45 séries × 3 nós ..... 2.700
  host (3 nós × 60 séries) ................   180
  control plane + API + jobs ..............   120
  TOTAL ................................... ~3.000 séries ativas
```

VictoriaMetrics consome ~1 GB por **milhão** de séries ativas. 3.000 séries são ~3 MB de índice.
O RSS real será dominado por buffers de ingestão e cache de consulta — daí o teto de 256 MB, que é
generoso. **A pergunta "e se não couber" tem resposta pronta mesmo assim**, porque planejar sem plano B
é como este projeto perde tempo:

**Plano B (só se o benchmark B15 reprovar):** cortar o VM e guardar métrica no Postgres.
Não é ingênuo, tem número:

| Variante | Linhas/dia (60 ambientes) | Disco/dia | Veredito |
|---|---|---|---|
| Amostra de 15 s crua no PG | 17,3 M | ~1,4 GB | **Inviável** — mata o Postgres que também roda a fila de jobs |
| Amostra de 60 s crua no PG | 4,3 M | ~350 MB | Inviável em 200 GB de NVMe compartilhado |
| **Rollup de 5 min no agente → PG** (tabela larga, 1 linha por env/5min) | **17 k** | **~7 MB** | **Viável.** 15 dias = 105 MB; 13 meses de horário = 225 MB |

O custo do Plano B é resolução: o gráfico de 1 h passa de 240 pontos para 12. **Mas isso quase não é
sentido pelo usuário**, porque pela decisão O5 os últimos 5 minutos vêm do buffer do agente por SSE,
não do armazenamento. Ou seja: o Plano B degrada o *histórico recente*, não o *ao vivo*.

> **Gatilho objetivo para acionar o Plano B:** RSS do VM > 350 MB sustentado por 48 h com < 5.000 séries,
> ou p95 de `/api/v1/query_range` > 800 ms. Sem gatilho medido, não se troca de arquitetura.

### 1.4 Benchmark obrigatório novo (entra na bateria do Ciclo 1, §7)

| # | Benchmark | Metodologia | Aprovação | Reprovação → ação |
|---|---|---|---|---|
| **B15** | **Custo real da observabilidade** | 7 dias com 3 nós, ≥ 40 ambientes sintéticos gerando tráfego; medir RSS do VM, RSS do agente, CPU do agente, bytes/dia no disco do VM e egress de telemetria | VM < 320 MB · agente < 128 MB · CPU do agente < 1,5% de 1 core · disco < 25 MB/dia · egress < 400 MB/mês/nó | VM reprova → Plano B (§1.3). Agente reprova → cadência 30 s e corte de séries opcionais (§2.5) |
| **B16** | **Consulta não derruba o painel** | 20 abas simultâneas pedindo 30 d de 6 séries; `k6` por 10 min | p95 < 400 ms, zero 5xx, RSS do VM estável | ajustar `MAX_POINTS` e TTL de cache antes de mexer em hardware |

---

## 2. Coleta — um agente, dois consumidores (gráfico e fatura)

### 2.1 O princípio que impede a divergência

> **Existe uma única leitura. Ela produz dois artefatos derivados, com regras de derivação escritas,
> e um job diário que compara os dois e alerta se divergirem.**

```
                      ┌─ ring buffer 5 min (RAM) ──► SSE "ao vivo" (O5)
/sys/fs/cgroup/...    │
/proc/...        ──► amostra(t) ──┼─ push 15 s (texto+gzip) ──► VictoriaMetrics  ── gráfico ≤ 21 d
access.log       │                │
                      └─ fechamento da hora ──► usage_event ──► Postgres ── FATURA + gráfico > 21 d
                                     (mesmas amostras, agregação declarada)
```

Regras duras que a especificação precisa carregar para a IA implementar:

1. **O agente é quem fecha a hora, não o CP.** No minuto 0 de cada hora, o agente calcula, a partir das
   240 amostras da hora anterior que ele *já tem em memória*, um `usage_event` por medidor
   (§2.3) e o coloca no outbox. O CP nunca recalcula a fatura a partir do VictoriaMetrics.
   Consequência: **perder amostras no VM não altera um centavo da fatura**, e o VM pode ser
   apagado sem medo (por isso ele fica fora do backup crítico).
2. **Idempotência já definida pelo `03`:** `source_id = '<env_id>:<meter>:<hour>'` com índice único em
   `usage_events(source_id, window_start)`. O agente reenvia à vontade até receber ack.
3. **Toda amostra carrega `sample_count`.** Se a hora fechou com menos de 200 das 240 amostras
   esperadas (agente reiniciou, nó ficou fora), o `usage_event` vem com
   `quality='partial'` e `sample_count=N`. O motor de cobrança **não extrapola**: medidores de tempo
   (`env.active.hour`) vêm da máquina de estados, não da amostragem; medidores de média
   (`disk.gb.hour`) usam a média das amostras existentes; medidores de contador (`egress.gb`) usam
   delta de contador, que é imune a amostra perdida. Isso está escrito porque é exatamente onde uma IA
   implementa "média de zero amostras = 0" e o cliente é cobrado a menos sem ninguém notar.
4. **Relógio.** NTP obrigatório (já em R3 do `03`). O agente carimba `ts` em ms UTC; o CP **rejeita**
   amostra com `|ts − now| > 60 s` e **alerta** com drift > 2 s (`veloz_node_clock_drift_seconds`).
5. **Contador que reinicia.** `cpu.stat.usage_usec` e os contadores de rede/IO reiniciam quando o
   container reinicia. O agente detecta `valor < anterior` e **descarta a amostra do delta**
   (não zera, não emite negativo) — e emite `veloz_env_counter_reset_total` para que o alerta de
   reinício repetido (§7) funcione.

### 2.2 Métricas exatas, arquivo por arquivo

Cadência **15 s** (decisão do `05` §1.2, ratificada). Custo medido lá: `readFileSync` de 6 arquivos ×
40 ambientes = **3,5 ms de event loop por ciclo = 0,023% de um core**.

| Fonte no nó | Campo | Série exportada | Tipo |
|---|---|---|---|
| `memory.current` | bytes | `veloz_env_mem_bytes` | gauge |
| `memory.max` | bytes ou `max` | `veloz_env_mem_limit_bytes` | gauge |
| `memory.peak` | bytes | `veloz_env_mem_peak_bytes` | gauge |
| `memory.events` | `oom_kill`, `max` | `veloz_env_oom_kills_total`, `veloz_env_mem_limit_hits_total` | counter |
| `memory.pressure` | `some avg10` | `veloz_env_mem_pressure_ratio` | gauge |
| `memory.stat` | `file` (page cache) | `veloz_env_mem_cache_bytes` | gauge |
| `cpu.stat` | `usage_usec` | `veloz_env_cpu_seconds_total` | counter |
| `cpu.stat` | `throttled_usec`, `nr_throttled` | `veloz_env_cpu_throttled_seconds_total` | counter |
| `cpu.max` | quota/period | `veloz_env_cpu_quota_cores` | gauge |
| `cpu.pressure` | `some avg10` | `veloz_env_cpu_pressure_ratio` | gauge |
| `io.stat` | Σ `rbytes`,`wbytes`,`rios`,`wios` | `veloz_env_io_read_bytes_total` (+3) | counter |
| `io.pressure` | `some avg10` | `veloz_env_io_pressure_ratio` | gauge |
| `pids.current` / `pids.max` | n | `veloz_env_pids`, `veloz_env_pids_limit` | gauge |
| **quota de disco** (`repquota`/`du` do volume, a cada **5 min**) | bytes | `veloz_env_disk_used_bytes`, `veloz_env_disk_quota_bytes` | gauge |
| `/sys/class/net/<veth>/statistics/*` (ou contador nftables por env) | rx/tx bytes | `veloz_env_net_rx_bytes_total`, `veloz_env_net_tx_bytes_total` | counter |
| máquina de estados do CP, espelhada no agente | — | `veloz_env_state{state="active\|paused\|suspended"}` | gauge 0/1 |
| **log de acesso do nginx** (§2.3) | — | 8 séries HTTP | counter/gauge |
| `php-fpm` status (`/status?json`, unix socket, a cada 30 s) | — | 4 séries | gauge/counter |
| `mysql`/`pg` (query de catálogo, a cada 60 s) | — | 2 séries | gauge |

Labels padrão em **toda** série de ambiente: `env`, `node`, `tenant`, `plan`, `runtime`.
Labels **proibidos** (explodem cardinalidade e não têm uso no produto): `pid`, `container_id`,
`path`, `url`, `ip`, `user_agent`, `request_id`. Isso vira teste de CI: um linter lê a lista de
séries publicadas pelo agente e falha se aparecer label fora do allowlist.

Trecho canônico da coleta (estende o `05` §1.2 com o que faltava — rede, disco e reset de contador):

```js
// packages/agent/src/collect/sample.js
const prev = new Map();                 // env_id -> última amostra bruta

export function deltaCounter(envId, key, value, ts) {
  const k = `${envId}:${key}`, p = prev.get(k);
  prev.set(k, { value, ts });
  if (!p) return null;                            // primeira amostra: sem delta
  if (value < p.value) { resets.inc({ env: envId, counter: key }); return null; } // reboot
  return { delta: value - p.value, dt: (ts - p.ts) / 1000 };
}
```

### 2.3 O pipeline de "requisições" — o buraco do Achado 8.1, resolvido

É a única das cinco métricas do requisito 8 que **não** sai do cgroup. Desenho fechado:

**(a) Formato de log dedicado**, declarado uma vez em `/etc/nginx/veloz/global/log.conf`:

```nginx
log_format veloz escape=json '$msec\t$status\t$request_time\t$upstream_response_time\t'
                             '$body_bytes_sent\t$request_length\t$upstream_cache_status\t'
                             '$request_method\t$host\t$uri';
# no vhost (05 §1.2 (6)):
access_log /var/log/veloz/envs/env-0042/access.log veloz buffer=64k flush=5s;
```

TSV, 10 campos, ~95 bytes/linha. **Sem IP e sem user-agent neste arquivo** — eles vão para o log de
acesso legal separado (§8.2), que tem retenção e base legal próprias. Separar os dois arquivos é o que
permite reter 180 dias do log legal e apenas 7 dias do log de métrica.

**(b) Tail incremental no agente** (offset persistido + detecção de rotação por inode):

```js
// packages/agent/src/collect/http.js  — 1 leitura a cada 15 s, nunca fs.watch
const st = statSync(path);
if (st.ino !== s.ino) { s.off = 0; s.ino = st.ino; }         // rotacionou
if (st.size < s.off)   s.off = 0;                            // truncou (copytruncate)
const fd = openSync(path, 'r');
const len = Math.min(st.size - s.off, 8 * 1024 * 1024);      // teto de 8 MB por ciclo
const buf = Buffer.allocUnsafe(len); readSync(fd, buf, 0, len, s.off); closeSync(fd);
s.off += lastNewline(buf) + 1;                               // nunca consome linha parcial
for (const line of split(buf)) agg.add(parse(line));         // agregação em memória
```

**(c) Agregação em janela de 60 s, no agente.** O que sai da janela:

| Série | Como | Cardinalidade |
|---|---|---|
| `veloz_env_http_requests_total{class="2xx\|3xx\|4xx\|5xx"}` | contador por classe | 4 |
| `veloz_env_http_request_seconds_sum` / `_count` | soma de `$request_time` e nº de linhas → **média exata e agregável em qualquer janela** | 2 |
| `veloz_env_http_latency_seconds{q="0.95"}` | t-digest de 100 centroides por janela | 1 |
| `veloz_env_http_bytes_sent_total` | soma de `$body_bytes_sent` + overhead estimado → **é o medidor `egress.gb`** | 1 |

Total: **8 séries por ambiente** para toda a camada HTTP.

> **Trade-off declarado sobre o p95:** quantil não é agregável entre janelas — o "p95 de 7 dias" não é a
> média dos p95 de minuto. Duas saídas: (i) histograma nativo com 12 buckets, que custaria +12 séries por
> ambiente (**+27% de cardinalidade total**) e daria p95 exato em qualquer janela; (ii) p95 por minuto,
> exibido como *"pior minuto"* e *"média dos minutos"*. **Escolha do MVP: (ii)**, com o rótulo honesto na
> UI (*"p95 medido minuto a minuto"*) e `_sum/_count` ao lado, que dá a média exata. Reavaliar quando
> houver cliente pedindo SLO — aí o histograma se paga.

**(d) Custo.** 50 req/s num nó = 3.000 linhas/min. Parse de TSV em Node ≈ 0,8 µs/linha →
**2,4 ms/min**. Irrelevante, como o resto.

**(e) Ambiente Node/estático** não tem PHP-FPM, mas tem log de acesso do proxy — a camada HTTP funciona
igual para qualquer runtime, porque é medida na **borda**, não dentro do container. Isso é o que torna a
métrica de aplicação disponível para todas as linguagens do requisito 1 sem escrever um coletor por
linguagem.

### 2.4 Cardinalidade e disco — os números

| Grupo | Séries por ambiente |
|---|---|
| Memória (6) + CPU (4) + IO (5) + pids (2) + estado (1) | 18 |
| Disco (2) + rede (2) | 4 |
| HTTP (§2.3) | 8 |
| PHP-FPM (4) — só ambientes PHP | 4 |
| Banco de dados (2) | 2 |
| Diversos (reset de contador, autoheal, healthcheck) | 4 |
| **Total** | **~40, arredondado para 45 com folga** |

```
Séries ativas    : 3.000  (§1.3)
Amostras/s       : 3.000 / 15 s          = 200/s
Amostras/dia     : 17,3 M
Bytes/amostra    : 0,4–1,2 B (compressão do VM; gauge lento fica perto de 0,4)
  → disco/dia    : 7–20 MB   ..... adotar 17 MB/dia como número de planejamento
  → 21 dias      : ~360 MB
  → índice + meta: ~100 MB
  → TOTAL VM     : < 500 MB   (teto orçado: 4 GB — folga de 8×)
```

**Egress de telemetria pela internet pública** (Achado 6.4 exige que isso seja orçado):

```
Payload em texto: ~55 B por amostra ("veloz_env_mem_bytes{env=...,node=...} 123 1690000000000")
900 séries/nó × 4/min × 55 B          = 198 KB/min cru
gzip (texto repetitivo, razão ~10×)   = ~20 KB/min
                                      = 28 MB/dia = 850 MB/mês por nó
```

850 MB/mês por nó contra uma cota típica de 2–20 TB: **0,004%**. Irrelevante, **desde que o gzip
esteja ligado** — sem ele são 8,5 GB/mês/nó, ainda tolerável, mas é desperdício gratuito. Item de
checklist: `content-encoding: gzip` no push, verificado por teste que mede o tamanho do corpo.

### 2.5 Corte de emergência

Se B15 reprovar por CPU ou banda, a ordem de corte é (nesta ordem, sem discussão):
1. cadência 15 s → 30 s nas séries de *pressure* e IO (mantém 15 s em CPU/RAM);
2. PHP-FPM e banco vão para 120 s;
3. p95 de latência sai (fica só `_sum/_count`);
4. `memory.peak` e `mem_cache_bytes` saem.
Nunca cortar: CPU, RAM, disco, estado, egress, OOM — são fatura ou são alerta.

---

## 3. Retenção e downsampling

### 3.1 A tabela que governa a UI

| Janela na UI | Fonte | `step` servido | Pontos | Latência esperada |
|---|---|---|---|---|
| **Ao vivo (5 min)** | **buffer do agente, por SSE** | 15 s | 20 + push | < 100 ms (não toca em banco) |
| **1 h** | VictoriaMetrics | 15 s | 240 | 30–80 ms |
| **6 h** | VictoriaMetrics | 60 s | 360 | 40–100 ms |
| **24 h** | VictoriaMetrics | 2 min | 720 | 60–150 ms |
| **7 d** | VictoriaMetrics | 15 min | 672 | 80–200 ms |
| **30 d** | **Postgres `metric_rollups_hourly`** | 1 h | 720 | 20–60 ms (índice PK) |
| **13 meses** | Postgres, agregado em vôo para 1 d | 1 d | 395 | 60–150 ms |

Nenhuma janela passa de **1.000 pontos** por série. Isso não é só performance de servidor: é o que
mantém o `uPlot` a 60 FPS e o payload abaixo de 30 KB gzipado (§6).

### 3.2 Por que a série horária vive no Postgres, e não no VictoriaMetrics

Fato que muda o desenho e que os documentos do Ciclo 1 não registraram:
**`-downsampling.period` é recurso Enterprise do VictoriaMetrics.** O single-node open-source tem uma
retenção única e não agrega nada sozinho. As opções eram:

| Opção | Custo | Veredito |
|---|---|---|
| Duas instâncias de VM (quente 21 d / fria 13 m) | +1 processo, +80–150 MB, +1 backup, +1 upgrade | Descartada — 0,3 ambiente por um problema já resolvido |
| Guardar 13 meses crus a 15 s no VM | ~7 GB de disco, índice maior, consultas de 13 m varrendo 400 M amostras | Descartada — consulta lenta e disco crescendo sem teto |
| **Rollup horário no Postgres** | 1 tabela, 1 job por hora, ~17 MB/mês | **Escolhida** |

E há um ganho maior que o técnico: **o que é fatura fica no Postgres, que é backupado; o que é gráfico
fica no VM, que é descartável.** Se a VPS do control plane pegar fogo, restaurar o Postgres devolve
fatura, auditoria e 13 meses de gráfico. Os 21 dias de alta resolução se perdem — e tudo bem, porque
ninguém contesta uma fatura com base num gráfico de 15 segundos.

### 3.3 A tabela de rollup

```sql
-- 1 linha por (ambiente, hora). Tabela LARGA de propósito: 1/20 das linhas de um modelo
-- (env, hora, métrica) e cabe num índice que serve todas as consultas de gráfico longo.
CREATE TABLE metric_rollups_hourly (
  environment_id uuid        NOT NULL,
  hour           timestamptz NOT NULL,
  samples        smallint    NOT NULL,          -- esperado 240; < 200 => quality partial
  cpu_cores_avg  real NOT NULL, cpu_cores_max  real NOT NULL,
  mem_bytes_avg  bigint NOT NULL, mem_bytes_max bigint NOT NULL,
  disk_bytes_avg bigint NOT NULL,
  net_rx_bytes   bigint NOT NULL, net_tx_bytes  bigint NOT NULL,   -- delta na hora
  http_requests  bigint NOT NULL, http_5xx      bigint NOT NULL,
  http_time_sum  real   NOT NULL,                                  -- p/ média exata
  http_p95_max   real   NOT NULL,                                  -- pior minuto da hora
  oom_kills      integer NOT NULL DEFAULT 0,
  active_seconds integer NOT NULL,                                 -- casa com env.active.hour
  PRIMARY KEY (environment_id, hour)
) PARTITION BY RANGE (hour);                     -- pg_partman, partição mensal, 13 retidas
```

Custo: 60 ambientes × 720 h = **43.200 linhas/mês, ~110 bytes/linha ≈ 17 MB/mês**;
13 meses ≈ **225 MB**. Contra os 200 GB do NVMe: irrelevante.

O job horário (`vp-scheduler`, 1× por hora, no minuto 3):

```sql
-- fonte primária: o rollup que o AGENTE mandou (usage_events) para os campos faturáveis
INSERT INTO metric_rollups_hourly (environment_id, hour, samples, cpu_cores_avg, ...)
SELECT e.environment_id, $1::timestamptz, ...
FROM   agent_hour_rollups e                        -- payload cru do agente, retido 7 dias
WHERE  e.hour = $1
ON CONFLICT (environment_id, hour) DO NOTHING;     -- idempotente: rodar 5× não duplica
```

Ou seja: **o rollup horário não é calculado consultando o VictoriaMetrics.** Ele vem do mesmo pacote
que o agente já manda para faturar (§2.1). O VM é consultado apenas pela *reconciliação*:

```sql
-- reconciliação diária (job 04:10): gráfico × fatura não podem divergir > 1%
-- lado esquerdo: Postgres (fatura) | lado direito: VictoriaMetrics (gráfico), via API
SELECT environment_id, hour, mem_bytes_avg
FROM   metric_rollups_hourly WHERE hour >= now() - interval '25 hours';
```
```promql
# lado do VM, mesma hora:
avg_over_time(veloz_env_mem_bytes{env="$env"}[1h])
```
Divergência > 1% em > 5% das horas do dia → alerta **P1 `ReconciliacaoDivergente`** (§7). Este é o
único alerta que, se disparar, **bloqueia o fechamento da fatura do mês** até revisão humana.

### 3.4 Retenções, consolidadas

| Dado | Onde | Retenção | Motivo |
|---|---|---|---|
| Amostra 15 s | VictoriaMetrics | **21 dias** | cobre a janela de 7 d + perícia de incidente; descartável |
| Rollup horário | Postgres | **13 meses** | contestação de fatura + comparação ano a ano |
| `usage_events` (crus, faturáveis) | Postgres particionado | **13 meses** (depois só `usage_rollups`) | auditoria de cobrança |
| `usage_rollups` / `invoices` | Postgres | **5 anos** | prescrição fiscal/civil; nota fiscal futura (ADENDO §C) |
| Log de acesso legal | Nó 30 d → object storage | **180 dias, exclusão automática** | Marco Civil × LGPD (§8.2) |
| Log de aplicação do cliente | Nó | **7 dias** (14 no plano superior) | volume; é depuração, não registro legal |
| Log do agente (journald) | Nó | **14 dias / 200 MB** | depuração operacional |
| `audit_logs` | Postgres | **5 anos**, append-only | LGPD, impersonação, disputa |

---

## 4. Métricas do cliente — o painel do requisito 8

Regra de redação da UI, válida para todas: **número + limite + o que fazer**. Nunca só o número.
Nunca sigla sem tradução. Nunca "cgroup", "PSI", "throttle" na tela do cliente.

| # | Métrica | Coleta | PromQL servido | Texto do painel (PT-BR) |
|---|---|---|---|---|
| 1 | **CPU** | `cpu.stat.usage_usec` / `cpu.max` | `rate(veloz_env_cpu_seconds_total{env="$e"}[2m]) / veloz_env_cpu_quota_cores{env="$e"} * 100` | **"Processamento — 23% de 1 vCPU"**. Tooltip: *"Quanto do processador do seu plano está em uso. Acima de 90% por muito tempo, seu site fica lento. Se acontecer todo dia no mesmo horário, aumente o plano."* Faixa vermelha sombreada em 80–100% (copiado do Hostoo, `01` §1.3) |
| 2 | **CPU estrangulada** | `throttled_usec` | `rate(veloz_env_cpu_throttled_seconds_total[5m])` | Não é um gráfico; é um **selo** que aparece só quando > 0: *"Seu ambiente atingiu o limite de processamento 14 vezes na última hora — é por isso que ele ficou lento."* Com botão **Aumentar plano** |
| 3 | **RAM** | `memory.current` / `memory.max` | `veloz_env_mem_bytes / veloz_env_mem_limit_bytes * 100` | **"Memória — 380 MB de 512 MB (74%)"**. Tooltip: *"Parte disso é cache do sistema e é normal. Se passar de 95%, o servidor encerra processos do seu site e o visitante vê erro 502."* |
| 4 | **OOM** | `memory.events.oom_kill` | `increase(veloz_env_oom_kills_total[24h])` | Selo vermelho: *"Seu site ficou sem memória 3 vezes hoje e precisou ser reiniciado."* + link para o log do momento exato + botão **Aumentar memória** |
| 5 | **Disco** | quota/`du` a cada 5 min | `veloz_env_disk_used_bytes / veloz_env_disk_quota_bytes * 100` | **"Disco — 4,1 GB de 15 GB"**, com quebra por pasta (site / banco / backups / logs) e *"Você enche o disco em ~22 dias no ritmo atual"* quando a projeção for < 30 d |
| 6 | **Banda** | `body_bytes_sent` do log + contador de veth | `increase(veloz_env_http_bytes_sent_total[30d])` | **"Tráfego enviado — 8,2 GB neste mês"** com barra da franquia. *"É quanto seu site enviou para os visitantes. Imagens grandes e vídeos são o que mais consomem."* **É também o medidor `egress.gb` da fatura** — e o painel diz isso: *"este número é o que aparece na sua fatura"* |
| 7 | **Requisições/s** | log de acesso (§2.3) | `sum(rate(veloz_env_http_requests_total{env="$e"}[5m]))` | **"Acessos por segundo"**. Tooltip: *"Cada imagem, CSS e página conta como um acesso. É o pulso do seu site."* |
| 8 | **Tempo de resposta** | `$request_time` | `rate(veloz_env_http_request_seconds_sum[5m]) / rate(veloz_env_http_requests_total[5m])` e `max_over_time(veloz_env_http_latency_seconds{q="0.95"}[5m])` | **"Tempo de resposta — média 180 ms · pior minuto 1,2 s"**. *"Abaixo de 300 ms o visitante sente o site como instantâneo. Acima de 1 s, ele começa a desistir."* |
| 9 | **Erros 5xx** | classe de status do log | `sum(rate(veloz_env_http_requests_total{env="$e",class="5xx"}[5m])) / sum(rate(veloz_env_http_requests_total{env="$e"}[5m])) * 100` | **"Erros do servidor — 0,4% dos acessos"**. *"Erro 5xx é problema do seu site, não do visitante. Clique para ver as linhas de log desses erros."* — **link direto para a tela de logs já filtrada pela janela do pico**, com a dica de correção (§8.5) |
| 10 | **PHP-FPM** | `/status?json` no socket, 30 s | `veloz_env_fpm_active_processes`, `veloz_env_fpm_listen_queue`, `increase(veloz_env_fpm_max_children_total[1h])`, `increase(veloz_env_fpm_slow_requests_total[1h])` | **"Processos PHP — 3 de 8 em uso · fila 0"**. *"Se a fila subir, visitantes ficam esperando um processo livre. Fila constante = seu site precisa de mais memória ou o código está lento."* |
| 11 | **Conexões de banco** | `SHOW STATUS LIKE 'Threads_connected'` / `pg_stat_activity`, 60 s | `veloz_env_db_connections{engine="mysql"} / veloz_env_db_connections_limit * 100` | **"Conexões do banco — 4 de 25"**. *"Se bater no limite, o site mostra 'error establishing a database connection'. Costuma ser plugin ou script que não fecha conexão."* |
| 12 | **E-mails enviados** | contador do relay SMTP por env (módulo `mail`, **fora do MVP** — série reservada) | `increase(veloz_env_mail_sent_total[24h])` | **"E-mails enviados — 122 hoje (limite 500/dia)"**. *"Limite existe para proteger a reputação do servidor. Formulário disparando e-mail em excesso costuma ser spam ou bug."* |

**Marcadores de evento sobre o gráfico** (`01` §3, proposta de UX que resolve ticket sozinha): linhas
verticais para `deploy`, `restart`, `resize`, `pause/start`, `troca de versão`, `autoheal`. Vêm de
`audit_logs`/`jobs`, não de série temporal — o endpoint de gráficos entrega em `events[]` (§6.2).
É o que responde *"por que ficou lento às 14h?"* sem abrir chamado.

**Ambiente pausado:** os gráficos não somem — ficam com faixa cinza *"ambiente pausado"* sobre o
período (`01` §3). CPU/RAM param de ser emitidos (não há cgroup); disco continua sendo coletado a cada
5 min, porque **disco pausado ainda é faturado**.

---

## 5. Métricas do super admin — a frota

Tela `/admin/frota` (a que o Tiago abre de manhã, `01` §4.1). Nada aqui é por ambiente; tudo é por nó,
por estado ou por fila.

| # | Indicador | Origem | Query |
|---|---|---|---|
| 1 | **Nó vivo / mudo** | heartbeat do agente no CP | SQL: `now() - last_heartbeat_at` por nó; e `veloz_node_up` |
| 2 | **Saúde do nó** | `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/pressure/*` | `veloz_node_load1 / veloz_node_cpus`, `veloz_node_mem_pressure_ratio` |
| 3 | **Ocupação (vendido × usado)** | soma dos limites × soma do uso | `sum by (node)(veloz_env_mem_limit_bytes) / on(node) veloz_node_mem_sellable_bytes` — **é a métrica de overcommit**, e é a que decide se cabe mais um cliente |
| 4 | **Ambientes por estado** | máquina de estados (Postgres) | `SELECT state, count(*) FROM environments GROUP BY state` |
| 5 | **Jobs na fila e falhando** | Postgres | `SELECT type, status, count(*), max(now()-created_at) FROM jobs WHERE status IN ('queued','running','failed') GROUP BY 1,2` |
| 6 | **Latência CP↔nó pela internet** | o agente mede o RTT do próprio long-poll e publica | `veloz_node_cp_rtt_seconds{q="0.95"}` — sobe antes de o link cair; é o sismógrafo do ADENDO §B.1 |
| 7 | **Banda por nó (custa dinheiro)** | `/proc/net/dev` da interface pública | `increase(veloz_node_net_tx_bytes_total[30d]) / veloz_node_bandwidth_quota_bytes * 100` — Achado 6.4 |
| 8 | **Taxa de erro da API** | middleware do `vp-api` | `sum(rate(veloz_api_requests_total{class="5xx"}[5m])) / sum(rate(veloz_api_requests_total[5m]))` |
| 9 | **Latência da API** | idem | `histogram_quantile(0.95, sum by(le)(rate(veloz_api_request_seconds_bucket[5m])))` — **aqui histograma se paga**: são poucas séries (só o CP) |
| 10 | **Backups com falha** | Postgres | `SELECT count(*) FROM environments e WHERE NOT EXISTS (SELECT 1 FROM backups b WHERE b.environment_id=e.id AND b.status='ok' AND b.finished_at > now()-interval '48 hours')` |
| 11 | **Certificados vencendo** | tabela `certificates` | `SELECT domain, expires_at FROM certificates WHERE expires_at < now()+interval '10 days' ORDER BY 2` |
| 12 | **Saldo agregado dos clientes** | Postgres | `SELECT sum(balance_cents)/100 FROM tenants` + *"R$ 1.240 em saldo de 6 clientes vencem em < 72 h"* — é previsão de receita **e** de churn |
| 13 | **Projeção de disco** | `veloz_node_fs_avail_bytes` | `predict_linear(veloz_node_fs_avail_bytes{mount="/"}[6h], 14*86400) < 0` → *"web02 enche em 12 dias"* (`01` §4.10) |
| 14 | **Top 10 consumidores** | VM | `topk(10, rate(veloz_env_cpu_seconds_total[1h]))` — quem está estourando o plano e é candidato a upsell (ou a suspensão por abuso) |
| 15 | **Margem** | receita − custo de VPS | SQL sobre `usage_rollups` e uma tabela `node_costs` — número que transforma o painel em decisão comercial |

**Alerta metodológico:** o super admin **não** vê métrica de ambiente por padrão. Ver o gráfico de um
cliente é ação de suporte e entra em `audit_logs` como acesso a dado do cliente (LGPD). O botão existe,
mas registra.

---

## 6. API de gráficos para o Next.js

### 6.1 Contrato

```
GET /api/v1/environments/{env_id}/metrics
      ?series=cpu,mem,disk,net_tx,http_rps,http_p95      (máx. 6, de catálogo fechado)
      &window=1h|6h|24h|7d|30d|13m                        (enum)  — ou:
      &from=<ISO8601>&to=<ISO8601>                        (livre, span ≤ 90 d)
      &step=auto|15s|1m|5m|1h|1d                          (o servidor pode AUMENTAR, nunca diminuir)
      &format=json|table|csv                              (table/csv = acessibilidade, §6.5)
      &events=1                                           (marcadores de deploy/restart/resize)

GET /api/v1/environments/{env_id}/metrics/stream          (SSE, últimos 5 min + push a cada 15 s)
GET /api/v1/environments/{env_id}/metrics/summary         (frase em PT-BR, §6.5)
GET /api/v1/admin/fleet/metrics?series=...&window=...     (mesmo contrato, escopo frota)
```

O cliente **nunca** envia PromQL. `series` é chave de um catálogo estático no CP
(`packages/core/src/metrics/catalog.ts`), que mapeia `cpu` → template de PromQL + unidade + rótulo
PT-BR + arredondamento + faixa de saturação. Adicionar métrica nova é adicionar uma entrada no
catálogo — e o catálogo é a mesma fonte de verdade da legenda, do CSV e da tabela acessível.

### 6.2 Payload — colunar, não array de objetos

```jsonc
{
  "env_id": "e_7f3a...",
  "window": { "from": 1755640800000, "to": 1755644400000, "step_s": 15 },
  "t": [1755640800000, 1755640815000, "…240 timestamps"],      // eixo X compartilhado
  "series": [
    { "key": "cpu",  "label": "Processamento", "unit": "%",  "warn": 80, "crit": 95,
      "v": [12.4, 13.1, null, 15.9, "…"],                      // null = buraco real, não 0
      "stat": { "avg": 14.2, "max": 68.0, "max_at": 1755642300000, "last": 15.9 } },
    { "key": "mem", "label": "Memória", "unit": "bytes", "limit": 536870912, "v": ["…"] }
  ],
  "events": [ { "ts": 1755642300000, "type": "deploy", "label": "Deploy #38", "job_id": "job_…" } ],
  "meta": { "source": "tsdb", "cache": "hit", "generated_at": 1755644402000,
            "stale_s": 2, "downsampled_from": "15s", "points": 240, "truncated": false }
}
```

Por que colunar: `[{t,v}]` custa ~3,5× mais bytes e obriga o front a remontar arrays para o `uPlot`,
que consome exatamente `[xs, ys1, ys2]` (`05` §4.2). 6 séries × 720 pontos ≈ 55 KB em JSON,
**~9 KB com gzip/brotli**. Com `[{t,v}]` seriam ~30 KB comprimidos, por gráfico, por refresh, por aba.

**`null` é obrigatório e semântico**: buraco de coleta (nó offline, ambiente pausado) precisa aparecer
como lacuna no gráfico, jamais como zero. Um gráfico que mostra "CPU 0%" quando o agente estava mudo
gera ticket e destrói confiança na fatura.

### 6.3 Agregação server-side e as travas anti-tiro-no-pé

```ts
// packages/core/src/metrics/step.ts — a função que impede "30 dias em resolução de segundo"
const MAX_POINTS = 1000;                 // teto de produto (uPlot voa; JSON fica < 30 KB)
const MIN_STEP: Record<Window, number> = { '5m':15, '1h':15, '6h':60, '24h':120, '7d':900,
                                           '30d':3600, '13m':86400 };
export function resolveStep(fromMs: number, toMs: number, asked?: number) {
  const span = (toMs - fromMs) / 1000;
  const floorStep = Math.max(minStepFor(span), Math.ceil(span / MAX_POINTS));
  const step = Math.max(asked ?? 0, floorStep);            // NUNCA menor que o piso
  return alignUp(step);                                     // 15,30,60,120,300,900,3600,86400
}
```

Travas, em camadas — a IA precisa implementar **todas**, porque cada uma cobre a falha da anterior:

| Camada | Trava | Valor |
|---|---|---|
| Contrato | `window` é enum; `from/to` livre tem span máximo | **90 dias** |
| Contrato | séries por requisição | **6** |
| Cálculo | pontos por série | **1.000** (rejeita com `400` se o cliente forçar `step` menor) |
| Roteamento | janela > 21 d **nunca** toca no VM | vai para `metric_rollups_hourly` |
| VictoriaMetrics | `-search.maxPointsPerTimeseries=2000` · `-search.maxQueryDuration=10s` · `-search.maxConcurrentRequests=4` · `-search.maxUniqueTimeseries=1000` | flags obrigatórias na unidade systemd |
| API | timeout do fetch ao VM | 5 s → `503` com `Retry-After: 5` e o gráfico exibe *"métricas indisponíveis"* (nunca tela branca) |

### 6.4 Cache

Chave: `sha1(env_id | series | step | end_alinhado)`. **O `end` é alinhado para baixo no múltiplo do
`step`** — é o truque que faz 20 abas abertas na mesma tela compartilharem uma entrada de cache em vez
de gerarem 20 queries com timestamps ligeiramente diferentes.

| Janela | TTL | Racional |
|---|---|---|
| 1 h / 6 h | 10 s | metade do `step`, sensação de "vivo" |
| 24 h | 60 s | |
| 7 d | 5 min | |
| 30 d / 13 m | 30 min | é rollup horário; não muda dentro da hora |

LRU em memória do `vp-api`, teto **32 MB** em bytes (não em nº de entradas — entrada de 13 meses é
grande). `Cache-Control: private, max-age=<ttl>` + `ETag`. Zero Redis: mais uma peça no nó custa
ambientes, e um cache local por processo resolve 95% deste caso.

**Rate limit** (token bucket em Postgres/memória, chave = sessão + rota):

| Rota | Limite | Ao estourar |
|---|---|---|
| `/metrics` (janela ≤ 24 h) | 60/min por sessão | `429` + `Retry-After`; o front pausa o `refetchInterval` e mostra *"atualização pausada"* |
| `/metrics` (janela > 24 h) | 10/min por sessão | idem |
| `/metrics/stream` (SSE) | **1 por ambiente, 3 por sessão, 200 no processo** | `429`; a 4ª aba cai para polling de 30 s |
| `/admin/fleet/metrics` | 30/min | |
| Global por tenant | 300/min | protege de script do cliente batendo na API |

O SSE tem **heartbeat de 20 s** (`:ping`), `Last-Event-ID` para retomada e **fecha sozinho após 30 min**
sem interação — aba esquecida aberta a noite toda é o vazamento de conexão clássico de painel.

### 6.5 Acessibilidade — contrato com o especialista de acessibilidade

O gráfico é o conteúdo **menos** acessível do painel inteiro, e o ADENDO 2 §E torna isso inegociável
(AA como piso). Compromissos que a camada de observabilidade assume, e que o documento de
acessibilidade deve referenciar como já resolvidos do lado dos dados:

1. **`format=table`** devolve os mesmos dados como linhas prontas para `<table>`, já reduzidos a
   **no máximo 60 linhas** (reamostragem por média), com cabeçalhos em PT-BR e valores formatados
   (`pt-BR`, unidade legível). Nenhuma tela precisa "converter gráfico em tabela" no cliente.
2. **`/metrics/summary`** devolve uma frase pronta, gerada por template no servidor:
   > *"Nas últimas 24 horas, o processamento ficou em média em 14% do seu plano, com pico de 68% às
   > 14h05. A memória ficou em média em 74% e não houve falta de memória. O tempo de resposta médio
   > foi de 180 ms."*
   Essa frase é o `aria-label` do `<figure role="img">` do gráfico **e** o texto que o leitor de tela
   ouve antes de qualquer coisa. É também o que alimenta o assistente de suporte no futuro.
3. **Contrato de componente:** `<TimeSeries series={} summary={} tableData={} />` — o wrapper React do
   `uPlot` **recusa renderizar sem `summary` e `tableData`** (erro em dev, log em prod). É assim que a
   acessibilidade não é esquecida pela IA que vai escrever a próxima tela.
4. **Não depender de cor** (WCAG 1.4.1): cada série tem cor **e** padrão de traço **e** marcador
   distintos; traço com contraste ≥ 3:1 contra o fundo nos dois temas (1.4.11).
5. **Toggle "Ver como tabela"** persistente por usuário, e **download CSV** (`format=csv`) — que também
   é a resposta para quem quer levar o dado para a planilha.
6. **Sem animação de entrada** por padrão; `prefers-reduced-motion` respeitado; auto-refresh
   **anunciado** por `aria-live="polite"` no rótulo *"atualizado há Xs"*, nunca no gráfico (senão o
   leitor de tela fala a cada 15 s — anti-padrão clássico).
7. **Teclado:** setas percorrem os pontos, `Home`/`End` vão às pontas, e o ponto focado é lido como
   *"14h05, processamento 68 por cento"*.

> Ação para o especialista de acessibilidade: validar os itens 4–7 e devolver os tokens de cor/traço.
> Ação para o Produto/UX: aprovar os textos do §4 e do item 2 — são texto de produto, não de infra.

---

## 7. Alertas — o item que corta suporte

Achado 6.5 da crítica: 20–66 tickets/mês a partir de ~66 clientes é **7 a 44 horas/mês**. Alerta
proativo não é conforto: é o que impede o modelo de 1 pessoa de quebrar. Mas alerta ruim é pior que
nenhum, porque em três semanas o dono silencia o canal e aí **nenhum** alerta funciona.

### 7.1 Como é avaliado (sem vmalert, sem Alertmanager)

Job `alerts.evaluate` no `vp-scheduler`, a cada **60 s**: executa as regras (umas em PromQL contra o VM,
outras em SQL contra o Postgres), e reconcilia com a tabela de estado.

```sql
CREATE TABLE alerts (
  rule_id     text NOT NULL,                      -- 'no_offline'
  scope       text NOT NULL,                      -- 'node:vps1' | 'env:e_7f3a' | 'tenant:t_9c'
  severity    text NOT NULL CHECK (severity IN ('P1','P2','P3')),
  state       text NOT NULL CHECK (state IN ('pending','firing','resolved')),
  value       numeric,
  since       timestamptz NOT NULL,
  notified_at timestamptz, notify_count int NOT NULL DEFAULT 0,
  silenced_until timestamptz,
  PRIMARY KEY (rule_id, scope)
);
```

Ciclo de vida: condição verdadeira → `pending` (grava `since`); permanece verdadeira por `for` →
`firing` + notifica; falsa abaixo do **limiar de resolução** (diferente do de disparo) por `resolve_for`
→ `resolved` + notifica a resolução.

### 7.2 As seis regras anti-fadiga (valem para todas as regras, sem exceção)

1. **Histerese assimétrica.** Dispara em 90%, resolve em 80%. Sem isso, uma métrica oscilando em torno
   do limiar gera 40 mensagens por hora.
2. **`for` obrigatório.** Nenhuma regra dispara na primeira amostra. Mínimo 2 minutos; 15 minutos para
   as de tendência.
3. **Inibição hierárquica.** `no_offline` de um nó **suprime** todos os alertas de ambiente daquele nó.
   Um nó caindo deve gerar **1** mensagem, não 25. Igualmente: `saldo_zerado` suprime
   `ambiente_parado` do mesmo tenant (o ambiente parou *porque* o saldo acabou).
4. **Agrupamento de 5 min.** Alertas que entram em `firing` na mesma janela de 5 min viram **uma**
   mensagem com lista.
5. **Teto de renotificação.** 1 notificação ao disparar, depois **1 a cada 4 h** enquanto durar, máximo
   6 renotificações; depois só o painel. Silenciamento por 1 h/4 h/24 h com um clique na própria
   mensagem (deep link assinado).
6. **Silêncio automático em manutenção e deploy.** Nó em `maintenance` ou job de deploy em execução no
   ambiente = janela de silêncio para as regras de disponibilidade daquele escopo.

E um sétimo, que é de gestão: **relatório semanal "regras barulhentas"** — toda regra que disparou > 3×
na semana sem nenhuma ação humana correspondente entra numa lista de revisão obrigatória. Regra que só
gera ruído é **apagada**, não tolerada. `veloz_alert_fired_total{rule}` e
`veloz_alert_acted_total{rule}` existem exatamente para calcular essa razão.

### 7.3 Canais

| Severidade | Significado | Canal | Horário |
|---|---|---|---|
| **P1** | Dinheiro parando ou cliente fora do ar agora | **Telegram** (bot próprio, grátis, chega no celular) + sino + e-mail | 24×7 |
| **P2** | Vai virar P1 em horas/dias | E-mail + sino | 08–22 h; fora disso, acumula para as 08 h |
| **P3** | Informativo, sem ação imediata | Só o sino no painel + digest diário | — |

Telegram e não WhatsApp no MVP: WhatsApp Business API custa por conversa e exige template aprovado;
Telegram é `POST` num endpoint, zero custo, entrega instantânea. Cliente recebe **e-mail** (e o sino);
Telegram é canal do dono. Reavaliar WhatsApp quando houver > 50 clientes.

**Dead man's switch (quem vigia o vigia):** o `vp-scheduler` pinga a cada 5 min um serviço externo
gratuito de cron-monitor. Se o control plane inteiro morrer — e com ele o avaliador de alertas — quem
avisa o Tiago é **o serviço de fora**. Sem isso, a falha mais grave possível é a única que não gera
alerta. Custo: R$ 0.

### 7.4 As 13 regras do MVP

| Regra | Condição | `for` | Sev | Para quem | Ação automática antes de acordar alguém |
|---|---|---|---|---|---|
| `no_offline` | SQL: `now()-last_heartbeat_at > 90s` | 0 (já tem `for` embutido nos 90 s) | **P1** | Dono | CP marca nó `offline`, **para de faturar CPU/RAM** (`03` §1.7), para de alocar, inibe alertas dos ambientes |
| `agente_mudo` | Nó responde ICMP/TLS mas **zero amostras** por 5 min | 5 min | **P1** | Dono | `systemctl restart veloz-agent` via canal de comando; se falhar 2×, alerta |
| `disco_enchendo` | `predict_linear(veloz_node_fs_avail_bytes[6h], 4*86400) < 0` **ou** uso > 90% | 15 min | **P2** (>95% vira P1) | Dono | Gira logs, apaga temporários, poda imagens OCI não usadas, `vacuum` de partição antiga |
| `env_oom_repetido` | `increase(veloz_env_oom_kills_total[30m]) >= 3` | 0 | **P2** dono / **P3** cliente | Ambos | Nada automático (aumentar RAM é decisão comercial). Cliente vê selo + botão **Aumentar memória** com preço |
| `cert_vencendo` | SQL: `expires_at < now()+'10 days'` e sem renovação em curso | — | **P2** (< 3 d = **P1**) | Dono | Reenfileira o job ACME com backoff; a fila de emissão é controlada pelo painel (Conflito C5) |
| `backup_falhando` | SQL: ambiente sem backup `ok` há > 48 h | — | **P2** dono / **P3** cliente | Ambos | 1 retentativa imediata + 1 em 2 h antes de alertar |
| `saldo_acabando` | SQL: `saldo / consumo_hora_atual < 72 h` | — | **P2** cliente (< 24 h = **P1** cliente) | **Cliente** | Nada — é receita. E-mail com link de recarga, banner no painel, e a regra de pausa automática explicitada |
| `pico_5xx` | `taxa_5xx > 5%` **e** `req/min >= 30` | 10 min | **P2** dono / **P3** cliente | Ambos | Link já filtrado para o log do período + dica de correção (§8.5) |
| `no_saturado` | `sum(veloz_env_mem_limit_bytes) / mem_vendavel > 0,90` **ou** `load1/cpus > 2` | 15 min | **P2** | Dono | Marca nó como "não alocar"; scheduler passa a mandar ambiente novo para outro nó |
| `fila_travada` | SQL: `count(jobs queued) > 20` **ou** algum `running` acima do timeout | 5 min | **P2** | Dono | Reprocessa job travado 1× e mata o que passou de `deadline_at` |
| `banda_do_no` | `increase(veloz_node_net_tx_bytes_total[30d]) / cota > 0,70` | 1 h | **P2** (>90% = **P1**) | Dono | Aplica limite de banda por ambiente no topo consumidor e o notifica — Achado 6.4 |
| `drift_relogio` | `abs(veloz_node_clock_drift_seconds) > 2` | 10 min | **P2** | Dono | `chronyc makestep` 1× antes de alertar. **Metering depende disso** |
| `reconciliacao_divergente` | SQL/PromQL: divergência gráfico×fatura > 1% em > 5% das horas | — | **P1** | Dono | Nenhuma. **Bloqueia o fechamento da fatura do mês.** É o alerta que protege o cliente de ser cobrado errado |

Fora do MVP, com gatilho de entrada declarado: `api_5xx` (entra quando houver tráfego real na API),
`ip_em_blacklist` (entra com o módulo de e-mail), `latencia_cp_no` (P3, entra quando houver um segundo
provedor problemático), `abuso_de_cpu` (entra quando houver o primeiro minerador).

**O cliente só recebe 4 tipos de alerta** (saldo, OOM/parada do ambiente, backup falhando, pico de 5xx),
todos configuráveis em `/conta/notificacoes`, e **saldo vem ligado por padrão e não pode ser desligado**
— é o único cuja ausência causa perda de dados.

---

## 8. Logs

### 8.1 As quatro classes, e por que a separação importa

| Classe | Conteúdo | Onde nasce | Onde vive | Rotação | Retenção |
|---|---|---|---|---|---|
| **Aplicação do cliente** | stdout/stderr do container, `error_log` do PHP, log do framework | Nó | `/var/log/veloz/envs/<env>/app.log` | 50 MB × 3, zstd | **7 d** (14 d nos planos maiores) |
| **Acesso — métrica** | TSV de 10 campos, **sem IP** (§2.3) | Nó | `/var/log/veloz/envs/<env>/access.log` | diária, zstd | **7 d** (só alimenta o agregador) |
| **Acesso — legal** | combined com IP, UA, referer | Nó | `/var/log/veloz/envs/<env>/legal/YYYY-MM-DD.log.zst` → object storage após 30 d | diária | **180 d, exclusão automática** |
| **Agente** | operação do `vp-agent` | Nó | `journald`, unit `veloz-agent` | `SystemMaxUse=200M` | **14 d** |
| **Auditoria** | quem fez o quê, incl. impersonação | CP | Postgres `audit_logs`, particionado mensal, append-only | partição mensal | **5 anos** |

### 8.2 Marco Civil × LGPD — a única leitura defensável

- **Marco Civil (Lei 12.965/2014), art. 15:** provedor de aplicações constituído como PJ que exerça a
  atividade de forma organizada deve guardar **registros de acesso a aplicações por 6 meses**.
- **LGPD (Lei 13.709/2018), art. 16:** dado pessoal deve ser eliminado após o fim do tratamento;
  guardar além do prazo legal transforma um **cumprimento de obrigação** (art. 7º, II) em **passivo**.
- IP é dado pessoal — pacífico na ANPD e na jurisprudência.

Postura do VelozPanel, escrita na Política de Privacidade e implementada em código:

1. **Exatamente 180 dias.** Job diário `logs.retention` apaga o arquivo do dia 181. Não existe
   "guardar por precaução" — precaução aqui é risco, não segurança.
2. **Quem é o provedor de aplicação é o cliente**, não o VelozPanel. Guardamos por 180 d
   (a) para atender ordem judicial dirigida a nós, (b) como serviço ao cliente, que é quem tem a
   obrigação primária. Isso vai nos Termos, e o cliente pode **baixar** os próprios logs a qualquer
   momento.
3. **Acesso a log de acesso é evento de auditoria.** Suporte abrindo o log do cliente grava linha em
   `audit_logs`. Sem exceção, inclusive para o super admin.
4. **Ordem judicial tem procedimento escrito** (runbook): quem pode atender, o que se entrega, como se
   registra. Um provedor de hospedagem recebe ofício mais cedo do que imagina.
5. **Criptografia em repouso** no object storage e chave por tenant (já previsto para backup no `03`).

Volume, para o MVP e para o cenário de 60 ambientes:

```
Linha combined ≈ 210 B.  zstd -9 em log de acesso ≈ 12×.
MVP (5 sistemas, ~2 req/s/nó):  173 k linhas/dia ≈ 36 MB cru ≈ 3 MB/dia comprimido
                                180 dias ≈ 540 MB  → cabe no nó, sem object storage
60 ambientes, 50 req/s/nó:      4,3 M linhas/dia ≈ 900 MB cru ≈ 75 MB/dia comprimido
                                180 dias ≈ 13,5 GB → **excede o teto de 8 GB por nó**
```

Por isso a regra: **nó guarda 30 dias; do dia 31 ao 180 vive em object storage** (Magalu/R2 — centavos
por GB). E **cota de log por ambiente: 2 GB comprimidos**; ao estourar, o mais antigo do próprio
ambiente é descartado e o cliente é avisado (`P3`) — nunca o log de um cliente derruba o disco do nó e,
com ele, os outros 19.

### 8.3 Como o cliente vê os logs sem baixar um gigabyte

```
GET /api/v1/environments/{id}/logs
      ?source=app|access|deploy|cron|agent
      &level=error|warn|info  &q=<texto>  &from=&to=
      &cursor=<opaco>  &limit=200  &dir=backward
```

- **Padrão é `dir=backward`, `limit=200`**, começando pelo fim do arquivo. Ninguém quer ler log do
  começo. Leitura por `read` posicionado a partir do fim, em blocos de 64 KB, até completar 200 linhas.
- **Cursor opaco** = `base64(inode:offset:generation)`. Rotação invalida o cursor e a API responde
  `409` com um cursor novo, em vez de devolver linhas erradas.
- **Busca (`q`)**: executada **no nó**, pelo agente, com `grep -F` (literal, não regex do usuário),
  **teto de 200 MB varridos e 3 s de timeout**; acima disso a resposta vem parcial com
  `"truncated": true` e a sugestão de estreitar o período. Regex do usuário é proibido (ReDoS).
- **Ao vivo**: SSE `/logs/stream`, com **amostragem obrigatória** — acima de 200 linhas/s o servidor
  envia uma a cada N e emite `[log truncado: N linhas suprimidas]` (regra do `03`, ratificada). O front
  mantém buffer circular de 2.000 linhas; nunca `[...linhas, nova]`.
- **Download** não é `GET` de arquivo: é **job** que empacota o período pedido em `.zst`, guarda no
  object storage e devolve URL assinada com validade de 1 h. Assim um cliente pedindo 180 dias não
  segura um worker do `vp-api` por 4 minutos.
- **Nunca** o CP copia log de cliente para si. O log fica no nó; a API do CP faz proxy autenticado da
  leitura. Isso economiza banda (Achado 6.4), disco do CP e superfície LGPD.

### 8.4 A tela

Uma tela só (`01` §1.24 pede a fusão): seletor de fonte (PHP · Servidor web · Aplicação · Deploy ·
Cron · Sistema), filtro de severidade, busca, intervalo, botão **ao vivo**, botão **baixar**.
Cada linha: `hora · severidade · origem · mensagem · 💡`.

### 8.5 Dica de correção anexada à linha de erro — a feature mais rentável do painel

O `01` §1.24 identificou isto como *"o recurso mais inteligente do painel [do Hostoo]"*. É também o
que, junto com os alertas, paga a observabilidade inteira em tickets evitados. Especificação:

**(a) Catálogo versionado no repositório**, `packages/core/src/logs/patterns/*.yaml` — texto, revisável
em PR, testável, sem deploy de código para adicionar um padrão:

```yaml
- id: php.memory_exhausted
  runtime: [php]
  match: 'PHP Fatal error:\s+Allowed memory size of (?<limite>\d+) bytes exhausted'
  severity: error
  title: "Seu site ficou sem memória do PHP"
  explain: |
    O PHP tem um limite próprio de memória por requisição ({{limite|bytes}}), separado da
    memória do plano. Um plugin pesado, uma importação grande ou uma imagem enorme costumam
    estourar esse limite. O visitante vê uma página em branco ou erro 500.
  suggest: "Aumentar o memory_limit do PHP para 256 MB e testar de novo."
  action: { job: "php.config.set", params: { key: "memory_limit", value: "256M" },
            label: "Aumentar para 256 MB", confirm: true }
  doc: "/docs/php/memory-limit"

- id: php.perm_denied
  match: "failed to open stream: Permission denied"
  title: "Seu site não conseguiu escrever num arquivo"
  suggest: "Corrigir dono e permissões da pasta do site."
  action: { job: "env.fixperms", label: "Corrigir permissões", confirm: true }

- id: db.access_denied
  match: '\(HY000/1045\): Access denied for user'
  title: "Usuário ou senha do banco de dados estão errados"
  suggest: "Confira host, usuário e senha no arquivo de configuração (no WordPress, wp-config.php)."
  action: { link: "/hosting/{env}/database" }

- id: nginx.body_too_large
  match: "client intended to send too large body"
  title: "O arquivo enviado é maior que o limite"
  suggest: "Aumentar upload_max_filesize, post_max_size e client_max_body_size."
  action: { job: "php.config.set", params: { key: "upload_max_filesize", value: "64M" } }

- id: node.eaddrinuse
  runtime: [node]
  match: "Error: listen EADDRINUSE"
  title: "Já existe um processo usando essa porta"
  suggest: "Seu app tenta subir duas vezes. Verifique se o comando de start não roda em duplicidade."

- id: kernel.oom
  match: "(Killed|Out of memory: Killed process)"
  title: "O sistema encerrou seu processo por falta de memória"
  suggest: "O ambiente atingiu o limite de RAM do plano."
  action: { link: "/hosting/{env}/plano", label: "Ver planos com mais memória" }
```

**(b) Casamento (matching)**, com as travas que impedem a feature de virar problema:

- Padrões compilados **uma vez** no boot, ordenados por prioridade; **primeiro que casa vence**.
- **Sem backtracking catastrófico**: todo `match` passa por um validador no CI (limite de tamanho,
  proibição de quantificador aninhado) e a execução tem timeout de 5 ms por linha.
- Aplicado **no CP, na hora de responder a API** — não no agente e não na ingestão. Motivo: o catálogo
  muda toda semana e o agente é o que menos se quer atualizar em três provedores diferentes. Custo:
  200 linhas × 20 padrões = 4.000 testes de regex ≈ 2 ms por página de log.
- Resposta da API traz `hint: { id, title, explain, suggest, action, doc }` na própria linha; a UI
  desenha 💡 e abre um painel lateral ao clicar.
- **Toda ação é um job com confirmação**, entra em `audit_logs`, e é reversível ou trivialmente
  refazível. Nada de "consertar" silenciosamente o ambiente do cliente.

**(c) O catálogo se mede.** `veloz_log_hint_matches_total{pattern_id}` e
`veloz_log_hint_action_total{pattern_id}` respondem duas perguntas de produto: *quais erros meus
clientes mais cometem* (→ vira documentação, ou vira valor padrão melhor no template) e *quais dicas
as pessoas realmente usam* (→ as que ninguém clica estão mal escritas). **Meta: 20 padrões no MVP**,
cobrindo os erros que geram 80% dos tickets de hospedagem PHP — os 6 acima já cobrem boa parte.

---

## 9. Health check e auto-recuperação

Princípio: **automatize o que é reversível; acorde o humano para o que não é.**

### 9.1 As quatro camadas

| Camada | Como detecta | Cadência | Auto-recuperação | Desistência |
|---|---|---|---|---|
| **Processo** | `systemd` (`Restart=always`, `RestartSec=5`) | contínuo | reinicia agente, nginx, php-fpm | `StartLimitBurst=5/5min` → unidade em `failed` → alerta `agente_mudo` |
| **Ambiente** | probe HTTP do agente no upstream do container: `GET /` com `Host` correto, timeout 3 s | 30 s | 3 falhas seguidas → (1) `reload` do php-fpm/processo do app; ainda falhando → (2) `restart` do container; ainda falhando → (3) para | **3 restarts em 15 min = disjuntor abre**: estado `degraded`, para de tentar, alerta P2, e o painel do cliente explica o que aconteceu |
| **Nó** | heartbeat do agente no CP | 10 s | 3 perdidos (30 s) → `degraded` (para de alocar); 90 s → `offline` (**para de faturar CPU/RAM**, inibe alertas dos ambientes) | Nunca reprovisiona sozinho. Voltar um nó é decisão humana com runbook |
| **Serviço compartilhado** (MariaDB, Postgres, nginx) | probe local: `SELECT 1` / `nginx -t` + porta | 30 s | `systemctl restart` com backoff, **máximo 2 tentativas em 10 min** | 3ª falha → P1, sem mais tentativas (reiniciar banco em loop corrompe mais do que conserta) |

### 9.2 O que o sistema pode e o que não pode fazer sozinho

**Permitido (reversível, sem risco de dado):** reiniciar processo ou container; recarregar nginx após
`nginx -t`; limpar `/tmp` e cache do ambiente; girar e comprimir logs; podar imagens OCI órfãs;
renovar certificado; matar processo zumbi (o `pids.max` já contém fork bomb); `chronyc makestep`;
reenfileirar job idempotente; aplicar limite de banda a um ambiente que estourou a cota.

**Proibido sem humano (irreversível ou comercial):** restaurar backup; apagar qualquer dado do cliente;
migrar ambiente entre nós; aumentar ou reduzir plano; suspender cliente por saldo (só depois da régua
de avisos); reinstalar/reprovisionar nó; mexer em configuração que o cliente editou à mão.

### 9.3 Regras que impedem o autoheal de virar o problema

1. **Disjuntor por escopo.** 3 ações no mesmo ambiente em 24 h → autoheal **desligado** para aquele
   ambiente e alerta P2. Autoheal silencioso que mascara defeito crônico é pior que o defeito:
   o cliente sente lentidão diária e o dono nunca fica sabendo.
2. **Toda ação é visível.** Linha em `audit_logs` com `actor='system'` **e** evento no painel do
   cliente: *"Reiniciamos seu ambiente às 14h02 porque ele parou de responder por 90 segundos."*
   Transparência aqui compra confiança e evita o ticket *"meu site caiu e ninguém me avisou"*.
3. **Tudo é medido.** `veloz_env_autoheal_total{action,result}`,
   `veloz_env_health_probe_seconds`, `veloz_env_healthy` — e a taxa de autoheal por ambiente entra no
   relatório semanal. Ambiente no topo dessa lista é candidato a upsell ou a conversa.
4. **Backoff exponencial com teto**: 5 s, 15 s, 60 s, desiste. Nunca retry apertado.
5. **Nada de autoheal durante deploy** — janela de silêncio automática enquanto houver job de deploy
   ativo no ambiente.

### 9.4 Página de status pública

`status.velozpanel.com.br`, estática, **hospedada fora dos nós** (Pages/R2), alimentada por um JSON que
o CP publica a cada 60 s. Custo: R$ 0. Retorno: quando um nó cai, o cliente vê a página em vez de abrir
ticket — e se o CP cair junto, a página continua no ar porque não depende dele. Mostra: estado por nó,
incidentes abertos, histórico de 90 dias e uptime do mês.

---

## 10. O que este documento fecha, e o que ele deixa para os outros

**Fecha:** pipeline de "requisições" (Achado 8.1); orçamento de banda de telemetria (Achado 6.4);
alerta proativo como corte de suporte (Achado 6.5); C8 (sem Grafana, sem Loki — Grafana **nem para
depuração interna**: a API de gráficos serve para os dois públicos); retenção legal de log; e o
contrato de dados de acessibilidade dos gráficos.

**Depende de terceiros:**

| Item | Dono | O que preciso receber |
|---|---|---|
| Textos do §4 e da frase-resumo (§6.5 item 2) | Produto/UX (#1) | aprovação de redação |
| Itens 4–7 de acessibilidade (§6.5) | Acessibilidade | tokens de cor/traço e validação de teclado |
| Semântica de `env.active.hour` × `active_seconds` do rollup | Billing (#6) | confirmação de que o fechamento da hora é do agente (§2.1) |
| Caminho do cgroup (`incus.payload.` × runtime OCI escolhido) | Linux/SRE (#4) | resolução final do Conflito 1 — a §2.2 assume descoberta via `/proc/<pid>/cgroup`, não hardcode |
| Cota de banda de cada VPS | Dono/Infra | número real para `veloz_node_bandwidth_quota_bytes` |
| Instalação do VM e flags obrigatórias (§1.2) | DevOps/Instalador (#10) | unit systemd com `-memory.allowedBytes=256MB` e `MemoryMax=320M` |

**Fica para depois, com gatilho declarado:** histograma de latência (quando houver SLO contratado);
vmalert + Alertmanager (> 5 nós ou > 30 regras); tracing distribuído (**nunca**, neste porte);
Grafana interno (só se o dono pedir e aceitar os 400 MB); WhatsApp como canal (> 50 clientes).
