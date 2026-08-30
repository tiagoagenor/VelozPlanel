#!/usr/bin/env bash
#
# Baixa as imagens-base cloud (qcow2) usadas pelo kvm.ts para criar VPS.
# As VMs usam OVERLAY com backing nestes arquivos — não os edite/apague enquanto
# houver VMs vivas. Rode no NÓ.
#
#   sudo ./fetch-base-images.sh
#
set -euo pipefail
BASE_DIR="${VPS_BASE_DIR:-/var/lib/veloz-vps/base}"
mkdir -p "$BASE_DIR"

# slug -> URL da cloud image oficial (genericcloud, já com cloud-init).
declare -A IMAGES=(
  [ubuntu-24.04]="https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img"
  [ubuntu-22.04]="https://cloud-images.ubuntu.com/releases/22.04/release/ubuntu-22.04-server-cloudimg-amd64.img"
  [debian-12]="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2"
)

for slug in "${!IMAGES[@]}"; do
  dest="$BASE_DIR/${slug}.qcow2"
  if [[ -f "$dest" ]]; then
    echo "== $slug já existe ($dest) — pulando"
    continue
  fi
  echo "== baixando $slug -> $dest"
  curl -fSL "${IMAGES[$slug]}" -o "$dest.part"
  # normaliza para qcow2 (algumas .img vêm em raw/outro formato)
  qemu-img convert -O qcow2 "$dest.part" "$dest"
  rm -f "$dest.part"
  chmod 0644 "$dest"
  echo "   ok: $(qemu-img info --output=json "$dest" | grep -E 'virtual-size|format' | tr -d ' ,\"')"
done
echo "Concluído. Imagens em $BASE_DIR"
