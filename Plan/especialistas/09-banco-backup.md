# 09 — Banco de Dados & Backup (Ciclo 2)

> **Escopo.** Executa o **Veredito do Conflito 2** da crítica do Ciclo 1 (banco compartilhado por nó,
> com as 4 emendas), especifica o banco do control plane, e trata backup/restore como o item que mais
> pode matar o negócio.
> **Substitui:** `03-arquitetura.md` §4.1 (parágrafo "um servidor MySQL/Postgres por ambiente") e
> `04-infra-linux.md` §8.4 (inteiro).
> **Premissas herdadas (não reabrir):** VPS de 16 GB, 3 provedores diferentes, sem rede privada,
> runtime OCI + volume (sem ZFS, sem Incus), control plane em Node/TypeScript + Drizzle, Postgres como
> fila, 18–25 ambientes por nó.

---

## 0. Resumo das decisões (leia isto se ler só uma seção)

| # | Decisão | Alternativa recusada | Motivo em uma linha |
|---|---|---|---|
| D1 | **MariaDB 11.8 LTS** compartilhado por nó, rótulo na UI = "MySQL-compatível (MariaDB 11.8 LTS)" | MySQL 8.4 (400–600 MB idle) | ~300 MB de RAM = 1 ambiente vendável de 22 |
| D2 | **PostgreSQL 17** compartilhado por nó, 1 database + 1 role por ambiente | PG por ambiente; PG 18 | PG 18 é a primeira release com AIO — esperar 18.4 (2027) |
| D3 | **Orçamento de RAM: 830 MB em regime, teto duro de 1,05 GB** (MariaDB 480/600, PG 350/450) | "DBs 4 GB" do `04` §2.3 | número de nó de 64 GB, não de 16 GB |
| D4 | **Threadpool no MariaDB** (`thread_handling=pool-of-threads`) | thread-per-connection | 330 conexões possíveis com ~20 threads reais; corta o custo por conexão |
| D5 | **`jit=off`, `max_parallel_workers_per_gather=0`** no PG do nó | defaults | paralelismo em nó multi-tenant é amplificador de vizinho barulhento |
| D6 | **Dump lógico horário por database** para o object storage (RPO 1 h, restore por cliente) | PITR por cliente | binlog/WAL é da instância inteira: PITR por cliente é impossível no modelo compartilhado |
| D7 | **Acesso remoto ao banco: desligado por padrão**, e quando ligado é **allowlist de /32 com validade máxima de 30 dias**. A UI **recusa** `%` e `0.0.0.0/0` | modelo Hostoo ("qualquer IP") | é o vetor nº 1 de vazamento em painel de hospedagem |
| D8 | **Pausa = `ACCOUNT LOCK` (MariaDB) + `CONNECTION LIMIT 0` (PG)** | `MAX_USER_CONNECTIONS 0` do `04` §4.2 | **`MAX_USER_CONNECTIONS 0` significa "ilimitado", não "zero"** — o fluxo atual libera o cliente em vez de bloquear |
| D9 | **Quota de disco por database**, medida de hora em hora, com `REVOKE INSERT,UPDATE,CREATE` no estouro | nada (nenhum doc trata) | um cliente enchendo o NVMe derruba os 21 vizinhos |
| D10 | **Tier "banco dedicado"** = container OCI próprio, vendido de R$ 49 a R$ 159/mês | dar de graça | 512 MB de RAM dedicada = 1 ambiente inteiro do nó |
| D11 | **Uma versão major por engine no nó compartilhado.** Versão alternativa (PG 15, MySQL 8.4 de verdade) **só no tier dedicado** | multi-cluster no nó | cada cluster PG a mais = ~300 MB = 0,6 ambiente |
| D12 | **Política de EOL escrita e automatizada**: nunca rodar versão fora de suporte upstream; aviso em D-90/D-30/D-7 | o que o Hostoo fez (PostgreSQL 10 EOL, sem seletor) | é uma falha de segurança, não de conforto |
| D13 | **CP: PostgreSQL 17 + RLS com `FORCE` + `WITH CHECK` + owner separado**, testado por query de catálogo no CI | RLS "por disciplina" | `USING` sem `WITH CHECK` deixa o tenant **escrever** linha de outro tenant |
| D14 | **CP: pgBackRest** com WAL contínuo (`archive_timeout=60s`), RPO ≤ 60 s, **RTO 30 min** | WAL-G, `pg_dump` | retenção, `--delta`, verify e cifra no repositório |
| D15 | **restic 0.18**, **um repositório por ambiente**, destino primário **Backblaze B2 com Object Lock** | borg (sem S3 nativo), kopia (comunidade menor), Wasabi (mínimo de 90 dias) | B2 tem Object Lock real **e egress grátis até 3× o armazenado** — é o que paga o restore grátis |
| D16 | **Duas identidades no bucket**: nó = *write-only sem delete*; expurgo = *warden* fora dos nós e fora do CP | uma chave só | ransomware que compromete o painel **não consegue apagar backup** |
| D17 | **Cópia 3 em Magalu Cloud (BR, Cold Instant)**, semanal | só um provedor | independência de provedor + dado no Brasil para a conversa de LGPD |
| D18 | **Restauração grátis e não-destrutiva por padrão** (restaura para `_restore_<data>` ao lado) | R$ 25 do Hostoo | custo marginal real ≈ **R$ 0,00** — validado abaixo |
| D19 | **Teste de restore automatizado semanal com prova assinada**, em nó diferente do de origem | `restic check` só | backup não restaurado é ficção; e a prova é o que se mostra ao cliente |
| D20 | **Chave mestra `age` fora de todo servidor**, em 3 lugares, com procedimento de sucessão | chave no nó | bus factor 1 guardando dado de terceiro é risco jurídico, não só técnico |

**Custo de backup:** **~R$ 5/mês** na fase de validação (5 ambientes) e **~R$ 30/mês** com os 3 nós lotados
(66 ambientes) = **R$ 0,45 por ambiente/mês**, ou 1,3% da receita de R$ 35.

**Maior risco:** não é perder o backup — é **descobrir na hora do restore que o append-only nunca foi
append-only**. Por isso existe o teste negativo semanal (§5.7).

---

## 1. Banco do CLIENTE

### 1.1 O desenho, em uma figura

```
NÓ (VPS 16 GB, Debian 13)
┌─────────────────────────────────────────────────────────────────────────┐
│ host                                                                     │
│  ┌────────────────────────┐   ┌────────────────────────┐                │
│  │ mariadb.service        │   │ postgresql@17-main     │                │
│  │ slice veloz-db.slice   │   │ slice veloz-db.slice   │                │
│  │ bind 10.60.0.1:3306    │   │ bind 10.60.0.1:5432    │                │
│  │ MemoryHigh=480M        │   │ MemoryHigh=350M        │                │
│  │ MemoryMax=600M         │   │ MemoryMax=450M         │                │
│  │  ├ db e0042_app        │   │  ├ db e0042_app        │                │
│  │  ├ db e0042_stage      │   │  ├ db e0043_app        │                │
│  │  └ ... (1–3 por env)   │   │  └ ...                 │                │
│  └───────────▲────────────┘   └───────────▲────────────┘                │
│              │ 10.60.0.42 (IP fixo do container, amarrado no grant)     │
│  ┌───────────┴─────────────────────────────┴──────────────┐             │
│  │ container env-0042  (OCI, sem banco dentro)             │             │
│  └─────────────────────────────────────────────────────────┘             │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │ container db-ded-0099 (TIER DEDICADO, opcional, pago)     │           │
│  │ mariadb:11.8 ou postgres:17|15  · MemoryMax próprio      │           │
│  └──────────────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────────────┘
        │ dump horário por database (mariadb-dump / pg_dump -Fc)
        ▼  restic → repositório do ambiente → B2 (object lock)
```

Regras invariantes:

1. **Nenhum banco roda dentro do container do cliente** no plano padrão. O container não tem `mariadbd`
   nem `postgres` instalados — só os clientes (`mariadb-client`, `psql`) e as extensões PHP/Node.
2. **1 role/usuário por ambiente**, não por database. Ambientes com 2–3 databases (prod/stage/teste)
   usam o mesmo dono.
3. **Nomenclatura:** `e<env_id>_<slug>` — `e0042_app`, `e0042_stage`. O prefixo `e<id>_` é o que sustenta
   o grant por padrão no MariaDB.
4. O serviço de banco vive em `veloz-db.slice`, **irmã** e não filha da slice dos ambientes: o OOM de um
   ambiente nunca escolhe o `mariadbd` como vítima (`OOMScoreAdjust=-500` nas units de banco).

### 1.2 MariaDB 11.8 LTS — configuração completa e justificada

Por que 11.8 e não 11.4: ambas são LTS; 11.8 (jun/2025, suporte até jun/2030) traz `max_binlog_total_size`
maduro, `utf8mb4_uca1400_*` (a família de collations que substitui bem o `utf8mb4_0900_ai_ci` do MySQL 8 —
ver §1.10) e melhorias de otimizador. 11.4 fica como plano B se um pacote Debian atrasar.

```ini
# /etc/mysql/mariadb.conf.d/90-veloz.cnf
[mariadbd]
# ─── Identidade e rede ───────────────────────────────────────────────────────
bind-address                    = 10.60.0.1        # NUNCA 0.0.0.0
skip-name-resolve               = ON               # sem DNS reverso: latência e superfície a menos
port                            = 3306
socket                          = /run/mysqld/mysqld.sock

# ─── Memória: o item que decide a densidade do nó ────────────────────────────
innodb_buffer_pool_size         = 256M             # ver justificativa abaixo
innodb_log_buffer_size          = 16M
innodb_log_file_size            = 128M             # 2× o pico de escrita em 1 min; checkpoints raros
aria_pagecache_buffer_size      = 32M              # DEFAULT É 128M — tabelas internas usam Aria. Corte de 96 MB de graça
key_buffer_size                 = 16M              # MyISAM legado (plugins WP antigos); não zerar
table_open_cache                = 2000
table_definition_cache          = 1400
open_files_limit                = 16384
performance_schema              = OFF              # LIGADO custa 150–400 MB. Diagnóstico via slow log + PROCESSLIST
max_allowed_packet              = 64M              # imports de WP com postmeta grande
tmp_table_size                  = 16M
max_heap_table_size             = 16M              # tem que ser igual a tmp_table_size, senão o menor manda
tmpdir                          = /var/tmp/mysql   # filesystem próprio com quota — ver §1.9

# ─── Buffers POR CONEXÃO (multiplicam! ler §1.4) ─────────────────────────────
sort_buffer_size                = 512K
join_buffer_size                = 256K
read_buffer_size                = 128K
read_rnd_buffer_size            = 256K
thread_stack                    = 292K
net_buffer_length               = 16K

# ─── Threadpool: 330 conexões possíveis com ~20 threads reais ────────────────
thread_handling                 = pool-of-threads
thread_pool_size                = 6                # = nº de vCPU do nó (VPS1=6, VPS2=8)
thread_pool_max_threads         = 200
thread_pool_idle_timeout        = 60
thread_pool_oversubscribe       = 3
max_connections                 = 300              # ver §1.5 (sobrescrição intencional)
max_user_connections            = 15               # default global; sobrescrito por conta

# ─── Durabilidade e I/O em NVMe ──────────────────────────────────────────────
innodb_flush_log_at_trx_commit  = 1                # ACID de verdade. 2 só no tier dedicado, com o cliente ciente
sync_binlog                     = 1
innodb_flush_method             = fsync            # DECISÃO CONTRAINTUITIVA — ver justificativa
innodb_io_capacity              = 2000
innodb_io_capacity_max          = 4000
innodb_read_io_threads          = 4
innodb_write_io_threads         = 4
innodb_buffer_pool_dump_at_shutdown = ON
innodb_buffer_pool_load_at_startup  = ON           # pool quente após restart: corta o "site lento depois da manutenção"
innodb_fast_shutdown            = 1
innodb_doublewrite              = ON               # NÃO desligar: com 22 clientes numa instância, torn page = incidente coletivo

# ─── Binlog: existe para restaurar a INSTÂNCIA, não o cliente ────────────────
log_bin                         = /var/lib/mysql/binlog/veloz-bin
binlog_format                   = ROW
binlog_row_image                = MINIMAL
expire_logs_days                = 2
max_binlog_size                 = 128M
max_binlog_total_size           = 4G               # teto duro: binlog nunca enche o NVMe do nó

# ─── Contenção de vizinho barulhento ─────────────────────────────────────────
max_statement_time              = 30               # segundos; global
lock_wait_timeout               = 30
innodb_lock_wait_timeout        = 20
wait_timeout                    = 300
interactive_timeout             = 600
idle_transaction_timeout        = 60               # MariaDB-only; mata transação aberta e esquecida
idle_write_transaction_timeout  = 30

# ─── Superfície de ataque ────────────────────────────────────────────────────
local_infile                    = OFF
secure_file_priv                = ""               # string vazia = LOAD/SELECT INTO FILE desabilitados
log_bin_trust_function_creators = OFF
skip_symbolic_links             = ON
require_secure_transport        = OFF              # rede 10.60.0.0/24 é interna ao nó; ON para acesso remoto (§1.6)

# ─── Observabilidade barata ──────────────────────────────────────────────────
slow_query_log                  = ON
slow_query_log_file             = /var/log/mysql/slow.log
long_query_time                 = 1
log_slow_verbosity              = query_plan,explain
log_queries_not_using_indexes   = OFF              # ligar só em investigação: enche o disco em 1 h com WP
log_error                       = /var/log/mysql/error.log

# ─── Charset ─────────────────────────────────────────────────────────────────
character-set-server            = utf8mb4
collation-server                = utf8mb4_uca1400_ai_ci
```

**Por que `innodb_flush_method = fsync` (buffered) e não `O_DIRECT`.** Este é o único ponto do tuning que
contraria o conselho padrão, e o motivo é o tamanho do pool. Com `O_DIRECT`, o InnoDB pula o page cache do
kernel: todo *miss* no buffer pool de 256 MB vira leitura física. Com 22 ambientes cujo conjunto quente
somado passa de 2 GB, o pool de 256 MB **vai** errar muito. Em modo buffered, o ~1 GB de margem de page
cache do host (Achado 0.2 da crítica) vira uma **L2 compartilhada, gerida por LRU do kernel**, que se
adapta sozinha a qual cliente está com tráfego agora — exatamente o comportamento que se quer num nó
multi-tenant. O custo é dupla-bufferização das páginas quentes (as mesmas páginas em RAM duas vezes), que
com pool pequeno é irrelevante. **Regra de troca:** no tier dedicado, onde o pool é dimensionado para caber
o dataset, volta para `O_DIRECT`. Métrica de acompanhamento: `Innodb_buffer_pool_reads / Innodb_buffer_pool_read_requests`
(alvo < 5%; acima de 15% por 24 h ⇒ o nó precisa de mais RAM ou o cliente precisa do tier dedicado).

**Removidos de propósito** (aparecem em todo tutorial e não existem/não servem aqui): `query_cache_*`
(removido do MariaDB 11 na prática e nocivo em multi-tenant), `innodb_buffer_pool_instances` (removido no
MariaDB 10.6+), `innodb_thread_concurrency` (superseded pelo threadpool), `innodb_file_per_table` (já é ON
e é obrigatório aqui — sem ele não existe `DROP DATABASE` que devolva disco ao SO).

**Unit systemd:**

```ini
# /etc/systemd/system/mariadb.service.d/veloz.conf
[Service]
Slice=veloz-db.slice
MemoryHigh=480M
MemoryMax=600M
MemorySwapMax=0
OOMScoreAdjust=-500
CPUWeight=300
IOWeight=300
LimitNOFILE=32768
Restart=always
RestartSec=3
```

`MemoryHigh` (480M) é o alvo: acima dele o kernel faz *reclaim* agressivo e o processo desacelera.
`MemoryMax` (600M) é o teto duro, e bater nele é **incidente coletivo** (OOM-kill do banco de 22 clientes).
Por isso: alerta em `memory.high` acionado > 60 s, e o `veloz-node-doctor` reporta
`memory.events:high` do slice.

### 1.3 PostgreSQL 17 — configuração completa e justificada

Por que 17 e não 18: PG 18 (set/2025) trouxe I/O assíncrono (`io_method`) e mudou o caminho de leitura —
é a mudança mais invasiva no executor de I/O em uma década. Num negócio com 1 operador, adotar a primeira
release de um subsistema novo não paga. **Ratifica-se PG 17** (suporte upstream até nov/2029), com gatilho
de revisão: migrar para 18 quando sair a 18.4 (previsão: fev/2027) e depois de o tier dedicado rodar 18 por
60 dias sem incidente.

```conf
# /etc/postgresql/17/main/conf.d/90-veloz.conf
# ─── Conexões ────────────────────────────────────────────────────────────────
listen_addresses              = '10.60.0.1'
port                          = 5432
max_connections               = 100          # cada backend custa RAM de verdade; ver §1.4
superuser_reserved_connections = 5
reserved_connections          = 3            # PG 16+: reserva para o role de manutenção do painel

# ─── Memória ─────────────────────────────────────────────────────────────────
shared_buffers                = 256MB
effective_cache_size          = 1500MB       # só uma dica ao planejador; conta o page cache do host
work_mem                      = 4MB          # POR NÓ DE PLANO, não por query. Ver §1.4
maintenance_work_mem          = 64MB
autovacuum_work_mem           = 64MB
wal_buffers                   = 8MB
temp_buffers                  = 8MB
hash_mem_multiplier           = 1.5

# ─── Paralelismo: DESLIGADO de propósito ─────────────────────────────────────
max_worker_processes          = 8
max_parallel_workers          = 2
max_parallel_workers_per_gather = 0          # um seq scan paralelo de um cliente consome 3 cores dos 6
max_parallel_maintenance_workers = 1
jit                           = off          # compilar LLVM num nó de 16 GB queima CPU e RAM por nada em OLTP

# ─── WAL / checkpoint ────────────────────────────────────────────────────────
wal_level                     = replica
wal_compression               = zstd
min_wal_size                  = 256MB
max_wal_size                  = 1GB
checkpoint_completion_target  = 0.9
checkpoint_timeout            = 15min
synchronous_commit            = on
full_page_writes              = on

# ─── Planejador em NVMe ──────────────────────────────────────────────────────
random_page_cost              = 1.1
seq_page_cost                 = 1.0
effective_io_concurrency      = 200
maintenance_io_concurrency    = 100
default_statistics_target     = 100

# ─── Autovacuum mais agressivo (bases pequenas, NVMe sobrando) ───────────────
autovacuum                    = on
autovacuum_max_workers        = 2
autovacuum_naptime            = 30s
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02
autovacuum_vacuum_cost_limit  = 1000

# ─── Contenção de vizinho barulhento ─────────────────────────────────────────
statement_timeout             = 120s         # teto global; por role é 60s (§1.5)
idle_in_transaction_session_timeout = 120s
idle_session_timeout          = 900s
lock_timeout                  = 30s
temp_file_limit               = 2GB          # teto global; por role é 1GB e é NÃO-BURLÁVEL (§1.5)
deadlock_timeout              = 1s

# ─── Segurança ───────────────────────────────────────────────────────────────
password_encryption           = scram-sha-256
ssl                           = on
ssl_min_protocol_version      = 'TLSv1.3'
row_security                  = on

# ─── Observabilidade ─────────────────────────────────────────────────────────
shared_preload_libraries      = 'pg_stat_statements'
pg_stat_statements.max        = 2000
pg_stat_statements.track      = top
track_io_timing               = on
log_min_duration_statement    = 1000
log_checkpoints               = on
log_lock_waits                = on
log_temp_files                = 10MB
log_autovacuum_min_duration   = 5000
log_line_prefix               = '%m [%p] %q%u@%d %a '
log_connections               = on
log_disconnections            = off
```

