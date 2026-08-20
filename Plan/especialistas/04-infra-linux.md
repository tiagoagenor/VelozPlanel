# 04 — Infraestrutura Linux / SRE

> Ciclo 1 — rascunho. Autor: especialista Linux/SRE.
> Escopo: a camada de sistema operacional que sustenta o VelozPanel — isolamento, limites,
> runtimes, rede, storage, provisionamento e hardening.
> Premissas do briefing: 2–3 servidores dedicados, time de 1–3 pessoas, PHP + Node (e depois
> outras linguagens), pause/start pelo cliente, cobrança por hora, troca de versão a quente,
> super admin muda RAM/vCPU a quente.

---

## 0. Resumo das decisões (leia isto se ler só uma seção)

| # | Assunto | Decisão | Plano B |
|---|---------|---------|---------|
| 1 | Distribuição | **Debian 13 "Trixie"** (kernel 6.12 LTS) | Ubuntu 24.04 LTS |
| 2 | Isolamento | **Incus (LXC system container) não-privilegiado, 1 container por ambiente** | Podman/Quadlet por ambiente |
| 3 | Storage | **ZFS** (dataset por ambiente) | btrfs (subvolume + qgroup) |
| 4 | Limites | **cgroup v2 via Incus** (`limits.*`) + escrita direta em `memory.max` para hot-change | systemd slices |
| 5 | Web de borda | **nginx mainline (repo nginx.org)** no host, nginx leve dentro do container | Angie (brotli + ACME nativos) |
| 6 | PHP | **Sury (`packages.sury.org/php`)** dentro de imagem dourada com 7.4→8.4 pré-instalados | imagens OCI por versão |
| 7 | Node | **tarball oficial em `/opt/node/<major>` + unit systemd por app** | PM2 (rejeitado: estado próprio, difícil auditar) |
| 8 | Banco | **MySQL 8.4 + PostgreSQL 17 compartilhados por nó**, 1 db+user por ambiente | container de DB por ambiente (planos premium) |
| 9 | Rede | **bridge Incus + nftables**, egress 25/465/587 bloqueado, isolamento L2 entre containers | — |
| 10 | Provisionamento | **Ansible** (push, sem agente) + cloud-init mínimo no primeiro boot | ansible-pull via cron |
| 11 | Agente do painel | roda como usuário `veloz` no grupo `incus-admin` + helper root com allowlist | — |

---

## 1. Distribuição base

### Decisão: **Debian 13 "Trixie" (amd64)**, kernel 6.12 LTS do repositório padrão.

Justificativa, ponto a ponto:

- **Ciclo de vida.** Debian 13 tem suporte oficial até ~2028 e LTS até ~2030. Para 2–3 servidores,
  isso significa **um** upgrade grande em 5 anos. Ubuntu 24.04 LTS oferece prazo semelhante, mas
  arrasta `snapd`, `cloud-init` com opinião forte, `netplan` e `apparmor` com perfis extras que
  aumentam a superfície de coisas para depurar em produção.
- **Kernel 6.12** é LTS, tem cgroup v2 completo (incluindo `memory.high`, `memory.peak`,
  `io.max`, PSI — `cpu.pressure`/`memory.pressure`/`io.pressure`), `idmapped mounts` maduro
  (essencial para Incus não-privilegiado com bind mounts) e `fs-verity`/`overlayfs` estáveis.
- **cgroup v2 unificado é o default** (`systemd.unified_cgroup_hierarchy=1`), sem hierarquia
  híbrida — nada de surpresa com `blkio` v1.
- **PHP multi-versão.** O repositório **Sury** (Ondřej Surý) é *nativamente Debian*. É o
  repositório de referência para 7.4 até 8.4 no mesmo host, com extensões empacotadas
  (`php8.3-imagick`, `php8.3-redis`, `php8.3-intl`...). No mundo RHEL, o Remi funciona, mas
  módulos DNF e SCL complicam a coexistência de 6 versões e o naming (`php74-php-fpm`) quebra
  automação. **Isso sozinho já elimina Rocky/Alma** para o nosso caso.
- **Container tooling.** Incus 6.x tem repositório oficial (Zabbly) para Debian 13; `podman`,
  `nftables`, `systemd-nspawn` e `crun` estão no repo base.
- **Consumo ocioso.** Debian mínimo (`debootstrap` + systemd + sshd) fica em ~180–250 MB de RSS
  no host. Ubuntu Server pós-instalação típico fica em 400–600 MB por causa de snapd, multipathd,
  ubuntu-advantage e amigos. Com 2–3 nós, isso é 1 GB "de graça" por nó.

Por que **não**:
- **Ubuntu 24.04 LTS** — escolha legítima e o nosso **plano B**. Vantagens reais: AppArmor com
  perfis prontos, HWE kernel, `livepatch` (Ubuntu Pro grátis até 5 máquinas — atraente para 3 nós).
  Se o time preferir Ubuntu por familiaridade, **nada neste documento muda**, exceto o nome de 2–3
  pacotes. Não vale brigar por isso.
- **Rocky/Alma 9/10** — SELinux é superior ao AppArmor em confinamento, mas o custo de escrever
  políticas para um painel que gera vhosts, sockets e mounts dinamicamente é alto demais para um time
  de 1 pessoa. Somado ao PHP multi-versão ruim, está fora.

### Base mínima instalada no nó

```bash
# perfil "sem tarefas" no instalador Debian; depois:
apt install --no-install-recommends \
  systemd-timesyncd nftables zfsutils-linux zfs-dkms \
  incus incus-client \
  nginx \
  chrony auditd apparmor apparmor-utils unattended-upgrades \
  jq curl ca-certificates gnupg xfsprogs acl attr \
  prometheus-node-exporter
```

> `zfs-dkms` vem de `contrib`. **Risco conhecido:** um upgrade de kernel pode quebrar o build do
> DKMS e o pool não monta no boot. Mitigação obrigatória: kernel pinado
> (`apt-mark hold linux-image-amd64`), upgrade de kernel feito manualmente, um nó por vez, com
> `zpool status` no checklist pós-boot. Se isso assustar, o plano B (btrfs) elimina o problema em
> troca de send/recv menos maduro e qgroups lentos.

---

## 2. Isolamento do ambiente do cliente — a decisão central

### 2.1 As cinco opções, avaliadas com honestidade

#### (a) Usuário Unix + pool PHP-FPM + `open_basedir` (modelo cPanel clássico)

- **Segurança:** a mais fraca das cinco. Todos compartilham o mesmo kernel *e* o mesmo espaço de
  nomes de PID, mount, rede e usuários. `open_basedir` é uma checagem *dentro do PHP*, não do
  kernel: qualquer extensão nativa, `proc_open`, ou bug de PHP a contorna. `/etc/passwd` é legível
  por todos (enumeração de clientes). Um `chmod 755` errado em um `wp-config.php` vaza senha de
  banco entre clientes. Node/Python/Go rodando como usuário do cliente ignoram `open_basedir`
  totalmente — ou seja, **o modelo não estende para os runtimes que o briefing exige**.
- **Densidade:** a melhor. ~40–80 MB por cliente ocioso (só o master FPM + 1–2 workers). 64 GB ⇒
  300+ contas.
- **Boot:** instantâneo (não há boot).
- **Hot resize:** possível via `systemctl set-property` na slice do usuário. Funciona bem.
- **Backup/migração:** ruim. Migrar = rsync de arquivos + dump de banco + recriar usuário,
  vhosts, cron, chaves SSH. É script frágil e artesanal.
- **Complexidade:** baixa no dia 1, **alta no ano 2** (é exatamente por isso que cPanel/Plesk
  têm milhares de CVEs de escalonamento entre contas).

#### (b) LXC / Incus (container de sistema)

- **Segurança:** boa e *real*. Container não-privilegiado usa **user namespace com shift de UID**
  (root do container = uid 1000000 no host), `seccomp`, `AppArmor`, capabilities cortadas,
  `/proc` e `/sys` mascarados. Escape exige bug de kernel — não um `chmod` errado. Leitura cruzada
  de arquivos é impossível: rootfs separados, com UIDs distintos por container.
- **Densidade:** boa. Container Debian mínimo com nginx + PHP-FPM ocioso: **110–140 MB RSS**
  (systemd ~25 MB, journald ~10 MB, nginx 1 worker ~12 MB, php-fpm master + 2 workers ~60–90 MB).
  A imagem base é **clone ZFS** — disco marginal por cliente é ~50–200 MB, não 1,2 GB.
- **Boot:** `incus start` até systemd `running` = **0,6–2,0 s**. Primeira requisição HTTP servida
  em ~2–3 s. Atende o alvo de < 5 s.
- **Hot resize:** nativo e imediato. `incus config set env-0042 limits.memory 4GiB` escreve
  `memory.max` no cgroup **sem reiniciar nada**. vCPU idem.
- **Backup/migração:** o melhor dos cinco. `incus snapshot`, `incus export`, e
  `incus copy --refresh nodeA:env-0042 nodeB:env-0042` usando `zfs send` incremental.
  Migração entre nós com downtime de segundos.
- **Complexidade:** média-baixa. Um daemon (`incusd`), um CLI, uma API REST em socket unix.
  Documentação boa. Uma pessoa opera isso.

#### (c) Docker / Podman por ambiente

- **Segurança:** comparável ao LXC quando rootless/user-namespaced. Podman rootless é sólido.
- **Densidade:** melhor que LXC (sem systemd/journald dentro) — ~70–100 MB.
- **Boot:** ~0,3–1 s. Excelente.
- **Problema real:** o modelo mental é **imutável e efêmero**, e hospedagem compartilhada é
  **mutável e persistente**. O cliente vai dar `apt install` porque um plugin pediu; vai gravar
  uploads; vai querer cron; vai querer shell. Cada uma dessas coisas vira um volume, um sidecar
  ou um workaround. Multi-versão de PHP vira multiplicação de imagens e rebuild.
  **Hot resize de memória em container OCI rodando existe** (`podman update --memory`), mas o
  ecossistema não trata isso como caminho principal.
- **Backup/migração:** volumes precisam ser gerenciados à parte; não há `copy --refresh`.
- **Veredito:** ótimo para os *serviços do painel* (ver §11), errado para o *ambiente do cliente*.

#### (d) systemd-nspawn / systemd user slices

- `nspawn` é essencialmente LXC com menos ferramentas: sem API, sem storage backend, sem
  snapshot/migração, sem gerenciamento de imagem, sem rede declarativa. Teríamos que escrever
  tudo isso nós mesmos. **Rejeitado por custo de construção.**
- `user slices` puras (`user-1001.slice`) são o modelo (a) com nome bonito: mesmo kernel namespace,
  mesma fragilidade. **Útil como camada complementar**, não como isolamento.

#### (e) microVM (Firecracker / Cloud Hypervisor)

- **Segurança:** a melhor de todas. Kernel separado, superfície de ataque ~50 syscalls no VMM.
- **Densidade:** ruim para o nosso caso. Cada microVM tem kernel + rootfs próprios: **200–400 MB
  ocioso mínimo**, e a memória é *reservada*, não compartilhada por page cache. 64 GB ⇒ ~100 VMs
  no papel, ~60 na prática.
- **Boot:** 125–250 ms de VM, mas +2–4 s de boot do guest até nginx pronto. Aceitável.
- **Hot resize:** **este é o bloqueador.** Aumentar RAM a quente exige virtio-mem/balloon com
  suporte no guest; reduzir é pior ainda. Firecracker não suporta hotplug de vCPU. O requisito 9
  do briefing (super admin muda RAM/vCPU a quente) fica capenga.
