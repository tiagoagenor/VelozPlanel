# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Agente (Fastify 5 + dockerode) — driver Docker dos nós de hospedagem.
# Roda com tsx direto do fonte. Monta /var/run/docker.sock em runtime para
# criar containers-irmãos dos clientes (ver deploy/node/docker-compose.node.yml).
# CONTEXTO DE BUILD = raiz do monorepo:
#   docker build -f apps/agent/Dockerfile -t velozplanel/agent:prod .
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY apps/painel/package.json apps/painel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db-console/package.json packages/db-console/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/agent/node_modules ./apps/agent/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/packages/db-console/node_modules ./packages/db-console/node_modules
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY packages/db-console ./packages/db-console
COPY apps/agent ./apps/agent

WORKDIR /app/apps/agent
EXPOSE 4100
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
