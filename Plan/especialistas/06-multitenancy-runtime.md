# 06 — Multi-tenancy & Orquestração de Runtime

> **Ciclo 2.** Executa o **Veredito do Conflito 1** da crítica do Ciclo 1: OCI/Docker com
> `userns-remap`, dados do cliente em bind mount sobre diretório com **project quota XFS**, imagem base
> compartilhada por **overlay2**. **ZFS e Incus estão fora.** Este documento não reabre a decisão —
> detalha a execução dela. Onde encontrei fato novo relevante, está marcado como **[ACHADO NOVO]** e
> avaliado explicitamente contra a decisão.
>
> Alvo de hardware: **VPS 1 — 6 vCPU · 16 GB RAM · 200 GB NVMe**. Tudo aqui é calculado para essa
> máquina, não para um servidor de 64 GB.

---

## 0. Resumo executivo (leia isto se ler só uma seção)

| # | Decisão | Número/comando |
|---|---|---|
| D1 | **1 container por ambiente**, não 2. Sem nginx, sem s6, sem supervisor, sem systemd dentro. PID 1 = `php-fpm` ou o processo do cliente | economiza ~22 MB/ambiente (nginx + shim) = **1 ambiente inteiro por nó** |
| D2 | A unidade de limite e de cobrança é a **slice systemd** `veloz-env-<id>.slice`, não o container | `systemctl set-property` persiste, aplica a quente e sobrevive ao recreate da troca de versão |
| D3 | Densidade honrada **por nó**: **18 Start / 9 Light / 4 Plus / 2 Pro** contra 9.500 MB vendáveis, mais ~35 pausados (teto de disco) | ver §1 |
| D3b | **Frota de produção = 2 nós** (ADENDO 3): **14 ambientes** no mix de 1,35 GB, postura garantida. Reserva operacional de **2 GB por nó**. Nó 3 é **teste**, não vende | ver §1.6, §8.4 |
| D4 | Pausar = `docker stop` (SIGQUIT). RAM 100% liberada, shim morre, disco preservado | alvo de start **p95 < 5 s**, meta interna 2,5 s |
| D5 | Hot-resize = `systemctl set-property veloz-env-0042.slice MemoryMax=… CPUQuota=…`. **`docker update` é o plano B** | redução abaixo do uso atual **é recusada por padrão**, com procedimento escalonado |
| D6 | Troca de versão = **recreate blue/green por porta**, com swap atômico do upstream na borda | **0 requisição perdida**; rollback em < 2 s por 10 minutos |
| D7 | Runtime novo (Python/Go/Ruby) = **um arquivo `.toml`** validado por schema. Zero linha no core | ver §5.4 |
| D8 | Migração entre nós é **offline com proxy de cobertura**: 60–180 s de corte, 30–45 min de operação para 5 GB | ver §8.2 |
| D8b | Com 2 nós, **redundância não é capacidade reservada, é velocidade de restore**: reserva de resgate de 2 GB + pausados de volta primeiro + terceiro nó contratado no ato (< 30 min) | ver §8.1.1, §8.3.1 |
| D9 | Cada ambiente roda com **UID distinto dentro do container** (`10000 + env_id`). Nenhum ambiente roda como uid 0, nunca | é o que salva o isolamento apesar do §10.2 |
| D10 | Transferência de arquivo é **SFTP (porta 2222, SFTPGo no host), funciona com o ambiente pausado**. FTP só como `mod-ftp` opcional e **só FTPS** | ver §6 |
| D11 | `apt install` não persiste — o cliente **declara** pacotes em `packages.toml` e o nó constrói uma **imagem derivada** por ambiente | ver §7 |

**[ACHADO NOVO — não derruba a decisão, mas obriga duas regras]:** o `userns-remap` do Docker é
**do daemon inteiro**, com uma única faixa de subuid. O uid 0 de dentro do container A e o uid 0 de
dentro do container B mapeiam para **o mesmo uid do host**. O Podman tem `--userns=auto` (faixa por
container); o Docker não. Consequência obrigatória: **(a)** nenhum ambiente pode rodar como uid 0
dentro do container; **(b)** o uid interno é único por ambiente. Detalhe e gatilho de reabertura em §10.2.

**[ACHADO NOVO — risco operacional real, verificar HOJE]:** *project quota* XFS na partição raiz exige
`rootflags=pquota` na linha de comando do kernel. **Se o provedor da VPS não deixa editar o GRUB, não há
quota na raiz.** Alternativas e regra de recusa em §2.5. Isto entra no `veloz-node-doctor.sh`.

---

## 1. Densidade recalculada e honrada — VPS 16 GB / 6 vCPU / 200 GB NVMe

### 1.1 Planilha de RAM: reserva do host

Regra do Ciclo 1 que estou honrando: *"cada 512 MB residentes no host custam 1 ambiente vendável"*.
Cada linha abaixo declara **quantos ambientes custa**.

| Componente | RAM | Ambientes que custa | Justificativa / como foi obtido |
|---|---:|---:|---|
| Kernel + systemd + journald + sshd + chrony + nftables | 450 MB | 0,88 | Debian 13 mínimo, `journald` com `SystemMaxUse=500M` e `Storage=persistent` |
| `dockerd` + `containerd` (ociosos) | 150 MB | 0,29 | daemon único; `live-restore=true` |
| `containerd-shim-runc-v2` — **1 por container** | 10 MB × N | 0,02 por ambiente | **[ACHADO NOVO]** ninguém contou isto. É o motivo de D1 |
| Agente VelozPanel (Node 24 SEA, `MemoryMax=128M`) | 128 MB | 0,25 | teto imposto por systemd (doc 05 §2.1) |
| `vector` (parse de log da borda → métrica de requisições) | 60 MB | 0,12 | doc 05, decisão 18 |
| nginx de borda (`worker_processes 2`) | 60 MB | 0,12 | TLS + estático + FastCGI de todos os ambientes |
| **MariaDB 11 LTS** (`innodb_buffer_pool_size=256M`, `performance_schema=off`) | 450 MB | 0,88 | emenda do Conflito 2 |
| **PostgreSQL 17** (`shared_buffers=256M`, `max_connections=100`) | 350 MB | 0,68 | idem |
| Transitórios: `restic`/`zstd`/`age` no backup, `lego` na renovação, `mysqldump` horário | 250 MB | 0,49 | **pico**, não médio; nunca simultâneos por design (janelas separadas) |
| Margem de segurança: page cache útil, reclaim, picos correlacionados | 1.000 MB | 1,95 | sem isto o nó opera sempre em pressão |
| **Reserva fixa do host** | **2.898 MB** | **5,66** | |
| Shims (22 ambientes ativos) | 220 MB | 0,43 | escala com a densidade |
| **Reserva total com 22 ativos** | **≈ 3.118 MB** | | |

> **RAM disponível para ambientes = 16.384 − 3.118 = 13.266 MB ≈ 13,0 GB.**
> Confere com a estimativa da crítica (13,5 GB) — a diferença de 500 MB são os shims e o `vector`,
> que a crítica não tinha.

**Teto duro agregado:** `veloz-env.slice` com `MemoryMax=11.5G` e `MemoryHigh=10.5G`. Os 1,5 GB entre
11,5 e 13,0 são a folga que impede o OOM killer de olhar para fora da subárvore dos ambientes.
Isso é o coração do §1.5.

### 1.2 Ambientes ATIVOS por plano

> **Leia junto com a §1.6.** Os números desta tabela são contra o teto bruto de 11.500 MB. A §1.6
> reserva 2.000 MB por nó para blue/green, build e resgate, e é contra os **9.500 MB vendáveis** que
> o escalonador aloca de verdade. Onde houver divergência, **a §1.6 vence** — ela é pós-ADENDO 3.

| Plano | `MemoryMax` | Ativos @ overcommit 1,0× | Ativos @ 1,3× (recomendado após medição) | vCPU vendida (`CPUQuota`) |
|---|---:|---:|---:|---|
| **P1 — Site / blog** | 512 MB | **22** | **29** | 100% |
| **P2 — Loja / WooCommerce** | 1.024 MB | **11** | **14** | 150% |
| **P3 — App** | 2.048 MB | **5** | **7** | 200% |
| **P4 — Dedicado leve** | 4.096 MB | **2** | **3** | 300% |

Conta: `11.500 / 512 = 22,4` → 22. Com 1,3×: `22 × 1,3 = 28,6` → 29, teto do `veloz-env.slice`
mantido em 11,5 GB (o overcommit está na **soma dos `MemoryMax` vendidos**, não no teto agregado).

Mix realista de venda (o que eu recomendo escrever no plano de capacidade): **16 × P1 + 3 × P2 + 1 × P3**
= `16×512 + 3×1024 + 1×2048 = 8.192 + 3.072 + 2.048 = 13.312 MB` vendidos contra 11.500 de teto
= **1,16× de overcommit**. Cabe, com folga, sem depender de estatística.

### 1.3 Ambientes PAUSADOS: o limite é disco, não RAM

Pausado = 0 MB de RAM, 0 shim, 0 processo. Custa disco, backup e uma linha no banco.

| Item | GB | Justificativa |
|---|---:|---|
| Disco total | 200,0 | |
| SO + `/var` + journald + pacotes | 8,0 | |
| Imagens OCI (6 PHP + 4 Node + base), com dedup overlay2 | 4,0 | §2.2 |
| Dados MariaDB + PostgreSQL (todos os clientes do nó) | 15,0 | ~300 MB/cliente × 50 |
| Logs de acesso + buffers do `vector` | 5,0 | rotação de 14 dias |
| Área de staging de backup/restore | 10,0 | um restore de 10 GB precisa caber |
| **Reserva intocável (XFS nunca acima de 85%)** | 30,0 | XFS degrada e a fragmentação explode acima disso |
| **Disponível para volumes de ambiente** | **128,0** | |

Uso real medido esperado de um WordPress com mídia: **1,5–3,0 GB**. Uso 2,5 GB de média.

> **128 / 2,5 = 51 volumes de ambiente por nó.**
> Com 22 ativos → **~29 ambientes pausados adicionais**. Total **~51 ambientes residentes por nó**.

### 1.4 Overcommit: qual razão é segura, e por quê

**RAM — recomendo começar em 1,0× e subir para 1,3× só depois de B1/T9 medido.**

O argumento estatístico (útil, mas honesto sobre onde ele falha): se o uso de cada ambiente é uma
variável com média `0,45 × plano` e desvio `0,25 × plano`, a soma de N ambientes tem média `0,45·N·P` e
desvio `0,25·P·√N`. Para N=29, P=512 MB: média 6,68 GB, P99 (μ + 2,33σ) = **8,3 GB** contra 11,5 GB de
teto. Sobra. Para N=35 (1,6×): P99 = **9,8 GB** — ainda cabe no papel.

**Por que mesmo assim paro em 1,3×:** a fórmula assume independência, e ela é falsa aqui por três
motivos concretos:

1. **WP-Cron às :00.** Vinte WordPress disparam `wp-cron.php` no mesmo minuto. Correlação ≈ 1.
   *Mitigação obrigatória antes de habilitar 1,3×:* desligar `DISABLE_WP_CRON` e mover para o cron do
   painel com **jitter determinístico** de 0–300 s derivado do `env_id` (`jitter = (env_id * 37) % 300`).
2. **N é pequeno.** Com 22–29 ambientes, `√N` não protege: um único cliente em pico consome 4% do nó.
   A lei dos grandes números começa a valer perto de 100 ambientes, não de 25.
3. **Eventos externos correlacionam.** Queda de CDN, ataque de bot varrendo `/wp-login.php` em todos
   os vhosts do nó, ou um `composer install` de 5 clientes depois de um anúncio de release.

**Regra final de overcommit de RAM:**
```
soma(MemoryMax dos ambientes com desired_state=running) <= 1,3 × MemoryMax(veloz-env.slice)
ambientes pausados contam 0
bloquear criação/start quando a regra for violada  → HTTP 409 com o número
```

**vCPU — 4:1, com dois guarda-corpos.** 6 vCPU, host reserva 0,5 → 5,5 vCPU (`CPUQuota=550%` no
`veloz-env.slice`). Vendendo 22 × 100% = 22 vCPU sobre 5,5 = **4:1**. Defensável porque o *duty cycle*
de um site PHP é de 2–8%. Guarda-corpos: (a) `CPUWeight` proporcional ao plano, para que sob contenção
quem paga mais ganhe; (b) parar de vender quando `cpu.pressure` `avg300 > 20%` no `veloz-env.slice`.

**Disco — 4:1 provisionado, com corte em 80%.** 51 ambientes × 10 GB de cota = 510 GB provisionados
sobre 128 GB reais. É seguro **só** com o guarda-corpo, porque **8 clientes enchendo a cota lotam o nó**
(`128 / 10 = 12,8`, menos a reserva). Regra: alerta em 70% (90 GB), **bloqueio de criação de ambiente e
de restore em 80%** (102 GB), e a partir de 85% o agente recusa `start` de ambiente pausado até liberar
espaço. Isso precisa estar na UI do admin como um número, não como um gráfico bonito.

### 1.5 O que acontece quando estoura — os quatro modos de falha, em ordem

Este é o desenho que faz o estouro ser **degradação**, não incidente.

```
/sys/fs/cgroup/
└── veloz.slice/
    └── veloz-env.slice/                 MemoryHigh=10.5G  MemoryMax=11.5G  CPUQuota=550%
        ├── veloz-env-0042.slice/        MemoryHigh=410M   MemoryMax=512M   CPUQuota=100%
        │   └── docker-<id>.scope/       (php-fpm master + workers)
        └── veloz-env-0043.slice/        ...
```

O aninhamento de slices é dado de graça pelo systemd: `veloz-env-0042.slice` implica
`veloz.slice/veloz-env.slice/` como pais. É por isso que a nomenclatura tem hífen.

| Nível | Gatilho | O que o kernel faz | O que o cliente vê | O que o painel faz |
|---|---|---|---|---|
| **1. Soft do ambiente** | `memory.current > memory.high` (80% do plano) | *throttle* de alocação + reclaim síncrono no processo que aloca | site **fica lento** | alerta "82% da memória" + sugestão de upgrade, com botão |
| **2. Hard do ambiente** | `memory.current > memory.max` | OOM killer **restrito ao cgroup do ambiente**; mata o maior task de lá (worker do php-fpm) | 502 numa requisição; php-fpm respawn em ms | lê `memory.events` (`oom_kill`), registra incidente, mostra "seu site excedeu a memória N vezes hoje" |
| **3. Soft agregado** | soma > 10,5 GB | throttle em **todos** os ambientes | vários sites lentos ao mesmo tempo | alerta de **nó**, para de aceitar `start` e criação |
| **4. Hard agregado** | soma > 11,5 GB | OOM killer escolhe vítima **dentro da subárvore dos ambientes** — nunca MariaDB, nunca o agente, nunca o sshd | um ambiente cai | página de incidente + evacuação manual |

Complementos obrigatórios:

```ini
# /etc/systemd/system/veloz-agent.service.d/oom.conf  — o agente é o último a morrer
[Service]
OOMScoreAdjust=-900
OOMPolicy=continue
```
```bash
# swap: 2 GB para o HOST respirar; ambientes ficam proibidos de usar swap
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
sysctl -w vm.swappiness=10
systemctl set-property veloz-env.slice MemorySwapMax=0     # herdado por todos os ambientes
```

**Disco cheio dentro da cota:** `write()` devolve `EDQUOT`. PHP levanta
`failed to open stream: Disk quota exceeded`. O agente detecta via `xfs_quota -x -c report` a cada
5 min e o painel mostra "cota cheia" **antes** de o cliente descobrir por um erro 500. Sem isso, isto vira
ticket.

**Disco cheio no nó:** o `bhard` de cada ambiente garante que a soma nunca passa do provisionado, mas o
provisionamento é 4×. O guarda-corpo de 80% é o que impede. Se ainda assim encher: XFS em 100% derruba
MariaDB e o journald juntos. Por isso a **reserva intocável de 30 GB** e um `systemd.timer` que alerta
em 70% e **para o `restic` e o `mysqldump`** em 90% (eles são os maiores geradores de escrita transitória).

### 1.6 Frota de produção real: **2 nós** (ADENDO 3) — e o catálogo fechado até 4 GB

> O ADENDO 3 corrige a premissa: **não são 3 nós de produção, são 2** (6 vCPU / 16 GB cada, em
> provedores diferentes). O terceiro nó de 16 GB é **teste/homologação e não recebe cliente pagante**
> (§8.4). Tudo o que vem antes nesta seção continua valendo **por nó**; o que muda é a frota.

**Mudança estrutural que isso força:** com 3 nós, perder um custava 33% da capacidade. **Com 2 nós,
perder um custa 50%** — e o nó sobrevivente **não tem como absorver o outro**. Isso promove a evacuação
e o restore de "desejável" a **requisito de MVP** (§8.3), e obriga a separar o teto do nó em duas partes:

```
veloz-env.slice  MemoryMax = 11.500 MB   (teto duro agregado, §1.5)
  ├── vendável ................ 9.500 MB   ← é contra ISTO que o escalonador aloca
  └── reserva operacional ..... 2.000 MB   ← NÃO é folga ociosa; tem quatro usos concretos
```

A **reserva operacional de 2 GB** paga quatro contas ao mesmo tempo, e é por isso que ela é defensável
mesmo num nó minúsculo:

1. **Blue/green** da troca de versão e da imagem derivada (§5.1, §7.3): dois runtimes coexistem por ~30 s.
2. **Boost de build** (`composer install`, `npm ci`, `pip install` — §7.2): 1 GB temporário.
3. **Resize de emergência** para conter um cliente em pico sem derrubá-lo (§4.3).
4. **Resgate**: absorver **1 ambiente crítico** do nó morto no minuto zero, enquanto o resto é restaurado.

#### Capacidade por plano — catálogo fechado do ADENDO §H

Contra os **9.500 MB vendáveis por nó**, sem overcommit (1,0×):

| Plano | RAM | Cota de disco | **Por nó** | **Frota (2 nós)** | vCPU (`CPUQuota`) |
|---|---:|---:|---:|---:|---|
| **Start** | 512 MB | 10 GB | **18** | **36** | 100% |
| **Light** | 1 GB | 20 GB | **9** | **18** | 150% |
| **Plus** | 2 GB | 40 GB | **4** | **8** | 200% |
| **Pro** | 4 GB | 80 GB | **2** | **4** | 300% |
| **Mix médio de 1,35 GB** (número do Billing) | 1.382 MB | ~25 GB | **6,9 → 7** | **14** | — |

> **Capacidade total da frota de produção, no mix realista: 14 ambientes.**
> Planos de 8 GB e 16 GB estão fora do catálogo (ADENDO §H) — e a aritmética confirma:
> um plano de 8 GB ocuparia 84% do vendável de um nó inteiro. Não é catálogo, é orçamento sob medida
> num nó dedicado.

**Restrição paralela de disco**, que morde antes da RAM em dois planos:

| | Start | Light | Plus | Pro | Mix |
|---|---:|---:|---:|---:|---:|
| Limite por **RAM** (por nó) | 18 | 9 | 4 | 2 | 7 |
| Limite por **disco real** (128 GB / uso médio) | 51 | 42 | 32 | 21 | 51 |
| Limite por **disco provisionado** a 4× de overcommit | 51 | 25 | 12 | 6 | 20 |
| **Efetivo** | **18** | **9** | **4** | **2** | **7** |

A RAM continua sendo o gargalo em todos os planos. **O disco só vira gargalo quando entram os
pausados** — e é ele que define quantos pausados cabem (§1.3): ~44 volumes adicionais por nó no plano
Start, ~35 no mix.

#### Reconciliando com o número do Billing (11 ambientes/nó)

O Billing chegou a **~11 ambientes/nó** com o mix de 1,35 GB. Meu número é **7**. Os dois estão certos e
medem coisas diferentes — e a diferença precisa estar explícita, porque é ela que decide se um cliente
consegue ou não apertar "Iniciar":

| Postura | Regra | Por nó | Frota | O que se assume | Risco |
|---|---|---:|---:|---|---|
| **A — Garantida (recomendada)** | `Σ MemoryMax vendidos ≤ 9.500 MB` | **7** | **14** | nada | nenhum. Todo cliente pode ligar o ambiente a qualquer hora |
| **B — Ocupação plena** | `Σ MemoryMax vendidos ≤ 11.500 MB` (consome a reserva) | 8 | 16 | que não haverá blue/green nem build em pico | troca de versão pode falhar por falta de RAM |
| **C — Overcommit 1,3×** | `Σ vendidos ≤ 1,3 × 11.500`, com bloqueio de `start` | **11** | **22** | que **≥ 30% da base fica pausada de verdade** | **um cliente pode receber "não foi possível iniciar seu ambiente"** — o pior erro possível num produto cujo argumento de venda é o botão de pausar |

**Recomendação: postura A.** Razões, em ordem: (i) o ADENDO §I é explícito — *"otimizar para aprender com
poucos clientes e não perder dado, não para maximizar receita; prejuízo operacional nesta fase é
esperado e aceito"*; (ii) 14 é maior do que os "4 a 5 sistemas" da fase de validação, então a capacidade
não é a restrição; (iii) com 2 nós, a postura C só funciona se a fração de pausados for real, e não há
como saber isso antes de ter clientes. **Reavaliar a postura quando houver 60 dias de dados reais de
pausa** — aí a conversa passa a ser numérica.

**Gatilho registrado:** se a ocupação passar de 12 ambientes na frota, a decisão não é ir para a postura
C — é **contratar o terceiro nó de produção**. Um nó de 16 GB custa R$ 150–350/mês e devolve +7
ambientes; migrar para overcommit devolve +7 e compra o risco de recusar um `start`. O nó é mais barato
que o incidente.

---

## 2. Especificação do ambiente como container OCI

### 2.1 Decisão estrutural: 1 container por ambiente, borda no host

**O que vai dentro da imagem:** só o runtime e o que o runtime precisa. **Nada mais.**

