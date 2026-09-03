#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DDNS do nó de casa: o IP público do WAN é DINÂMICO. Este script descobre o IP
# público atual e, QUANDO MUDA, avisa o control-plane (que atualiza
# nodes.public_host e re-aponta os A dos subs edge do nó).
#
# Roda NO nó (cron do user server-local OU container docker), SEM sudo. Fala com
# a API interna POR WIREGUARD (10.100.0.1:4000), autenticando com VP_INTERNAL_TOKEN
# — o mesmo token/URL que o container do agente já tem no env.
#
# A API identifica QUAL nó é pelo IP WG de ORIGEM da conexão (10.100.0.3), então
# o script NÃO precisa saber o próprio nodeId. Passa o IP no corpo.
#
# Env:
#   VP_API_INTERNAL_URL   ex.: http://10.100.0.1:4000   (mesmo do agente)
#   VP_INTERNAL_TOKEN     token compartilhado           (mesmo do agente)
#   STATE_FILE            onde guarda o último IP enviado (default ~/.veloz-edge-ip)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

API="${VP_API_INTERNAL_URL:-http://10.100.0.1:4000}"
TOKEN="${VP_INTERNAL_TOKEN:?defina VP_INTERNAL_TOKEN}"
STATE_FILE="${STATE_FILE:-$HOME/.veloz-edge-ip}"

# Descobre o IP público. Vários provedores para não depender de um só; todos
# devolvem só o IPv4 em texto puro.
discover_ip() {
  local ip
  for url in \
    "https://api.ipify.org" \
    "https://ifconfig.me/ip" \
    "https://ipv4.icanhazip.com" \
    "https://checkip.amazonaws.com"; do
    ip="$(curl -4 -fsS --max-time 8 "$url" 2>/dev/null | tr -d '[:space:]')" || continue
    if [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
      echo "$ip"; return 0
    fi
  done
  return 1
}

CUR="$(discover_ip)" || { echo "$(date -Is) falha ao descobrir IP público" >&2; exit 1; }
LAST="$(cat "$STATE_FILE" 2>/dev/null || true)"

if [ "$CUR" = "$LAST" ]; then
  # Sem mudança: não chama a API → não mexe em DNS → protege o rate-limit do LE.
  exit 0
fi

# Mudou (ou primeira execução): avisa o control-plane. O endpoint faz o UPDATE +
# migrateNodeSubs (re-aponta os A dos subs edge). É idempotente do lado do CP.
HTTP_CODE="$(curl -fsS -o /tmp/veloz-ddns.out -w '%{http_code}' \
  --max-time 15 \
  -X POST "$API/api/v1/internal/nodes/self/public-ip" \
  -H "x-internal-token: $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"ip\":\"$CUR\"}" || echo 000)"

if [ "$HTTP_CODE" = "200" ]; then
  printf '%s' "$CUR" > "$STATE_FILE"
  echo "$(date -Is) IP público atualizado: $LAST -> $CUR"
else
  echo "$(date -Is) CP recusou update (HTTP $HTTP_CODE): $(cat /tmp/veloz-ddns.out 2>/dev/null)" >&2
  # NÃO grava o STATE_FILE → tenta de novo no próximo ciclo.
  exit 1
fi
