#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Sobe o Caddy de BORDA do nó de casa (sp-local). SEM sudo (usa o grupo docker).
# Pré-requisitos:
#   - /etc/caddy/managed existe e é legível pelo user server-local (o agente já
#     escreve nele). Se não existir:  mkdir -p /etc/caddy/managed  (dono do dir).
#   - Este arquivo e o Caddyfile.edge estão em /opt/veloz-vps/edge/ (ou ajuste os
#     caminhos abaixo).
#   - A :443 do host está LIVRE (o veloz-vps-caddy foi parado — ver runbook).
#
# Idempotente: recria o container do zero. O volume de dados PERSISTE os certs.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

EDGE_DIR="${EDGE_DIR:-/opt/veloz-vps/edge}"
CADDYFILE="${EDGE_DIR}/Caddyfile.edge"
MANAGED="${MANAGED:-/etc/caddy/managed}"
NAME="${NAME:-veloz-edge-caddy}"

[ -f "$CADDYFILE" ] || { echo "Caddyfile.edge não encontrado em $CADDYFILE" >&2; exit 1; }
[ -d "$MANAGED" ]   || { echo "$MANAGED não existe (o agente precisa dele)"   >&2; exit 1; }

# Remove instância anterior deste container (não mexe no veloz-vps-caddy).
docker rm -f "$NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --network host \
  -v "${MANAGED}:/etc/caddy/managed:ro" \
  -v "${CADDYFILE}:/etc/caddy/Caddyfile:ro" \
  -v veloz_edge_caddy_data:/data \
  -v veloz_edge_caddy_config:/config \
  caddy:2 \
  caddy run --config /etc/caddy/Caddyfile --watch

echo "Borda no ar: $NAME (host-net, :443 TLS-ALPN, :8081 http). Logs: docker logs -f $NAME"