**Sem pooler (PgBouncer) na fase 1, e o motivo é o cliente.** PgBouncer em `transaction` mode
economizaria ~150 MB, mas quebra silenciosamente coisas que apps de cliente usam: `LISTEN/NOTIFY`,
advisory locks mantidos entre transações, tabelas temporárias de sessão, `SET` de sessão e cursores
`WITH HOLD`. Diagnosticar isso num app de terceiro é o pior ticket possível. Em `session` mode, o
PgBouncer não economiza conexão nenhuma no backend — só adiciona um processo. **Decisão: sem pooler no
banco compartilhado.** O controle é `CONNECTION LIMIT` por role + `max_connections=100`. O PgBouncer
volta à mesa quando um nó passar de 40 ambientes, e aí como opção *opt-in* por ambiente, documentada.

**`shared_preload_libraries` mínimo.** `pg_stat_statements` custa ~8 MB e é a única forma barata de
descobrir *qual cliente* está com a query ruim. `auto_explain` fica **desligado** por padrão (custa CPU em
todo plano) e é ligado por 30 min durante investigação, via `ALTER SYSTEM` + `pg_reload_conf()`.

**Extensões permitidas ao cliente** (allowlist explícita — o resto é recusado, e recusa vira upsell do
tier dedicado):
`pgcrypto`, `uuid-ossp`, `citext`, `unaccent`, `pg_trgm`, `btree_gin`, `btree_gist`, `hstore`, `intarray`,
`tablefunc`, `ltree`, `pg_stat_statements` (leitura da própria base).
**Recusadas no compartilhado:** `plpython3u`, `plperlu`, `pllua` (untrusted = shell no host),
`file_fdw`, `postgres_fdw`, `dblink` (saída de rede arbitrária a partir do banco), `pg_cron` (agenda no
nível da instância; o cron do painel resolve), `postgis` (~50 MB por instância + upgrades acoplados —
**vender no tier dedicado**), `pgvector` (idem, e cresce rápido — tier dedicado).
Implementação: `CREATE EXTENSION` só funciona para superusuário ou para extensões `trusted`; a lista acima
é entregue via um job do agente (`db.extension.enable`) que valida contra a allowlist, nunca por
`GRANT` amplo.

**Unit systemd:**

```ini
# /etc/systemd/system/postgresql@17-main.service.d/veloz.conf
[Service]
Slice=veloz-db.slice
MemoryHigh=350M
MemoryMax=450M
MemorySwapMax=0
OOMScoreAdjust=-500
CPUWeight=300
IOWeight=300
```

> **Cuidado real:** OOM-kill de um *backend* do Postgres faz o postmaster **reiniciar a instância inteira**
> e derrubar todas as conexões de todos os clientes do nó. É por isso que `MemoryMax` do PG é o número
> menos negociável do documento, e por isso `work_mem` é 4 MB e o paralelismo está desligado. Além disso,
> em `/etc/sysctl.d/99-veloz.conf`: `vm.overcommit_memory = 2`, `vm.overcommit_ratio = 90` — recomendação
> explícita do Postgres para evitar que o OOM killer escolha o postmaster.

### 1.4 O orçamento de RAM, item por item

**MariaDB — regime e pico:**

| Componente | Regime | Pico |
|---|---|---|
| `innodb_buffer_pool_size` | 256 MB | 256 MB (+ ~5% de overhead de estruturas = 269 MB) |
| `innodb_log_buffer` + `aria_pagecache` + `key_buffer` | 64 MB | 64 MB |
| Caches de dicionário (`table_open_cache` 2000 × ~10 KB) | ~20 MB | ~35 MB |
| Código, heap do processo, alocador | ~70 MB | ~90 MB |
| Buffers por thread ativa (~1,4 MB × 20 threads do pool) | ~10 MB | ~30 MB |
| Sessões conectadas (THD, ~40 KB × 200) | ~8 MB | ~12 MB |
| **Total** | **~428 MB** | **~490 MB** |

O threadpool é o que torna esta conta possível: sem ele, `sort_buffer + join_buffer + read_buffer +
read_rnd_buffer + thread_stack` seriam alocados no caminho de cada uma das 200–330 conexões conectadas
(≈ 1,4 MB × 330 = 460 MB só de buffer de sessão, mais que o banco inteiro). Com `pool-of-threads`, só as
~20 threads que estão **executando** seguram esses buffers.

**PostgreSQL — regime e pico:**

| Componente | Regime | Pico |
|---|---|---|
| `shared_buffers` + estruturas compartilhadas (locks, procarray, `pg_stat_statements`) | 285 MB | 285 MB |
| Postmaster + autovacuum launcher + workers (2 × ~15 MB) | 45 MB | 45 MB |
| Backends privados (~3,5 MB de RSS privado × 25 ativos típicos) | ~88 MB | 40 conexões ⇒ 140 MB |
| `work_mem` em uso (4 MB × ~2 nós de plano × 8 queries pesadas simultâneas) | ~15 MB | ~64 MB |
| `maintenance_work_mem` durante autovacuum (2 × 64 MB) | 0 | 128 MB (transiente) |
| **Total** | **~433 MB** | **~660 MB** transiente |

Aqui a conta **não fecha** nos 350 MB da crítica em pico, e é honesto dizer: 350 MB é o **regime com ~20
conexões ativas**; o pico com autovacuum simultâneo e 40 backends passa de 600 MB. As três defesas:
(a) `autovacuum_max_workers=2` com `autovacuum_work_mem=64MB` limita o transiente a 128 MB;
(b) `MemoryHigh=350M` faz o kernel *reclaimar* page cache do próprio processo antes de estourar;
(c) `MemoryMax=450M` só é atingível se as duas anteriores falharem, e nesse ponto o alerta já disparou.

**Consolidado do nó (revisão da tabela do Achado 0.2 da crítica):**

| Item | RAM reservada |
|---|---|
| Kernel + systemd + sshd + journald | 500 MB |
| Agente + coletor de métricas | 150 MB |
| nginx de borda | 50 MB |
| **MariaDB 11.8** (regime 428 / teto 600) | **480 MB** |
| **PostgreSQL 17** (regime 433 / teto 450) | **350 MB** |
| Margem de page cache e picos | 1.000 MB |
| **Reserva do host** | **2,53 GB** |
| **Disponível para ambientes** | **13,47 GB → 11,4 GB a 85% ⇒ 22 ambientes de 512 MB** |

A tabela da crítica **se confirma**: 830 MB para os dois bancos, 22 ambientes por nó de 16 GB.
Se o nó tiver poucos clientes usando Postgres (cenário provável no início — WordPress domina), a unit do
PG entra em `MemoryHigh=200M`/`shared_buffers=128MB` e devolve 150 MB. O agente ajusta isso sozinho quando
`count(databases pg) < 3` e reverte ao passar de 5.

### 1.5 Isolamento entre clientes

#### MariaDB — provisionamento de um ambiente

```sql
-- Executado pelo agente via job db.provision. Senha gerada com 32 bytes de CSPRNG.
CREATE DATABASE `e0042_app`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

CREATE USER 'e0042'@'10.60.0.42'
  IDENTIFIED BY '<32 bytes base62>';

-- ATENÇÃO: em GRANT, '_' e '%' SÃO CURINGAS. `e0042_%` casa com 'e0042Xapp' de outro tenant
-- se algum dia existir um id assim. O escape é obrigatório:
GRANT ALL PRIVILEGES ON `e0042\_%`.* TO 'e0042'@'10.60.0.42';

-- Limites de recurso da CONTA (MariaDB: MAX_STATEMENT_TIME é resource_option, não existe no MySQL)
GRANT USAGE ON *.* TO 'e0042'@'10.60.0.42'
  WITH MAX_USER_CONNECTIONS 15
       MAX_QUERIES_PER_HOUR 300000
       MAX_STATEMENT_TIME 30;

FLUSH PRIVILEGES;
```

Detalhes que decidem se o isolamento é real:

| Vetor | Defesa | É burlável pelo cliente? |
|---|---|---|
| Conectar de outro container | conta amarrada ao IP `10.60.0.42`; IP do container é estático e atribuído pelo agente, e o nftables do nó dropa spoof de origem em `veloz-br0` | não |
| Ver bases dos outros | `SHOW DATABASES` só lista o que o grant permite; sem `SHOW DATABASES` global | não |
| Ver queries dos outros | sem privilégio `PROCESS` ⇒ `SHOW PROCESSLIST` mostra só as próprias threads | não |
| Ler/escrever arquivo do host | sem `FILE`; `local_infile=OFF`; `secure_file_priv=""` | não |
| Escalar via rotina armazenada | `log_bin_trust_function_creators=OFF`; sem `SUPER`/`SET_USER_ID`, `DEFINER` não pode ser outro usuário | não |
| Segurar 300 conexões | `MAX_USER_CONNECTIONS 15` | não |
| Query infinita | `MAX_STATEMENT_TIME 30` **+ watchdog** (§1.8) | o `SET SESSION max_statement_time=0` derruba o limite da conta ⇒ **o watchdog é a camada não-burlável** |
| Encher o NVMe | quota por database (§1.9) | não |
| Explodir 300k queries/h | `MAX_QUERIES_PER_HOUR` | não — mas **cuidado**: estourado, a conta fica bloqueada até `FLUSH USER_RESOURCES` ou a virada da hora. É disjuntor de último recurso: 300k/h = 83 q/s sustentadas. O painel precisa mostrar o estado e ter botão "destravar agora" (que executa `FLUSH USER_RESOURCES`) |

**`max_connections = 300` com `MAX_USER_CONNECTIONS 15` × 22 ambientes = 330.** A sobrescrição é
intencional e o número vem da realidade do php-fpm: com `pm.max_children = 5` por ambiente, a demanda real
por ambiente é ≤ 6 conexões; 15 é 2,5× de folga para picos e para o Adminer aberto do cliente. Se todos
pedissem 15 ao mesmo tempo, o 301º recebe `ER_CON_COUNT_ERROR` — melhor que OOM. O alerta dispara em
`Threads_connected > 200`.

#### PostgreSQL — provisionamento de um ambiente

```sql
CREATE ROLE e0042 LOGIN PASSWORD '<32 bytes>' CONNECTION LIMIT 20
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE DATABASE e0042_app OWNER e0042
  ENCODING 'UTF8' LC_COLLATE 'pt_BR.UTF-8' LC_CTYPE 'pt_BR.UTF-8' TEMPLATE template0;

REVOKE ALL ON DATABASE e0042_app FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE e0042_app TO e0042;

-- PG 15+ já não dá CREATE em public para PUBLIC; reafirmar mesmo assim (defesa em profundidade)
\c e0042_app
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO e0042;

-- Limites por role
ALTER ROLE e0042 SET statement_timeout                     = '60s';   -- SOFT (o cliente pode alterar)
ALTER ROLE e0042 SET idle_in_transaction_session_timeout   = '120s';  -- SOFT
ALTER ROLE e0042 SET lock_timeout                          = '30s';   -- SOFT
ALTER ROLE e0042 SET temp_file_limit                       = '1GB';   -- HARD: não-superusuário NÃO pode aumentar
ALTER ROLE e0042 SET search_path                           = "$user", public;
ALTER ROLE e0042 SET log_min_duration_statement            = '500ms';
```

**A distinção HARD × SOFT precisa estar no documento e no código**, porque quem só lê o `ALTER ROLE`
acredita que está protegido:

| Parâmetro | Contexto no PG | O cliente consegue mudar? |
|---|---|---|
| `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout`, `work_mem` | `USERSET` | **sim**, com `SET` na sessão |
| `temp_file_limit` | `SUSET` desde PG 15 no sentido de aumentar | **não pode aumentar** (só reduzir) |
| `CONNECTION LIMIT` da role | atributo da role | não |
| `max_connections`, `shared_buffers` | `POSTMASTER` | não |

Ou seja: em Postgres, a única defesa **hard** contra query infinita é matar de fora. Watchdog em §1.8.

**`pg_hba.conf` gerado, uma linha por ambiente, e o fecho de negação no fim:**

```conf
# /etc/postgresql/17/main/pg_hba.conf   — GERADO pelo agente, não editar
local   all             postgres                                peer
host    all             veloz_admin     127.0.0.1/32            scram-sha-256
# ─── ambientes ───────────────────────────────────────────────────────────────
host    e0042_app       e0042           10.60.0.42/32           scram-sha-256
host    e0042_stage     e0042           10.60.0.42/32           scram-sha-256
host    e0043_app       e0043           10.60.0.43/32           scram-sha-256
# ─── acesso remoto temporário (§1.6), com validade escrita no comentário ─────
hostssl e0042_app       e0042           189.45.12.7/32          scram-sha-256  # expira 2026-09-14
# ─── fecho ───────────────────────────────────────────────────────────────────
host    all             all             0.0.0.0/0               reject
host    all             all             ::/0                    reject
```

O `reject` final é o que transforma um erro de geração de arquivo em "ninguém conecta" em vez de
"todo mundo conecta". Duas camadas independentes (`pg_hba` + `CONNECT` revogado do `PUBLIC`) porque a
primeira é um arquivo gerado por código e código gerado por IA erra.

**Ambientes e databases.** Cada ambiente recebe `1` database por padrão e pode criar até `3`
(`e0042_app`, `e0042_stage`, `e0042_dev`) pela UI, todos sob o mesmo dono. **Não se usa schema por
ambiente dentro de um database comum** — schema é fronteira fraca no Postgres (o `search_path` do cliente é
dele) e não existe no MySQL. Database é a fronteira.

### 1.6 Acesso remoto ao banco — não repetir o erro do Hostoo

O erro a não repetir: o Hostoo oferece "liberar acesso remoto" com `%` como valor natural, e o cliente que
não entende de rede clica em liberar tudo. Isso expõe 3306 na internet com uma senha que o cliente escolheu.
É o vetor com que se perdem bases inteiras.

**Escada de acesso, do padrão ao excepcional:**

| Nível | Como | Exposição | Padrão? |
|---|---|---|---|
| 0 | **Adminer embutido no painel**, servido pelo próprio painel via proxy autenticado (sessão do painel + 2FA), rodando efêmero e nunca acessível por URL pública | zero | **ligado** |
| 1 | **Túnel SSH** pelo jump host: `ssh -N -L 3307:10.60.0.1:3306 e0042@no1.veloz.app -p 2222` — o painel gera o comando pronto, com o botão "copiar", e o DBeaver/TablePlus tem campo nativo de SSH tunnel | zero porta nova | **ligado** |
| 2 | **Allowlist de /32 com validade** — abre 3306/5432 na borda **só** para os IPs listados, com TLS obrigatório | mínima e temporária | desligado |
| 3 | **WireGuard do cliente** (add-on) — o cliente ganha um peer e enxerga `10.60.0.1` | zero pública | desligado, pago |
| ∅ | `0.0.0.0/0` / `%` | — | **não existe no produto** |

Regras duras do nível 2, que precisam estar no código e não só no documento:

1. A UI **não aceita** máscara maior que `/32` (IPv4) ou `/128` (IPv6). Digitar `0.0.0.0/0`, `%`, `any`,
   `0/0` retorna erro de validação com texto explicando o porquê, não um aviso ignorável.
2. **Validade obrigatória**: 24 h, 7 dias ou 30 dias. Não existe "permanente". Um job diário
   (`db.remote.expire`) revoga o que venceu e notifica.
3. Máximo de **5 IPs simultâneos** por ambiente.
4. `require_secure_transport = ON` para essas contas no MariaDB (`ALTER USER ... REQUIRE SSL`) e
   `hostssl` no `pg_hba`. Conexão em claro pela internet não acontece.
5. Botão **"liberar meu IP atual"** que lê o IP da requisição — resolve 90% dos casos sem o cliente
   precisar saber o que é um IP, e ainda entrega um /32.
6. A senha do acesso remoto é **diferente** da senha da aplicação: `e0042_r` é uma segunda conta, com os
   mesmos grants, criada só quando o nível 2 é ativado e destruída na expiração. Assim, revogar o acesso
   remoto nunca derruba o site.
7. Toda ativação vira linha em `audit_logs` com IP, usuário do painel, validade — e um e-mail ao dono da
   conta ("alguém liberou acesso remoto ao seu banco").
8. `fail2ban` com jail para `mysqld`/`postgresql` na borda: 5 falhas em 10 min ⇒ 1 h de ban do /32.

**A UI precisa dizer a verdade na hora da escolha:** "Liberar um IP fixo é seguro. Se o seu IP muda
(internet residencial), use o túnel SSH — é igualmente simples e não expõe seu banco."

### 1.7 O que acontece com o banco quando o ambiente é pausado

**Correção obrigatória do `04` §4.2.** O fluxo publicado no Ciclo 1 faz:

```sql
ALTER USER 'e0042'@'%' WITH MAX_USER_CONNECTIONS 0;   -- ERRADO
```

Em MySQL/MariaDB, **`MAX_USER_CONNECTIONS 0` significa "sem limite próprio, use o global"** — isto é, o
comando *aumenta* o limite do cliente de 15 para 300 em vez de zerá-lo. É um bug com cara de correção, e é
exatamente o tipo de coisa que uma IA replica sem questionar. O correto:

```sql
-- PAUSA
ALTER USER 'e0042'@'10.60.0.42' ACCOUNT LOCK;          -- MariaDB 10.4.2+
SELECT CONCAT('KILL ', id, ';') FROM information_schema.processlist WHERE user='e0042';  -- e executa
-- (ACCOUNT LOCK impede novas conexões; não derruba as abertas — por isso o KILL)

-- START
ALTER USER 'e0042'@'10.60.0.42' ACCOUNT UNLOCK;
```

No Postgres o fluxo do `04` está **correto** (`CONNECTION LIMIT 0` significa mesmo zero; `-1` é ilimitado),
mas falta a ordem certa: revogar antes de matar, senão a aplicação reconecta entre um comando e outro.

```sql
-- PAUSA
ALTER ROLE e0042 CONNECTION LIMIT 0;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'e0042';
-- START
ALTER ROLE e0042 CONNECTION LIMIT 20;
```

**Tabela do estado "pausado" — versão corrigida para o tooltip da UI:**