- **Complexidade:** alta. Precisamos construir gerência de imagem, rede (TAP + IPAM), storage,
  snapshot, console, agente dentro do guest. É um trabalho de time, não de 1 pessoa.
- **Veredito:** superdimensionado para o dia 1. Guardar para um futuro plano "isolamento
  dedicado" vendido caro.

### 2.2 Decisão

> **Um container de sistema Incus (LXC) não-privilegiado por ambiente de cliente, com rootfs em
> dataset ZFS clonado de uma imagem dourada.**

Defesa em uma frase por requisito do briefing:

| Requisito | Como o Incus atende |
|---|---|
| Pause/start pelo cliente (req. 4) | `incus stop` libera 100% da RAM; `incus start` em ~1,5 s; disco intacto |
| Cobrança por hora (req. 5) | estado do container é a fonte da verdade; parado = só disco |
| Troca de versão de linguagem (req. 7) | dentro do container, `systemctl` + reload de nginx; cada cliente é um universo |
| Gráficos por ambiente (req. 8) | cgroup v2 do container expõe CPU/RAM/IO/PSI; leitura O(1) |
| RAM/vCPU a quente (req. 9) | `incus config set` escreve no cgroup vivo |
| Arquitetura aberta a outras linguagens (req. 1) | é um Debian inteiro: instalar Go/Ruby/Java é `apt` + unit |
| Modularidade (req. 2) | módulos do painel = perfis Incus + templates de config |

**Plano B: Podman + Quadlet por ambiente.** Se o Incus se mostrar um gargalo (upstream pequeno,
bug crítico), o caminho de fuga é empacotar o ambiente como imagem OCI com volume persistente em
`/srv/velozpanel/data/<env>` e unidades `.container` geridas por systemd. Boa parte do que
construirmos (templates de vhost, agente, esquema de limites cgroup, nftables) é reaproveitável,
porque **o contrato interno do agente será "ambiente" e não "container Incus"** — ver §11.3.

**Otimização futura (não no dia 1):** um tier "Starter" barato onde N clientes pequenos dividem
*um* container multi-tenant com o modelo (a) por dentro. Ganha densidade 4x, perde isolamento.
Só fazer isso depois que o produto estiver de pé, e vender explicitamente como tier inferior.

### 2.3 Densidade estimada (números para o dono do produto)

Perfil de um ambiente WordPress típico, ocioso:

```
systemd + journald + cron   ~  35 MB
nginx (1 worker)            ~  12 MB
php-fpm master + 2 workers  ~  75 MB
-----------------------------------
ocioso                      ~ 122 MB
sob tráfego leve (5 rps)    ~ 300–450 MB
pico (pm.max_children=5)    ~ 600–800 MB
```

Reservas do host: ZFS ARC + kernel + edge nginx + MySQL + PostgreSQL + agente + observabilidade.

| Nó | RAM total | Reserva host | Disponível | Planos 512 MB | Planos 1 GB | Planos 2 GB |
|---|---|---|---|---|---|---|
| 32 GB | 32 | 8 (ARC 4 + DBs 3 + resto 1) | 24 GB | ~46 ativos | ~23 ativos | ~11 ativos |
| 64 GB | 64 | 12 (ARC 6 + DBs 4 + resto 2) | 52 GB | ~100 ativos | ~50 ativos | ~25 ativos |
| 128 GB | 128 | 20 | 108 GB | ~210 ativos | ~105 ativos | ~52 ativos |

Com `MemoryHigh` (soft) em 75% e `MemoryMax` (hard) no valor do plano, e sabendo que 30–50% dos
ambientes ficam pausados ou idle, é seguro **overcommit de 1,5x na soma de `MemoryMax`**:

> **Alvo prático: 64 GB ⇒ 80–130 ambientes ativos + 50–80 pausados. 32 GB ⇒ 35–60 ativos.**

Disco: com ZFS `compression=lz4` (~1,8–2,2x em código PHP) e clone da imagem dourada, um ambiente
de 10 GB de quota ocupa ~1,5–4 GB reais. **2 TB NVMe ⇒ 200–400 ambientes** confortavelmente.

CPU: usar `limits.cpu.allowance` percentual (não pinning) para permitir burst. Regra de bolso:
**overcommit de 4:1 de vCPU** (32 threads físicos ⇒ vender até 128 vCPU) com `cpu.weight`
protegendo quem paga mais.

---

## 3. Limites de recurso com cgroup v2

### 3.1 Mapeamento Incus → cgroup v2

Onde o cgroup vive (confirmar sempre, o prefixo mudou de `lxc.payload.` do LXD para o do Incus):

```bash
PID=$(incus info env-0042 | awk '/PID/{print $2}')
cat /proc/$PID/cgroup
# 0::/incus.payload.env-0042/...
CG=/sys/fs/cgroup/incus.payload.env-0042
```

| Chave Incus | Arquivo cgroup v2 | Observação |
|---|---|---|
| `limits.memory` | `memory.max` | com `enforce=soft` vira `memory.high` |
| `limits.memory.enforce` | hard/soft | ver §3.4 |
| `limits.memory.swap` | `memory.swap.max` | recomendamos `false` (swap = latência imprevisível) |
| `limits.cpu` (nº) | `cpuset.cpus` | pinning — **não usar** para clientes |
| `limits.cpu.allowance` | `cpu.max` | `"50%"` ⇒ `50000 100000` |
| `limits.cpu.priority` | `cpu.weight` | 0–10 → peso |
| `limits.processes` | `pids.max` | |
| `limits.disk.priority` | `io.weight` | precisa de `bfq`/`io.cost` — ver §3.5 |

### 3.2 Perfis Incus por plano

Criar um perfil por plano comercial. Ambiente = perfil + overrides.

```bash
incus profile create plano-p1
incus profile set plano-p1 limits.memory=1GiB
incus profile set plano-p1 limits.memory.enforce=hard
incus profile set plano-p1 limits.memory.swap=false
incus profile set plano-p1 limits.cpu.allowance=100%     # 1 vCPU equivalente, com burst
incus profile set plano-p1 limits.cpu.priority=5
incus profile set plano-p1 limits.processes=384
incus profile set plano-p1 limits.disk.priority=5
incus profile set plano-p1 limits.kernel.nofile=8192
incus profile set plano-p1 boot.autostart=false          # o painel decide quem sobe
incus profile device add plano-p1 root disk pool=veloz path=/ size=10GiB
```

Criação de ambiente:

```bash
incus launch images:debian/13/cloud env-0042 \
  --profile default --profile plano-p1 --profile rede-cliente \
  --config user.veloz.env_id=0042 \
  --config user.veloz.owner=cliente-julia
```

Na prática usamos a **imagem dourada** local (§5.1), não `images:`:

```bash
incus launch local:veloz-base-2026.02 env-0042 --profile plano-p1 --profile rede-cliente
```

### 3.3 Mudança a quente de RAM e vCPU (requisito 9)

**Via CLI** (o que o admin faz no terminal):

```bash
# RAM: 1 GiB -> 4 GiB, sem reiniciar nada
incus config set env-0042 limits.memory 4GiB

# vCPU: 1 -> 3 (300% de um core), sem reiniciar nada
incus config set env-0042 limits.cpu.allowance 300%

# prioridade relativa sob contenção
incus config set env-0042 limits.cpu.priority 8
```

**Via API REST** (o que o agente do painel faz — `PATCH` preserva as outras chaves):

```bash
curl -sS --unix-socket /var/lib/incus/unix.socket \
  -X PATCH http://incus/1.0/instances/env-0042 \
  -H 'Content-Type: application/json' \
  -d '{"config":{"limits.memory":"4GiB","limits.cpu.allowance":"300%"}}'
```

**Verificação de que pegou a quente:**

```bash
CG=/sys/fs/cgroup/incus.payload.env-0042
cat $CG/memory.max   # 4294967296
cat $CG/cpu.max      # 300000 100000
```

**Caveats honestos que precisam estar na documentação do painel:**

1. **Reduzir `memory.max` abaixo do uso atual** dispara reclaim imediato e pode causar OOM-kill
   dentro do container. O painel deve, ao *reduzir*, aplicar `memory.high` primeiro, esperar
   30–60 s de reclaim, e só então baixar `memory.max`. Se `memory.current` não cair, recusar a
   redução e avisar o admin.

   ```bash
   # downgrade seguro 4GiB -> 1GiB
   echo 1073741824 > $CG/memory.high      # pressiona
   sleep 45
   cur=$(cat $CG/memory.current)
   [ "$cur" -le 1073741824 ] && incus config set env-0042 limits.memory 1GiB \
     || echo "RECUSADO: uso atual ${cur}B > alvo"
   ```

2. **`limits.cpu` numérico (pinning de cpuset) NÃO é seguro a quente** em kernels antigos e causa
   invalidação de cache. Por isso a decisão de usar **sempre `limits.cpu.allowance` percentual**.
   O painel mostra "vCPU" e converte: `2 vCPU = allowance 200%`.

3. **php-fpm não sabe que ganhou memória.** Aumentar RAM sem ajustar `pm.max_children` não muda
   nada na prática. O agente deve, ao mudar RAM, reescrever o pool e dar `systemctl reload
   php8.3-fpm` (reload do FPM é gracioso, não derruba requisições em voo). Fórmula:
   `pm.max_children = floor((MemoryMax * 0.6) / avg_worker_mb)`, `avg_worker_mb` medido de fato
   (default conservador: 80 MB).

### 3.4 Estratégia `MemoryHigh` + `MemoryMax`

```
MemoryHigh = 0.80 * plano     -> a partir daqui o kernel faz throttle de alocação
MemoryMax  = 1.00 * plano     -> aqui o OOM killer age
MemorySwapMax = 0
```

`memory.high` é o que salva a experiência: em vez de matar o processo do cliente de cara, o kernel
o desacelera e faz reclaim. O site fica lento **antes** de cair — e o painel tem tempo de emitir
alerta "você está usando 82% da memória".

Aplicação direta (o Incus com `enforce=soft` só usa `high`; queremos os dois, então o agente
escreve `memory.high` manualmente):

```bash
CG=/sys/fs/cgroup/incus.payload.env-0042
echo $((1024*1024*1024))            > $CG/memory.max     # 1 GiB
echo $((1024*1024*1024 * 80 / 100)) > $CG/memory.high    # 819 MiB
echo 0                              > $CG/memory.swap.max
```

> Essa escrita manual é **volátil**: some se o container reiniciar. O agente reaplica no evento
> `instance-started` (hook do Incus, ver §11.3).

### 3.5 I/O em NVMe

O `io.weight` só tem efeito com um controlador ativo. Em NVMe, `bfq` custa CPU; a escolha correta
é **`io.cost`** (controlador `blk-iocost`), calibrado uma vez por disco:

```bash
# 1) descobrir major:minor do NVMe
lsblk -no MAJ:MIN /dev/nvme0n1        # ex.: 259:0

# 2) habilitar o modelo de custo (uma vez, no boot, via systemd-tmpfiles ou unit)
echo '259:0 enable=1 ctrl=auto' > /sys/fs/cgroup/io.cost.qos

# 3) peso relativo por ambiente (default 100)
echo 'default 100'   > /sys/fs/cgroup/incus.payload.env-0042/io.weight
echo '259:0 50'      > /sys/fs/cgroup/incus.payload.env-0042/io.weight   # cliente contido
```

