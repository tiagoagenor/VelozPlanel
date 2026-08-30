#!/usr/bin/env bash
#
# Borda pública dos VPS NO HUB (control-plane, IP público) — encaminha a faixa de portas
# dos VPS do hub -> nó (sp-local) pela WireGuard. Assim os VPS ficam acessíveis da
# internet SEM mexer no roteador de casa (o hub já é público) e SEM parar o Docker.
#
# Fluxo: cliente -> hub_publico:PORTA --(wg)--> nó:PORTA --(DNAT do nó)--> VM (ssh :22 / porta livre).
# Cada VPS tem sua PORTA de SSH dedicada (o control-plane aloca; ex.: 20000, 20021, ...).
#
#   sudo bash hub-edge.sh
#
# nft ao vivo (não reinicia Docker) + unit systemd pra reaplicar no boot. Idempotente.
set -euo pipefail
NODE="${VPS_NODE_IP:-10.100.0.3}"
RANGE="${VPS_PORT_RANGE:-20000-20500}"
PUBIF="${VPS_PUB_IF:-eth0}"

echo "== nft vps_edge: DNAT $PUBIF:$RANGE -> $NODE (via wg) + masquerade =="
nft -f - <<NFT
add table ip vps_edge
flush table ip vps_edge
table ip vps_edge {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    iifname "$PUBIF" tcp dport $RANGE dnat to $NODE
    iifname "$PUBIF" udp dport $RANGE dnat to $NODE
  }
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip daddr $NODE tcp dport $RANGE masquerade
    ip daddr $NODE udp dport $RANGE masquerade
  }
}
NFT
echo "  dnat: $(nft list table ip vps_edge | grep -c dnat)"

echo "== DOCKER-USER: libera forward hub<->nó na wg (FORWARD policy do Docker é DROP) =="
iptables -C DOCKER-USER -o wg0 -d "$NODE" -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -o wg0 -d "$NODE" -j ACCEPT
iptables -C DOCKER-USER -i wg0 -s "$NODE" -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -i wg0 -s "$NODE" -m state --state ESTABLISHED,RELATED -j ACCEPT

echo "== persistência (systemd reaplica no boot) =="
cat > /usr/local/sbin/vps-hub-edge-apply.sh <<APPLY
#!/usr/bin/env bash
set -e
nft -f - <<NFT
add table ip vps_edge
flush table ip vps_edge
table ip vps_edge {
  chain prerouting { type nat hook prerouting priority dstnat; policy accept;
    iifname "$PUBIF" tcp dport $RANGE dnat to $NODE
    iifname "$PUBIF" udp dport $RANGE dnat to $NODE
  }
  chain postrouting { type nat hook postrouting priority srcnat; policy accept;
    ip daddr $NODE tcp dport $RANGE masquerade
    ip daddr $NODE udp dport $RANGE masquerade
  }
}
NFT
iptables -C DOCKER-USER -o wg0 -d $NODE -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -o wg0 -d $NODE -j ACCEPT
iptables -C DOCKER-USER -i wg0 -s $NODE -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -i wg0 -s $NODE -m state --state ESTABLISHED,RELATED -j ACCEPT
APPLY
chmod +x /usr/local/sbin/vps-hub-edge-apply.sh
cat > /etc/systemd/system/vps-hub-edge.service <<UNIT
[Unit]
Description=VelozPlanel VPS edge forwarding (hub -> node via WireGuard)
After=network-online.target docker.service wg-quick@wg0.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/vps-hub-edge-apply.sh
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable vps-hub-edge >/dev/null 2>&1 || true

echo "== docker intacto? =="
docker ps --format '{{.Names}}' | grep -c control- || true
echo "OK. Faixa $RANGE encaminhada do hub público para o nó $NODE. Docker não foi reiniciado."
