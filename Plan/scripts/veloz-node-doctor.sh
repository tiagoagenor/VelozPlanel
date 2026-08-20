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
