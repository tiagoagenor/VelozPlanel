#!/usr/bin/env bash
# Builda as imagens base do VelozPlanel. Ex.:
#   ./build-base.sh php 8.3 8.4 8.5
#   ./build-base.sh node 20 22 24 26
set -euo pipefail
KIND="${1:?uso: $0 php|node <versoes...>}"; shift
DIR="$(cd "$(dirname "$0")" && pwd)"
for V in "$@"; do
  echo "== build velozplanel/${KIND}:${V} =="
  if [ "$KIND" = "php" ]; then
    docker build -f "$DIR/php.Dockerfile" --build-arg PHP_VERSION="$V" -t "velozplanel/php:${V}" "$DIR"
  else
    docker build -f "$DIR/node.Dockerfile" --build-arg NODE_VERSION="$V" -t "velozplanel/node:${V}" "$DIR"
  fi
done
echo "OK: $KIND $*"
