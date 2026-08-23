# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# API do núcleo (Fastify 5, ESM) — rodada com tsx direto do fonte TypeScript.
# CONTEXTO DE BUILD = raiz do monorepo (pnpm workspace).
#   docker build -f apps/api/Dockerfile -t velozplanel/api:prod .
# Imagem auto-contida (não depende de `build:` no host de runtime).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ── Stage de dependências: instala o workspace inteiro (inclui tsx p/ runtime).
FROM base AS deps
# Manifestos primeiro para aproveitar cache de camadas.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY apps/painel/package.json apps/painel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Stage final: fonte + node_modules resolvidos, roda tsx (sem watch).
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 4000
# `pnpm exec` resolve o tsx hasteado na raiz do workspace.
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
