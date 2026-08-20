# VelozPlanel — Checklist de Execução da Construção

> Documento **vivo**. É o mapa para não me perder durante a construção. Cada item só é marcado `[x]`
> depois de **validado sem erro**. Legenda: `[ ]` pendente · `[~]` em andamento · `[x]` feito e validado ·
> `[!]` bloqueado (precisa do dono).
>
> Regra de ouro (pedido do dono): **validar cada etapa antes de dizer "ok"; se houver erro, resolver;
> só chamar o dono para testar quando tudo estiver verde.** Nada vai para produção sem passar no teste local.

Última atualização: 2026-08-20.

---

## Ambiente confirmado (2026-08-20)
- Host KVM: `server-local@192.168.2.111` — Ubuntu 22.04.5, bare metal, VT-x, /dev/kvm ✅, cgroup v2,
  libvirt+qemu+virsh+virt-install instalados. `cloud-localds` ausente. **sudo pede senha.**
- Mac local: git + ssh. GitHub SSH ✅ (`tiagoagenor`). Repo: `git@github.com:tiagoagenor/VelozPlanel.git`.
- SO alvo do projeto: **Ubuntu** (host 22.04; VMs de nó 24.04 LTS).

---

## FASE F — Fundação
- [x] F1. Repositório git local + `.gitignore` (exclui screenshots com dado de terceiro) + README
- [x] F2. Primeiro commit e push para `github.com/tiagoagenor/VelozPlanel` (main) — commit 5a5a492, verificado no remoto
- [ ] F3. Esqueleto do monorepo (pnpm workspaces): `apps/`, `packages/`, `infra/`, tooling (lint/tsconfig)
- [ ] F4. CI mínimo (typecheck + lint) — validar que roda

## FASE V — Ambiente KVM de desenvolvimento (no server-local)
- [x] V1. Validar aptidão KVM do host — bare metal, VT-x, /dev/kvm, cgroup v2 ✅
- [x] V2. Modo libvirt: usuário está no grupo `libvirt` → `qemu:///system` **sem sudo** ✅ (seed via `xorriso`)
- [~] V3. Baixar imagem cloud Ubuntu 24.04 (noble) — download em andamento (~/vp-dev/images/noble.img.part)
- [ ] V4. Criar seed cloud-init (via `xorriso` ou virt-install `--cloud-init`)
- [ ] V5. Subir VM `vp-node-1` (Ubuntu 24.04) e validar boot + SSH interno
- [ ] V6. Portar o `veloz-node-doctor.sh` para Ubuntu e rodar dentro da VM → exit 0/2
- [ ] V7. (depois) VM `vp-cp` (control plane) e `vp-node-2` para topologia de 2 nós
- [ ] V8. Rede: bridge/NAT entre as VMs; testar conectividade CP↔nó

Host reconciliado: **4 vCPU / 15 GB RAM / 98 GB (48 livres)**. VMs de dev serão enxutas (2 vCPU, 2–4 GB, disco thin).

## FASE 0 — Portões (do plano) adaptados ao dev local
- [ ] P1. node-doctor verde na VM de nó
- [ ] P2. Docker + userns-remap + quota de projeto (XFS) funcionando na VM
- [ ] P3. Medição inicial: RSS de um container ocioso, boot time (indicativo, não densidade final)

## ALVO ATUAL — "NÚCLEO RODANDO" (escolha do dono, 2026-08-20)
O dono quer testar quando estiver **tudo pronto e testado por mim** — sem marcos intermediários.
Alvo do primeiro entregável testável (roda LOCAL, no Mac, com Docker): **CONCLUÍDO E VALIDADO 2026-08-20**
- [x] N1. Monorepo pnpm (contracts, api, agent, painel) + `pnpm install` limpo + typecheck de todos OK
- [x] N2. Postgres via docker-compose (porta 5433) + schema/seed (admin@ e client@veloz.dev / veloz123, nó local)
- [x] N3. API Fastify (4000): auth, nodes, environments (criar/listar/pausar/iniciar/excluir), métricas — testado via curl
- [x] N4. Agente (4100): cria/roda/para container Docker real (php:8.3-cli) e coleta stats de cgroup — container real validado
- [x] N5. Painel Next.js (3000): login, dashboard com badges de estado (cor+ícone+texto), criar ambiente (modal),
      detalhe com 2 gráficos uPlot (CPU/RAM), preço do plano — validado no browser
- [x] N6. Fluxo ponta a ponta validado por MIM: criar (via UI) → container real serve a página → pausar (Exited 137)
      → iniciar (porta nova gravada) → gráficos preenchendo. **Bug de porta efêmera no restart: encontrado e corrigido.**
- [x] N7. Instruções de como rodar em NUCLEO-SPEC.md §"Como rodar" e no cabeçalho de apps/api/src/server.ts
- [x] N8. Push do núcleo para o GitHub (commit f3afdd5)

Correções feitas durante a validação:
- Agente: `provision`/`start` agora fazem POLL da porta efêmera (evita corrida) e o `start` devolve a NOVA porta.
- API: rota `start` grava a nova `httpPort` (senão "Abrir site" quebraria após pausar/iniciar).
- Typecheck da API: 204 no schema do DELETE + tipagem do error handler.
Pendências conhecidas do núcleo (não bloqueiam o teste): runtime Node ainda não exercido com container (só PHP);
eixo Y do gráfico de RAM com formatação a polir; auth é JWT em cookie (sem refresh) — suficiente para o núcleo.

Só depois disto: E1..E14 completos (multi-nó, billing real, módulos, SSL, backup) no server + VMs.

## FASE E — Entregas completas (do CHECKLIST-DESENVOLVIMENTO.md, E1..E14) — DEPOIS do núcleo
- [ ] E1..E14 conforme o checklist principal, migrando o núcleo para as VMs Ubuntu + 2 nós.

---

## Registro de decisões/descobertas durante o build
- 2026-08-20: SO alvo mudou para Ubuntu (ADENDO 8). Server-local validado como host KVM.
- 2026-08-20: sudo do server-local pede senha → usar `qemu:///session` para não depender de root.

## Bloqueios aguardando o dono
- (nenhum no momento)

## SUPER ADMIN — buildout completo (decisão do dono 2026-08-20)
Dono quer TODOS os módulos do super admin, um de cada vez, área distinta no mesmo app, testar só no fim.
Ondas:
- [~] SA0. Shell do admin distinto (layout/nav própria, visual diferente do cliente) + route group (admin) + AuthGuard admin
- [ ] SA1. Auditoria (tabela audit_logs + helper de registro) — base para tudo
- [ ] SA2. Dashboard da operação (KPIs reais da frota)
- [ ] SA3. Usuários/Clientes (listar, criar, suspender, ver ambientes, impersonar) — "ver usuários"
- [ ] SA4. Servidores/Nós (completo: recursos, capacidade, saúde) — expande o atual
- [ ] SA5. Rede / WireGuard (peers, status, adicionar nó) — config honesta (mesh é infra-fase)
- [ ] SA6. Ambientes da frota + alterar vCPU/RAM a quente (req. nº 9) com motivo + auditoria
- [ ] SA7. Planos e preços (CRUD) + Financeiro (receita, margem por nó, saldo baixo)
- [ ] SA8. Filas/Jobs (eventos/operações) + Módulos (catálogo) + Observabilidade (frota) + Segurança/Abuso
Cada módulo: backend + tela, typecheck+build verdes, commit. Report ao dono só no fim.