| Componente | Dentro do container? | Por quê |
|---|---|---|
| nginx | **NÃO** | 12 MB de RSS + 10 MB de shim, × 22 ambientes = **~1 ambiente perdido por nó**. A borda no host já gera vhost por site (doc 04 §6.3) e já termina TLS |
| systemd | **NÃO** | 35 MB e um init completo por ambiente. É o custo que decidiu o Conflito 1 |
| s6-overlay / supervisord | **NÃO** | Só existiriam para supervisionar o nginx que não está lá. Um processo, um container |
| tini | **Só para Node** (`docker run --init`) | php-fpm master já faz *reaping* de filhos corretamente; Node não |
| cron | **NÃO** | cron do host → `docker exec`, a partir da tabela de cron do painel (§3.2) |
| sshd | **NÃO** | `sshd` de salto do host → `docker exec` (doc 04 §8.5, trocando `incus exec` por `docker exec`) |
| php-fpm / node / gunicorn | **SIM** — é o PID 1 | |
| composer, wp-cli, git, rsync, unzip, curl, bash, coreutils | **SIM** | O cliente precisa deles no shell. Custam ~90 MB de **disco**, 0 de RAM, e são dedupados pelo overlay2 entre todos os ambientes da mesma versão |
| msmtp (relay para o SMTP do painel) | **SIM** | `sendmail_path` do PHP precisa de um binário |

**O custo honesto de tirar o nginx de dentro:** a borda, que roda como `www-data` no host, precisa **ler**
os arquivos estáticos de todos os inquilinos (via ACL POSIX, §2.4). Um RCE no nginx da borda lê o disco
de todos. Isso está listado em §10.5 como exposição aceita, com as compensações. **Alavanca documentada:**
se a medição T9 der densidade < 18, ou se o modelo de ameaça mudar, reintroduzir o nginx no container
custa ~22 MB/ambiente e devolve o isolamento de leitura — é uma linha no manifesto do runtime, não uma
reescrita.

### 2.2 Imagem base por linguagem × versão

Tag pública móvel para humanos, **digest imutável no banco** para máquinas:

```
velozpanel/php:7.4  8.0  8.1  8.2  8.3  8.4      (legado 7.4/8.0 marcado EOL na UI)
velozpanel/node:18  20  22  24
velozpanel/static:1                                (só arquivos, sem processo — plano mais barato)
```

`Dockerfile` de referência (PHP), com os pontos que importam:

```dockerfile
# ghcr.io/velozpanel/php:8.3
FROM debian:13-slim AS base
ARG PHPV=8.3
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    curl -fsSL https://packages.sury.org/php/apt.gpg -o /usr/share/keyrings/sury.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/sury.gpg] https://packages.sury.org/php/ trixie main" \
      > /etc/apt/sources.list.d/sury.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      php${PHPV}-fpm php${PHPV}-cli \
      # TODAS as extensões curadas ficam INSTALADAS e DESABILITADAS (ver §2.6)
      php${PHPV}-{mysql,pgsql,gd,imagick,intl,mbstring,curl,xml,zip,bcmath,soap,redis,memcached,opcache,sqlite3,gmp,ldap,exif,apcu,igbinary,xdebug} \
      git unzip rsync msmtp-mta less ca-certificates jq; \
    # composer e wp-cli fixados por checksum, não "curl | php"
    curl -fsSLo /usr/local/bin/composer https://getcomposer.org/download/2.8.4/composer.phar; \
    echo "<sha256>  /usr/local/bin/composer" | sha256sum -c -; chmod 0755 /usr/local/bin/composer; \
    curl -fsSLo /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli-2.11.0.phar; \
    echo "<sha256>  /usr/local/bin/wp" | sha256sum -c -; chmod 0755 /usr/local/bin/wp; \
    # desabilita TUDO: os .ini efetivos vêm do volume do cliente
    rm -f /etc/php/${PHPV}/fpm/conf.d/*.ini /etc/php/${PHPV}/cli/conf.d/*.ini; \
    rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man /var/log/*; \
    # o pool efetivo vem do volume; aqui fica só o esqueleto
    rm -f /etc/php/${PHPV}/fpm/pool.d/www.conf
COPY php-fpm.conf /etc/php/${PHPV}/fpm/php-fpm.conf
USER 10000
EXPOSE 9000
STOPSIGNAL SIGQUIT
ENTRYPOINT ["/usr/sbin/php-fpm8.3","--nodaemonize","--force-stderr"]
```

Pontos não óbvios que precisam estar no build:

- **`STOPSIGNAL SIGQUIT`.** `docker stop` manda `SIGTERM` por padrão, e `SIGTERM` no php-fpm master é
  *shutdown imediato* — mata requisições em voo. `SIGQUIT` é o *graceful shutdown*. Sem esta linha, cada
  pausa e cada troca de versão derruba requisições. **É a linha mais importante do Dockerfile.**
- **`USER 10000`** é só o default; o `docker run` passa `--user <10000+env_id>` (§10.3).
- **`--force-stderr` + `--nodaemonize`**: log para stdout, capturado pelo `local` log driver e lido pelo
  `vector`. Sem journald dentro.

| Imagem | Tamanho alvo (descomprimido) | Camadas únicas sobre a base | Observação |
|---|---:|---:|---|
| `debian:13-slim` (camada comum) | 80 MB | — | compartilhada por **todas** as imagens |
| `velozpanel/php:8.3` | **400–460 MB** | ~330 MB | ~25 extensões + composer + wp-cli |
| `velozpanel/php:8.2` | 400–460 MB | ~330 MB | Sury reempacota; pouca dedup entre versões de PHP |
| `velozpanel/node:22` | **200–240 MB** | ~130 MB | tarball oficial em `/opt/node/22` |
| `velozpanel/static:1` | 95 MB | ~15 MB | |
| **Total no nó (6 PHP + 4 Node + static)** | **≈ 2,6–3,2 GB** | | orçado em 4,0 GB na §1.3 |

**Teto de tamanho como critério de build:** o CI **falha** se `velozpanel/php:*` passar de 500 MB ou
`node:*` de 260 MB. Sem esse teto, a imagem engorda 50 MB por trimestre e ninguém percebe.

**Dedup medido (teste T8):** 22 ambientes da mesma imagem devem ocupar `imagem + Σ camadas graváveis`.
Com `--read-only` (§10.3), a camada gravável é ~0. Critério: **overhead < 300 MB por ambiente**; o esperado
real é **< 5 MB**, porque tudo que o cliente escreve está em bind mount, fora do overlay2.

### 2.3 Layout de diretórios exato no host

```
/srv/veloz/
├── envs/
│   └── e0042/                     ← projeto XFS 10042, bhard = cota do plano, modo 0750
│       ├── app/                   → /srv/app       (código do cliente; DocumentRoot em app/public)
│       │   ├── public/            ← a borda serve estático daqui
│       │   ├── storage/uploads/   ← montado noexec dentro do container
│       │   └── vendor/ node_modules/
│       ├── home/                  → /home/app      ($HOME do usuário SSH, .ssh/authorized_keys)
│       ├── etc/
│       │   ├── php/conf.d/        → /etc/php/8.3/fpm/conf.d   (ro)  ← extensões ligadas/desligadas
│       │   ├── php/pool.d/        → /etc/php/8.3/fpm/pool.d   (ro)  ← pool gerado pelo agente
│       │   └── app.env            → /srv/app/.env-managed     (ro)  ← variáveis da UI
│       ├── logs/                  → /srv/app/logs  (php-access, php-slow, stdout do app)
│       ├── tmp/                   → /srv/app/tmp   (sessões PHP, uploads temporários)
│       ├── cache/opcache/         → /var/cache/php/opcache    ← sobrevive à pausa; corta ~40% do 1º hit
│       └── .veloz/                ← metadados do agente: state.json, port, uid, image digest
├── certs/<dominio>/               ← fullchain.pem, key.pem (lego, DNS-01)
└── run/                           ← nada: os sockets viraram TCP em 127.0.0.1 (§2.4)

/etc/nginx/veloz/
├── sites/e0042.conf               ← vhost GERADO, não editar
├── upstream/e0042.conf            ← `server 127.0.0.1:19042;` — o arquivo que a troca de versão troca
├── state/e0042.conf               ← `location / { return 503; }` quando pausado
└── snippets/{paused,ratelimit,tls}.conf

/etc/systemd/system/
├── veloz.slice  veloz-env.slice   ← tetos agregados
└── veloz-env-0042.slice           ← limites do ambiente (fonte da verdade)

/var/lib/docker/                   ← overlay2, na MESMA XFS com pquota (permite --storage-opt size=)
/var/lib/veloz/agent.sqlite        ← desired_state local do agente (§3.5)
```

**Alocação de porta determinística:** `porta_fastcgi = 19000 + env_id` (ambiente 0042 → 19042),
publicada **só em 127.0.0.1**. Blue/green usa `29000 + env_id`. Tabela de portas persistida em
`.veloz/state.json` e no CP; colisão é impossível por construção e é testável — importante para um
sistema construído por IA.

### 2.4 Por que TCP em loopback e não unix socket

Com `userns-remap`, o socket criado pelo php-fpm dentro do container pertence a `165536 + uid_interno`
no host. A borda roda como `www-data` (uid 33 do host). Fazer os dois se encontrarem exige ACL no socket
**que é recriado a cada start do container** — é o tipo de detalhe que quebra às 3h da manhã.

```nginx
# /etc/nginx/veloz/upstream/e0042.conf   (o agente reescreve este arquivo e recarrega)
upstream veloz_e0042 { server 127.0.0.1:19042; keepalive 8; }
```
```nginx
# /etc/nginx/veloz/sites/e0042.conf  (trecho)
root /srv/veloz/envs/e0042/app/public;
location / { try_files $uri $uri/ /index.php?$query_string; }
location ~ ^/(storage/uploads|logs)/ { deny all; }          # nunca servir upload como código
location ~ \.php$ {
    include fastcgi_params;
    fastcgi_pass veloz_e0042;
    fastcgi_param SCRIPT_FILENAME /srv/app/public$fastcgi_script_name;   # caminho DE DENTRO do container
    fastcgi_read_timeout 120s;
}
```

> **Pegadinha que custa meio dia:** `SCRIPT_FILENAME` precisa do caminho **dentro do container**
> (`/srv/app/public/...`), não do caminho do host (`/srv/veloz/envs/e0042/app/public/...`). O
> `document_root` da borda é o do host; o do php-fpm é o do container. Fixar literal, nunca
> `$document_root$fastcgi_script_name`.

Custo honesto do TCP: **~5% a mais de latência de FastCGI** contra unix socket em requisições muito
curtas — irrelevante contra os 30–200 ms de um WordPress. Ganho: zero manipulação de ACL de socket,
zero interação com o mapeamento de uid, porta determinística, e o *health check* do blue/green vira
um `nc -z`.

**ACL para a borda ler o estático** (aplicada uma vez, na criação do ambiente; o `-d` faz os arquivos
novos herdarem):

```bash
setfacl -R  -m u:www-data:rX /srv/veloz/envs/e0042/app/public
setfacl -R -d -m u:www-data:rX /srv/veloz/envs/e0042/app/public
# o resto do volume NÃO recebe ACL: a borda não lê vendor/, .env, storage/
```

### 2.5 XFS project quota — e o bloqueador do `rootflags`

```bash
# 1) o filesystem PRECISA estar montado com pquota. Em partição separada:
#    /etc/fstab: UUID=... /srv/veloz xfs defaults,pquota,noatime,nodiratime 0 0
# 2) se /srv/veloz estiver na RAIZ, pquota exige linha de comando do kernel:
#    GRUB_CMDLINE_LINUX="rootflags=pquota"  → update-grub → reboot
mount | grep -E 'on (/|/srv/veloz) type xfs' | grep -q pquota || echo "SEM PQUOTA — bloqueador"
xfs_info /srv/veloz | grep -q 'ftype=1' || echo "SEM d_type — overlay2 NÃO funciona"

# 3) registrar o projeto (id = 10000 + env_id, mesmo número do uid — um id só para lembrar)
echo "10042:/srv/veloz/envs/e0042" >> /etc/projects
echo "e0042:10042"                 >> /etc/projid
xfs_quota -x -c 'project -s e0042' /srv/veloz
xfs_quota -x -c 'limit -p bsoft=9g bhard=10g e0042' /srv/veloz

# 4) ler uso sem `du` (barato, O(1)) — é isto que alimenta o gráfico de disco do painel
xfs_quota -x -c 'report -p -N -b' /srv/veloz | awk '$1=="e0042"{print $2*1024, $4*1024}'
#   -> usado_bytes  limite_bytes

# 5) alterar a cota a quente (upgrade de plano) — instantâneo, sem remount
xfs_quota -x -c 'limit -p bsoft=14g bhard=15g e0042' /srv/veloz
```

**[ACHADO NOVO] Se o provedor não deixa editar o GRUB e `/srv/veloz` está na raiz**, em ordem de
preferência:

1. **Partição/LV separada** para `/srv/veloz` (o normal em VPS com disco de dados). Preferido.
2. **Arquivo XFS em loop:** `truncate -s 150G /var/lib/veloz-data.img; mkfs.xfs -n ftype=1 …;
   mount -o loop,pquota,noatime /var/lib/veloz-data.img /srv/veloz`. Funciona, custa ~3–5% de I/O,
   e é feio. Aceitável para os 4–5 sistemas da fase de validação.
3. **Sem quota → não vender nesse nó.** Um cliente enche 200 GB e derruba os outros 21. Isto é regra,
   não recomendação: o `veloz-node-doctor.sh` deve marcar `CRÍTICO` e o CP recusar `status=ready`.

Complemento: `docker run --storage-opt size=2G` (só funciona em overlay2 + XFS + pquota) limita a
**camada gravável** do container — o que o cliente escreve fora dos bind mounts. Sem isso, um `apt install`
dentro do container escreve em `/var/lib/docker` sem limite.

### 2.6 Como o cliente instala extensão sem quebrar a imutabilidade

**A extensão já está na imagem, apenas desligada.** Ligar é escrever um arquivo `.ini` no **volume** e
recarregar o php-fpm. Zero rebuild, zero downtime, zero `apt`.

```bash
# agente, ao receber POST /envs/0042/php/extensions {"enable":["redis","imagick"]}
D=/srv/veloz/envs/e0042/etc/php/conf.d
printf 'extension=redis.so\n'   > "$D/20-redis.ini"
printf 'extension=imagick.so\n' > "$D/20-imagick.ini"
rm -f "$D/20-xdebug.ini"                     # desligar é apagar
docker kill -s SIGUSR2 e0042-php             # reload GRACIOSO do php-fpm: 0 requisição perdida
```

`SIGUSR2` no php-fpm master = *graceful reload*: relê a configuração, sobe workers novos e deixa os
antigos terminarem o que estão fazendo. É o mesmo mecanismo do `systemctl reload php-fpm`, sem systemd.

Validação obrigatória antes de escrever (senão o cliente derruba o próprio ambiente com um `.ini`
inválido): o agente roda `docker run --rm --user … -v $D:/conf.d velozpanel/php:8.3 php -n -c /conf.d -v`
num container efêmero. Se sair ≠ 0, recusa e mostra o erro. Custo: ~400 ms.

`php.ini` do cliente segue o mesmo caminho — `etc/php/conf.d/99-cliente.ini`, com **allowlist de
diretivas** (`memory_limit`, `max_execution_time`, `upload_max_filesize`, `post_max_size`, `date.timezone`,
`display_errors`). Diretiva fora da lista é rejeitada com mensagem clara. **`.user.ini` fica desligado**
(`user_ini.filename=` vazio no pool) — senão o cliente desliga `open_basedir` sem querer.

### 2.7 O cliente com SSH e o `apt install`: por que não pode, e o que ofereço no lugar

**Não pode**, e a razão é boa: o container é `--read-only` (§10.3) e roda sem `CAP_*`, então `apt` falha
por permissão; e mesmo se escrevesse na camada gravável, a troca de versão, o patch de segurança e a
migração de nó **recriam o container** e a mudança evapora. Oferecer `apt install` e depois perdê-lo
silenciosamente é pior do que não oferecer.

O que ofereço, em ordem do que resolve mais casos:

| Necessidade real | Solução oferecida | Persiste? |
|---|---|---|
| Extensão PHP da lista curada (~25) | toggle no painel (§2.6) | sim |
| Extensão PHP fora da lista | **ticket → entra na próxima build da imagem**, SLA declarado de **5 dias úteis**; a UI mostra o status do pedido | sim |
| Pacote PHP via composer / npm / pip | `composer install` normal, dentro do volume, com *boost* de RAM temporário (§4.6) | sim |
| Binário de linha de comando (ex.: `yt-dlp`, `pandoc`, `ffmpeg` estático) | `~/bin` no volume, já no `PATH` do container. O cliente baixa o binário estático e usa | sim |
| `ffmpeg`, `imagemagick`, `chromium` (headless) | **na imagem por padrão** nas versões que fazem sentido — decidido no catálogo, não por ticket | sim |
| Serviço de sistema (redis próprio, memcached) | **add-on pago**: container irmão no mesmo slice do ambiente (`e0042-redis`), gerenciado pelo painel | sim |
| Ambiente realmente arbitrário | **Fase 2, tier pago "imagem própria"**: o cliente envia um `Dockerfile` que **obrigatoriamente** começa com `FROM velozpanel/php:8.3`; nós construímos no CI, escaneamos (`trivy`), e o resultado vira a imagem do ambiente dele | sim |

O que o cliente **vê** ao tentar `apt install` — mensagem, não erro críptico. O `bash` do container tem
um wrapper:

```sh
# /usr/local/bin/apt-get e /usr/local/bin/apt (na imagem, à frente no PATH)
#!/bin/sh
cat >&2 <<'EOF'
Este ambiente é imutável: pacotes instalados aqui seriam perdidos na próxima
atualização de segurança ou troca de versão.
  • Extensão PHP?      Painel → PHP → Extensões (aplica em ~1 s, sem downtime)
  • Biblioteca PHP?    composer require ...   (persiste, está no seu volume)
  • Binário de CLI?    coloque em ~/bin — já está no seu PATH
  • Precisa de outra coisa?  Painel → Suporte → "Pedir pacote na imagem"
EOF
exit 1
```

Isso transforma o único ponto onde o modelo OCI perde (Achado 1.1) em uma decisão explicada, e não em
uma surpresa.

---

## 3. Pausar / iniciar

### 3.1 Comando exato

**Pausar = `docker stop`, não `docker pause`.** `docker pause` usa `cgroup.freeze=1`: congela os
processos e **mantém 100% da RAM alocada** — serve para conter um abusador, não para o requisito 5.

```bash
# ---------- PAUSA (agente, ao receber POST /envs/0042/pause) ----------
set -euo pipefail
ENV=0042; C=e${ENV}-php

# 1) borda deixa de mandar tráfego ANTES de derrubar o processo (evita 502, dá 503 correto)
printf 'location / { return 503; }\nerror_page 503 = @veloz_paused;\n' \
  > /etc/nginx/veloz/state/e${ENV}.conf.new
mv /etc/nginx/veloz/state/e${ENV}.conf.new /etc/nginx/veloz/state/e${ENV}.conf
nginx -t && systemctl reload nginx

# 2) drenar: SIGQUIT (STOPSIGNAL da imagem) = shutdown gracioso do php-fpm
docker stop --timeout 25 "$C"        # 25 s para terminar requisições em voo; depois SIGKILL

# 3) cortar o banco (o dado fica; o acesso não)
mariadb -e "ALTER USER 'e${ENV}'@'%' WITH MAX_USER_CONNECTIONS 0;"
mariadb -N -e "SELECT id FROM information_schema.processlist WHERE user='e${ENV}'" \
  | xargs -r -n1 mariadb -e "KILL"
psql -c "ALTER ROLE e${ENV} CONNECTION LIMIT 0;"
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='e${ENV}';"

# 4) desarmar cron do host e SSH
systemctl stop veloz-cron-e${ENV}.timer 2>/dev/null || true

# 5) estado + evento de cobrança (SÓ depois de confirmar que parou de verdade)
test "$(docker inspect -f '{{.State.Running}}' "$C")" = false
velozctl state set "$ENV" paused
```

```bash
# ---------- START ----------
docker start "$C"
# espera de prontidão real (não `sleep`): a porta FastCGI aceitando conexão
for i in $(seq 1 100); do
  (exec 3<>/dev/tcp/127.0.0.1/$((19000+ENV))) 2>/dev/null && { exec 3>&-; break; }
  sleep 0.05
done
# health check FastCGI de verdade, não só TCP
SCRIPT_FILENAME=/usr/share/veloz/healthz.php REQUEST_METHOD=GET \
  cgi-fcgi -bind -connect 127.0.0.1:$((19000+ENV)) | grep -q '^VELOZ_OK'

mariadb -e "ALTER USER 'e${ENV}'@'%' WITH MAX_USER_CONNECTIONS 30;"
psql   -c "ALTER ROLE e${ENV} CONNECTION LIMIT 30;"
rm -f /etc/nginx/veloz/state/e${ENV}.conf && : > /etc/nginx/veloz/state/e${ENV}.conf
nginx -t && systemctl reload nginx
systemctl start veloz-cron-e${ENV}.timer
velozctl state set "$ENV" running
```

**Detalhe que evita 90% dos 502:** a borda entra em 503 **antes** do `docker stop` e sai do 503 **depois**
do health check. Nunca o contrário.

### 3.2 O que acontece com cada coisa