Teto absoluto (para conter o cliente que roda `find /` ou um backup selvagem):

```bash
# 200 MB/s leitura, 100 MB/s escrita, 5k/2k IOPS
echo '259:0 rbps=209715200 wbps=104857600 riops=5000 wiops=2000' \
  > /sys/fs/cgroup/incus.payload.env-0042/io.max
```

**Caveat importante e frequentemente esquecido:** com rootfs em **ZFS**, o I/O do container passa
pelas threads do ZFS (`z_wr_iss`, `z_rd_int`), que rodam **fora** do cgroup do container. Logo,
`io.max` no cgroup do container **não limita escrita em ZFS** de forma confiável. Consequências:

- Para *leitura/escrita direta em block device* (pool LVM-thin), `io.max` funciona.
- Em ZFS, a contenção de I/O é feita por: (i) `zfs set` de propriedades por dataset
  (`logbias`, `sync=standard`, `recordsize=16K` para MySQL), (ii) limitar o *gerador* de I/O —
  `IOWeight` no serviço de backup, `nice`/`ionice` em cron do cliente, e (iii) `TasksMax` +
  `CPUQuota`, que indiretamente limitam quanto I/O um ambiente consegue gerar.
- **Aceitar essa limitação no dia 1** e monitorar `io.pressure` (PSI) por ambiente. Se um cliente
  aparecer com `io.pressure avg10 > 40%` de forma recorrente, é caso de intervenção manual.
  Documentar isso como risco conhecido (ver §12).

### 3.6 Exemplo equivalente com systemd slice (caminho do plano B / serviços do host)

```ini
# /etc/systemd/system/veloz-env-0042.slice
[Unit]
Description=Ambiente VelozPanel 0042
Before=slices.target

[Slice]
MemoryAccounting=yes
MemoryHigh=819M
MemoryMax=1G
MemorySwapMax=0
CPUAccounting=yes
CPUQuota=100%
CPUWeight=100
IOAccounting=yes
IOWeight=100
IOReadBandwidthMax=/dev/nvme0n1 200M
IOWriteBandwidthMax=/dev/nvme0n1 100M
TasksAccounting=yes
TasksMax=384
```

Hot change sem editar arquivo nem reiniciar:

```bash
systemctl set-property --runtime veloz-env-0042.slice MemoryMax=4G CPUQuota=300%
# sem --runtime, persiste em /etc/systemd/system.control/
```

### 3.7 OOM: o que acontece, o que o cliente vê, o que o painel reporta

Sequência real quando um ambiente estoura:

1. Uso passa de `memory.high` → kernel faz reclaim síncrono. Sintoma: **site lento**, latência sobe.
   Detectável em `memory.pressure` (`some avg10`).
2. Uso bate `memory.max` → OOM killer do cgroup mata o maior processo (normalmente um worker
   php-fpm ou o Node). Contador `memory.events:oom_kill` incrementa.
3. Se matou um worker FPM: a requisição daquele worker morre → nginx do container devolve **502**.
   O FPM master recria o worker automaticamente. Impacto: 1 requisição.
4. Se matou o Node (processo único): a unit `veloz-app@.service` tem `Restart=always` →
   volta em `RestartSec=2`. Impacto: ~3 s de 502.
5. Se matou o `systemd` do container (raro, ele tem `oom_score_adj` protegido): o container morre;
   o agente detecta via evento Incus e sobe de novo.

Coleta pelo agente (a cada 15 s):

```bash
CG=/sys/fs/cgroup/incus.payload.env-0042
grep -E '^(oom|oom_kill|max)' $CG/memory.events
#   max 1204        <- quantas vezes bateu memory.max
#   oom 3
#   oom_kill 3
cat $CG/memory.peak                    # pico histórico
awk '/some/{print $2}' $CG/memory.pressure   # avg10=...
```

**O que o painel mostra ao cliente** (linguagem humana, nada de "oom_kill"):

> ⚠️ **Seu ambiente ficou sem memória 3 vezes hoje.**
> Às 14:32, 14:41 e 15:07 o ambiente atingiu o limite de 1 GB e um processo foi encerrado.
> Visitantes podem ter visto erro 502. Pico de uso: 1,02 GB.
> [Ver gráfico] · [Aumentar para 2 GB — +R$ X,XX/h] · [Ver processos que mais consomem]

**O que o visitante vê:** página de erro do VelozPanel (não a página branca do nginx), com
`Retry-After: 5`, servida pelo nginx de borda quando o upstream falha — ver §6.4.

**Alerta ao admin:** > 5 `oom_kill` em 1 h no mesmo ambiente, ou > 20 ambientes com OOM na mesma
hora (sinal de nó sobrevendido, não de cliente ruim).

---

## 4. Pausar / iniciar ambiente

### 4.1 O que "pausado" significa exatamente

**Decisão: pausar = `incus stop` (não `incus pause`).**

`incus pause` usa o freezer do cgroup (`cgroup.freeze=1`): congela processos mas **mantém toda a
RAM alocada**. Isso serve para *suspender temporariamente um abusador*, mas **não serve para o
requisito 5** (não gerar custo), porque a RAM continua ocupada e não pode ser vendida a outro
cliente. `incus stop` mata os processos, libera a RAM e mantém o dataset ZFS intacto.

| Componente | Estado quando pausado | Onde vive |
|---|---|---|
| Processos (nginx, php-fpm, node, cron) | **parados**, RAM 100% liberada | container |
| Disco / arquivos / uploads | **preservados** integralmente | dataset ZFS `veloz/envs/env-0042` |
| Snapshots e backups | **preservados**, backup continua rodando (é feito do dataset, não de dentro) | host |
| DNS autoritativo | **continua respondendo normalmente** (o domínio não some) | serviço DNS do painel |
| Registros A/AAAA | continuam apontando para o IP de borda do nó | — |
| HTTP/HTTPS | borda responde **503 + página "ambiente pausado"** (certificado TLS válido) | nginx de borda |
| E-mail (MX) | **continua recebendo e entregando na caixa** — mail é serviço compartilhado, não vive no container | nó de e-mail |
| Webmail | **continua funcionando** (o cliente lê e-mail com o site pausado) | nó de e-mail |
| MySQL / PostgreSQL | **dados preservados**; conta do ambiente com `MAX_USER_CONNECTIONS=0` e sessões encerradas | DB compartilhado do nó |
| Cron do cliente | **não executa** | container |
| Filas / workers | **não executam** | container |
| Certificado SSL | renovação **continua** (ACME roda no nó de borda com HTTP-01 respondido pela borda, não pelo container) | host |
| SSH / SFTP do cliente | **indisponível** enquanto pausado (o painel oferece "iniciar para acessar") | — |

Essa tabela precisa aparecer **literalmente na UI**, num tooltip do botão "Pausar". É a fonte de
90% dos tickets se ficar implícita.

### 4.2 Fluxo de pausa

```bash
# agente, ao receber POST /envs/0042/pause
incus exec env-0042 -- systemctl stop nginx php8.3-fpm veloz-app@main   # drain gracioso
sleep 2
incus stop env-0042 --timeout 30           # SIGPWR -> systemd shutdown; após 30s, SIGKILL
mysql -e "ALTER USER 'e0042'@'%' WITH MAX_USER_CONNECTIONS 0;"
mysql -e "KILL <ids das sessões de e0042>"
psql -c "ALTER ROLE e0042 CONNECTION LIMIT 0;"
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='e0042';"
# marcar estado + emitir evento de billing
velozctl state set 0042 paused
```

### 4.3 Fluxo de start e o alvo de tempo

```bash
incus start env-0042
# aguarda o sinal de pronto (agente dentro do container ou probe TCP)
for i in $(seq 1 50); do
  incus exec env-0042 -- ss -ltn 'sport = :80' | grep -q LISTEN && break
  sleep 0.1
done
mysql -e "ALTER USER 'e0042'@'%' WITH MAX_USER_CONNECTIONS 30;"
psql -c "ALTER ROLE e0042 CONNECTION LIMIT 30;"
velozctl state set 0042 running
```

Medições esperadas em NVMe (a validar em bancada no ciclo 2):

| Etapa | Tempo |
|---|---|
| `incus start` retorna | 250–500 ms |
| systemd do container em `running` | 0,6–1,2 s |
| php-fpm + nginx aceitando conexão | 1,2–2,0 s |
| primeira resposta HTTP (WordPress, opcache frio) | 2,0–3,5 s |

> **Alvo: < 5 s do clique até a primeira página.** Atendido com folga.
> Otimizações se necessário: `systemd-analyze` dentro da imagem dourada e mascarar unidades
> inúteis (`systemd-networkd-wait-online`, `apt-daily`, `man-db`), `opcache.file_cache` persistente
> em `/var/cache/php/opcache` (sobrevive ao stop e corta ~40% do tempo da 1ª requisição).

### 4.4 Cobrança quando pausado

O agente emite eventos de transição de estado num log append-only; o painel integra por segundo:

```json
{"ts":"2026-08-20T14:03:11Z","env":"0042","from":"running","to":"paused","node":"n1",
 "mem_bytes":1073741824,"cpu_allowance":100,"disk_bytes":10737418240}
```

Regra: **`running` cobra RAM + vCPU + disco. `paused` cobra apenas disco** (armazenamento
provisionado, não usado — senão o cliente é punido por não conseguir apagar arquivos com o
ambiente parado). Reconciliação a cada hora contra `incus list -f json` (estado real vence o log).

Guarda-corpo obrigatório: ambiente pausado por > 90 dias entra em política de expurgo com aviso
por e-mail em D-30, D-7, D-1. Sem isso, o disco é consumido por contas mortas.

### 4.5 Página "ambiente pausado" para visitantes

No nginx de borda, o vhost do ambiente inclui um arquivo cujo conteúdo o agente troca conforme o
estado. Ambiente pausado:

```nginx
# /etc/nginx/veloz/state/env-0042.conf   (incluído dentro do server{} do ambiente)
location / {
    return 503;
}
error_page 503 = @veloz_paused;
```

```nginx
# /etc/nginx/veloz/snippets/paused.conf  (global)
location @veloz_paused {
    internal;
    add_header Retry-After 10 always;
    add_header Cache-Control "no-store" always;
    default_type text/html;
    root /usr/share/velozpanel/pages;
    try_files /paused.html =503;
}
```

`paused.html` é estático, branded, com `<meta name="robots" content="noindex">` e **status 503**
(não 200 — 503 preserva o SEO; 200 numa página de erro faz o Google indexar "site pausado").

**Opcional "acordar ao receber visita"** (checkbox do cliente, default **desligado**):
a página faz `fetch('/_veloz/wake', {method:'POST'})` → nginx de borda tem
`location = /_veloz/wake { proxy_pass http://127.0.0.1:9797/wake/0042; }` no agente local, que
dispara o start e retorna 202. O JS faz polling de `/` a cada 1 s e recarrega quando vier 200.
Isso é melhor que segurar a conexão do visitante por 3 s (que estoura timeout de bot e CDN).

---

## 5. Multi-versão de runtime na prática

### 5.1 Imagem dourada

Uma imagem base construída semanalmente por pipeline, publicada no `incus image` local de cada nó:

```
veloz-base-<YYYY.MM.DD>
├── Debian 13 mínimo
├── nginx (repo nginx.org, mainline)
├── PHP 7.4, 8.0, 8.1, 8.2, 8.3, 8.4 (Sury) — TODOS instalados, TODOS os units desabilitados
├── Node 18, 20, 22, 24 em /opt/node/<major> — nenhum "current" definido
├── composer, wp-cli, git, rsync, unzip, curl, msmtp (relay para o SMTP do painel)
└── veloz-guest-agent (§11.3)
```

Como PHP 7.4 já saiu do Sury para Debian 13, ele vem de imagem/repo congelado interno
(`repo.velozpanel.internal/php-legacy`), servido **como está, sem promessa de patch de segurança**,
e a UI precisa dizer isso com todas as letras. PHP 7.4 e 8.0 são "legado, use por sua conta e
risco, migre".

Custo de disco disso tudo: ~2,8 GB na imagem. Com **clone ZFS**, cada ambiente novo custa
**~0 bytes** até começar a escrever. É exatamente por isso que "instalar todas as versões" é
gratuito neste desenho — e por isso ZFS/btrfs é decisão estrutural, não detalhe.

```bash
incus launch local:veloz-base-2026.02.10 env-0042 --profile plano-p1
# por baixo: zfs clone veloz/images/veloz-base-2026.02.10@ro veloz/envs/env-0042
```

### 5.2 PHP: pools, sockets, ini

Um pool por ambiente **por versão ativa** (normalmente só uma ativa). Como cada ambiente é um
container, o pool se chama sempre `veloz` — sem risco de colisão de nomes:

```ini
; /etc/php/8.3/fpm/pool.d/veloz.conf   (dentro do container)
[veloz]
user = app
group = app
listen = /run/php/veloz-8.3.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

pm = ondemand
pm.max_children = 8            ; recalculado pelo agente quando a RAM muda (§3.3)
pm.process_idle_timeout = 20s  ; libera RAM entre picos — essencial para densidade
pm.max_requests = 500          ; corta leak de extensão

; recursos
php_admin_value[memory_limit]        = 256M
php_admin_value[max_execution_time]  = 120
php_admin_value[upload_max_filesize] = 128M
php_admin_value[post_max_size]       = 128M
php_admin_value[open_basedir]        = /srv/app:/tmp:/var/lib/php/sessions
php_admin_value[sys_temp_dir]        = /srv/app/tmp
php_admin_value[session.save_path]   = /var/lib/php/sessions
php_admin_value[disable_functions]   = exec,passthru,shell_exec,system,proc_open,popen,dl
php_admin_flag[allow_url_fopen]      = off

; opcache
php_admin_value[opcache.enable]                  = 1
php_admin_value[opcache.memory_consumption]      = 128
php_admin_value[opcache.max_accelerated_files]   = 20000
php_admin_value[opcache.validate_timestamps]     = 1
php_admin_value[opcache.revalidate_freq]         = 2
php_admin_value[opcache.file_cache]              = /var/cache/php/opcache
php_admin_value[opcache.file_cache_only]         = 0

; logs e slowlog (alimentam a aba "Logs" do painel)
access.log   = /srv/app/logs/php-access.log
access.format = "%R %t \"%m %r\" %s %d %{mili}d %{kilo}M %C%%"
slowlog      = /srv/app/logs/php-slow.log
request_slowlog_timeout = 5s
catch_workers_output = yes
```

> `disable_functions` acima é o **default do painel**, editável pelo cliente na UI (com aviso).
> Como o isolamento real vem do container, não somos obrigados a ser draconianos — mas o default
> seguro evita 95% dos webshells de WordPress comprometido.

**`php.ini` por cliente:** um arquivo `/srv/app/config/php.ini` que a UI edita, validado antes de
aplicar, e carregado via `php_admin_value[...]` gerado a partir dele. **Não** dar `.user.ini` livre
(o cliente desliga `open_basedir` sem querer). O agente valida com allowlist de diretivas.

**Extensões:** o painel expõe uma lista de checkboxes que vira
`apt install php8.3-{imagick,redis,intl,gd,mbstring,zip,bcmath,soap,xdebug}` seguido de
`systemctl reload php8.3-fpm`. Como o pacote já está no cache da imagem dourada, é instantâneo.
Xdebug **nunca** habilitado por default (mata a performance); ativar é botão com aviso e
auto-desligamento em 2 h.

**Composer:** binário em `/usr/local/bin/composer`, executado sempre como usuário `app`, com
`COMPOSER_HOME=/srv/app/.composer`, `COMPOSER_MEMORY_LIMIT` derivado do plano, e cgroup do
container já limitando. Rodar `composer install` num ambiente de 512 MB é a causa #1 de OOM —
o painel deve detectar e sugerir "aumentar RAM temporariamente" (e oferecer boost de 30 min).

### 5.3 Troca de versão de PHP sem downtime perceptível

O vhost não aponta para um socket fixo; aponta para um `include` gerado:

```nginx
# /etc/nginx/veloz/upstream.conf   (dentro do container)
upstream php_app { server unix:/run/php/veloz-8.2.sock; }
```

```nginx
# no server{}
location ~ \.php$ {
    include fastcgi_params;
    fastcgi_pass php_app;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_read_timeout 120s;
}
```

Procedimento de troca 8.2 → 8.3 (executado pelo `veloz-guest-agent`):

```bash
set -e
OLD=8.2; NEW=8.3
cp /etc/nginx/veloz/upstream.conf /var/lib/veloz/upstream.conf.bak      # 1) rollback pronto

systemctl start php${NEW}-fpm                                           # 2) sobe a nova em paralelo
for i in $(seq 1 30); do [ -S /run/php/veloz-${NEW}.sock ] && break; sleep 0.1; done

SCRIPT_FILENAME=/usr/share/velozpanel/healthz.php \
  cgi-fcgi -bind -connect /run/php/veloz-${NEW}.sock >/dev/null          # 3) health check real

printf 'upstream php_app { server unix:/run/php/veloz-%s.sock; }\n' "$NEW" \
  > /etc/nginx/veloz/upstream.conf.new
mv /etc/nginx/veloz/upstream.conf.new /etc/nginx/veloz/upstream.conf     # 4) troca atômica
nginx -t                                                                # 5) valida
systemctl reload nginx                                                  # 6) reload gracioso

sleep 15                                                                # 7) drena a antiga
systemctl stop php${OLD}-fpm
systemctl disable php${OLD}-fpm && systemctl enable php${NEW}-fpm
```

Downtime real: **zero**. O `reload` do nginx mantém os workers antigos vivos até terminarem as
requisições em voo (`worker_shutdown_timeout 30s`).

**Rollback automático:** o agente faz 10 requisições ao `/` do site após a troca. Se ≥ 3 devolverem
5xx, ele restaura `upstream.conf.bak`, `nginx -s reload`, religa a versão antiga e marca a operação
como falha no painel, com o log do erro (`php-fpm` costuma reclamar de extensão faltando ou
sintaxe deprecada). O cliente vê: *"Não foi possível mudar para PHP 8.3 — revertemos para 8.2.
Motivo: extensão `imagick` não disponível em 8.3. [Ver log]"*.

**Pré-checagem antes de trocar** (isso evita a maior parte dos rollbacks): rodar
`php8.3 -l` em todos os `.php` do projeto? Caro. Melhor: rodar
`vendor/bin/phpcompatibility` ou, mais simples e barato, checar (i) as extensões carregadas na
versão atual existem na nova, (ii) `composer.json` declara `php` compatível. Mostrar o resultado
como semáforo antes do botão.

### 5.4 Node: versões, processo persistente, proxy

**Versões:** tarballs oficiais em `/opt/node/18`, `/opt/node/20`, `/opt/node/22`, `/opt/node/24`.
Sem nvm (é orientado a shell interativo, não a serviço), sem `n`, sem `NodeSource` (mistura com
`apt` e só serve uma versão por vez).

```bash
install -d /opt/node
curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz \
 | tar -xJ -C /opt/node --strip-components=1 --one-top-level=22
/opt/node/22/bin/node -v
```

Seleção por ambiente = uma variável no EnvironmentFile, não um symlink global (symlink global
quebra apps que ficaram para trás):

```ini
# /srv/app/config/app.env  (editável pela UI)
VELOZ_NODE=22
NODE_ENV=production
PORT=3000
```

**Processo persistente — decisão: unit systemd por app, não PM2.**

Por quê: PM2 mantém um daemon próprio com estado próprio (`~/.pm2`), logs próprios, um formato
de restart próprio e um `pm2 save/resurrect` que falha silenciosamente. Já temos systemd dentro do
container — usar dois supervisores é dobrar a superfície de falha. Passenger foi descartado por
acoplar ao servidor web e complicar a troca de versão.

```ini
# /etc/systemd/system/veloz-app@.service   (na imagem dourada)
[Unit]
Description=VelozPanel app %i
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=exec
User=app
Group=app
WorkingDirectory=/srv/app/current
EnvironmentFile=/srv/app/config/app.env
Environment=PATH=/srv/app/current/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/veloz-node-exec %i
Restart=always
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=25

# logs -> journald -> painel
StandardOutput=journal
StandardError=journal
SyslogIdentifier=veloz-app-%i

# hardening extra dentro do container (defesa em profundidade)
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/srv/app/storage /srv/app/logs /srv/app/tmp
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
MemoryHigh=70%
MemoryMax=90%

[Install]
WantedBy=multi-user.target
```

```bash
#!/bin/sh
# /usr/local/bin/veloz-node-exec — resolve a versão no momento do start
. /srv/app/config/app.env
exec "/opt/node/${VELOZ_NODE}/bin/node" ${VELOZ_APP_ENTRY:-server.js}
```

`systemctl enable --now veloz-app@main`. Um segundo processo (worker de fila) é
`veloz-app@worker` com `VELOZ_APP_ENTRY` próprio — mesma unit template, zero código novo.

**Proxy reverso** (nginx do container → app Node):

```nginx
upstream node_main { server 127.0.0.1:3000 fail_timeout=3s; keepalive 16; }

location / {
    proxy_pass http://node_main;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    proxy_next_upstream error timeout http_502 http_503;
}
```

**Troca de versão do Node sem downtime (blue/green de porta):**

```bash
NEW=24; NEWPORT=3001
sed -i "s/^VELOZ_NODE=.*/VELOZ_NODE=$NEW/; s/^PORT=.*/PORT=$NEWPORT/" /srv/app/config/app.env.new
install -m640 -o app -g app /srv/app/config/app.env.new /srv/app/config/app.blue.env

systemctl start veloz-app@blue                                   # sobe na 3001
for i in $(seq 1 100); do curl -fsS localhost:3001/healthz && break; sleep 0.1; done \
  || { systemctl stop veloz-app@blue; echo "FALHOU: rollback sem impacto"; exit 1; }

printf 'upstream node_main { server 127.0.0.1:%s fail_timeout=3s; keepalive 16; }\n' "$NEWPORT" \
  > /etc/nginx/veloz/upstream-node.conf
nginx -t && systemctl reload nginx

sleep 10
systemctl stop veloz-app@main
# promove blue -> main na próxima janela (ou renomeia arquivos e reinicia como main)
```

Se `npm ci` com a nova versão falhar (node-gyp, ABI de módulo nativo), nada foi tocado no tráfego —
o app antigo nunca parou. Esse é o argumento decisivo do blue/green por porta contra "reinstalar
por cima".

### 5.5 Padrão para adicionar Python/Go/Ruby/Java/Bun depois

