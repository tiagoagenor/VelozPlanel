#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Gera o pdns.conf (backend gpgsql) a partir do .env do control-plane.
# A imagem powerdns/pdns-auth-49 ignora variáveis PDNS_* — a config precisa ser
# um arquivo MONTADO. Rode isto antes de `docker compose up -d pdns`.
#
#   ./gen-pdns-conf.sh          # usa ./.env
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "ERRO: .env não encontrado neste diretório." >&2; exit 1; }
set -a; . ./.env; set +a

: "${PDNS_DB_PASSWORD:?defina PDNS_DB_PASSWORD no .env}"
: "${PDNS_API_KEY:?defina PDNS_API_KEY no .env}"

HUB="${HUB_WG_IP:-10.100.0.1}"
# Sub-rede /24 da WireGuard a partir do IP do hub (ex.: 10.100.0.1 -> 10.100.0.0/24).
WG_SUBNET="$(echo "$HUB" | sed -E 's/\.[0-9]+$/.0\/24/')"
SEC="${DNS_SECONDARY_WG:-10.100.0.4}" # IP WireGuard do secundário (184)

cat > pdns.conf <<EOF
# Gerado por gen-pdns-conf.sh — backend gpgsql (Postgres do control-plane).
# NÃO versione este arquivo (contém segredos). Regenere com o script.
local-address=0.0.0.0, ::
launch=gpgsql
gpgsql-host=postgres
gpgsql-port=5432
gpgsql-dbname=${PDNS_DB_NAME:-pdns}
gpgsql-user=${PDNS_DB_USER:-pdns}
gpgsql-password=${PDNS_DB_PASSWORD}
api=yes
api-key=${PDNS_API_KEY}
webserver=yes
webserver-address=0.0.0.0
webserver-port=8081
webserver-allow-from=127.0.0.1,172.16.0.0/12,${WG_SUBNET}
primary=yes
secondary=no
allow-axfr-ips=127.0.0.1,${SEC}
also-notify=${SEC}
default-soa-content=${DNS_NS1_HOST:-ns1.geestao.top} hostmaster.@ 1 10800 3600 604800 3600
version-string=anonymous
disable-syslog=yes
EOF
chmod 644 pdns.conf
echo "pdns.conf gerado (webserver-allow-from inclui ${WG_SUBNET}; secundário=${SEC})."