| Componente | Pausado | Onde vive | Volta em |
|---|---|---|---|
| **Processos** (php-fpm/node, workers) | parados; `containerd-shim` também morre | container | ~0,3 s (`docker start`) |
| **RAM** | **100% liberada** — `memory.current` do slice vai a 0 | cgroup | — |
| **Disco / uploads / código** | **preservado integralmente**, cota continua contando | bind mount `/srv/veloz/envs/e0042` | — |
| **Camada gravável do container** | preservada (o container existe, só não roda) | overlay2 | — |
| **opcache `file_cache`** | **preservado** — é bind mount, não tmpfs. Corta ~40% do tempo da 1ª requisição no start | volume | — |
| **Banco do cliente** | **dados intactos**; `MAX_USER_CONNECTIONS 0` e sessões encerradas. O processo do MariaDB continua no ar (é compartilhado) e as páginas do cliente saem do buffer pool sozinhas por LRU | MariaDB/PG do nó | imediato |
| **Dump horário do banco** | **continua rodando** — é o que garante que a pausa longa não perde dado | host | — |
| **Cron do cliente** | **não executa**. Timers desativados; execuções perdidas **não** são enfileiradas (senão o start dispara 40 jobs de uma vez) | host → `docker exec` | no start |
| **Domínio / DNS autoritativo** | **continua respondendo normalmente** — o domínio não some, o site não "desaparece" da internet | serviço DNS do painel | — |
| **Registro A/AAAA** | continua apontando para o IP de borda do nó | — | — |
| **HTTP/HTTPS** | borda responde **503 + página branded**, com TLS válido | nginx de borda | — |
| **Certificado TLS** | **renovação continua**. Por isso o ACME é **DNS-01** com `lego`, não HTTP-01: não depende do ambiente estar no ar, e ainda serve para wildcard e para migração de nó (§8.2) | host | — |
| **E-mail (MX, webmail)** | **continua recebendo e entregando** — e-mail é serviço compartilhado, fora do container. O cliente lê e-mail com o site pausado | nó de e-mail (pós-MVP) | — |
| **SMTP de saída do site** | **não envia** (o `msmtp` está dentro do container) | — | no start |
| **SSH / SFTP do cliente** | **indisponível**, com mensagem clara no `sshd` de salto: *"ambiente pausado — inicie pelo painel para acessar"*, e **não** um erro críptico | — | no start |
| **Backup restic** | **continua** (é feito do diretório do host, não de dentro do container) | host | — |
| **Métricas/gráficos** | série temporal congelada em 0; o painel mostra a faixa cinza "pausado" no gráfico, não um buraco | VictoriaMetrics | — |

Esta tabela precisa aparecer **literalmente** no tooltip do botão "Pausar". É a fonte de 90% dos tickets
se ficar implícita.

### 3.3 Página 503 branded

```nginx
# /etc/nginx/veloz/snippets/paused.conf  (global, incluído em todos os server{})
location @veloz_paused {
    internal;
    add_header Retry-After 300 always;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    add_header X-Veloz-State "paused" always;
    default_type text/html;
    root /usr/share/velozpanel/pages;
    try_files /paused.html =503;
}
# endpoint de acordar, servido pelo agente local
location = /_veloz/wake {
    limit_req zone=veloz_wake burst=3 nodelay;
    proxy_pass http://127.0.0.1:9797/wake/$veloz_env_id;
}
```

Requisitos da `paused.html`, que não são estética:

- **Status HTTP 503**, nunca 200. Um 200 numa página de erro faz o Google indexar "site pausado" e o
  cliente perde ranking — dano real e irreversível em semanas.
- `<meta name="robots" content="noindex">` e `Retry-After: 300`.
- Marca do painel + **nome do domínio** + "Este site está temporariamente pausado pelo proprietário".
- Sem `<script>` externo, sem fonte externa, sem CDN — a página tem que funcionar com a rede degradada
  e passar na CSP do painel (ADENDO 2 §E).
- Acessível: contraste AA, `lang="pt-BR"`, `<h1>` real, sem *div soup*. É a página mais vista do produto
  depois do painel.
- **Botão "Sou o dono, iniciar agora"** → leva ao painel, não ao endpoint de wake (senão qualquer
  visitante acorda o ambiente e gera cobrança).
- **Opção do cliente, default DESLIGADO: "acordar ao receber visita".** Se ligada, a página faz
  `fetch('/_veloz/wake', {method:'POST'})` e faz *polling* de `/` a cada 1 s. Isso é melhor do que segurar
  a conexão do visitante por 3 s (estoura timeout de bot, de CDN e de checador de uptime). Rate limit
  obrigatório (`limit_req zone=veloz_wake`), senão vira vetor de custo: um bot acorda o ambiente 200×/dia.

### 3.4 Tempo alvo de start (medido, não estimado)

| Etapa | Alvo | Como medir |
|---|---:|---|
| `docker start` retorna | 150–400 ms | `time docker start` |
| PID 1 aceitando na porta FastCGI | +100–300 ms | loop `/dev/tcp` acima |
| `healthz.php` respondendo | +50 ms | `cgi-fcgi` |
| `nginx reload` da borda (sai do 503) | +150–400 ms | `time systemctl reload nginx` |
| 1ª requisição WordPress, **opcache `file_cache` quente** | +400–900 ms | `curl -w %{time_total}` |
| 1ª requisição WordPress, **opcache frio** (1º start após deploy) | +1,5–3,0 s | idem |
| **Total p95 (clique → primeira página)** | **alvo < 5 s · meta interna 2,5 s** | 30 ciclos, T2 |

Alavancas se estourar: `opcache.file_cache` persistente (já está no layout, §2.3, e é o maior ganho),
`opcache.validate_timestamps=0` com invalidação no deploy, e **pré-aquecimento**: após o health check, o
agente faz 3 requisições a `/` antes de tirar o 503 — o cliente espera 300 ms a mais e o **visitante**
nunca pega a página fria.

### 3.5 `desired_state` sobrevivendo ao reboot do host

O princípio: **o Docker nunca decide sozinho o que sobe. O agente decide, e a cobrança segue o estado
observado, não o desejado.**

**Regra 1 — `--restart=no` em todos os containers de ambiente.** Nunca `always` (ressuscita ambiente
pausado). Nunca `unless-stopped` (é sutil demais: depende de *como* o container parou, e um `docker kill`
acidental muda o comportamento). Regra de lint no repositório do agente: `--restart=always` e
`--restart=unless-stopped` são proibidos.

**Regra 2 — reconciliação explícita no boot.**

```ini
# /etc/systemd/system/veloz-reconcile.service
[Unit]
Description=VelozPanel — reconcilia ambientes com o desired_state
After=docker.service network-online.target local-fs.target
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/velozctl reconcile --boot
TimeoutStartSec=600
[Install]
WantedBy=multi-user.target
```

O que `velozctl reconcile --boot` faz, em ordem:

1. Lê `/var/lib/veloz/agent.sqlite` (tabela `env_desired`: `env_id, desired_state, mem_max, cpu_quota,
   image_digest, updated_at, cp_version`). Este arquivo é a **última verdade conhecida**, sincronizada
   do control plane a cada mudança e revalidada a cada 60 s.
2. Tenta falar com o CP por 30 s. Se conseguir, **o CP vence** e o SQLite é atualizado.
   Se não conseguir (o CP está em outro provedor, pela internet pública — vai acontecer):
   **usa o SQLite e prossegue**. O nó não pode ficar refém do CP.
3. Recria os slices (`veloz-env-*.slice`) e reaplica `MemoryMax`/`MemoryHigh`/`CPUQuota`/`IOWeight`.
   *(Se os limites estiverem em unidades `.slice` versionadas em `/etc/systemd/system/`, o systemd já os
   aplica sozinho no boot — a reaplicação é cinto e suspensório, e cobre o caso do `set-property --runtime`.)*
4. Para cada ambiente com `desired_state='running'`: `docker start` + health check + sai do 503.
5. Para cada ambiente com `desired_state='paused'`: **não faz nada**, e garante o 503 na borda.
6. Container rodando **sem** registro de `desired_state` (lixo, resto de migração) → para, não apaga,
   e abre um alerta. Nunca apagar dado por reconciliação automática.
7. Emite um evento `node.rebooted` com a lista do que subiu e do que ficou parado.

**Regra 3 — direção segura na dúvida: NÃO iniciar.** Se o SQLite estiver corrompido e o CP inacessível,
o agente **não sobe nada** e alerta. Errar para o lado de "site fora" é ruim; errar para o lado de
"cobrei do cliente por um ambiente que ele tinha pausado, e ainda expus na internet um ambiente que ele
mandou parar" é pior — e é fraude, do ponto de vista dele.

**Regra 4 — cobrança pelo estado OBSERVADO.** O agente reporta, a cada 60 s, o estado real
(`docker inspect -f '{{.State.Running}}{{.State.StartedAt}}'`) de todos os ambientes. O motor de cobrança
integra **intervalos observados**, não transições desejadas. Consequências, todas desejáveis:

- Reboot do host de 4 minutos = **4 minutos não cobrados**. O cliente não paga pela nossa manutenção.
- Ambiente que morreu por OOM às 3h e o agente reiniciou às 3h02 = 2 minutos não cobrados, e um incidente
  registrado.
- Ambiente ressuscitado por engano gera evento de cobrança — e por isso a Regra 1 existe.
- **Reconciliação horária obrigatória:** somar os intervalos observados e comparar com a soma das
  transições. Divergência > 0,5% **bloqueia o fechamento do ciclo** e abre alerta (é o benchmark B10 da
  crítica).

**Regra 5 — `live-restore`.** `/etc/docker/daemon.json` com `"live-restore": true` faz os containers
sobreviverem a um `systemctl restart docker` (atualização do Docker, por exemplo). Sem isso, todo upgrade
do daemon derruba os 22 clientes de uma vez.

### 3.6 Auto-pausa por inatividade — sem falso positivo

Proposta do Produto/UX (`01` §5.3). É o argumento de venda mais forte da cobrança por hora e o jeito mais
fácil de destruir a confiança do cliente. Desenho:

**Sempre opt-in, default DESLIGADO.** Nunca ligar por padrão, nunca ligar retroativamente.

**Sinais que contam como "atividade" — todos precisam estar zerados na janela:**

| # | Sinal | Fonte | Como não gerar falso positivo |
|---|---|---|---|
| 1 | Requisição HTTP **qualificada** na borda | log da borda → `vector` → contador por ambiente | *Qualificada* exclui: (a) UA de monitor conhecido (UptimeRobot, Pingdom, BetterUptime, StatusCake, Site24x7, `curl`, `wget`, `Go-http-client`); (b) `/favicon.ico`, `/robots.txt`, `/.well-known/*`, `/apple-touch-icon*`; (c) o próprio health check do painel; (d) respostas 4xx a caminhos de scan (`/wp-login.php` de IP sem cookie, `/.env`, `/.git/*`) — **bot de ataque não é usuário** |
| 2 | Execução de cron do cliente | `veloz-cron-e0042.timer` | conta como atividade; e nunca pausar se houver cron agendado nos próximos 30 min |
| 3 | Sessão SSH/SFTP | `sshd` de salto | conta a sessão e mais 30 min de carência |
| 4 | Conexão ao banco do cliente | `information_schema.processlist` / `pg_stat_activity` | pega o cliente que usa o banco por túnel sem tocar no site |
| 5 | Deploy / job do painel | fila do CP | pausa fica bloqueada enquanto houver job aberto para o ambiente |
| 6 | Processo persistente declarado | manifesto do runtime (`persistent = true`) | **auto-pausa fica indisponível** para bot do Telegram, worker de fila, WebSocket, MQTT — a UI diz por quê |
| 7 | Egress do container | `nftables` counter por bridge | pega worker que só fala com API externa (o caso 6 sem declaração) |

**Algoritmo:**

```
janela N (default 12 h, mínimo permitido 6 h, configurável pelo cliente)
se (sinais 1..5,7 == 0 durante N horas consecutivas) e (sinal 6 == false):
    T-30min : notificar (e-mail + painel + webhook) — "vamos pausar às HH:MM"
              botão [Manter ativo por 24 h] e [Desligar auto-pausa]
    T       : reavaliar TUDO de novo (o cliente pode ter entrado nos últimos 30 min)
              pausar; registrar evento auto_pause com os 7 contadores anexados
```

**Anti-flapping, que é onde estes sistemas costumam falhar:**

- Se o ambiente for iniciado em **menos de 15 min** após uma auto-pausa, a auto-pausa é **desativada
  para aquele ambiente por 7 dias**, com aviso no painel: *"pausamos e você precisou voltar logo —
  desligamos a pausa automática por uma semana"*. Isso torna o falso positivo autocorretivo.
- Máximo de **1 auto-pausa por 24 h** por ambiente.
- Nunca auto-pausar nas **primeiras 72 h** de vida de um ambiente (o cliente ainda está montando o site).
- Nunca auto-pausar durante **janela de backup** ou de **troca de versão**.
- **Auditoria com prova:** o evento `auto_pause` guarda os 7 contadores da janela. Quando o cliente
  reclamar ("meu site caiu sozinho"), a resposta é uma tabela, não uma desculpa. Sem isso, cada auto-pausa
  vira um ticket de 30 minutos — e a §6.5 da crítica mostra que suporte é o custo dominante.

**Pausa agendada** (o irmão fácil da auto-pausa, e que eu entrego primeiro): cron do painel com
`pause_cron`/`start_cron` por ambiente (ex.: homologação pausa 20:00, inicia 08:00, seg–sex). Sem
heurística, sem falso positivo, e cobre o caso de uso que mais economiza. **Entregar a pausa agendada no
MVP e a auto-pausa por inatividade só depois de 60 dias de dados de tráfego reais.**

---

## 4. Hot-resize de RAM e vCPU (requisito 9 do dono)

### 4.1 Comando exato

A fonte da verdade dos limites é a **slice systemd**, não o container. Motivos, em ordem:

1. **Persiste no reboot** (`systemctl set-property` sem `--runtime` grava em
   `/etc/systemd/system.control/veloz-env-0042.slice.d/50-*.conf`).
2. **Sobrevive ao `docker rm`** da troca de versão — o container novo entra na mesma slice já limitada.
   Com `docker update`, o limite morre junto com o container e precisa ser reaplicado (fonte clássica de
   "o cliente pagou 2 GB e voltou a 512 MB depois da troca de PHP").
3. **Expõe `MemoryHigh`**, que o Docker não expõe (`--memory-reservation` mapeia para `memory.low`,
   que é *proteção*, não *throttle* — coisa diferente). E `memory.high` é o que evita OOM.

```bash
# ---------- HOT-RESIZE (agente) ----------
ENV=0042; SLICE=veloz-env-${ENV}.slice
CG=/sys/fs/cgroup/veloz.slice/veloz-env.slice/${SLICE}

# 512 MB / 1 vCPU  ->  2 GB / 2 vCPU   — sem reiniciar nada
systemctl set-property "$SLICE" \
  MemoryMax=2G MemoryHigh=1638M MemorySwapMax=0 \
  CPUQuota=200% CPUWeight=200 \
  IOWeight=200 TasksMax=512

# leitura de volta OBRIGATÓRIA — é o que autoriza o evento de cobrança
cat $CG/memory.max      # 2147483648
cat $CG/memory.high     # 1717567488
cat $CG/cpu.max         # 200000 100000
cat $CG/cpu.weight      # 79   (systemd converte CPUWeight 200 -> cpu.weight 79)
```

Plano B, se por algum motivo a slice não estiver disponível (ex.: driver de cgroup `cgroupfs`):
```bash
docker update --memory 2g --memory-swap 2g --cpus 2 e0042-php
```
Escreve **exatamente os mesmos arquivos** (`memory.max`, `cpu.max`) — é o mesmo mecanismo do
`incus config set` que o doc 04 usava. O empate do Achado 1.3 é literal: mesma primitiva de kernel.

**Pré-requisito de daemon** (sem isto, `--cgroup-parent` não funciona):
```json
{ "exec-opts": ["native.cgroupdriver=systemd"] }
```

### 4.2 O que o kernel faz

| Operação | O que acontece | Latência |
|---|---|---|
| **Aumentar `memory.max`** | grava o novo valor; nada mais. Nenhum processo é tocado, nenhuma página é movida | < 1 ms |
| **Aumentar `memory.high`** | idem; se havia throttle ativo, ele para no mesmo instante | < 1 ms |
| **Diminuir `memory.high`** | dispara **reclaim síncrono** e passa a impor *throttle* proporcional em quem alocar. **Nunca mata processo** | reclaim de centenas de ms a segundos |
| **Diminuir `memory.max`** abaixo de `memory.current` | o kernel tenta reclaim até o novo limite; **se não conseguir, invoca o OOM killer do memcg no ato do `write()`** | **OOM imediato** |
| **Mudar `cpu.max`** (quota) | novo período de quota vale já no próximo período de 100 ms. Nenhuma invalidação de cache, nenhuma migração de task | < 100 ms |
| **Mudar `cpu.weight`** | recalcula peso relativo sob contenção | imediato |
| Mudar `cpuset` (pinning) | **não usamos** — é o que causa invalidação de cache e não é seguro a quente em kernel antigo. `CPUQuota` percentual é a escolha, exatamente como no doc 04 §3.3 |

> **Resposta direta à pergunta do briefing: SIM, reduzir a RAM abaixo do uso atual causa OOM imediato.**
> Não é teórico, não depende de carga, e o processo morto normalmente é o maior — o master do php-fpm ou
> o processo Node do cliente. O site cai no instante do clique do admin.

Isto é exatamente o teste **T5** da crítica, que ela mandou "documentar o erro porque quebra o
requisito 9 e nenhum doc trata". Está tratado abaixo.

### 4.3 Redução segura — o procedimento, incluindo "admin reduz RAM de um cliente no pico"

**Regra: a API de resize NUNCA reduz `MemoryMax` diretamente. Ela executa a máquina de estados abaixo.**

```bash
#!/usr/bin/env bash
# velozctl resize --env 0042 --mem 1G --cpu 100 [--force] [--schedule "03:00"]
set -euo pipefail
ENV=$1; TARGET=$2                     # TARGET em bytes
SLICE=veloz-env-${ENV}.slice
CG=/sys/fs/cgroup/veloz.slice/veloz-env.slice/${SLICE}
CUR=$(cat $CG/memory.current)

# --- CASO A: aumento, ou redução com folga >= 15% -> aplica direto
if [ "$TARGET" -ge "$((CUR * 115 / 100))" ]; then
  systemctl set-property "$SLICE" MemoryMax=${TARGET} MemoryHigh=$((TARGET*80/100))
  veloz_emit_resize_event "$ENV" applied
  exit 0
fi

# --- CASO B: redução abaixo/perto do uso -> ESCALONADA, sem matar ninguém
# B1. reduzir a demanda ANTES do limite: recalcular pm.max_children e recarregar
NEWCH=$(( TARGET * 60 / 100 / AVG_WORKER_BYTES ))          # 60% do plano para workers
[ "$NEWCH" -lt 2 ] && NEWCH=2
sed -i "s/^pm.max_children.*/pm.max_children = ${NEWCH}/" \
  /srv/veloz/envs/e${ENV}/etc/php/pool.d/veloz.conf
docker kill -s SIGUSR2 e${ENV}-php                          # reload gracioso: 0 requisição perdida

# B2. pressionar com memory.high (throttle + reclaim, NUNCA mata)
systemctl set-property "$SLICE" MemoryHigh=${TARGET}

# B3. observar por até 120 s
for i in $(seq 1 24); do
  sleep 5; CUR=$(cat $CG/memory.current)
  [ "$CUR" -le "$((TARGET * 95 / 100))" ] && break
done

# B4. decidir
if [ "$CUR" -le "$((TARGET * 95 / 100))" ]; then
  systemctl set-property "$SLICE" MemoryMax=${TARGET}
  veloz_emit_resize_event "$ENV" applied
else
  systemctl set-property "$SLICE" MemoryHigh=$(cat $CG/memory.max)   # desfaz a pressão
  veloz_emit_resize_event "$ENV" refused "uso atual ${CUR}B > alvo ${TARGET}B"
  exit 75      # EX_TEMPFAIL — a UI mostra as opções, não um stack trace
fi
```

**O que o admin vê quando a redução é recusada** — e isto é especificação de UI, não enfeite:

> **Redução recusada — o ambiente está usando 1,74 GB e você pediu 1,00 GB.**
> Aplicar agora derrubaria o site do cliente (OOM imediato).
> Uso atual: 1,74 GB · Pico 24 h: 1,91 GB · Workers PHP ativos: 9
> `[Agendar para 03:00]` `[Reduzir em degraus: 2G → 1,5G → 1G em 3 dias]`
> `[Forçar agora — o site vai cair]` (exige digitar o nome do ambiente)

**Caso "admin reduz RAM de um cliente que está no pico":** é o caso B com `CUR` alto e não convergindo.
Três saídas, e a política é decidida **antes**, não no calor do incidente:

| Motivo do admin | Política | Aviso ao cliente |
|---|---|---|
| **Downgrade comercial** (cliente pediu plano menor) | agenda para a próxima janela de baixo tráfego do ambiente (o painel sabe qual é, pelo histórico), executa o caso B lá | e-mail imediato: "seu downgrade será aplicado às 03:00" |
| **Correção de erro** (admin provisionou errado) | degraus, 1 por dia, até o alvo | notificação a cada degrau |
| **Contenção de abuso** (AUP: o cliente está prejudicando os vizinhos) | **`--force` é permitido**, imediato, com registro de auditoria e o artigo da AUP citado | e-mail imediato com motivo e como regularizar |

`--force` faz o `write()` direto em `memory.max`, o kernel mata, e o agente **espera o container voltar**
(`docker start` se o PID 1 morreu) e registra o incidente. Nunca deixar o ambiente morto após um force.

**Guarda-corpo agregado:** um aumento de RAM que faria
`soma(MemoryMax dos running) > 1,3 × MemoryMax(veloz-env.slice)` é **recusado com HTTP 409** e a mensagem
diz o número: *"o nó n1 tem 640 MB de folga; este upgrade pede 1.536 MB. Migrar o ambiente para n2 ou
liberar capacidade."* Sem esse guarda-corpo, o requisito 9 vira a maneira mais fácil de derrubar um nó.

### 4.4 O que mais precisa mudar junto (senão o resize não faz nada)

**php-fpm não sabe que ganhou memória.** Aumentar `MemoryMax` sem mexer no pool não muda nada:
`pm.max_children` continua igual, a concorrência continua igual, o cliente pagou e não viu diferença.
O agente **sempre** recalcula e recarrega:

```
pm.max_children = floor( (MemoryMax * 0.60) / avg_worker_bytes )
avg_worker_bytes = medido de fato pelo agente (p75 do RSS dos workers nas últimas 24 h);
                   default conservador 80 MB até haver medição
pm.max_requests  = 500      (corta leak de extensão)
pm = ondemand; pm.process_idle_timeout = 20s     (libera RAM entre picos — essencial para densidade)
```
Aplicado com `docker kill -s SIGUSR2` — gracioso, zero downtime.

**Node não sabe que ganhou vCPU.** `os.cpus().length` e o dimensionamento do `libuv` threadpool são lidos
**no start** e enxergam os 6 vCPU do host, não a quota do cgroup. Um app que fez `cluster.fork()` por CPU
já subiu com 6 workers. Ao mudar vCPU de um ambiente Node, o painel mostra:
*"aplicado ao kernel; seu app precisa reiniciar para enxergar o novo número de vCPU"* com botão
`[Reiniciar app]`. E o manifesto do runtime Node injeta `UV_THREADPOOL_SIZE` e
`NODE_OPTIONS=--max-old-space-size=<70% do plano>` a cada start, derivados do limite atual — isso é
recalculado no resize e vale no próximo restart.