| Aspecto | Estado quando pausado | Custo |
|---|---|---|
| Conexões | **bloqueadas** (`ACCOUNT LOCK` / `CONNECTION LIMIT 0`), sessões abertas encerradas | — |
| Dados | **intactos**, no datadir do nó | conta em `db.gb.hour` |
| RAM no buffer pool / shared_buffers | **não é liberada explicitamente**; as páginas do cliente pausado são evacuadas sozinhas pelo LRU em minutos de atividade dos vizinhos | ≈ 0 depois de ~10 min |
| Processo do banco | continua no ar (é compartilhado) | 0 para este cliente |
| Dump horário | **passa a diário** após 24 h pausado (nada muda; o restic dedupa para ~0 bytes) | ≈ R$ 0,00 |
| Retenção do backup | inalterada | incluída |
| Acesso remoto liberado | **revogado** na pausa (a conta `e0042_r` é destruída), e **não** volta sozinha no start | — |
| Adminer no painel | indisponível ("inicie o ambiente para acessar o banco") | — |

**Cobrança.** O ambiente pausado paga `disk.gb.hour` do volume **e** `db.gb.hour` do database. Este segundo
meter não existe nos documentos do Ciclo 1 e precisa existir: um cliente pode pausar o ambiente e deixar
uma base de 8 GB parada no NVMe — que é exatamente o recurso escasso. Preço sugerido: mesmo do disco do
ambiente. Fica dentro dos "~20% do ativo" que a crítica pediu (Achado 6.1, correção 3).

**Expurgo.** Aos 90 dias pausado (regra do `04` §4.4), a base entra em expurgo junto com o volume: dump
final → repositório restic → `DROP DATABASE` → `DROP USER/ROLE`. O dump final fica retido 15 dias e é
baixável pelo cliente.

### 1.8 Vizinho barulhento: como uma query ruim não derruba os outros

Cinco camadas, da mais barata à mais cara, e o que cada uma realmente resolve:

| # | Camada | Resolve | Não resolve |
|---|---|---|---|
| 1 | `veloz-db.slice` com `CPUWeight=300`, `IOWeight=300`, `MemoryHigh/Max` | banco não é morto pelo OOM de um ambiente; ambiente não rouba I/O do banco | contenção **dentro** do banco |
| 2 | `MAX_USER_CONNECTIONS` / `CONNECTION LIMIT` | um cliente monopolizar o pool de conexões | uma única query pesada |
| 3 | `MAX_STATEMENT_TIME` / `statement_timeout` | 95% das queries infinitas | cliente que faz `SET` para desligar |
| 4 | **Watchdog `veloz-db-warden`** (abaixo) | tudo que passou pela 3 | query legítima e pesada dentro do limite |
| 5 | `temp_file_limit`, `tmpdir` com quota, quota por database (§1.9) | encher o disco | — |

**Watchdog — o único ponto não-burlável.** Um timer systemd a cada 10 s, ~60 linhas, rodando com uma conta
administrativa do banco:

```bash
#!/bin/bash
# /usr/local/sbin/veloz-db-warden   — systemd timer, a cada 10s
set -euo pipefail
LIMIT_SOFT=60      # segundos: mata e registra
LIMIT_HARD=300     # segundos acumulados na última hora por conta: trava a conta e abre incidente

# ─── MariaDB ────────────────────────────────────────────────────────────────
mariadb -N -B -e "
  SELECT CONCAT(ID,'|',USER,'|',TIME,'|',LEFT(REPLACE(INFO,'\n',' '),200))
  FROM information_schema.PROCESSLIST
  WHERE COMMAND NOT IN ('Sleep','Daemon','Binlog Dump')
    AND USER LIKE 'e0%' AND TIME > $LIMIT_SOFT;" |
while IFS='|' read -r id user secs sql; do
  mariadb -e "KILL QUERY $id;"
  logger -t veloz-db-warden "killed mariadb query id=$id user=$user secs=$secs sql=${sql}"
  velozctl event emit db.query.killed --env "${user#e}" --engine mysql --secs "$secs" --sql "$sql"
done

# ─── PostgreSQL ─────────────────────────────────────────────────────────────
psql -qAtX -U veloz_admin -h 10.60.0.1 -d postgres -c "
  SELECT pid||'|'||usename||'|'||EXTRACT(epoch FROM now()-query_start)::int||'|'||left(replace(query,E'\n',' '),200)
  FROM pg_stat_activity
  WHERE state <> 'idle' AND usename LIKE 'e0%'
    AND now()-query_start > interval '$LIMIT_SOFT seconds';" |
while IFS='|' read -r pid user secs sql; do
  psql -qAtX -U veloz_admin -h 10.60.0.1 -d postgres -c "SELECT pg_cancel_backend($pid);" >/dev/null
  logger -t veloz-db-warden "cancelled pg query pid=$pid user=$user secs=$secs sql=${sql}"
  velozctl event emit db.query.killed --env "${user#e}" --engine pg --secs "$secs" --sql "$sql"
done
```

Regras de escalada, que são a parte de produto:

1. **1ª a 3ª morte na hora**: mata a query, registra, mostra no painel do cliente em
   *Banco de dados → Saúde* com o SQL truncado e o texto "esta consulta passou de 60 s e foi interrompida".
   Nada de e-mail — é ruído.
2. **> 10 mortes na hora, ou > 300 s acumulados**: e-mail ao cliente + banner no painel + ticket automático
   com o `EXPLAIN` já colado. Sugestão automática: "adicione um índice em X" quando o plano tiver seq scan
   sobre tabela > 100k linhas.
3. **> 30 mortes na hora**: `ACCOUNT LOCK` / `CONNECTION LIMIT 0` por 15 min (o site cai, mas o site já
   estava caído — e os 21 vizinhos não caem), com a página de erro do painel explicando e o botão
   "reativar agora" que o cliente pode apertar uma vez.
4. **Reincidência em 3 dias**: o painel oferece **migrar para banco dedicado** com um clique. É aqui que o
   noisy neighbor vira receita em vez de ticket.

**Métricas por cliente que o painel precisa expor** (o cliente que não vê não corrige):
queries/s, tempo médio, top 5 queries lentas (via `pg_stat_statements` filtrado por `dbid`, e via
`slow.log` parseado por usuário), tamanho da base, conexões em uso × limite, mortes do warden.

**E quando derrubar mesmo assim.** Existe um cenário que nenhuma das cinco camadas cobre: uma query
*rápida* executada 5.000 vezes por segundo por um plugin em loop, ou um `ALTER TABLE` de 40 min numa tabela
de 2 GB que não passa de `statement_timeout` porque DDL no MariaDB não é interrompida por ele.
Procedimento no runbook **RB-05** (§6). O resumo: identificar em 60 s com
`pg_stat_statements`/`sys.statement_analysis`, `ACCOUNT LOCK` no culpado, avisar, e só então investigar.
**A ordem importa**: primeiro protege os 21, depois cuida do 1.

### 1.9 Quota de disco por database — o buraco que nenhum documento tratou

Nem MySQL nem PostgreSQL têm quota por database. É uma limitação real e o modo de falha é terminal:
um cliente com um `INSERT` em loop enche os 200 GB do NVMe e **todos os 22 ambientes do nó param**,
inclusive os que não usam banco (o volume dos arquivos é o mesmo dispositivo).

Solução em três partes:

1. **Filesystem separado para os dados de banco.** No particionamento do nó: `/var/lib/veloz-db` como
   LV/partição XFS própria, dimensionada em 25% do disco (50 GB numa VPS de 200 GB), com `prjquota`.
   Datadir do MariaDB e do PG lá dentro; `tmpdir`/`temp_tablespaces` também. **Isso sozinho já garante que
   o banco nunca derrube os arquivos dos clientes, nem o contrário.**
2. **Quota por database, medida e aplicada de hora em hora** pelo agente:

```sql
-- MariaDB: tamanho por database
SELECT table_schema, SUM(data_length+index_length) AS bytes
FROM information_schema.tables WHERE table_schema LIKE 'e0%' GROUP BY table_schema;

-- PostgreSQL
SELECT datname, pg_database_size(datname) FROM pg_database WHERE datname LIKE 'e0%';
```

3. **Aplicação gradual** — nunca `DROP`, nunca bloquear leitura:

| Uso da quota | Ação | Efeito no site do cliente |
|---|---|---|
| 80% | e-mail + banner no painel | nenhum |
| 95% | e-mail "faltam X MB" + sugestão de limpeza (revisions do WP, logs, sessões) | nenhum |
| 100% | `REVOKE INSERT, UPDATE, CREATE, ALTER, INDEX ON <db>.* FROM <user>` (MariaDB) / `REVOKE` equivalente + `ALTER DATABASE ... CONNECTION LIMIT` mantido (PG) | site **lê** normal, escrita falha com erro claro; o cliente ainda consegue `DELETE` e `DROP TABLE` para se salvar |
| — | Botão "comprar +1 GB" no painel, add-on de R$ 3/GB/mês, aplica em segundos | — |

A quota padrão por ambiente acompanha o plano: **1 GB** no plano de 512 MB, **3 GB** no de 1 GB,
**10 GB** no de 2 GB. Acima de 10 GB o produto **empurra para o tier dedicado** — uma base de 20 GB num
buffer pool compartilhado de 256 MB é uma experiência ruim para o dono e para os vizinhos.

### 1.10 MariaDB 11 é "MySQL" para quem usa WordPress e Laravel?

**Resposta curta: sim para 97% dos casos, e a exceção é uma só — importar dump feito no MySQL 8.**

**Onde é 100% compatível na prática:**

- **WordPress**: suporte oficial a MariaDB ≥ 10.5; a maioria absoluta da hospedagem compartilhada do mundo
  (cPanel, Plesk, CloudLinux) roda MariaDB há uma década. WooCommerce, Elementor, WPML: todos testados em
  MariaDB. Risco: **nulo**.
- **Laravel**: PDO/`mysql`. Laravel 11+ tem driver `mariadb` próprio (só muda geração de schema —
  `uuid`, `json`, defaults). Eloquent, migrations, queue: idênticos. Risco: **nulo**, desde que o
  `config/database.php` use `'driver' => 'mariadb'` quando o app for Laravel ≥ 11 (o painel escreve isso
  no `.env` gerado: `DB_CONNECTION=mariadb`).
- CTEs, window functions, `JSON_TABLE`, CHECK constraints, `INSTANT ADD COLUMN`, roles, sequences,
  `RETURNING` (MariaDB tem e o MySQL não): tudo presente.
- Symfony/Doctrine, Drupal, Magento 2 (suporta MariaDB 10.6 oficialmente), Moodle, PrestaShop: todos ok.

**Onde NÃO é compatível — lista honesta e completa do que importa:**

| # | Diferença | Impacto real | Mitigação |
|---|---|---|---|
| 1 | **Collation `utf8mb4_0900_ai_ci`** (default do MySQL 8) **não existe no MariaDB** | **Este é o problema.** Um `mysqldump` feito em MySQL 8 falha no import com `Unknown collation`. É ~70% dos tickets previsíveis de migração | O **assistente de importação do painel** reescreve `utf8mb4_0900_ai_ci`→`utf8mb4_uca1400_ai_ci`, `utf8mb4_0900_as_cs`→`utf8mb4_uca1400_as_cs` e remove `/*!80016 ... */` antes de aplicar. É um `sed` de 6 linhas e **precisa existir no MVP** |
| 2 | Tipo `JSON` é `LONGTEXT` com CHECK, não binário | queries de JSON funcionam; performance de `JSON_EXTRACT` em tabela grande é pior | irrelevante em WP/Laravel; documentar |
| 3 | **Multi-valued indexes** sobre arrays JSON (MySQL 8.0.17+) não existem | apps que indexam JSON array | raro; escape = tier dedicado com MySQL 8.4 |
| 4 | `caching_sha2_password` (default MySQL 8) vs `mysql_native_password`/`ed25519` | conectar **ao** MariaDB é mais fácil, não mais difícil | nenhum; é vantagem |
| 5 | `SET PERSIST`, `RESTART`, `CLONE` plugin, `EXPLAIN ANALYZE` em formato JSON | só ferramentas de DBA | não aplicável ao cliente |
| 6 | GTID/replicação incompatível entre os dois | migrar do MySQL para MariaDB é dump+restore, não réplica | já é o procedimento |
| 7 | `information_schema` e `sys` divergem em colunas | ferramentas de monitoramento genéricas | usamos as nossas |
| 8 | Apps que fazem `if (version_compare(mysql_version, '8.0'))` | MariaDB reporta `11.8.x-MariaDB`; a maioria das libs entende, algumas legadas confundem 11.8 > 8.0 e habilitam recurso do MySQL 8 | conhecido em libs antigas; nunca visto em WP/Laravel atuais |
| 9 | `ALTER USER ... IDENTIFIED WITH caching_sha2_password` em scripts copiados de tutorial | erro na hora de criar usuário manual | o painel cria usuário; o cliente não roda esse SQL |
| 10 | `utf8mb3` vs `utf8` (alias) e ordenação de acentos | ordenação de `ç`/`ã` pode diferir em 1 caso raro entre `0900_ai_ci` e `uca1400_ai_ci` | ambas são Unicode 14/9 accent-insensitive; diferenças são de emoji e casos exóticos |

**Isso é risco de suporte?** Sim, mas quantificado e localizado: **um único cenário** (importar dump de
MySQL 8) que se resolve com 6 linhas de `sed` no assistente de importação. O restante é folclore.

**Recomendação, e onde eu discordo levemente da crítica.** A crítica diz "manter o rótulo 'MySQL' na UI".
Eu recomendo **"MySQL-compatível — MariaDB 11.8 LTS"**, com tooltip: *"MariaDB é o mesmo banco que roda em
praticamente toda hospedagem compartilhada. WordPress, Laravel e WooCommerce funcionam sem alteração.
[Vindo do MySQL 8? Leia isto]"*. Motivos:

1. Rotular "MySQL" e entregar MariaDB é o tipo de coisa que **um cliente técnico descobre com
   `SELECT VERSION()` no primeiro dia** e vira desconfiança — o oposto do valor "o padrão é o seguro,
   e a gente conta a verdade" do doc 01.
2. Quem se importa com a diferença é justamente quem sabe o que ela significa, e para esse existe o tier
   dedicado com MySQL 8.4 de verdade — a transparência **vende** o add-on.
3. O custo de ser transparente é uma linha de tooltip; o custo de ser pego é um post no Reddit.

**Ratificação:** MariaDB 11.8 LTS confirmado. A economia de ~300 MB (1 ambiente de 22 = ~4,5% da
capacidade e ~R$ 35/mês por nó de receita) é real e as incompatibilidades são administráveis.

---

## 2. Tier "banco dedicado" (pago)

### 2.1 Quando o cliente precisa

Gatilhos objetivos, mostrados no painel como recomendação automática (não como venda agressiva):

| Gatilho | Medição | Onde aparece |
|---|---|---|
| Base > 10 GB | quota de database (§1.9) em 100% duas vezes no mês | banner em *Banco de dados* |
| Conexões no teto | `MAX_USER_CONNECTIONS` atingido > 20×/dia por 3 dias | banner + e-mail |
| Warden matando queries | > 30 mortes/hora reincidente em 3 dias (§1.8 regra 4) | ticket automático |
| Precisa de MySQL 8.4 **de verdade** (multi-valued index, `SET PERSIST`) | pedido do cliente | página de comparação |
| Precisa de PG 15 ou 16 (app legado) | pedido do cliente | seletor de versão bloqueado (§3) |
| Precisa de `postgis`, `pgvector`, `pg_cron`, `plpython3u` | tentativa de `CREATE EXTENSION` recusada | mensagem de erro com link |
| Exige PITR próprio / isolamento contratual (LGPD, cliente corporativo) | pedido comercial | proposta |

### 2.2 Como é provisionado

Container OCI dedicado no mesmo nó (ou em nó com folga), fora da slice dos ambientes:

```bash
# job db.dedicated.provision  — executado pelo agente
podman volume create veloz-db-0099
podman run -d --name db-ded-0099 \
  --network veloz-br0 --ip 10.60.1.99 \
  --cgroup-parent=veloz-dbded.slice \
  -v veloz-db-0099:/var/lib/mysql:Z \
  -v /etc/veloz/dbded/0099.cnf:/etc/mysql/conf.d/veloz.cnf:ro,Z \
  -e MARIADB_ROOT_PASSWORD_FILE=/run/secrets/root \
  --memory=1g --memory-swap=1g --cpus=1.0 \
  --health-cmd='healthcheck.sh --connect --innodb_initialized' \
  docker.io/library/mariadb:11.8
```

```ini
# /etc/systemd/system/veloz-dbded-0099.slice   (o container roda dentro dela)
[Slice]
MemoryHigh=900M
MemoryMax=1024M
MemorySwapMax=0
CPUWeight=200
IOWeight=200
OOMScoreAdjust=-300
```

Diferenças de configuração em relação ao compartilhado, porque agora o pool cabe no dataset:

- `innodb_flush_method = O_DIRECT` (volta ao padrão — o pool agora é dimensionado)
- `innodb_buffer_pool_size` = 50% da RAM do tier
- `performance_schema = ON` (é do cliente; ele pode ver as próprias métricas)
- `max_connections` = 100 sem threadpool obrigatório
- **binlog/WAL do cliente é só dele ⇒ PITR de verdade** por ambiente (o argumento comercial central)
- Extensões PG liberadas (`postgis`, `pgvector`, `pg_cron`) porque o raio de explosão é o próprio cliente

**Migração do compartilhado para o dedicado, sem perder dado** (job `db.dedicated.migrate`):

```
1. provisiona o container e espera health OK                       ~40 s
2. mariadb-dump --single-transaction --routines --triggers  e0042_app | restore no dedicado   ~1–4 min
3. valida: row count por tabela igual, checksum de 5 tabelas amostradas
4. modo somente-leitura no compartilhado (REVOKE INSERT/UPDATE/DELETE) — janela começa
5. dump incremental do delta (binlog position) OU redump completo se base < 500 MB    ~20–60 s
6. reescreve DSN no .env do ambiente e reinicia php-fpm/app                            ~3 s
7. verifica HTTP 200 + escrita de teste
8. remove o modo somente-leitura; agenda DROP da base compartilhada para D+7
```
Janela de indisponibilidade de escrita: **20 a 90 s** para bases até 2 GB. Anunciada e agendável pelo cliente.

### 2.3 Quanto custa de RAM e quanto se cobra

A regra de ouro do nó (crítica, Achado 0.2): **cada 512 MB residentes custam 1 ambiente vendável de 22**.
Logo, o preço mínimo do tier dedicado é o preço do ambiente que ele desloca, **mais margem** — senão é
melhor vender o ambiente.

| Tier | RAM | `buffer_pool`/`shared_buffers` | Ambientes deslocados | Custo de oportunidade | **Preço** | Margem sobre o deslocamento |
|---|---|---|---|---|---|---|
| **DB-S** | 512 MB | 256 MB | 1 | R$ 35 | **R$ 49/mês** (R$ 0,0681/h) | +40% |
| **DB-M** | 1 GB | 512 MB | 2 | R$ 70 | **R$ 89/mês** (R$ 0,1236/h) | +27% |
| **DB-L** | 2 GB | 1.200 MB | 4 | R$ 140 | **R$ 159/mês** (R$ 0,2208/h) | +14% |
| DB-XL | 4 GB | 2.500 MB | 8 | R$ 280 | **sob consulta / nó próprio** | — |

