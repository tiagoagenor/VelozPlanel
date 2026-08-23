#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Setup (uma vez, no HOST de um nó público com Caddy nativo) do ingress por
# domínio gerenciado pelo painel.
#
# O painel (via agente) escreve blocos de vhost em /etc/caddy/managed/*.caddy.
# Um systemd path unit vigia esse diretório e recarrega o Caddy sozinho quando
# algo muda — sem admin API nem SSH da API. O Caddy emite o HTTPS (Let's Encrypt)
# automaticamente para cada domínio.
#
#   sudo bash setup-caddy-ingress.sh
# Depois, recrie o agente com o volume  -v /etc/caddy/managed:/etc/caddy/managed
# (já previsto no docker-compose.node.yml / CADDY_SITES_DIR).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CADDYFILE=/etc/caddy/Caddyfile
MANAGED=/etc/caddy/managed

command -v caddy >/dev/null || { echo "Caddy não encontrado neste host." >&2; exit 1; }

mkdir -p "$MANAGED"
chown root:caddy "$MANAGED" 2>/dev/null || true
chmod 755 "$MANAGED"

# Importa os vhosts gerenciados no Caddyfile (idempotente, no topo).
if ! grep -q "import /etc/caddy/managed" "$CADDYFILE" 2>/dev/null; then
  sed -i '1i import /etc/caddy/managed/*.caddy\n' "$CADDYFILE"
fi
# O usuário do Caddy precisa LER o Caddyfile no reload por systemd.
chown root:caddy "$CADDYFILE" 2>/dev/null || true
chmod 644 "$CADDYFILE"

# systemd path unit: recarrega o Caddy quando /etc/caddy/managed muda.
cat > /etc/systemd/system/caddy-managed-reload.path <<'UNIT'
[Unit]
Description=Reload Caddy when managed sites change
[Path]
PathModified=/etc/caddy/managed
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/caddy-managed-reload.service <<'UNIT'
[Unit]
Description=Reload Caddy (managed sites)
[Service]
Type=oneshot
ExecStartPre=/usr/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
ExecStart=/bin/systemctl reload caddy
UNIT

systemctl daemon-reload
systemctl enable --now caddy-managed-reload.path

caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null
systemctl reload caddy
echo "Ingress do Caddy pronto: escreva vhosts em $MANAGED e o Caddy recarrega sozinho."