**Limites que acompanham o plano:** `TasksMax` (pids), `IOWeight`, `MAX_USER_CONNECTIONS` do banco,
`limit_req` da borda e `worker_connections` — todos derivados do plano por uma **única função pura**
(`planToLimits(plan)`), testada, no `packages/contracts`. Um lugar só, senão eles divergem em três meses.

### 4.5 Como isso vira evento de cobrança no mesmo instante

**Regra de ouro: o evento só é emitido depois da leitura de volta do cgroup.** Se o kernel não confirmou,
não há cobrança — nem a maior, nem a menor.

```json
{
  "ts": "2026-08-20T14:03:11.482Z",
  "env": "0042", "node": "n1", "type": "resize",
  "actor": {"kind": "admin", "id": "u_7", "ip": "203.0.113.9"},
  "reason": "upgrade solicitado pelo cliente (ticket #331)",
  "from": {"mem_bytes": 536870912,  "cpu_pct": 100, "disk_bytes": 10737418240},
  "to":   {"mem_bytes": 2147483648, "cpu_pct": 200, "disk_bytes": 10737418240},
  "applied": {"memory_max": 2147483648, "cpu_max": "200000 100000"},
  "idempotency_key": "resize:0042:1755698591482"
}
```

- **Fechamento e abertura de intervalo:** o motor fecha o intervalo aberto em `ts` e abre um novo. A conta
  é por segundo, agregada por hora. O cliente vê no extrato duas linhas no mesmo dia, com o horário exato.
- **Unidade mínima de cobrança: 60 s.** Impede que 40 resizes num minuto virem 40 linhas de R$ 0,0001 e
  um extrato ilegível.
- **Rate limit: 10 resizes/dia por ambiente** no plano normal. Além disso, HTTP 429. (Sem isso, um script
  do cliente oscilando entre planos é um vetor de custo e de ruído contábil.)
- **Sem proration retroativa.** O resize vale de `ts` em diante. Nunca reprecificar o passado — é a
  origem clássica de estorno e de perda de confiança.
- **Downgrade recusado não gera evento.** O ambiente continua no plano antigo e continua sendo cobrado
  por ele. A UI diz isso com todas as letras, senão o cliente acha que já está pagando menos.
- **Downgrade agendado:** cria uma `scheduled_action`; a cobrança muda **quando executa**, não quando
  é agendada.
- **Auditoria:** `actor` é obrigatório e a UI do cliente mostra "alterado pelo suporte VelozPanel em
  20/08 às 14:03 — motivo: …". Admin mudar recurso do cliente sem rastro é problema de LGPD e de
  contrato, não só de engenharia.
- **Reconciliação (B10):** de hora em hora, `Σ intervalos observados` × `preço` comparado com
  `Σ eventos`. Divergência > 0,5% trava o fechamento. É o mesmo mecanismo do §3.5, Regra 4.

---

## 5. Multi-versão de runtime

### 5.1 É recriar o container? Sim. E quanto de downtime?

Sim: no modelo OCI a versão **é** a imagem, então trocar de versão é `docker rm` + `docker run` com outra
imagem. Isso soa pior do que é: com o blue/green por porta, o container novo sobe **em paralelo** e a
troca acontece num `mv` + `reload` da borda.

```bash
#!/usr/bin/env bash
# velozctl runtime switch --env 0042 --to php:8.3
set -euo pipefail
ENV=0042; OLD_PORT=$((19000+ENV)); NEW_PORT=$((29000+ENV))
NEW_IMG="ghcr.io/velozpanel/php@sha256:<digest-8.3>"
SLICE=veloz-env-${ENV}.slice

# 0) pré-checagem (semáforo mostrado na UI ANTES do botão) — ver §5.3
velozctl runtime precheck --env $ENV --to php:8.3 || exit 1

# 1) folga temporária: dois masters de php-fpm coexistem por ~30 s
CURMAX=$(cat /sys/fs/cgroup/veloz.slice/veloz-env.slice/$SLICE/memory.max)
systemctl set-property "$SLICE" MemoryMax=$((CURMAX*125/100))

# 2) sobe o GREEN, mesma slice, mesmos volumes, porta nova
docker run -d --name e${ENV}-php-green --cgroup-parent="$SLICE" \
  $(velozctl render-run-args --env $ENV --port $NEW_PORT) "$NEW_IMG"

# 3) health check REAL (não `sleep`): FastCGI + a home do site pelo vhost sombra
for i in $(seq 1 60); do (exec 3<>/dev/tcp/127.0.0.1/$NEW_PORT) 2>/dev/null && break; sleep 0.1; done
SCRIPT_FILENAME=/usr/share/veloz/healthz.php cgi-fcgi -bind -connect 127.0.0.1:$NEW_PORT | grep -q VELOZ_OK
curl -sf -o /dev/null -w '%{http_code}' --resolve "$DOM:443:127.0.0.1" \
     -H 'X-Veloz-Shadow: 1' "https://$DOM/" | grep -qE '^(200|301|302)$'

# 4) TROCA ATÔMICA do upstream + reload gracioso da borda
printf 'upstream veloz_e%s { server 127.0.0.1:%s; keepalive 8; }\n' "$ENV" "$NEW_PORT" \
  > /etc/nginx/veloz/upstream/e${ENV}.conf.new
mv /etc/nginx/veloz/upstream/e${ENV}.conf.new /etc/nginx/veloz/upstream/e${ENV}.conf
nginx -t && systemctl reload nginx        # workers antigos terminam o que está em voo

# 5) validação pós-troca: 10 requisições reais
FAIL=$(for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' "https://$DOM/"; done | grep -c '^5')
if [ "$FAIL" -ge 3 ]; then velozctl runtime rollback --env $ENV; exit 1; fi

# 6) drena e mantém o BLUE parado por 10 min (rollback instantâneo)
sleep 15
docker stop --timeout 25 e${ENV}-php        # SIGQUIT
docker rename e${ENV}-php       e${ENV}-php-blue-$(date +%s)
docker rename e${ENV}-php-green e${ENV}-php
systemctl set-property "$SLICE" MemoryMax=$CURMAX      # devolve a folga
velozctl runtime commit --env $ENV --image "$NEW_IMG" --keep-previous 10m
```

**Downtime real: zero requisição perdida.** O `reload` do nginx mantém os workers antigos vivos até
terminarem (`worker_shutdown_timeout 30s`), e o container antigo só morre 15 s depois. O critério de
aceite do teste T6 é **< 2 s de indisponibilidade**; o alvo desta rotina é **0 erro em 200 requisições
durante a janela**.

O custo real da troca não é downtime, é **RAM temporária**: dois masters de php-fpm no mesmo slice por
~30 s. Por isso o passo 1. Num nó em 1,3× de overcommit, o agente precisa **serializar** trocas de versão
(no máximo 2 simultâneas por nó) — senão 10 clientes trocando de PHP ao mesmo tempo estouram o
`veloz-env.slice`.

**Node é igual, com uma diferença:** o processo do cliente precisa de `readiness` própria. O health check
do passo 3 usa o `health.path` do manifesto (§5.4) em vez do `cgi-fcgi`, e o `stop` usa `SIGTERM` com
`--stop-timeout` maior (apps Node costumam demorar mais para drenar conexões abertas).

### 5.2 "Testar antes de promover" (proposta do Produto/UX `01` §5.3)

O container GREEN já existe no passo 2 — o modo de teste é simplesmente **não executar o passo 4**, e em
vez disso apontar o **domínio alternativo** para ele:

```nginx
# /etc/nginx/veloz/sites/e0042-shadow.conf  (gerado só durante o teste)
server {
    server_name p1ulbhre.veloz.app;          # domínio alternativo do ambiente
    include /etc/nginx/veloz/snippets/tls.conf;
    root /srv/veloz/envs/e0042/app/public;
    add_header X-Veloz-Runtime "php-8.3 (teste)" always;
    add_header X-Robots-Tag "noindex, nofollow" always;   # NUNCA indexar o domínio de teste
    location ~ \.php$ { include fastcgi_params; fastcgi_pass 127.0.0.1:29042;
                        fastcgi_param SCRIPT_FILENAME /srv/app/public$fastcgi_script_name; }
}
```

Fluxo na UI: `[Testar antes]` → banner com o link do domínio alternativo, um contador de 30 min, e
`[Promover]` / `[Descartar]`. `Promover` executa os passos 4–6. `Descartar` faz `docker rm -f` do green e
remove o vhost sombra. Expiração automática em 30 min = descartar.

**A ressalva honesta que precisa estar na UI, em texto, não em rodapé:** o container de teste
**compartilha o mesmo volume e o mesmo banco** do ambiente de produção. Isso é seguro para o que 95% das
trocas de versão fazem (executar o mesmo código com outro interpretador), mas **não é um ambiente de
staging**: se você rodar o instalador de um plugin, uma migração de banco ou um `wp core update` no
domínio de teste, isso afeta o site de verdade.

> Texto proposto para a UI: *"O teste usa os mesmos arquivos e o mesmo banco do seu site. Navegue e
> confira as páginas. **Não** rode instalações, atualizações ou migrações no endereço de teste."*

Staging de verdade (volume clonado + banco clonado + `.env` reescrito) é uma **feature separada e paga**
(`Clonar ambiente`), fase 2. Vendê-la como grátis dentro do "testar antes" seria mentira — e criaria a
expectativa mais cara do produto.

### 5.3 Pré-checagem e rollback

**Pré-checagem** (o semáforo antes do botão; evita a maior parte dos rollbacks, custa < 2 s):

