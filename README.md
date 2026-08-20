# VelozPlanel

Painel de hospedagem multi-tenant próprio (PHP, Node.js e outras linguagens), inspirado no Hostoo,
para rodar em servidores próprios. Cobrança por hora de uso, painel do cliente + super admin,
arquitetura modular.

> **Status:** em construção. O planejamento completo está em [`Plan/`](Plan/) — comece por
> [`Plan/CONSOLIDACAO-E-ROADMAP.md`](Plan/CONSOLIDACAO-E-ROADMAP.md).

## Stack (decisões fechadas no planejamento)

| Camada | Tecnologia |
|---|---|
| Front-end | Next.js 16 (App Router) + Tailwind v4 + shadcn/ui |
| API | Fastify + zod → OpenAPI |
| Agente do nó | Node.js (binário SEA) |
| Banco (control plane) | PostgreSQL 17 |
| Banco (cliente) | MariaDB 11 + PostgreSQL 17 (compartilhado por nó) |
| Isolamento | Docker/OCI (userns-remap) + quota XFS |
| Borda | nginx (Caddy como plano B) |
| TLS | lego (DNS-01, wildcard, ARI) |
| Rede privada | WireGuard (mesh, admin) |
| SO alvo | **Ubuntu** (host + nós) |

## Ambiente de desenvolvimento

Tudo é desenvolvido e testado **localmente** em VMs KVM antes de ir para produção.
Ver [`Plan/docs/BUILD-EXECUCAO.md`](Plan/docs/BUILD-EXECUCAO.md).

## Estrutura

```
Plan/        Planejamento (12 docs de especialista, críticas, manuais)
infra/       Provisionamento do ambiente de dev (KVM, cloud-init)
apps/        Aplicações (painel, api, agent) — em construção
packages/    Código compartilhado (contracts, etc) — em construção
```
