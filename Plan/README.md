# VelozPanel — Planejamento

Painel de hospedagem multi-tenant (PHP, Node.js e outras linguagens), inspirado no Hostoo,
para rodar em 2–3 servidores próprios. Cobrança por hora, painel do cliente + super admin,
arquitetura modular.

## Como este planejamento foi feito

Método: **4 ciclos de `planejar → criticar`**, com um painel de especialistas dedicados por área.
Cada ciclo produz documentos novos e revisa os anteriores com base nas críticas do ciclo anterior.

| Ciclo | Planejamento | Crítica |
|---|---|---|
| 1 | Produto/UX, Pesquisa de mercado, Arquitetura, Linux/Infra | Crítica 1 — viabilidade e furos de escopo |
| 2 | Multi-tenancy/Isolamento, Billing por hora, Bancos de dados, Observabilidade | Crítica 2 — consistência entre áreas |
| 3 | Segurança, Sistema de módulos + instalador, API/Agente, Documentação/DX | Crítica 3 — red team operacional |
| 4 | Consolidação: roadmap, custos, plano de execução | Crítica 4 — revisão final "isso é construível?" |

## Elenco de especialistas

| # | Especialista | Responsabilidade |
|---|---|---|
| 1 | Produto & UX | Inventário funcional do Hostoo, telas do cliente e do admin |
| 2 | Pesquisa de Mercado & Tecnologia | Concorrentes, estado da arte, o que mais incluir |
| 3 | Arquiteto de Software | Control plane × data plane, módulos, dados, jobs |
| 4 | Linux / SRE | Isolamento, cgroups, runtimes multi-versão, rede, storage |
| 5 | Multi-tenancy & Orquestração | Densidade, limites, migração entre nós, pausar/iniciar |
| 6 | Billing & Metering | Cobrança por hora, saldo, Pix, faturas, inadimplência |
| 7 | Banco de Dados | MySQL + PostgreSQL multi-tenant, backup, performance |
| 8 | Observabilidade | Métricas, gráficos do painel, alertas, logs |
| 9 | Segurança & Compliance | Isolamento real, abuso, LGPD, Marco Civil |
| 10 | DevOps / Instalador | Instalação de módulos, bootstrap de nó, upgrades |
| 11 | Documentação & DX | Manuais de operação para o dono, runbooks |
| 12 | Crítico / Red Team | Ataca cada ciclo procurando erros e otimismo |

## Estrutura de arquivos

```
Plan/
├── README.md                 # este arquivo
├── 00-BRIEFING.md            # requisitos originais (fonte de verdade)
├── hostoo/                   # 26 screenshots do concorrente
├── especialistas/            # saída de cada especialista, por ciclo
├── criticas/                 # relatórios de crítica de cada ciclo
├── modulos/                  # especificação de cada módulo
└── docs/                     # documentação operacional final
```
