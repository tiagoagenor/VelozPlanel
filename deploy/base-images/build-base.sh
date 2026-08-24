#!/usr/bin/env bash
# Builda as imagens base do VelozPlanel. Ex.:
#   ./build-base.sh php 8.3 8.4 8.5
#   ./build-base.sh node 20 22 24 26
#   ./build-base.sh python 3.11 3.12 3.13
set -euo pipefail
KIND="${1:?uso: $0 php|node|python <versoes...>}"; shift
DIR="$(cd "$(dirname "$0")" && pwd)"
for V in "$@"; do
  echo "== build velozplanel/${KIND}:${V} =="
  case "$KIND" in
    php)    docker build -f "$DIR/php.Dockerfile"    --build-arg PHP_VERSION="$V"    -t "velozplanel/php:${V}" "$DIR" ;;
    python) docker build -f "$DIR/python.Dockerfile" --build-arg PYTHON_VERSION="$V" -t "velozplanel/python:${V}" "$DIR" ;;
    *)      docker build -f "$DIR/node.Dockerfile"   --build-arg NODE_VERSION="$V"   -t "velozplanel/node:${V}" "$DIR" ;;
  esac
done
echo "OK: $KIND $*"