O mecanismo acima é generalizável. Cada runtime vira um **manifesto declarativo** no módulo
correspondente do painel:

```toml
# /usr/share/velozpanel/runtimes/python.toml
name          = "python"
versions      = ["3.11", "3.12", "3.13"]
install       = "apt-get install -y python3.{v}-full python3.{v}-venv"
version_probe = "/usr/bin/python3.{v} --version"
prefix        = "/opt/py/{v}"
kind          = "process"          # "process" | "fastcgi" | "static"
exec          = "/srv/app/.venv/bin/gunicorn -b 127.0.0.1:{port} -w {workers} {entry}"
unit_template = "veloz-app@.service"
health        = "GET /healthz"
switch        = "bluegreen-port"   # a mesma rotina da §5.4
logs          = "journald:veloz-app-{slot}"
```

```toml
# /usr/share/velozpanel/runtimes/php.toml
name          = "php"
versions      = ["7.4","8.0","8.1","8.2","8.3","8.4"]
kind          = "fastcgi"
socket        = "/run/php/veloz-{v}.sock"
unit          = "php{v}-fpm.service"
switch        = "socket-swap"      # a rotina da §5.3
```

Adicionar **Bun** ou **Go** depois = adicionar um `.toml` + testar. Não mexe em código do agente.
Isso é o que materializa o requisito 1 ("aberta a outras linguagens") e o requisito 2
("modular") na camada de infra.

Go/Java/Rust caem em `kind = "process"` com `exec` apontando para um binário compilado; o único
extra é um passo de build opcional no deploy (`go build`, `mvn package`) executado dentro do
container com limite de RAM temporariamente elevado.

---

## 6. Web server de borda

### 6.1 Decisão: **nginx mainline** (repositório oficial `nginx.org`) no host + nginx no container

| Candidato | Prós | Contras | Veredito |
|---|---|---|---|
| **nginx** | conhecimento universal, `-t` confiável, reload gracioso comprovado com milhares de vhosts, HTTP/3 desde 1.25, ecossistema de módulos | brotli não vem no repo oficial; sem ACME nativo | **escolhido** |
| Caddy | TLS automático excelente, config curta | reload recarrega tudo (JSON completo) e fica pesado com muitos sites; menos gente sabe depurar; plugins exigem rebuild do binário | não |
| Angie (fork do nginx) | brotli, HTTP/3, ACME e balanceamento no core; config idêntica ao nginx | projeto novo, comunidade pequena, origem/governança concentrada | **plano B** |
| OpenLiteSpeed | LSAPI é rápido para PHP, cache de página integrado | licença/limites da versão Enterprise, config em XML/GUI hostil a automação, comunidade menor | não |

TLS automático não é motivo para escolher Caddy: emitimos os certificados **fora** do web server
(`lego`/`certbot` no agente, com DNS-01 quando possível), o que é melhor para wildcards e para
migração entre nós.

### 6.2 Arquitetura de duas camadas

```
Internet
   │ 443 (TLS 1.3 + HTTP/3)
   ▼
nginx de borda (host)  ── TLS, HTTP/3, cache de página, rate limit, WAF leve, logs
   │ HTTP/1.1 keepalive para 10.60.x.y:80
   ▼
nginx do container     ── arquivos estáticos, rewrite do app, fastcgi_pass, config do cliente
   ▼
php-fpm / node
```

Custo: ~12 MB de RAM por container. Ganho: (i) o cliente pode ter config própria sem tocar no
nginx do host, (ii) permissões funcionam (com UID shift, o nginx do host **não consegue** ler os
arquivos do container — `www-data`=33 no host ≠ 1000033 do rootfs), (iii) um erro de config do
cliente derruba só o site dele.

> A alternativa de camada única (host nginx servindo os arquivos direto) foi descartada exatamente
> pelo item (ii): exigiria arquivos world-readable ou ACLs frágeis, matando o isolamento que
> justifica todo o desenho.

### 6.3 Geração de vhost e reload seguro

Layout no host:

```
/etc/nginx/
├── nginx.conf                       # global, versionado, não gerado
├── veloz/
│   ├── global/
│   │   ├── ssl.conf                 # ciphers, OCSP, HTTP/3
│   │   ├── ratelimit.conf           # zonas limit_req/limit_conn
│   │   └── proxy.conf               # headers padrão
│   ├── snippets/paused.conf
│   ├── state/env-0042.conf          # gerado: running | paused | suspended
│   └── sites/env-0042.conf          # gerado a partir de template
└── conf.d/ -> include /etc/nginx/veloz/sites/*.conf;
```

Template (Go `text/template` no agente):

```nginx
# /etc/nginx/veloz/sites/env-0042.conf  — GERADO, não editar
server {
    listen 443 ssl;
    listen 443 quic reuseport;
    listen [::]:443 ssl;
    listen [::]:443 quic;
    http2 on;

    server_name julia.com.br www.julia.com.br;

    ssl_certificate     /etc/velozpanel/certs/julia.com.br/fullchain.pem;
    ssl_certificate_key /etc/velozpanel/certs/julia.com.br/privkey.pem;
    include /etc/nginx/veloz/global/ssl.conf;
    add_header Alt-Svc 'h3=":443"; ma=86400' always;

    include /etc/nginx/veloz/state/env-0042.conf;    # <- pause/suspenso entra aqui

    limit_req  zone=perip burst=40 nodelay;
    limit_conn perip_conn 24;
    client_max_body_size 128m;

    access_log /var/log/nginx/envs/0042.access.log veloz buffer=64k flush=5s;
    error_log  /var/log/nginx/envs/0042.error.log warn;

    location / {
        include /etc/nginx/veloz/global/proxy.conf;
        proxy_cache veloz_page;
        proxy_cache_key "$scheme$host$request_uri";
        proxy_cache_bypass $veloz_nocache;
        proxy_no_cache     $veloz_nocache;
        proxy_cache_valid 200 301 302 10m;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_background_update on;
        proxy_cache_lock on;
        add_header X-Veloz-Cache $upstream_cache_status always;
        proxy_pass http://10.60.0.42:80;
    }
}
```

Reload **seguro e em lote** (nunca reload por operação individual — 200 vhosts × 1 reload por
mudança derruba o nó):

```bash
#!/bin/bash
# /usr/local/sbin/veloz-nginx-apply  — chamado com debounce de 2s pelo agente
set -euo pipefail
STAGE=/run/velozpanel/nginx-stage
rm -rf "$STAGE"; cp -a /etc/nginx "$STAGE"
# o agente já escreveu os arquivos novos em $STAGE/veloz/sites/
if ! nginx -t -p "$STAGE" -c "$STAGE/nginx.conf" 2>/run/velozpanel/nginx-test.log; then
    logger -t veloz "nginx -t FALHOU, mudanças descartadas"
    cat /run/velozpanel/nginx-test.log
    exit 1
fi
rsync -a --delete "$STAGE/veloz/" /etc/nginx/veloz/
nginx -t                    # cinto e suspensório: valida no caminho real
systemctl reload nginx      # SIGHUP: workers antigos terminam as requisições em voo
```

```nginx
# nginx.conf (trechos relevantes)
worker_processes auto;
worker_rlimit_nofile 131072;
worker_shutdown_timeout 30s;     # reload não corta conexão longa (SSE/WebSocket/upload)
events { worker_connections 16384; multi_accept on; }
```

### 6.4 Cache, compressão, HTTP/3

```nginx
proxy_cache_path /var/cache/nginx/pages levels=1:2 keys_zone=veloz_page:128m
                 max_size=20g inactive=60m use_temp_path=off;

map $http_cookie $veloz_nocache {
    default 0;
    "~*wordpress_logged_in|comment_author|woocommerce_items_in_cart|PHPSESSID|laravel_session" 1;
}
map $request_method $veloz_nocache_m { default 0; POST 1; PUT 1; PATCH 1; DELETE 1; }

gzip on; gzip_vary on; gzip_comp_level 5; gzip_min_length 512;
gzip_types text/plain text/css application/json application/javascript
           text/xml application/xml image/svg+xml application/wasm;
```

Brotli: **não** no dia 1 (o repo oficial não empacota). Opções, em ordem de preferência quando
virar prioridade: (1) migrar a borda para **Angie** (config compatível, brotli no core),
(2) compilar `ngx_brotli` como módulo dinâmico num job de CI e distribuir o `.so` via nosso repo
apt. Ganho real de brotli sobre gzip-5 em HTML: 12–18%. Não é urgente.

HTTP/3 exige `listen 443 quic` + UDP/443 liberado no nftables + `Alt-Svc`. Fallback para
HTTP/2 é automático.

### 6.5 Rate limit e proteção L7 básica

```nginx
# /etc/nginx/veloz/global/ratelimit.conf
limit_req_zone  $binary_remote_addr zone=perip:32m      rate=20r/s;
limit_req_zone  $binary_remote_addr zone=login:16m      rate=12r/m;   # /wp-login, /admin
limit_conn_zone $binary_remote_addr zone=perip_conn:16m;
limit_req_status 429;
limit_conn_status 429;

client_body_timeout 12s;      # anti-slowloris
client_header_timeout 12s;
send_timeout 20s;
reset_timedout_connection on;
```

Aplicado nas rotas caras:

```nginx
location ~* ^/(wp-login\.php|xmlrpc\.php|wp-admin/admin-ajax\.php) {
    limit_req zone=login burst=8 nodelay;
    include /etc/nginx/veloz/global/proxy.conf;
    proxy_pass http://10.60.0.42:80;
}
location = /xmlrpc.php { return 403; }   # default do painel, desligável
```

Camadas acima do nginx:

1. **nftables** (§8): conn-rate limit por IP em L4, drop de SYN flood, `synproxy` se necessário.
2. **CrowdSec** (`crowdsec` + `crowdsec-firewall-bouncer-nftables`) lendo
   `/var/log/nginx/envs/*.access.log` e banindo via `nftables set` com timeout. Escolhido sobre
   fail2ban por usar sinal comunitário e por ter bouncer nftables nativo. Módulo opcional do painel.
3. **Cloudflare / provedor** para L3/L4 volumétrico — nenhum servidor dedicado aguenta 50 Gbps.
   Deixar isso claro na documentação: **nós não protegemos contra DDoS volumétrico**, protegemos
   contra abuso L7. Vender o contrário é criar expectativa impossível.

---

## 7. Filesystem e storage

### 7.1 Pool ZFS e layout

```bash
zpool create -o ashift=12 -O compression=lz4 -O atime=off -O relatime=on \
  -O xattr=sa -O acltype=posixacl -O dnodesize=auto \
  veloz mirror /dev/nvme0n1 /dev/nvme1n1

zfs create -o mountpoint=/var/lib/incus/storage-pools/veloz veloz/incus
zfs create veloz/backups
zfs create -o recordsize=16k -o primarycache=metadata veloz/db      # MySQL/PG
zfs create -o compression=zstd-3 veloz/logs
```

Mirror, não RAIDZ: com NVMe e ~200 ambientes por nó, o que importa é IOPS e tempo de resilver,
não capacidade bruta. RAIDZ em NVMe pequeno é falso ganho.

Layout lógico:

```
/var/lib/incus/storage-pools/veloz/containers/env-0042/rootfs/   <- dataset ZFS clonado
   ├── srv/app/
   │   ├── public/          document root
   │   ├── releases/        deploys (symlink current -> releases/2026-08-20-1)
   │   ├── storage/         uploads, cache (persiste entre deploys)
   │   ├── logs/            nginx, php, app  (montado com exec=off)
   │   ├── tmp/             sys_temp_dir     (exec=off, nosuid)
   │   └── config/          php.ini, app.env, nginx do cliente
   └── ...

/srv/velozpanel/            <- coisas do painel, no host
   ├── backups/<env>/
   ├── certs/<domínio>/
   └── state/

/var/lib/velozpanel/        <- estado do agente
   ├── agent.db             sqlite: mapeamento env->nó, portas, versões
   └── templates/
```

### 7.2 Quota de disco

**Decisão: quota = `refquota` do dataset ZFS**, exposto pelo Incus como `size` do device root.

```bash
incus config device set env-0042 root size=20GiB
# equivale a: zfs set refquota=20G veloz/incus/containers/env-0042
```

Por que não as alternativas:
- **XFS project quotas** funcionam bem e são leves, mas não dão snapshot nem send/recv — e
  snapshot/migração é metade do valor deste desenho.
- **LVM thin** dá snapshot mas a quota é o tamanho do LV (redimensionar exige `resize2fs`) e
  o thin pool cheio corrompe tudo silenciosamente. Perigoso para um time de 1 pessoa.

`refquota` (e não `quota`) é a chave: garante que os **snapshots não contem** contra a quota do
cliente. Caso contrário, o cliente é punido pelos nossos backups.

Aumentar quota a quente: `zfs set refquota=40G ...` — **imediato, sem unmount**. Reduzir só é
possível acima do uso atual (o painel deve checar antes e recusar com mensagem clara).

### 7.3 Medir uso de disco sem `du`

`du -sh` em 200 ambientes com milhões de inodes é inaceitável (minutos de I/O). Com ZFS a resposta
é **O(1)**, lida da metadata:

```bash
zfs list -Hp -o name,used,referenced,logicalreferenced,quota,refquota \
  -r veloz/incus/containers
# veloz/incus/containers/env-0042  3187671040  3011239936  6123847680  0  21474836480
```

- `referenced` = o que o cliente realmente ocupa hoje (o que cobramos/limitamos)
- `logicalreferenced` = antes da compressão (o que **mostramos** ao cliente — bate com o que ele vê)
- `used` = inclui snapshots (custo nosso)

Coleta a cada 5 min, uma chamada para o nó inteiro. Custo: milissegundos.

Para o detalhamento "quais pastas ocupam mais" (que o cliente pede), rodar `du` **dentro do
container**, com `ionice -c3 nice -n19`, no máximo 1x/dia, e cachear o resultado.

### 7.4 Snapshots

```bash
# retenção: 24 horárias, 7 diárias, 4 semanais
incus snapshot create env-0042 auto-$(date +%Y%m%d%H%M) --no-expiry
incus config set env-0042 snapshots.schedule "@hourly"
incus config set env-0042 snapshots.expiry "24H"
incus config set env-0042 snapshots.pattern "auto-{{creation_date|%Y%m%d-%H%M}}"
```

Snapshot ZFS de container **rodando** é atômico no nível do filesystem mas não do banco. Como
MySQL/PG ficam **fora** do container (§8.4), o snapshot do rootfs é consistente para arquivos;
o backup de banco é lógico (`mysqldump --single-transaction`, `pg_dump -Fc`) e coordenado pelo
módulo de backup. Documentar essa separação — é a diferença entre "restaurei" e "restaurei e o
banco está de ontem".

Restore self-service: `incus snapshot restore env-0042 auto-20260820-1400`. ~2 s. Isso vira o
botão "restaurar para" do painel e é um diferencial forte de produto.

### 7.5 Permissões, ACL, `noexec`

Dentro do container (UIDs do container, deslocados no host):

```
/srv/app                 app:app         0750
/srv/app/public          app:app         0750   (nginx do container está no grupo app)
/srv/app/config          app:app         0700
/srv/app/storage         app:app         2770   (setgid: uploads herdam o grupo)
/srv/app/tmp             app:app         1770
/srv/app/logs            app:adm         0750
```

```bash
setfacl -R  -m g:www-data:rx /srv/app/public
setfacl -R -d -m g:www-data:rx /srv/app/public   # default ACL para arquivos novos
```

`noexec`/`nosuid` nos diretórios de escrita (webshell em `/uploads` deixa de ser executável por
um `exec`, embora PHP ainda possa *incluir* o arquivo — por isso `open_basedir` continua):

```bash
incus config device add env-0042 apptmp disk \
  source=veloz/incus/custom/env-0042-tmp path=/srv/app/tmp
zfs set exec=off setuid=off devices=off veloz/incus/custom/env-0042-tmp
zfs set exec=off setuid=off devices=off veloz/incus/custom/env-0042-storage
```

E o bloqueio definitivo de webshell em uploads, no nginx do container:

```nginx
location ^~ /storage/ { location ~ \.(php|phar|phtml|py|pl|cgi|sh)$ { return 403; } }
location ~ /\.(env|git|svn|ht) { deny all; }
location ~ ^/(vendor|node_modules)/ { deny all; }
```

---

## 8. Rede

### 8.1 Topologia por nó

```
eth0            IP público do nó (ex.: 203.0.113.10)  — borda, entra tráfego
vlz0 (bridge)   10.60.0.1/16                          — rede dos containers, sem rota externa direta
env-0042        10.60.0.42/16  (IP derivado do env_id, determinístico)
```

```bash
incus network create vlz0 \
  ipv4.address=10.60.0.1/16 ipv4.nat=false ipv4.dhcp=false \
  ipv6.address=none \
  ipv4.firewall=false ipv6.firewall=false   # nós controlamos o nftables, não o Incus
```

NAT de saída, roteamento e filtragem ficam **integralmente** no nosso ruleset nftables — misturar
com as regras auto-geradas do Incus é fonte garantida de confusão em incidente.

Perfil de rede do ambiente:

```bash
incus profile device add rede-cliente eth0 nic \
  nictype=bridged parent=vlz0 \
  security.mac_filtering=true \
  security.ipv4_filtering=true \
  security.port_isolation=true      # <- isolamento L2: containers não se enxergam na bridge
```

`security.port_isolation=true` é o ponto crítico: sem ele, dois containers na mesma bridge se
falam livremente em L2 (ARP spoof, varredura, ataque ao MySQL do vizinho se ele expuser porta).

### 8.2 nftables

```nft
#!/usr/sbin/nft -f
# /etc/nftables.conf
flush ruleset

define WAN     = eth0
define LAN     = vlz0
define ENVNET  = 10.60.0.0/16
define ADMIN   = { 198.51.100.7, 198.51.100.8 }        # IPs de administração
define NODES   = { 203.0.113.10, 203.0.113.11, 203.0.113.12 }

table inet filter {
    set ban4 { type ipv4_addr; flags timeout; }        # alimentado pelo CrowdSec

    chain input {
        type filter hook input priority filter; policy drop;
        ct state established,related accept
        ct state invalid drop
        iif lo accept
        ip saddr @ban4 drop

        # anti-flood L4
        tcp flags syn tcp option maxseg size 1-535 drop
        ct state new tcp dport { 80, 443 } \
            meter conn_rate { ip saddr limit rate 120/second burst 240 packets } accept
        udp dport 443 accept                            # HTTP/3

        icmp type echo-request limit rate 5/second accept
        icmpv6 type { nd-neighbor-solicit, nd-router-advert, nd-neighbor-advert } accept

        tcp dport 22 ip saddr $ADMIN accept             # SSH admin: só de IP conhecido
        tcp dport 2222 accept                           # SSH/SFTP de cliente (gateway, §8.5)

        # entre nós: replicação, incus, métricas
        ip saddr $NODES tcp dport { 8443, 3306, 5432, 9100, 9797 } accept

        # containers -> host: só DNS e o agente
        iif $LAN udp dport 53 accept
        iif $LAN tcp dport 53 accept
        iif $LAN ip daddr 10.60.0.1 tcp dport 9797 accept
        iif $LAN tcp dport { 3306, 5432 } accept        # DB compartilhado do nó
        iif $LAN drop
    }

    chain forward {
        type filter hook forward priority filter; policy drop;
        ct state established,related accept

        # ISOLAMENTO ENTRE CLIENTES: nada de container -> container
        iif $LAN oif $LAN drop

        # container -> internet, MENOS redes privadas (impede pivotar para infra interna)
        iif $LAN oif $WAN ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, \
                                     169.254.0.0/16, 127.0.0.0/8 } drop
        # BLOQUEIO DE SPAM: porta 25/465/587 nunca saem direto
        iif $LAN oif $WAN tcp dport { 25, 465, 587, 2525 } \
            log prefix "veloz-smtp-block " counter drop
        iif $LAN oif $WAN accept
    }

    chain output { type filter hook output priority filter; policy accept; }
}

table inet nat {
    chain postrouting {
        type nat hook postrouting priority srcnat;
        ip saddr $ENVNET oif $WAN masquerade
    }
    chain prerouting {
        type nat hook prerouting priority dstnat;
        # sem DNAT para clientes: todo HTTP entra pelo nginx de borda
    }
}
```

### 8.3 E-mail de saída do cliente

Bloquear 25/465/587 no egress é **obrigatório** — sem isso, um WordPress comprometido bota o IP do
nó em blocklist e derruba o e-mail de todos os clientes daquele nó. O caminho legítimo:

- Dentro do container, `msmtp` configurado como `sendmail` apontando para
  `smtp-relay.velozpanel.internal:587` com credencial **por ambiente**.
- `php.ini` com `sendmail_path = /usr/bin/msmtp -t`.
- O relay aplica: autenticação, limite de N mensagens/hora por ambiente, reescrita de envelope,
  assinatura DKIM do domínio do cliente, e log auditável.
- Cliente que precisa de SMTP externo (SendGrid, SES) pode pedir liberação de destino específico
  via painel — vira uma regra nftables com `ip daddr <ip> tcp dport 587 accept`, aprovada por admin.

### 8.4 Acesso do cliente ao próprio banco

Decisão: **MySQL 8.4 e PostgreSQL 17 rodam no host (fora dos containers)**, um por nó, com
1 database + 1 role por ambiente. Motivo: 200 instâncias de MySQL num nó consomem 200× ~200 MB de
buffer pool para nada; uma instância com 4 GB de buffer pool serve todos com muito mais eficiência.

Controle de vizinho barulhento:

```sql
-- MySQL
CREATE USER 'e0042'@'10.60.0.42' IDENTIFIED BY '...'
  WITH MAX_USER_CONNECTIONS 30 MAX_QUERIES_PER_HOUR 200000;
GRANT ALL PRIVILEGES ON `e0042_%`.* TO 'e0042'@'10.60.0.42';
```

```sql
-- PostgreSQL
CREATE ROLE e0042 LOGIN CONNECTION LIMIT 30;
CREATE DATABASE e0042_app OWNER e0042;
ALTER ROLE e0042 SET statement_timeout = '60s';
ALTER ROLE e0042 SET idle_in_transaction_session_timeout = '120s';
REVOKE CONNECT ON DATABASE e0042_app FROM PUBLIC;
```

O host binda em `10.60.0.1` (não em `0.0.0.0`). A conta é amarrada ao **IP do container**
(`'e0042'@'10.60.0.42'`), então nem com a senha vazada outro cliente conecta. O serviço do banco
inteiro roda numa slice com `MemoryMax` e `IOWeight` próprios.