Quota de disco inclusa: 10 GB (S), 25 GB (M), 60 GB (L); excedente a R$ 3/GB/mês.
Acima de DB-L, a resposta certa não é um container maior — é uma VPS de banco separada, e isso é uma
conversa comercial, não um botão no painel. Escrever isso no catálogo evita vender o que estraga o nó.

**Por que DB-L tem margem menor:** de propósito. O objetivo é que o cliente grande **caiba** no produto em
vez de sair; ele já é o cliente que dá menos ticket por real de receita.

### 2.4 Como aparece no billing

Meter novo, no mesmo motor horário de tudo (`03` §4.2 / doc de billing):

```json
{"meter":"db.dedicated.hour","environment_id":"env_0099","quantity":1,"unit":"hora",
 "attrs":{"tier":"DB-M","engine":"mariadb-11.8","ram_mb":1024},
 "window_start":"2026-08-20T14:00:00Z","window_end":"2026-08-20T15:00:00Z",
 "source_id":"env_0099:db.dedicated.hour:2026-08-20T14:00:00Z"}
```

Na fatura, **linha própria** (nunca embutida no plano — o cliente precisa ver o que está pagando):

```
Ambiente loja.exemplo.com.br         720 h × R$ 0,0486/h  =  R$  35,00
Banco dedicado DB-M (MariaDB 11.8)   720 h × R$ 0,1236/h  =  R$  89,00
Disco de banco excedente 5 GB        720 h × R$ 0,0042/h  =  R$   3,00
```

**Regras de estado, que é onde a maioria dos produtos erra:**

| Situação | Compartilhado | Dedicado |
|---|---|---|
| Ambiente **pausado** | banco continua no ar (compartilhado), paga só `db.gb.hour` | **container para junto**; para de cobrar `db.dedicated.hour`, paga só disco. **É uma vantagem real do tier e deve estar na página de vendas** |
| Ambiente **suspenso** (inadimplência) | conta travada, dado preservado | container parado, dado preservado, cobrança suspensa |
| **Downgrade** para compartilhado | — | job inverso do §2.2; janela de 20–90 s; **não é cobrado** |
| **Cancelamento** | dump final retido 15 d | dump final retido 15 d + volume destruído |

---

## 3. Versão de banco por cliente

O dono quer, para banco, o mesmo que tem para linguagem: um seletor. Aqui a resposta honesta é **não no
compartilhado, sim no dedicado**, e é preciso explicar por quê com números — porque "não" sem número vira
"depois eu implemento".

### 3.1 PostgreSQL 15 e 17 no mesmo nó: dá?

**Tecnicamente, sim e é trivial.** O Debian tem `postgresql-common`, que foi desenhado exatamente para isso:

```bash
apt install postgresql-15 postgresql-17
pg_lsclusters
# Ver Cluster Port Status Owner    Data directory
# 15  main    5433 online postgres /var/lib/postgresql/15/main
# 17  main    5432 online postgres /var/lib/postgresql/17/main
```

**Economicamente, não.** Cada cluster é um postmaster completo:

| Item | 1 cluster | 2 clusters | 3 clusters |
|---|---|---|---|
| RAM em regime | 350 MB | ~620 MB | ~890 MB |
| Ambientes vendáveis perdidos | 0 | **0,6** | **1,1** |
| Receita perdida/mês/nó | R$ 0 | ~R$ 21 | ~R$ 39 |
| Superfície de patch (CVE, upgrade menor) | 1 | 2 | 3 |
| Runbooks a manter | 1 | 2 | 3 |

Um segundo cluster PG num nó custa **R$ 21/mês de receita perdida e o dobro de trabalho de manutenção**
para atender um cliente que provavelmente paga R$ 35. Não fecha.

### 3.2 MariaDB e MySQL "de verdade" lado a lado: dá?

Tecnicamente sim (datadirs e portas diferentes), **operacionalmente é uma armadilha**: no Debian, os
pacotes `mariadb-server` e `mysql-server`/`mysql-community-server` disputam os mesmos caminhos
(`/etc/mysql`, `/usr/bin/mysql`, `/run/mysqld`, unit `mysql.service`) e conflitam em nível de pacote. A
saída seria containerizar um dos dois — e nesse momento **já é o tier dedicado**, por definição.
Custo em RAM: MySQL 8.4 com tuning mínimo não desce de ~400 MB. **Recusado no nó compartilhado.**

### 3.3 O que oferecer e o que recusar

| Pedido | Resposta | Onde |
|---|---|---|
| "Quero MySQL/MariaDB" | **sim** (MariaDB 11.8 LTS) | compartilhado, incluso |
| "Quero PostgreSQL" | **sim** (PG 17) | compartilhado, incluso |
| "Quero PostgreSQL 15 porque meu app antigo exige" | **sim, no tier dedicado** (container `postgres:15`) | DB-S a partir de R$ 49 |
| "Quero MySQL 8.4 de verdade" | **sim, no tier dedicado** (container `mysql:8.4`) | DB-S a partir de R$ 49 |
| "Quero PostgreSQL 13" (EOL nov/2025) | **não.** Rodar banco sem patch de segurança com dado de terceiro é negligência | recusa com data de EOL na tela |
| "Quero MongoDB / Redis / ClickHouse" | fora do escopo do MVP; Redis entra como **módulo** de cache por ambiente (é barato: ~15 MB com `maxmemory`), Mongo/ClickHouse não entram | roadmap |
| "Quero escolher a versão minor (11.8.2 vs 11.8.3)" | **não.** Minor é patch de segurança e é aplicado por nós | política |

**No painel, o seletor existe e mostra a verdade** — é melhor que esconder:

```
Banco de dados
  ◉ MySQL-compatível · MariaDB 11.8 LTS      incluso     [padrão]
  ○ PostgreSQL 17                             incluso
  ─────────────────────────────────────────────────────────
  Precisa de outra versão?  Banco dedicado a partir de R$ 49/mês  →
  ○ MariaDB 11.4 LTS · PostgreSQL 15/16/17 · MySQL 8.4 · PostGIS · pgvector
```

Recusa vira upsell. Ninguém sai com a sensação de que o produto não faz.

### 3.4 Política de versão e EOL — a regra que impede virar o Hostoo

O Hostoo servia **PostgreSQL 10, EOL desde nov/2022**, sem seletor. Isso é uma falha de segurança
silenciosa: CVEs corrigidas upstream que nunca chegam. A política, escrita e **automatizada**:

1. **Nunca rodar versão fora de suporte upstream.** Verificação semanal automática: o agente compara a
   versão instalada contra `endoflife.date/api/{mariadb,postgresql}.json`, e um alerta vira **incidente P2**
   quando faltarem 12 meses para o EOL e **P1** quando faltarem 3.
2. **N e N-1 suportados no dedicado.** Hoje: PG 17 e 16 (e 15 por exceção documentada até nov/2027);
   MariaDB 11.8 e 11.4.
3. **Janela de upgrade de 12 meses** a partir do lançamento da nova LTS. Avisos em **D-90, D-30, D-7, D-1**,
   por e-mail e banner, com link para o teste (§3.5).
4. **Upgrade forçado ao fim da janela**, em janela de manutenção anunciada. Cliente que não pode migrar tem
   uma saída: dedicado com a versão antiga, **enquanto ela tiver suporte upstream**, e nem um dia depois.
5. A versão em uso aparece **sempre** no painel, com a data de fim de suporte ao lado. Transparência é o
   anti-Hostoo.

### 3.5 Mecânica do upgrade (o custo real da política)

**MariaDB minor (11.8.2 → 11.8.3):** `apt upgrade` + `mariadb-upgrade` + restart. Indisponibilidade
**5–20 s** para todos os clientes do nó. Janela: 04:00, mensal, anunciada.

**MariaDB major (11.8 → 12.x LTS, ~2027):** dump completo de todas as bases → `apt` da nova série →
`mariadb-upgrade`. Ou, mais seguro num nó com 22 clientes: **subir a nova versão num container ao lado,
migrar cliente por cliente** (§2.2), e desligar a antiga quando esvaziar. Mais lento, mas com rollback por
cliente e sem janela coletiva. **Recomendado.**

**PostgreSQL major (17 → 18):**

```bash
pg_dropcluster 18 main --stop            # o cluster novo vazio criado pelo pacote
pg_upgradecluster -m upgrade -k 17 main  # -k = hard link: rápido e sem cópia
# 22 bases pequenas: 2 a 5 minutos de indisponibilidade
pg_dropcluster 17 main                   # SÓ depois de validar; com -k não há volta ao 17
```

Com `--link`, **não existe rollback**: se algo der errado, a saída é restaurar o dump. Por isso o
procedimento obrigatório é: dump completo verificado antes → `pg_upgradecluster` → `ANALYZE` de todas as
bases (estatísticas não migram e o primeiro acesso fica lento sem isso) → verificação HTTP de todos os
ambientes. Publicar a janela como **30 min**, executar em 5.

**Quanto isso custa por ano:** 12 janelas de minor (20 s cada) + 1 major a cada 2–4 anos (30 min).
É barato. O caro seria oferecer 3 versões simultâneas — 3× isto, para sempre.

---

## 4. Banco do CONTROL PLANE

### 4.1 Versão, topologia e tuning

**PostgreSQL 17**, instância única na VPS do control plane (sem HA na fase 1 — a crítica e o `03` §1.2
já fecharam isso, e o motivo é forte: **o CP fora do ar não derruba site de cliente**; os nós continuam
servindo com a configuração local, conforme `03` §1.6). O que não pode acontecer é **perder** o banco do
CP: sem ele não há quem é cliente de quem, quem pagou, qual ambiente é de quem, nem as chaves.

VPS do CP: 2–4 vCPU, **8 GB**, 80 GB NVMe (~R$ 80–120/mês). O Postgres pode ser generoso aqui — não
disputa com ambiente de cliente.

```conf
# /etc/postgresql/17/main/conf.d/90-veloz-cp.conf
max_connections                 = 120        # app (pool 20) + jobs (pool 20) + módulos (5×5) + admin
shared_buffers                  = 2GB
effective_cache_size            = 5GB
work_mem                        = 16MB       # consultas de relatório/faturamento agregam mais
maintenance_work_mem            = 512MB
autovacuum_work_mem             = 256MB
wal_buffers                     = 16MB

max_worker_processes            = 8
max_parallel_workers            = 4
max_parallel_workers_per_gather = 2          # AQUI o paralelismo é bem-vindo: relatório de uso mensal
max_parallel_maintenance_workers = 2
jit                             = off        # OLTP + agregações pequenas; JIT só atrapalha

wal_level                       = replica
archive_mode                    = on
archive_command                 = 'pgbackrest --stanza=veloz-cp archive-push %p'
archive_timeout                 = 60s        # ⇒ RPO máximo de 60 s mesmo sem escrita
max_wal_size                    = 4GB
min_wal_size                    = 1GB
checkpoint_timeout              = 15min
checkpoint_completion_target    = 0.9
wal_compression                 = zstd

random_page_cost                = 1.1
effective_io_concurrency        = 200
default_statistics_target       = 200        # partições + colunas de alta cardinalidade

statement_timeout               = 30s        # o painel não tem query legítima de 30 s
idle_in_transaction_session_timeout = 60s
lock_timeout                    = 5s
row_security                    = on

shared_preload_libraries        = 'pg_stat_statements,pg_partman_bgw,auto_explain'
pg_partman_bgw.interval         = 3600
pg_partman_bgw.role             = veloz_partman
pg_partman_bgw.dbname           = velozpanel
auto_explain.log_min_duration   = 3000
auto_explain.log_analyze        = off        # 'on' custa caro; o plano estimado já resolve 90%

log_min_duration_statement      = 500
log_line_prefix                 = '%m [%p] %q%u@%d app=%a tx=%x '
log_checkpoints                 = on
log_lock_waits                  = on
log_autovacuum_min_duration     = 0
track_io_timing                 = on
track_functions                 = pl
```

Extensões: `pg_stat_statements`, `pg_partman`, `pgcrypto`, `uuid-ossp` (ou `uuidv7()` nativo do PG 18 no
futuro), `citext`, `btree_gin`.

**Se a VPS do CP for de 4 GB** (opção mais barata): `shared_buffers=1GB`, `effective_cache_size=2500MB`,
`work_mem=8MB`, `maintenance_work_mem=256MB`, `max_connections=80`. Funciona bem até ~200 tenants.

### 4.2 RLS multi-tenant — o desenho que não vaza

O especialista Node/Next.js registrou isto como **R4, "o pior risco do produto"**. Concordo, e a razão é
que RLS parece funcionar mesmo quando está furada. Sete buracos concretos e a defesa de cada um:

#### Buraco 1 — `USING` sem `WITH CHECK`

Uma policy `FOR ALL USING (tenant_id = ...)` filtra **leitura**, mas `WITH CHECK` é o que restringe
**escrita**. Sem ele, o tenant A pode `INSERT` uma linha com `tenant_id` do tenant B (e depois nem enxerga
o que criou — o bug fica invisível até a auditoria).

```sql
CREATE POLICY tenant_isolation ON environments
  FOR ALL
  TO vp_app
  USING      (tenant_id = vp.current_tenant())
  WITH CHECK (tenant_id = vp.current_tenant());
```

#### Buraco 2 — o dono da tabela ignora RLS

`ENABLE ROW LEVEL SECURITY` **não se aplica ao owner** da tabela. Se a aplicação conecta com o mesmo role
que criou as tabelas (o que toda migration gerada faz por padrão), a RLS **está desligada na prática**.

Duas defesas, ambas obrigatórias:

```sql
-- (a) owner separado: migrations rodam como vp_owner; a aplicação é vp_app e não é dona de nada
CREATE ROLE vp_owner NOLOGIN;
CREATE ROLE vp_app   LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO vp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vp_app;

-- (b) FORCE: vale até para o owner
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE environments FORCE  ROW LEVEL SECURITY;
```

#### Buraco 3 — GUC ausente vira comportamento indefinido

`current_setting('vp.tenant_id', true)` devolve `NULL` quando não setado, e `tenant_id = NULL` é `NULL`
(falha fechada — bom). Mas se alguém setar string vazia, o `::uuid` **levanta exceção** e o endpoint
devolve 500 sem explicação. Pior: alguém pode escrever a policy com `COALESCE(...,'...')` e abrir tudo.
A defesa é uma função única, usada por **todas** as policies:

```sql
CREATE OR REPLACE FUNCTION vp.current_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER AS $$
DECLARE v text;
BEGIN
  v := current_setting('vp.tenant_id', true);
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'vp.tenant_id nao definido: query fora de withTenant()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::uuid;
END $$;
REVOKE ALL ON FUNCTION vp.current_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vp.current_tenant() TO vp_app, vp_admin;
```

Assim, **query sem contexto explode em vez de retornar zero linhas** — e um `SELECT` que retorna zero
linhas por acidente é o bug mais difícil de achar que existe.

#### Buraco 4 — `SET` em vez de `SET LOCAL` com pool de conexões

`SET vp.tenant_id` (sessão) **vaza para a próxima requisição** que pegar a mesma conexão do pool. Isso é
vazamento entre clientes por construção. Só existe uma forma correta:

```ts
// packages/db/withTenant.ts — o ÚNICO caminho de acesso ao banco na aplicação
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(..., true) = LOCAL: morre no fim da transação. Sobrevive a pgbouncer transaction mode.
    await tx.execute(sql`SELECT set_config('vp.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
```
Regras de lint já previstas pelo doc 05, aqui reafirmadas como **bloqueio de merge**: proibido importar
`db` fora de `packages/db`; proibido `SET ` fora de `set_config(...,true)`; proibido `db.execute` fora de
`withTenant`/`withAdmin`.

#### Buraco 5 — views e funções `SECURITY DEFINER`

Uma view sobre tabela com RLS roda com os direitos do **dono da view** — RLS do chamador some.
No PG 15+ existe a correção e ela é **obrigatória em toda view do projeto**:

```sql
CREATE VIEW v_environment_usage WITH (security_invoker = true, security_barrier = true) AS ...;
```
E: **`SECURITY DEFINER` é proibido** no schema da aplicação. Se um dia for inevitável, exige
`SET search_path = pg_catalog, pg_temp` na função e revisão humana registrada na ADR.

#### Buraco 6 — partições

Em tabela particionada, a RLS da **partição** é o que vale quando alguém acessa a partição diretamente
(`usage_events_2026_08`). Se a policy só existe no pai, um `SELECT` direto na partição vaza tudo.
Como as partições são criadas por automação (`pg_partman`), a defesa vai no **template**:

```sql
-- a tabela-template do pg_partman carrega índices, RLS e policies para toda partição filha
CREATE TABLE partman_tpl.usage_events_tpl (LIKE usage_events INCLUDING ALL);
ALTER TABLE partman_tpl.usage_events_tpl ENABLE ROW LEVEL SECURITY;
ALTER TABLE partman_tpl.usage_events_tpl FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON partman_tpl.usage_events_tpl
  FOR ALL TO vp_app USING (tenant_id = vp.current_tenant()) WITH CHECK (tenant_id = vp.current_tenant());
```
E, cinto e suspensório: `REVOKE ALL ON ALL TABLES IN SCHEMA partitions FROM vp_app` — a aplicação só
acessa pelo pai.

#### Buraco 7 — o caminho administrativo

O super admin precisa de `BYPASSRLS`. Isso é aceitável **desde que o caminho seja único, estreito e
auditado na mesma transação**:

```ts
export async function withAdmin<T>(actor: Actor, reason: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!reason || reason.length < 10) throw new Error('withAdmin exige justificativa');
  return adminDb.transaction(async (tx) => {
    await tx.insert(auditLogs).values({ actorId: actor.id, action: 'admin.bypass_rls', reason, ... });
    return fn(tx);            // se o fn falhar, o audit_log some junto — é a mesma transação
  });
}
```
> Nota deliberada: registrar a auditoria **na mesma transação** significa que uma operação revertida não
> deixa rastro. É a escolha certa aqui (evita ruído de tentativas abortadas), mas exige que o
> **acesso ao `withAdmin`** também seja logado fora da transação, no log estruturado da aplicação. Ambos.

#### O teste que impede a regressão (obrigatório no CI)

```sql
-- FALHA O BUILD SE RETORNAR QUALQUER LINHA
SELECT c.relname AS tabela_sem_rls_correta
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','partitions')
  AND c.relkind IN ('r','p')
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  AND ( NOT c.relrowsecurity
     OR NOT c.relforcerowsecurity
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd = '*' AND p.polwithcheck IS NULL)
      );

-- E: nenhuma role de aplicação pode ter BYPASSRLS ou SUPERUSER
SELECT rolname FROM pg_roles WHERE rolname IN ('vp_app') AND (rolbypassrls OR rolsuper);

-- E: nenhuma view sem security_invoker sobre tabela com RLS
SELECT c.relname FROM pg_class c WHERE c.relkind='v'
  AND NOT COALESCE((c.reloptions::text LIKE '%security_invoker=true%'), false);
