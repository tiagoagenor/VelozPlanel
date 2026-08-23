# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Imagem BASE Node do VelozPlanel = node:<v>-slim (Debian) + git/toolchain/tools.
#   docker build -f node.Dockerfile --build-arg NODE_VERSION=22 -t velozplanel/node:22 .
# Debian (slim) evita o atrito de node-gyp/musl do Alpine e usa apt (igual ao PHP).
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim

# Essencial: git curl python3 build-essential(gcc/g++/make) + ca-certificates | tini(Recomendado)
# (bash já vem no Debian slim)
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      git curl ca-certificates python3 build-essential tini; \
    rm -rf /var/lib/apt/lists/*

# pnpm — Recomendado. corepack foi removido no Node 25+, então usa npm (universal).
RUN npm install -g pnpm || true

# Editores (pedido do dono: vim + nano em todo container).
RUN apt-get update && apt-get install -y --no-install-recommends vim nano openssh-sftp-server openssh-client \
 && rm -rf /var/lib/apt/lists/*

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║ EXTRAS — adicione aqui (ex.: vips p/ sharp, openssh-client p/ repo privado)║
# ║   apt-get update && apt-get install -y <pkg> && rm -rf /var/lib/apt/lists/*║
# ╚═══════════════════════════════════════════════════════════════════════════╝
# RUN set -eux; apt-get update; apt-get install -y --no-install-recommends SEUS_PACOTES; rm -rf /var/lib/apt/lists/*
