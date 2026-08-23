# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Painel (Next.js 15, App Router) — build de produção `output: standalone`.
# CONTEXTO DE BUILD = raiz do monorepo (pnpm workspace):
#   docker build -f apps/painel/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=/api/v1 -t velozplanel/painel:prod .
# O NEXT_PUBLIC_API_URL é embutido no bundle em build-time (mesma origem: o
# Caddy faz o proxy de /api/* → api:4000).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ── Instala o workspace inteiro (build precisa das deps de workspace).
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY apps/painel/package.json apps/painel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Build do Next (gera apps/painel/.next/standalone).
FROM base AS build
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/painel/node_modules ./apps/painel/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/painel ./apps/painel
# Garante que a pasta public exista (standalone copia-a; hoje o app não tem uma).
RUN mkdir -p apps/painel/public \
 && pnpm --filter @velozplanel/painel... build

# ── Runtime enxuto: só o servidor standalone + assets estáticos.
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Com outputFileTracingRoot=raiz do monorepo, o standalone espelha o layout:
#   .next/standalone/apps/painel/server.js + node_modules mínimo na raiz.
COPY --from=build /app/apps/painel/.next/standalone ./
COPY --from=build /app/apps/painel/.next/static ./apps/painel/.next/static
COPY --from=build /app/apps/painel/public ./apps/painel/public

EXPOSE 3000
CMD ["node", "apps/painel/server.js"]