```

Mais o teste funcional que o doc 05 já exigiu (2 tenants, cross-read com `vp_app`, esperar 0 linhas),
**estendido**: cross-**write** (INSERT com tenant alheio deve dar erro), cross-read por dentro de um
sidecar de módulo, e query sem `withTenant` deve levantar `insufficient_privilege`.

### 4.3 Particionamento, retenção e o tamanho real do banco

Três tabelas crescem sem limite e são as únicas que precisam de partição:

| Tabela | Chave | Granularidade | Volume estimado (66 ambientes) | Retenção |
|---|---|---|---|---|
| `usage_events` | `window_start` | **mensal** | 66 env × 6 meters × 24 h × 30 d ≈ **285k linhas/mês** ≈ 60 MB/mês | **92 dias** cruas; agregado em `usage_rollups` para sempre |
| `job_logs` | `ts` | **diária** | 300 jobs/dia × 40 linhas ≈ 12k/dia ≈ 4 MB/dia | **30 dias** |
| `audit_logs` | `created_at` | **mensal** | ~20k linhas/mês ≈ 15 MB/mês | **24 meses quentes** + export para o object storage; total **5 anos** (prazo de guarda fiscal/LGPD) |

`usage_rollups`, `invoices`, `transactions` **não** são particionadas: crescem devagar e são consultadas
por período arbitrário.

```sql
-- pg_partman: criação e manutenção automáticas
SELECT partman.create_parent(
  p_parent_table    => 'public.usage_events',
  p_control         => 'window_start',
  p_interval        => '1 month',
  p_template_table  => 'partman_tpl.usage_events_tpl',
  p_premake         => 3);
UPDATE partman.part_config
   SET retention = '92 days', retention_keep_table = false, retention_keep_index = false,
       infinite_time_partitions = true
 WHERE parent_table = 'public.usage_events';

SELECT partman.create_parent('public.job_logs','ts','1 day',
       p_template_table=>'partman_tpl.job_logs_tpl', p_premake=>7);
UPDATE partman.part_config SET retention='30 days', retention_keep_table=false
 WHERE parent_table='public.job_logs';

SELECT partman.create_parent('public.audit_logs','created_at','1 month',
       p_template_table=>'partman_tpl.audit_logs_tpl', p_premake=>3);
UPDATE partman.part_config SET retention='24 months', retention_keep_table=true  -- DETACH, não DROP
 WHERE parent_table='public.audit_logs';
```

**Auditoria não se apaga: exporta-se.** Job mensal `cp.audit.archive`: a partição desanexada de 24 meses
atrás vira `audit_logs_2024_08.jsonl.zst`, é enviada ao bucket **compliance** (object lock, 5 anos) e só
então a tabela é dropada. O registro do arquivamento vai para `audit_archives` (nome do objeto, sha256,
contagem de linhas, período) — sem isso, provar depois que o dado existiu é impossível.

**Tamanho projetado do banco do CP:**

| Momento | Dados | Índices | WAL/retenção pgBackRest | Total no disco |
|---|---|---|---|---|
| Fase 1 (5 ambientes, 3 meses) | ~120 MB | ~60 MB | ~2 GB | **< 3 GB** |
| 66 ambientes, ano 1 | ~1,4 GB | ~700 MB | ~8 GB | **~10 GB** |
| 66 ambientes, ano 3 | ~3 GB | ~1,5 GB | ~8 GB | **~13 GB** |

Ou seja: o disco de 80 GB da VPS do CP é folgado por anos, **desde que as três partições tenham retenção**.
Sem retenção, `job_logs` sozinha passa de 40 GB em 3 anos.

### 4.4 PITR com pgBackRest

Escolha entre pgBackRest e WAL-G: **pgBackRest**, por três motivos operacionais (não por performance):
retenção declarativa que ele mesmo aplica (`repo1-retention-full`), `restore --delta` (restaura só o que
divergiu — muda o RTO), e `verify`/`check` como comandos de primeira classe. WAL-G é ótimo e mais leve,
mas deixa retenção e verificação por sua conta — e "por sua conta" com 1 operador significa "nunca".

```ini
# /etc/pgbackrest/pgbackrest.conf
[global]
repo1-type                   = s3
repo1-s3-endpoint            = s3.us-west-004.backblazeb2.com
repo1-s3-bucket              = veloz-cp-backup
repo1-s3-region              = us-west-004
repo1-s3-uri-style           = path
repo1-path                   = /pgbackrest
repo1-cipher-type            = aes-256-cbc
repo1-cipher-pass            = <injetado pelo systemd LoadCredential, NUNCA neste arquivo>
repo1-retention-full         = 4          # 4 fulls semanais = 28 dias de janela de PITR
repo1-retention-full-type    = count
repo1-retention-diff         = 14
repo1-bundle                 = y          # agrupa arquivos pequenos: menos requisições no S3 = mais barato
repo1-block                  = y          # incremental por bloco (pgBackRest 2.46+)
compress-type                = zst
compress-level               = 6
process-max                  = 3
start-fast                   = y
archive-async                = y
archive-get-queue-max        = 1GiB
archive-push-queue-max       = 4GiB       # se o S3 sumir, o WAL acumula até 4 GiB e ENTÃO falha (não enche o disco)
log-level-console            = info
log-level-file               = detail

[veloz-cp]
pg1-path                     = /var/lib/postgresql/17/main
pg1-port                     = 5432
```

```ini
# /etc/systemd/system/pgbackrest-full.timer   → domingo 02:00
# /etc/systemd/system/pgbackrest-diff.timer   → seg–sáb 02:00
# /etc/systemd/system/pgbackrest-verify.timer → quarta 05:00  (pgbackrest verify --stanza=veloz-cp)
```

| Garantia | Valor | Como se sustenta |
|---|---|---|
| **RPO** | **≤ 60 s** | `archive_timeout=60s` força fechamento de WAL mesmo sem escrita; `archive-async` empurra continuamente |
| **Janela de PITR** | **28 dias** | 4 fulls semanais retidos |
| **RTO (CP inteiro, VPS nova)** | **≤ 30 min** | §4.5 |
| **RTO (mesma VPS, banco corrompido)** | **≤ 10 min** | `restore --delta` só traz o divergente |

**Segunda linha de defesa, barata e independente da ferramenta:** `pg_dump -Fc` diário do banco inteiro
(~300 MB comprimido no ano 1) para o mesmo repositório restic dos ambientes, retenção 30 dias. Serve para
o cenário em que o **próprio pgBackRest** está com problema (versão, cifra, corrupção do repo) — e um
`pg_dumpall --globals-only` junto, porque roles e senhas não estão no `pg_dump` do banco.

### 4.5 Runbook de restore do control plane — alvo 30 min

```bash
# ── T+0  Decisão. Critério: CP indisponível > 10 min sem causa identificada, ou perda de dado confirmada.
#         LEMBRAR: sites dos clientes CONTINUAM NO AR. Não há pressa suicida. Fazer certo.

# ── T+2  VPS nova (provedor B, imagem Debian 13), Ansible do bootstrap do CP
ansible-playbook -i inventory/prod playbooks/control-plane.yml --limit cp-new
#        (instala PG 17, pgbackrest, o painel, nginx, certificados; NÃO inicia o painel)

# ── T+8  Credenciais do repositório: da chave mestra offline (§5.8), nunca do servidor morto
systemd-creds encrypt --name=pgbackrest-pass /dev/stdin /etc/credstore.encrypted/pgbackrest-pass

