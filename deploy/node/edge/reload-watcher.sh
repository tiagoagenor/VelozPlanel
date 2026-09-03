#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Recarrega o Caddy de borda quando /etc/caddy/managed muda.
#
# POR QUÊ: `caddy run --watch` só observa o ARQUIVO de config principal
# (/etc/caddy/Caddyfile), NÃO os arquivos IMPORTADOS (managed/*.caddy). Quando o
# agente escreve um novo <sub>.jamees.top.caddy, o --watch NÃO recarrega sozinho.
# Nos nós com sudo isso é resolvido por um systemd path unit (setup-caddy-ingress.sh).
# No nó de casa (server-local, SEM sudo) usamos este watcher por polling + reload
# via `docker exec` (o user está no grupo docker → sem sudo).
#
# Rode em loop (nohup/cron @reboot) OU chame com --once por cron de 1 min.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MANAGED="${MANAGED:-/etc/caddy/managed}"
NAME="${NAME:-veloz-edge-caddy}"
STATE="${STATE:-$HOME/.veloz-edge-managed.hash}"
INTERVAL="${INTERVAL:-15}"

hash_dir() {
  # Hash estável do conteúdo (nomes + mtime + tamanho) do diretório managed.
  ls -la --full-time "$MANAGED" 2>/dev/null | sha1sum | awk '{print $1}'
}

reload_if_changed() {
  local cur last
  cur="$(hash_dir)"
  last="$(cat "$STATE" 2>/dev/null || true)"
  [ "$cur" = "$last" ] && return 0
  # Valida antes de recarregar; se inválido, não derruba a config no ar.
  if docker exec "$NAME" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    docker exec "$NAME" caddy reload --config /etc/caddy/Caddyfile \
      && echo "$(date -Is) reload ok (managed mudou)" \
      && printf '%s' "$cur" > "$STATE"
  else
    echo "$(date -Is) config inválida — reload adiado" >&2
  fi
}

if [ "${1:-}" = "--once" ]; then
  reload_if_changed
  exit 0
fi

echo "watcher de borda: polling $MANAGED a cada ${INTERVAL}s (reload via docker exec $NAME)"
while true; do
  reload_if_changed || true
  sleep "$INTERVAL"
done