Acesso externo (o cliente quer usar TablePlus/DBeaver do notebook): **não** expor 3306 na
internet. Oferecer **túnel SSH** pelo gateway (§8.5) — `ssh -L 3306:10.60.0.1:3306 e0042@nó -p 2222`
— e Adminer/phpMyAdmin dentro do painel. Isso está alinhado com o que o Hostoo faz.

Plano premium ("banco dedicado"): um container adicional só com MySQL/PG, com cgroup próprio.
Mesma mecânica de tudo o mais.

### 8.5 SSH e SFTP do cliente

Um `sshd` dedicado no host, porta 2222, que não dá shell no host nunca:

```
# /etc/ssh/sshd_veloz.conf  (instância separada: systemctl enable ssh@veloz)
Port 2222
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
AllowTcpForwarding yes           # necessário para o túnel de banco
PermitOpen 10.60.0.1:3306 10.60.0.1:5432
X11Forwarding no
AllowAgentForwarding no
MaxAuthTries 3
MaxStartups 20:40:100
LoginGraceTime 20

Match all
  AuthorizedKeysCommand /usr/local/sbin/veloz-authkeys %u %f
  AuthorizedKeysCommandUser veloz-authkeys
  ForceCommand /usr/local/sbin/veloz-jump
```

`veloz-authkeys` consulta o `agent.db` e devolve as chaves do ambiente `%u` (usuários são
`e0042`, não existem em `/etc/passwd` — usar `nss` mínimo ou um usuário genérico com `Match`).

```bash
#!/bin/bash
# /usr/local/sbin/veloz-jump  — ponte para dentro do container, sem shell no host
set -euo pipefail
ENV_ID="${VELOZ_ENV:?}"                     # injetado via environment= na authorized_keys
CT="env-${ENV_ID}"

# ambiente pausado: mensagem clara, não um erro críptico
if [ "$(incus info "$CT" | awk '/^Status/{print tolower($2)}')" != "running" ]; then
    echo "Ambiente pausado. Inicie pelo painel (ou 'veloz start') e conecte de novo." >&2
    exit 75
fi

case "${SSH_ORIGINAL_COMMAND:-}" in
  ""|"-l")                      exec incus exec "$CT" --user 1000 --cwd /srv/app -- /bin/bash -l ;;
  *sftp-server*|"internal-sftp") exec incus exec "$CT" --user 1000 -- /usr/lib/openssh/sftp-server ;;
  *)                            exec incus exec "$CT" --user 1000 --cwd /srv/app -- \
                                  /bin/bash -lc "$SSH_ORIGINAL_COMMAND" ;;
esac
```

Isso entrega, com um único daemon: shell, `scp`, **SFTP** (FileZilla funciona), `rsync` e `git`.
Não precisamos de chroot/jail artesanal — o container **é** o jail, e é um jail de kernel.

FTP simples (o Hostoo oferece) só se houver demanda: `vsftpd` com TLS obrigatório, ou nada. FTP em
claro em 2026 não deve ser oferecido.

---

## 9. Migração entre servidores

### 9.1 Pré-requisito: cluster Incus ou peers confiáveis

Com 2–3 nós, **não** usar o modo cluster do Incus (exige quorum de 3, e perder 2 nós trava tudo).
Usar **remotes** simples com certificado mútuo:

```bash
# no nó destino
incus config set core.https_address :8443
incus config trust add nodeA --name nodeA          # gera token
# no nó origem
incus remote add nodeB https://203.0.113.11:8443 --token <token>
```

### 9.2 Procedimento (downtime medido em segundos)

```bash
ENV=env-0042; SRC=local; DST=nodeB

# 1) cópia inicial com o ambiente NO AR (zfs send full) — pode levar minutos
incus copy $SRC:$ENV $DST:$ENV --instance-only --stateless

# 2) N passadas incrementais até o delta ficar pequeno (zfs send -i)
for i in 1 2 3; do incus copy $SRC:$ENV $DST:$ENV --refresh; done

# --- janela de corte a partir daqui ---
# 3) congela escrita do lado A: borda A passa a proxiar para B (ver 9.3)
velozctl route set 0042 --to nodeB --drain 15s

# 4) para na origem e faz a última sincronização (delta de segundos)
incus stop $SRC:$ENV --timeout 20
incus copy $SRC:$ENV $DST:$ENV --refresh

# 5) migra o banco (dump+restore, ou replicação prévia com corte no binlog)
mysqldump --single-transaction --routines --triggers e0042_app \
  | ssh nodeB "mysql e0042_app"

# 6) sobe no destino
incus start $DST:$ENV
velozctl state set 0042 running --node nodeB

# 7) valida e só então remove a origem
curl -fsS -H 'Host: julia.com.br' http://10.60.0.42/healthz
incus delete $SRC:$ENV
```

Downtime real: **etapas 4–6, tipicamente 8–25 s**, dominadas pelo dump do banco. Para bancos
grandes (> 2 GB), montar replicação MySQL/PG antes e fazer só a promoção — cai para ~3 s.

### 9.3 Como o tráfego segue o ambiente

O nome DNS aponta para o IP do **nó atual**, com TTL 60 s. Durante o corte, o **nó antigo continua
respondendo** e faz proxy para o novo por 15 minutos:

```nginx
# gerado por 'velozctl route set 0042 --to nodeB'
server {
    server_name julia.com.br;
    location / { proxy_pass https://203.0.113.11; proxy_ssl_server_name on;
                 include /etc/nginx/veloz/global/proxy.conf; }
}
```

Assim, resolvers com cache de DNS antigo não veem nada. Depois de 15 min (>> TTL), o vhost antigo
é removido.

> Alternativa considerada e adiada: um par de nós de borda dedicados com IP flutuante, com todo o
> HTTP entrando por eles e roteando para o nó dono do ambiente. Elimina o passo de DNS e simplifica
> a migração para "trocar uma linha de um mapa". **Vale a pena a partir de ~4 nós** — não agora,
> porque cria SPOF e mais um par de máquinas para 2–3 nós.

### 9.4 Balanceamento de ocupação

Score de nó calculado a cada 5 min:

```
pressao = 0.45*(mem_alocada/mem_util) + 0.25*(cpu_p95/cpu_total)
        + 0.20*(disk_referenced/disk_util) + 0.10*(io_pressure_avg60)
```

- Novo ambiente → nó de menor `pressao`, desde que `< 0,75`.
- Nó com `pressao > 0,85` por 6 h → o painel sugere ao admin migrar os 3 ambientes de maior
  consumo (nunca migrar automaticamente; com 3 nós, um humano decide melhor que um heurístico).
- Regra de segurança: **nenhum nó pode passar de 85% de RAM alocada**, para que a queda de um nó
  seja absorvível pelos outros dois durante uma manutenção.

---

## 10. Provisionamento do nó

### Decisão: **Ansible** (modo push, sem agente), com cloud-init só para o primeiro boot.

Por que não bash idempotente: escrever idempotência à mão para 40 tarefas dá ~1500 linhas de
`if grep -q ... else` — que é reimplementar o Ansible com pior qualidade. Por que não só
cloud-init: ele roda **uma vez**; precisamos reaplicar config no dia 200. Por que não Terraform:
não estamos criando infra de nuvem; são servidores dedicados que já existem.

```
infra/
├── ansible.cfg
├── inventory/
│   ├── producao.yml            # n1, n2, n3 com vars por nó (IP, discos, papel)
│   └── group_vars/
│       ├── all/
│       │   ├── main.yml
│       │   └── vault.yml       # ansible-vault: senhas de DB, tokens
│       └── nodes/main.yml
├── site.yml                    # playbook mestre
├── playbooks/
│   ├── bootstrap.yml           # servidor cru -> nó gerenciável
│   ├── node.yml                # papel completo de nó VelozPanel
│   ├── upgrade-kernel.yml      # um nó por vez, com drain
│   └── evacuate.yml            # migra todos os ambientes de um nó (§9)
├── roles/
│   ├── base/                   # apt, timezone, locale, chrony, usuários, sudoers
│   ├── hardening/              # sshd, sysctl, apparmor, auditd, unattended-upgrades
│   ├── storage/                # zpool, datasets, tuning de ARC
│   ├── network/                # nftables, bridge vlz0, sysctl de rede
│   ├── incus/                  # repo Zabbly, incusd, pool, perfis, imagem dourada
│   ├── edge_nginx/             # nginx mainline, config global, cache, certs
│   ├── databases/              # mysql 8.4, postgresql 17, slices, contas de serviço
│   ├── mail_relay/             # msmtp/postfix de saída, DKIM
│   ├── observability/          # node_exporter, vector, promtail, alertas
│   └── veloz_agent/            # binário do agente, unit, mTLS, velozctl
├── files/
│   └── nftables.conf.j2
└── Makefile                    # make node1 / make check / make evacuate NODE=n2
```

```yaml
# playbooks/node.yml
- hosts: nodes
  become: true
  serial: 1                       # UM nó por vez. Sempre.
  any_errors_fatal: true
  pre_tasks:
    - name: nó está saudável antes de mexer
      command: /usr/local/sbin/velozctl health --strict
      changed_when: false
      failed_when: false
      register: h
    - assert: { that: "h.rc == 0 or veloz_force | default(false)" }
  roles: [base, hardening, storage, network, incus, edge_nginx, databases,
          mail_relay, observability, veloz_agent]
  post_tasks:
    - command: nginx -t
      changed_when: false
    - command: /usr/local/sbin/velozctl health --strict
      changed_when: false
```

```yaml
# roles/incus/tasks/main.yml (trecho representativo)
- name: chave do repositório Incus (Zabbly)
  ansible.builtin.get_url:
    url: https://pkgs.zabbly.com/key.asc
    dest: /etc/apt/keyrings/zabbly.asc
    mode: "0644"

- name: repositório Incus estável
  ansible.builtin.apt_repository:
    repo: "deb [signed-by=/etc/apt/keyrings/zabbly.asc] https://pkgs.zabbly.com/incus/stable {{ ansible_distribution_release }} main"
    filename: zabbly-incus-stable

- name: pacotes
  ansible.builtin.apt: { name: [incus, incus-client], update_cache: true }

- name: incus inicializado (idempotente via preseed)
  ansible.builtin.shell:
    cmd: incus admin init --preseed < /root/.incus-preseed.yaml
  args: { creates: /var/lib/incus/database/global }

- name: perfis de plano
  ansible.builtin.command: "incus profile show {{ item.name }}"
  register: p
  changed_when: false
  failed_when: false
  loop: "{{ veloz_planos }}"
# ... (cria/atualiza via 'incus profile edit' com template j2 — declarativo e idempotente)
```

**Primeiro boot (cloud-init ou instalação manual)**: só cria o usuário `deploy` com a chave do
admin, instala `python3` e `sudo`, e libera o SSH. Tudo o mais é `ansible-playbook site.yml`.

**Cadência:** `make check` (`--check --diff`) roda no CI a cada push; aplicação em produção é
manual e `serial: 1`. Nada de aplicação automática em 3 nós ao mesmo tempo.

---

## 11. Hardening

### 11.1 SSH (administração)

```
# /etc/ssh/sshd_config.d/99-veloz.conf   (porta 22, só admin)
Port 22
AddressFamily inet
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
PubkeyAcceptedAlgorithms ssh-ed25519,sk-ssh-ed25519@openssh.com,rsa-sha2-512
KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
AllowGroups veloz-admins
ClientAliveInterval 120
ClientAliveCountMax 2
LoginGraceTime 20
MaxAuthTries 3
X11Forwarding no
AllowAgentForwarding no
PermitTunnel no
```