# ── T+10 Restore
systemctl stop postgresql@17-main
rm -rf /var/lib/postgresql/17/main/*
sudo -u postgres pgbackrest --stanza=veloz-cp --type=time \
     --target='2026-08-20 14:05:00-03' --target-action=promote restore
#        (sem --type: restaura o mais recente. COM alvo: PITR para antes do incidente)

# ── T+18 Subir e conferir
systemctl start postgresql@17-main
sudo -u postgres psql -c "SELECT pg_is_in_recovery();"        # deve virar false após promote
sudo -u postgres psql velozpanel -c "SELECT max(created_at) FROM audit_logs;"   # até onde chegou
sudo -u postgres psql velozpanel -f /opt/veloz/sql/rls-selftest.sql             # ZERO linhas
sudo -u postgres psql velozpanel -c "SELECT count(*) FROM tenants; SELECT count(*) FROM environments;"

# ── T+22 Apontar o painel e os agentes
velozctl cp promote --host cp-new.veloz.app      # atualiza DNS (TTL 60) e a CA/mTLS se mudou
systemctl start veloz-panel veloz-jobs
# agentes reconectam sozinhos (long-poll com backoff); confirmar em 2 min:
velozctl nodes status                              # 3/3 online

# ── T+26 Verificação funcional obrigatória antes de declarar resolvido
#   [ ] login no painel com 2FA
#   [ ] listar ambientes de 2 tenants diferentes e conferir que um não vê o outro
#   [ ] criar um job de teste (env.noop) e ver executar no nó
#   [ ] conferir saldo/faturas de 3 clientes contra o último extrato enviado por e-mail
#   [ ] REconciliar metering: eventos do buffer de 72 h dos agentes reentram por idempotência (source_id)

# ── T+30 Comunicar. Se houve PITR com perda de janela, dizer QUAL janela se perdeu.
```

**O que se perde num PITR de 60 s e como se recupera:** eventos de uso (voltam do buffer de 72 h dos
agentes, por `source_id` idempotente), jobs em voo (o agente reporta de novo; jobs são idempotentes por
`03` §5.5), sessões de login (usuário refaz login). **O que não volta:** webhooks de pagamento recebidos
na janela — por isso o runbook manda **reconciliar com o PSP** (`GET /payments?since=`) como passo T+28.
Isso precisa ser um comando: `velozctl billing reconcile --since '2026-08-20T14:00Z'`.

**Teste trimestral obrigatório**: executar este runbook inteiro numa VPS descartável, cronometrando.
O `03` R1 promete "testado trimestralmente" e ninguém tinha dono — **o dono é o operador (Tiago), e o
resultado vai para `docs/registro-de-testes-de-restore.md` com data e duração medida.**

---

## 5. BACKUP — o item que mais pode matar o negócio

> Premissa que organiza tudo o que vem abaixo: **o produto não vende backup, vende restore.** Backup é
> custo; restore é o produto. Toda decisão desta seção é tomada olhando para o momento em que um cliente
> liga desesperado, não para o momento em que o cron roda.

### 5.1 Estratégia 3-2-1-1-0, com o orçamento que existe

A regra clássica 3-2-1 é insuficiente para o cenário que mata: ransomware que apaga o backup junto.
A versão que se aplica é **3-2-1-1-0**: 3 cópias, 2 tecnologias/destinos, 1 fora do site,
**1 imutável**, **0 erros verificados**.

| Cópia | Onde | Conteúdo | Retenção | Para que serve | Custo |
|---|---|---|---|---|---|
| **0** | dado vivo no nó | tudo | — | não é backup | — |
| **1** | `/var/backups/veloz` no próprio nó (partição XFS própria, 20 GB) | repositório restic local dos ambientes daquele nó | **48 h** | "apaguei o `wp-config.php`" → restore em segundos, **sem egress** | R$ 0 |
| **2** | **Backblaze B2**, bucket `veloz-prod`, **Object Lock governance 30 d** | tudo (§5.4) | 48 h horário · 14 diários · 8 semanais · 6 mensais | o backup de verdade. Restore de arquivo, banco, ambiente, nó | ver §5.5 |
| **3** | **Magalu Cloud (BR)**, bucket `veloz-br-cold`, Cold Instant, **Object Lock compliance 90 d** | `restic copy` semanal do repositório | 4 semanais · 3 mensais | (a) morte do provedor B2 / conta suspensa; (b) dado no Brasil para LGPD; (c) **compliance mode = nem a conta raiz apaga** | ver §5.5 |

Duas tecnologias distintas, como manda a regra: **restic** (ambientes e bancos de cliente) e
**pgBackRest** (control plane). Não é purismo: são formatos, binários e chaves diferentes; um bug de
formato do restic não leva junto o banco que sabe quem é cliente de quem.

**Por que não uma cópia num segundo nó nosso.** Tentador (banda entre provedores é o custo) e errado:
os 3 nós compartilham o mesmo painel, a mesma chave de agente e o mesmo operador. Comprometeu o painel,
comprometeu os 3. Backup precisa estar num **domínio de confiança diferente** — outra conta, outro
provedor, outra credencial, outro fator de autenticação.

### 5.2 Ferramenta: restic, borg ou kopia

| Critério | **restic 0.18** | borg 2 | kopia |
|---|---|---|---|
| Object storage nativo | **sim** (S3, B2, Azure, GCS, rclone) | **não** — precisa de `borg serve` por SSH ou de um mount rclone/sshfs (frágil, e é onde as pessoas perdem backup) | sim |
| Deduplicação | CDC (Rabin), global no repositório | CDC, um pouco melhor em VM/imagem | CDC, comparável |
| Compressão | zstd (desde 0.14) | lz4/zstd | zstd |
| Criptografia | AES-256-CTR + Poly1305, **sempre ligada**, chave derivada por scrypt | AES-256, opcional | AES-256/ChaCha20 |
| Velocidade de restore | ok (o mais lento dos três) | boa | **melhor** (20–40% mais rápido, upload/download paralelo) |
| Convive com Object Lock | **sim, com desenho de duas identidades** (§5.6) | não (precisa reescrever segmentos) | parcial |
| Tamanho do ecossistema / respostas às 3h da manhã | **muito maior** | grande | menor |
| Binário único, zero dependência | **sim** | não (Python) | sim |
| Ponto fraco real | consumo de RAM no `prune` de repositório grande; restore mais lento | não serve para S3 | menos gente já viu o seu problema |

**Escolha: restic.** O desempate não é técnico, é operacional: com 1 operador, o valor de "milhares de
pessoas já debugaram exatamente este erro" supera 30% de velocidade de restore. O ponto fraco do restic
(RAM no `prune`) é **anulado pelo desenho de repositório por ambiente** — cada repo tem 3–5 GB, o `prune`
é trivial. E o ponto fraco do restore lento é irrelevante em repositórios de 4 GiB restaurados em paralelo.

Borg está **eliminado** por não falar S3 nativamente: a gambiarra de rclone-mount é exatamente o tipo de
peça que funciona por 8 meses e falha na noite do incidente.

**Gatilho de revisão:** se um dia o RTO do nó inteiro (§5.9) medido passar de 4 h por causa da velocidade
de restore, migrar para kopia. Guardar isto como ADR com gatilho, não como "avaliar depois".

### 5.3 Layout de repositórios — um por ambiente

| | Repo por **nó** | **Repo por ambiente** (escolhido) |
|---|---|---|
| Dedup entre ambientes (WordPress core repetido 22×) | **sim**, economiza ~40% | não |
| Economia real | ~112 GiB de 280 GiB ⇒ **R$ 4/mês** | — |
| Restore de 1 cliente | precisa filtrar snapshots de 22 clientes | direto |
| Chave vazada do nó | **lê o backup de 22 clientes** | lê o de 1 |
| Apagar de verdade o dado de 1 cliente (LGPD art. 18) | impossível sem reescrever o repo dos outros | `restic forget --unsafe` do repo inteiro + `rm` do prefixo |
| `prune` | pesado, trava tudo, RAM alta | 5 s por repo, paralelizável |
| Vazamento sutil por dedup | um cliente pode inferir a existência de dado de outro pelo tempo de upload | não existe |

**Decisão: repo por ambiente.** R$ 4/mês não compra o risco de uma chave ler tudo, nem compra a
capacidade de cumprir um pedido de exclusão da LGPD.

```
b2:veloz-prod:/envs/env-0042/            ← repositório restic do ambiente 0042
   ├─ config, keys/, index/, snapshots/, data/
b2:veloz-prod:/nodes/n1/                 ← /etc do nó, inventário, hashes de imagem
b2:veloz-cp-backup:/pgbackrest/          ← control plane (bucket e credencial SEPARADOS)
b2:veloz-vault:/secrets/                 ← bundle de segredos, cifrado com a chave mestra offline
                                            (Object Lock COMPLIANCE 90 d, bucket separado)
```

Tags do restic em todo snapshot — é o que torna o restore por escopo possível:
`--tag env:0042 --tag kind:files|db-mysql|db-pg|config --tag node:n1 --tag plan:512 --tag trigger:cron|prechange|manual`

### 5.4 O que é backup, exatamente

| # | Item | Ferramenta | Frequência | Retenção | Observação crítica |
|---|---|---|---|---|---|
| 1 | **Arquivos do ambiente** (`/srv/env/<id>/`) | restic | diário 03:00 (jitter de 0–50 min por ambiente) + **antes de toda operação destrutiva** | 14 d / 8 sem / 6 meses | exclusões em §5.4.1 |
| 2 | **Banco do cliente (MariaDB)** | `mariadb-dump --single-transaction --routines --triggers --events --hex-blob` → zstd → restic | **horária** | 48 h horários, depois consolida em diários | `--single-transaction` só é consistente em InnoDB; tabela MyISAM legada exige `--lock-tables` — o script detecta e avisa |
| 3 | **Banco do cliente (PostgreSQL)** | `pg_dump -Fc -Z0` → zstd → restic | **horária** | idem | `-Fc` permite restore seletivo de tabela |
| 4 | **Roles/grants dos bancos do nó** | `pg_dumpall --globals-only` + `mysql.global_priv` | diária | 30 d | sem isto, o restore devolve dado sem quem pode lê-lo |
| 5 | **Banco do control plane** | pgBackRest (full/diff/WAL) + `pg_dump` diário redundante | contínuo | 28 d PITR | §4.4 |
| 6 | **Configuração dos nós** (`/etc/veloz`, `/etc/nginx/veloz`, `/etc/nftables.conf`, units, `pg_hba`, `my.cnf`) | restic | diária | 30 d | **a fonte de verdade é o Ansible + o banco do CP**; este backup é para forense e para restaurar mais rápido que reprovisionar |
| 7 | **Segredos** (chaves mTLS da CA, conta ACME, chaves das APIs de PSP, chaves de repositório restic, credenciais B2/Magalu, seed de 2FA de serviço) | export cifrado com **age** → bucket `veloz-vault` | semanal + a cada mudança | 12 versões | §5.8. **É o item que decide se o negócio volta ou não** |
| 8 | **Certificados TLS** | dentro do item 6 | diária | 30 d | os certificados são regeneráveis; a **conta ACME** não (rate limit do Let's Encrypt: 5 duplicados/semana) |
| 9 | **Imagens OCI** | **não** | — | — | regeneráveis a partir do `Containerfile` em git; o que se guarda é o **digest** por ambiente em `environments.image_digest`, para restaurar idêntico |
| 10 | **Logs de acesso** | só os 30 d correntes, junto com o item 1 | — | 30 d | declarado ao cliente: log não é backup de longo prazo |
| 11 | **E-mail** | fora do MVP | — | — | quando entrar, é outro documento |

#### 5.4.1 Exclusões — e por que exclusão silenciosa é perigosa

```
# /etc/veloz/backup/excludes-default.txt
/srv/env/*/tmp/
/srv/env/*/var/cache/
/srv/env/*/.cache/
/srv/env/*/app/storage/framework/cache/
/srv/env/*/app/storage/logs/*.log
/srv/env/*/wp-content/cache/
/srv/env/*/wp-content/uploads/backwpup*/       # backup dentro do backup: recursão de custo
/srv/env/*/wp-content/ai1wm-backups/
*.sock
*.pid
core.[0-9]*
```

**`node_modules` e `vendor` NÃO são excluídos por padrão.** É a decisão contraintuitiva certa: excluí-los
economiza ~150 MB por ambiente Node (R$ 0,60/mês nos 66 ambientes) e transforma um restore de 8 min num
restore que **depende de `npm ci` funcionar 2 anos depois**, com registry, versão de Node e binário nativo
de 2026. Já vi restaurar e não subir por isso. Regra: exclui-se `node_modules` **apenas** se o ambiente
tiver `package-lock.json` **e** o cliente marcar a opção, e nesse caso o snapshot grava
`restore_hooks: ["npm ci --omit=dev"]` nos metadados e o restore executa automaticamente.

**Toda exclusão aparece na UI**, em *Backup → O que é salvo*, com o tamanho economizado. Exclusão que o
cliente não conhece é a origem do pior ticket que existe ("vocês não tinham o meu cache de sessão").

#### 5.4.2 O script do dump horário (o coração da emenda 2 da crítica)

```bash
#!/bin/bash
# /usr/local/sbin/veloz-db-dump  — systemd timer horário, com jitter por ambiente
set -euo pipefail
ENV_ID="$1"; ENGINE="$2"; DB="$3"
WORK="$(mktemp -d -p /var/tmp/veloz-dump)"; trap 'rm -rf "$WORK"' EXIT
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

case "$ENGINE" in
  mysql)
    nice -n 10 ionice -c2 -n7 mariadb-dump \
      --single-transaction --quick --routines --triggers --events --hex-blob \
      --set-gtid-purged=OFF --column-statistics=0 --no-tablespaces \
      --default-character-set=utf8mb4 "$DB" \
      | zstd -T2 -3 -o "$WORK/${DB}.sql.zst"
    # manifesto de verificação: é o que o teste de restore semanal confere
    mariadb -N -B -e "SELECT table_name, table_rows FROM information_schema.tables
                      WHERE table_schema='$DB' ORDER BY 1" > "$WORK/${DB}.rowcounts.tsv"
    ;;
  pg)
    nice -n 10 ionice -c2 -n7 pg_dump -Fc -Z0 -h 10.60.0.1 -U veloz_admin "$DB" \
      | zstd -T2 -3 -o "$WORK/${DB}.dump.zst"
    psql -qAtX -h 10.60.0.1 -U veloz_admin -d "$DB" -c "
      SELECT relname||E'\t'||n_live_tup FROM pg_stat_user_tables ORDER BY 1" > "$WORK/${DB}.rowcounts.tsv"
    ;;
esac

sha256sum "$WORK"/* > "$WORK/SHA256SUMS"
restic -r "$(veloz-repo-url "$ENV_ID")" backup "$WORK" \
  --tag "env:$ENV_ID" --tag "kind:db-$ENGINE" --tag "db:$DB" --tag "stamp:$STAMP" \
  --host "node-$(hostname -s)" --no-scan --limit-upload 20000   # 20 MB/s: não engasga a borda

velozctl event emit backup.db.done --env "$ENV_ID" --engine "$ENGINE" --db "$DB" \
  --bytes "$(stat -c%s "$WORK"/*.zst)" --duration "$SECONDS"
```

Custo de I/O medido esperado: base de 300 MB ⇒ dump em 4–8 s, ~30 MB comprimidos, e o restic sobe ~5–10 MB
por hora depois da dedup. Para 22 ambientes: **< 3 min de trabalho por hora no nó**, escalonado com jitter
para não colidir. **Ambiente pausado há > 24 h: cai para 1×/dia** (nada muda; o restic dedupa para ~0).

### 5.5 Custo em R$/mês — a conta completa

**Volume de dados (fonte: perfis do `04` §2.3 e dedup típica do restic de 60–75% em servidor web):**

| Item | Fase 1 (5 ambientes) | Maturidade (66 ambientes) |
|---|---|---|
| Arquivos por ambiente (real ~3 GB → 1ª snapshot ~1,3 GiB + deltas) | — | — |
| **Repositório por ambiente em regime** | ~3,5 GiB | ~4 GiB |
| Subtotal ambientes | **17,5 GiB** | **264 GiB** |
| Dumps de banco (dedup entre horas é altíssima) | incluso acima | incluso acima |
| Control plane (pgBackRest, 4 fulls + WAL) | ~3 GiB | ~9 GiB |
| Config dos nós | ~0,3 GiB | ~1 GiB |
| Vault de segredos (12 versões, KB cada) | ~0 | ~0 |
| **Total cópia 2 (B2)** | **~21 GiB** | **~274 GiB** |
| **Total cópia 3 (Magalu, retenção menor)** | **~15 GiB** | **~190 GiB** |

**Sobrecusto do Object Lock.** Com lock de 30 dias e retenção diária de 14, os pacotes que o `prune`
gostaria de apagar ficam presos até completar 30 dias. Efeito medido em repositórios semelhantes:
**+15 a 20% de armazenamento**. Aplicado: B2 vai de 274 para **~320 GiB**.

**Preços (ago/2026, câmbio R$ 5,50/US$):**

| Provedor | Armazenamento | Egress | Object Lock | Veredito |
|---|---|---|---|---|
| **Backblaze B2** | US$ 6,95/TB/mês ≈ **R$ 0,0373/GiB** | **grátis até 3× o armazenado/mês**, depois US$ 0,01/GB | **sim, S3 nativo (governance + compliance)** | **cópia 2** |
| **Magalu Cloud Standard** | R$ 0,10/GiB | R$ 0,10/GiB | sim | caro para a cópia principal |
| **Magalu Cloud Cold Instant** | **R$ 0,06/GiB** | R$ 0,20/GiB | sim | **cópia 3** — dado no BR, egress só em desastre |
| Wasabi | US$ 7,99/TB (R$ 0,043/GiB) | sem taxa | sim | **recusado**: cobrança mínima de **90 dias por objeto** briga de frente com `prune` frequente — na prática paga-se 3 meses por dado apagado em 14 dias, o que **dobra** o custo real |
| Hetzner Storage Box BX11 (1 TB) | €3,81/mês ≈ **R$ 23/mês fixo** (R$ 0,022/GiB a 1 TB) | grátis | **não tem** (só snapshot + sub-conta read-only) | **recusado como cópia imutável**; aceitável como cópia 4 opcional se um dia o volume explodir. Fora do BR ⇒ cláusula de transferência internacional no DPA |

**Fatura mensal — fase 1 (5 ambientes):**

| Linha | Cálculo | R$/mês |
|---|---|---|
| B2 armazenamento | 21 GiB × 1,18 (lock) × R$ 0,0373 | **0,92** |
| B2 transações (classe B+C: restic faz muitos objetos pequenos; `--pack-size 32M` reduz) | ~300k ops | **0,80** |
| Magalu Cold armazenamento | 15 GiB × R$ 0,06 | **0,90** |
| Egress (restores do mês) | dentro da franquia B2 | **0,00** |
| **Total** | | **≈ R$ 2,60/mês** |

**Fatura mensal — maturidade (66 ambientes, 3 nós lotados):**

| Linha | Cálculo | R$/mês |
|---|---|---|
| B2 armazenamento | 320 GiB × R$ 0,0373 | **11,94** |
| B2 transações | ~4 M ops/mês (66 env × 24 dumps/dia + diários) | **6,00** |
| Magalu Cold armazenamento | 190 GiB × R$ 0,06 | **11,40** |
| Egress de restore (média de 2 restores de ambiente/mês) | 8 GiB, dentro da franquia de 960 GiB do B2 | **0,00** |
| **Total** | | **≈ R$ 29,34/mês** |

> **R$ 29/mês para 66 ambientes = R$ 0,45 por ambiente/mês = 1,3% da receita de R$ 35.**
> Confirma o número da crítica (R$ 26) e mostra que **backup não é o problema de custo deste negócio.**
> O que custa é não ter.

**Banda das VPS** (Achado 6.4 da crítica): upload de backup em regime ≈ 66 × 150 MB/dia = **~300 GB/mês**
somados nos 3 nós (100 GB/nó). Contra cotas típicas de 2–20 TB, é 0,5–5%. **Não é gargalo.** O que precisa
de alerta é o restore de nó inteiro: 88 GiB de **download**, geralmente não tarifado, mas a verificar por
provedor e anotar em `nodes.bandwidth_quota_gb` / `nodes.bandwidth_ingress_billed`.

### 5.6 Object Lock / imutabilidade — o cenário de morte

**O cenário:** invasor entra pelo painel (molde CyberPanel/PSAUX: 22.000 servidores em 2024), obtém as
credenciais que o agente usa para o backup, roda `restic forget --prune --keep-last 0` em todos os
repositórios, **depois** cifra os dados. Backup e produção morrem no mesmo minuto. Nenhum documento do
Ciclo 1 tratava disso — a crítica levantou (D3/D4) e aqui é resolvido.

**Desenho de duas identidades. Esta é a parte que precisa ser implementada exatamente assim.**

| Identidade | Onde vive | Permissões B2 | O que consegue fazer | O que NÃO consegue |
|---|---|---|---|---|
| **`veloz-node-writer`** (uma por nó) | no nó, em tmpfs, entregue pelo CP a cada job, TTL 24 h | `listBuckets`, `listFiles`, `readFiles`, `writeFiles` — **sem `deleteFiles`**, **sem `bypassGovernance`** | `restic backup`, `restic restore`, `restic check` | `forget --prune`, apagar objeto, apagar versão, encurtar retenção |
| **`veloz-warden`** | **fora dos nós e fora do control plane** — GitHub Actions com OIDC + secret, ou uma VPS mínima de R$ 20 sem nada mais, ou a estação do operador | `deleteFiles` + `bypassGovernanceRetention` | `restic forget --prune`, aplicar retenção | nada além do bucket de backup |

Configuração do bucket (B2 / S3):

```bash
# criado UMA vez, e Object Lock não pode ser ativado depois em bucket existente — nascer com ele
b2 bucket create veloz-prod allPrivate --fileLockEnabled
b2 bucket update veloz-prod --defaultRetentionMode governance --defaultRetentionPeriod "30 days"
# versionamento é implícito no B2 e obrigatório para lock funcionar

# chave do NÓ: sem deleteFiles, restrita ao prefixo do nó
b2 key create --bucket veloz-prod --namePrefix envs/ veloz-node-n1 listBuckets,listFiles,readFiles,writeFiles

# chave do WARDEN: guardada fora de toda a infra
b2 key create --bucket veloz-prod veloz-warden listFiles,readFiles,writeFiles,deleteFiles,bypassGovernance
```

Bucket `veloz-vault` (segredos) e `veloz-br-cold` (cópia 3) nascem em **compliance mode**:

```bash
b2 bucket create veloz-vault allPrivate --fileLockEnabled
b2 bucket update veloz-vault --defaultRetentionMode compliance --defaultRetentionPeriod "90 days"
```

Em **compliance mode, nem a conta raiz com todos os poderes apaga o objeto antes do prazo.** É o que
transforma "perdemos tudo" em "perdemos 4 horas". O custo é não poder corrigir um erro de upload por 90
dias — aceitável para um bucket que recebe alguns MB por semana.

**Como o `prune` conviveu com o lock (a parte que quase todo tutorial erra).** O `restic prune` **reescreve
e apaga pack files**. Com objetos travados por 30 dias, o prune do warden só consegue remover o que já
passou de 30 dias. Consequência prática, e ela é aceitável:

- retenção efetiva mínima **de fato = 30 dias**, mesmo que a política diga 14 diários;
- +15–20% de armazenamento (já orçado em §5.5);
- o `prune` roda **semanal**, do warden, com `--max-repack-size 2G` para não fazer trabalho gigante.

**O teste negativo semanal — o item que quase ninguém faz e que decide tudo:**

```bash
#!/bin/bash
# /usr/local/sbin/veloz-immutability-test   — semanal, roda NO NÓ, com a credencial do nó
# Ele DEVE falhar. Se passar, o append-only nunca existiu e estamos com backup de mentira.
set -uo pipefail
REPO="$(veloz-repo-url canary)"
if restic -r "$REPO" forget --keep-last 0 --prune --unsafe-allow-remove-all 2>/tmp/imm.log; then
   velozctl alert raise P1 "IMUTABILIDADE QUEBRADA: a credencial do no APAGOU backup"
   exit 1
fi
grep -qiE 'access denied|not authorized|403|unauthorized' /tmp/imm.log \
  || velozctl alert raise P2 "teste de imutabilidade falhou por motivo inesperado: $(head -c 300 /tmp/imm.log)"
velozctl event emit backup.immutability.ok
```

Roda contra um repositório **canário** (dados sintéticos), nunca contra o de um cliente.

**Camadas complementares, todas baratas:**

1. **Conta B2 separada** da conta usada para qualquer outra coisa, com 2FA em app (não SMS) e e-mail de
   recuperação que não é o e-mail operacional do painel.
2. **Alerta de conta**: notificação do B2 para qualquer criação/exclusão de chave de aplicação.
3. **Nenhuma credencial de backup em disco de nó.** O CP entrega no payload do job, sobre mTLS, e o agente
   grava em `/run/veloz/creds` (tmpfs, `0600`, `veloz:veloz`) e apaga ao fim. Um snapshot do disco do nó
   roubado não contém credencial de backup.
4. **TTL de 24 h** nas chaves de aplicação do nó, rotacionadas por job do CP (`backup.creds.rotate`).
5. **Alarme de volume**: se o volume enviado por um nó cair > 60% em relação à média de 7 dias, ou se a
   contagem de snapshots parar de crescer, é P1 — é assim que se percebe cifragem/sabotagem antes do fim.

### 5.7 Verificação: a prova de que funcionou

Três níveis, com custo crescente:

| Nível | O quê | Frequência | Custo de egress | Prova que gera |
|---|---|---|---|---|
| **V1 — integridade estrutural** | `restic check` (índices, metadados) em todos os repos | **diário** | ~0 (só metadados) | `backup_verifications(kind='check')` |
| **V2 — integridade de dados** | `restic check --read-data-subset=5%` | **semanal**, rotacionando os 5% | 66 × 4 GiB × 5% ≈ 13 GiB/mês — dentro da franquia | idem |
| **V3 — restore de verdade** | restaura **1 ambiente sorteado** num nó **diferente** do de origem, sobe, valida | **semanal** | ~4 GiB/semana | relatório assinado |

**V3 em detalhe — é o critério B6 da crítica ("não vender para ninguém" se falhar):**

```bash
#!/bin/bash
# /usr/local/sbin/veloz-restore-drill   — domingo 04:00, no nó com mais folga
set -euo pipefail
ENV_ID="$(velozctl backup pick-drill-target)"   # sorteia; nunca repete em 8 semanas;
                                                # 1×/mês força o MAIOR ambiente da base
SRC_NODE="$(velozctl env node "$ENV_ID")"
DST_NODE="$(velozctl node pick --exclude "$SRC_NODE" --most-free)"
DRILL="drill-$(date +%Y%m%d)-$ENV_ID"

velozctl env restore "$ENV_ID" \
   --to-node "$DST_NODE" --as "$DRILL" --snapshot latest \
   --isolated                # sem DNS público, sem e-mail de saída, sem cron do cliente, sem PSP

# ── Verificações. TODAS têm que passar.
code=$(velozctl env http "$DRILL" --path / --host-header "$(velozctl env domain "$ENV_ID")" -o /dev/null -w '%{http_code}')
[ "$code" = "200" ] || fail "HTTP $code"

velozctl env checksum-compare "$DRILL" --against-manifest   # 20 arquivos sorteados + contagem + bytes totais
velozctl env db-verify        "$DRILL" --against rowcounts.tsv --tolerance 2%   # linhas por tabela
velozctl env smoke            "$DRILL" --wordpress          # /wp-login.php 200, /wp-json/ 200, admin-ajax 200

velozctl env destroy "$DRILL" --force
velozctl backup attest "$ENV_ID" --result ok --duration "$SECONDS" --bytes "$RESTORED_BYTES"
```

**A prova**, gravada em `backup_verifications` e num objeto no bucket compliance:

```json
{
  "id": "ver_01J...", "kind": "restore_drill", "ts": "2026-08-23T04:00:00Z",
  "environment_id": "env_0042", "snapshot_id": "9f2c1b7e", "snapshot_time": "2026-08-23T03:11:04Z",
  "source_node": "n1", "target_node": "n2",
  "restored_bytes": 3187671040, "duration_seconds": 412,
  "http_status": 200, "ttfb_ms": 640,
  "files_expected": 41822, "files_restored": 41822,
  "sha256_sample_ok": 20, "sha256_sample_total": 20,
  "db_tables_expected": 61, "db_tables_ok": 61, "db_rows_delta_pct": 0.3,
  "result": "ok",
  "signature": "ed25519:..." 
}
```

**Onde isso aparece:** (a) painel do super admin, cartão "Último restore verificado: **há 3 dias** ·
env_0042 · 6 min 52 s"; (b) painel do cliente, em *Backup*, a data da última verificação **do repositório
dele** (o drill dele, quando sortear) — é um argumento de venda que nenhum concorrente brasileiro mostra;
(c) e-mail semanal ao operador com o JSON anexo; (d) **falha ⇒ P1 imediato e o cartão fica vermelho**,
e a regra escrita é: *com o cartão vermelho, não se cria cliente novo.*

**Guarda-corpo contra o auto-engano:** o drill roda **em nó diferente do de origem** de propósito. Um
restore que só funciona no nó que ainda tem o dado vivo não prova nada — prova cache.

### 5.8 Onde ficam as chaves e quem consegue restaurar

**Hierarquia (4 níveis, e cada nível só conhece o de baixo):**

```
 [N0] CHAVE MESTRA age (X25519)   ← NUNCA toca um servidor. Só existe fora.
        │  decifra
        ▼
 [N1] BUNDLE DE SEGREDOS  secrets-2026-08-20.age  (bucket veloz-vault, compliance 90 d)
        ├─ senha de cada repositório restic (uma por ambiente)
        ├─ chave "warden" do B2 e do Magalu
        ├─ repo1-cipher-pass do pgBackRest
        ├─ CA mTLS (chave privada) + conta ACME
        ├─ chaves de API dos PSPs
        └─ senha do usuário admin do banco de cada nó
        │
        ▼
 [N2] CONTROL PLANE: tabela secrets, cifrada em coluna (pgcrypto/age), chave em
      systemd-credentials do host do CP (TPM-bound quando houver, arquivo 0400 quando não)
        │  entrega por job, sobre mTLS, com TTL
        ▼
 [N3] NÓ: /run/veloz/creds (tmpfs, 0600) — só o que o job atual precisa, some no reboot
```

**Onde a chave mestra N0 fica, em três lugares independentes:**

1. Gerenciador de senhas do dono (Bitwarden/1Password), item com histórico e 2FA por hardware key.
2. **Papel**, com a frase de recuperação impressa, em envelope lacrado, fora da casa e fora do escritório
   (cofre de banco, ou casa de familiar). Papel não é atacável por rede e sobrevive a 20 anos.
3. YubiKey (ou segunda cópia em papel) com **procedimento de sucessão**: envelope lacrado com o
   procedimento de restauração escrito em português para uma pessoa de confiança, entregue com instrução
   de só abrir mediante ausência prolongada. **Bus factor 1 guardando dado de terceiro não é só risco
   técnico — é exposição jurídica.**

**Quem consegue restaurar (matriz explícita):**

| Papel | Restore de arquivo do cliente | Restore de ambiente inteiro | Restore do control plane | Prune / apagar backup |
|---|---|---|---|---|
| **Cliente** (painel) | **sim, self-service** (do repo dele, sem ver o de ninguém) | sim, com confirmação por digitação do domínio | não | não |
| **Suporte** (papel `support`) | sim, com justificativa registrada | sim, com 2FA + justificativa | não | não |
| **Operador/Dono** | sim | sim | sim (precisa do N0 se o CP morreu) | **não** (a chave do warden não está no CP) |
| **Warden** (automação) | não | não | não | **sim** — e é a única identidade que pode |
| Invasor com root em 1 nó | dados daquele nó (já os tem) | não (a credencial é TTL e por prefixo) | não | **não** |
| Invasor com root no CP | pode disparar restores | sim | sim | **não** — falta a chave do warden e o bypass do compliance |

**Rotação:** senhas de repo restic — na criação e em incidente (restic permite adicionar/remover chaves
sem reescrever o repo: `restic key add` / `restic key remove`); chaves B2 do nó — a cada 24 h;
chave mestra N0 — a cada 24 meses ou em suspeita, com re-cifragem do bundle N1 (procedimento de 20 min
documentado no runbook §6.7).

### 5.9 Restore: matriz de escopos e tempos-alvo

| # | Escopo | Como | RTO alvo | RTO medido (a preencher em B6) | RPO | Self-service? |
|---|---|---|---|---|---|---|
| R1 | **1 arquivo ou pasta** (< 100 MB) | cópia 1 (local), `restic restore --include` | **< 2 min** | | 24 h | **sim** |
| R2 | **1 arquivo, versão de 10 dias atrás** | cópia 2 (B2) | **< 5 min** | | 24 h | **sim** |
| R3 | **Todos os arquivos do ambiente** (3 GB) | B2 → volume novo, troca atômica do symlink | **< 10 min** | | 24 h | sim, com confirmação por digitação |
| R4 | **1 banco do cliente** (dump de 300 MB) | B2 → restaura em `e0042_app_restore_20260820` **ao lado**, não por cima | **< 5 min** | | **1 h** | **sim** |
| R5 | **1 banco, ponto no tempo (última hora cheia)** | escolhe o snapshot horário na UI | **< 5 min** | | **1 h** | sim |
| R6 | **Ambiente completo** (arquivos + banco + config) | R3 + R4 + reaplica vhost/cron/certs a partir do CP | **< 20 min** | | 1 h | sim, com 2FA |
| R7 | **Ambiente em OUTRO nó** (migração / nó morto) | provisiona no destino, restaura, troca DNS (TTL 60) | **< 30 min** | | 1 h | não (job de operador) |
| R8 | **Nó inteiro perdido** (22 ambientes, ~88 GiB) | VPS nova + Ansible + 22 restores, 4 em paralelo | **< 4 h contratual** (alvo medido: 90 min) | | 1 h | não |
| R9 | **Control plane** | §4.5 | **< 30 min** | | **60 s** | não |
| R10 | **Cliente excluído, dentro da retenção** | snapshot final retido | **< 30 min** | | — | não (ticket) |
| R11 | **Perda dos DOIS provedores de storage** | cópia 3 no Magalu | < 8 h | | 7 d | não |

**Aritmética do R8** (é o número que sustenta o "RTO contratual de 4 h" que a crítica propôs no lugar da
regra N-1): 88 GiB de download a ~250 Mbps ≈ 48 min de rede pura; com 4 restores em paralelo e escrita em
NVMe, ~60 min; + 20 min de Ansible + 10 min de DNS/validação = **~90 min**. Declara-se 4 h porque
provisionar VPS em provedor novo pode levar 1 h sozinho, e porque promessa cumprida vale mais que promessa
bonita.

**Duas decisões de produto embutidas na matriz, e ambas importam:**

1. **Restore de banco é NÃO-DESTRUTIVO por padrão** (R4): restaura para `<db>_restore_<data>` e mostra ao
   cliente as duas bases lado a lado com contagem de linhas, com um segundo botão "promover esta base".
   Restore destrutivo por padrão é como se perde dado *durante a recuperação* — o pior jeito de perder.
2. **Restore de arquivos é atômico**: restaura para `/srv/env/0042.restore-<ts>/`, valida, e só então troca
   o symlink `current`. Se a rede cair no meio, o site continua no ar com o conteúdo antigo.

### 5.10 Backup de cliente pausado, inadimplente e arquivado

| Estado | Backup de arquivos | Dump de banco | Retenção | Quem paga | Observação |
|---|---|---|---|---|---|
| **Ativo** | diário | horário | 14 d/8 sem/6 m | incluso no plano | — |
| **Pausado** | **continua**, diário (dedup ⇒ custo ~0 após o 1º dia) | **cai para diário** após 24 h | inalterada | incluso; ambiente pausado paga `disk.gb.hour` + `db.gb.hour` (~R$ 4–6/mês) | é o que permite "pausei por 6 meses e voltei" |
| **Suspenso** (inadimplente, D+0 a D+30) | **continua**, semanal | semanal | inalterada | **a plataforma absorve** — custo real: 4 GiB × R$ 0,0373 = **R$ 0,15/mês por cliente**. Está escrito aqui de propósito, para ninguém "economizar" R$ 0,15 e destruir a chance de o cliente voltar | cliente inadimplente é cliente, não inimigo |
| **Suspenso D+30 a D+45** | para; mantém o **último snapshot completo** | idem | congelada | plataforma | avisos D-15, D-7, D-1 (doc 01) |
| **Excluído D+45** | ambiente destruído; **snapshot final retido +15 d e baixável** pelo cliente | idem | 15 d | plataforma | link de download por token, expira em 7 d |
| **D+60** | repositório destruído (`restic forget --unsafe` + remoção do prefixo pelo warden) | idem | — | — | o Object Lock atrasa a erradicação física: **declarar "até 90 dias" nos Termos** |
| **Arquivado** (add-on "Arquivo frio", R$ 5/mês) | 1 snapshot completo movido para Magalu Cold | idem | enquanto pagar | **cliente** | restauração em até 24 h; serve para quem fecha um projeto mas quer guardar |

**LGPD.** O direito à eliminação (art. 18, VI) só é cumprível de verdade por causa do
**repositório por ambiente**: apagar um cliente é apagar um prefixo, não reescrever um repositório
compartilhado. Nos Termos: *"a exclusão dos dados nos backups ocorre em até 90 dias, prazo determinado
pela política de imutabilidade que protege seus dados contra ransomware"* — a justificativa técnica torna
o prazo defensável em vez de suspeito. O evento de destruição vira linha em `audit_logs` com hash do
manifesto, e essa linha sobrevive 5 anos (§4.3).

### 5.11 Restauração grátis — validação do custo

Recomendação do doc 01 (§A.2.2): não copiar os **R$ 25 por restauração** do Hostoo. **Concordo, e o número
sustenta:**

| Cenário | Egress | Custo real | Tempo de operador |
|---|---|---|---|
| R1/R2 (arquivo) | 0–100 MB | **R$ 0,00** (franquia B2) | 0 (self-service) |
| R4 (banco) | ~300 MB | **R$ 0,00** | 0 |
| R6 (ambiente completo) | ~4 GiB | **R$ 0,00** (franquia) | 0 |
| R7 (para outro nó) | ~4 GiB | R$ 0,00 | ~10 min |
| R8 (nó inteiro) | 88 GiB | R$ 0,00 no B2 / R$ 8,80 se vier do Magalu Standard | ~2 h |

**Franquia do B2:** egress grátis até **3× o armazenamento médio do mês**. Com 320 GiB armazenados, são
**~960 GiB/mês de download grátis** — equivalente a **240 restores completos de ambiente por mês**, ou
11 restores de nó inteiro. Com 66 clientes e uma expectativa realista de 2 restores por cliente por ano
(132/ano ≈ 11/mês ≈ 44 GiB/mês), o consumo é **4,6% da franquia**.

> **Conclusão: restauração grátis custa R$ 0,00 em dinheiro.** Cobrar R$ 25 por ela seria cobrar 55× o
> custo marginal, no exato momento em que o cliente está com medo. É o pior lugar possível para colocar um
> preço, e é uma vantagem competitiva gratuita anunciar "restauração ilimitada e grátis".

**Guarda-corpo contra abuso** (não é sobre dinheiro, é sobre I/O do nó): **5 restores self-service por
ambiente por mês**; acima disso, um ticket (que continua grátis) e a conversa "o que está acontecendo aí?"
— que normalmente revela um problema real que vale a pena resolver. Restore de nó inteiro nunca é
self-service.

**O que se vende, então**, já que restore é grátis: retenção estendida (30 diários + 12 mensais,
R$ 12/mês), **backup externo do cliente** (enviar o snapshot para o Google Drive/S3 dele, R$ 15/mês),
**arquivo frio** (R$ 5/mês) e **banco dedicado com PITR próprio** (§2). Vende-se garantia extra, nunca o
socorro.

---

## 6. Runbooks — texto pronto para `Plan/docs/40-OPERACAO-DIARIA.md`

> **Copiar o bloco abaixo integralmente para `Plan/docs/40-OPERACAO-DIARIA.md`, seção "Banco e Backup".**
> Convenções usadas em todos: **Gatilho** (quando abrir este runbook), **Antes de tocar em qualquer coisa**
> (o que verificar para não piorar), **Passos**, **Verificação** (como saber que acabou), **Comunicação**
> (o que dizer e para quem), **Tempo alvo**.
> Regra geral que vale para os sete: **primeiro protege quem ainda está de pé, depois recupera quem caiu.**

<!-- ══════════════ INÍCIO DO BLOCO PARA 40-OPERACAO-DIARIA.md ══════════════ -->

### RB-01 — Restaurar o site de um cliente

**Gatilho.** Cliente pediu ("atualizei o plugin e o site sumiu"), ou o operador detectou defacement,
ou um deploy quebrou o ambiente.

**Antes de tocar em qualquer coisa.**
1. `velozctl env show <env>` — o ambiente está `running`? Se estiver `paused` ou `suspended`, o problema
   não é o conteúdo.
2. **Tirar um snapshot do estado atual, mesmo estando quebrado:**
   `velozctl backup run <env> --tag trigger:prerestore`. Nunca se restaura por cima sem ter para onde voltar.
   Isso leva ~40 s e já salvou muita gente.
3. Confirmar **de que data** o cliente quer voltar. Se ele não souber, `velozctl backup list <env>` e
   perguntar "o site funcionava dia X?".
4. Se houver suspeita de **invasão**, não restaure ainda: vá para o runbook de invasão do documento de segurança
   (restaurar sem fechar a porta significa ser invadido de novo em horas).

**Passos.**
```bash
velozctl backup list <env> --kind files
# ID        DATA                 TAMANHO  TAGS
# 9f2c1b7e  2026-08-19 03:12     3.1 GiB  env:0042 kind:files trigger:cron

# (a) Só um arquivo/pasta — o caso mais comum, e o mais barato:
velozctl restore files <env> --snapshot 9f2c1b7e \
        --include '/srv/env/0042/public/wp-content/plugins/woocommerce' \
        --to-side                    # restaura ao LADO, em .restore-<ts>/, sem tocar no vivo

# (b) Ambiente de arquivos inteiro (atômico: restaura ao lado e troca o symlink no fim):
velozctl restore files <env> --snapshot 9f2c1b7e --full --atomic

# (c) Ambiente + banco na mesma data (o "voltar tudo para ontem"):
velozctl restore environment <env> --at '2026-08-19 03:00' --db-mode side
#      --db-mode side  = banco vai para <db>_restore_<data>, NÃO por cima. Padrão.
#      --db-mode over  = por cima. Exige --i-know (e o snapshot do passo 2 acima).
```

**Verificação.**
```bash
velozctl env http <env> --path / -w '%{http_code}'          # 200
velozctl env http <env> --path /wp-login.php -w '%{http_code}'  # 200
velozctl env logs <env> --since 5m --level error            # vazio
velozctl env disk <env>                                     # a quota não estourou com o restore
```
Se o `--db-mode side` foi usado, abrir o painel do cliente e mostrar as **duas bases lado a lado** com
contagem de linhas antes de promover.

**Comunicação.** "Restauramos o site para o estado de 19/08 03:12. O conteúdo publicado depois dessa data
não está no site restaurado — se precisar, temos o backup de antes da restauração e conseguimos recuperar
itens específicos. Não houve cobrança."

**Tempo alvo.** (a) 2 min · (b) 10 min · (c) 20 min.

---

### RB-02 — Restaurar um banco de dados

**Gatilho.** `DELETE` sem `WHERE`, migration ruim, plugin que corrompeu a tabela de opções, ou o cliente
pedindo o estado de uma hora atrás.

**Antes de tocar em qualquer coisa.**
1. **Descobrir a hora exata do estrago.** O dump é horário: perde-se no máximo 59 min, mas só se acertar a
   hora. `velozctl env logs <env> --grep 'DELETE|DROP|ALTER' --since 6h` costuma dar a resposta.
2. **Dump imediato do estado atual** — mesmo estragado:
   `velozctl db dump <env> --db <base> --tag trigger:prerestore`.
3. **Colocar o site em manutenção** se ele ainda estiver escrevendo:
   `velozctl env maintenance on <env>`. Restaurar com o app escrevendo é como trocar o pneu andando.

**Passos.**
```bash
velozctl backup list <env> --kind db-mysql
# 3a91f2c1  2026-08-20 14:00   31 MiB   env:0042 kind:db-mysql db:e0042_app

# PADRÃO — não-destrutivo, restaura AO LADO:
velozctl restore db <env> --db e0042_app --snapshot 3a91f2c1
#   → cria e0042_app_restore_20260820T1400 e devolve um relatório de diferença:
#     tabelas: 61 | linhas a mais no vivo: 402 | linhas só no restaurado: 15.331 | tabelas divergentes: 3

# Comparar antes de decidir (o painel mostra isto também):
velozctl db diff <env> --a e0042_app --b e0042_app_restore_20260820T1400 --summary

# PROMOVER (renomeia; a base atual vira _old e fica 7 dias):
velozctl db promote <env> --from e0042_app_restore_20260820T1400 --to e0042_app
velozctl env maintenance off <env>
```

**Se o cliente precisa só de UMA tabela** (o caso mais frequente e o menos arriscado):
```bash
velozctl restore db <env> --db e0042_app --snapshot 3a91f2c1 --only-table wp_posts --to-side
# depois, com o cliente ciente:  INSERT ... SELECT  da tabela restaurada para a viva
```
Em PostgreSQL isto é nativo do formato `-Fc`: `pg_restore -t wp_posts`. Em MariaDB o script extrai a
tabela do `.sql.zst` com `sed` entre os marcadores de `DROP TABLE`.

**Verificação.**
```sql
-- contagem por tabela contra o manifesto rowcounts.tsv do snapshot
-- e uma consulta de negócio que o cliente reconheça:
SELECT count(*) FROM wp_posts WHERE post_status='publish';
SELECT max(post_date) FROM wp_posts;
```
Mais: abrir o site, fazer login no admin, carregar uma página que use a tabela restaurada.

**Comunicação.** Dizer a **janela perdida** explicitamente: "restauramos o banco para 20/08 às 14:00.
Alterações feitas entre 14:00 e 14:47 (quando o problema começou) precisam ser refeitas. A base anterior
está guardada por 7 dias caso precisemos comparar."

**Tempo alvo.** 5 min para a restauração ao lado; +5 min para promover.

---

### RB-03 — Perder um nó inteiro

**Gatilho.** Provedor confirmou perda do servidor; ou o nó está inacessível há > 30 min sem previsão;
ou disco irrecuperável.

**Antes de tocar em qualquer coisa.**
1. **Confirmar que é o nó e não a rede.** `velozctl nodes status`, ping do IP, painel do provedor, ticket
   aberto. Um nó que volta em 20 min não justifica 4 h de migração.
2. **Não começar a restaurar antes de decidir o destino.** Restaurar 22 ambientes num nó que já está a 80%
   transforma um incidente em dois.
3. **Avisar antes de saber quanto tempo vai levar.** Silêncio é o que gera cancelamento, não a falha.
4. Verificar o cartão de verificação de backup (§5.7): se ele está vermelho há dias, o plano muda —
   priorizar os clientes com snapshot mais recente e comunicar risco de perda.

**Passos.**
```bash
# T+0  Congelar. Nenhum ambiente novo, nenhum resize, nenhuma migração concorrente.
velozctl platform freeze --reason "perda do no n2"
velozctl node mark-lost n2                # painel dos clientes daquele nó passa a mostrar incidente

# T+5  Comunicar (template no fim deste runbook). E abrir a página de status.

# T+10 Provisionar substituto. A ordem de preferência é: (1) VPS nova no MESMO provedor
#      (mesma região = restore mais rápido), (2) provedor alternativo já cadastrado.
velozctl node provision --name n2b --provider <x> --spec 8vcpu-16gb-200gb
ansible-playbook -i inventory/prod playbooks/node.yml --limit n2b     # ~20 min

# T+30 Restaurar por PRIORIDADE, não por ordem alfabética. A fila é:
#        1º  ambientes com e-commerce/tráfego (velozctl env list --node n2 --sort requests_24h desc)
#        2º  ambientes ativos
#        3º  ambientes pausados (podem esperar horas sem ninguém notar)
velozctl restore node n2 --to n2b --parallel 4 --priority-by traffic
#      Ele faz, por ambiente: cria volume → restic restore → restaura DBs → recria vhost/cron/certs
#      a partir do control plane → valida HTTP → troca o DNS (TTL 60) → marca running.

# T+90 Acompanhar
watch -n 30 velozctl restore node-status n2
# 22 ambientes | 18 ok | 3 em andamento | 1 falhou (env_0057: quota estourada)

# T+150 Tratar as exceções à mão. Sempre há 1 ou 2.
velozctl platform unfreeze
```

**Verificação.** Todos os ambientes em `running`; HTTP 200 em todos os domínios primários
(`velozctl platform httpcheck --node n2b`); certificados válidos; cron reagendado
(`velozctl cron verify --node n2b`); metering voltou a emitir; o backup do **novo** nó rodou uma vez
com sucesso antes de encerrar o incidente.

**Comunicação.** Template:
> *Assunto: Incidente em andamento — seu site está sendo restaurado*
> Identificamos a perda do servidor onde seu ambiente estava hospedado, às 14:20 de hoje. Seus dados estão
> seguros: temos backup externo do dia 20/08 às 03:12 e dos bancos de dados às 14:00.
> Estamos restaurando os ambientes num servidor novo, por ordem de tráfego. Previsão para o seu:
> **até as 18:20**. Vamos avisar assim que estiver no ar. Você não precisa fazer nada.
> Acompanhe em status.veloz.app.

**Tempo alvo.** **4 h contratual**, 90 min esperado. **Cronometrar e registrar** — este número é o que se
promete comercialmente e ele precisa ser medido, não estimado.

---

### RB-04 — Corrupção de banco de dados

**Gatilho.** `InnoDB: Database page corruption`, `PANIC: could not read block`, crash-loop do serviço, ou
um `restic check` de dump falhando.

**Antes de tocar em qualquer coisa.**
1. **NÃO reiniciar em loop.** Cada tentativa de recuperação automática pode piorar. Parar o serviço.
2. **Copiar o datadir inteiro antes de qualquer reparo** — é irreversível a partir daí:
   `systemctl stop mariadb && tar -I zstd -cf /var/backups/datadir-$(date +%s).tar.zst /var/lib/veloz-db/mysql`
3. **Descobrir o escopo**: uma tabela de um cliente, ou a instância dos 22? A resposta muda tudo.
4. `smartctl -a /dev/nvme0` e `dmesg -T | grep -iE 'i/o error|nvme|ext4|xfs'`. Corrupção quase sempre é
   sintoma de hardware ou de OOM/power-loss, não causa. **Se o disco está morrendo, restaurar no mesmo
   disco é perder tempo duas vezes.**

**Passos — MariaDB.**
```bash
# Escopo 1: UMA tabela de UM cliente. Não mexer na instância.
mariadb-check --check --extended e0042_app          # ou CHECK TABLE
# → restaurar só aquela base pelo RB-02. Preferir SEMPRE isto.

# Escopo 2: instância não sobe.
# 2.1 Recuperação graduada. Comece em 1. NUNCA comece em 6.
#     innodb_force_recovery=1..3 são relativamente seguros; 4..6 DESTROEM dado.
echo "innodb_force_recovery=1" >> /etc/mysql/mariadb.conf.d/99-recovery.cnf
systemctl start mariadb
# subiu? então, IMEDIATAMENTE, com o banco em modo somente-leitura:
for db in $(mariadb -N -e "SHOW DATABASES" | grep '^e0'); do
  mariadb-dump --single-transaction "$db" | zstd -o /var/backups/rescue/$db.sql.zst
done
# só então: parar, remover o force_recovery, apagar o datadir, reinicializar e reimportar.

# 2.2 Não subiu nem com force_recovery=3 ⇒ NÃO insistir. Ir para o restore:
systemctl stop mariadb
mv /var/lib/veloz-db/mysql /var/lib/veloz-db/mysql.corrupt
mariadb-install-db --user=mysql --datadir=/var/lib/veloz-db/mysql
systemctl start mariadb
velozctl db restore-all --node n1 --engine mysql --at latest   # todos os dumps horários, em paralelo
velozctl db restore-grants --node n1                            # roles/grants do item 4 do §5.4
```

**Passos — PostgreSQL.**
```bash
# NUNCA usar pg_resetwal como primeira medida: ele faz o banco subir MENTINDO sobre a consistência.
sudo -u postgres pg_controldata /var/lib/veloz-db/pg/17/main   # estado do cluster
# Corrupção de bloco em UMA base ⇒ restaurar só ela (RB-02).
# Corrupção do cluster ⇒ reinicializar e restaurar todas as bases dos dumps horários:
systemctl stop postgresql@17-main
mv /var/lib/veloz-db/pg/17/main{,.corrupt}
pg_createcluster 17 main --datadir /var/lib/veloz-db/pg/17/main
systemctl start postgresql@17-main
velozctl db restore-all --node n1 --engine pg --at latest
velozctl db restore-grants --node n1
```

**Verificação.** Contagem de bases e de tabelas por base contra o manifesto do último dump;
`velozctl platform httpcheck --node n1`; `mariadb-check --check --all-databases` /
`vacuumdb --all --analyze` limpos; e **rodar o backup imediatamente** — o próximo incidente não espera.

**Comunicação.** Dizer a janela perdida: "restauramos os bancos para as 14:00; o que foi gravado entre
14:00 e 14:38 precisa ser refeito". E, se a causa foi hardware, dizer que o ambiente será movido.

**Tempo alvo.** Escopo 1: 10 min. Escopo 2 (instância inteira, 22 bases): **60 min**.

---

### RB-05 — Banco lento para todo mundo (vizinho barulhento)

**Gatilho.** Alerta de latência do banco, ou 3+ clientes reclamando ao mesmo tempo, ou
`Threads_connected > 200` / `pg_stat_activity` com fila.

**Antes de tocar em qualquer coisa.** Nada. **Este runbook é o único em que se age primeiro e investiga
depois** — porque cada minuto custa 22 clientes.

**Passos.**
```bash
# T+0  Quem é?
mariadb -e "SELECT USER, COUNT(*) n, MAX(TIME) maior FROM information_schema.PROCESSLIST
            WHERE COMMAND NOT IN ('Sleep') GROUP BY USER ORDER BY n DESC LIMIT 5;"
psql -c "SELECT usename, count(*), max(now()-query_start) FROM pg_stat_activity
         WHERE state<>'idle' GROUP BY 1 ORDER BY 2 DESC LIMIT 5;"
# e o histórico, que é o que dá a query exata:
psql -c "SELECT userid::regrole, calls, mean_exec_time, left(query,120)
         FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;"

# T+1  Conter. Nesta ordem.
mariadb -e "ALTER USER 'e0057'@'10.60.0.57' ACCOUNT LOCK;"
mariadb -e "SELECT CONCAT('KILL ',ID,';') FROM information_schema.PROCESSLIST WHERE USER='e0057';" | mariadb
# (PG)  ALTER ROLE e0057 CONNECTION LIMIT 0;  SELECT pg_terminate_backend(pid) ...

# T+2  Confirmar que os outros 21 voltaram.
velozctl platform httpcheck --node n1 --p95

# T+5  Agora sim, investigar. Com calma.
velozctl env logs e0057 --since 30m
velozctl db explain e0057 --query-id <id>
```

**Se o culpado não é uma query e sim volume** (5.000 queries/s de um plugin em loop): `ACCOUNT LOCK` de
15 min resolve igual; a correção é no ambiente do cliente (desativar o plugin, limitar cron).

**Se o culpado é um DDL longo** (`ALTER TABLE` de 40 min, que `statement_timeout` não interrompe em
MariaDB): matar o DDL deixa a tabela em estado intermediário em engines antigos — em InnoDB moderno é
seguro (`KILL QUERY`), mas verifique `SHOW ENGINE INNODB STATUS` antes. Alternativa preferida: deixar
terminar e conter o resto (`IOWeight` do slice do ambiente para 10 por 30 min).

**Verificação.** p95 de TTFB dos outros ambientes voltou ao normal; `Threads_running < 20`;
sem query > 60 s no `pg_stat_activity`.

**Comunicação.** Ao cliente contido, na mesma hora e sem tom de punição: "identificamos consultas que
estavam impactando o servidor e pausamos o acesso ao banco do seu ambiente por 15 minutos. Aqui está a
consulta e a sugestão de correção. Se isso for esperado no seu caso, o banco dedicado resolve — e a gente
migra sem custo de restauração."

**Tempo alvo.** Contenção em **2 min**. Diagnóstico, 30 min.

---

### RB-06 — Backup falhando há dias

**Gatilho.** O cartão "Último backup verificado" está amarelo (> 48 h) ou vermelho (> 96 h), ou o alerta
de volume caiu > 60% (§5.6, camada 5).

> **Regra de ouro deste runbook: enquanto o cartão estiver vermelho, NÃO se cria cliente novo e NÃO se faz
> manutenção arriscada em nenhum nó.** Está escrito para ser obedecido, não interpretado.

**Antes de tocar em qualquer coisa.** Descobrir **desde quando** e **o quê**: 1 ambiente, 1 nó, ou tudo.
`velozctl backup health --all` mostra a matriz ambiente × última execução × último sucesso.

**Passos — diagnóstico em ordem de probabilidade:**
```bash
# 1. Disco cheio no nó (a causa nº 1). O restic precisa de espaço para o cache.
df -h /var/backups /var/cache/restic /var/tmp
du -sh /root/.cache/restic /var/cache/restic
#   → restic cache pode crescer sem limite. Corte: restic cache --cleanup --max-age 30

# 2. Credencial expirada/rotacionada
journalctl -u veloz-backup@* --since '3 days ago' | grep -iE '403|401|denied|expired|signature'
velozctl backup creds status --node n1        # TTL, última rotação
velozctl backup creds rotate --node n1        # reemite pelo CP

# 3. Repositório travado (lock preso por processo morto — clássico)
restic -r <repo> list locks
restic -r <repo> unlock                       # só depois de confirmar que nenhum backup está rodando!
ps aux | grep restic

# 4. Repositório corrompido
restic -r <repo> check --read-data-subset=1%
# se acusar pack danificado:  restic repair index  →  restic repair snapshots --forget

# 5. Object Lock impedindo o prune (sintoma: o backup FUNCIONA e só o prune falha —
#    isso NÃO é falha de backup, é comportamento esperado; corrigir o alerta, não o bucket)
journalctl -u veloz-backup-prune | grep -i 'retention\|governance'

# 6. Cota do provedor de storage / cartão recusado
b2 account get ; velozctl backup quota
```

**Enquanto conserta — mitigação imediata, sempre:**
```bash
velozctl backup emergency --all --to local     # cópia 1 local, agora, mesmo sem o offsite
# e, se o offsite está morto por causa do provedor:
velozctl backup emergency --all --to magalu    # sobe direto para a cópia 3
```

**Verificação.** `velozctl backup health --all` todo verde; **rodar um drill de restore imediatamente**
(§5.7, V3) e não confiar no "o backup voltou a rodar" — o que se verifica é o restore;
cartão do painel volta a verde com data nova.

**Comunicação.** Se o backup esteve quebrado > 72 h **e** houve perda de dado no período, isso é
comunicação obrigatória ao cliente afetado e registro em `audit_logs`. Se não houve perda, é registro
interno + post-mortem. **Não esconder: o post-mortem interno é o que impede a segunda vez.**

**Tempo alvo.** Diagnóstico 15 min; mitigação (cópia local) 30 min; volta ao normal 2 h.

---

### RB-07 — Rotação da chave mestra (e o que fazer se ela vazou)

**Gatilho.** Rotação programada (24 meses), saída de pessoa com acesso, ou suspeita de vazamento.

**Passos.**
```bash
# 1. Gerar a nova identidade age, OFFLINE, numa máquina confiável
age-keygen -o veloz-master-2028.key            # anotar a chave pública

# 2. Re-cifrar o bundle de segredos para as DUAS chaves (janela de transição)
age -d -i veloz-master-2026.key secrets-latest.age > /dev/shm/secrets.json
age -r <pub-2026> -r <pub-2028> -o secrets-2028.age /dev/shm/secrets.json
shred -u /dev/shm/secrets.json

# 3. Publicar no vault e guardar a nova chave nos TRÊS lugares (§5.8) ANTES de aposentar a antiga
velozctl vault push secrets-2028.age

# 4. Se houve VAZAMENTO, e só nesse caso, girar tudo o que a chave protegia:
velozctl backup keys rotate --all-repos     # restic key add + key remove, por repositório
b2 key delete veloz-warden && b2 key create ...
velozctl mtls ca rotate --grace 72h         # nova CA; agentes aceitam as duas por 72 h
velozctl psp keys rotate                    # chaves de API dos gateways de pagamento
# e assumir que os backups ANTIGOS ainda são legíveis com a chave vazada:
#   → programar a expiração natural deles (retenção) e comunicar internamente o risco residual.

# 5. Testar a restauração com a chave nova, num drill completo, ANTES de destruir a antiga.
velozctl restore drill --full --with-key veloz-master-2028.key
```

**Verificação.** Drill de restore completo verde usando **apenas** a chave nova. Só então destruir as
cópias da antiga (as três).

**Tempo alvo.** Rotação programada: 30 min. Rotação por vazamento: 4 h + 72 h de janela de graça da CA.

<!-- ══════════════ FIM DO BLOCO PARA 40-OPERACAO-DIARIA.md ══════════════ -->

---

## 7. Critérios de aceite, riscos e o que fica em aberto

### 7.1 Critérios de aceite testáveis (para a IA construtora e para o CI)

| # | Critério | Como se prova | Bloqueia o quê |
|---|---|---|---|
| A1 | **Isolamento entre bancos de clientes** | dois ambientes; com as credenciais do A, tentar `SHOW DATABASES`, `USE b`, `SELECT` na base do B, conectar do IP do B: **tudo negado** | primeiro cliente pagante |
| A2 | **Grant sem curinga acidental** | criar `e0042` e uma base `e0042Xattack`; o grant de `e0042` **não** pode alcançá-la | merge |
| A3 | **Pausa bloqueia o banco de verdade** | pausar; tentar conectar com a credencial do ambiente: **negado**. (Teste que pega o bug do `MAX_USER_CONNECTIONS 0`) | merge |
| A4 | **Watchdog mata query infinita** | `SELECT SLEEP(300)` com `SET SESSION max_statement_time=0`: morre em ≤ 70 s | merge |
| A5 | **Quota de banco** | encher a base até 100%: `INSERT` falha, `SELECT` e `DELETE` funcionam, alerta emitido | primeiro cliente |
| A6 | **Reserva de RAM respeitada** | 22 ambientes ativos + carga; `systemd-cgtop`: `veloz-db.slice` ≤ 830 MB em regime | densidade vendida |
| A7 | **RLS não vaza (leitura)** | 2 tenants, cross-read com `vp_app` ⇒ 0 linhas, inclusive por dentro de sidecar de módulo | merge |
| A8 | **RLS não vaza (escrita)** | `INSERT` com `tenant_id` alheio ⇒ erro | merge |
| A9 | **Query sem contexto explode** | `SELECT` fora de `withTenant` ⇒ `insufficient_privilege` | merge |
| A10 | **Catálogo íntegro** | as 3 queries de `§4.2` retornam 0 linhas | merge |
| A11 | **Imutabilidade real** | credencial do nó tentando `forget --prune` ⇒ **403** | primeiro cliente |
| A12 | **B6 — restore ponta a ponta** | apagar 1 ambiente de 10 GB (arquivos + banco), restaurar do backup, HTTP 200 + checksums + rowcounts | **nenhum cliente pagante antes disto** |
| A13 | **Restore do CP** | runbook §4.5 numa VPS descartável, cronometrado | primeiro cliente |
| A14 | **Drill semanal automatizado** | 4 semanas consecutivas verdes, com relatório assinado | encerramento da fase de validação |
| A15 | **Chave mestra fora dos servidores** | `grep -r` por material de chave em todos os nós e no CP ⇒ zero; restore só funciona com o N0 | primeiro cliente |
| A16 | **Importação de dump do MySQL 8** | dump com `utf8mb4_0900_ai_ci` importado pelo assistente do painel sem erro | lançamento |

### 7.2 Riscos

| # | Risco | Prob. | Impacto | Mitigação | Sinal precoce |
|---|---|---|---|---|---|
| B1 | **`mariadbd` ou `postgres` compartilhado cai e derruba 22 clientes** | Média | Alto | `MemoryHigh` folgado, `OOMScoreAdjust=-500`, `Restart=always`, `vm.overcommit_memory=2`, dumps horários para reconstrução em 60 min; **duas instâncias por nó só acima de 40 ambientes** | `memory.events:high` do slice subindo |
| B2 | **Um cliente enche o disco de banco** | Média | Alto | filesystem separado + quota por database (§1.9) | uso > 80% |
| B3 | **Object Lock configurado errado** (bucket criado sem `--fileLockEnabled`; não dá para ativar depois) | Média | **Terminal** | teste negativo semanal (§5.6); checklist de criação de bucket no runbook de bootstrap | teste negativo passando quando deveria falhar |
| B4 | **Chave mestra perdida** (dono perde acesso, ou incidente pessoal) | Baixa | **Terminal** | 3 cópias em 3 lugares + envelope de sucessão | revisão semestral das 3 cópias, com data registrada |
| B5 | **Backup roda e restore não funciona** | Média-Alta se não testado | Terminal | drill semanal V3 em nó diferente (§5.7) | cartão amarelo |
| B6 | **Dump horário incoerente** (tabelas MyISAM legadas, `--single-transaction` não protege) | Baixa | Médio | detecção de engine no script + `--lock-tables` quando necessário + aviso ao cliente para converter para InnoDB | log do dump |
| B7 | **Cliente importa dump de MySQL 8 e falha** | **Alta** (é o cenário previsto) | Baixo | assistente de importação com reescrita de collation (§1.10) + página de ajuda | tickets |
| B8 | **RLS furada por view/partição/função nova** | Média | Terminal (LGPD) | as 3 queries de catálogo no CI (§4.2), template do `pg_partman`, proibição de `SECURITY DEFINER` | CI vermelho |
| B9 | **Egress explode num desastre grande** | Baixa | Médio | franquia de 3× do B2 (960 GiB); Magalu só como cópia 3 | painel de custo do B2 |
| B10 | **Provedor de storage suspende a conta** (fraude falso-positivo, cartão recusado) | Baixa-Média | Alto | cópia 3 em outro provedor, outro país, outro cartão; alerta de cota/pagamento | e-mail do provedor |
| B11 | **`restic prune` do warden nunca roda** (a automação fora da infra é a mais fácil de esquecer) | **Média** | Médio (custo cresce) | alerta se o último `prune` > 14 dias; o custo do bucket no painel de custos | armazenamento crescendo linearmente sem platô |

### 7.3 O que fica em aberto (para o Ciclo 3 / medição)

1. **Medir de verdade a reserva de 830 MB** com 22 ambientes WordPress reais sob carga (teste T9 da
   crítica). Se o `Innodb_buffer_pool_reads` ficar acima de 15%, a escolha é: subir o pool para 384 MB e
   aceitar 21 ambientes, ou empurrar os clientes pesados para o dedicado. **Decidir com o número na mão.**
2. **Medir o RTO real do R8** (nó inteiro) numa simulação completa, e ajustar o contrato de 4 h.
3. **Definir o preço do `db.gb.hour`** junto com o especialista de Billing (aqui só se afirmou que ele
   precisa existir).
4. **Cotar a conta B2 em BRL** — B2 fatura em USD; com câmbio volátil, um custo de R$ 30 pode virar R$ 38.
   Irrelevante no valor absoluto, relevante para a disciplina de orçar em USD.
5. **Decidir o destino do `veloz-warden`**: GitHub Actions (grátis, mas depende de um terceiro) × VPS de
   R$ 20 (isolada, mas é mais uma coisa para manter). Recomendação inicial: **GitHub Actions com OIDC**,
   porque é o único ambiente do projeto que não compartilha credencial com nada.
6. **Redis como módulo de cache por ambiente** (~15 MB com `maxmemory`): fora deste documento, mas é o
   próximo pedido previsível de quem roda WooCommerce, e muda a conta de RAM do nó.