| Verificação | Como | Resultado |
|---|---|---|
| Extensões carregadas hoje existem na versão nova | comparar `etc/php/conf.d/*.ini` com a lista da imagem alvo (`docker run --rm <img> php -m`) | **vermelho** se faltar (é a causa #1 de rollback: `imagick`) |
| `composer.json` declara `php` compatível | ler `require.php` do volume e testar contra a versão alvo | amarelo |
| Deprecações óbvias | `docker run --rm -v vol:/srv/app <img> php -l` em `index.php` + nos arquivos de `wp-content/mu-plugins` e `app/` (não no projeto inteiro — é caro) | amarelo |
| Versão alvo está EOL | catálogo de imagens | **vermelho com override**: PHP 7.4/8.0 são "legado, sem promessa de patch de segurança", e a UI diz isso com todas as letras |
| Folga de RAM no nó para o green | `veloz-env.slice` | vermelho se não couber |

**Rollback**, três camadas:

1. **Automático (10 min):** o container BLUE fica parado, não removido. Rollback = trocar o upstream de
   volta e `docker start` do blue. **< 2 s.** É o passo 5 do script.
2. **Curto (7 dias):** o registro do ambiente guarda `image_digest_previous`. Rollback = a mesma rotina
   de troca, na direção contrária. Downtime: zero, mesma rotina blue/green.
3. **Longo:** o digest antigo continua no registry. A GC de imagens do nó (`docker image prune`) é
   **proibida em modo automático**; o agente mantém uma tabela `image_refs` (digest → ambientes que o
   usam + os que o usaram nos últimos 7 dias) e só remove o que tem zero referências. Sem essa tabela, um
   `prune` semanal apaga a imagem de rollback de 20 clientes.

### 5.4 Manifesto declarativo de runtime — adicionar Python/Go/Ruby sem tocar no core

**Contrato:** o core lê `schema = 1` e **nunca** contém `if runtime == "php"`. Todo comportamento
específico é declarado. Um runtime novo é **um arquivo `.toml` + uma imagem + um teste**, entregue por um
módulo (`mod-runtime-python`), instalável e removível como qualquer outro módulo (requisito 2 do briefing).

```toml
# /usr/share/velozpanel/runtimes/php.toml         (módulo mod-runtime-php)
schema  = 1
name    = "php"
label   = "PHP"
kind    = "fastcgi"                 # fastcgi | http | static | worker

[[versions]]
v = "8.3"; image = "ghcr.io/velozpanel/php"; digest = "sha256:aaaa…"
eol = "2027-12-31"; default = true
[[versions]]
v = "7.4"; image = "ghcr.io/velozpanel/php"; digest = "sha256:bbbb…"
eol = "2022-11-28"; legacy = true
legacy_warning = "Sem patches de segurança desde nov/2022. Use por sua conta e risco."

[container]
port         = 9000                 # o agente publica em 127.0.0.1:(19000+env_id)
user         = "{env_uid}:{env_gid}"
workdir      = "/srv/app"
stop_signal  = "SIGQUIT"
stop_timeout = 25
init         = false                # php-fpm master já faz reaping
read_only    = true
persistent   = false                # true bloqueia auto-pausa (§3.6, sinal 6)

[[mounts]]
src = "app";            dst = "/srv/app";                     mode = "rw"
[[mounts]]
src = "etc/php/conf.d"; dst = "/etc/php/{v}/fpm/conf.d";       mode = "ro"
[[mounts]]
src = "etc/php/pool.d"; dst = "/etc/php/{v}/fpm/pool.d";       mode = "ro"
[[mounts]]
src = "cache/opcache";  dst = "/var/cache/php/opcache";        mode = "rw"
[[mounts]]
src = "logs";           dst = "/srv/app/logs";                 mode = "rw"

[health]
type = "fastcgi"; script = "/usr/share/veloz/healthz.php"; expect = "VELOZ_OK"
timeout_s = 10; retries = 60; interval_ms = 100

[switch]
strategy = "bluegreen-port"         # bluegreen-port | recreate | reload-inplace
warm_requests = 3

[hooks]
on_resize     = "phpfpm-children"   # phpfpm-children | node-env | none
on_reload     = "signal:SIGUSR2"    # signal:<SIG> | recreate | none
on_deploy     = "opcache-reset"
[hooks.build]
enabled = false

[extensions]
kind    = "ini-toggle"              # ini-toggle | none | pip | gem
dir     = "etc/php/conf.d"
template= "extension={name}.so"
catalog = ["redis","imagick","intl","gd","mbstring","zip","bcmath","soap",
           "memcached","apcu","igbinary","gmp","ldap","exif","sqlite3","xdebug"]
[extensions.warn]
xdebug = "Reduz a performance em até 5×. Desligamos automaticamente em 2 h."

[limits]
env_template = { PHP_MEMORY_LIMIT = "{mem_mb_60pct}M" }

[logs]
stdout = true; files = ["logs/php-access.log", "logs/php-slow.log"]
```

```toml
# /usr/share/velozpanel/runtimes/python.toml      (módulo mod-runtime-python — nenhuma linha no core)
schema = 1
name = "python"; label = "Python"; kind = "http"

[[versions]]
v = "3.13"; image = "ghcr.io/velozpanel/python"; digest = "sha256:cccc…"
eol = "2029-10-31"; default = true

[container]
port = 8080; user = "{env_uid}:{env_gid}"; workdir = "/srv/app"
command = ["/srv/app/.venv/bin/gunicorn","-b","0.0.0.0:8080",
           "-w","{workers}","--timeout","60","{entry}"]
env = { PYTHONUNBUFFERED = "1", PORT = "8080", WEB_CONCURRENCY = "{workers}" }
stop_signal = "SIGTERM"; stop_timeout = 30
init = true                         # gunicorn master não faz reaping de netos
read_only = true
persistent = true                   # é um processo de longa duração -> sem auto-pausa

[vars]
workers = "max(2, floor(cpu_pct/100) * 2 + 1)"     # expressão avaliada por um avaliador restrito
entry   = "{app_entry}"                             # campo da UI, default "app:app"

[health]
type = "http"; path = "/healthz"; expect_status = [200,204]
timeout_s = 15; retries = 60; interval_ms = 250

[switch]
strategy = "bluegreen-port"; warm_requests = 2

[hooks]
on_resize = "restart-required"      # avisa na UI; não reinicia sozinho
on_reload = "recreate"
[hooks.build]
enabled  = true
command  = ["/srv/app/.venv/bin/pip","install","-r","requirements.txt"]
mem_boost= "1G"                     # eleva MemoryMax só durante o build
timeout_s= 900

[extensions]
kind = "none"
[logs]
stdout = true
```

**O que o core precisa implementar — e nada além disso:**

- Enum fechado de `kind`: `fastcgi | http | static | worker`. Um `kind` novo é mudança de core (raro, e
  deliberada).
- Enum fechado de `switch.strategy`: `bluegreen-port | recreate | reload-inplace`.
- Enum fechado de `hooks.on_*`: `phpfpm-children | node-env | restart-required | recreate |
  signal:<SIG> | opcache-reset | none`. Um hook novo é código, mas mora no **módulo**, registrado por
  nome — o core só despacha.
- Interpolação de `{env_uid}`, `{env_gid}`, `{v}`, `{mem_mb}`, `{mem_mb_60pct}`, `{cpu_pct}`, `{port}`,
  `{workers}` e dos campos declarados em `[vars]`.
- **Validador de schema** que roda no CI e no `velozctl module install`: carrega todo `.toml` de
  `runtimes/`, valida contra o zod/JSON-Schema de `packages/contracts`, e **falha o build** se algo não
  bater. Para um sistema construído por IA, este validador vale mais do que a documentação.
- Teste de conformidade obrigatório por runtime (`mod-runtime-<x>` só é aceito se passar): criar → start →
  health → resize → troca de versão → rollback → pausa → start → apagar. Um script, dez asserts.

Adicionar **Go**, **Ruby**, **Bun** ou **Deno** = `kind = "http"`, `command` apontando para o binário ou
para o `bundle exec puma` / `bun run`, e `hooks.build` com o passo de compilação. Zero linha no core.

### 5.5 Atualizar a base instalada — o job que o Ciclo 1 não tinha

Este é o ganho principal do OCI sobre a imagem dourada (Achado 1.2). Patch de segurança do PHP =
publicar imagem nova, atualizar o digest no catálogo e rodar:

```bash
velozctl fleet roll --runtime php --from 8.3 --to 8.3 \
  --digest sha256:<novo> --window 03:00-05:00 --concurrency 2 --canary 2
```

- `--canary 2`: aplica em 2 ambientes escolhidos (os nossos, ou os que optaram por "canário"), espera
  30 min, verifica taxa de 5xx, e só então segue.
- `--concurrency 2`: no máximo 2 blue/green simultâneos por nó (é RAM).
- `--window`: a janela é do **cliente** (ele escolhe no painel: madrugada, ou "me avise antes").
- É **a mesma rotina do §5.1** — trocar 8.3→8.4 e trocar 8.3-patch-antigo→8.3-patch-novo são a mesma
  operação. Uma rotina, um teste, um rollback.
- **O estado do nó é conhecido**, porque é `digest` e não "o que o `apt` instalou naquela terça".

---

## 6. Acesso do cliente ao ambiente: shell, transferência de arquivo e FTP

> Seção acrescentada a pedido do dono do produto. Duas perguntas dele: *"e o `scp`?"* e *"o que o cliente
> pode e não pode fazer dentro do container?"*. As duas têm resposta concreta, e as duas mudam o
> conteúdo obrigatório da imagem base.

### 6.1 Dois caminhos de acesso, deliberadamente separados

O erro que quero evitar é ter **um** endpoint SSH que faz tudo — porque aí transferir arquivo passa a
exigir o ambiente ligado, e isso é ruim para o cliente e ruim para a cobrança.

| | **Caminho A — Transferência** | **Caminho B — Shell** |
|---|---|---|
| Serviço | **SFTPGo** no host, 1 processo por nó | `sshd` de salto (`ssh@veloz`) → `docker exec` |
| Porta | **2222** (SFTP), 21 + 30000–30100 se `mod-ftp` ligado | **22** |
| Protocolos | SFTP, SCP, FTPS (opcional), WebDAV (opcional) | SSH interativo |
| Toca o quê | **o volume, no host** | **os processos, dentro do container** |
| Autenticação | chave SSH **ou** senha (banco de contas do SFTPGo) | **só chave** |
| Funciona com ambiente **pausado** | **SIM** | **NÃO** |
| Custo de RAM | ~50 MB por nó (0,1 ambiente) | 0 (o `sshd` já existe) |
| Contas por ambiente | **várias** (como as contas de FTP do Hostoo) | 1 (o usuário `app`) |

**Por que SFTPGo e não `internal-sftp` do OpenSSH:** com `userns-remap`, os arquivos do ambiente
pertencem ao uid `165536 + uid_interno` no host. Fazer o `sshd` chrootar e escrever com esse uid exige
criar usuários Unix no host com uid ≥ 175 mil, `ChrootDirectory` com dono root, e uma base de senhas via
PAM feita à mão — três coisas frágeis. O SFTPGo faz tudo isso por configuração (uid/gid virtual por
conta, quota por conta, pasta virtual, permissões `rw`/`ro`, 2FA, API REST para o painel criar contas),
é **um binário Go único**, e liga FTPS com uma flag — que é exatamente o que o `mod-ftp` precisa.
**Plano B**, se o SFTPGo for vetado: `sshd` com `Subsystem sftp internal-sftp` + usuário Unix por ambiente
no host — não adiciona componente novo, mas perde FTPS, perde múltiplas contas e perde a API.

**O `sshd` de salto (caminho B), na prática:**

```
# /etc/ssh/sshd_veloz.conf   (instância separada: systemctl enable ssh@veloz)
Port 22
AuthenticationMethods publickey
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitTTY yes
AllowTcpForwarding no
X11Forwarding no
PermitTunnel no
AllowAgentForwarding no
AuthorizedKeysCommand /usr/local/sbin/veloz-authkeys %u %f
AuthorizedKeysCommandUser veloz-keys
Subsystem sftp /usr/local/sbin/veloz-jump-sftp
```

`veloz-authkeys` consulta o SQLite do agente e devolve a chave **já com as opções forçadas**:

```
restrict,command="/usr/local/sbin/veloz-jump 0042",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA...
```

```bash
# /usr/local/sbin/veloz-jump — ponte para dentro do container, sem shell no host
#!/bin/sh
set -eu
ENV="$1"; C="e${ENV}-php"
if [ "$(docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" != true ]; then
  cat >&2 <<EOF
Ambiente ${ENV} está PAUSADO — o shell precisa dele ligado.
  • Para enviar arquivos sem ligar:  sftp -P 2222 <conta>@<host>
  • Para ligar:                      painel → Iniciar ambiente
EOF
  exit 1
fi
exec docker exec -i ${SSH_TTY:+-t} \
  --user "$((10000+ENV)):$((10000+ENV))" --workdir /srv/app \
  -e TERM -e "SSH_ORIGINAL_COMMAND=${SSH_ORIGINAL_COMMAND:-}" \
  "$C" /bin/bash -l ${SSH_ORIGINAL_COMMAND:+-c "$SSH_ORIGINAL_COMMAND"}
```

```bash
# /usr/local/sbin/veloz-jump-sftp — SFTP pelo caminho B (dentro do container)
#!/bin/sh
exec docker exec -i --user "$((10000+VELOZ_ENV))" "e${VELOZ_ENV}-php" \
     /usr/lib/openssh/sftp-server
```

> **É aqui que o ponto do dono morde.** Quando o cliente faz `scp arquivo.zip host:/srv/app/`, quem
> executa do lado remoto é um binário **de dentro da imagem**. Se ele não estiver lá, o cliente recebe
> `bash: line 1: scp: command not found` — e não tem como consertar sozinho, porque não pode instalar
> nada. Vale igual para `rsync`, `sftp-server`, `unzip` e `git`.

### 6.2 Conjunto mínimo fechado de ferramentas na imagem base — requisito obrigatório

**Toda imagem base do VelozPanel, de qualquer linguagem, DEVE conter este conjunto.** É teste de
conformidade do `mod-runtime-*` (§5.4): o CI roda `command -v` para cada item e falha o build se faltar.

| Pacote Debian | Binários | MB instalados | Por que é obrigatório |
|---|---|---:|---|
| `openssh-sftp-server` | `/usr/lib/openssh/sftp-server` | 0,6 | **O `scp` do OpenSSH 9+ fala protocolo SFTP por baixo.** Sem isto, `sftp` **e** `scp` quebram |
| `openssh-client` | `scp`, `sftp`, `ssh`, `ssh-keygen` | 5,6 | `scp -O` (modo legado), `git+ssh`, deploy do cliente para terceiros |
| `rsync` | `rsync` | 1,4 | É o que a maioria usa de fato para deploy; do lado remoto roda `rsync --server` |
| `curl` + `ca-certificates` | `curl` | 1,5 | download, webhook, health check do próprio cliente |
| `git` (+ `perl` como dependência) | `git` | ~55 | deploy por Git e **o composer depende dele**. É o item mais caro da lista, e é inegociável |
| `unzip` + `zip` | `unzip`, `zip` | 1,0 | plugin e tema de WordPress são `.zip` |
| `tar`, `gzip` | — | 0 (na base) | |
| `bzip2`, `xz-utils` | `bzip2`, `xz` | 1,2 | dumps antigos de cPanel vêm em `.tar.bz2` |
| `nano` | `nano` | 0,3 | editar `wp-config.php`. Sem editor, o shell é inútil e vira ticket |
| `less` | `less` | 0,4 | ler log sem baixar |
| `procps` | `ps`, `top` | 0,9 | o cliente ver o próprio processo |
| `mariadb-client` | `mariadb`, `mariadb-dump` | 5,5 | importar/exportar o próprio banco sem abrir ticket |
| `postgresql-client-17` | `psql`, `pg_dump` | 6,0 | idem |
| `jq` | `jq` | 1,0 | script de deploy |
| `msmtp-mta` | `sendmail` | 0,5 | `mail()` do PHP → relay do painel |
| `ca-certificates`, `tzdata`, `locales` (pt_BR) | — | 12,0 | TLS, fuso e acento corretos |
| **Total adicional sobre a base** | | **≈ 93 MB** | dedupado pelo overlay2 entre todos os ambientes da mesma imagem |

Isso está dentro do teto de 500 MB da §2.2 (`debian:13-slim` 80 + PHP e extensões ~300 + estas 93 ≈ 473 MB).
O `git` sozinho é 12% da imagem; se o teto apertar, a saída **não** é tirar o `git` — é enxugar as
extensões PHP menos usadas para uma variante `-full`.

**O que deliberadamente NÃO entra, e por quê:**

| Fora | Motivo |
|---|---|
| `gcc`, `g++`, `make`, `build-essential`, `clang` | +250 MB **e** é o pré-requisito prático de quase todo exploit de escalada local em C. Compilar acontece no **container builder** efêmero (`hooks.build.image` do manifesto), nunca no container que atende requisição |
| `python3` nas imagens PHP / `php` nas imagens Node | não é o runtime contratado; quem quer Python contrata Python |
| `nmap`, `netcat`, `socat`, `tcpdump`, `tshark`, `masscan` | ferramentas de movimentação lateral e varredura. A ausência não impede nada legítimo e encarece muito o ataque |
| `sudo`, `policykit-1` | não há capability para usar; a presença só gera ticket |
| `docker`, `podman`, `kubectl` | óbvio |
| `imagemagick` CLI (`convert`), `ffmpeg` | +120 MB e +80 MB. A extensão PHP `imagick` está na imagem; quem precisa dos binários usa a **variante** `velozpanel/php:8.3-media` ou declara em `packages.toml` (§7) |
| `libreoffice`, `chromium`, `wkhtmltopdf` | +400 MB a +900 MB. Variante ou `packages.toml` |
| `vim` completo, `emacs` | `nano` cobre; `vim-tiny` entra se houver pedido real |
| `cron`, `systemd`, `supervisor` | o cron é do painel (§3.2); init dentro do container é o que o Conflito 1 eliminou |

### 6.3 Política de FTP — o Produto/UX está certo, e a decisão é essa

**Confirmado: FTP na porta 21 em texto claro, como o Hostoo faz, é falha a não copiar.** A senha e o
arquivo inteiro trafegam em claro; em rede de coworking ou Wi-Fi de cliente isso é roubo de site em um
`tcpdump`. E, para um painel novo em 2026, é um item que aparece em qualquer auditoria e em qualquer
comparação com concorrente.

**Decisão:**

1. **SFTP (porta 2222) é o padrão, o recomendado e o único ligado de fábrica.** SCP é suportado pelo
   mesmo caminho. Na UI a aba se chama **"Arquivos / SFTP"**, e a palavra "FTP" só aparece na busca,
   levando à explicação.
2. **FTP tradicional não existe no core.** Existe `mod-ftp`, módulo opcional, **desligado por padrão**,
   instalável por nó pelo super admin.
3. **Se `mod-ftp` for ativado, FTPS é obrigatório**, sem exceção e sem opção de desligar:
   `require_ssl_reuse`, `AUTH TLS` explícito exigido **antes** do `USER`, TLS 1.2+ apenas, cifras
   modernas, `ssl_enable=YES`, **`force_local_data_ssl=YES`** e **`force_local_logins_ssl=YES`**.
   FTP em texto claro é recusado no handshake — não há *fallback*. Porta 21 (controle) + faixa passiva
   30000–30100, liberada no nftables só quando o módulo está ativo.
4. **Por que oferecer, então:** migração de cliente vindo de cPanel com perfil de FileZilla pronto, e
   alguns construtores de site e plugins antigos que só falam FTP. É razão comercial, não técnica — e
   está escrito assim na documentação do módulo.
5. **Custos que o módulo declara** (contrato de módulo do ADENDO §C): +8 MB de RAM (o SFTPGo já está no
   ar; é só habilitar o listener), 101 portas abertas no nftables, e uma linha na AUP. FTPS com NAT e
   porta passiva é a fonte de suporte mais chata que existe — a documentação do módulo já vem com o
   passo a passo de FileZilla e o teste de conectividade no painel.
6. **Nunca**: FTP em texto claro, `anonymous`, e conta de FTP com escopo fora do volume do ambiente.

### 6.4 Contas de transferência: como o cliente cria, e o que pode

Modelo de **contas**, plural — o mesmo conceito das "contas de FTP" do Hostoo (`01`, tela de FTP), porque
o caso real é: uma conta para o dono, uma para a agência que faz o deploy, uma só de leitura para o
backup externo.

```jsonc
// registro de conta no CP, refletido na API do SFTPGo
{
  "env_id": "0042",
  "username": "e0042-deploy",          // prefixo do ambiente é OBRIGATÓRIO e não editável
  "auth": { "public_keys": ["ssh-ed25519 AAAA…"], "password_hash": "argon2id$…" },
  "home_subpath": "app/public",         // pasta virtual: a conta NÃO vê o resto do volume
  "permissions": ["list","download","upload","overwrite","delete","rename","create_dirs"],
  "uid": 175578, "gid": 175578,         // 165536 + 10042  → dono correto no host (userns-remap)
  "quota_files": 0, "quota_size": 0,    // 0 = herda a cota XFS do ambiente
  "max_sessions": 5,
  "expires_at": "2026-11-20T00:00:00Z", // conta de agência com validade é boa prática
  "totp": false
}
```

Regras que valem a pena fixar:

- **Chave SSH é o padrão recomendado**; a UI mostra a chave primeiro e a senha depois, com o aviso.
- **Senha**: gerada pelo painel (24 caracteres), **exibida uma única vez**, guardada só como hash
  argon2id. O cliente pode definir a própria, com política mínima. Rate limit de 5 tentativas/min por IP
  e bloqueio progressivo — o SFTPGo faz isso nativamente (`defender`).
- **`home_subpath`** é o que torna a conta da agência segura: ela vê `app/public`, não `home/.ssh` nem
  `etc/`. Conta somente-leitura para backup externo: `permissions: ["list","download"]`.
- **Prefixo obrigatório `e<env>-`** no nome de usuário: impossível criar `root`, `admin` ou colidir com
  outro inquilino. Validação no CP, não só na UI.
- **Auditoria**: todo login, upload e delete vira linha de log com IP, e o painel mostra
  "último acesso" por conta. Conta sem uso há 90 dias é sinalizada.
- **Uma conta nunca dá shell.** Shell é o caminho B, só por chave, só o usuário `app`.

### 6.5 SFTP com o ambiente pausado: funciona — e essa é a decisão

**Decisão: SFTP/FTPS funcionam normalmente com o ambiente PAUSADO. Shell, `wp-cli` e `composer` não.**

Justificativa, nesta ordem:

1. **É o que o cliente espera e o que ele precisa.** O motivo nº 1 de pausar é economizar; o motivo nº 2
   é "meu site quebrou, vou pausar e arrumar". Exigir ligar (e pagar) para subir um arquivo corrigido é
   hostil e transforma o botão de pausar de vantagem em pegadinha.
2. **Custa zero.** O SFTPGo toca o diretório no host. Nenhum container sobe, nenhuma RAM é alocada,
   nenhum evento de cobrança de `running` é emitido. É coerente com *"pausado cobra só disco"*.
3. **Não cria ambiguidade de cobrança.** Se subir arquivo ligasse o ambiente, cada upload viraria uma
   fração de hora cobrada que o cliente não pediu — exatamente o tipo de cobrança-surpresa que mata a
   confiança no modelo horário.

Guarda-corpos:

- Escrita continua contando na **cota XFS**; encher a cota com o ambiente pausado dá `EDQUOT` e a mesma
  mensagem clara.
- O upload **não** dispara auto-start, em nenhuma hipótese.
- O painel mostra, na tela do ambiente pausado: *"12 arquivos alterados enquanto pausado — as mudanças
  valem quando você iniciar"*.
- O **egress** de download continua contando contra a cota de banda do nó e é medido por ambiente
  (Achado 6.4 da crítica). Um "ambiente pausado" que serve 500 GB por SFTP não é hospedagem pausada,
  é CDN de graça — a AUP trata isso e o painel alerta.
- Tarefa que precisa do runtime (`composer install`, `wp core update`, import de dump) num ambiente
  pausado: o painel oferece **"iniciar por 30 min para manutenção"**, mostrando **o custo estimado antes
  do clique** (ex.: *"≈ R$ 0,024"*), e pausa de volta automaticamente ao terminar.

### 6.6 O que o cliente PODE e NÃO PODE fazer dentro do container

| Ação | Pode? | Persiste ao recriar o container? | Observação |
|---|:--:|:--:|---|
| Editar/enviar código em `/srv/app` | **sim** | **sim** | é o volume |
| Enviar arquivo por SFTP/SCP/rsync | **sim** | **sim** | funciona pausado (§6.5) |
| `composer install` / `composer require` | **sim** | **sim** (`vendor/` é volume) | *boost* de RAM automático se o plano for pequeno |
| `npm ci` / `pnpm install` | **sim** | **sim** (`node_modules` é volume) | módulo nativo compila no **builder**, não aqui |
| `wp-cli`, `git pull`, `php artisan migrate` | **sim** | **sim** | |
| Ligar/desligar extensão PHP | **sim**, pelo painel | **sim** | §2.6, `SIGUSR2`, sem downtime |
| Ajustar `memory_limit`, `upload_max_filesize` etc. | **sim**, allowlist | **sim** | `99-cliente.ini` no volume |
| Colocar binário estático em `~/bin` | **sim** | **sim** | `~/bin` já está no `PATH` |
| Declarar pacote de sistema (`ffmpeg`…) | **sim**, via `packages.toml` | **sim**, via imagem derivada | §7 |
| `apt install` direto | **não** | — | container `--read-only`, sem capability. Wrapper explica (§2.7) |
| `sudo` / virar root | **não** | — | sem `sudo`, sem capability, `no-new-privileges` |
| `crontab -e` dentro do container | **não** | — | cron é do painel, e ele sobrevive à recriação |
| `nohup node worker.js &` no shell | **sim, mas** | **NÃO — morre no stop/recreate** | declare um **worker** no painel: vira container `e0042-worker` no mesmo slice, supervisionado |
| Escrever fora dos volumes (`/usr`, `/etc`, `/var`) | **não** | — | rootfs somente-leitura |
| Escrever em `/tmp` e `/run` | **sim** | **NÃO** — são `tmpfs` em RAM | e contam no `MemoryMax`; 64 MB de teto |
| Abrir porta e receber tráfego externo direto | **não** | — | só a porta do runtime, publicada em `127.0.0.1`; a borda decide o que expõe |
| Conectar-se ao próprio banco | **sim** | — | `mariadb`/`psql` estão na imagem |
| Varrer a rede / falar com outro ambiente | **não** | — | bloqueado no nftables (§10.4) |
| Enviar e-mail | **sim**, via relay do painel | — | com limite por hora e SPF/DKIM do painel |
| Ver processo de outro cliente | **não** | — | PID namespace próprio, `/proc` mascarado |
| Instalar serviço (Redis, Memcached próprios) | **não** direto | — | **add-on pago**: container irmão gerenciado pelo painel |
| Perder o banco ao recriar o container | — | **não perde**: o banco está fora | |

---

## 7. Lista declarativa de pacotes por ambiente — a resposta ao `apt install` que não persiste

Este é o único ponto onde o modelo OCI perdia para o Incus (Achado 1.3, critério 4). A resposta não é
deixar o cliente rodar `apt` — é deixá-lo **declarar** o que precisa, e o sistema garantir que aquilo
esteja lá **sempre**, inclusive depois de trocar de versão de PHP, de receber patch de segurança e de
migrar de nó. Fica melhor do que o `apt install` do Incus, porque no Incus a instalação manual sobrevive
até alguém precisar recriar o container — e aí ninguém lembra o que foi instalado.

### 7.1 Onde o cliente declara

Duas portas de entrada para o **mesmo** registro, porque cliente de painel e desenvolvedor querem coisas
diferentes:

- **Painel → Ambiente → Pacotes**: busca no catálogo, checkbox, botão "Aplicar". É o caminho de 90%.
- **Arquivo no volume**: `/srv/veloz/envs/e0042/.veloz/packages.toml`, versionável junto com o projeto.
  O agente observa o arquivo (`inotify`, com debounce de 5 s), valida e sincroniza para o CP. Conflito
  entre os dois: **o arquivo vence**, e o painel avisa "gerenciado por `.veloz/packages.toml`".

```toml
# /srv/veloz/envs/e0042/.veloz/packages.toml
schema = 1

[apt]
packages = ["ffmpeg", "poppler-utils", "webp"]

[php.extensions]                       # atalho para o mesmo toggle da §2.6
enable  = ["redis", "imagick", "intl"]
disable = ["xdebug"]

[bin]                                  # binário estático: não precisa de imagem derivada
"yt-dlp" = { url = "https://github.com/.../yt-dlp_linux", sha256 = "9f3c…", mode = "0755" }

[build]                                # opcional; roda no builder, não no runtime
command = ["npm", "ci", "--omit=dev"]
```

### 7.2 Mecanismo: imagem derivada por ambiente (e por que não overlay de pacotes)

**Escolhido:** o agente gera um `Dockerfile` a partir da lista validada e constrói uma **imagem derivada
do ambiente**.

```dockerfile
# gerado — /var/lib/veloz/build/e0042/Dockerfile
FROM ghcr.io/velozpanel/php@sha256:aaaa…          # digest exato do runtime atual
USER root
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg poppler-utils webp && \
    rm -rf /var/lib/apt/lists/*
USER 10042
LABEL veloz.env=0042 veloz.packages_hash=7b1e… veloz.base=sha256:aaaa…
```

```bash
# construção isolada, com limites próprios, fora da slice dos inquilinos
systemd-run --unit=veloz-build-0042 --slice=veloz-build.slice \
  -p MemoryMax=1G -p CPUQuota=100% -p IOWeight=50 -p TimeoutStartSec=900 \
  docker build --network veloz-build-net \
    -t velozpanel/env-0042:7b1e… -f /var/lib/veloz/build/e0042/Dockerfile /var/lib/veloz/build/e0042
```

- Tag = `velozpanel/env-<id>:<sha256(lista + digest da base)>`. **Determinística**: mesma lista + mesma
  base = mesma tag = nada a reconstruir.
- `veloz-build-net` é uma bridge que só alcança **o espelho Debian e o Sury** (nftables). Sem isso, o
  `docker build` de um cliente vira um proxy de saída arbitrário.
- `veloz-build.slice` tem `MemoryMax=1G` e `CPUQuota=100%` **globais no nó** — no máximo um build por vez
  por nó, e ele nunca compete com os sites no ar.
- Só a **camada delta** é nova; o overlay2 compartilha a base com todos os outros ambientes da mesma
  versão. `ffmpeg` custa ~80 MB uma vez para aquele ambiente, não 480 MB.
- **Teto: 1 GB de camada derivada por ambiente**, contabilizado como disco do ambiente na cobrança
  (a camada vive em `/var/lib/docker`, fora da cota XFS, então precisa ser medida à parte:
  `docker image inspect -f '{{.Size}}'` menos o tamanho da base).

**Rejeitado — "overlay de pacotes":** instalar com `apt-get -o Dir::…` num diretório do volume e montá-lo
no container com `PATH`/`LD_LIBRARY_PATH` prefixados. Parece mais leve, mas quebra em tudo que tem
caminho absoluto compilado, em `postinst`, em `ldconfig` e em pacote com serviço. Seria uma fonte infinita
de "funciona no meu ambiente e não no do vizinho". Descartado explicitamente.

### 7.3 Como a reaplicação acontece na recriação

O registro do ambiente guarda três coisas: `base_digest`, `packages_hash`, `derived_tag`. O agente
resolve **qual imagem rodar** com uma função pura:

```
imagem_efetiva(env) = (packages vazio) ? base_digest : derived_tag
```

| Evento | O que acontece |
|---|---|
| **Start / reboot do host** | roda `imagem_efetiva`; se a `derived_tag` existir localmente, sobe direto. Se não existir (nó novo), **constrói antes de subir** e o start demora o tempo do build |
| **Troca de versão de PHP** (§5.1) | muda `base_digest` → `packages_hash` continua, mas a tag muda → **rebuild**, e só então o blue/green. Se o build falhar, **a troca de versão é abortada e o ambiente continua no ar na versão antiga** |
| **Patch de segurança da base** (`fleet roll`, §5.5) | idem: rebuild + blue/green, na janela do cliente |
| **Cliente muda `packages.toml`** | rebuild + blue/green. **Zero downtime**, porque o container novo só entra depois de saudável |
| **Migração para outro nó** (§8.2) | `docker save velozpanel/env-0042:<tag> \| zstd \| ssh nodeB 'zstd -d \| docker load'` — vai só a camada delta (10–200 MB). **Não** reconstruir no destino: `apt` traria versões diferentes e o ambiente mudaria em silêncio no meio de uma migração |
| **Rollback** | as duas últimas `derived_tag` ficam retidas 7 dias, com referência na tabela `image_refs` (§5.3) |

**A propriedade que faz isso valer a pena:** o container que atende requisição **nunca** é modificado.
Toda mudança é uma imagem nova, construída, testada por health check e promovida por blue/green. É a
mesma rotina de §5.1 para os quatro eventos acima — uma rotina, um teste, um rollback.

### 7.4 Quando um pacote declarado falha

**Regra: falha de build nunca derruba o ambiente.** O build acontece **antes** da troca; se falhar, o
container atual continua no ar, intocado.

1. `docker build` sai ≠ 0 → o estado do ambiente permanece `running` na imagem anterior.
2. O painel marca a solicitação como `falhou`, com **o log completo** e a linha que quebrou, e uma
   tradução em português dos erros mais comuns:
   - `Unable to locate package X` → *"o pacote `X` não existe no Debian 13. Veja o nome correto em
     packages.debian.org, ou peça pelo suporte."*
   - `You don't have enough free space` → *"sem espaço no nó para construir. Já avisamos o suporte."*
   - conflito de dependência → *"`X` conflita com `Y`, que já está na imagem base."*
3. **Nunca aplica parcialmente.** É um único `RUN apt-get install -y <todos>`: ou todos entram, ou
   nenhum. Meio ambiente instalado é pior que nenhum.
4. **Retentativa:** 3 tentativas com backoff (1 min, 5 min, 15 min) — cobre falha transitória de espelho.
   Depois disso o item entra em `quarentena` e não é tentado de novo até o cliente editar a lista.
5. **Quarentena é visível:** o painel mostra `ffmpeg ✓ · libreoffice-writer ✗ em quarentena` com o botão
   `[Remover da lista]` e `[Tentar de novo]`. Sem isso, o ambiente tenta rebuild em todo start e o
   cliente não entende por que o start demora.
6. **Timeout de 900 s.** Build mais longo que isso é sinal de pacote enorme (LibreOffice, TeX Live) e vira
   pedido de análise, não retentativa.

### 7.5 O limite: o que nunca será permitido, mesmo declarado

Validação em **duas camadas**, ambas no CP (nunca só na UI):

**Camada 1 — catálogo permitido (o caminho rápido).** ~300 pacotes curados, agrupados por finalidade
(mídia, PDF, fontes, escritórios, i18n, ferramentas de linha de comando). Está no catálogo → aplica sem
intervenção humana. Não está → vai para fila de análise (ticket), SLA de 5 dias úteis, e se aprovado
entra no catálogo **para todo mundo**.

**Camada 2 — recusa absoluta (nem em análise, nem por exceção, nem pago):**

| Categoria | Exemplos | Motivo |
|---|---|---|
| Kernel e módulos | `linux-image-*`, `linux-headers-*`, `*-dkms` | não há kernel dentro do container; é sinal de tentativa de escapar |
| Elevação de privilégio | `sudo`, `policykit-1`, `pkexec`, qualquer setuid | derruba `no-new-privileges` como defesa em profundidade |
| Runtime de container / virtualização | `docker.io`, `podman`, `lxc`, `qemu*`, `libvirt*` | container aninhado com capability zero não funciona; pedir é sinal de intenção |
| Init e supervisão | `systemd`, `supervisor`, `cron`, `openrc` | o modelo é um processo por container; cron é do painel |
| Servidor de rede | `nginx`, `apache2`, `postfix`, `exim4`, `bind9`, `mysql-server`, `redis-server`, `memcached` | a borda é do painel e o banco é compartilhado. Serviço próprio = **add-on pago** com container irmão |
| VPN / túnel / anonimizador | `openvpn`, `wireguard*`, `tor`, `proxychains`, `frp` | abuso clássico: hospedagem virando saída de rede. Item da AUP |
| Varredura e ataque | `nmap`, `masscan`, `hydra`, `john`, `hashcat`, `sqlmap`, `metasploit`, `tcpdump`, `tshark` | ferramenta de ataque a terceiros; responsabilidade nossa como provedor |
| Mineração | `xmrig`, `cpuminer`, `ethminer` e qualquer coisa fora dos repositórios oficiais | AUP, e o custo de CPU é nosso |
| Compilador no runtime | `gcc`, `g++`, `build-essential`, `clang` | permitido **só** no builder (`hooks.build.image`), nunca na imagem que atende requisição |
| Repositório de terceiros | qualquer `deb [trusted=yes] http://...`, PPA, `curl \| bash` | **só** Debian oficial, Sury e nosso espelho. Não há campo no `packages.toml` para adicionar repositório — por construção |
| Tamanho | pacote único > 300 MB, ou delta total > 1 GB | densidade de disco (§1.3) |

A recusa é **explicada**, não um "proibido" seco: *"`redis-server` não pode ser instalado dentro do
ambiente porque o container roda um processo só e sem privilégio. Ative o add-on **Redis dedicado**
(R$ X/mês) e nós subimos um Redis exclusivo ao lado do seu ambiente, com senha e backup."* Toda recusa
que tem alternativa comercial deve apresentá-la — é onde o ARPU do Achado 6.1 aparece.

---

## 8. Distribuição entre nós de provedores diferentes

Contexto do ADENDO §B: **não existe rede privada**. Cada nó está num provedor diferente. Tudo entre nós
atravessa a internet pública, com custo de banda, latência e cota.

### 8.1 Como escolher em que nó criar um ambiente

Escalonador **determinístico e simples**, no control plane. Determinístico importa mais do que ótimo:
o sistema será construído por IA e precisa ser testável com entrada e saída fixas.

**Passo 1 — filtros duros (elimina, não pontua):**

```
node.status == 'ready'                              (node-doctor saiu 0 ou 2 nas últimas 24 h)
node.draining == false
RAM: soma(MemoryMax running) + plano <= 1,3 × MemoryMax(veloz-env.slice)
Disco: uso_real + 2,5 GB <= 80% do disponível para volumes
vCPU: soma(CPUQuota) + plano <= 4 × (vCPU do nó − reserva)
Banda: consumo do mês < 70% da cota do provedor
Runtime: a imagem pedida existe (ou pode ser baixada) no nó
Região/provedor: casa com o exigido pelo plano (ex.: "só Brasil")
```

**Passo 2 — pontuação (0–100, maior vence):**

```
score = 40 × folga_ram_normalizada
      + 25 × folga_disco_normalizada
      + 20 × (1 − cpu.pressure avg300 do veloz-env.slice)
      + 15 × (1 − consumo_banda_do_mês / cota)
      − 30 × (ambientes DO MESMO CLIENTE já neste nó)      ← anti-afinidade
      − 10 × (nó recebeu ambiente nos últimos 5 min)        ← evita rajada num nó só
desempate: menor node_id
```

A anti-afinidade é a regra que mais paga: um cliente com 2 sites em 2 nós perde 1 quando um nó cai; com
os 2 no mesmo nó, perde tudo — e é exatamente esse cliente que vai embora.

**Passo 3 — sem rebalanceamento automático na fase 1.** O ambiente fica no nó onde nasceu até alguém
mandar migrar. Migrar entre provedores custa banda e downtime; um escalonador que faz isso sozinho é
como um robô de arrumação que muda seus móveis de lugar à noite. O painel do admin mostra
*"n1 está em 88% de RAM e n2 em 41% — sugestão: migrar e0031 (512 MB, 2,1 GB de disco, ~4 min)"*, com
botão. **Recomendação com um clique, nunca automação silenciosa.**

#### 8.1.1 Política de alocação com **apenas 2 nós** (ADENDO 3)

Com 2 nós o escalonador da §8.1 continua válido, mas três termos deixam de ser pontuação e viram
**regra dura**, porque com N=2 não há espaço para heurística:

1. **Anti-afinidade obrigatória.** O 2º ambiente de um mesmo cliente vai **sempre** para o outro nó.
   Só quando ele tiver um em cada é que o 3º volta a ser decidido por folga. Com 2 nós, é a única
   proteção que o cliente tem contra perder tudo de uma vez — e custa zero.
2. **Balanceamento apertado.** A diferença de RAM vendida entre n1 e n2 nunca passa de **1.024 MB**.
   Se passar, o próximo ambiente vai obrigatoriamente para o nó mais vazio, ignorando o resto do score.
   Motivo: com 2 nós, desequilíbrio é o mesmo que reduzir a capacidade da frota — o nó cheio recusa e o
   vazio não é usado.
3. **A reserva operacional de 2 GB (§1.6) é intocável pelo escalonador.** Ele aloca contra os 9.500 MB
   vendáveis, nunca contra os 11.500. Um `start` ou um upgrade que invadiria a reserva recebe **409** com
   o número exato de folga.

**Quanta folga precisa ficar livre em cada nó para absorver o outro? A resposta honesta é: não existe
folga que resolva.** Absorver um nó de 16 GB exige 50% livre nos dois — o que reduziria a frota de
produção de 14 para **7 ambientes**, com dois servidores pagos. Isso não é redundância, é jogar metade
do dinheiro fora para comprar uma apólice que, na prática, ainda demoraria horas para pagar (a
transferência entre provedores é lenta, §8.2).

**Política adotada, em três camadas:**

| Camada | O que cobre | Custo |
|---|---|---|
| **Reserva de resgate: 2 GB por nó** (a mesma reserva operacional da §1.6) | absorve **imediatamente** 1 ambiente Plus, ou 2 Light, ou 4 Start do nó morto — os **críticos**, escolhidos por uma coluna `rescue_priority` definida no momento da venda | zero: a reserva já existia para blue/green e build |
| **Pausados voltam primeiro, e voltam pausados** | ambiente pausado custa **0 de RAM**. Restaurar os dados dele no sobrevivente é só disco, e o cliente **já consegue ver e baixar seus arquivos por SFTP** (§6.5) enquanto o resto é reconstruído | disco (há ~35 volumes de folga por nó, §1.3) |
| **Capacidade sob demanda** — o terceiro nó contratado no ato | os ambientes ativos restantes | R$ 150–350/mês, **a partir do momento em que é usado** |

Pré-requisitos que tornam a camada 3 real, e que são **requisito de MVP**:

- **Conta aberta e cartão cadastrado em pelo menos dois provedores** onde uma VPS equivalente sobe em
  < 30 min. Testado, com o tempo cronometrado e escrito no runbook.
- **Playbook Ansible + `veloz-node-doctor.sh` testados no nó de teste no último trimestre** (§8.4).
- **Backup off-node verificado** (B6), porque a camada 3 é restore, não migração.

> Escrito de forma direta para o dono: **com 2 nós, a redundância não é capacidade reservada, é
> velocidade de restore.** O que precisa estar pronto não é RAM parada — é um playbook testado, um
> backup que restaura e um cartão que passa.

### 8.2 Migrar um ambiente do nó A para o B sem rede privada

**Banda esperada entre dois provedores brasileiros diferentes**, sobre a internet pública, com SSH+zstd:
80–300 Mbit/s efetivos. Uso 200 Mbit/s = 25 MB/s como número de planejamento.

| Volume | Transferência pura @100 Mbps | @200 Mbps | @500 Mbps |
|---|---:|---:|---:|
| 1 GB | 1,4 min | 0,7 min | 0,3 min |
| **5 GB** | **6,7 min** | **3,3 min** | **1,3 min** |
| 10 GB | 13,3 min | 6,7 min | 2,7 min |
| 55 GB (nó inteiro, 22 × 2,5 GB) | 73 min | **37 min** | 15 min |

Com `rsync -z` (ou `zstd`), código PHP e texto comprimem 2–3×; mídia (o grosso do WordPress) não comprime
nada. Fator prático combinado: **~1,5×** → 5 GB reais ≈ 3,3 GB na rede ≈ **2,2 min a 200 Mbps**.

**Procedimento (`velozctl env migrate --env 0042 --to n2`):**

```bash
# ---- D-1: preparação (sem downtime, sem pressa) ----
velozctl dns ttl --env 0042 --set 60          # TTL 60 s, 24 h ANTES. É o item de maior lead time.
ssh n2 velozctl env prepare --env 0042 --plan p1     # slice, projeto XFS, role no banco, vhost, ACL
ssh n2 docker pull ghcr.io/velozpanel/php@sha256:aaaa…
docker save velozpanel/env-0042:7b1e… | zstd -3 | ssh n2 'zstd -d | docker load'   # imagem derivada (§7.3)
# certificado: emitir em n2 por DNS-01 ANTES do corte (funciona sem o DNS apontar para lá)
ssh n2 lego --dns cloudflare --domains "$DOM" run

# ---- Passadas de cópia com o ambiente NO AR ----
for pass in 1 2 3; do
  rsync -aHAX --numeric-ids --delete --compress-choice=zstd \
        -e 'ssh -T -o Compression=no -c aes128-gcm@openssh.com' \
        /srv/veloz/envs/e0042/ n2:/srv/veloz/envs/e0042/
done                                          # a 3ª passada leva segundos

# ======== JANELA DE CORTE (o cronômetro começa aqui) ========
velozctl env pause --env 0042 --reason migration        # borda A entra em 503 "migrando"
rsync -aHAX --numeric-ids --delete … n2:/srv/veloz/envs/e0042/     # delta final: 2–20 s
mariadb-dump --single-transaction --routines --triggers e0042 | zstd -3 \
  | ssh n2 'zstd -d | mariadb e0042'                               # 300 MB → 20–60 s
ssh n2 velozctl env start --env 0042                               # + health check
curl -sf --resolve "$DOM:443:$IP_N2" "https://$DOM/" -o /dev/null  # validação REAL antes de virar
# ======== FIM DA JANELA: 60–180 s ========

# ---- Cobertura de DNS: ninguém vê downtime, mesmo com cache de TTL ----
velozctl route set --env 0042 --proxy-to n2     # borda A vira proxy HTTPS para B (ver abaixo)
velozctl dns set --env 0042 --a "$IP_N2"
sleep 24h                                        # cache de resolvedor teimoso
velozctl route clear --env 0042 && velozctl env destroy --env 0042 --on n1 --require-verified-backup
```

```nginx
# borda de A, durante a cobertura de DNS
location / {
    proxy_pass https://IP_N2;
    proxy_ssl_name           $host;
    proxy_ssl_server_name    on;
    proxy_set_header Host    $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

| Item | Número |
|---|---|
| **Downtime percebido pelo visitante** | **0 s** (a cobertura de A→B cobre a propagação) |
| **Janela de corte real** (site indisponível para quem bate direto em B) | **60–180 s** para 5 GB + 300 MB de banco |
| **Duração total da operação** (5 GB) | **30–45 min**, com supervisão humana |
| **Lead time obrigatório** | **24 h** (baixar o TTL do DNS) |
| **Banda consumida** | ~1,5× o tamanho do volume, mais o tráfego dobrado durante a cobertura |
| **Custo de banda durante a cobertura** | tráfego do site × 2, por até 24 h — orçar contra a cota do nó (Achado 6.4) |

Três detalhes que fazem a diferença entre isso funcionar e não funcionar:

1. **`--numeric-ids` no rsync é obrigatório.** Com `userns-remap`, os donos são uids altos que não existem
   em `/etc/passwd`. Sem essa flag, o rsync tenta resolver nome, falha, e escreve tudo como root no
   destino — o ambiente sobe e nada funciona.
2. **ACME por DNS-01**, não HTTP-01. Emitir o certificado em B **antes** de o DNS apontar para B só é
   possível por DNS-01. Com HTTP-01 haveria uma janela sem certificado. É a mesma razão que faz a
   renovação funcionar com o ambiente pausado (§3.2).
3. **Nunca `docker build` no destino.** A imagem derivada vai por `docker save`/`load`. Reconstruir traria
   versões diferentes de pacote e o ambiente mudaria de comportamento no meio de uma migração — o pior
   momento possível para uma variável nova.

**E-mail:** fora do container e fora do nó (serviço compartilhado). Migração de ambiente não toca MX,
caixa nem webmail. É a vantagem escondida de ter tirado e-mail do MVP.

### 8.3 Evacuar um nó que vai morrer

**Caminho 1 — o nó ainda está vivo (aviso do provedor, migração planejada, hardware degradado):**

```bash
velozctl node drain n1 --reason "fim de contrato 30/09" --concurrency 2
```

1. Marca `draining=true` → nenhum ambiente novo, nenhum upgrade que aumente RAM.
2. Ordena a fila: **pausados primeiro** (são só `rsync`, downtime zero, e liberam disco), depois os
   ativos do menor para o maior.
3. Executa o procedimento §8.2 com **concorrência 2** (o gargalo é banda, não CPU).
4. Notifica cada cliente 24 h antes com a janela estimada de 3 minutos do ambiente dele.

| Grandeza | Nó com 22 ativos + 28 pausados |
|---|---|
| Dados a mover | 22 × 2,5 GB + 28 × 2,5 GB ≈ **125 GB** |
| Transferência pura @200 Mbps, concorrência 2 | **~83 min** |
| Com bancos, validação e cortes | **4 a 6 h de operação** |
| Downtime por cliente ativo | 60–180 s |
| Downtime por cliente pausado | **0** |
| Pré-requisito | capacidade nos outros nós: **50 ambientes não cabem em 1 nó de 16 GB** |

> **Consequência que precisa estar escrita no plano de capacidade:** evacuar um nó cheio exige **dois**
> nós com folga, ou a contratação de um nó novo no ato. **Com a frota de 2 nós do ADENDO 3, evacuar um nó
> cheio para o outro é aritmeticamente impossível — ver §8.1.1 e §8.3.1.** Com 3 nós a 90% de ocupação (o que o Achado 6.3
> autoriza ao trocar N-1 por RTO declarado), **não há para onde evacuar**. A regra prática:
> **manter sempre um provedor onde seja possível subir uma VPS equivalente em menos de 30 minutos, com
> cartão cadastrado e o playbook Ansible testado.** Capacidade sob demanda substitui capacidade reservada
> — e é o que torna o RTO de 4 h da crítica defensável.

**Caminho 2 — o nó já morreu (o caso que realmente acontece):** não há o que evacuar; é **restore**.

```bash
velozctl node provision n4 --from-playbook   # Ansible: 15–25 min até 'ready'
velozctl node restore --from-backup-of n1 --to n4 --concurrency 3
```

| Etapa | Tempo |
|---|---|
| Contratar/subir VPS nova + Ansible + node-doctor | 25–40 min |
| `docker pull` das imagens base | 5–10 min |
| `restic restore` de 55 GB (ativos) do object storage | 45–90 min (limitado pela banda **de download**) |
| Restaurar bancos dos dumps horários | 10–20 min |
| DNS (TTL já baixo? senão, +TTL antigo) e validação | 15–30 min |
| **RTO total** | **2 a 4 h** — bate no RTO declarado, **sem folga** |
| **RPO** | **1 h** (dump horário do banco) + até 24 h de arquivos, se o restic for diário → **fazer o restic de 6 em 6 h** |

Três exigências que saem daqui, e que valem mais que o resto desta seção:

- **O backup precisa ser testado de verdade** (benchmark B6: restaurar um ambiente inteiro e conferir
  HTTP 200 + checksum). Backup não restaurado é um dos três jeitos de matar o projeto.
- **Egress de restore é dinheiro e é cota**: 55 GB baixados do object storage. Orçar (B7) e verificar
  contra a cota de banda da VPS nova.
- **O TTL do DNS precisa ser baixo o tempo todo** (300 s), não só antes de migrações planejadas —
  porque o desastre não avisa. Custo: mais consultas ao DNS autoritativo. Irrelevante nesta escala.

### 8.3.1 Perder um nó com **frota de 2** — o cenário que virou requisito de MVP

Cenário concreto: **n1 morre às 14h de uma terça.** Nele havia 7 ambientes ativos (mix de 1,35 GB,
postura A) e ~20 pausados. O sobrevivente n2 já está com seus 7 ativos e tem **2 GB de reserva**.

**Aritmética do minuto zero, sem enfeite:**

| | |
|---|---|
| Ativos a recolocar | **7** (≈ 9,5 GB de `MemoryMax`) |
| Capacidade imediata em n2 | **2 GB** = 1 Plus, **ou** 2 Light, **ou** 4 Start |
| Ativos que **não** cabem em n2 | **5 a 6** — dependem do nó novo |
| Pausados a recolocar | ~20 → **cabem em n2 por disco** (0 de RAM), e voltam **pausados** |
| Capacidade da frota durante o incidente | **de 14 para 8–9** (≈ 60%) |

**Sequência de degradação — decidida agora, não durante o incidente:**

```
T+0    detecção (3 heartbeats perdidos = 180 s) → status do nó vira 'lost', painel em modo incidente
T+2min congelar a frota: nenhuma criação, nenhum upgrade de RAM, nenhum fleet roll, nenhum build
T+5min RESGATE: restaurar em n2, na reserva de 2 GB, os ambientes por rescue_priority
       (regra de desempate publicada: (1) SLA contratado, (2) maior plano, (3) mais antigo)
T+10min PROVISIONAR n3: Ansible + node-doctor  ......................... 25–40 min
T+15min RESTAURAR OS PAUSADOS em n2 (só dados, ficam pausados) — o cliente já enxerga
        e baixa os arquivos por SFTP, e isso corta metade dos tickets
T+45min RESTAURAR os ativos restantes em n3, do restic, concorrência 3 .. 45–90 min
T+2h    bancos dos dumps horários (RPO ≤ 1 h) ........................... 10–20 min
T+2h30  DNS por ambiente conforme cada um sobe (TTL 300 s permanente)
T+3h    validação: HTTP 200 + checksum por ambiente
```

**O que é degradado ou recusado, explicitamente, enquanto durar:**

| Recusado / degradado | Por quê |
|---|---|
| Criação de ambiente novo | não há capacidade e o dado do incidente é prioritário |
| Upgrade de RAM/vCPU | consumiria a reserva de resgate |
| `fleet roll` de imagem base e builds de `packages.toml` | competem por RAM, CPU e banda com o restore |
| Auto-pausa por inatividade | **suspensa** — um ambiente restaurado tem tráfego zero por definição e seria pausado por falso positivo |
| Backup do nó sobrevivente | **não** é suspenso. Nunca. É o único ativo que resta |
| Ambientes pausados restaurados | **não podem ser iniciados** até haver capacidade; o botão fica desabilitado com o motivo escrito |
| SLA de suporte | comunicado de incidente a cada 60 min, na página de status e por e-mail |

**Se a automação falhar — procedimento manual, por ambiente, sem `velozctl`:**

```bash
# 1) provisionar o nó (se o Ansible falhar, é o Debian mínimo + este bloco)
apt-get install -y docker.io xfsprogs nginx restic zstd mariadb-client postgresql-client
#    daemon.json (§10.3), /etc/fstab com pquota, reboot

# 2) restaurar UM ambiente, com as credenciais do restic guardadas FORA do painel
export RESTIC_REPOSITORY=s3:https://br-se1.magaluobjects.com/veloz-backup/e0042
export RESTIC_PASSWORD_FILE=/root/.veloz-restic-pass       # cópia impressa no cofre físico
restic snapshots | tail -5
restic restore latest --target /srv/veloz/envs/e0042
chown -R 175578:175578 /srv/veloz/envs/e0042               # 165536 + 10042 — SEM isto nada funciona

# 3) cota e projeto XFS
printf '10042:/srv/veloz/envs/e0042\n' >> /etc/projects
printf 'e0042:10042\n'                 >> /etc/projid
xfs_quota -x -c 'project -s e0042' -c 'limit -p bhard=20g e0042' /srv/veloz

# 4) banco
zstd -d < /backup/e0042-$(date +%F-%H).sql.zst | mariadb e0042

# 5) slice + container (os dois comandos que substituem todo o painel)
systemctl set-property veloz-env-0042.slice MemoryMax=1G MemoryHigh=819M CPUQuota=150%
docker run -d --name e0042-php --cgroup-parent=veloz-env-0042.slice --restart=no \
  --user 10042:10042 --read-only -p 127.0.0.1:19042:9000 \
  --mount type=bind,src=/srv/veloz/envs/e0042/app,dst=/srv/app \
  ghcr.io/velozpanel/php@sha256:aaaa…

# 6) vhost + DNS
cp /backup/nginx/e0042.conf /etc/nginx/veloz/sites/ && nginx -t && systemctl reload nginx
#    apontar o A do domínio para o IP do nó novo, no painel do DNS
```

**Três exigências que saem deste cenário e entram no MVP:**

1. **O runbook acima é impresso e guardado fora do sistema** (papel ou cofre de senhas separado), com a
   senha do repositório restic. Um runbook que só existe no painel que caiu não existe.
2. **`rescue_priority` é uma coluna do banco preenchida no ato da venda**, não uma decisão às 14h de uma
   terça. E o critério é publicado, para não parecer arbitrário depois.
3. **O ensaio completo roda no nó de teste a cada trimestre** (§8.4), cronometrado, com o número escrito.
   Um plano de evacuação nunca executado é ficção — e com 2 nós ele é a única rede de segurança.

---

### 8.4 O nó de teste como ativo de engenharia (ADENDO §G.2)

O terceiro nó de 16 GB **não** recebe cliente pagante e **não** conta na capacidade. Ele é o portão por
onde tudo passa antes de tocar em produção. Numa frota de 2 nós, onde um erro de deploy atinge 50% da
base, isso deixa de ser boa prática e vira a principal defesa.

#### 8.4.1 O que obrigatoriamente passa pelo nó de teste antes de produção

| Mudança | Ensaio no nó de teste | Critério para liberar |
|---|---|---|
| **Nova imagem base** (`velozpanel/php:8.3` com patch) | subir 3 ambientes clonados de produção (WordPress, Woo, app Node) na imagem nova; rodar o blue/green da §5.1 | 0 erro 5xx nas 200 requisições da janela; extensões carregadas idênticas; RSS ocioso dentro de ±15% |
| **Upgrade de módulo** (`mod-runtime-*`, `mod-pagamento-*`, `mod-ftp`) | instalar, exercitar o teste de conformidade da §5.4, desinstalar | ciclo completo criar→start→resize→trocar versão→rollback→pausar→start→apagar sem erro; desinstalação não deixa resíduo |
| **Upgrade do agente / do Docker / do kernel** | aplicar no nó de teste e deixar 72 h com carga sintética | sem OOM, sem reinício do agente, `live-restore` preservou os containers no restart do daemon |
| **Migração de ambiente** (§8.2) | migrar teste→produção-espelho e voltar, cronometrando | janela de corte < 180 s; checksum idêntico |
| **Restore (B6)** | restaurar um ambiente inteiro do restic e validar | **RTO < 60 min por ambiente, RPO ≤ 1 h**, HTTP 200 + checksum |
| **Ensaio de evacuação (§8.3.1)** | trimestral, o cenário completo | tempo medido e escrito; se passar de 4 h, o RTO declarado ao cliente muda |
| **Mudança de `daemon.json`, nftables, seccomp, AppArmor** | aplicar e rodar a bateria de isolamento da §10.6 | 100% dos testes de isolamento passando |

Regra de processo: **nenhuma mudança entra em produção sem o registro do ensaio correspondente**
(data, versão, resultado, quem rodou). É um campo obrigatório no job de release, não um acordo de
cavalheiros — o sistema é construído por IA e precisa de portão executável, não de disciplina.

#### 8.4.2 Clonar um ambiente de produção para o nó de teste

**Regra nº 1: o clone é feito a partir do BACKUP, nunca do nó de produção.** Três motivos: (i) não gera
I/O nem egress no nó que está atendendo cliente; (ii) **cada clone é um teste de restore de verdade** —
o benchmark B6 passa a rodar sozinho, toda vez que alguém investiga um bug; (iii) se o backup estiver
quebrado, você descobre investigando um ticket, não durante um desastre.

```bash
velozctl env clone --from-backup e0042 --to-node ntest --as t0042 \
      --without-database --ttl 72h --reason "ticket #331: erro 502 após atualizar plugin X"
```

O que o comando faz, e cada passo existe por um motivo de LGPD ou de segurança:

| Passo | Detalhe |
|---|---|
| Restaura o snapshot restic num ambiente novo `t0042` no nó de teste | sem tocar em n1/n2 |
| **Banco: por padrão NÃO vem** | `--without-database` é o default. Estrutura de site reproduz 80% dos bugs sem copiar dado pessoal de terceiros. Trazer o banco exige `--with-database` **+ justificativa obrigatória**, que vai para o registro de operações de tratamento (LGPD, art. 37) |
| Se vier o banco, **pseudonimização automática** | `UPDATE wp_users SET user_email=CONCAT('u',ID,'@invalido.local'), user_pass='!'`; tabelas de pedido com CPF/telefone mascaradas. Script por *stack* conhecida, e recusa a clonar se a stack for desconhecida e o `--with-database` for pedido |
| **SMTP bloqueado no nível do nó** (nftables: 25/465/587 `drop` saindo do nó de teste) | um WordPress clonado dispara e-mail de "seu pedido foi atualizado" para os clientes reais do lojista. É o desastre clássico de staging, e a única defesa confiável é de rede, não de configuração |
| **Sem DNS público, sem certificado do domínio real** | acessível só em `t0042.teste.veloz.internal`, atrás de HTTP Basic na borda + allowlist de IP |
| `X-Robots-Tag: noindex, nofollow` e `robots.txt` bloqueando tudo | evita o clone ser indexado e canibalizar o SEO do cliente |
| **Sem acesso ao banco de produção, sem credencial de gateway de pagamento** | o `.env` clonado tem as chaves substituídas por valores de sandbox pelo próprio comando |
| **Destruição automática em 72 h** (`--ttl`), com aviso em 24 h | ambiente de teste esquecido é vazamento com data marcada |
| **Registro de auditoria** | quem clonou, quando, com ou sem banco, por qual motivo, e quando foi destruído. Visível também para o cliente na aba de privacidade dele |

#### 8.4.3 Cobrança: por que o clone não gera custo para o cliente

Duas camadas independentes, porque uma só sempre falha:

1. **Na origem:** o agente de um nó com `role=test` emite todo evento de uso com `"billable": false` e
   `"node_role": "test"`. O `env_id` do clone (`t0042`) tem prefixo `t` e `tenant_id = internal`.
2. **No destino:** o motor de cobrança **recusa** — não ignora, **recusa com erro e alerta** — qualquer
   evento cujo `node_role` não seja `production` ou cujo `env_id` comece com `t`. Evento indevido vira
   incidente visível, não uma linha silenciosa na fatura de alguém.

E a reconciliação horária da §3.5 (Regra 4) roda **só sobre nós de produção**, para que o nó de teste
nunca apareça como divergência de metering (o que faria o operador aprender a ignorar o alerta — que é
como todo sistema de alerta morre).

**Custo do nó de teste, honestamente:** R$ 150–350/mês que não geram receita, numa operação cuja margem
bruta é pequena (Achado 6.1). A justificativa não é técnica, é de risco: **com 2 nós de produção, um
`fleet roll` mal testado tira 50% da base do ar de uma vez.** O nó de teste é o seguro mais barato dessa
frota — mais barato que um único incidente de meio dia com 14 clientes.

---

## 9. Teste decisivo — o experimento de 1–2 dias que aprova ou reprova esta arquitetura

Nas **VPS reais**, não em laboratório e não no notebook. Executa T0–T10 e B1/B2/B5/B8/B9 da crítica, mais
o que este documento acrescentou. **Nenhuma linha de código de produção antes disto.**

**Materiais:** as 2 VPS de produção + o nó de teste; um WordPress 6.x com WooCommerce e 200 produtos
(dump preparado antes); `wrk` ou `k6`; `stress-ng`; `fio`; `sysbench`.
**Planilha de resultados:** `Plan/docs/bench-ciclo2.md`, uma linha por teste, com o número medido.

### Dia 1 — manhã (3 h): o nó aguenta o modelo?

```bash
# ---- T0 — APTIDÃO (bloqueia tudo o que vem depois) ----
sudo bash veloz-node-doctor.sh --json | tee node-$(hostname).json
```
Checagens **CRÍTICAS** que este documento acrescenta ao script (além das do Achado 0.1):
```bash
systemd-detect-virt                                  # kvm/none = ok; openvz/lxc = REPROVA
stat -fc %T /                                        # xfs (ou ext4); e:
xfs_info / | grep -q 'ftype=1'                       # overlay2 exige d_type
mount | grep -qE ' / .*xfs.*(pquota|prjquota)' || echo "PQUOTA AUSENTE — ver §2.5"
grep -q dockremap /etc/subuid && grep -q dockremap /etc/subgid
[ -f /sys/fs/cgroup/cgroup.controllers ] && grep -q memory /sys/fs/cgroup/cgroup.controllers
grep -q cpu /sys/fs/cgroup/cgroup.subtree_control
zgrep -q 'CONFIG_USER_NS=y' /proc/config.gz 2>/dev/null || echo "verificar user namespaces"
docker info --format '{{.Driver}} {{.CgroupDriver}} {{.SecurityOptions}}'
#   esperado: overlay2 · systemd · [name=seccomp,profile=... name=apparmor name=userns]
#   "vfs" no Driver = REPROVA (copia a imagem inteira por container)
sysctl kernel.unprivileged_userns_clone 2>/dev/null   # precisa ser 1 (ou ausente em kernels novos)
# teste REAL de escrita em cgroup aninhado:
systemd-run --unit=veloz-probe --slice=veloz-env-9999.slice -p MemoryMax=64M -p CPUQuota=50% sleep 30
cat /sys/fs/cgroup/veloz.slice/veloz-env.slice/veloz-env-9999.slice/memory.max   # 67108864
cat /sys/fs/cgroup/veloz.slice/veloz-env.slice/veloz-env-9999.slice/cpu.max      # 50000 100000
```

| # | Medição | Aprovação | Reprovação → ação |
|---|---|---|---|
| **T0** | zero `CRÍTICO` nas 2 VPS de produção | obrigatório | **trocar de VPS antes de qualquer código** |
| **T0b** | `pquota` ativo ou `mount -o loop` viável | obrigatório | sem quota → o nó não vende (§2.5) |
| **T0c** | escrita em cgroup aninhado funciona | obrigatório | requisito 9 é inviável → renegociar com o dono |

### Dia 1 — tarde (4 h): densidade e isolamento de recursos

```bash
# ---- Provisionar 12 ambientes WordPress+Woo idênticos ----
for i in $(seq 1 12); do velozctl env create --id 90$i --plan start --runtime php:8.3 \
   --seed /root/seeds/woo-200p.tar.zst; done

# ---- T1/B2 — RSS ocioso ----
sleep 600
for i in $(seq 1 12); do
  cat /sys/fs/cgroup/veloz.slice/veloz-env.slice/veloz-env-90$i.slice/memory.current
done | sort -n | awk '{a[NR]=$1} END{print "p50",a[int(NR*0.5)],"p95",a[int(NR*0.95)]}'

# ---- T8 — dedup da imagem base ----
docker system df -v | head -20
du -sh /var/lib/docker/overlay2 | tee dedup.txt

# ---- T7 — cota de disco ----
docker exec --user 10901 e0901-php dd if=/dev/zero of=/srv/app/enche bs=1M count=20000
df -h /srv/veloz     # o HOST não pode encher

# ---- B1/T9 — densidade real sob carga ----
#  subir ambientes de 4 em 4, com wrk em todos ao mesmo tempo, até o critério de parada
k6 run --vus 5 --duration 10m load.js     # 5 rps por ambiente, página de produto do Woo
watch -n5 'cat /sys/fs/cgroup/veloz.slice/veloz-env.slice/memory.pressure'
```

| # | Medição | **Aprovação** | Reprovação → ação |
|---|---|---|---|
| **T1/B2** | RSS ocioso por ambiente (php-fpm `ondemand`, sem nginx dentro) | **p95 < 150 MB** (mais exigente que os 200 MB da crítica, porque tirei o nginx e o systemd) | > 200 MB → cortar extensões e reduzir `pm.start_servers` |
| **T8** | overhead de disco por ambiente sobre a imagem | **< 50 MB** (com `--read-only`, esperado < 5 MB) | > 300 MB → investigar camada gravável |
| **T7** | escrita além da cota | `EDQUOT`, **e `df` do host não muda** | host enche → **não vender nesse nó** |
| **B1/T9** | ambientes até `memory.pressure avg60 > 20%` **ou** p95 de TTFB > 800 ms | **≥ 16 Start ativos** por nó de 16 GB (a §1.6 vende 18 contra os 9.500 vendáveis; 16 medidos validam a tabela) | 12–15 → reduzir o vendável de 9.500 para o medido; **< 12 → refazer o Achado 6.1 e subir preço** |
| **B9** | `fio --rw=randwrite --iodepth=16` num ambiente; p95 de TTFB dos vizinhos | **degradação < 20%** | > 20% → `io.max` obrigatório por ambiente (§ doc 04 3.5) |
| **B8/T10** | estourar `memory.max` de um ambiente | **`oom_kill` só no cgroup dele; `memory.events` dos vizinhos com `oom=0`** | vazou → **sobrevenda de RAM proibida**, postura A vira teto absoluto |

### Dia 2 — manhã (3 h): ciclo de vida — os requisitos 4, 7 e 9

```bash
# ---- T2/B3 — cold start, 30 ciclos, com e sem opcache file_cache ----
for i in $(seq 1 30); do
  velozctl env pause --env 0901 && sleep 3
  S=$(date +%s.%N); velozctl env start --env 0901
  curl -so /dev/null -w '%{http_code}\n' https://teste.veloz.app/
  echo "$(echo "$(date +%s.%N) - $S" | bc)"
done | sort -n | awk '{a[NR]=$1} END{print "p50",a[15],"p95",a[29]}'

# ---- T3 — hot-resize de RAM (aumento), sob carga ----
systemctl set-property veloz-env-0901.slice MemoryMax=2G MemoryHigh=1638M
cat /sys/fs/cgroup/veloz.slice/veloz-env.slice/veloz-env-0901.slice/memory.max
docker inspect -f '{{.State.Pid}}' e0901-php     # PID 1 tem de ser o MESMO de antes
docker exec e0901-php php -r '$a=str_repeat("x", 1500*1024*1024);'   # aloca 1,5 GB: deve passar

# ---- T4 — hot-resize de vCPU ----
systemctl set-property veloz-env-0901.slice CPUQuota=200%
cat .../cpu.max                                   # 200000 100000
sysbench cpu --threads=4 run                      # throughput deve ~dobrar

# ---- T5 — reduzir RAM abaixo do uso (o teste que a crítica mandou documentar) ----
#  (a) o jeito errado, para MEDIR o dano:
echo $((512*1024*1024)) > /sys/fs/cgroup/.../veloz-env-0901.slice/memory.max ; dmesg | tail
#  (b) o procedimento da §4.3:
velozctl resize --env 0901 --mem 512M     # deve RECUSAR com o número, sem matar nada

# ---- T6 — troca de PHP 8.2 -> 8.3 sob tráfego ----
k6 run --vus 10 --duration 90s load.js &   # tráfego contínuo
velozctl runtime switch --env 0901 --to php:8.3
wait; # contar 5xx no relatório do k6
```

| # | Medição | **Aprovação** | Reprovação → ação |
|---|---|---|---|
| **T2/B3** | clique → HTTP 200, 30 ciclos | **p95 < 5 s** (meta interna 2,5 s) | > 5 s → `opcache.file_cache`, pré-aquecimento; se persistir, o requisito 4 vira "iniciando… (até 10 s)" na UI |
| **T3** | `memory.max` novo vale **sem restart**, PID 1 inalterado, alocação de 1,5 GB passa | obrigatório | falha → requisito 9 não é atendível; **renegociar com o dono** |
| **T4** | `cpu.max` novo vale sem restart, throughput acompanha | obrigatório | idem |
| **T5** | (a) documentar o OOM; (b) o procedimento da §4.3 **recusa** sem matar | obrigatório | se o escalonado não converge nunca → política vira "só agendado" |
| **T6** | 5xx durante a troca | **0 erro em 200 requisições** (limite da crítica: < 2 s de indisponibilidade) | > 0 → revisar `worker_shutdown_timeout` e o `STOPSIGNAL` |
| **T6b** | RAM de pico durante o blue/green | cabe na reserva de 2 GB (§1.6) | não cabe → serializar trocas por nó |
| **B5** | `time systemctl reload nginx` com 50 vhosts | **< 1 s** | > 3 s → Caddy com API JSON |

### Dia 2 — tarde (3 h): dados, migração e isolamento

| # | Medição | Método | **Aprovação** |
|---|---|---|---|
| **T11** | **Migração n1 → n2 de 5 GB** (novo, §8.2) | procedimento completo, cronometrado, entre os dois provedores reais | **janela de corte < 180 s**; checksum do volume idêntico; 0 erro para o visitante com a cobertura ligada |
| **T12** | **`packages.toml`** (novo, §7) | declarar `ffmpeg`, build, blue/green; depois trocar de versão de PHP e conferir que `ffmpeg` continua lá | build < 5 min; `ffmpeg` presente após a troca de versão; **falha de pacote não derruba o ambiente** |
| **T13** | **SFTP com ambiente pausado** (novo, §6.5) | pausar, `sftp -P 2222`, subir arquivo, iniciar, conferir | arquivo presente; **nenhum evento de cobrança de `running` emitido durante o upload** |
| **T14** | **`scp`/`rsync` pelo caminho B** (novo, §6.2) | `scp a.zip host:/srv/app/` e `rsync -av ./dist/ host:/srv/app/public/` | funcionam **sem "command not found"** — é o teste do conjunto mínimo da imagem |
| **B6** | **Restore ponta a ponta** | apagar um ambiente de 10 GB (arquivos + banco) e restaurar do object storage no **nó de teste** | **RTO < 60 min, RPO ≤ 1 h**, HTTP 200 + checksum. **Falha aqui = não vender para ninguém** |
| **B7** | Custo de egress do restore | medir GiB baixados × R$ 0,10 e contra a cota da VPS | orçado e escrito |
| **B10** | Precisão do metering | 72 h (roda em paralelo, começa no Dia 1), 10 ambientes com pause/start aleatório | **divergência < 0,5%** entre `usage_events` e o log de estado observado |
| **B13** | Isolamento entre inquilinos | a bateria completa da §10.6 | **100% dos itens passando** |

### 9.1 Critério de decisão — o que aprova e o que reprova a arquitetura

**Reprovação imediata, sem discussão (a arquitetura não existe):**

| Se | Então |
|---|---|
| **T0** encontra `CRÍTICO` (VPS container-based, sem cgroup delegado, `vfs` em vez de overlay2) | **trocar de VPS**. Nada mais importa |
| **T3 ou T4** falham (limite novo exige restart) | o **requisito 9 do dono não é atendível** como especificado. Renegociar antes de construir |
| **B8/T10**: OOM de um ambiente afeta outro | multi-tenancy não é seguro neste kernel → **sobrevenda proibida** e postura A vira teto rígido |
| **B6**: restore não fecha | **nenhum cliente pagante**, ponto |
| **B13**: qualquer item de isolamento falha | **nenhum cliente pagante**, ponto |

**Reprovação parcial (a arquitetura sobrevive, o plano de negócio muda):**

| Se | Então |
|---|---|
| **B1/T9 < 12 ambientes Start** por nó | refazer a economia; o preço de tabela sobe ou o plano Start sai do catálogo |
| **T2 > 5 s** | o botão "Iniciar" ganha barra de progresso e a promessa muda de "instantâneo" para "alguns segundos" |
| **T6 > 0 erro** | a troca de versão passa a exigir janela agendada, e o "testar antes" vira obrigatório |
| **T11 > 300 s de corte** | migração sai do fluxo automático e vira operação agendada com aviso de 48 h |
| **B9 > 20% de degradação** | `io.max` por ambiente vira obrigatório, com perda de desempenho para todos |

**Aprovação plena:** T0–T14 e B1/B2/B5/B6/B8/B9/B10/B13 dentro dos limites → esta arquitetura é o
desenho de produção do VelozPanel, e o Ciclo 3 começa pelo agente.

---

## 10. Isolamento: prove que é real

### 10.1 As cinco fronteiras, e o que cada uma sustenta

| # | Fronteira | Mecanismo | O que impede | Força |
|---|---|---|---|---|
| 1 | **Sistema de arquivos** | mount namespace + bind mount só do próprio volume + UID distinto + `--read-only` | A ler arquivo de B | **forte** |
| 2 | **Processos** | PID namespace + `/proc` mascarado | A ver/matar processo de B | **forte** |
| 3 | **Recursos** | cgroup v2: `memory.max`, `cpu.max`, `io.weight`, `pids.max` | A consumir CPU/RAM/disco de B | **forte** (a medir: T9, B8, B9) |
| 4 | **Rede** | network namespace por ambiente + nftables | A falar com B, com o metadata do provedor, com a rede interna | **forte** |
| 5 | **Kernel** | userns-remap + `cap-drop=ALL` + seccomp + AppArmor + `no-new-privileges` | A virar root no host | **média — é a fronteira que pode ceder** (§10.5) |

### 10.2 `userns-remap` — como está configurado e o buraco honesto

```json
// /etc/docker/daemon.json
{
  "userns-remap": "default",
  "exec-opts": ["native.cgroupdriver=systemd"],
  "storage-driver": "overlay2",
  "live-restore": true,
  "no-new-privileges": true,
  "icc": false,
  "userland-proxy": false,
  "default-ulimits": {
    "nofile": {"Name":"nofile","Hard":4096,"Soft":1024},
    "nproc":  {"Name":"nproc","Hard":512,"Soft":256}
  },
  "log-driver": "local",
  "log-opts": {"max-size":"10m","max-file":"3"},
  "default-address-pools": [{"base":"10.80.0.0/16","size":28}],
  "seccomp-profile": "/etc/veloz/seccomp/default.json"
}
```
```bash
# /etc/subuid e /etc/subgid, criados pelo Docker no primeiro start
dockremap:165536:65536
# mapeamento efetivo dentro do container
docker exec e0042-php cat /proc/self/uid_map
#          0     165536      65536      ← uid 0 do container = uid 165536 no host
# o ambiente 0042 roda como uid 10042 dentro → 175578 no host
```

> **[ACHADO NOVO — o buraco, dito com todas as letras].** O `userns-remap` do Docker é **uma faixa única
> para o daemon inteiro**. Isso protege muito bem o **host** contra os containers (um "root" de container
> é um uid sem privilégio no host), mas **não separa os containers entre si por identidade**: o uid 0 do
> container A e o uid 0 do container B são **ambos** o uid 165536 do host. O Podman resolve isso com
> `--userns=auto` (faixa distinta por container); o Docker não tem equivalente.

**O que fecha o buraco, e é regra, não recomendação:**

1. **Nenhum container de ambiente roda como uid 0.** `--user $((10000+env_id))` sempre, e o Dockerfile
   termina com `USER 10000`. Regra de lint no agente + verificação no `docker inspect` a cada
   reconciliação: container de ambiente com `Config.User` vazio ou `0` é **parado e alertado**.
2. **UID interno único por ambiente** → uid distinto no host → o DAC clássico separa A de B mesmo se um
   caminho vazar. Efeito colateral bom: o `ulimit nproc` é por uid do host, então uma *fork bomb* em A
   não consome a cota de processos de B.
3. **Nenhum bind mount compartilhado entre ambientes.** Cada container monta só `/srv/veloz/envs/e<id>/`.
   Nunca montar `/srv/veloz/envs` inteiro, nunca montar `/var/run/docker.sock`, nunca `-v /:/host`.
4. **Diretório do ambiente em `0750`, dono `165536+uid_interno`**, e a única ACL é `u:www-data:rX` em
   `app/public` (§2.4).

**Gatilho de reabertura registrado:** se algum dia for preciso rodar um ambiente como root dentro do
container (tier "root real", exigência de cliente, imagem de terceiro), o Docker deixa de ser suficiente
e a decisão volta à mesa com **Podman (`--userns=auto`)** como candidato principal — mesmo modelo OCI,
mesma imagem, mesma quota XFS, mesma rotina de blue/green. **A troca custaria dias, não meses**, porque
tudo o que está neste documento é sobre OCI, não sobre Docker especificamente. Isso é deliberado.

### 10.3 O `docker run` completo, com cada flag justificada

```bash
docker run -d --name e0042-php \
  --cgroup-parent=veloz-env-0042.slice \      # limites e cobrança vivem na slice (§4.1)
  --restart=no \                              # o agente decide o que sobe (§3.5)
  --user 10042:10042 \                        # UID único → separa A de B (§10.2)
  --read-only \                               # rootfs imutável: sem apt, sem webshell persistente em /tmp de sistema
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --tmpfs /run:rw,noexec,nosuid,nodev,size=8m \
  --mount type=bind,src=/srv/veloz/envs/e0042/app,dst=/srv/app \
  --mount type=bind,src=/srv/veloz/envs/e0042/app/storage/uploads,dst=/srv/app/storage/uploads,bind-propagation=rprivate,ro=false \
  --mount type=bind,src=/srv/veloz/envs/e0042/etc/php/conf.d,dst=/etc/php/8.3/fpm/conf.d,readonly \
  --mount type=bind,src=/srv/veloz/envs/e0042/etc/php/pool.d,dst=/etc/php/8.3/fpm/pool.d,readonly \
  --mount type=bind,src=/srv/veloz/envs/e0042/cache/opcache,dst=/var/cache/php/opcache \
  --mount type=bind,src=/srv/veloz/envs/e0042/logs,dst=/srv/app/logs \
  -p 127.0.0.1:19042:9000 \                   # só loopback do host; a borda decide o que expõe
  --cap-drop=ALL \                            # zero capability: php-fpm como não-root não precisa de nenhuma
  --security-opt no-new-privileges=true \     # neutraliza setuid/setgid e pkexec
  --security-opt seccomp=/etc/veloz/seccomp/php.json \
  --security-opt apparmor=veloz-env \
  --pids-limit 256 \                          # fork bomb morre aqui
  --ulimit nofile=1024:4096 --ulimit nproc=256:512 \
  --ulimit core=0 \                           # sem core dump com dado de cliente no disco
  --network veloz-e0042 --dns 10.80.0.1 \     # netns própria (§10.4)
  --stop-signal=SIGQUIT --stop-timeout=25 \   # drain gracioso (§2.2)
  --storage-opt size=2G \                     # teto da camada gravável (exige overlay2+XFS+pquota)
  --oom-score-adj 500 \                       # se o host apertar, morre antes de MariaDB e do agente
  --log-driver local --log-opt max-size=10m \
  --label veloz.env=0042 --label veloz.runtime=php --label veloz.version=8.3 \
  --label veloz.uid=10042 --label veloz.plan=start \
  ghcr.io/velozpanel/php@sha256:aaaa…
```

Detalhes que costumam ser esquecidos e que quebram o modelo se faltarem:

- **`--cap-drop=ALL` só é possível porque php-fpm roda como não-root e escuta em porta > 1024.**
  Se algum dia o pool precisar de `listen = 80`, seria `CAP_NET_BIND_SERVICE` — e a resposta certa é
  manter a porta alta, não devolver a capability.
- **`--read-only` obriga a mapear todos os caminhos graváveis.** Se o php-fpm tentar escrever um `.pid`
  em `/var/run`, ele falha no start. Por isso o `php-fpm.conf` da imagem tem `pid = /run/php-fpm.pid`
  (que é tmpfs) e `error_log = /proc/self/fd/2`.
- **`--pids-limit 256` cabe em `pm.max_children` de até ~200.** Ao mudar plano, o `TasksMax` da slice e
  o `--pids-limit` precisam subir junto — os dois vêm da mesma `planToLimits()` (§4.4).
- **`--storage-opt size=2G`** só funciona com overlay2 sobre XFS com `pquota`. É a mesma exigência da
  §2.5, e o `node-doctor` verifica.

Perfil seccomp: partir do **perfil padrão do Docker** (que já bloqueia ~44 syscalls) e **negar mais**:
`keyctl`, `add_key`, `request_key`, `bpf`, `perf_event_open`, `userfaultfd`, `process_vm_readv/writev`,
`ptrace`, `mount`, `umount2`, `pivot_root`, `unshare`, `setns`, `clone` com `CLONE_NEWUSER`,
`io_uring_setup/enter/register`. **`io_uring` merece destaque:** é a superfície de escape mais fértil dos
últimos anos e **nenhuma aplicação PHP ou Node do cliente precisa dele**. Negar custa zero e remove uma
família inteira de CVEs.

AppArmor `veloz-env`: partir do `docker-default` e acrescentar `deny /proc/sys/** w`,
`deny /sys/fs/cgroup/** w`, `deny mount`, `deny ptrace peer=**`, e `deny /srv/veloz/** rw` (defesa
redundante contra um bind mount errado no futuro).

### 10.4 Rede

Uma bridge por ambiente (`--network veloz-e0042`, /28 do pool `10.80.0.0/16`). Custo: um veth e algumas
regras — desprezível. Ganho: **isolamento L2 por construção**, não por regra.

```
# /etc/nftables.d/veloz.nft
table inet veloz {
  set rfc1918 { type ipv4_addr; flags interval;
                elements = { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
                             169.254.0.0/16, 127.0.0.0/8, 100.64.0.0/10 } }
  chain forward {
    type filter hook forward priority -10; policy accept;
    ct state established,related accept
    iifname "br-veloz-*" oifname "br-veloz-*" counter drop            # ambiente -> ambiente: NUNCA
    iifname "br-veloz-*" ip daddr @rfc1918   counter drop             # rede interna e METADATA do provedor
    iifname "br-veloz-*" ip daddr 169.254.169.254 counter drop        # explícito: SSRF ao metadata da VPS
    iifname "br-veloz-*" tcp dport 25 counter drop                    # SMTP direto: só pelo relay do painel
  }
  chain input {
    type filter hook input priority -10; policy accept;
    iifname "br-veloz-*" ip daddr 10.80.0.1 tcp dport { 3306, 5432 } accept   # bancos compartilhados
    iifname "br-veloz-*" udp dport 53 accept                                   # DNS do nó
    iifname "br-veloz-*" counter drop                                          # nada mais do host
  }
}
```

`169.254.169.254` merece a regra explícita: em quase todo provedor de VPS, esse endereço serve
credenciais e chaves da conta. Um SSRF num plugin de WordPress que alcance o metadata **entrega a conta
inteira do provedor**, não só um site. É a falha mais barata de prevenir e a mais cara de sofrer.

### 10.5 O que fica exposto mesmo assim — honestamente

| # | Exposição | Por quê | Mitigação | Residual |
|---|---|---|---|---|
| 1 | **Kernel compartilhado** | container não é VM. Um CVE de escalada local (io_uring, netfilter, overlayfs, eBPF têm histórico) é escape | `userns-remap` (o escape cai num uid sem privilégio, não em root), seccomp negando io_uring/bpf/keyctl, `no-new-privileges`, `cap-drop=ALL`, sem compilador na imagem, **kernel sempre atualizado** — agora possível, porque tirar o ZFS eliminou o kernel pinado (Achado 1.6) | **real.** É o risco nº 1 e não some. Reduz com `unattended-upgrades` + reboot mensal com janela |
| 2 | **Faixa de subuid única do Docker** (§10.2) | limitação do Docker | uid interno único + nenhum uid 0 + nenhum mount compartilhado | baixo **enquanto a regra do uid 0 for cumprida**. Um bug do agente que suba um ambiente sem `--user` reabre isto — por isso a verificação na reconciliação |
| 3 | **A borda lê os estáticos de todos os inquilinos** (ACL da §2.4) | preço de tirar o nginx de dentro (economia de ~1 ambiente por nó) | nginx da borda com `ProtectSystem=strict`, `PrivateTmp`, `NoNewPrivileges`, sem PHP, sem módulo de terceiro, `mainline` atualizado; ACL é `rX` (leitura), nunca escrita, e só em `app/public` | **real.** RCE na borda = leitura do conteúdo público de todos. Alavanca de reversão documentada na §2.1 |
| 4 | **MariaDB/PostgreSQL compartilhados** | decisão do Conflito 2 (banco por ambiente custa 27% da capacidade) | usuário e database por ambiente, `MAX_USER_CONNECTIONS`, `statement_timeout`, `local_infile=OFF`, `REVOKE ALL ON SCHEMA public FROM PUBLIC`, sem `FILE`, sem `pg_read_server_files`, dump horário por database | **real.** Um crash ou 0-day no engine derruba **todos** do nó (raio de explosão do Achado 2.2). Aceito e escrito no SLA |
| 5 | **Canais laterais entre inquilinos** (cache/timing, Spectre-class) | núcleos compartilhados, sem *core scheduling* | `mitigations=auto`, `perf_event_paranoid=3`, `kernel.kptr_restrict=2`, `dmesg_restrict=1` | **aceito e fora do modelo de ameaça.** A própria VPS é inquilina do hipervisor do provedor — proteger contra isso aqui seria teatro |
| 6 | **O provedor da VPS lê tudo** | somos inquilinos dele | backup cifrado com `age`, chave **fora** do nó; disclosure na Política de Privacidade (LGPD); dado sensível de cliente jamais no control plane sem cifra | **estrutural.** Precisa estar no contrato, não no código |
| 7 | **`velozctl` roda como root pelo sudo do agente** | o agente não roda como root (doc 04 §11.5), mas precisa de operações privilegiadas | allowlist com **argumentos enumerados**, nunca string livre; `execFile` sem shell (doc 05, decisão 19); `env_id` validado por regex `^[0-9]{1,6}$` antes de tocar em qualquer caminho; fuzzing do parser como teste obrigatório | **real.** Um bug de parsing aqui é root no nó. É o componente que mais merece revisão manual do Tiago |
| 8 | **Egress do cliente é irrestrito** (menos as regras da §10.4) | ele precisa de composer, npm, APIs | limite de banda por ambiente na borda, contador nftables por bridge, alerta em 70% da cota do nó, AUP | **real.** Cliente comprometido vira origem de ataque; a AUP e o desligamento rápido são a resposta |
| 9 | **Nada protege contra o cliente destruir o próprio ambiente** | ele tem shell e escrita no volume | backup horário do banco + restic ≥ 4×/dia, retenção de 30 dias, **object lock/imutabilidade no bucket** (ausente em todos os documentos do Ciclo 1) | aceito. O object lock é o que impede ransomware apagar o backup junto |

### 10.6 A bateria que prova o isolamento (B13 do plano de benchmarks)

Roda no nó de teste, com dois ambientes vizinhos `e9001` (atacante) e `e9002` (vítima), e é
**critério de release**: qualquer item falhando bloqueia produção.

```bash
# ---------- 1. ARQUIVOS: A não lê B ----------
docker exec -u 19001 e9001-php ls /srv/veloz                      # esperado: No such file or directory
docker exec -u 19001 e9001-php cat /proc/self/uid_map             # 0 165536 65536
# uid de host distinto entre os dois (é o que sustenta a §10.2):
stat -c '%u' /srv/veloz/envs/e9001/app/index.php   # 175537
stat -c '%u' /srv/veloz/envs/e9002/app/index.php   # 175538   ← TÊM de diferir
docker exec -u 19001 e9001-php mount -t proc none /mnt           # esperado: EPERM
docker exec -u 19001 e9001-php touch /usr/bin/x                  # esperado: Read-only file system

# ---------- 2. PROCESSOS ----------
docker exec e9001-php ps aux            # só os próprios; nenhum PID do host, nenhum de e9002
docker exec e9001-php cat /proc/1/cmdline
for f in kcore kallsyms sched_debug timer_list sys/kernel/random/boot_id; do
  docker exec e9001-php cat /proc/$f 2>&1 | head -1               # mascarado ou vazio
done

# ---------- 3. CPU ----------
docker exec -d e9001-php stress-ng --cpu 8 --timeout 120s
wrk -t2 -c10 -d60s https://e9002.teste/                           # p95 do vizinho
cat /sys/fs/cgroup/veloz.slice/veloz-env.slice/veloz-env-9001.slice/cpu.stat | grep throttled

# ---------- 4. RAM ----------
docker exec e9001-php php -r 'str_repeat("x", 4*1024*1024*1024);' # OOM esperado
grep -E 'oom|max' /sys/fs/cgroup/.../veloz-env-9001.slice/memory.events   # oom_kill >= 1
grep oom /sys/fs/cgroup/.../veloz-env-9002.slice/memory.events            # oom 0  ← OBRIGATÓRIO
dmesg | tail -20                                                          # o kill cita o cgroup de 9001

# ---------- 5. PIDs ----------
docker exec e9001-php bash -c ':(){ :|:& };:'                     # contido por --pids-limit
cat /sys/fs/cgroup/.../veloz-env-9001.slice/pids.events            # max > 0
docker exec e9002-php php -r 'echo "vivo";'                        # vizinho intacto

# ---------- 6. I/O ----------
docker exec -d e9001-php fio --name=w --rw=randwrite --size=2G --iodepth=16 --direct=1
wrk -t2 -c10 -d60s https://e9002.teste/                            # degradação < 20%

# ---------- 7. REDE ----------
docker exec e9001-php bash -c 'timeout 3 bash -c "</dev/tcp/10.80.0.34/9000"; echo $?'  # != 0
docker exec e9001-php curl -m 3 http://169.254.169.254/latest/meta-data/                # falha
docker exec e9001-php curl -m 3 http://127.0.0.1:9797/                                  # agente inalcançável
docker exec e9001-php bash -c 'timeout 3 bash -c "</dev/tcp/10.80.0.1/3306"; echo $?'   # 0 (permitido)

# ---------- 8. FUGA DO CONTAINER ----------
docker exec e9001-php capsh --print | grep Current            # Current: =   (VAZIO)
docker exec e9001-php grep -i seccomp /proc/self/status       # Seccomp: 2   (filter)
docker exec e9001-php grep NoNewPrivs /proc/self/status       # NoNewPrivs: 1
docker exec e9001-php mknod /tmp/sda b 8 0                    # EPERM
docker exec e9001-php ls /var/run/docker.sock                 # não existe
docker exec e9001-php unshare -Ur /bin/true                   # bloqueado por seccomp
docker exec e9001-php bash -c 'echo x > /sys/fs/cgroup/cgroup.procs'   # read-only
# ferramenta de auditoria, executada de dentro:
docker exec e9001-php /tmp/amicontained     # capabilities vazias, seccomp filtering, userns ativo

# ---------- 9. BANCO ----------
docker exec e9001-php mariadb -h 10.80.0.1 -u e9001 -p… -e 'SHOW DATABASES;'   # só e9001
docker exec e9001-php mariadb -h 10.80.0.1 -u e9001 -p… -e "SELECT * FROM mysql.user;"      # negado
docker exec e9001-php mariadb -h 10.80.0.1 -u e9001 -p… -e "SELECT LOAD_FILE('/etc/passwd');" # NULL
docker exec e9001-php psql -h 10.80.0.1 -U e9001 -c '\l'                                     # só e9001
docker exec e9001-php psql -h 10.80.0.1 -U e9001 -c "COPY t FROM '/etc/passwd';"             # negado

# ---------- 10. PAINEL (o vetor mais provável na prática) ----------
#  token do cliente A contra TODO recurso de B, em TODOS os endpoints do OpenAPI
./scripts/tenant-isolation-sweep.sh --as tenantA --against tenantB   # 404 em 100%
```

| Item | Aprovação |
|---|---|
| 1 Arquivos | `EPERM`/`ENOENT` em todos; **uids de host distintos entre A e B** |
| 2 Processos | nenhum PID alheio; `/proc` sensível mascarado |
| 3 CPU | degradação do vizinho **< 20%**; `nr_throttled > 0` no atacante |
| 4 RAM | `oom_kill ≥ 1` em A, **`oom = 0` em B** |
| 5 PIDs | fork bomb contida; vizinho responde |
| 6 I/O | degradação **< 20%** |
| 7 Rede | A→B, metadata, agente e host **inacessíveis**; só banco e DNS passam |
| 8 Fuga | capabilities **vazias**, `Seccomp: 2`, `NoNewPrivs: 1`, sem socket do Docker |
| 9 Banco | só o próprio database; sem leitura de arquivo do servidor |
| 10 Painel | **404 em 100%** dos endpoints |

**Uma frase honesta sobre esta seção:** os itens 1 a 4 e 7 a 10 provam isolamento *de verdade*, com
comandos que qualquer um pode repetir. O item que **não** dá para provar é o kernel (§10.5, exposição 1)
— contra ele não há teste, há disciplina de atualização. Qualquer painel de hospedagem baseado em
container está no mesmo barco, incluindo o CloudLinux que o Hostoo usa; a diferença é dizer isso ao
cliente antes, no SLA, em vez de descobrir junto com ele.

---

## 11. Riscos e o que reprovaria esta arquitetura

| # | Risco | Probabilidade | Impacto | Mitigação / gatilho |
|---|---|---|---|---|
| R1 | **VPS é container-based** (OpenVZ/LXC) | média | **fatal** | T0 hoje. Reprovou → trocar de VPS. Nada é salvável |
| R2 | **`pquota` impossível** (sem acesso ao GRUB, sem partição separada) | média | alto | partição/LV, senão XFS em loop; senão o nó não vende (§2.5) |
| R3 | **Densidade medida < 12 Start/nó** | média | alto | refazer a economia; com 2 nós, subir preço ou reduzir catálogo |
| R4 | **Um ambiente sobe sem `--user`** e vira uid 0 compartilhado | baixa | alto | lint + verificação na reconciliação + alerta (§10.2) |
| R5 | **Escape de kernel** | baixa | **fatal** | kernel atualizado (viável agora, sem ZFS), seccomp negando io_uring/bpf, sem compilador na imagem |
| R6 | **Perder um nó com frota de 2** | média | alto | §8.3.1: reserva de resgate, pausados primeiro, terceiro nó em < 30 min, runbook impresso |
| R7 | **Backup não restaura** | baixa | **fatal** | B6 antes do primeiro cliente; clone para o nó de teste vira teste de restore contínuo (§8.4.2) |
| R8 | **`fleet roll` mal testado derruba 50% da base** | média | alto | nó de teste como portão obrigatório (§8.4.1), `--canary 2`, `--concurrency 2` |
| R9 | **Cliente exige `apt install` de verdade** | média | médio | `packages.toml` + imagem derivada (§7) cobre quase tudo; 3 de 5 pilotos exigindo pacote arbitrário fora do catálogo = reabrir o Conflito 1 |
| R10 | **Complexidade acumulada** (slices + docker + nftables + SFTPGo + xfs_quota) | alta | médio | `velozctl` é a **única** interface operacional; nenhum runbook manda editar arquivo à mão, exceto o de desastre (§8.3.1) |
| R11 | **Divergência de metering > 0,5%** | média | alto | B10; reconciliação horária bloqueia o fechamento do ciclo |

### 11.1 O que reprovaria esta arquitetura — em uma lista

1. **T0 falha:** VPS container-based, `vfs` em vez de overlay2, ou cgroup v2 não delegado.
2. **T3/T4 falham:** limite de RAM/vCPU só vale após restart → o requisito 9 do dono é inatendível.
3. **B8 falha:** OOM de um ambiente derruba outro → não há multi-tenancy seguro neste kernel.
4. **B6 falha:** restore não fecha em < 60 min → não se vende nada.
5. **B13 falha:** qualquer item de isolamento vermelho.
6. **B1 < 12 ambientes Start por nó:** a arquitetura funciona, mas o negócio não fecha nem como
   laboratório — a conversa passa a ser sobre nós maiores, não sobre software.

Nada além disso derruba o desenho. Densidade menor, start mais lento, migração mais demorada e troca de
versão com janela agendada são **ajustes de promessa ao cliente**, não mudanças de arquitetura.

### 11.2 O que este documento acrescentou à decisão do Ciclo 1

| Achado | Efeito |
|---|---|
| `containerd-shim` custa ~10 MB **por container** | decidiu 1 container por ambiente, sem nginx dentro (D1) |
| `userns-remap` do Docker é faixa única do daemon | criou a regra do UID único e o gatilho de reabertura pró-Podman (§10.2) |
| `pquota` em raiz XFS exige `rootflags` | virou item `CRÍTICO` do `node-doctor` (§2.5) |
| Slice systemd persiste e sobrevive ao `docker rm` | trocou `docker update` por `systemctl set-property` (D2, §4.1) |
| `STOPSIGNAL SIGQUIT` | sem isso, toda pausa e toda troca de versão derrubam requisições em voo |
| `scp` do OpenSSH 9+ fala SFTP | tornou `openssh-sftp-server` obrigatório na imagem (§6.2) |
| Imagem derivada por ambiente | resolve o único critério em que o Incus vencia (§7), e resolve melhor |
| ADENDO 3 (2 nós) | frota de **14 ambientes**; evacuação vira requisito de MVP; nó de teste vira portão de release |