Acesso a 22 só dos IPs de administração (nftables, §8.2). Chaves em hardware token (FIDO2,
`sk-ssh-ed25519`) para quem tem root — barato e elimina a classe inteira de chave privada roubada.

### 11.2 sysctl

```
# /etc/sysctl.d/99-veloz.conf
# --- rede / borda
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 10240 65000
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.ip_forward = 1                      # necessário para os containers

# --- densidade de containers
fs.file-max = 4194304
fs.inotify.max_user_instances = 8192         # sem isso, ~128 containers e o inotify acaba
fs.inotify.max_user_watches = 1048576
kernel.pid_max = 4194304
kernel.keys.maxkeys = 8000
kernel.keys.root_maxkeys = 8000
user.max_user_namespaces = 32768
user.max_net_namespaces = 32768
vm.max_map_count = 262144

# --- memória
vm.swappiness = 10
vm.overcommit_memory = 0
vm.min_free_kbytes = 262144
vm.panic_on_oom = 0

# --- kernel hardening
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
kernel.sysrq = 0
kernel.core_pattern = |/bin/false
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
fs.suid_dumpable = 0
```

> `fs.inotify.max_user_instances` é a pegadinha clássica: com o default de 128, o container de
> número ~120 falha ao subir com um erro obscuro do systemd. Isso vai acontecer e vai custar
> meia noite se não estiver aqui.

Tuning do ZFS ARC (senão o ARC come a RAM que era dos clientes):

```
# /etc/modprobe.d/zfs.conf   (nó de 64 GB)
options zfs zfs_arc_max=6442450944       # 6 GiB
options zfs zfs_arc_min=2147483648
```

### 11.3 AppArmor e confinamento

- O Incus já gera e aplica **um perfil AppArmor por container** automaticamente
  (`incus-env-0042_<...>`) — mantê-lo habilitado é a razão de estar em Debian/Ubuntu.
  Validar sempre: `aa-status | grep incus | wc -l` deve ser ≈ nº de containers.
- Perfis extras para os serviços do host: `usr.sbin.nginx`, `usr.sbin.mysqld` (vêm dos pacotes).
- Perfil próprio para o agente do painel (ver 11.5).
- `security.nesting=false` por default; só ligar (com aviso) se o cliente pedir Docker dentro do
  ambiente — e nesse caso ele vai para um nó separado, marcado como "confiança reduzida".
- `security.privileged=false` **sempre**. Não existe caso de uso de cliente que justifique.
- `security.syscalls.intercept.*` desligado por default.

### 11.4 Atualizações e auditoria

```
# /etc/apt/apt.conf.d/50unattended-upgrades
Unattended-Upgrade::Origins-Pattern {
  "origin=Debian,codename=${distro_codename},label=Debian-Security";
  "origin=Debian,codename=${distro_codename}-security";
  "site=packages.sury.org";
  "site=nginx.org";
};
Unattended-Upgrade::Package-Blacklist { "linux-image-*"; "zfs-*"; "incus*"; "nginx"; };
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Mail "ops@velozpanel.com.br";
```

Kernel, ZFS, Incus e nginx **nunca** sobem sozinhos: são exatamente os quatro componentes cuja
falha derruba o nó inteiro. Sobem por playbook, um nó por vez, com evacuação prévia dos ambientes
mais críticos (`playbooks/upgrade-kernel.yml`).

```
# /etc/audit/rules.d/veloz.rules
-D
-b 8192
-f 1
-w /etc/velozpanel/           -p wa -k veloz-config
-w /usr/local/sbin/velozctl   -p x  -k veloz-exec
-w /var/lib/incus/            -p wa -k incus-state
-w /etc/ssh/sshd_config       -p wa -k sshd-config
-w /etc/nftables.conf         -p wa -k firewall
-w /etc/sudoers.d/            -p wa -k sudoers
-a always,exit -F arch=b64 -S execve -F euid=0 -F auid>=1000 -F auid!=-1 -k root-cmd
-a always,exit -F arch=b64 -S mount,umount2 -F auid>=1000 -k mount
-e 2
```

`-e 2` trava as regras até o próximo boot (nem root altera). Logs de auditoria vão para fora do
nó (o módulo de observabilidade cuida) — auditoria que só existe na máquina invadida não serve.

### 11.5 Separação de privilégio do agente — **o agente NÃO roda como root**

Este é o ponto de hardening que mais importa, porque o agente é a superfície que fala com a
internet (recebe comandos do painel).

```
Painel (API central)
   │ mTLS + token de curta duração
   ▼
veloz-agent  (usuário: veloz, grupo: veloz + incus-admin)   <-- SEM root
   ├── incus (via /var/lib/incus/unix.socket, permitido pelo grupo incus-admin)
   ├── escrita em /etc/nginx/veloz/{sites,state}/  (dono: veloz)
   ├── sqlite em /var/lib/velozpanel/agent.db
   └── velozctl  (helper root, allowlist fechada, via sudoers)
```

```
# /etc/sudoers.d/veloz
Defaults:veloz !requiretty, log_output
veloz ALL=(root) NOPASSWD: /usr/local/sbin/velozctl
```

`velozctl` é um binário pequeno (Go, sem shell), com **subcomandos enumerados** e validação
estrita de argumentos — nunca recebe uma string que vira comando:

```
velozctl nginx-apply                       # roda o script da §6.3
velozctl cgroup-set <env-id> <chave> <valor>   # só memory.high|memory.max|io.max|io.weight
velozctl cert-deploy <fqdn>                # instala cert já emitido em /etc/velozpanel/certs
velozctl db-provision <env-id> mysql|pg
velozctl state set <env-id> running|paused|suspended
velozctl health [--strict]
```

Regras do helper: `<env-id>` casa com `^[0-9]{1,6}$`; `<fqdn>` com regex de hostname; qualquer
coisa fora disso é rejeitada e logada. **Nunca** `sh -c`, nunca interpolação de string em comando.

Unit do agente com confinamento pesado:

```ini
# /etc/systemd/system/veloz-agent.service
[Service]
Type=notify
User=veloz
Group=veloz
SupplementaryGroups=incus-admin
ExecStart=/usr/local/bin/veloz-agent --config /etc/velozpanel/agent.toml
Restart=always
RestartSec=3
WatchdogSec=30

NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
ProcSubset=pid
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
CapabilityBoundingSet=
AmbientCapabilities=
ReadWritePaths=/etc/nginx/veloz /var/lib/velozpanel /run/velozpanel /srv/velozpanel
IPAddressAllow=127.0.0.1/8 10.60.0.0/16 <ip-do-painel>/32
IPAddressDeny=any

MemoryMax=512M
TasksMax=256
```

Além disso: o agente **hospedeiro** nunca executa código enviado pelo cliente. Deploy, `composer
install`, `npm ci` e afins rodam **dentro do container**, pelo `veloz-guest-agent` (usuário `app`,
sem privilégio), acionado via `incus exec`. Essa fronteira é inegociável.

### 11.6 Higiene adicional

- `/tmp` e `/var/tmp` do host como `tmpfs` com `noexec,nosuid,nodev`.
- `/boot` com `nodev,nosuid,noexec`.
- Módulos de kernel desnecessários em blocklist: `dccp sctp rds tipc firewire-core cramfs
  freevxfs jffs2 hfs hfsplus udf usb-storage`.
- Bloqueio de core dump (`kernel.core_pattern = |/bin/false`) — evita vazar segredo em disco.
- Rotação e envio dos logs para fora do nó (Loki/Vector) — módulo de observabilidade.
- Backup **fora do nó** (S3-compatível brasileiro ou um 4º servidor barato). Snapshot ZFS no mesmo
  disco **não é backup**. Repetir isso na documentação até doer.

---

## 12. Riscos e custo de manutenção

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | ZFS DKMS quebra em upgrade de kernel; pool não monta; **nó inteiro fora** | média | crítico | kernel pinado, upgrade manual 1 nó por vez, teste em nó de staging, plano B btrfs documentado |
| R2 | I/O de ZFS não respeita `io.max` do cgroup ⇒ um cliente sequestra o NVMe | média | alto | monitorar `io.pressure` por ambiente, alerta em avg60 > 30%, `ionice` no que for nosso, killer manual, avaliar pool LVM-thin para nós futuros |
| R3 | Sobrevenda de RAM: OOM em cascata numa madrugada de pico | média | alto | teto de 85% de RAM alocada por nó, `memory.high` em 80%, alerta por PSI, capacidade de migrar ambiente em minutos |
| R4 | PHP 7.4/8.0 sem patch de segurança rodando em produção | alta | médio | tier "legado" explícito na UI, isolamento por container contém o dano, campanha de migração, preço maior para legado |
| R5 | Incus tem base de usuários menor que Docker; bug sem workaround | baixa | alto | manter versão LTS (6.0.x), não `latest`; abstrair "ambiente" no agente para viabilizar plano B Podman |
| R6 | Reload de nginx com 300+ vhosts fica lento e vira gargalo | média | médio | debounce de 2 s, `nginx -t` em staging, medir tempo de reload, split de config, e (se passar de ~3 s) migrar para geração incremental com `njs`/API |
| R7 | Cliente comprometido usado para spam/phishing ⇒ IP do nó em blocklist | alta | alto | egress SMTP bloqueado, relay com quota e DKIM, CrowdSec, IP dedicado para o relay separado do IP web |
| R8 | Perda de um nó inteiro (disco, datacenter) | baixa | crítico | backup off-node diário testado, `zfs send` para um 4º host, procedimento de restore ensaiado trimestralmente |
| R9 | Agente comprometido ⇒ acesso a todos os ambientes do nó | baixa | crítico | agente sem root, `velozctl` com allowlist, mTLS, auditd, IPAddressAllow |

**Custo de manutenção estimado (steady state, 3 nós, ~300 ambientes):** 4–8 h/mês de operação
rotineira (patches, alertas, capacidade) + 1 dia/trimestre para upgrade de kernel/ZFS com
evacuação. Isso é sustentável por uma pessoa. O que **não** é sustentável e por isso foi
rejeitado: manter políticas SELinux próprias, manter um fork de nginx compilado, ou operar
Kubernetes.

---

## 13. Perguntas em aberto para o ciclo 2

1. **IPv6** — oferecer /64 por ambiente ou só IPv4 com NAT? (impacta nftables e o módulo de DNS)
2. **IP dedicado** por cliente é produto? Se sim, muda o desenho da borda.
3. **Backup**: retenção comercial (7/30/90 dias) e destino (S3 BR? 4º servidor?) — define custo/GB.
4. Emissão de TLS: **DNS-01 wildcard** exige que sejamos autoritativos do domínio; **HTTP-01**
   funciona para domínio apontado. Precisa alinhar com o especialista de DNS.
5. **Bancos**: aceitar o compartilhado por nó como default (minha recomendação) ou exigir
   dedicado desde o dia 1? Impacta densidade em ~25%.
6. Métricas: quem armazena (VictoriaMetrics single-node? Prometheus?) e por quanto tempo —
   define o desenho dos gráficos do requisito 8.
7. Benchmark obrigatório no ciclo 2: **medir de fato** boot time, RSS por ambiente e tempo de
   reload do nginx com 200 vhosts sintéticos. Os números da §2.3 são estimativas fundamentadas,
   não medições.
