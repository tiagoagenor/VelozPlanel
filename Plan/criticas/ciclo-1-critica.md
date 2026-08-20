# Crítica do Ciclo 1 — Red Team Técnico

> Autor: Crítico / Red Team Técnico
> Documentos atacados: `00-BRIEFING.md` (**incluindo o ADENDO 1**), `02-pesquisa-mercado.md`,
> `03-arquitetura.md`, `04-infra-linux.md` (com leitura de apoio de `01-produto-ux.md`)
> Data: 20/08/2026

## Aviso de leitura obrigatório

Esta crítica foi reescrita depois do **ADENDO 1** do briefing. O adendo **invalida premissas centrais**
dos três documentos do Ciclo 1:

| Premissa dos docs 02/03/04 | Realidade (ADENDO 1) | Efeito |
|---|---|---|
| 2–3 **servidores dedicados** de 32–64 GB | **VPS de 16 GB**, uma por provedor diferente | Densidade dos docs 03/04 superdimensionada em **4× a 6×** |
| Rede privada entre nós implícita | **Internet pública** entre control plane e agentes | Muda transporte, migração, borda e banco |
| Carga alvo: 80–300 ambientes | **4 a 5 sistemas** na fase de validação | Toda otimização de densidade é prematura |
| Dev humano (Go ou PHP) | **A IA constrói; Tiago opera.** Front **obrigatoriamente Next.js**; Tiago sabe **Node e .NET**, **não sabe Go** | Conflito 3 refeito do zero; "contratar dev" sai como critério |
| NFS-e no caminho crítico | **Fora do escopo** | Sai da margem e do MVP |
| Pagamento = componente do core | **Pagamento DEVE ser módulo plugável** | Testa se a modularidade do doc 03 é real ou de fachada |

Onde os documentos do Ciclo 1 contradizem o adendo, **os documentos estão errados**. Esta crítica arbitra
com o adendo como fonte de verdade.

Contagem: **7 bloqueadores**, 12 altos, 9 médios, 4 baixos.

---

## 0. Os três achados que reordenam todo o Ciclo 1

### Achado 0.1 — Ninguém verificou se as VPS suportam a arquitetura proposta. Se forem container-based, os três documentos são inúteis

**Severidade: Bloqueador — é o achado nº 1 de todo o Ciclo 1**

**Evidência.** `04-infra-linux.md` §1 instala `zfs-dkms` (módulo de kernel), §2.2 decide por Incus/LXC
não-privilegiado (namespaces aninhados), §8.1 monta bridge Incus e §8.2 escreve regras nftables. `03`
§1.1 lista `incusd` como componente obrigatório do nó. **Nenhum dos dois documentos verifica se o nó
permite qualquer uma dessas coisas.** O ADENDO 1 §B.4 levanta o risco; os documentos do Ciclo 1 foram
escritos sem ele.

**Por que é um problema.** VPS baratas no Brasil e no exterior frequentemente são **OpenVZ 7 / Virtuozzo
/ LXC** vendidas como "VPS". Nelas:

| Recurso | KVM (virtualização real) | OpenVZ/Virtuozzo/LXC (container) |
|---|---|---|
| Carregar módulo de kernel (`zfs.ko`) | sim | **não** — kernel é do hospedeiro, compartilhado |
| Docker com overlay2 | sim | frequentemente **não** (cai para `vfs`, que copia a imagem inteira por container) |
| Incus/LXC aninhado | sim | **não** ou só com `nesting` liberado pelo provedor |
| User namespaces (isolamento não-privilegiado) | sim | **frequentemente desabilitado** |
| cgroup v2 delegado com escrita em `memory.max`/`cpu.max` | sim | **não** — você vê os cgroups do hospedeiro, não pode escrever |
| `/dev/kvm` | sim | não |
| nftables / criar bridge | sim | **limitado ou proibido** |
| Swap próprio | sim | frequentemente inexistente |

Se **qualquer** das duas VPS existentes for container-based, então: sem ZFS (bloco 3 do doc 04), sem
Incus (bloco 2), sem hot-resize por escrita em cgroup (requisito 9 do briefing), sem isolamento real por
namespace (a base de segurança inteira). **A arquitetura não degrada — ela deixa de existir.**

E o risco não é hipotético: as duas VPS **já estão contratadas** (ADENDO 1 §B), possivelmente em
provedores escolhidos por preço.

**Veredito/Correção.** Rodar o diagnóstico abaixo **hoje**, nas duas VPS existentes, e usar o resultado
como pré-requisito de contratação da VPS 3. Nenhuma decisão do Ciclo 2 pode ser tomada antes.

#### Esqueleto do `veloz-node-doctor.sh`

