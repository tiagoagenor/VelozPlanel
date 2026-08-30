#!/usr/bin/env bash
#
# Instalador do lado do NÓ para o produto VPS (KVM) do VelozPlanel.
# Rode COMO ROOT no nó (sp-local), após os arquivos estarem em /tmp (ou ajuste SRC).
#
#   sudo bash install-node.sh
#
# Faz: agente VPS nativo (systemd :4101) + sshpiper (SSH :2224) + Caddy (HTTP :8080).
# Idempotente. NÃO mexe no agente Docker (container) nem nos serviços existentes.
set -euo pipefail

SRC="${SRC:-/tmp}"                 # onde estão vps-agent.mjs, *.service, compose, Caddyfile
NODE_BIN="${NODE_BIN:-$(ls /home/*/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)}"
[ -x "$NODE_BIN" ] || { echo "node não encontrado; defina NODE_BIN=/caminho/para/node"; exit 1; }

echo "== diretórios =="
mkdir -p /opt/veloz-vps /etc/veloz /etc/nftables.d /var/lib/veloz-vps/{base,disks,seed,sshpiper,sshpiper-hostkeys,nft}
chmod 700 /var/lib/veloz-vps/sshpiper

echo "== isolamento nft (vp_kvm) — aplica + persiste no boot =="
if [ -f "$SRC/nftables-vp-kvm.nft" ]; then
  cp "$SRC/nftables-vp-kvm.nft" /etc/nftables.d/vp-kvm.nft
  nft -f /etc/nftables.d/vp-kvm.nft
  cp "$SRC/veloz-vps-nft.service" /etc/systemd/system/veloz-vps-nft.service
  systemctl daemon-reload
  systemctl enable --now veloz-vps-nft >/dev/null 2>&1 || true
  echo "  vp_kvm drops ativos: $(nft list table inet vp_kvm 2>/dev/null | grep -c drop)"
else
  echo "  AVISO: nftables-vp-kvm.nft não está em $SRC — isolamento NÃO aplicado (rode a FASE 0)."
fi

echo "== agente VPS nativo (systemd :4101) =="
cp "$SRC/vps-agent.mjs" /opt/veloz-vps/vps-agent.mjs
# corrige o caminho do node no unit para o encontrado aqui
sed "s#^ExecStart=.*#ExecStart=$NODE_BIN /opt/veloz-vps/vps-agent.mjs#" "$SRC/veloz-vps-agent.service" > /etc/systemd/system/veloz-vps-agent.service
# token = mesmo do agente Docker (extraído do container em execução)
TOKEN=$(docker inspect velozplanel-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^VP_INTERNAL_TOKEN=' | head -1 | cut -d= -f2-)
{ printf 'VP_INTERNAL_TOKEN=%s\n' "$TOKEN"; echo 'VPS_HTTP_PORT=8080'; echo 'VPS_NFT_DIR=/var/lib/veloz-vps/nft'; } > /etc/veloz/vps-agent.env
chmod 600 /etc/veloz/vps-agent.env
systemctl daemon-reload
systemctl enable --now veloz-vps-agent
sleep 3
echo "  agente: $(systemctl is-active veloz-vps-agent) | health: $(curl -sf http://127.0.0.1:4101/health || echo FALHOU)"

echo "== gateway SSH (sshpiper :2224) =="
docker compose -f "$SRC/docker-compose.sshpiper.yml" up -d
echo "== borda HTTP (Caddy :8080) =="
# o compose do Caddy referencia ./Caddyfile — rode a partir da pasta com o Caddyfile
cp "$SRC/Caddyfile" /opt/veloz-vps/Caddyfile
( cd /opt/veloz-vps && cp "$SRC/docker-compose.caddy.yml" ./docker-compose.caddy.yml && docker compose -f docker-compose.caddy.yml up -d )

echo "== resumo =="
ss -tlnp 2>/dev/null | grep -E ':(4101|2224|8080) ' || true
echo "OK. Agora aponte no roteador (para 192.168.2.111): 2224/tcp (SSH), 8080/tcp (HTTP), 20000-22559 tcp+udp (portas dos VPS)."
