#!/usr/bin/env bash
# Atualiza o container do agente velozPanel (velozplanel-agent) NO NÓ ATUAL para a
# imagem velozplanel/agent:prod, preservando ports/binds/envs do container em execução.
# Faz health check e ROLLBACK automático para a imagem anterior se falhar.
#
# Uso (como root, no nó):
#   1) Carregue a imagem nova neste nó. Ex., puxando do build host (184) pela WireGuard:
#        ssh root@10.100.0.4 'docker save velozplanel/agent:prod' | docker load
#      (ou copie o tar e: docker load < agent-prod.tar)
#   2) bash update-agent.sh
set -u
A=velozplanel-agent
IMG=velozplanel/agent:prod

command -v docker >/dev/null 2>&1 || { echo "docker não encontrado"; exit 1; }
docker inspect "$A" >/dev/null 2>&1 || { echo "container '$A' não existe neste nó"; exit 1; }
docker image inspect "$IMG" >/dev/null 2>&1 || { echo "imagem '$IMG' não carregada (faça o docker load antes — ver cabeçalho)"; exit 1; }

OLD=$(docker inspect "$A" --format '{{.Image}}')
# IP:porta onde o /health responde (usa o HostIp do bind da 4100; fallback 127.0.0.1)
WGIP=$(docker inspect "$A" --format '{{range $p,$b := .HostConfig.PortBindings}}{{if eq $p "4100/tcp"}}{{range $b}}{{.HostIp}}{{end}}{{end}}{{end}}')
[ -n "$WGIP" ] || WGIP=127.0.0.1

mapfile -t PORTS < <(docker inspect "$A" --format '{{range $p,$b := .HostConfig.PortBindings}}{{range $b}}{{if .HostIp}}{{.HostIp}}:{{end}}{{.HostPort}}:{{$p}}{{println}}{{end}}{{end}}')
mapfile -t BINDS < <(docker inspect "$A" --format '{{range .HostConfig.Binds}}{{println .}}{{end}}')
docker inspect "$A" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(VP_|AGENT_|SSH_|CADDY_|VELOZ_)' > /tmp/velozagent.env

# php.ini gerenciado por ambiente: garante o mount do diretório do host e a env,
# ADICIONANDO se o container antigo ainda não os tinha (idempotente — mesmo padrão
# de preservar as portas 2222/2223). Sem isto, a config do php.ini não persiste no
# recreate dos containers de cliente. O dir do host é criado aqui (best-effort) e,
# se faltar permissão, o próprio dockerd o cria como root ao subir o bind.
PHP_INI_BIND="/etc/veloz/php:/etc/veloz/php"
mkdir -p /etc/veloz/php 2>/dev/null || true
_hasbind=0; for b in "${BINDS[@]}"; do [ "$b" = "$PHP_INI_BIND" ] && _hasbind=1; done
[ "$_hasbind" = 1 ] || BINDS+=("$PHP_INI_BIND")
grep -q '^VELOZ_PHP_INI_DIR=' /tmp/velozagent.env || echo 'VELOZ_PHP_INI_DIR=/etc/veloz/php' >> /tmp/velozagent.env

echo "capturado: ${#PORTS[@]} portas, ${#BINDS[@]} binds, $(wc -l < /tmp/velozagent.env) envs. rollback=$OLD"

run_agent() {
  local image="$1"; local args=(-d --name "$A" --restart unless-stopped --env-file /tmp/velozagent.env)
  for p in "${PORTS[@]}"; do [ -n "$p" ] && args+=(-p "$p"); done
  for b in "${BINDS[@]}"; do [ -n "$b" ] && args+=(-v "$b"); done
  docker run "${args[@]}" "$image" >/dev/null
}

echo "recriando $A com $IMG…"
docker rm -f "$A" >/dev/null
run_agent "$IMG"
ok=0; for i in $(seq 1 8); do curl -sf "http://$WGIP:4100/health" >/dev/null 2>&1 && { ok=1; break; }; sleep 2; done
if [ "$ok" = 1 ]; then
  echo "OK — agente novo saudável em $WGIP:4100"
else
  echo "FALHOU o health — revertendo para a imagem anterior…"
  docker rm -f "$A" >/dev/null; run_agent "$OLD"
  sleep 3; curl -sf "http://$WGIP:4100/health" >/dev/null 2>&1 && echo "rollback OK" || echo "rollback FALHOU — verifique manualmente"
fi
docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}' | grep "$A"