Este script é entregável do Ciclo 2 (dono: Linux/SRE #4), mas o esqueleto abaixo já é executável e
responde à pergunta bloqueadora. Ele deve **sair com código ≠ 0** se qualquer item `CRÍTICO` falhar.

```bash
#!/usr/bin/env bash
# veloz-node-doctor.sh — diagnóstico de aptidão de um nó para o VelozPanel.
# Uso: sudo bash veloz-node-doctor.sh [--json]
# Saída: relatório legível + JSON; exit 0 = apto, 1 = inapto, 2 = apto com ressalvas.
set -uo pipefail

FATAL=0; WARN=0
ok(){   printf '  \033[32m[OK]\033[0m      %-34s %s\n' "$1" "${2:-}"; }
crit(){ printf '  \033[31m[CRÍTICO]\033[0m %-34s %s\n' "$1" "${2:-}"; FATAL=$((FATAL+1)); }
warn(){ printf '  \033[33m[ATENÇÃO]\033[0m %-34s %s\n' "$1" "${2:-}"; WARN=$((WARN+1)); }
info(){ printf '  [info]    %-34s %s\n' "$1" "${2:-}"; }

echo "== 1. Tipo de virtualização (BLOQUEADOR) =="
VIRT=$(systemd-detect-virt 2>/dev/null || echo desconhecido)
case "$VIRT" in
  kvm|qemu|amazon|microsoft|xen|none)
      ok "systemd-detect-virt" "$VIRT — virtualização real ou bare metal" ;;
  openvz|lxc|lxc-libvirt|docker|podman|wsl)
      crit "systemd-detect-virt" "$VIRT — VPS BASEADA EM CONTAINER. Incapaz de rodar a arquitetura." ;;
  *)  warn "systemd-detect-virt" "$VIRT — investigar manualmente" ;;
esac
grep -qi hypervisor /proc/cpuinfo && info "flag hypervisor" "presente" || info "flag hypervisor" "ausente (bare metal?)"
[ -d /proc/vz ] && crit "/proc/vz" "presente — OpenVZ/Virtuozzo confirmado"
[ -e /proc/user_beancounters ] && crit "user_beancounters" "presente — OpenVZ confirmado"

echo "== 2. Kernel e módulos (BLOQUEADOR p/ storage) =="
info "kernel" "$(uname -r)"
KMAJ=$(uname -r | cut -d. -f1); KMIN=$(uname -r | cut -d. -f2)
if [ "$KMAJ" -gt 5 ] || { [ "$KMAJ" -eq 5 ] && [ "$KMIN" -ge 10 ]; }; then
  ok "versão do kernel" ">= 5.10"; else crit "versão do kernel" "< 5.10 — cgroup v2 e idmap incompletos"; fi
[ -w /sys/module ] && ok "sysfs de módulos" "gravável" || warn "sysfs de módulos" "somente leitura"
if modprobe -n overlay 2>/dev/null;  then ok "modprobe overlay"  "permitido"; else crit "modprobe overlay" "negado"; fi
if modprobe -n br_netfilter 2>/dev/null; then ok "modprobe br_netfilter" "permitido"; else warn "modprobe br_netfilter" "negado — rede de container limitada"; fi
if modprobe -n zfs 2>/dev/null; then ok "modprobe zfs" "possível"; else info "modprobe zfs" "indisponível (esperado sem DKMS)"; fi
[ -f /proc/config.gz ] && info "config do kernel" "exposto" || info "config do kernel" "não exposto"

echo "== 3. cgroup v2 e limites a quente (BLOQUEADOR p/ requisito 9) =="
if [ "$(stat -fc %T /sys/fs/cgroup 2>/dev/null)" = "cgroup2fs" ]; then
  ok "cgroup" "v2 unificado"
else crit "cgroup" "não é v2 unificado — hot-resize e métricas por ambiente inviáveis"; fi
CTRL=$(cat /sys/fs/cgroup/cgroup.controllers 2>/dev/null || echo "")
for c in cpu memory io pids; do
  grep -qw "$c" <<<"$CTRL" && ok "controller $c" "disponível" || crit "controller $c" "AUSENTE"
done
# teste real de escrita: cria cgroup, escreve memory.max, apaga
T=/sys/fs/cgroup/veloz-doctor-$$
if mkdir "$T" 2>/dev/null; then
  if echo 268435456 > "$T/memory.max" 2>/dev/null; then ok "escrita em memory.max" "funciona (hot-resize de RAM viável)"
  else crit "escrita em memory.max" "NEGADA — requisito 9 do briefing inviável"; fi
  if echo "200000 100000" > "$T/cpu.max" 2>/dev/null; then ok "escrita em cpu.max" "funciona (hot-resize de vCPU viável)"
  else crit "escrita em cpu.max" "NEGADA"; fi
  rmdir "$T" 2>/dev/null
else crit "criar cgroup filho" "NEGADO — cgroups não delegados a este nó"; fi
[ -r /sys/fs/cgroup/cpu.pressure ] && ok "PSI" "disponível" || warn "PSI" "ausente — sem cpu/memory/io.pressure"

echo "== 4. Namespaces e isolamento (BLOQUEADOR de segurança) =="
US=$(sysctl -n user.max_user_namespaces 2>/dev/null || echo 0)
[ "${US:-0}" -gt 0 ] && ok "user namespaces" "max=$US" || crit "user namespaces" "desabilitados — sem isolamento não-privilegiado"
unshare --user --map-root-user true 2>/dev/null && ok "unshare userns" "funciona" || crit "unshare userns" "negado"
unshare --net true 2>/dev/null && ok "unshare netns" "funciona" || crit "unshare netns" "negado"
grep -q seccomp /proc/self/status && ok "seccomp" "presente" || warn "seccomp" "ausente"
command -v aa-status >/dev/null && info "AppArmor" "$(aa-status --enabled && echo ativo || echo inativo)"
[ -d /sys/fs/selinux ] && info "SELinux" "presente"

echo "== 5. Rede (necessário p/ borda e containers) =="
ip link add veloz-doctor0 type bridge 2>/dev/null \
  && { ok "criar bridge" "permitido"; ip link del veloz-doctor0; } \
  || crit "criar bridge" "NEGADO — rede de container inviável"
command -v nft >/dev/null && nft list ruleset >/dev/null 2>&1 \
  && ok "nftables" "legível" || warn "nftables" "indisponível ou sem permissão"
sysctl -n net.ipv4.ip_forward >/dev/null 2>&1 && ok "ip_forward" "controlável" || crit "ip_forward" "não controlável"
info "IPv6" "$([ -f /proc/net/if_inet6 ] && echo presente || echo ausente)"
info "IP público" "$(ip -4 -o addr show scope global | awk '{print $4}' | paste -sd, -)"

echo "== 6. Storage e quota (define a escolha de filesystem) =="
info "raiz" "$(findmnt -no FSTYPE,OPTIONS / )"
for fs in / /var/lib; do
  T=$(findmnt -no FSTYPE "$fs" 2>/dev/null)
  case "$T" in
    xfs)  findmnt -no OPTIONS "$fs" | grep -q prjquota \
            && ok "quota em $fs" "XFS com prjquota (ideal)" \
            || warn "quota em $fs" "XFS sem prjquota — remontar com prjquota" ;;
    ext4) warn "quota em $fs" "ext4 — usar project quota (tune2fs -O project,quota) ou quota por diretório" ;;
    btrfs) ok "quota em $fs" "btrfs — qgroups e snapshot disponíveis, sem módulo externo" ;;
    overlay|vfs) crit "filesystem de $fs" "$T — nó já é container" ;;
    *) info "filesystem de $fs" "$T" ;;
  esac
done
info "d_type" "$(xfs_info / 2>/dev/null | grep -o 'ftype=[01]' || echo n/a)"
info "espaço" "$(df -h --output=size,avail / | tail -1)"

echo "== 7. Recursos e swap =="
info "vCPU" "$(nproc)"
info "RAM"  "$(free -g | awk '/Mem:/{print $2\" GB\"}')"
SW=$(free -m | awk '/Swap:/{print $2}')
[ "${SW:-0}" -gt 0 ] && ok "swap" "${SW} MB" || warn "swap" "AUSENTE — OOM será abrupto; considerar zram"
info "carga atual" "$(uptime | sed 's/.*load average/load/')"

echo "== 8. Runtime de container (o que já dá para usar) =="
command -v docker >/dev/null && info "docker" "$(docker --version 2>/dev/null)"
docker info --format '{{.Driver}}' 2>/dev/null | grep -qx overlay2 \
  && ok "storage driver" "overlay2" \
  || warn "storage driver" "$(docker info --format '{{.Driver}}' 2>/dev/null || echo ausente) — vfs custa disco por container"
command -v incus  >/dev/null && info "incus"  "$(incus  version 2>/dev/null | head -1)"
command -v podman >/dev/null && info "podman" "$(podman --version 2>/dev/null)"

echo
echo "== RESULTADO: $FATAL crítico(s), $WARN atenção(ões) =="
[ "$FATAL" -gt 0 ] && { echo "NÓ INAPTO para a arquitetura proposta."; exit 1; }
[ "$WARN"  -gt 0 ] && { echo "APTO COM RESSALVAS."; exit 2; }
echo "APTO."; exit 0
```

**Critério de aceitação do nó:** zero `CRÍTICO`. Um único crítico em qualquer das VPS existentes reabre a
decisão de infraestrutura antes de qualquer código. Este script também vira **pré-requisito do
`node.enroll`** (o `03` §1.3 define o bootstrap do agente e não valida nada do nó — corrigir).

---

### Achado 0.2 — A densidade dos docs 03 e 04 está superdimensionada em 4× a 6×, e nenhum número do plano sobrevive

**Severidade: Bloqueador**

**Evidência.** `04-infra-linux.md` §2.3: *"**Alvo prático: 64 GB ⇒ 80–130 ambientes ativos** + 50–80
pausados. 32 GB ⇒ 35–60 ativos"* — a tabela nem contempla 16 GB. `03` §10, incerteza 3, pede o número ao
infra e nunca o recebe medido. `02` §3.1 fala em *"128 GB, 100–200 containers"*.

**Recálculo para a realidade (VPS de 16 GB, sem ZFS — ver Achado 1.6):**

| Item | RAM |
|---|---|
| Kernel + systemd + sshd + journald | ~500 MB |
| Agente do painel + coletor de métricas | ~150 MB |
| Proxy de borda (nginx/Caddy) | ~50 MB |
| **MariaDB 11 compartilhado** (buffer pool 256 MB) | ~450 MB |
| **PostgreSQL 17 compartilhado** (shared_buffers 256 MB) | ~350 MB |
| Margem de segurança do host (page cache, picos) | ~1.000 MB |
| **Reserva total do host** | **~2,5 GB** |
| **Disponível para ambientes** | **~13,5 GB** |

Aplicando o teto de 85% de alocação do próprio `04` R3: 11,5 GB de `MemoryMax` somado.

> **VPS de 16 GB ⇒ 18 a 25 ambientes de 512 MB.** Não 80–130.
> Duas VPS ⇒ **36 a 50**. Três ⇒ **54 a 75** (se a VPS 3 for equivalente).

Se o cliente comprar plano de 1 GB (necessário para WooCommerce — ver Achado 5.2): **9 a 12 por nó**.

**Por que é um problema.** Densidade é o denominador de toda a economia (Achado 5.1) e de todas as
decisões de isolamento. Um erro de 5× significa que:
- Cada MB de RAM do host importa 4× mais → **um `mysqld` a mais, um `incusd` a mais, um ARC de ZFS a mais
  custam ambientes reais**, não pontos percentuais.
- Overcommit agressivo (`04` §2.3, 1,5×) é muito mais perigoso: em 64 GB, um erro de 10% são 6 GB de
  folga; em 16 GB, são 1,6 GB e o OOM killer entra.
- O **disco** vira restrição junto com a RAM: 200 GB NVMe na VPS1, com quota de 15 GB por ambiente,
  suporta 22 ambientes usando ~3 GB reais cada (66 GB) — folgado — mas **não** suporta 22 × 15 GB
  provisionados se algum cliente encher a cota. Precisa de política de overcommit de disco explícita, que
  nenhum documento tem.

**Veredito/Correção.** Toda tabela de densidade dos docs 03 e 04 deve ser reescrita para 16 GB, e todo
componente residente no host precisa justificar seu consumo em **ambientes perdidos**, não em MB. Regra
proposta para o Ciclo 2: *"cada 512 MB de RAM residente no host custa 1 ambiente vendável; qualquer
componente novo no nó precisa dizer quantos ambientes custa"*.

---

### Achado 0.3 — Os documentos foram escritos para um humano e serão executados por uma IA; isso inverte o risco de escopo

**Severidade: Bloqueador**

**Evidência.** ADENDO 1 §A: *"Quem vai construir o sistema é a IA (Claude), sob gestão do Tiago... O plano
precisa ser **executável por um agente de IA**: especificação precisa, contratos explícitos, critérios de
aceite testáveis, ordem de construção sem ambiguidade."*

Contra: `03-arquitetura.md` contém **2.054 linhas**, ~25 tabelas de DDL, um manifesto de módulo de 200
linhas, uma máquina de estados de 14 estados, 13 tipos de job, 6 mecanismos de autenticação e 12 riscos —
tudo escrito em nível de detalhe **construível**. `04` contém dezenas de blocos de shell e config prontos
para colar.

**Por que é um problema — e por que é o oposto do risco tradicional.** Com um desenvolvedor humano, um
plano superdimensionado é filtrado pelo cansaço: ele corta o que não cabe. **Com uma IA, o plano É o
escopo.** Se está escrito, será construído. O `03` §2 (sistema de módulos dinâmico com manifesto,
assinatura cosign, sidecar, gateway, ESM remoto, SRI, circuit breaker, bulkhead) será implementado
integralmente porque está especificado integralmente — e ele é, pelo próprio autor (`03` R2), risco
**Alta × Alto** de engolir o cronograma.

Segundo efeito, mais insidioso: **a IA produz código plausível onde o documento é vago, e o resultado
parece pronto.** As áreas de risco alto de "plausível mas errado" neste projeto:

| Área | Por que a IA erra | O que a especificação precisa ter |
|---|---|---|
| Manipulação de cgroup v2 | caminhos e semânticas mudam por versão de kernel/runtime; muito conteúdo de treino é cgroup v1 | comandos exatos + **teste que lê `memory.max` de volta e confere** |
| Runtime de container (edge cases) | a API funciona no caminho feliz; falha em disco cheio, imagem faltando, container zumbi | matriz de erro por operação, com o estado esperado do ambiente após cada falha |
| Aritmética de dinheiro | ponto flutuante, arredondamento de rateio horário, ordem de operações | **tudo em `bigint` de centavos** (o `03` §4.2 já faz isso — manter e tornar regra explícita) + casos de teste numéricos com o resultado esperado escrito |
| Idempotência sob concorrência | o código "parece" idempotente e não é sob corrida real | teste de concorrência declarado: N cliques simultâneos em "pausar" ⇒ 1 job |
| Rate limit do ACME | o caminho feliz emite certificado; o limite só aparece em produção com 50 domínios | fila serializada obrigatória + teste com CA de staging da Let's Encrypt |
| Qualquer coisa que exija "tentar na VPS real" | a IA não tem o nó | **etapas com verificação no nó real, não só teste unitário** |
| Segurança de multi-tenant (RLS, escopo de token) | falta um `WHERE tenant_id` e nada quebra visivelmente | teste negativo obrigatório: cliente A tentando ler recurso de B ⇒ 404, em todo endpoint |

**Veredito/Correção.** Três exigências novas para o Ciclo 2, todas ausentes hoje:

1. **Todo entregável tem critério de aceite executável.** Não *"implementar pause/start"*, e sim
   *"`POST /environments/{id}/actions/pause` devolve 202; em ≤ 5 s `GET` mostra `state=paused`;
   `docker inspect` no nó mostra o container parado; `usage_events` fecha a janela `env.active.hour` e
   abre `env.paused.hour`; repetir a chamada devolve 200 sem criar job novo"*.
2. **Ordem de construção sem ambiguidade**, com dependências declaradas — `03` §11 tem 6 etapas em prosa,
   insuficiente. Ver §9 desta crítica.
3. **Cortar do plano tudo que não entra no MVP**, porque o que sobrar no papel será construído. O corte
   deixa de ser uma sugestão de gestão e vira **requisito de especificação**.

---

## 1. CONFLITO 1 — Runtime de isolamento do ambiente

### O conflito

| Doc | Recomendação | Argumento |
|---|---|---|
| `02` §3.3, §15 | **Docker/Podman rootless** | versão = tag de imagem; `docker stop` = evento de faturamento; `docker update` = hot-resize |
| `03` D5, §3 | **Incus + ZFS** | container de sistema dá SSH/cron/systemd; `incus pause` ~1 s; snapshot ZFS |
| `04` §2.2 | **Incus não-privilegiado, rootfs em clone ZFS** | *"o modelo mental [do Docker] é imutável e efêmero, e hospedagem compartilhada é mutável e persistente"* |

### Achado 1.1 — O argumento "hospedagem é mutável" cai contra a terceira via que ninguém avaliou

**Severidade: Alto**

**Evidência.** `04` §2.1(c): *"O cliente vai dar `apt install` porque um plugin pediu; vai gravar uploads;
vai querer cron; vai querer shell. Cada uma dessas coisas vira um volume, um sidecar ou um workaround."*

Confronto com **OCI + volume persistente** (`/srv/app`, `/home/<env>`, dados) — não avaliada em nenhum doc:

| Necessidade "mutável" | O argumento sobrevive? | Como a terceira via resolve |
|---|---|---|
| Uploads / arquivos do site | **não** | volume persistente — é o caso de uso do volume |
| Cron do cliente | **não** | cron no host disparando `docker exec`, ou `supercronic` lendo crontab do volume. `01` §1.23 mostra que o cron do Hostoo é **UI**, não crontab editado à mão |
| Shell / SSH | **não** | `docker exec` + o mesmo `sshd` de salto do `04` §8.5, trocando `incus exec` por `docker exec` (uma linha) |
| Processo Node persistente | **parcial** | init leve (tini/s6/supervisord) ou 1 container por processo |
| `apt install` de extensão PHP | **sim** | perda real |
| `apt install` de pacote arbitrário | **sim** | perda real |

Dos seis pontos, quatro caem com um volume e um com um init de 200 KB. Sobra um — e o produto copiado
**também não o oferece**: `01` §1.20 mostra que extensões PHP no Hostoo são **toggle no painel**, e §3.7
lista "diretivas php.ini via slider". O argumento foi construído contra um cliente de VPS, não contra o
cliente do produto desenhado.

---

### Achado 1.2 — Imagem dourada + clone produz drift de configuração por construção

**Severidade: Alto**

**Evidência.** `04` §5.1: imagem base *"construída **semanalmente** por pipeline"*, `veloz-base-<data>`,
instanciada por `zfs clone`.

**Por que é um problema.** O clone é uma cópia pontual; a partir dele o ambiente é **independente**.
Em 12 meses de builds semanais existem ~50 imagens douradas e ambientes clonados de todas elas:

1. **Não existe "o estado do nó" — existem N estados.** É exatamente a doença que o `04` §2.1(a) usa para
   condenar o modelo cPanel (*"baixa no dia 1, **alta no ano 2**"*).
2. **Lançar PHP 8.5 não alcança os ambientes existentes.** O `03` §2.6 promete *"sobe `mod-python@1.1.0`
   com a versão nova no manifesto"* — no modelo do `04` isso só vale para ambientes **novos**. Para os
   existentes é `apt install` remoto em N containers com N estados diferentes.
3. Patch de segurança de PHP/nginx = `apt upgrade` em N containers divergentes. Com imagem OCI: `pull` +
   recriar, e o estado é conhecido **porque é imutável**.

Nenhum job de "atualizar a base instalada" existe no catálogo do `03` §5.6 — e é a operação mais
frequente da vida real de um painel.

**Veredito.** A imutabilidade do OCI não é obstáculo para hospedagem — é a **resposta** ao problema que o
modelo de imagem dourada cria. Este achado inverte o sinal do argumento do doc 04.

---

### Achado 1.3 — Placar dos critérios: três dos supostos diferenciais do Incus são empates

**Severidade: Alto** (empates foram vendidos como diferenciais)

| # | Critério | Incus/LXC | OCI + volume | Vence |
|---|---|---|---|---|
| 1 | Pause/start < 5 s | `incus stop`/`start`: 0,6–2,0 s até systemd (`04` §4.3) | `docker start`: 0,3–1 s + init leve | **empate** |
| 2 | Hot-resize RAM **e** vCPU sem reiniciar | `incus config set limits.*` → grava `memory.max`/`cpu.max` | `docker update --memory --cpus` → grava **o mesmo** `memory.max`/`cpu.max` | **empate** (ambos dependem do Achado 0.1) |
| 3 | Versão diferente por cliente | sim, dentro do container | sim, tag de imagem | **empate** |
| 3b | *Oferecer versão nova à base instalada* | `apt` em N containers, N estados | `pull` + recriar, 1 estado | **OCI, com folga** |
| 4 | Shell/SSH + persistir mudanças | nativo | shell sim; dados sim; **`apt install` não persiste** | **Incus** (única vitória clara) |
| 5 | Migração entre nós | `copy --refresh` + `zfs send -i` | `zfs send`/`restic` do volume + `pull` da imagem | **Incus** — mas ver 1.4 e o ADENDO (sem ZFS e sem rede privada, some) |
| 6 | Backup/restore por ambiente | snapshot do rootfs inteiro (~2,8 GB de SO junto) | restic no volume — **só o dado do cliente** | **OCI** |
| 7 | Ecossistema / achar resposta | pequeno, e o acervo é de LXD pré-fork (nomes e caminhos mudaram) | dominante | **OCI, com folga brutal** |
| 8 | Risco de abandono do projeto | **baixo** — ver 1.5 | nulo | empate |
| 9 | Storage em VPS de 16 GB | ZFS **inviável** (Achado 1.6); com backend `dir`, cada ambiente custa 2,8 GB de disco **sem dedup** | overlay2 dedupa a imagem base nativamente, sem módulo de kernel | **OCI, decisivo** |
| 10 | Compatibilidade com VPS container-based | **impossível** (Achado 0.1) | também difícil, mas Docker às vezes funciona com `vfs` | **OCI**, marginalmente |
| 11 | Painéis comerciais que usam | ~0 painéis de *hospedagem*; LXC domina painéis de **VPS** (Proxmox, Virtualizor, SolusVM) | Enhance, Cloudron, Coolify, Dokploy, CapRover, Dokku | **OCI** |
| 12 | Tiago consegue depurar às 3h | nunca operou | **usa Docker hoje** (`docker-migracao/`, `docker-compose.yml` no projeto dele) | **OCI** |

Os critérios 1, 2 e 3 — que o `03` §3 usa como justificativa central para Incus (*"`incus config set` a
quente atende o requisito 9; `incus pause` congela em ~1 s e atende o requisito 4"*) — **não
discriminam**: Docker faz o mesmo, no mesmo cgroup v2, com a mesma primitiva de kernel. A decisão foi
justificada com empates.

---

### Achado 1.4 — A migração "em segundos" já não sobrevivia ao próprio doc 04; com o ADENDO, ela morre

**Severidade: Médio** (porque migração sai do MVP)

**Evidência.** `04` §9.2, título: *"Procedimento (**downtime medido em segundos**)"*. Passo 5 do mesmo
procedimento: *"migra o banco (**dump+restore**, ou replicação prévia com corte no binlog)"*. O banco é
compartilhado por nó (§8.4), logo não viaja no `zfs send`.

Com o ADENDO piora: `04` §9.3 assume que *"a borda A passa a proxiar para B"* durante o corte — agora
isso é **tráfego entre dois provedores diferentes, pela internet pública**, com latência, custo de banda
e um ponto de falha novo. E o `zfs send` inicial de 10 GB entre provedores, num link de VPS comum, leva
de 10 a 40 minutos.

**Veredito/Correção.** Reescrever o título para *"segundos para o app, minutos para o banco"* — e, dado o
ADENDO §D, **tirar migração ao vivo do MVP**. Com 4–5 sistemas, migração é: pausar, backup, restaurar no
outro nó, trocar DNS. Um runbook de 10 linhas, não um job de 4 horas.

---

### Achado 1.5 — O risco de abandono do Incus foi superestimado; o risco correto é outro

**Severidade: Baixo** (corrige uma premissa)

**Evidência.** `03` §10, incerteza 2, e `04` R5 tratam "Incus tem base menor / bug sem workaround" como o
risco. Fatos (ago/2026): Incus 6.0 LTS suportado até **junho de 2029**; **7.0 LTS lançado em 01/05/2026**;
7.3 publicado; +3.500 commits de +120 contribuidores; mantido pelos autores originais do LXD sob o Linux
Containers, empacotado no Debian e pelo Zabbly. Fontes:
[linuxcontainers.org/incus/news](https://linuxcontainers.org/incus/news/),
[Incus 7.0 LTS](https://discuss.linuxcontainers.org/t/incus-7-0-lts-has-been-released/26641),
[stgraber.org — 6.0.6 LTS](https://stgraber.org/2026/03/16/lxc-lxcfs-incus-6-0-6-lts-release/).

**Veredito.** O projeto é saudável; abandono não é o risco. O risco real é **acervo de conhecimento
contaminado**: quase todo conteúdo indexado é de LXD pré-fork, com comandos, caminhos de cgroup
(`lxc.payload.` → `incus.payload.`, o próprio `04` §3.1 alerta) e semânticas mudadas. Para um projeto que
será **construído por uma IA treinada nesse acervo** (ADENDO §A), isso é pior do que parece: a IA vai
gerar comandos LXD que não existem mais no Incus, e vai fazê-lo com confiança. Substituir o risco na
tabela do `04` R5.

---

### Achado 1.6 — ZFS está fora: em VPS de 16 GB o ARC come ambientes, e o DKMS é bloqueador que contradiz outra mitigação

**Severidade: Bloqueador**

**Evidência.**
- `04` §1: *"`zfs-dkms` vem de `contrib`. **Risco conhecido:** um upgrade de kernel pode quebrar o build do
  DKMS e o pool não monta no boot. Mitigação obrigatória: **kernel pinado** (`apt-mark hold`)"*.
- `04` §11.4 configura `unattended-upgrades`; `03` R5 tem como mitigação de fuga de container
  *"**kernel atualizado** com janela de manutenção mensal"*.
- `04` §2.3 orça *"ARC 6"* GB num nó de 64 GB — metade da reserva do host.
- ADENDO §B.3: *"**ZFS em VPS de 16 GB é suspeito** (ARC consome RAM)"*.

**Três problemas somados:**

1. **Contradição interna.** Não dá para simultaneamente pinar o kernel (para o ZFS não quebrar) e mantê-lo
   atualizado (para conter fuga de container). Com container não-privilegiado, o kernel **é** a única
   fronteira de segurança. Rodar com CVE de kernel conhecida numa máquina multi-tenant é inaceitável.
2. **Custo de RAM proibitivo em 16 GB.** ARC padrão = 50% da RAM = 8 GB de 16 — metade do nó. Limitar
   `zfs_arc_max` a 1 GB elimina o custo e **também o benefício** (ZFS sem ARC tem desempenho ruim de
   metadados). Pelo Achado 0.2, **cada 512 MB são um ambiente**: um ARC de 2 GB custa **4 ambientes de
   22**, ou 18% da capacidade do nó.
3. **Modo de falha péssimo.** O pool não monta **no boot** — você descobre durante a manutenção, com todos
   os clientes do nó fora e sem shell útil.

**Veredito/Correção.** **ZFS sai do desenho.** Substituição recomendada, em ordem:

| Opção | Quota por ambiente | Snapshot | Dedup da base | Módulo de kernel | Veredito |
|---|---|---|---|---|---|
| **XFS com `prjquota` + overlay2 do Docker** | project quota no diretório do volume — simples e exata | não (usa restic) | **sim, nativo do overlay2** | nenhum | **ESCOLHIDA** |
| btrfs | qgroups (lentos) | sim, subvolume | parcial | **nenhum — está no kernel** | plano B, se snapshot por ambiente virar requisito |
| ext4 + quota de projeto | funciona, mas menos direto | não | não | nenhum | aceitável se a raiz já for ext4 |
| ZFS | refquota | sim | clone | **DKMS — bloqueador** | **descartada** |

**Consequência crítica para o Conflito 1:** metade do argumento pró-Incus era o clone ZFS (dedup da
imagem dourada, snapshot barato, `zfs send`). **Sem ZFS, o Incus com backend `dir` copia 2,8 GB de rootfs
por ambiente** — 22 ambientes = 62 GB de imagem base duplicada num disco de 200 GB, sem nenhum ganho. O
overlay2 do Docker dedupa a imagem base de graça, sem módulo de kernel nenhum. **Isso, sozinho, decide o
Conflito 1.**

---

### VEREDITO DO CONFLITO 1 (revisado após o ADENDO)

> **OCI — Docker Engine com `userns-remap` — um container por ambiente, dados do cliente em bind mount
> num diretório com project quota XFS, imagem base compartilhada por overlay2.**
> **ZFS e Incus saem do desenho da fase 1.** Incus fica como nota de rodapé para um eventual tier
> "ambiente com root real", e só se um nó KVM dedicado existir no futuro.

Razões, em ordem de peso (o adendo reordenou):

1. **Storage (Achado 1.6).** Sem ZFS, Incus perde dedup da base e snapshot; Docker/overlay2 entrega dedup
   nativamente, sem módulo de kernel. Em VPS de 16 GB / 200 GB, isso é decisivo sozinho.
2. **RAM (Achado 0.2).** `incusd` (~80–150 MB) + ARC do ZFS (≥1 GB) + systemd/journald **dentro** de cada
   container (~35 MB × 22 = 770 MB) custam ~2 GB num nó de 16 GB = **4 ambientes de 22 = 18% da
   capacidade**. Docker + init leve elimina quase tudo isso.
3. **Compatibilidade com VPS (Achado 0.1).** Incus aninhado é o primeiro a quebrar em VPS não-KVM.
4. **Quem opera e quem constrói.** Tiago usa Docker hoje. A IA construtora tem acervo de treino profundo
   em Docker e contaminado em Incus/LXD (Achado 1.5).
5. **Drift (Achado 1.2)** e **precedente comercial** (todo painel do segmento usa OCI-ish).
6. Os supostos diferenciais do Incus nos requisitos 4, 7 e 9 são **empates** (Achado 1.3).

O que se perde conscientemente:

| Perda | Cobertura |
|---|---|
| Cliente não faz `apt install` arbitrário | Toggle de extensões PHP no painel (é o que o Hostoo faz). Lista curada na imagem; pedido fora da lista vira ticket → entra na próxima build |
| Snapshot instantâneo por ambiente | restic (já escolhido em `02` §9.2) com repositório por ambiente. Restore mais lento, backup mais barato e **off-node desde o dia 1** |
| systemd dentro do ambiente | tini + supervisord; o processo Node do cliente vira unidade do supervisor, gerenciada pela UI |
| Cron nativo | cron no host disparando `docker exec` a partir da tabela de cron do painel |
| Migração ao vivo | sai do MVP (Achado 1.4, ADENDO §D) |

**Gatilho para reabrir:** (a) o diagnóstico do Achado 0.1 reprovar Docker mas aprovar algo mais forte; ou
(b) 3 dos 5 primeiros clientes-piloto exigirem instalar pacote de sistema arbitrário. O contrato interno
do agente deve ser **`ambiente`**, nunca `container Docker` — o `04` §2.2 já propôs a abstração e ela vale
nas duas direções.

### Teste Decisivo do Conflito 1 (1–2 dias, antes de qualquer código)

Nas VPS **reais**, não em laboratório. **Pré-requisito: `veloz-node-doctor.sh` sair 0 ou 2.**

| # | Medição | Método | Aprovação |
|---|---|---|---|
| T0 | Aptidão do nó | `veloz-node-doctor.sh` nas duas VPS | zero `CRÍTICO` |
| T1 | RSS ocioso por ambiente | 10 ambientes WordPress; `memory.current` após 10 min sem tráfego, p50/p95 | p95 < 200 MB |
| T2 | Cold start até HTTP 200 | 30 ciclos stop/start, opcache frio, `curl -w %{time_total}` | **p95 < 5 s** |
| T3 | Hot-resize de RAM | sob carga, `docker update --memory 2g --memory-swap 2g`; ler `memory.max` de volta e alocar 1,5 GB dentro | novo limite vale **sem restart**, PID 1 inalterado |
| T4 | Hot-resize de vCPU | `docker update --cpus 2`; ler `cpu.max`; medir throughput | idem T3 |
| T5 | Reduzir RAM abaixo do uso | baixar `memory.max` abaixo de `memory.current` | **documentar o erro — quebra o requisito 9 e nenhum doc trata** |
| T6 | Troca de PHP 8.2→8.3 | medir requisições com erro durante a janela | < 2 s de indisponibilidade |
| T7 | Quota de disco | escrever além da cota no bind mount com prjquota | escrita falha, o **host não enche** |
| T8 | Dedup da imagem base | `du` do storage após 10 ambientes da mesma imagem | overhead < 300 MB por ambiente |
| T9 | Densidade real | subir ambientes até `memory.pressure` avg60 > 20% **ou** p95 de TTFB > 800 ms | **o número que substitui os 80–130** |
| T10 | OOM contido | estourar `memory.max` de um ambiente | **nenhum outro ambiente afetado** |

Reprovação em T2, T3 ou T4 derruba o candidato sem discussão. T5 e T7 geram requisitos de produto.

---

## 2. CONFLITO 2 — Banco de dados do cliente

### Achado 2.1 — Banco por ambiente era inviável em nó de 64 GB; em VPS de 16 GB é aritmeticamente absurdo

**Severidade: Bloqueador** (para a proposta do `03`)

**Evidência.**
- `03` §4.1: *"container por ambiente, usuário Unix próprio, e **um servidor MySQL/Postgres por ambiente**
  (dentro do container)... **Custa RAM**, mas elimina a classe inteira de 'cliente A enxergou base do B'"*.
- `04` §8.4: *"**MySQL 8.4 e PostgreSQL 17 rodam no host**, um por nó, com 1 database + 1 role por
  ambiente. Motivo: 200 instâncias de MySQL num nó consomem 200× ~200 MB de buffer pool para nada"*.
- `04` §13, pergunta 5, e `03` §10, incerteza 3, ambos admitem que o número não existe: *"impacta densidade
  em ~25%"*.

**A conta, refeita para 16 GB.** Um `mysqld` 8.4 mínimo (`buffer_pool=32M`, `performance_schema=off`) fica
em **120–150 MB de RSS**; com defaults, 200–400 MB.

| Opção | RAM consumida | Ambientes possíveis (de 13,5 GB) |
|---|---|---|
| Banco **dentro** do plano de 512 MB | ~150 MB dos 512 → sobram ~360 MB para systemd+nginx+php-fpm | **plano inviável**: `04` §2.3 estima pico de php-fpm em **600–800 MB** — OOM garantido |
| Banco por ambiente **fora** do plano | 22 × 150 MB = **3,3 GB** | de 22 cai para **~16 ambientes (−27%)** |
| **Compartilhado por nó** (MariaDB + PG tunados) | **~800 MB total** | **22 ambientes** |

> **O plano de 512 MB com banco embutido não roda WordPress sob tráfego — ele sofre OOM-kill.**
> E o plano de 512 MB é o único onde a economia fecha (Achado 5.2).

**Veredito.** Banco por ambiente está descartado como padrão. O `03` §4.1 deve ser reescrito.

---

### Achado 2.2 — O banco compartilhado do doc 04 tem três buracos que ele não enfrenta

**Severidade: Alto**

**Evidência.** `04` §8.4 cobre bem o vetor de acesso (`'e0042'@'10.60.0.42'`, `MAX_USER_CONNECTIONS 30`,
`statement_timeout`, bind em `10.60.0.1`). Não cobre:

1. **Raio de explosão.** Um `mysqld` compartilhado que cai derruba o banco de **todos os clientes do nó de
   uma vez**. É o único argumento genuinamente forte do `03`, e o `04` não o menciona.
2. **PITR por cliente é impossível.** Binlog/WAL é da instância inteira. Restaurar o cliente A a ontem
   reverteria os outros 21. Nenhum documento descreve como se restaura só o banco de um cliente.
3. **"Pausado cobra só disco" é impreciso para o banco.** `04` §4.1 põe `MAX_USER_CONNECTIONS 0` ao
   pausar, mas os dados seguem ocupando páginas no buffer pool compartilhado e o processo segue no ar.

### VEREDITO DO CONFLITO 2

> **Bancos compartilhados por nó (proposta do `04` §8.4) — vence, com quatro emendas.**
> A proposta de banco por ambiente do `03` §4.1 é **retirada**.

| Emenda | Custo | Resolve |
|---|---|---|
| **Trocar MySQL 8.4 por MariaDB 11 LTS** | zero (compatível com WordPress e com todo o ecossistema PHP) | MySQL 8.4 idle em ~400–600 MB; MariaDB 11 em ~120–250 MB. **Economia de ~300 MB = 1 ambiente inteiro de 22.** Manter o rótulo "MySQL" na UI. *Decisão a ratificar pelo esp. Banco de Dados (#7) contra incompatibilidades de JSON/CTE* |
| **Dump por database a cada hora** (`mysqldump --single-transaction` / `pg_dump -Fc`) para o object storage | I/O baixo em bases < 1 GB; ~30 linhas no agente | PITR aproximado (RPO 1 h), **restore por cliente**, e migração de nó sem dump ad-hoc |
| **Tier "banco dedicado"** como container próprio, vendido à parte | já é o plano B do `04` §8.4 | Cliente que exige isolamento vira **receita**, não custo |
| Reserva de host corrigida | de "DBs 4 GB" (`04` §2.3, escala de 64 GB) para **~800 MB** em 16 GB, com `buffer_pool`/`shared_buffers` de 256 MB cada | número real para o nó real |

*Duas instâncias por nó (para cortar o raio de explosão) fica para quando houver >40 ambientes por nó —
em 16 GB é RAM que não existe.*

Critérios pedidos, resolvidos em uma linha cada:
- **Noisy neighbor:** empate após `MAX_QUERIES_PER_HOUR` + `statement_timeout` + IOWeight por slice.
- **Backup/restore por cliente:** era a vantagem do dedicado; a emenda do dump horário anula.
- **Migração entre nós:** empate — nos dois modelos o banco é dump+restore.
- **Custo de RAM:** decisivo, e em 16 GB é 27% da capacidade.
- **Pausa:** o dedicado pausa junto; o compartilhado não libera, mas o custo residual tende a zero (o
  buffer pool é LRU e evacua dado de cliente pausado sozinho).

---

## 3. CONFLITO 3 — Stack do control plane (refeito do zero após o ADENDO)

### Achado 3.1 — A decisão original é insustentável: Go foi escolhido para um sistema que Tiago não conseguirá depurar

**Severidade: Bloqueador**

**Evidência.** `03` D3 e §3 escolhem **Go** dos dois lados; `03` §10 admite ser *"a decisão de maior
variância"* e diz *"se o dev for PHP-first, o custo de aprendizado pode superar o ganho"*.

ADENDO §A: Tiago domina **Node.js e .NET**; front **obrigatoriamente Next.js**; *"'facilidade de contratar
dev no mercado' **deixa de ser critério**"*; *"'O Tiago consegue ler, entender e depurar o código em
produção' **continua sendo critério**"*.

**Por que é um problema.** Go não é a linguagem de ninguém aqui: nem de quem opera, nem de quem constrói
por preferência. A justificativa original ("uma linguagem só nos dois lados") desaparece assim que o front
é obrigatoriamente TypeScript — nesse cenário Go **adiciona** uma linguagem em vez de economizar.

**Veredito.** Go está eliminado do control plane. Permanece como candidato **apenas** para o agente, e
mesmo lá perde (ver 3.3).

---

### Achado 3.2 — O ADENDO fecha o front em Next.js, e isso decide o control plane

**Severidade: Alto**

Opções reais, avaliadas contra os critérios que restam:

| Critério | **Node/TypeScript** (Fastify ou NestJS) | **.NET 9 (ASP.NET Core)** |
|---|---|---|
| Mesma linguagem do front obrigatório (Next.js) | **sim** — tipos compartilhados num monorepo, um só modelo mental | não — dois ecossistemas, dois tipos de erro, contrato duplicado |
| Tiago lê e depura em produção | sim | sim |
| Tempo real (log ao vivo, terminal, métricas) | SSE/WebSocket nativos, sem worker por conexão | **SignalR é superior** |
| Aritmética de dinheiro | risco real: sem tipo decimal → **obrigatório `bigint` de centavos** (o `03` §4.2 já modela `*_cents bigint`) | `decimal` nativo — vantagem |
| Tipagem e refatoração em base grande | TS é bom; disciplina exigida | **C# é melhor** |
| Integração com Linux (cgroups, containers, sockets, processos) | `child_process`, leitura de `/sys/fs/cgroup`, `net` para unix socket, `dockerode` — tudo I/O e exec | equivalente |
| Ecossistema de infra (Docker, ACME, S3, PSPs) | SDKs maduros e mantidos | SDKs bons, menos exemplos de infra Linux |
| Qualidade do código que a IA vai gerar | acervo de treino gigantesco em TS/Node + Next | bom, mas o par "Next.js front + .NET back" é menos comum e gera mais atrito de contrato |
| Consumo de RAM no CP | ~150–250 MB | ~120–200 MB (empate prático) |

**Veredito.** Com o front fechado em Next.js, o control plane em **Node/TypeScript** ganha pelo eixo que
mais importa neste projeto: **um único contrato de tipos entre front e back, num monorepo, escrito por uma
IA e lido por um operador que sabe as duas pontas.** .NET vence em dinheiro e tipagem — os dois são
mitigáveis (centavos em `bigint`, TS em modo estrito com validação de esquema em runtime).

---

### Achado 3.3 — O agente: Go está eliminado por quem opera; a escolha real é Node-SEA × .NET AOT

**Severidade: Alto**

O agente precisa de: executar processos, ler `/sys/fs/cgroup`, falar com a API do Docker (unix socket),
manter estado local, streamar log, e ser **um arquivo** que se instala sem instalar runtime no nó.

| Critério | Go | Node com **SEA** (Single Executable, estável desde Node 22) | .NET 9 **NativeAOT** |
|---|---|---|---|
| Binário único, sem runtime no nó | sim (~15 MB) | **sim** (~60–90 MB — o runtime vai embutido) | **sim** (~15–25 MB) |
| Tiago lê e depura | **não** | sim | sim |
| RAM residente | 30–60 MB | 60–100 MB | 30–60 MB |
| Mesma linguagem do CP (Achado 3.2) | não | **sim** | não |
| Integração com Docker/cgroup | excelente | boa (`dockerode`, `fs`, `child_process`) | boa |
| Risco de supply chain num daemon privilegiado | baixo | **alto se houver muitas dependências npm** | baixo |
| Tempo de partida | ~5 ms | ~40–80 ms | ~10 ms |

**Veredito: agente em Node com SEA**, com **três condições duras** — sem elas, cai para .NET AOT:

1. **Teto de 5 dependências npm de runtime.** Um daemon com acesso ao socket do Docker não pode ter uma
   árvore de 400 pacotes. `npm ls --prod --all` no CI falha acima do teto.
2. **Consumo residente medido < 120 MB.** Pelo Achado 0.2, cada 512 MB são um ambiente; um agente de
   250 MB custa meio ambiente por nó, aceitável, mas precisa ser medido, não estimado.
3. **O especialista Node/Next.js (#12) precisa responder por escrito**, com código de prova, à pergunta do
   ADENDO §A: *cgroups, containers, sockets e processos em Node têm performance adequada?* O experimento
   mínimo: ler `memory.current` de 25 cgroups a cada 15 s, executar 10 `docker exec` concorrentes e
   streamar 5.000 linhas/s de log, medindo CPU e RSS do agente. **Critério: < 5% de 1 vCPU em regime,
   RSS < 120 MB.** Se reprovar → **.NET 9 NativeAOT**, e o CP continua em Node.

**Dependência registrada:** este veredito é condicional ao parecer do especialista Node/Next.js. É a única
decisão desta crítica que não está fechada, e está assim de propósito — o ADENDO criou o especialista para
isso.

### VEREDITO DO CONFLITO 3

> **Control plane em Node/TypeScript** (Fastify ou NestJS, Postgres com Drizzle/Prisma), **front em
> Next.js** (requisito fechado), **num monorepo com tipos compartilhados**.
> **Agente em Node compilado com SEA**, sujeito às três condições do Achado 3.3;
> **plano B: .NET 9 NativeAOT**. **Go está eliminado dos dois lados.**
> Dinheiro sempre em `bigint` de centavos — nunca `number`.

---

## 4. CONFLITO 4 — Complexidade do transporte (reavaliado com internet pública)

### Achado 4.1 — A justificativa para NATS contém um erro factual sobre long-polling

**Severidade: Alto**

**Evidência.** `03` §1.4, linha "HTTP + polling do agente": *"Máximo de simplicidade, mas **latência de
comando = intervalo de poll**"*.

**Por que é um problema.** Isso confunde *polling* com *long-polling*. Em long-poll o agente abre
`GET /agent/v1/tasks/next?wait=30s` e o servidor **segura a conexão** até haver tarefa ou estourar o
timeout: a latência de entrega é de **milissegundos**. A decisão mais cara em complexidade operacional do
control plane foi justificada, em parte, sobre uma afirmação incorreta.

---

### Achado 4.2 — O outbox transacional existe apenas porque o NATS foi introduzido

**Severidade: Alto**

**Evidência.** `03` §5.1: *"**Transactional outbox** é obrigatório: publicar no NATS fora da transação do
Postgres cria o par clássico de bugs... A tabela `outbox(...)` é lida por um relay com `FOR UPDATE SKIP
LOCKED` a cada 200 ms"*.

**Por que é um problema.** O outbox resolve o problema de ter **dois armazenamentos duráveis** que
precisam concordar. Se o Postgres for a própria fila, `INSERT jobs` **é** o despacho — mesma transação,
sem dual-write, sem outbox, sem relay, e sem o risco R12 do próprio `03` (*"JetStream mal configurado
enche o disco do CP"*). **O NATS cria três dos componentes vendidos como sofisticação necessária.**

---

### Achado 4.3 — A internet pública entre provedores **reforça** o corte do NATS, não o contrário

**Severidade: Alto** (é a reavaliação pedida)

**Evidência.** ADENDO §B.1: *"**Não existe rede privada entre os nós.** Control plane ↔ agente trafega pela
internet pública → mTLS obrigatório, tolerância a latência e a queda de link, nada de suposição de LAN."*

Análise honesta — link instável favorece qual modelo?

| Aspecto sob link instável | NATS JetStream | Postgres + long-poll HTTPS |
|---|---|---|
| Quem reconecta | o agente (conexão de saída) | **o agente** (idem) |
| Comando perdido em queda | fica no stream `CMD` | **fica na linha de `job_steps`** — mais durável, é a fonte da verdade |
| Reentrega após queda | `ack_wait` + `MaxDeliver` | `deadline_at` + `attempt` — colunas que o `03` §4.2 **já definiu** |
| Estado meio-aplicado | `applied_keys` no BoltDB | idem, **permanece necessário** |
| Buffer de eventos offline | outbox local no agente | idem, **permanece necessário** |
| Um serviço novo exposto na internet | **sim — o NATS** | não: só HTTPS, que já existe |
| Superfície de ataque na internet pública | porta NATS + TLS + contas + permissões de subject | **um endpoint HTTPS com mTLS** |
| Latência entre provedores (5–50 ms) | irrelevante | irrelevante |

**A internet pública argumenta a favor do modelo mais simples**, por um motivo que nenhum documento
notou: com NATS você passa a **expor um segundo serviço de rede na internet pública** e a operar sua
autenticação, seus certificados e suas permissões de subject — num projeto onde `02` §7.3 estabelece que
*"o painel é o alvo mais valioso do servidor"* e o caso CyberPanel (22.000 servidores) é a lição central.

O que **fica mais importante** com link instável, e deve virar requisito explícito (ausente hoje):
- **Buffer local no agente dimensionado para 72 h** (o `03` §1.6 já pede) — **manter**, e priorizar
  eventos faturáveis sobre telemetria.
- **Upload de log retomável** (`Range`/offset), porque um `POST` chunked de 10 minutos que cai no minuto 9
  não pode recomeçar do zero.
- **Métricas com batching e compressão**: o agente escreve direto no VictoriaMetrics por remote-write
  (que o `03` D9 já manda fazer), agora **com autenticação e sobre TLS**, porque atravessa a internet.
- **Orçamento de banda por nó**: VPS costumam ter cota mensal de tráfego. Nenhum documento menciona.
  Estimar o custo de telemetria + log + backup contra a cota do provedor.

---

### Achado 4.4 — Inventário do que se perde ao cortar o NATS

**Severidade: Médio** (é a quantificação pedida)

| Necessidade | NATS JetStream | Postgres + long-poll HTTPS | Perda |
|---|---|---|---|
| Conexão só de saída do nó | sim | **sim** | zero |
| mTLS | nativo | HTTPS com certificado de cliente | zero |
| Entrega durável | stream workqueue | **linha em `jobs`/`job_steps` — é a fonte da verdade** | **ganho** |
| Retry / backoff | `MaxDeliver` | `attempt`/`max_attempts`/`scheduled_at` — **já modelados** | zero |
| Ordenação por nó | `max_ack_pending=1` | `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` por `node_id` | zero |
| Dedup / idempotência | `Nats-Msg-Id` | `idempotency_key UNIQUE` — **já modelado** | zero |
| Log ao vivo | pub/sub | WebSocket agente→CP, repassado por SSE | ~150 linhas |
| Telemetria | subject `tm.*` | **remote-write direto no VictoriaMetrics** | **ganho: um salto a menos** |
| Fan-out para N nós | trivial | loop de N linhas | irrelevante com 3 nós |
| Barramento para consumidores futuros | sim | não | **única perda estrutural** |
| Latência de comando | ~10 ms | ~10 ms (long-poll) | zero (Achado 4.1) |

**Peças eliminadas:** servidor NATS + streams/consumidores + contas e permissões de subject + tabela
`outbox` + relay do outbox + `LISTEN/NOTIFY` para acordar o relay + risco R12 + **um serviço exposto na
internet**. Permanecem: buffer local do agente e `pg_advisory_xact_lock` (uma linha).

### VEREDITO DO CONFLITO 4

> **Over-engineering absurdo para 3 VPS e 4–5 sistemas. Cortar NATS/JetStream e o outbox da fase 1.**
>
> Fase 1: **Postgres é a fila** (`jobs` + `job_steps`, `FOR UPDATE SKIP LOCKED`, `pg_advisory_xact_lock`);
> **agente faz long-poll HTTPS com certificado de cliente**; **log ao vivo por WebSocket retomável**;
> **métricas direto no VictoriaMetrics** por remote-write autenticado; **buffer local de 72 h no agente**,
> com eventos faturáveis com prioridade.
>
> **Gatilho de reintrodução:** (a) > 8 nós; **ou** (b) segundo consumidor independente do fluxo de eventos;
> **ou** (c) latência p95 de despacho > 500 ms.

Ressalva honesta: o desenho de mensageria do `03` §1.4 é **tecnicamente muito bom** — o mapa de subjects,
as permissões por `CN`, a separação durável/efêmero e o tratamento dos 5 modos de falha estão corretos.
Não é um desenho ruim; é um desenho caro cedo demais. Arquivar em `Plan/docs/transporte-nats-adiado.md`.
O **contrato de tarefas** (`03` §1.4.2) e a semântica de idempotência valem independentemente do
transporte e devem ser preservados na íntegra.

---

## 5. NOVO — O gateway de pagamento revela que a modularidade do doc 03 é de fachada

### Achado 5.0 — Um módulo de pagamento **não pode funcionar** com o contrato de módulo do doc 03

**Severidade: Bloqueador** (é requisito fechado do ADENDO §C)

**Evidência.** ADENDO §C: *"**O meio de pagamento DEVE ser um módulo plugável** — `mod-pagamento-pix`,
`mod-pagamento-asaas`, `mod-pagamento-stripe`... com uma **interface de gateway de pagamento** bem
definida no core, e **nenhum acoplamento do core a um PSP específico**."*

Confronto com o que o `03` realmente especifica:

| Necessidade de um módulo de pagamento | O que o `03` oferece | Veredito |
|---|---|---|
| **Escrever em `core.transactions`** ao confirmar um pagamento | `03` §2.4: o módulo recebe conexão *"já fixada em `search_path = mod_php`, com role **sem permissão nos schemas alheios**"*; §2.2: *"módulo **NUNCA** toca em outro schema"* | **QUEBRADO.** O módulo é fisicamente incapaz de registrar o pagamento na tabela que o core define em §4.2 |
| **Receber webhook do PSP** (chamada de fora, não autenticada por sessão) | `03` §2.2 `api.routes[]` só declara rotas com `permission:` — todas passam pelo gateway que *"autenticou o chamador e resolveu `tenant_id`"* (§2.4) | **QUEBRADO.** Não existe tipo de rota "webhook de entrada" |
| **Contrato de capacidade** análogo ao `runtime.generic` | `03` §2.6 define `runtime.generic v2` com 6 operações — excelente. **Não existe nada equivalente para pagamento** | **AUSENTE** |
| **Core sem acoplamento a PSP** | `03` §6.3 lista *"Webhook de PSP (entrada) — assinatura do provedor + allowlist de IP"* como mecanismo **do core**; `03` §4.2 define `transactions.provider`/`provider_ref` no schema do core; §2.1 declara *"faturamento (o motor...) — Esse é o **core**"* | **ACOPLADO.** O core conhece o conceito de PSP e valida webhook de PSP |
| **Guardar credencial do PSP** (chave de API, token) | `03` §2.2 tem `secrets: []` e §2.4 tem `readSecret()` — **existe** | OK |
| **Disparar cobrança a partir do motor de faturamento** | não há chamada do core para o módulo; o fluxo do `03` §2.4 é sempre browser → gateway → sidecar | **AUSENTE.** Falta o sentido core → módulo |

**Por que é um problema.** A modularidade do `03` §2 é excelente para módulos que **acrescentam
capacidade isolada** (um runtime, um DNS, um webmail): o módulo tem schema próprio, rotas próprias e telas
próprias, e nada do core depende dele. Ela é **inadequada** para módulos que **participam de um fluxo
central do core** — e pagamento é exatamente isso: o motor de faturamento (core) precisa pedir uma
cobrança ao módulo, e o módulo precisa devolver um fato que altera o saldo do tenant (core).

O resultado, se ninguém corrigir, é previsível: sob pressão, o Asaas entra hardcoded no core "só para
começar", e o requisito do ADENDO §C morre no primeiro sprint. É modularidade de fachada.

**Veredito/Correção.** O `03` §2 precisa ganhar **três mecanismos** que hoje não tem. Especificação
mínima para o Ciclo 2 (dono: Arquiteto #3 + esp. Billing #6):

**(a) Capability `payment.gateway v1`** — análoga a `runtime.generic v2`, no mesmo formato:

```yaml
capability: payment.gateway
version: "1"
operations:
  describe:
    returns: { methods: ["pix","card","boleto"], supports_refund: bool,
               supports_recurring: bool, supports_prepaid_topup: bool, currencies: ["BRL"] }
  create_charge:
    args:    { amount_cents: int, currency: string, description: string,
               customer: { name, tax_id, email }, method: string,
               idempotency_key: string, return_url: string, expires_at: string }
    returns: { provider_ref: string, status: "pending|authorized|succeeded|failed",
               payment_url: string, pix_qrcode: string?, raw: object }
  get_charge:  { args: { provider_ref }, returns: { status, amount_cents, paid_at, raw } }
  refund:      { args: { provider_ref, amount_cents, reason }, returns: { status, raw } }
  verify_webhook:
    args:    { headers: object, raw_body: string }
    returns: { valid: bool, provider_ref: string, status: string, amount_cents: int, event_id: string }
contract:
  - "create_charge é idempotente por idempotency_key"
  - "verify_webhook NUNCA confia no corpo: valida assinatura do PSP antes de devolver valid:true"
  - "o módulo NÃO escreve em core.transactions; ele devolve o fato e o core persiste"
  - "amount_cents é bigint de centavos; nenhum ponto flutuante atravessa a interface"
```

**(b) Host API `host.payments.settle()`** — o caminho pelo qual o módulo entrega o fato sem violar o
isolamento de schema:

```ts
host.payments.settle({
  provider: "asaas", provider_ref: "pay_123", event_id: "evt_456",
  status: "succeeded", amount_cents: 5000n, paid_at: "...", raw: {...}
})
// O CORE valida, deduplica por (provider, provider_ref, event_id),
// escreve core.transactions, credita o saldo em ledger e emite o evento de domínio.
```

**(c) Tipo de rota `webhook` no manifesto** — sem sessão, sem tenant resolvido, mas com rate limit,
allowlist de IP opcional e corpo cru preservado:

```yaml
api:
  webhooks:
    - path: "/webhooks/asaas"
      auth: none              # a validação é do módulo, via verify_webhook
      rawBody: true           # o gateway NÃO faz parse — a assinatura é sobre os bytes originais
      rateLimit: "600/min"
      ipAllowlist: []         # opcional, configurável pelo super admin
```

**(d) Correções de acoplamento no core.** Remover de `03` §6.3 a linha "Webhook de PSP (entrada)" como
mecanismo do core (passa a ser o tipo de rota acima); manter `transactions.provider`/`provider_ref` como
colunas **genéricas** (é correto: o core registra *que houve* um pagamento por *algum* provedor); e
declarar em `03` §2.1 que **o motor de faturamento é core, os meios de pagamento são módulos** — o
documento já diz isso em uma linha, mas o mecanismo não existe.

**Teste de aceitação da modularidade (obrigatório no CI, análogo ao `mod-echo` do `03` R9):**
> **`mod-pagamento-fake`** — módulo de PSP fictício que aprova qualquer cobrança após 3 s. O fluxo
> "cliente recarrega saldo → cobrança criada → webhook recebido → saldo creditado → fatura paga" deve
> funcionar ponta a ponta **sem uma linha no core mencionando Asaas, Pix ou Stripe**. Um `grep -r "asaas\|
> stripe\|mercadopago"` fora dos diretórios de módulo deve retornar zero. Se `mod-pagamento-fake` quebrar,
> alguém acoplou.

---

## 6. Cobrança por hora versus realidade (recalculado para a infra real)

### Achado 6.1 — Com VPS de 16 GB, o teto de receita dos 3 nós é de ~R$ 800/mês de margem bruta

**Severidade: Bloqueador** (de expectativa, não de execução)

**Premissas rastreáveis:**
- Preço de referência: **R$ 35,00/mês** por 512 MB / 1 GHz / 15 GB (`00-BRIEFING`, "Descoberta que altera
  o requisito 5"). Escada de desconto até **60% OFF (R$ 13,90/mês em 36 m)**.
- Densidade **recalculada**: **18–25 ambientes por VPS de 16 GB** (Achado 0.2). Uso 22.
- 3 nós × 22 = **66 ambientes** no teto (a regra N-1 do `03` R10 sai — ver Achado 6.3).
- Custo de VPS 6–8 vCPU / 16 GB / NVMe no Brasil: **R$ 150–350/mês**. Uso R$ 250.
- Control plane: VPS pequena, R$ 80/mês.
- Backup: Magalu R$ 0,10/GiB/mês (`02` §9.1); ~4 GiB por ambiente com dedup restic.
- Taxas: Asaas **Pix R$ 1,99** por recarga (`02` §4.3). **NF-e sai** (ADENDO §C).

**Cenário A — teto absoluto: 3 nós lotados, preço de tabela, ninguém pausado.**

| Item | Valor |
|---|---|
| Ambientes | **66** |
| Receita | 66 × R$ 35 = **R$ 2.310** |
| VPS (3 × 250) + control plane | R$ 830 |
| Backup (66 × 4 GiB × R$ 0,10) | R$ 26 |
| Taxas Pix (1 recarga/mês) | R$ 131 (**5,7% da receita**) |
| **Margem bruta** | **≈ R$ 1.320/mês** |

**Cenário B — mix realista: 40% em compromisso longo (preço médio R$ 27,80), 30% pausados (a 10%).**
Fator de pausa = 0,73. Receita = 66 × 27,80 × 0,73 = R$ 1.339. Custos = R$ 987.
**Margem ≈ R$ 352/mês.**

**Cenário C — metade da base pausa.** Fator = 0,55.
- A R$ 35: 66 × 35 × 0,55 = R$ 1.271 − R$ 987 = **+R$ 284/mês** (raspando).
- A R$ 13,90: 66 × 13,90 × 0,55 = R$ 505 − R$ 987 = **−R$ 482/mês (prejuízo)**.

**Ponto de ruptura** (66 ambientes, custo fixo R$ 987, pausado = 10% do ativo):

| Preço praticado | Fração da base que precisa estar **ativa** para empatar |
|---|---|
| R$ 35,00 (tabela) | **36%** — folgado |
| R$ 27,80 (mix) | **50%** |
| R$ 17,00 (12 m, 48% off) | **86%** — apertado demais |
| **R$ 13,90 (36 m, 60% off)** | **>100% — impossível** |

> Com o preço de compromisso de 36 meses, **os 3 nós cheios e 100% ativos faturam R$ 917 contra R$ 987 de
> custo**. A escada de descontos do Hostoo, copiada como está, **dá prejuízo em qualquer nível de ocupação**.

**Por que é um problema — e o que muda com o ADENDO.** A boa notícia: na fase de validação (4–5 sistemas),
o custo de bolso é de **~R$ 830/mês** — um experimento acessível, e o ADENDO deixa claro que é isso que
Tiago quer fazer. A má notícia: **o teto do plano de 3 VPS de 16 GB é de ~R$ 1.320/mês de margem bruta.**
Isso não é um negócio; é um laboratório com receita. Precisa estar escrito, para que a decisão de investir
2 anos de construção seja tomada com o número na frente.

**Veredito/Correção.** Bloqueador de expectativa. Cinco correções:

1. **Não copiar a escada de desconto. Teto de 25%.** Se o objetivo é fluxo de caixa antecipado, 25% compra
   isso; 60% destrói a unidade econômica.
2. **Recarga mínima de R$ 100.** Derruba a taxa de pagamento de 5,7% para ~1,7%. Configuração, não código.
3. **Pausado a ~20% do ativo, não 10%.** Custo real de um ambiente pausado (disco + backup + overhead de
   conta) ≈ R$ 4–6/mês num plano de R$ 35. E manter o expurgo aos 90 dias (`04` §4.4).
4. **Escrever no briefing qual é o objetivo real** desta fase: validar o produto (então a margem não
   importa por 12 meses) ou gerar renda (então 3 VPS de 16 GB não servem e a conversa é sobre nós maiores).
   O ADENDO §C sugere o primeiro. **Deixar explícito.**
5. **ARPU vem de add-on.** `02` §14 lista 25 features e nenhuma foi ligada à conta: backup estendido, CDN,
   WAF, banco dedicado, IP dedicado, WordPress toolkit. Sem add-on, o plano base sozinho não sustenta nada.

---

### Achado 6.2 — 512 MB é o único plano onde a conta fecha, e 512 MB não roda a loja do cliente

**Severidade: Alto**

**Evidência.** `04` §2.3 estima o perfil de um WordPress: *"ocioso ~122 MB; sob tráfego leve (5 rps)
300–450 MB; **pico (`pm.max_children=5`) 600–800 MB**"*.

**Por que é um problema.** O pico (600–800 MB) é **maior que o `MemoryMax` do plano de 512 MB**. Um
WordPress com WooCommerce em 512 MB bate `memory.max` e sofre OOM-kill de worker sob tráfego — o pior modo
de falha do ponto de vista do cliente ("meu site às vezes cai"). Se o mercado comprar o plano de 1 GB, a
densidade cai de 22 para ~11 por nó e **o custo de infra por ambiente dobra de R$ 15 para R$ 30** — acima
do preço de tabela de R$ 35 depois das taxas. Todo o Achado 6.1 piora pela metade.

**Veredito/Correção.** (a) Medir T9 com WordPress+WooCommerce real; (b) posicionar 512 MB explicitamente
como "site institucional / blog"; (c) tornar 1 GB o plano de entrada para e-commerce, a **≥ R$ 60/mês**;
(d) refazer o Achado 6.1 com o mix de planos medido.

---

### Achado 6.3 — A regra N-1 é insustentável com 3 VPS em 3 provedores; substituir por RTO declarado

**Severidade: Médio**

**Evidência.** `03` R10: *"Capacidade sempre reservada: nunca alocar acima de **N-1** (com 3 nós, os 3
juntos não passam de ~66% de ocupação, para caber a carga de um nó morto)"*.

**Por que é um problema.** Com nós dedicados grandes num datacenter, N-1 é caro mas defensável. Com **3
VPS de 16 GB em 3 provedores diferentes**, reservar um nó inteiro significa jogar fora 33% de uma
capacidade que já é minúscula (22 ambientes) — e a evacuação atravessaria a internet pública entre
provedores, ou seja, seria lenta de qualquer jeito. Estamos pagando seguro caro por uma apólice que não
paga rápido.

**Veredito/Correção.** **Trocar N-1 por RTO declarado.** Vender até 90% de ocupação, com backup off-node
diário verificado (que o próprio R10 já exige em paralelo) e **RTO contratual de 4 h** para restaurar num
nó novo. Reavaliar quando houver ≥ 6 nós. Isso devolve 33% da capacidade e ~R$ 400/mês de margem no
Cenário A.

---

### Achado 6.4 — Cota de banda das VPS não foi orçada por ninguém

**Severidade: Médio** (novo, decorrente do ADENDO)

**Evidência.** Nenhum dos quatro documentos menciona cota de tráfego. VPS comerciais tipicamente incluem
2–20 TB/mês e cobram ou reduzem a velocidade acima disso.

**Por que é um problema.** O tráfego do nó agora inclui: (a) o tráfego dos sites dos clientes; (b)
**telemetria e log atravessando a internet até o CP** (que antes seria LAN); (c) **backup restic subindo
para o Magalu**; (d) eventual `zfs send`/rsync entre provedores. Com 22 ambientes, (b)+(c) são da ordem de
dezenas de GB/mês — irrelevante. Mas um único cliente com um vídeo viral consome a cota do nó e
**degrada todos os outros**, e nenhum documento tem limite de banda por ambiente nem métrica de egress
por ambiente para cobrar por isso.

**Veredito/Correção.** (a) Levantar a cota de cada VPS e escrever no `nodes`; (b) medir e **cobrar egress
por ambiente** (o meter `egress.gb` já existe em `03` §4.2 — implementar de verdade); (c) limite de banda
por ambiente no proxy de borda; (d) alerta em 70% da cota do nó.

---

### Achado 6.5 — O custo de suporte não foi calculado, e é o custo dominante

**Severidade: Alto**

**Evidência.** `04` §12 estima *"4–8 h/mês de operação rotineira"* — isso é **operação de infra**, não
**suporte a cliente**. `02` §14 item 14 diz *"reduz ticket de suporte, que é o custo real de um time de
1–3 pessoas"* — identifica o problema e não o quantifica.

**Por que é um problema.** Referência do setor: 0,3 a 1,0 ticket por cliente por mês, 15–40 min por
ticket. Com 66 clientes: **20–66 tickets/mês = 7 a 44 horas/mês**. Contra uma margem bruta de R$ 1.320
(Cenário A), isso implica **R$ 30 a R$ 190 por hora de suporte** — antes de qualquer desenvolvimento. Na
fase de 4–5 sistemas é irrelevante; a partir de ~30 clientes vira a restrição real.

**Veredito/Correção.** As features nº 14 (alertas proativos), nº 20 (logs no painel) e nº 16 (assistente
de IA) do `02` §14 deixam de ser "nice to have" e viram **infraestrutura de sobrevivência do modelo**.
Medir tickets/cliente desde o primeiro dia — é a métrica que decide se isso escala.

---

## 7. Benchmarks obrigatórios antes de qualquer linha de produção

### Achado 7.1 — Toda a viabilidade repousa sobre estimativas que os próprios autores marcam como não medidas

**Severidade: Bloqueador**

**Evidência.** `04` §13, pergunta 7: *"Benchmark obrigatório no ciclo 2: **medir de fato** boot time, RSS
por ambiente e tempo de reload do nginx... **Os números da §2.3 são estimativas fundamentadas, não
medições.**"* `02` §16 item 4 diz o mesmo. E agora sabemos que as estimativas estavam erradas por 4–6×
(Achado 0.2).

**Bateria obrigatória.** Além de T0–T10 (§1), estes:

| # | Benchmark | Metodologia | Aprovação | Reprovação → ação |
|---|---|---|---|---|
| B0 | **Aptidão do nó** | `veloz-node-doctor.sh` nas 2 VPS existentes | zero `CRÍTICO` | reprova → **trocar de VPS antes de qualquer código** |
| B1 | Densidade real com carga | subir ambientes WP+Woo até `memory.pressure` avg60 > 20% ou p95 de TTFB > 800 ms | **≥ 18 ambientes de 512 MB em 16 GB** | < 14 → refazer o Achado 6.1 e subir preço |
| B2 | RSS ocioso por ambiente | `memory.current` após 10 min sem tráfego, p50/p95 de 10 ambientes | p95 < 200 MB | > 300 MB → cortar init/serviços da imagem |
| B3 | Cold start até HTTP 200 | 30 ciclos, opcache frio | **p95 < 5 s** (requisito 4) | > 5 s → `opcache.file_cache` persistente; senão, UX de espera no botão |
| B4 | Hot-resize dos dois eixos | T3/T4/T5 | limite novo vale sem restart | falha → requisito 9 não é atendível como especificado; renegociar |
| B5 | Reload do proxy de borda | 50 vhosts sintéticos (não 200 — a escala mudou), `time` do reload | < 1 s | > 3 s → Caddy com API JSON (`02` §12.2) |
| B6 | **Restore ponta a ponta** | apagar 1 ambiente de 10 GB (arquivos + banco), restaurar do Magalu, verificar HTTP 200 + checksum | **RTO < 60 min, RPO ≤ 1 h** | falha → **não vender para ninguém** |
| B7 | Custo de egress do restore | medir GiB baixados × R$ 0,10; e o consumo contra a cota da VPS | orçado e escrito | — |
| B8 | OOM contido | estourar `memory.max` de um ambiente | **nenhum outro afetado** | vazamento → sobrevenda de RAM proibida |
| B9 | I/O noisy neighbor | 1 ambiente com `fio` saturando; p95 de TTFB dos vizinhos | degradação < 20% | > 20% → `io.max` obrigatório por ambiente |
| B10 | **Precisão do metering** | 72 h, 10 ambientes com pause/start aleatório; somar `usage_events` × log de estado do runtime | divergência **< 0,5%** | > 1% → motor de cobrança não vai para produção |
| B11 | Agente em Node (Achado 3.3) | ler `memory.current` de 25 cgroups a 15 s + 10 `docker exec` concorrentes + 5.000 linhas/s de log | **< 5% de 1 vCPU, RSS < 120 MB** | reprova → agente em .NET AOT |
| B12 | Modularidade de pagamento | `mod-pagamento-fake` ponta a ponta + `grep` proibitivo por nome de PSP fora de módulo | fluxo completo, grep vazio | reprova → o requisito do ADENDO §C não está atendido |
| B13 | Isolamento entre tenants | cliente A tenta ler recurso de B em **todo** endpoint | 404 em 100% | qualquer 200 → bloqueia release |

**Critério global: nenhum cliente pagante antes de B0, B6, B10 e B13 passarem.** Backup não restaurado,
cobrança não conferida e vazamento entre tenants são os três jeitos de matar o projeto com um evento só.

---

## 8. Requisitos do briefing × cobertura real

### Achado 8.1 — Tabela de rastreabilidade (incluindo os requisitos novos do ADENDO)

**Severidade: Alto** (pelos buracos)

| # | Requisito | Onde está resolvido | Qualidade | Buraco |
|---|---|---|---|---|
| 1 | PHP + Node, aberto a outras linguagens | `03` §2.6 (`runtime.generic` v2) — **excelente**; `04` §5.5 | **Resolvido** | No modelo de imagem dourada, uma versão nova só alcança ambientes **novos** (Achado 1.2). Falta o job "atualizar base instalada" |
| 2 | Sistema modular | `03` §2 inteiro | **Parcial — e quebrado para pagamento** | Achado 5.0: o contrato não suporta módulo que participa de fluxo do core. Além disso, `03` R2 admite risco **Alta × Alto** de engolir o cronograma. E o Achado 0.3 mostra que, com IA construtora, **o plano é o escopo** |
| 3 | Dois painéis (cliente + super admin) | `01` §5 e §6; `03` §6.3 | **Parcial** | Ninguém definiu o escopo **mínimo** do super admin para lançar. `01` §4 lista 12 telas como se todas fossem do dia 1 |
| 4 | Cliente pausa e inicia | `04` §4 — muito bom (tabela do que sobrevive à pausa, página 503, "acordar ao receber visita") | **Resolvido** | Contradição C2: `03` §3 usa `incus pause` (RAM presa), `04` §4.1 rejeita explicitamente |
| 5 | Cobrança por hora | `02` §4.4; `03` §4.2, §7.3 | **Parcial** | (a) margem só agora calculada e **não fecha com desconto** (6.1); (b) `02` manda cobrar "hora cheia pelo estado", `03` §7.3 manda medir por **minuto** (C14); (c) taxa de Pix não modelada; (d) egress não medido (6.4) |
| 6 | MySQL e PostgreSQL | `04` §8.4 × `03` §4.1 | **Parcial — em conflito** | Resolvido aqui (Conflito 2). Faltam PITR por cliente e o destino do banco na migração |
| 7 | Trocar versão de linguagem | `04` §5.3 (blue/green de pool PHP — **excelente**); `03` §2.6 | **Resolvido** | Falta **rollback em 1 clique** se o site quebrar. Existe só como sugestão em `02` §5.3 (preview de 60 s) e não foi incorporado |
| 8 | Gráficos no painel do cliente | `02` §6.3 (VictoriaMetrics); `03` D9 | **Parcial** | `04` §13 Q6 ainda pergunta quem armazena. E **ninguém desenhou o pipeline de "requisições"** — é a única das 5 métricas que não sai do cgroup; exige log da borda → parse → série |
| 9 | Super admin muda RAM/vCPU a quente | `04` §3.3 | **Resolvido tecnicamente, condicionado ao Achado 0.1** | (a) **reduzir RAM abaixo do uso corrente falha** — nenhum doc trata o erro nem o que a UI mostra; (b) proration na janela de resize sem regra; (c) relação com o plano contratado indefinida |
| 10 | Instalação simples de módulo + documentação | `03` §2.2 exige `docs/operator.md` e `docs/runbook.md` por módulo | **Não tratado** | Não existe: plano de documentação do produto, runbook de operação do nó, procedimento de desastre, nem **o bootstrap do control plane** (C18). O ADENDO §A eleva isso: *"Documentação não é opcional: é o que permite ao Tiago operar o que a IA construiu"* |
| **11** | **(ADENDO §C) Meio de pagamento como módulo plugável** | — | **Não tratado — quebrado** | Achado 5.0. Precisa de `payment.gateway v1`, `host.payments.settle()`, tipo de rota `webhook` e o teste `mod-pagamento-fake` |
| **12** | **(ADENDO §A) Front obrigatoriamente Next.js** | `03` D4 escolhe React+Vite | **Contradiz o ADENDO** | Reescrever `03` D4 e §3 para Next.js; revalidar a estratégia de UI plugável (ESM remoto + import map) sob o modelo de build do Next |
| **13** | **(ADENDO §A) Especificação executável por IA** | — | **Não tratado** | Achado 0.3. Nenhum documento tem critério de aceite testável |

---

## 9. Riscos de morte do projeto

### Achado 9.1 — Os cinco cenários que encerram o VelozPanel

**Severidade: Bloqueador** (D1 em especial)

| # | Cenário | Prob. em 24 meses | Impacto | Mitigação obrigatória |
|---|---|---|---|---|
| **D1** | **As VPS não suportam a arquitetura** (container-based, sem cgroup delegado, sem userns) e isso só é descoberto depois de meses de construção | **Alta (40%) até rodar o diagnóstico; ~0% depois** | Terminal — reescrita completa | **Achado 0.1: rodar `veloz-node-doctor.sh` hoje.** É a mitigação mais barata e mais valiosa de todo o Ciclo 1 |
| **D2** | **O plano é construído inteiro.** A IA implementa as 2.054 linhas do `03`, incluindo módulos dinâmicos, NATS, outbox e 25 tabelas, e o projeto passa 18 meses sem cliente | **Alta (50%)** | Fim do projeto por exaustão de fôlego e de interesse | Achado 0.3 + §10: **cortar do papel o que não entra no MVP**, porque com IA construtora o documento é o escopo. Congelar `Plan/05-escopo-mvp.md` assinado |
| **D3** | **Perda de dados de cliente:** backup nunca restaurado de verdade + perda de VPS (provedor pequeno, um por nó, sem SLA forte) | **Média (30%)** — e note que 3 provedores diferentes **triplicam** a exposição a um provedor ruim | Crítico, terminal | B6 antes do primeiro cliente pagante; restore automatizado semanal; **chave restic fora dos servidores** (`02` §9.2); e o que falta em todos os docs: **object lock / imutabilidade no bucket** |
| **D4** | **Comprometimento do painel ou fuga de container** → ransomware em todos os ambientes do nó (molde CyberPanel: 22.000 servidores, `02` §1.1). Agravado se o kernel estiver pinado por causa do ZFS | Baixa-Média (15%) | Crítico | Painel admin fora da internet aberta (VPN/allowlist + 2FA — `02` §7.3); **ZFS fora** (Achado 1.6) devolve o kernel atualizado; **backup imutável** transforma ransomware em incidente de 4 h |
| **D5** | **Cobrança errada em escala:** drift de metering, evento duplicado, cobrança de ambiente pausado | Média (25%) | Alto — chargeback, Procon, reputação | `03` R3 já prevê fatura sombra e chave idempotente. Somar: **B10** (< 0,5%), extrato horário visível antes da fatura, e **circuit breaker**: nenhuma fatura > 30% acima do mês anterior sai sem revisão humana |

**Bônus D6 — dependência de PSP único.** `02` §4.4 escolhe Asaas para tudo. Hospedagem é categoria de risco
elevado para adquirentes. Se o Asaas bloquear a conta, **o faturamento inteiro para**. O ADENDO §C já
resolve isso conceitualmente (pagamento como módulo) — **desde que o Achado 5.0 seja corrigido**, senão a
modularidade é de fachada e a dependência é real.

---

## 10. Cronograma — reformulado em entregas verificáveis (ADENDO §A)

### Achado 10.1 — Pessoa-mês é a métrica errada aqui; o risco é o plano ser construído inteiro

**Severidade: Bloqueador**

**Evidência.** `03` §11 lista 6 etapas em prosa, sem critério de conclusão. `04` §12 estima só manutenção.
ADENDO §A: quem constrói é a IA, sob gestão do Tiago.

**Reformulação.** Com IA construtora, o gargalo deixa de ser *horas de digitação* e passa a ser:
**(a) quantas etapas o Tiago consegue verificar** — porque código não verificado é dívida, não entrega; e
**(b) onde a especificação é vaga o bastante para a IA produzir algo plausível e errado** (Achado 0.3).

O escopo dos três documentos, se construído integralmente, são **~40 etapas verificáveis**. O MVP são
**14**. A diferença é o que precisa sair do papel.

#### MVP — 14 entregas verificáveis, em ordem de dependência

Cada etapa só é "pronta" quando o critério de aceite é executado **no nó real** e o resultado é registrado.

| # | Entrega | Critério de aceite (executável) | Onde a IA vai errar sem spec melhor |
|---|---|---|---|
| **E0** | Diagnóstico de nó | `veloz-node-doctor.sh` roda nas 2 VPS e sai 0 ou 2 | — (é o script, e ele já está esboçado) |
| **E1** | Esqueleto do monorepo | `pnpm build` gera front Next.js + CP Node + agente SEA; `npm ls --prod --all` do agente ≤ 5 pacotes | escolha de framework/ORM; **fixar no Ciclo 2, não deixar a IA escolher** |
| **E2** | Modelo de dados mínimo | migrations sobem e descem; `tenants`, `users`, `nodes`, `environments`, `plans`, `jobs`, `job_steps`, `usage_events`, `transactions`, `ledger`. **Tudo em `bigint` de centavos** | RLS: a IA cria a policy e esquece `FORCE ROW LEVEL SECURITY`; e esquece o índice com `tenant_id` à esquerda |
| **E3** | Autenticação + RBAC + auditoria | login, sessão `__Host-`, 2FA do super admin, `can(actor, permission, recurso)`; **B13 passa em todos os endpoints** | teste negativo de multi-tenant é o que a IA não escreve sozinha — **exigir no critério** |
| **E4** | Motor de jobs em Postgres | `INSERT job` → worker pega com `FOR UPDATE SKIP LOCKED` → estado transiciona; **3 cliques simultâneos em "pausar" ⇒ 1 job** | idempotência sob concorrência; exigir o teste de corrida no critério |
| **E5** | Agente + enroll + long-poll | agente instalado por 1 comando; aparece `online` no painel; heartbeat a cada 10 s; **sobrevive a 10 min de link cortado e recupera sem perder evento** | reconexão com backoff e o buffer local — a IA implementa o caminho feliz |
| **E6** | Ciclo de vida do ambiente | `create/start/stop/delete` de container Docker via agente; estado no painel bate com `docker inspect`; **T2 (p95 < 5 s)** | matriz de erro (disco cheio, imagem faltando, container zumbi) — **escrever a matriz na spec** |
| **E7** | Limites e hot-resize | `docker update --memory/--cpus` com verificação de leitura de volta; **T3, T4, T5, B8** | T5 (reduzir abaixo do uso) — a IA não trata; exigir a mensagem de erro na UI |
| **E8** | Borda + domínio + TLS | vhost gerado, `-t` validado antes do reload, certificado emitido por lego com **fila serializada**; **B5** | rate limit do ACME — exigir teste contra o CA de staging da Let's Encrypt |
| **E9** | Runtime PHP com troca de versão | select genérico via `runtime.generic`; troca 8.2→8.3 com **T6 (< 2 s)** e **rollback em 1 clique** | rollback não está em `03`/`04` — **especificar** |
| **E10** | Bancos + SFTP + terminal web | database + role criados; SFTP com chave funciona; terminal web abre; **dump horário rodando** | jump host / `docker exec` com usuário não-root; e o vazamento de `SSH_ORIGINAL_COMMAND` |
| **E11** | Backup e restore | restic por ambiente para o Magalu, chave fora do servidor, bucket com object lock; **B6 (RTO < 60 min)** | a IA implementa o backup e não o restore. **O critério é o restore, não o backup** |
| **E12** | Metering + fatura sombra | `usage_events` idempotentes; rollup horário; extrato por hora na UI; **B10 (< 0,5%)** | arredondamento e rateio — exigir casos de teste numéricos com resultado escrito |
| **E13** | Gateway de pagamento **plugável** | `mod-pagamento-fake` ponta a ponta + `mod-pagamento-asaas` real; **B12 (grep vazio)** | Achado 5.0 — sem a capability e o `host.payments.settle()`, a IA acopla o Asaas no core |
| **E14** | Documentação operacional | runbook de: nó fora do ar, restore, rotação de chave, upgrade de agente, cliente abusando. **Critério: Tiago executa cada runbook sozinho, sem perguntar** | a IA escreve documentação de API e não runbook. **Exigir o teste "Tiago executa"** |

#### O que precisa SAIR do papel (senão será construído)

| Cortar | Porque |
|---|---|
| **Sistema de módulos dinâmico** (manifesto completo, cosign, sidecar, gateway dinâmico, ESM remoto, SRI, circuit breaker, bulkhead) | `03` R2 já classifica como Alta × Alto. Fase 1 = módulos *first-party* compilados junto, **atrás das mesmas interfaces** (capability, slot de UI, task, `payment.gateway`). **Exceção: o contrato de pagamento (E13) precisa ser real desde já**, porque é requisito fechado |
| **NATS, JetStream, outbox, relay** | Conflito 4 |
| **Incus, ZFS, imagem dourada, `zfs send`** | Conflito 1 e Achado 1.6 |
| **Migração ao vivo entre nós** (`03` §5.6 `environment.migrate`, `04` §9) | ADENDO §D. Substituir por runbook: pausar → backup → restaurar no outro nó → trocar DNS |
| **Caixas postais de e-mail** | ADENDO §D e `01` §3.5. Só relay SMTP de saída |
| **DNS autoritativo (PowerDNS)** | Instruções de NS + verificação automática + push por token do cliente (`02` §10.2 já prevê o "modo DNS externo"). Ser autoritativo é responsabilidade pesada demais para o mês 1 |
| **Gerenciador de arquivos web** | SFTP + terminal web resolvem para o piloto |
| **Alta densidade, N-1, overcommit, autoscale, WAF, CDN, apps 1-click, staging, preview por PR** | ADENDO §D. Com 4–5 sistemas, otimizar densidade é literatura |
| **NFS-e** | ADENDO §C. **Mas manter no modelo de dados** os campos que uma nota exigiria: `tenants.tax_id`, endereço completo, código de serviço municipal, discriminação do item na `invoice_items`. Custa 6 colunas agora e evita uma migração dolorosa depois |

**O que é inegociável:** E11 (restore verificado), E12 (metering conferido) e o teste B13 (isolamento entre
tenants). Tudo o mais é negociável.

---

## 11. Contradições cruzadas

### Achado 11.1 — Dezoito afirmações incompatíveis

**Severidade: Alto** (o conjunto)

| # | Contradição | Onde | Resolução |
|---|---|---|---|
| C1 | **Agente roda como root × NÃO roda como root** | `03` §1.1: *"`vp-agent`... **roda como root** sob systemd"* × `04` §11.5: *"**o agente NÃO roda como root**"* | **`04` vence.** Diferença entre "agente comprometido = nó perdido" e "= allowlist". Corrigir `03` §1.1 e §1.3 |
| C2 | **`incus pause` × `incus stop`** | `03` §3 × `04` §4.1 (*"a RAM continua ocupada e **não pode ser vendida a outro cliente**"*) | **`04` vence** — e cai a justificativa do `03` para preferir Incus no requisito 4 |
| C3 | **Banco por ambiente × compartilhado** | `03` §4.1 × `04` §8.4 | Conflito 2 → **compartilhado com 4 emendas** |
| C4 | **Caddy na borda × nginx mainline** | `02` §12.2 e `03` §3 (Caddy) × `04` §0/§6.1 (nginx) | **`04` vence provisoriamente**, condicionado a B5. Com 50 vhosts o reload do nginx é trivial; se passar de 3 s, migrar para Caddy |
| C5 | **ACME pelo proxy do nó × fila controlada pelo painel** | `03` §1.6 (*"quem fala com a LE é o proxy do nó"*) e `03` §3 (elogia o ACME automático do Caddy) × `02` §11.2 (*"**nunca** ACME automático do web server"*, com o caso dos 80 subdomínios que estouraram a cota) | **`02` vence com folga.** Estourar o limite da LE trava a emissão para **todos**. `auto_https off` + fila com backoff |
| C6 | **Docker/OCI × Incus** | `02` §3.3 × `03` D5 × `04` §2.2 | Conflito 1 → **OCI + volume, sem ZFS** |
| C7 | **PostgreSQL 16 × 17** | `03` §3 × `04` §0 item 8 | Padronizar **PG 17** nos dois |
| C8 | **Sem Grafana/Loki × com Grafana/Tempo/Loki** | `02` §6.3 (*"sem cAdvisor e **sem Grafana**"*) × `03` §3 (*"Grafana lendo VictoriaMetrics e **Loki**"*) | **`02` vence para o produto.** Grafana interno para depuração é aceitável — mas então **diga que é interno**. Loki: cortar |
| C9 | **Postfix/Dovecot × Stalwart × nenhuma caixa postal** | `03` §1.1 × `02` §8.3 × `01` §3.5 | **`01` + ADENDO §D vencem**: sem caixa postal no MVP. Quando houver, **Stalwart** |
| C10 | **MinIO no CP × VPS do CP com 80 GB** | `03` §3 (*"MinIO no CP na fase 1"*) × `03` §1.2 (VPS de **80 GB**) × `02` §9.2 (Magalu) | **Incoerência numérica.** 66 ambientes × 4 GiB = 264 GiB num disco de 80 GB. E backup no CP viola a regra "off-node" do `03` §1.5. **`02` vence: Magalu desde o dia 1.** MinIO sai |
| C11 | **Overcommit 1,5× × teto de 85% de RAM alocada** | `04` §2.3 × `04` R3 | Contradição **interna ao `04`**: 1,5× de 13,5 GB = 20 GB de `MemoryMax` = 125% da RAM do nó, contra teto de 85%. Em 16 GB isso é OOM. **Vale o teto de 85% até B1** |
| C12 | **Migração "em segundos" × dump+restore do banco** | `04` §9.2 título × §9.2 passo 5 | Achado 1.4. E migração sai do MVP |
| C13 | **Kernel pinado × kernel atualizado** | `04` §1 × `04` §11.4 × `03` R5 | Achado 1.6. **Resolvido tirando ZFS** |
| C14 | **Hora cheia pelo estado × medir por minuto** | `02` §4.4 item 3 (*"se esteve *running* em qualquer momento da hora, **cobra a hora cheia**"*) × `03` §7.3 (*"granularidade: **minuto**... evita 'pausei 5 min depois e pagou uma hora'"*) | **`03` vence.** A regra do `02` fatura 3 horas cheias de quem deu start/stop 3× num dia — o oposto do argumento de venda da pausa. **Medir por minuto, exibir "por hora"** |
| C15 | **Densidade: 80–130 × 100–200 × ~22** | `04` §2.3 × `02` §3.1 × **realidade de 16 GB** (Achado 0.2) | **Ambos os documentos estão errados.** B1 substitui os dois. Nenhum documento futuro cita densidade sem citar a medição |
| C16 | **"Latência de comando = intervalo de poll"** | `03` §1.4 | **Factualmente incorreto para long-poll.** Corrigir e refazer a decisão (Conflito 4) |
| C17 | **A unidade de venda é o *site* ou o *ambiente*?** | `02` §1.3 modela pelo Enhance (*"1 container por **site**"*) × `03` §4.2 (`environments` 1:N `domains`) × briefing precifica por ambiente | **Ambiguidade de produto.** Se o cliente puser 10 sites num ambiente de R$ 35, a densidade e a margem quebram. **Decidir e escrever no briefing**: recomendo 1 ambiente = 1 site principal + aliases/subdomínios; sites adicionais são item pago |
| C18 | **O control plane não é provisionado por ninguém** | `03` §1.2 põe o CP numa VPS separada × `04` §10 (Ansible) provisiona **só os nós**; o CP não aparece em nenhuma seção do `04` | **Buraco de escopo** e requisito 10 do briefing. Falta dono do bootstrap do CP, do backup do Postgres (PITR) e do runbook de restore em 30 min que o `03` R1 promete "testado trimestralmente" |
| **C19** | **React+Vite × Next.js obrigatório** | `03` D4 e §3 × **ADENDO §A** | ADENDO vence. Reescrever `03` D4/§3 e revalidar a estratégia de UI plugável sob o build do Next |
| **C20** | **Go dos dois lados × Tiago não sabe Go** | `03` D3 × **ADENDO §A** | ADENDO vence. Conflito 3 → **Node/TS no CP, agente Node-SEA (ou .NET AOT)** |

---

## Ordem de marcha para o Ciclo 2

Numerada por precedência: **cada item depende dos anteriores.** Os itens 1–3 são pré-condição para
qualquer decisão; os itens 1–6 são pré-condição para qualquer código.

| # | O que decidir / medir / reescrever | Responsável | Entregável | Bloqueia |
|---|---|---|---|---|
| **1** | **Rodar `veloz-node-doctor.sh` nas duas VPS existentes** (Achado 0.1). Se qualquer `CRÍTICO` aparecer, trocar de VPS antes de mais nada e usar o script como critério de contratação da VPS 3 | **Linux/SRE (#4)** — hoje, 1 hora | Script versionado em `Plan/docs/` + relatório das 2 VPS | **Absolutamente tudo.** É o achado nº 1 do Ciclo 1 |
| **2** | **Refazer densidade e economia para 16 GB** (Achados 0.2, 6.1, 6.2): tabela de reserva de host, ambientes por nó, margem por cenário, ponto de ruptura, e a decisão sobre a escada de descontos e a recarga mínima | **Multi-tenancy (#5) + Billing (#6) + Dono** | Seção "Modelo econômico real" no briefing, com a planilha | Preço, planos, capacidade, decisão de investir |
| **3** | **Escrever no briefing o objetivo desta fase**: validar o produto (margem não importa por 12 meses) ou gerar renda (3 VPS de 16 GB não servem). O ADENDO §C sugere o primeiro — **tornar explícito** | **Dono** — 15 minutos | 1 parágrafo no `00-BRIEFING.md` | Todo o corte de escopo do item 8 |
| **4** | **Ratificar o Veredito do Conflito 1** (OCI + volume, **sem ZFS, sem Incus**) e reescrever `04` §1 (distro/storage), §2 (isolamento), §5.1 (imagem) e `03` D5 | **Linux/SRE (#4) + Arquiteto (#3)** | `04` §1/§2/§5.1 e `03` D5 reescritos; abstração `ambiente` no contrato do agente | Agente, imagem, runtime, backup, quota |
| **5** | **Rodar o Teste Decisivo (T0–T10) e B1, B2, B5, B8, B9** nas VPS reais, com WordPress+WooCommerce | **Linux/SRE (#4) + Multi-tenancy (#5)** | `Plan/docs/bench-ciclo2.md` com números medidos | Densidade, preço, requisitos 4 e 9 |
| **6** | **Fechar o Conflito 3**: reescrever `03` D3/D4/§3 para **Next.js + CP Node/TS + agente Node-SEA**. Rodar **B11**; se reprovar, agente em .NET AOT. Registrar a resposta do especialista Node/Next.js à pergunta do ADENDO §A | **Esp. Node/Next.js (novo) + Arquiteto (#3)** | `03` §3 reescrito + relatório de B11 com código de prova | Estrutura do repositório e todo o desenvolvimento |
| **7** | **Consertar a modularidade de pagamento** (Achado 5.0): especificar `payment.gateway v1`, `host.payments.settle()`, tipo de rota `webhook`, e o teste `mod-pagamento-fake`. Remover o acoplamento a PSP do `03` §6.3 | **Arquiteto (#3) + Billing (#6)** | `03` §2 ampliado + `Plan/modulos/pagamento.md` | Requisito fechado do ADENDO §C (E13) |
| **8** | **Congelar o escopo do MVP em 14 entregas verificáveis** (§10), com critério de aceite executável para cada uma, **e apagar do plano tudo que foi cortado** — porque com IA construtora o papel é o escopo (Achado 0.3) | **Dono + Produto/UX (#1) + Crítico** | `Plan/05-escopo-mvp.md` congelado e assinado | Todo o desenvolvimento; é a defesa contra o risco D2 |
| **9** | **Cortar NATS e outbox** (Conflito 4): reescrever `03` §1.4 e §5.1 para Postgres-como-fila + long-poll HTTPS + WebSocket retomável + remote-write autenticado + buffer de 72 h no agente. Arquivar o desenho NATS com o gatilho de reintrodução | **Arquiteto (#3)** | `03` §1.4/§5.1 reescritos + `docs/transporte-nats-adiado.md` | Motor de jobs, agente, cronograma |
| **10** | **Fechar o Conflito 2**: reescrever `03` §4.1 (retirar banco por ambiente) e `04` §8.4 (MariaDB 11, dump horário por database, tier dedicado pago, reserva de host de ~800 MB) | **Banco de Dados (#7) + Linux/SRE (#4)** | `03` §4.1 e `04` §8.4 reescritos | Densidade, backup por cliente |
| **11** | **Executar B6 (restore ponta a ponta), B10 (metering) e B13 (isolamento entre tenants)** e declarar por escrito: **nenhum cliente pagante antes dos três**. Somar **object lock/imutabilidade** no bucket (ausente em todos os documentos) | **Linux/SRE (#4) + Billing (#6) + Segurança (#9)** | Relatórios + política de imutabilidade | Primeiro cliente pagante (D3, D4, D5) |
| **12** | **Resolver as 20 contradições do Achado 11.1**, com prioridade para C1 (agente root), C5 (ACME), C10 (MinIO/80 GB), C11 (overcommit), C14 (hora × minuto), C17 (ambiente × site), C19 e C20 (ADENDO) | **Crítico** (arbitragem) + autor de cada documento | Cada documento corrigido, com changelog no topo | Consistência do Ciclo 3 |
| **13** | **Preencher os buracos dos requisitos 8, 9 e 10** (Achado 8.1): pipeline de métrica de "requisições" a partir do log da borda; regra de proration e comportamento do resize que reduz RAM abaixo do uso; **bootstrap do control plane** (C18) e plano de documentação/runbooks | **Observabilidade (#8), Billing (#6), DevOps/Instalador (#10), Documentação/DX (#11)** | Seções novas por especialista | Requisitos 8, 9 e 10 |
| **14** | **Orçar banda e egress** (Achado 6.4): cota de cada VPS, custo do backup e do restore contra ela, limite por ambiente na borda, meter `egress.gb` implementado | **Linux/SRE (#4) + Billing (#6)** | Coluna de cota em `nodes` + política de banda | Custo real e SLA |
| **15** | **Termos de Uso, AUP e Política de Privacidade** antes de qualquer cliente (`02` §13.2). Sem AUP não há respaldo para desligar quem ataca os outros. **NFS-e sai, mas o modelo de dados guarda os campos** (ADENDO §C) | **Segurança & Compliance (#9)** | 3 documentos + as 6 colunas fiscais no schema | Primeiro cliente |

### Uma frase para o dono

Os três documentos do Ciclo 1 são tecnicamente competentes — o `04` §4 (pausa), o `04` §5.3 (troca de PHP
sem downtime), o `03` §2.6 (`runtime.generic`) e o `03` §5.1 (mecânica do job) estão acima da média do que
se vê em projetos deste porte, e devem ser preservados. O problema é que **foram escritos para uma
infraestrutura que não é a sua**: 64 GB de RAM dedicada virou 16 GB de VPS, rede privada virou internet
pública, um desenvolvedor Go virou uma IA construindo em Node, e "3 servidores" virou "3 provedores
diferentes". Com isso, três decisões caras (Incus, ZFS, NATS) perdem a razão de existir, a densidade cai
5×, e a modularidade de pagamento — que é requisito fechado seu — **não funciona** com o contrato de
módulo especificado. Rode o `veloz-node-doctor.sh` hoje: é uma hora de trabalho e é o único item desta
lista que pode invalidar todos os outros.
