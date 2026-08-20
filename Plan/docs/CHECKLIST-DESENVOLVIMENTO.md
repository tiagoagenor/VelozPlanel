# CHECKLIST DE DESENVOLVIMENTO — VelozPanel

> **Última atualização:** 20/08/2026
> **Ciclo de planejamento:** produzido no **Ciclo 2**, com base no `00-BRIEFING.md` (+ ADENDO 1 e ADENDO 2),
> na `criticas/ciclo-1-critica.md` (14 entregas verificáveis, benchmarks B0–B13, T0–T10) e em
> `especialistas/05-nodejs-nextjs.md` (22 decisões fechadas, medições M1–M12).
> **Status do documento:** **VIVO — INCOMPLETO POR DESENHO.**
> Os **Ciclos 3 e 4 vão acrescentar itens** (Segurança & Compliance, Sistema de Módulos/Instalador,
> API/Agente, Documentação/DX, Acessibilidade, e a consolidação de roadmap/custos). Nenhuma seção aqui
> está fechada; o que estiver marcado `⚠️ PENDENTE` está listado na seção 10.

> ## ⛔ AVISO DE ESCOPO — LEIA ANTES DE QUALQUER COISA
> Este documento é **artefato de planejamento**, não autorização para começar.
> Conforme ADENDO 2 §F: **nenhuma linha de código de produção pode ser escrita enquanto o planejamento
> não for aprovado pelo dono** (item **P0.9** da Fase 0).
> Até lá, só é permitido: rodar scripts de diagnóstico, executar benchmarks/medições e escrever documento.

---

## Índice

1. [Como usar este checklist](#1-como-usar-este-checklist)
2. [FASE 0 — Portões que bloqueiam tudo](#2-fase-0--portões-que-bloqueiam-tudo)
3. [Fundações do repositório](#3-fundações-do-repositório)
4. [Checklist por entrega (E1–E14)](#4-checklist-por-entrega-e1e14)
5. [Checklists transversais (valem para TODA entrega)](#5-checklists-transversais-valem-para-toda-entrega)
6. [Definição de Pronto (DoD)](#6-definição-de-pronto-dod)
7. [Portões de qualidade do CI](#7-portões-de-qualidade-do-ci)
8. [O que NÃO fazer no MVP](#8-o-que-não-fazer-no-mvp)
9. [Rastreabilidade requisito → entrega](#9-rastreabilidade-requisito--entrega)
10. [Registro de decisões pendentes](#10-registro-de-decisões-pendentes)

---

## 1. Como usar este checklist

### 1.1 Legenda de status

| Marca | Significado |
|---|---|
| `- [ ]` | **Não feito.** Estado inicial de tudo. |
| `- [x]` | **Pronto** — o critério de aceite foi **executado** e a evidência está registrada. |
| `🔬` | Item de **medição/benchmark**: exige número medido, não estimativa. |
| `⛔` | **Portão bloqueador**: nada depois dele começa enquanto não passar. |
| `⚠️ PENDENTE` | Depende de decisão que ainda não foi tomada (ver seção 10). Não pode ser implementado "por bom senso". |
| `🔒 INEGOCIÁVEL` | Não pode ser adiado, negociado, nem "resolvido depois". |

### 1.2 O que significa "pronto"

Um item está pronto quando as **cinco** condições valem ao mesmo tempo:

1. O **critério de aceite executável** foi rodado — o comando, o teste ou a medição — e **passou**.
2. A **evidência** está registrada: saída do comando, número medido, ou link do run de CI, colada em
   `Plan/docs/evidencias/<ID-do-item>.md`.
3. Os **checklists transversais** da seção 5 foram aplicados ao que mudou (segurança, a11y, performance,
   observabilidade, documentação, modularidade, multi-tenant).
4. A **documentação de operação** correspondente existe e está atualizada (seção 5.5).
5. O **DoD** da seção 6 passa integralmente.

**"Implementei e parece funcionar" não é pronto.** Se o critério de aceite não foi executado, o item está
em branco. Se o critério de aceite não é executável por quem não escreveu o código, o critério está errado
e precisa ser reescrito **antes** de a entrega começar.

### 1.3 Quem marca a caixinha

| Papel | Poder |
|---|---|
| **A IA (Claude)** — constrói | Propõe o item como pronto, anexando a evidência. **Não marca a caixinha.** |
| **O dono (Tiago)** — verifica e opera | **É o único que marca `- [x]`.** Marca depois de rodar o critério de aceite **ele mesmo**, no ambiente real. |
| **CI** | Reprova automaticamente (seção 7). Um item cujo CI está vermelho não pode ser proposto como pronto. |

Regra derivada do ADENDO 1 §A: *código não verificado é dívida, não entrega.* Se o dono não consegue
executar o critério de aceite sozinho, a entrega **não terminou** — falta documentação (E14).

### 1.4 Regra de avanço

> **Nada avança sem o critério de aceite passar.**

- Entregas são **sequenciais por dependência** (E1 → E14). Pular ordem exige decisão escrita do dono.
- Um `⛔` reprovado **para a fila inteira** — não se contorna, não se "deixa para depois".
- Reprovação em benchmark **reabre a decisão correspondente** do plano; não se contorna a decisão.
  (Ex.: B11 reprovado ⇒ agente vira .NET AOT — não "otimiza o Node depois".)
- **Nenhum cliente pagante** antes de **B0, B6, B10 e B13** passarem. 🔒 INEGOCIÁVEL

---

## 2. FASE 0 — Portões que bloqueiam tudo

> Custo total estimado: 1 semana de spike (medições) + 1 hora do diagnóstico.
> **Nenhum item da seção 3 em diante pode começar enquanto esta seção não estiver 100% marcada.**

### 2.1 P0.1 — ⛔🔒 Diagnóstico de aptidão dos nós (E0 / B0 / M1 / Achado 0.1 / Risco D1)

Objetivo: provar que as VPS conseguem rodar a arquitetura **antes** de qualquer código.

- [ ] **P0.1.1** `Plan/scripts/veloz-node-doctor.sh` revisado e versionado (já existe esboço).
- [ ] **P0.1.2** Script executado na **VPS 1** (6 vCPU / 16 GB / 200 GB NVMe) com `sudo bash veloz-node-doctor.sh --json`.
- [ ] **P0.1.3** Script executado na **VPS 2** (8 vCPU / 16 GB).
- [ ] **P0.1.4** Relatório das duas VPS salvo em `Plan/docs/evidencias/P0.1-node-doctor.md` (saída completa, não resumo).
- [ ] **P0.1.5** 🔬 **Critério numérico de aprovação:** `exit code` **0 ou 2**, com **zero linhas `[CRÍTICO]`** em cada nó.
- [ ] **P0.1.6** Confirmado item a item: `systemd-detect-virt` ∈ {kvm, qemu, xen, none}; `/proc/vz` e
      `/proc/user_beancounters` **ausentes**; kernel ≥ 5.10; `cgroup2fs`; controllers `cpu`, `memory`, `io`, `pids`
      presentes; **escrita em `memory.max` e `cpu.max` funciona**; `user.max_user_namespaces > 0`;
      `unshare --user` e `unshare --net` funcionam; `modprobe overlay` permitido.
- [ ] **P0.1.7** O script vira **critério de contratação da VPS 3**: escrito no processo de compra que a VPS 3
      só é paga depois de sair 0 ou 2.

**Se reprovar (qualquer `[CRÍTICO]`):**
- [ ] **P0.1.8** ⛔ **Parar tudo.** Não escrever código, não seguir para P0.2.
- [ ] **P0.1.9** Registrar qual verificação reprovou e em qual nó.
- [ ] **P0.1.10** Decisão do dono entre: (a) **trocar a VPS** por uma KVM no mesmo ou em outro provedor;
      (b) manter o nó apenas como **control plane** (que não precisa de cgroup delegado) e comprar outro nó
      de dados; (c) revisar a arquitetura para VM aninhada — **desaconselhado**, custa RAM que não existe.
- [ ] **P0.1.11** Após a troca, **rodar de novo** e só então marcar P0.1.5.

### 2.2 P0.2 — 🔬 Medições M1 / M2 / M3 (spike do agente, `05` §8.2)

Objetivo: provar que o agente em Node aguenta o nó real. Código de **spike descartável**, fora do repo de
produção, em `Plan/spikes/` — não é o agente definitivo.

- [ ] **P0.2.1** **M1 — a VPS é KVM?** (mesmo teste de P0.1, registrado como medição).
      **Aprovação: KVM ou equivalente com kernel próprio nos 3 nós. Reprovou → todo o resto para.** ⛔
- [ ] **P0.2.2** **M2 — RSS real do agente em Node sob carga.** Agente esqueleto (WS + 40 ambientes
      simulados + SSE de log) rodando **72 h** num nó real.
      **Aprovação: RSS estabiliza abaixo de 110 MB, sem crescimento monotônico.**
- [ ] **P0.2.3** **M3 — custo do ciclo de coleta em nó real.** 40 ambientes reais, coleta a cada 15 s,
      `monitorEventLoopDelay()`.
      **Aprovação: p99 do event loop < 50 ms **e** CPU do agente < 1% de um core.**
- [ ] **P0.2.4** 🔬 **B11 — agente sob carga combinada:** ler `memory.current` de **25 cgroups a cada 15 s**
      + **10 `docker exec` concorrentes** + **5.000 linhas/s de log**.
      **Aprovação: < 5% de 1 vCPU e RSS < 120 MB.**
- [ ] **P0.2.5** **Se M2, M3 ou B11 reprovarem:** o agente vai para **.NET 10 Native AOT** (decisão 5 do `05`).
      Registrar a decisão em ADR antes de qualquer código. **Não otimizar o Node "depois".**
- [ ] **P0.2.6** **M10 — latência CP↔nó pela internet pública.** `ping`/`mtr` por 24 h + WS mTLS com
      heartbeat de 10 s. **Aprovação: p95 < 80 ms e < 1 desconexão/hora.** Reprovou → elevar o limiar de
      `degraded` acima de 45 s e registrar o novo número.

### 2.3 P0.3 — 🔬 Teste Decisivo do runtime (T0–T10, Conflito 1)

Pré-requisito: P0.1 aprovado. Executado nas **VPS reais**, com WordPress + WooCommerce.

- [ ] **P0.3.1** **T1 / B2 — RSS ocioso por ambiente.** 10 ambientes, `memory.current` após 10 min sem tráfego.
      **Aprovação: p95 < 200 MB.** > 300 MB → cortar serviços da imagem base.
- [ ] **P0.3.2** **T2 / B3 — cold start até HTTP 200.** 30 ciclos, opcache frio.
      **Aprovação: p95 < 5 s** (requisito 4). > 5 s → `opcache.file_cache` persistente, senão UX de espera.
- [ ] **P0.3.3** **T3 — hot-resize de RAM sob carga.** `docker update --memory 2g --memory-swap 2g`,
      ler `memory.max` de volta, alocar 1,5 GB dentro. **Aprovação: vale sem restart, PID 1 inalterado.**
- [ ] **P0.3.4** **T4 — hot-resize de vCPU.** `docker update --cpus 2`. **Aprovação: idem T3.**
- [ ] **P0.3.5** **T5 — reduzir RAM abaixo do uso corrente.** **Aprovação: o erro está documentado**, com a
      mensagem que a UI vai mostrar. (Nenhum documento trata isso — vira requisito de produto de E7.)
- [ ] **P0.3.6** **T6 — troca de PHP 8.2→8.3.** **Aprovação: < 2 s de indisponibilidade.**
- [ ] **P0.3.7** **T7 — quota de disco** com `prjquota` no bind mount. **Aprovação: a escrita falha e o host não enche.**
- [ ] **P0.3.8** **T8 — dedup da imagem base.** **Aprovação: overhead < 300 MB por ambiente.**
- [ ] **P0.3.9** **T9 / B1 — densidade real.** Subir ambientes até `memory.pressure` avg60 > 20% **ou**
      p95 de TTFB > 800 ms. **Aprovação: ≥ 18 ambientes de 512 MB em 16 GB.** < 14 → refazer o modelo
      econômico (Achado 6.1) e subir o preço. **Este número substitui todas as estimativas de densidade dos docs.**
- [ ] **P0.3.10** **T10 / B8 — OOM contido.** Estourar `memory.max` de um ambiente.
      **Aprovação: nenhum outro ambiente afetado.** Vazou → **sobrevenda de RAM proibida**.
- [ ] **P0.3.11** **B9 — I/O noisy neighbor.** 1 ambiente com `fio` saturando; p95 de TTFB dos vizinhos.
      **Aprovação: degradação < 20%.** > 20% → `io.max` obrigatório por ambiente.
- [ ] **P0.3.12** **B5 — reload do proxy de borda.** 50 vhosts sintéticos, `time` do reload.
      **Aprovação: < 1 s.** > 3 s → migrar para Caddy com API JSON (resolve C4).
- [ ] **P0.3.13** Todos os números escritos em `Plan/docs/bench-ciclo2.md`. **Nenhum documento futuro cita
      densidade sem citar esta medição.**

### 2.4 P0.4 — 🔬 Medições de stack (M4–M9, M11, M12)

- [ ] **P0.4.1** **M4 — SEA ponta a ponta:** build no CI, `scp` para o nó, `systemctl start`.
      **Aprovação: binário único < 130 MB, sobe em < 1 s, zero arquivo extra no nó.**
- [ ] **P0.4.2** **M5 — RLS isola de verdade:** 2 tenants, cross-read com a role da aplicação, inclusive de
      dentro de um sidecar de módulo. **Aprovação: 0 linhas em todos os caminhos.** 🔒
- [ ] **P0.4.3** **M6 — resize a quente não reinicia nada:** 1→4 GiB com carga (`wrk`).
      **Aprovação: zero requisição perdida; `memory.max` reflete em < 2 s.**
- [ ] **P0.4.4** **M7 — pause/start dentro do alvo.** **Aprovação: pause < 2 s; start até primeiro byte < 10 s.**
- [ ] **P0.4.5** **M8 — SSE sobrevive:** 20 conexões por 30 min atravessando o nginx do CP.
      **Aprovação: zero desconexão não solicitada; RAM da API estável.**
- [ ] **P0.4.6** **M9 — uPlot com dados reais:** 4 séries × 8.640 pontos + push a cada 15 s por 8 h.
      **Aprovação: 60 FPS ao dar zoom; heap do JS cresce < 20 MB em 8 h.**
- [ ] **P0.4.7** **M11 — `next build` cabe no CI e o standalone cabe no CP.**
      **Aprovação: build < 8 min; artefato < 200 MB; `next start` estabiliza < 400 MB.**
- [ ] **P0.4.8** **M12 — injeção de comando é impossível:** fuzzing contra `velozctl()` e `renderVhost()`.
      **Aprovação: 100% rejeitado nas duas camadas (Node e helper root).** 🔒

### 2.5 P0.5 — Decisões de planejamento que precisam estar fechadas antes do código

- [ ] **P0.5.1** Modelo econômico refeito para **16 GB** (Achados 0.2, 6.1, 6.2): reserva de host, ambientes
      por nó (usando B1 medido), margem por cenário, ponto de ruptura, escada de descontos, recarga mínima.
- [ ] **P0.5.2** Objetivo desta fase escrito no briefing em 1 parágrafo: **validar o produto** (margem não
      importa por 12 meses) **ou** gerar renda. ⚠️ PENDENTE — dono, 15 minutos.
- [ ] **P0.5.3** Veredito do Conflito 1 ratificado por escrito: **OCI/Docker + volume, sem ZFS, sem Incus**;
      `04` §1/§2/§5.1 e `03` D5 reescritos.
- [ ] **P0.5.4** Conflito 2 fechado: **banco compartilhado** (MariaDB 11 + PG 17), dump horário por database,
      tier dedicado pago, reserva de host de ~800 MB.
- [ ] **P0.5.5** Conflito 3 fechado: **Next.js (front) + Fastify/Node-TS (CP) + agente Node-SEA** (ou .NET AOT
      se P0.2.5 disparar). `03` D3/D4/§3 reescritos.
- [ ] **P0.5.6** Conflito 4 fechado: **sem NATS, sem outbox** — Postgres como fila (pg-boss), WebSocket mTLS
      iniciado pelo agente, buffer local de 72 h. Desenho NATS arquivado com gatilho de reintrodução (>15 nós).
- [ ] **P0.5.7** Modularidade de pagamento consertada no papel (Achado 5.0): capability **`payment.gateway v1`**,
      **`host.payments.settle()`**, tipo de rota **`webhook`** (rawBody, auth none, rate limit, ipAllowlist),
      e o acoplamento a PSP removido do core. Documento: `Plan/modulos/pagamento.md`.
- [ ] **P0.5.8** **20 contradições do Achado 11.1 resolvidas**, com prioridade para C1 (agente não-root),
      C5 (ACME em fila do painel, `auto_https off`), C10 (MinIO fora — Magalu desde o dia 1), C11 (teto de 85%
      de RAM, sem overcommit até B1), C14 (**medir por minuto, exibir por hora**), C17 (ambiente × site),
      C19 (Next.js), C20 (Node, não Go).
- [ ] **P0.5.9** **Escopo do MVP congelado** em `Plan/05-escopo-mvp.md`, assinado, **com o que foi cortado
      apagado do plano** (seção 8 deste checklist). Defesa contra o risco D2. 🔒
- [ ] **P0.5.10** ⛔🔒 **Aprovação explícita do planejamento pelo dono**, por escrito, com data, em
      `Plan/05-escopo-mvp.md`. **É o único item que autoriza a primeira linha de código de produção**
      (ADENDO 2 §F). Sem esta assinatura, a seção 3 não começa.

---

## 3. Fundações do repositório

> Começa **somente** após P0.5.10. Nada aqui é "o produto" — é o que impede a IA de errar em silêncio.
> Corresponde à entrega **E1** e à sua infraestrutura de verificação.

### 3.1 F1 — Monorepo e workspaces

- [ ] **F1.1** `pnpm` workspaces + **Turborepo** (`pnpm-workspace.yaml`, `turbo.json`).
- [ ] **F1.2** Árvore de diretórios exatamente como `05` §6.3 (`apps/painel`, `apps/api`, `apps/worker`,
      `apps/agent`, `packages/{contracts,api-client,db,host-sdk,billing,logger,testkit}`, `modules/`, `infra/`, `docs/`).
- [ ] **F1.3** `AGENTS.md` na raiz: ordem de construção, fronteiras entre pacotes, **lista de proibições
      absolutas**, como rodar tudo.
- [ ] **F1.4** `AGENTS.md` por pacote (30–60 linhas): o que faz, **o que não pode importar**, invariantes.
- [ ] **F1.5** `apps/agent/AGENTS.md` com o catálogo de tarefas (nome, args, idempotente?, cancelável?,
      timeout, `unsafe_retry`) e as proibições: **sem root, sem `exec`, sem dependência nativa, máx. 6 deps diretas**.
- [ ] **F1.6** **Critério de aceite:** `pnpm install --frozen-lockfile && pnpm build` gera front Next.js +
      API Node + agente SEA; `npm ls --prod --all` dentro de `apps/agent` retorna **≤ 5 pacotes**.
- [ ] **F1.7** `README.md`: como subir tudo do zero **em 10 minutos**, testado por quem nunca subiu.

### 3.2 F2 — Contratos (zod → OpenAPI)

- [ ] **F2.1** `packages/contracts` em zod é a **fonte única** de entidades, requests, responses, eventos e
      erros (RFC 9457). Nenhum tipo de API definido fora dali.
- [ ] **F2.2** `openapi.json` **gerado** a partir dos contratos, **versionado no repo**.
- [ ] **F2.3** `packages/api-client` **gerado** do `openapi.json` (openapi-typescript). O painel não escreve
      tipo de API à mão.
- [ ] **F2.4** Padrões escritos em `packages/contracts/README`: nomeação de recurso/ação/erro, paginação por
      cursor, resposta **`202 + job`** para operações longas.
- [ ] **F2.5** **Critério de aceite:** `pnpm gen:openapi && git diff --exit-code openapi.json` — diff de
      OpenAPI é **obrigatório e revisado** em todo PR que mexe em contrato; drift reprova o CI.
- [ ] **F2.6** tRPC **não** é usado (decisão 8). Regra de lint proíbe a dependência.

### 3.3 F3 — Lint, tipos e regras anti-erro-de-IA

- [ ] **F3.1** `tsconfig.base.json` com `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
      `erasableSyntaxOnly`.
- [ ] **F3.2** **Biome** (lint + format) — ESLint/Prettier fora.
- [ ] **F3.3** `any` **proibido**; fronteira valida com `unknown` + zod. Regra falha o build.
- [ ] **F3.4** Regras de lint custom implementadas e testadas (cada uma com um caso que deve reprovar):
  - [ ] **F3.4.a** `no child_process.exec` e `no shell: true` 🔒
  - [ ] **F3.4.b** `execFile` sempre com `timeout` **e** `maxBuffer` explícitos
  - [ ] **F3.4.c** `no drizzle-kit push`
  - [ ] **F3.4.d** `no import db` fora de `packages/db`
  - [ ] **F3.4.e** `no fs.*Sync` fora da allowlist (`/sys`, `/proc`)
  - [ ] **F3.4.f** `no Server Action com side effect` / painel **sem** `DATABASE_URL`
  - [ ] **F3.4.g** `grep` proibitivo: nome de PSP (`asaas|stripe|mercadopago|pix`) fora de `modules/`
- [ ] **F3.5** **Critério de aceite:** `pnpm lint && pnpm typecheck` verde, **e** a suíte `lint-rules-test`
      prova que cada regra de F3.4 reprova o código que deveria reprovar.

### 3.4 F4 — ADRs e documentação de decisão

- [ ] **F4.1** `docs/adr/` com uma ADR curta e numerada por decisão fechada, cada uma com **gatilho de revisão**:
      agente em Node-SEA; sem NATS na fase 1; sem ESM remoto; Drizzle; pg-boss; better-auth; Fastify;
      OCI sem ZFS/Incus; banco compartilhado; Next.js.
- [ ] **F4.2** `docs/estados.md`: máquina de estados do **ambiente** e do **job**, em texto **e** Mermaid.
- [ ] **F4.3** **Critério de aceite:** toda decisão das 22 do `05` §7 e todos os vereditos da Crítica 1 têm ADR;
      CI falha se um PR muda uma decisão sem ADR correspondente (checagem manual no template de PR até automatizar).

### 3.5 F5 — Testes (infraestrutura, não os testes de cada entrega)

- [ ] **F5.1** Unidade: `node:test` + `tsx`. **Cobertura ≥ 90%** em `apps/agent/src/collect` e `packages/billing`.
- [ ] **F5.2** Contrato de API: Vitest + `supertest` contra o app Fastify real. **Toda rota do OpenAPI tem
      ≥ 1 teste de sucesso e ≥ 1 de `403`.**
- [ ] **F5.3** **RLS**: Vitest + Testcontainers com Postgres real; 2 tenants; cross-read espera **0 linhas**. 🔒
- [ ] **F5.4** Migrations: CI aplica todas num banco vazio **e** num dump anonimizado.
- [ ] **F5.5** Integração do agente: VM de teste / nó de staging com suíte `agent-e2e`
      (criar, pausar, resize, trocar runtime, destruir).
- [ ] **F5.6** Fuzzing de injeção contra `velozctl()` e `renderVhost()` (`;`, `$( )`, `\n`, `` ` ``).
- [ ] **F5.7** Chaos de módulo: derrubar cada módulo e verificar que login, listar, pause e billing continuam.
- [ ] **F5.8** E2E do painel: Playwright, ~10 fluxos (criar ambiente, pausar, resize, trocar PHP, log ao vivo, gráfico).
- [ ] **F5.9** `packages/testkit`: Testcontainers, fábricas de tenant/ambiente, helpers de RLS.
- [ ] **F5.10** **Critério de aceite:** `pnpm test` roda tudo do zero numa máquina limpa, sem passo manual.

### 3.6 F6 — CI/CD

- [ ] **F6.1** `.github/workflows/ci.yml`: typecheck, biome, testes, migrations, RLS, `openapi-diff`.
- [ ] **F6.2** `.github/workflows/build-agent.yml`: SEA linux-x64 + `sha256` + assinatura.
- [ ] **F6.3** `.github/workflows/deploy-cp.yml`: build do painel + artefato standalone + deploy.
- [ ] **F6.4** **Build acontece no CI, nunca no VPS** (decisão 20). Deploy = artefato + `systemctl restart`.
- [ ] **F6.5** Hash do SEA **verificado no nó** antes de instalar.
- [ ] **F6.6** **Critério de aceite:** um PR de teste que viola cada portão da seção 7 é **reprovado** pelo CI.

### 3.7 F7 — Ambiente de desenvolvimento

- [ ] **F7.1** `infra/compose/` sobe Postgres 17, MariaDB 11 e VictoriaMetrics locais.
- [ ] **F7.2** `.env.example` completo, com comentário por variável. Nenhum segredo real no repo.
- [ ] **F7.3** Seeds: tenant de teste, 2 usuários, 1 nó fake, 2 ambientes.
- [ ] **F7.4** Nó de **staging** (VM ou VPS barata) para `agent-e2e` — não testar no nó de produção.
- [ ] **F7.5** **Critério de aceite:** `pnpm dev` sobe painel + API + worker + agente fake, e o login funciona,
      em máquina limpa, seguindo só o README.

### 3.8 F8 — Versionamento e política de commits

- [ ] **F8.1** Branch protegida (`main`), merge só por PR com CI verde.
- [ ] **F8.2** **Commits pequenos por fatia vertical**: contrato → API → UI → teste, num PR só.
      **Proibido** "todo o back, depois todo o front".
- [ ] **F8.3** Conventional commits + PR template com: entrega (E*), critério de aceite executado,
      evidência, e os 7 checklists transversais da seção 5.
- [ ] **F8.4** API versionada em `/api/v1`; mudança quebrando contrato exige ADR + entrada no changelog.
- [ ] **F8.5** Migration destrutiva (`DROP`/`RENAME`) só em **PR separado**, com expand/contract, lida por humano.
- [ ] **F8.6** Lockfile congelado; `pnpm audit --prod` no CI; zero `postinstall` no agente.
- [ ] **F8.7** **Critério de aceite:** um PR que junta back+front+infra sem fatia vertical é rejeitado na revisão;
      um PR com `DROP COLUMN` junto de feature é rejeitado pelo CI.

---

## 4. Checklist por entrega (E1–E14)

> São **14 entregas** (a E0 do Cronograma da Crítica 1 é o portão P0.1 da Fase 0).
> Ordem = ordem de dependência. Cada entrega só é "pronta" quando o critério de aceite é executado
> **no nó real** e o resultado é registrado.
> A coluna "Requisitos" cita os números do `00-BRIEFING.md` (1–10) e do ADENDO (11 = pagamento plugável,
> 12 = Next.js obrigatório, 13 = spec executável por IA, 14 = padrão AAA/ADENDO 2 §E).

---

### E1 — Esqueleto do monorepo
**Objetivo:** ter um repositório que compila os três artefatos e onde a IA não consegue quebrar fronteira em silêncio.
**Requisitos:** 12, 13
**Depende de:** Fase 0 completa.

- [ ] **E1.1** Seção 3 inteira (F1–F8) concluída.
- [ ] **E1.2** Três artefatos buildam: painel Next.js standalone, API Fastify, agente SEA.
- [ ] **E1.3** Framework e ORM **fixados por ADR antes do primeiro commit** — a IA não escolhe (Fastify,
      Drizzle, pg-boss, better-auth, Tailwind v4 + shadcn/ui, TanStack, next-intl, uPlot/Recharts).
- [ ] **E1.4** `pt-BR.json` com **100% das strings desde o commit 1** (decisão 21).
- **Critério de aceite executável:**
  ```
  pnpm install --frozen-lockfile && pnpm build && pnpm lint && pnpm typecheck && pnpm test
  cd apps/agent && npm ls --prod --all | wc -l   # ≤ 5 pacotes
  ```
- **Onde a IA erra:** escolher framework/ORM sozinha; importar dependência não declarada.

---

### E2 — Modelo de dados mínimo
**Objetivo:** o schema que sustenta tudo, com isolamento por tenant no banco, não na aplicação.
**Requisitos:** 1, 2, 5, 6, 9
**Depende de:** E1.

- [ ] **E2.1** Tabelas: `tenants`, `users`, `nodes`, `environments`, `plans`, `jobs`, `job_steps`,
      `usage_events`, `transactions`, `ledger`.
- [ ] **E2.2** 🔒 **Todo valor monetário em `bigint` de centavos.** Nenhum float atravessa qualquer camada.
- [ ] **E2.3** RLS habilitada **e** `FORCE ROW LEVEL SECURITY` em toda tabela com `tenant_id`.
- [ ] **E2.4** Role da aplicação **sem** `BYPASSRLS`.
- [ ] **E2.5** Todo índice de tabela multi-tenant tem **`tenant_id` à esquerda**.
- [ ] **E2.6** Acesso só por `withTenant()` (aplica `set_config('vp.tenant_id', …, true)`); `withAdmin()` isolado e auditado.
- [ ] **E2.7** Migrations SQL geradas por `drizzle-kit generate` e **lidas por humano**. `drizzle-kit push` proibido.
- [ ] **E2.8** **6 colunas fiscais preservadas** para NFS-e futura: `tenants.tax_id`, endereço completo,
      código de serviço municipal, discriminação do item em `invoice_items` (ADENDO 1 §C).
- [ ] **E2.9** Campos que a Crítica exige guardar: `nodes.banda_cota`, estado do runtime, `provider`/`provider_ref`
      **genéricos** em `transactions`.
- **Critério de aceite executável:**
  ```
  pnpm db:migrate:up && pnpm db:migrate:down && pnpm db:migrate:up   # sobe e desce sem erro
  pnpm test packages/db                                              # inclui M5/B13 de nível de banco
  ```
  **e** o teste de RLS: 2 tenants, cross-read com a role da aplicação retorna **0 linhas em todos os caminhos**.
- **Onde a IA erra:** cria a policy e esquece `FORCE ROW LEVEL SECURITY`; esquece o índice com `tenant_id` à esquerda.

---

### E3 — Autenticação + RBAC + auditoria
**Objetivo:** ninguém vê nada de ninguém, e toda ação tem autor registrado.
**Requisitos:** 3, 9, 14
**Depende de:** E2.

- [ ] **E3.1** better-auth (**versão exata fixada**) com `twoFactor`, `apiKey` (PAT), `oidcProvider`, `organization`.
- [ ] **E3.2** Sessão em cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`.
- [ ] **E3.3** **2FA obrigatório para super admin.**
- [ ] **E3.4** Autorização própria, **permission-based**: `can(actor, permission, recurso)` chamado **no core**,
      nunca só na UI.
- [ ] **E3.5** Painel admin em hostname separado, com **VPN/allowlist de IP** (mitigação D4).
- [ ] **E3.6** Trilha de auditoria: quem, o quê, quando, de onde, resultado — para **toda** ação de escrita.
- [ ] **E3.7** Suíte de fumaça de auth no CI (R6: better-auth é biblioteca jovem).
- **Critério de aceite executável:**
  ```
  pnpm test:b13     # cliente A tenta ler recurso de B em TODOS os endpoints
  ```
  **B13: 404 em 100% dos endpoints. Qualquer `200` bloqueia o release.** 🔒
- **Onde a IA erra:** não escreve o teste **negativo** de multi-tenant sozinha — o critério exige o teste negativo.

---

### E4 — Motor de jobs em Postgres
**Objetivo:** toda operação longa é um job idempotente, observável e que não duplica sob concorrência.
**Requisitos:** 4, 7, 9
**Depende de:** E2.

- [ ] **E4.1** pg-boss; **sem Redis**; job e estado de domínio na **mesma transação**.
- [ ] **E4.2** Worker consome com `FOR UPDATE SKIP LOCKED`.
- [ ] **E4.3** Máquina de estados de job documentada em `docs/estados.md` e implementada 1:1.
- [ ] **E4.4** Chave de idempotência por job; retry com backoff; `unsafe_retry` declarado por tarefa.
- [ ] **E4.5** `job_steps` com log estruturado por passo (base do SSE de E6).
- [ ] **E4.6** Timeout e cancelamento por tarefa.
- **Critério de aceite executável:** teste de corrida — **3 cliques simultâneos em "pausar" produzem exatamente 1 job**;
  `INSERT job` → worker pega → estado transiciona → `SELECT` confirma estado final único.
- **Onde a IA erra:** idempotência sob concorrência — o teste de corrida é obrigatório no critério.

---

### E5 — Agente + enroll + long-poll
**Objetivo:** o nó aparece no painel, obedece comandos e sobrevive à internet pública.
**Requisitos:** 1, 8, 9, 10
**Depende de:** E2, E4. **Pré-requisito: P0.2 aprovado.**

- [ ] **E5.1** Instalação por **1 comando**; binário SEA único; **hash verificado** antes de instalar.
- [ ] **E5.2** 🔒 **O agente NÃO roda como root** (C1). Privilégio só via helper `velozctl` com allowlist.
- [ ] **E5.3** systemd: `MemoryMax=128M`, `Restart=always`, estado local em `node:sqlite` builtin.
- [ ] **E5.4** Transporte: **WebSocket sobre mTLS iniciado pelo agente**; fila durável em `node_commands`
      com ack e idempotência. **Sem NATS, sem outbox.**
- [ ] **E5.5** Heartbeat a cada 10 s; `degraded` conforme limiar validado em M10.
- [ ] **E5.6** Buffer local de **72 h** de eventos; reconexão com backoff exponencial + jitter.
- [ ] **E5.7** `monitorEventLoopDelay()` publicado como métrica do próprio agente (R3).
- [ ] **E5.8** Telemetria em **texto** para VictoriaMetrics (`/api/v1/import/prometheus`) — sem protobuf/snappy.
- **Critério de aceite executável:** agente instalado por 1 comando aparece `online` no painel; heartbeat a
  cada 10 s; **corta o link por 10 minutos e ele recupera sem perder nenhum evento** (contagem antes = depois).
- **Onde a IA erra:** implementa o caminho feliz; esquece backoff e buffer local.

---

### E6 — Ciclo de vida do ambiente
**Objetivo:** criar, iniciar, parar e apagar ambiente, com o painel refletindo a verdade do nó.
**Requisitos:** 1, 4
**Depende de:** E5.

- [ ] **E6.1** `create` / `start` / `stop` / `delete` de container **OCI (Docker) + volume** — sem Incus, sem ZFS.
- [ ] **E6.2** `stop` real (não `pause`): **a RAM é devolvida e pode ser vendida a outro cliente** (C2).
- [ ] **E6.3** Página 503 amigável no ambiente pausado; opção "acordar ao receber visita" documentada.
- [ ] **E6.4** Estado no painel **bate com `docker inspect`**; reconciliação periódica.
- [ ] **E6.5** 🔒 **Matriz de erro escrita na spec antes de codar:** disco cheio, imagem faltando, container
      zumbi, nó offline, volume órfão — cada um com mensagem de UI e ação de recuperação.
- [ ] **E6.6** Log ao vivo do job por **SSE servido pelo Fastify** (não pelo Next), com `Last-Event-ID`,
      heartbeat de 15 s, `X-Accel-Buffering: no`, backpressure e lista virtualizada.
- **Critério de aceite executável:** `create/start/stop/delete` pelo painel; `docker inspect` confere em 100%
  das transições; **T2: p95 de cold start até HTTP 200 < 5 s** em 30 ciclos.
- **Onde a IA erra:** não trata a matriz de erro — ela precisa estar escrita antes.

---

### E7 — Limites e hot-resize
**Objetivo:** super admin muda RAM e vCPU a quente, sem derrubar o cliente.
**Requisitos:** 9
**Depende de:** E6.

- [ ] **E7.1** `docker update --memory/--memory-swap/--cpus` com **leitura de volta** (`memory.max`, `cpu.max`) e
      confirmação antes de declarar sucesso.
- [ ] **E7.2** **T5 tratado:** reduzir RAM abaixo do uso corrente **falha com mensagem explícita na UI**
      ("o ambiente está usando X MB; pause antes de reduzir para Y MB").
- [ ] **E7.3** Teto de **85% de RAM alocada por nó**; **sem overcommit** até B1 aprovar (C11).
- [ ] **E7.4** `io.max` por ambiente se B9 tiver reprovado.
- [ ] **E7.5** Toda alteração de limite gera auditoria + evento de billing (proration ⚠️ PENDENTE — ver 10).
- **Critério de aceite executável:** **T3, T4** (limite novo vale sem restart, PID 1 inalterado, throughput medido),
  **T5** (erro documentado e exibido), **B8** (OOM de um ambiente não afeta nenhum outro).
- **Onde a IA erra:** não trata T5; declara sucesso sem ler o valor de volta.

---

### E8 — Borda + domínio + TLS
**Objetivo:** o site do cliente responde no domínio dele, com HTTPS, sem derrubar os vizinhos.
**Requisitos:** 1, 3
**Depende de:** E6.

- [ ] **E8.1** vhost gerado por template; **`nginx -t` validado antes de todo reload**; debounce de 2 s;
      `worker_shutdown_timeout 30s` (R7).
- [ ] **E8.2** 🔒 **ACME nunca automático pelo web server** (`auto_https off`) — C5. Emissão por **`lego`,
      em fila serializada controlada pelo painel**, com backoff.
- [ ] **E8.3** Verificação de DNS antes de pedir certificado; instruções de NS + push por token do cliente
      (**DNS autoritativo está fora do MVP**).
- [ ] **E8.4** `renderVhost()` blindado contra injeção (M12).
- [ ] **E8.5** Alarme se houver **mais de 3 reloads por minuto**.
- **Critério de aceite executável:** **B5** — 50 vhosts sintéticos, `time` do reload **< 1 s**;
  emissão testada **contra o CA de staging da Let's Encrypt** sem estourar rate limit;
  `curl -I https://dominio-do-cliente` retorna 200 com certificado válido.
- **Onde a IA erra:** ignora o rate limit do ACME — exigir o teste contra staging.

---

### E9 — Runtime PHP com troca de versão
**Objetivo:** o cliente troca a versão da linguagem sozinho, e desfaz em 1 clique se quebrar.
**Requisitos:** 1, 7
**Depende de:** E6, E8.

- [ ] **E9.1** Contrato `runtime.generic` implementado (a mesma interface serve PHP, Node e futuras linguagens).
- [ ] **E9.2** `mod-php` e `mod-node` como módulos **first-party**, atrás da interface.
- [ ] **E9.3** Troca por **blue/green de pool**, sem downtime perceptível.
- [ ] **E9.4** 🔒 **Rollback em 1 clique** (não está em `03`/`04` — é requisito novo desta entrega).
- [ ] **E9.5** Cada cliente numa versão diferente, simultaneamente (requisito 7).
- [ ] **E9.6** Job "atualizar base instalada" previsto: versão nova alcança ambientes **existentes**, não só novos
      (buraco do requisito 1, Achado 1.2).
- **Critério de aceite executável:** trocar 8.2→8.3 pelo painel com **T6: < 2 s de indisponibilidade** medida
  em requisições com erro; rollback em 1 clique volta ao estado anterior e o site responde 200.
- **Onde a IA erra:** não implementa rollback — precisa estar especificado.

---

### E10 — Bancos + SFTP + terminal web
**Objetivo:** o cliente consegue trabalhar no ambiente dele sem ticket.
**Requisitos:** 1, 6
**Depende de:** E6.

- [ ] **E10.1** **MySQL/MariaDB 11 e PostgreSQL 17 compartilhados** (não banco por ambiente): database + role
      criados por ambiente, com senha entregue uma vez.
- [ ] **E10.2** Reserva de host de ~800 MB para os SGBDs contabilizada na capacidade do nó.
- [ ] **E10.3** **Dump horário por database** rodando e verificado.
- [ ] **E10.4** SFTP com **chave**, usuário não-root, chroot no ambiente.
- [ ] **E10.5** Terminal web com usuário não-root; `SSH_ORIGINAL_COMMAND` **não vaza**; sem `docker exec` como root.
- [ ] **E10.6** Cota de disco por ambiente ativa (`prjquota`, T7).
- **Critério de aceite executável:** criar ambiente → database e role existem (`SHOW DATABASES` / `\l`),
  cliente A **não** enxerga o database de B; `sftp -i chave` conecta e escreve; terminal web abre e roda `id`
  mostrando usuário não-root; `ls` do diretório de dumps mostra dump da última hora.
- **Onde a IA erra:** jump host e permissão do terminal; vazamento de `SSH_ORIGINAL_COMMAND`.

---

### E11 — Backup e restore 🔒 INEGOCIÁVEL
**Objetivo:** conseguir **devolver** os dados do cliente, não apenas guardá-los.
**Requisitos:** 2, 6, 10
**Depende de:** E10.

- [ ] **E11.1** `restic` por ambiente para o **Magalu Cloud** (MinIO no CP está fora — C10).
- [ ] **E11.2** 🔒 **Chave de criptografia guardada FORA dos servidores.**
- [ ] **E11.3** 🔒 **Bucket com object lock / imutabilidade** (ausente em todos os documentos; mitiga D3 e D4).
- [ ] **E11.4** Restore **automatizado** e agendado para rodar **semanalmente** em ambiente de teste.
- [ ] **E11.5** Runbook de restore escrito e executado pelo dono (entra em E14).
- [ ] **E11.6** **B7** — custo de egress do restore medido (GiB × R$ 0,10) e conferido contra a **cota de banda da VPS**.
- **Critério de aceite executável:** **B6** — apagar um ambiente real de **10 GB** (arquivos + banco),
  restaurar do Magalu e verificar **HTTP 200 + checksum idêntico**.
  **Aprovação: RTO < 60 min e RPO ≤ 1 h.** Falhou → **não vender para ninguém.** 🔒
- **Onde a IA erra:** implementa o backup e não o restore. **O critério é o restore.**

---

### E12 — Metering + fatura sombra 🔒 INEGOCIÁVEL
**Objetivo:** cobrar exatamente o que foi usado, e provar isso antes de cobrar de alguém.
**Requisitos:** 4, 5, 8
**Depende de:** E4, E6.

- [ ] **E12.1** `usage_events` **idempotentes** (chave por ambiente + janela + tipo).
- [ ] **E12.2** 🔒 **Granularidade de medição: minuto. Exibição: por hora** (C14 — `03` vence `02`).
- [ ] **E12.3** Rollup horário no Postgres; `bigint` de centavos ponta a ponta.
- [ ] **E12.4** Modelo híbrido implementado: **saldo pré-pago + débito horário + compromisso de período com desconto**;
      regras de pausa, resize e cancelamento durante compromisso pago ⚠️ PENDENTE (ver 10).
- [ ] **E12.5** **Extrato por hora visível na UI antes da fatura.**
- [ ] **E12.6** **Fatura sombra**: calcula e registra sem cobrar, por no mínimo 30 dias.
- [ ] **E12.7** 🔒 **Circuit breaker:** nenhuma fatura **> 30% acima do mês anterior** sai sem revisão humana (D5).
- [ ] **E12.8** Casos de teste numéricos de arredondamento e rateio **com o resultado esperado escrito à mão** no teste.
- [ ] **E12.9** Meter de `egress.gb` implementado (Achado 6.4).
- **Critério de aceite executável:** **B10** — 72 h, 10 ambientes com pause/start aleatórios; somar `usage_events`
  e comparar com o log de estado do runtime. **Divergência < 0,5%.** > 1% → o motor de cobrança **não vai para produção**. 🔒
- **Onde a IA erra:** arredondamento e rateio — exigir casos numéricos com resultado escrito.

---

### E13 — Gateway de pagamento plugável
**Objetivo:** trocar de PSP sem tocar no core — requisito fechado do ADENDO 1 §C.
**Requisitos:** 2, 5, 11
**Depende de:** E12. **Pré-requisito: P0.5.7 (spec do Achado 5.0) fechada.**

- [ ] **E13.1** Capability **`payment.gateway v1`** implementada com as 5 operações:
      `describe`, `create_charge`, `get_charge`, `refund`, `verify_webhook`.
- [ ] **E13.2** **`host.payments.settle()`** no core: valida, **deduplica por (provider, provider_ref, event_id)**,
      escreve `core.transactions`, credita `ledger`, emite evento de domínio.
- [ ] **E13.3** 🔒 **O módulo NÃO escreve em `core.transactions`** — devolve o fato, o core persiste.
- [ ] **E13.4** Tipo de rota **`webhook`** no manifesto: `auth: none`, **`rawBody: true`** (assinatura sobre os
      bytes originais), `rateLimit`, `ipAllowlist` opcional configurável pelo super admin.
- [ ] **E13.5** `verify_webhook` **nunca confia no corpo**: valida a assinatura do PSP antes de devolver `valid: true`.
- [ ] **E13.6** `create_charge` idempotente por `idempotency_key`; **nenhum float atravessa a interface**.
- [ ] **E13.7** Credencial do PSP via `readSecret()` — nunca em variável de ambiente do core, nunca no repo.
- [ ] **E13.8** `mod-pagamento-fake` (aprova qualquer cobrança após 3 s) **no CI**.
- [ ] **E13.9** `mod-pagamento-asaas` real funcionando — e **substituível**. Mitiga D6 (PSP único).
- [ ] **E13.10** Taxa do PSP modelada no cálculo de margem (buraco do requisito 5).
- **Critério de aceite executável:** **B12** —
  (a) fluxo completo com `mod-pagamento-fake`: *cliente recarrega saldo → cobrança criada → webhook recebido →
  saldo creditado → fatura paga*, **sem uma linha no core mencionando Asaas, Pix ou Stripe**;
  (b) `grep -rniE "asaas|stripe|mercadopago|pix" --exclude-dir=modules .` retorna **vazio**.
- **Onde a IA erra:** acopla o Asaas ao core "só para começar". O grep é o que impede.

---

### E14 — Documentação operacional
**Objetivo:** o dono opera sozinho o que a IA construiu — requisito 10 + ADENDO 1 §A.
**Requisitos:** 10, 2, 13
**Depende de:** E1–E13 (documenta o que existe).

- [ ] **E14.1** `docs/operacao/no-fora-do-ar.md`
- [ ] **E14.2** `docs/operacao/restaurar-backup.md` (o mesmo executado em B6)
- [ ] **E14.3** `docs/operacao/rotacao-de-chave.md` (restic, mTLS, PSP, sessão)
- [ ] **E14.4** `docs/operacao/upgrade-de-agente.md` (incluindo rollback do SEA)
- [ ] **E14.5** `docs/operacao/cliente-abusando.md` (identificar, limitar, suspender — depende da AUP, ⚠️ PENDENTE)
- [ ] **E14.6** `docs/operacao/agente-nao-conecta.md` e `docs/operacao/migration-falhou.md`
- [ ] **E14.7** `docs/operacao/bootstrap-do-control-plane.md` — **C18: hoje ninguém provisiona o CP**;
      inclui PITR do Postgres do CP e **restore do CP em 30 min**.
- [ ] **E14.8** `docs/modulos/CONTRATO.md`: `module.yaml` completo, slots de UI, versão do Host SDK,
      ciclo de vida, política de degradação.
- [ ] **E14.9** `docs/api/` renderizado do `openapi.json` (estático).
- [ ] **E14.10** Documentação **de instalação de cada módulo**, uma página por módulo (requisito 10).
- **Critério de aceite executável:** 🔒 **o dono executa cada runbook sozinho, do início ao fim, sem perguntar nada**,
  e registra o tempo. Runbook que precisou de pergunta **volta para correção**.
- **Onde a IA erra:** escreve documentação de API e não runbook. O critério é "Tiago executa".

---

## 5. Checklists transversais (valem para TODA entrega)

> Estes 7 blocos entram no **template de PR**. Qualquer PR pode ser cobrado por qualquer um deles.
> Um item transversal reprovado **impede o merge**, mesmo com a funcionalidade pronta.

### 5.1 Segurança (T-SEG)

- [ ] **T-SEG.1** Toda entrada externa validada por **zod na fronteira**; `unknown` antes, tipo depois. `any` proibido.
- [ ] **T-SEG.2** 🔒 Autorização verificada **no core** (`can(actor, permission, recurso)`), nunca só na UI
      nem só no gateway.
- [ ] **T-SEG.3** 🔒 `child_process.exec` e `shell: true` **banidos** — regra de lint que falha o build.
      Todo `execFile` com `timeout` e `maxBuffer` explícitos e **argumentos enumerados**.
- [ ] **T-SEG.4** 🔒 O agente **não roda como root**; privilégio só por `velozctl` com allowlist fechada.
- [ ] **T-SEG.5** Segredos: nunca no repo, nunca em log (redaction obrigatória no `packages/logger`),
      nunca em URL; `readSecret()` para credencial de módulo.
- [ ] **T-SEG.6** 🔒 **RLS testada** no que a entrega tocou: 2 tenants, cross-read = 0 linhas, **inclusive por
      dentro de sidecar de módulo**.
- [ ] **T-SEG.7** Nenhuma query fora de `withTenant()`; `withAdmin()` só onde é justificado e sempre auditado.
- [ ] **T-SEG.8** Fuzzing de injeção nas duas camadas (Node e helper root) para qualquer template ou comando novo.
- [ ] **T-SEG.9** Rate limit em toda rota pública e em todo webhook.
- [ ] **T-SEG.10** CSP definida e sem `unsafe-inline`; cookies `__Host-`/`Secure`/`HttpOnly`/`SameSite`.
- [ ] **T-SEG.11** `pnpm audit --prod` sem achado alto; lockfile congelado; zero `postinstall` no agente;
      contagem de deps transitivas do agente não cresceu (R5).
- [ ] **T-SEG.12** Painel admin permanece atrás de VPN/allowlist + 2FA (D4).

### 5.2 Acessibilidade (T-A11Y) — ADENDO 2 §E

> **AA é piso obrigatório e inegociável em 100% do painel. AAA é adotado onde é viável, com lista explícita.**
> ⚠️ A lista definitiva de critérios AAA adotados/recusados vem do **especialista de Acessibilidade no Ciclo 3**.
> A lista abaixo é a **proposta inicial** e pode ser ampliada — nunca reduzida abaixo de AA.

**Piso obrigatório — WCAG 2.2 nível AA em 100% das telas (cliente, admin e site público):**
- [ ] **T-A11Y.1** Contraste de texto **≥ 4,5:1** (≥ 3:1 para texto grande) — em tema claro **e** escuro.
- [ ] **T-A11Y.2** Contraste de componentes de UI e estados de foco **≥ 3:1** (1.4.11).
- [ ] **T-A11Y.3** 100% operável por **teclado**, sem armadilha de foco; ordem de foco lógica.
- [ ] **T-A11Y.4** **Foco visível** e não obscurecido (2.4.11 / 2.4.13 do WCAG 2.2).
- [ ] **T-A11Y.5** Alvo de toque **≥ 24×24 px** (2.5.8).
- [ ] **T-A11Y.6** Todo campo com `label` associado; erro identificado em texto, **não só por cor** (1.4.1, 3.3.1).
- [ ] **T-A11Y.7** Estrutura semântica: landmarks, hierarquia de headings, tabela com `th`/`scope`.
- [ ] **T-A11Y.8** Toda atualização assíncrona (job, gráfico, log ao vivo) anuncia via `aria-live` adequado.
- [ ] **T-A11Y.9** `lang="pt-BR"`; 100% das strings em `pt-BR.json`; nada hardcoded.
- [ ] **T-A11Y.10** Zoom até 200% e `reflow` a 320 px sem perda de conteúdo ou função (1.4.10).
- [ ] **T-A11Y.11** Respeita `prefers-reduced-motion` e `prefers-color-scheme`.
- [ ] **T-A11Y.12** Autenticação acessível (3.3.8): 2FA não exige teste cognitivo; colar no campo permitido.

**AAA adotados (viáveis para um painel) — proposta a ratificar no Ciclo 3:**
- [ ] **T-A11Y.13** **1.4.6** Contraste ampliado **7:1** para texto de corpo.
- [ ] **T-A11Y.14** **2.4.9** Finalidade do link compreensível **isoladamente** (fim de "clique aqui"/"ver").
- [ ] **T-A11Y.15** **2.4.8** Localização: breadcrumb em toda página interna.
- [ ] **T-A11Y.16** **3.3.5** Ajuda contextual em todo formulário de operação destrutiva ou irreversível.
- [ ] **T-A11Y.17** **2.2.3** Sem limite de tempo em operações do painel (exceto sessão, com aviso e extensão).
- [ ] **T-A11Y.18** **2.1.3** Teclado **sem exceção** (nenhuma função exclusiva de mouse; terminal web documentado).
- [ ] **T-A11Y.19** **2.3.3** Animação de interação desativável.
- [ ] **T-A11Y.20** **1.4.8** Apresentação visual: largura de linha, espaçamento e cor de fundo ajustáveis no conteúdo de leitura.
- [ ] **T-A11Y.21** **3.2.5** Mudança **só sob demanda** — nada de navegação automática ou refresh que rouba o foco.

**AAA recusados, com justificativa registrada** (o W3C desaconselha exigir AAA para um site inteiro):
- [ ] **T-A11Y.22** Recusa documentada e justificada de: **1.2.6** (língua de sinais), **1.2.7** (audiodescrição
      estendida), **1.2.8** (alternativa de mídia), **1.2.9** (áudio ao vivo), **1.4.9** (imagens de texto sem exceção),
      **3.1.5** (nível de leitura — vocabulário técnico de hospedagem é inerente ao domínio), **3.1.3/3.1.4**
      (glossário/abreviações — atendidos parcialmente por glossário, não integralmente).

**Referências complementares e verificação:**
- [ ] **T-A11Y.23** **eMAG** (governo brasileiro) e **LBI/Lei 13.146** citados na documentação de acessibilidade.
- [ ] **T-A11Y.24** **Critério de aceite executável:** `pnpm test:a11y` — axe-core em **todas** as rotas do painel,
      **zero violação de nível AA**; + 1 fluxo crítico por entrega navegado **só com teclado** e **com leitor de tela**
      (NVDA ou VoiceOver), com o resultado registrado.
- [ ] **T-A11Y.25** Declaração pública de acessibilidade no site, listando o nível atingido e as exceções.

### 5.3 Performance (T-PERF)

- [ ] **T-PERF.1** **Orçamento de JS:** ≤ **180 KB gzip** de JS inicial por rota do painel. Estourou → o PR não passa;
      corrigir com RSC/dynamic import, não elevando o orçamento.
- [ ] **T-PERF.2** **Core Web Vitals no verde** nas rotas principais: **LCP < 2,5 s**, **INP < 200 ms**, **CLS < 0,1**
      (medido em rede 4G simulada, não em localhost).
- [ ] **T-PERF.3** Gráfico ao vivo: **buffer circular + `chart.setData()`**; proibido `setState` acumulando array.
      Alvo M9: 60 FPS no zoom, heap +< 20 MB em 8 h.
- [ ] **T-PERF.4** **Consumo do agente:** < **5% de 1 vCPU** e **RSS < 120 MB** sob a carga de B11;
      p99 do event loop < 50 ms; RSS **não cresce monotonicamente** em 24 h (R2).
- [ ] **T-PERF.5** **RAM do painel** (Next self-hosted): `MemoryMax=512M`, alerta em RSS > 450 MB (R9);
      **RAM da API** estável sob 20 SSE por 30 min (M8).
- [ ] **T-PERF.6** **Reserva de host respeitada**: nenhuma mudança eleva o consumo fixo do nó sem recalcular a densidade.
- [ ] **T-PERF.7** Toda query nova tem plano verificado e usa índice com `tenant_id` à esquerda; sem N+1.
- [ ] **T-PERF.8** `next build` < 8 min e artefato < 200 MB (M11) — regressão reprova o CI.
- [ ] **T-PERF.9** Nenhum `*Sync` fora de `/sys` e `/proc`; nenhum trabalho pesado no event loop
      (delegar a `vector`, `restic`, `zstd`, `lego`, Postgres).

### 5.4 Observabilidade (T-OBS)

- [ ] **T-OBS.1** 🔒 **Toda ação de escrita gera: log estruturado + registro de auditoria + métrica.** Sem exceção.
- [ ] **T-OBS.2** Log em `pino`, JSON, com `tenant_id`, `actor_id`, `request_id`, `job_id` — e **redaction de segredo**.
- [ ] **T-OBS.3** Auditoria imutável: quem, o quê, quando, de onde, resultado, valores antes/depois.
- [ ] **T-OBS.4** Métrica exportada para VictoriaMetrics em texto; nome e unidade documentados.
- [ ] **T-OBS.5** Todo job publica progresso por passo (`job_steps`) e é visível ao vivo por SSE.
- [ ] **T-OBS.6** Alerta definido para o que essa entrega pode quebrar (ex.: > 3 reloads/min, agente `degraded`,
      divergência de metering, falha de backup, RSS do painel > 450 MB).
- [ ] **T-OBS.7** Métricas do requisito 8 (CPU, RAM, disco, rede **e requisições**) chegam ao painel.
      ⚠️ **"Requisições" não sai do cgroup**: exige log da borda → parse (`vector`) → série. Pipeline PENDENTE (seção 10).
- [ ] **T-OBS.8** Grafana, se usado, é **ferramenta interna de depuração** — não é o produto (C8). Loki fora.
- [ ] **T-OBS.9** **Critério de aceite:** executar a ação da entrega e mostrar as **três** evidências
      (linha de log, linha de auditoria, ponto de métrica) numa consulta só.

### 5.5 Documentação (T-DOC)

- [ ] **T-DOC.1** 🔒 **Nada é "pronto" sem a documentação de operação atualizada.**
- [ ] **T-DOC.2** Runbook novo ou atualizado em `docs/operacao/` para todo comportamento operável que a entrega criou.
- [ ] **T-DOC.3** ADR criada se a entrega tomou ou mudou uma decisão (com gatilho de revisão).
- [ ] **T-DOC.4** `docs/estados.md` atualizado se a máquina de estados mudou (texto **e** Mermaid).
- [ ] **T-DOC.5** `openapi.json` regenerado e o diff revisado; `docs/api/` reflete a versão atual.
- [ ] **T-DOC.6** `AGENTS.md` do pacote atualizado se uma fronteira ou proibição mudou.
- [ ] **T-DOC.7** Documentação em **PT-BR**, com o comando literal que o dono vai digitar — não descrição do comando.
- [ ] **T-DOC.8** **Critério de aceite:** o dono segue o documento **sem perguntar nada** e chega ao resultado.

### 5.6 Modularidade (T-MOD)

- [ ] **T-MOD.1** 🔒 **O core não conhece implementação concreta.** Ele conhece **capabilities**
      (`runtime.generic`, `payment.gateway`), nunca PHP, Asaas, Pix ou um provedor específico.
- [ ] **T-MOD.2** Módulo novo entra **atrás de uma interface existente**, ou a interface é criada primeiro.
- [ ] **T-MOD.3** Módulo tem schema próprio; **nunca** toca schema alheio. Participação em fluxo do core só por
      **Host API** (`host.payments.settle()` e equivalentes).
- [ ] **T-MOD.4** **Fase 1: módulos first-party compilados junto**, atrás das mesmas interfaces.
      **Carregamento dinâmico (sidecar, ESM remoto, cosign, gateway dinâmico) está cortado do MVP.**
      Exceção: o **contrato de pagamento** é real desde já.
- [ ] **T-MOD.5** **Teste de CI de acoplamento** (executável, roda em todo PR):
  ```
  grep -rniE "asaas|stripe|mercadopago|\bpix\b" --exclude-dir=modules --exclude-dir=node_modules . | grep -v openapi.json
  # deve retornar VAZIO
  ```
  \+ `dependency-cruiser` (ou equivalente) provando que `apps/api/src` **não importa** nada de `modules/*`
  a não ser pela interface de capability.
- [ ] **T-MOD.6** **Chaos de módulo:** derrubar cada módulo e verificar que **login, listar, pause e billing**
      continuam funcionando (degradação graciosa, card "módulo indisponível").
- [ ] **T-MOD.7** `mod-pagamento-fake` e `mod-echo` verdes no CI. Quebrou → **alguém acoplou**.
- [ ] **T-MOD.8** Cada módulo tem `docs/operator.md` e `docs/runbook.md` próprios (requisito 10).

### 5.7 Multi-tenant (T-TEN)

- [ ] **T-TEN.1** 🔒 **Todo dado tem `tenant_id`.** Tabela nova sem `tenant_id` só com justificativa escrita
      (tabela global de sistema) aprovada pelo dono.
- [ ] **T-TEN.2** RLS + `FORCE ROW LEVEL SECURITY` habilitados na tabela nova.
- [ ] **T-TEN.3** Índice com `tenant_id` **à esquerda**.
- [ ] **T-TEN.4** Acesso só por `withTenant()`; nenhuma query recebe `tenant_id` como parâmetro "de confiança"
      vindo do cliente.
- [ ] **T-TEN.5** 🔒 **Todo endpoint novo entra na suíte B13**: cliente A tenta ler/alterar recurso de B →
      **404 (não 403, para não vazar existência)**.
- [ ] **T-TEN.6** Recurso do nó (arquivo, container, database, vhost, certificado) tem dono verificado **no agente também**,
      não só na API.
- [ ] **T-TEN.7** Log e métrica carregam `tenant_id`; nenhum painel de cliente consulta série de outro tenant.
- [ ] **T-TEN.8** **Critério de aceite:** `pnpm test:b13` cobre **100% dos endpoints** do `openapi.json` —
      endpoint sem teste de isolamento **reprova o CI** (checagem de cobertura por rota).

---

## 6. Definição de Pronto (DoD)

> Vale para **qualquer** item, de qualquer entrega. Curta, dura e sem exceção.

- [ ] **DoD.1** O **critério de aceite executável** foi rodado **pelo dono**, no ambiente real, e passou.
- [ ] **DoD.2** A **evidência** (saída, número, run de CI) está em `Plan/docs/evidencias/`.
- [ ] **DoD.3** **CI verde**, incluindo todos os portões da seção 7.
- [ ] **DoD.4** **Teste negativo de multi-tenant** existe para o que a entrega criou (B13).
- [ ] **DoD.5** **Teste de RLS** verde para toda tabela tocada.
- [ ] **DoD.6** Os **7 checklists transversais** da seção 5 foram aplicados e marcados no PR.
- [ ] **DoD.7** **Documentação de operação atualizada** e executada por quem não escreveu o código.
- [ ] **DoD.8** **Nada fora do escopo** foi construído (seção 8 conferida).
- [ ] **DoD.9** **Zero `TODO`, `FIXME`, código morto ou feature flag esquecida** no que foi entregue.
- [ ] **DoD.10** **Rollback conhecido e escrito**: como desfazer esta entrega em produção.
- [ ] **DoD.11** Se a entrega tinha benchmark associado (B*/T*/M*), o **número medido** está registrado —
      não a estimativa.
- [ ] **DoD.12** O dono **marcou a caixinha**. Enquanto ele não marcar, não está pronto.

---

## 7. Portões de qualidade do CI

> O que **reprova merge automaticamente**. Nenhum destes é "aviso".

| # | Portão | Reprova quando |
|---|---|---|
| **G1** | `pnpm typecheck` | qualquer erro de tipo; `any` explícito; `strict` desligado em qualquer arquivo |
| **G2** | `pnpm lint` (Biome + regras custom) | `exec`/`shell:true`; `execFile` sem `timeout`/`maxBuffer`; `import db` fora de `packages/db`; `drizzle-kit push`; `fs.*Sync` fora da allowlist; Server Action com side effect |
| **G3** | **Teste de RLS** | qualquer cross-read retorna > 0 linhas 🔒 |
| **G4** | **Suíte B13** | qualquer endpoint responde ≠ 404 para recurso de outro tenant; **ou** existe endpoint no OpenAPI sem teste de isolamento 🔒 |
| **G5** | **`openapi-diff`** | `openapi.json` versionado difere do gerado; ou mudança quebrando contrato sem ADR |
| **G6** | **Migrations** | falham em banco vazio **ou** sobre dump anonimizado; `DROP COLUMN`/`RENAME` junto de feature |
| **G7** | **Cobertura** | < 90% em `apps/agent/src/collect` **ou** em `packages/billing` |
| **G8** | **Teste de contrato de API** | rota sem ≥ 1 teste de sucesso e ≥ 1 de `403` |
| **G9** | **Grep de acoplamento (B12)** | nome de PSP fora de `modules/`; ou `apps/api` importando módulo fora da capability 🔒 |
| **G10** | **Chaos de módulo** | derrubar um módulo quebra login, listagem, pause ou billing |
| **G11** | **Fuzzing de injeção (M12)** | qualquer payload de shell/nginx aceito por `velozctl()` ou `renderVhost()` 🔒 |
| **G12** | **axe-core (a11y)** | qualquer violação **AA** em qualquer rota do painel 🔒 |
| **G13** | **Orçamento de JS** | JS inicial > 180 KB gzip em qualquer rota |
| **G14** | **Build do painel** | `next build` > 8 min, ou artefato > 200 MB |
| **G15** | **Supply chain** | `pnpm audit --prod` com achado alto; lockfile alterado sem justificativa; `postinstall` em dependência do agente |
| **G16** | **Orçamento do agente** | > 6 dependências diretas, qualquer módulo nativo, ou `npm ls --prod --all` > 5 pacotes |
| **G17** | **Testes E2E (Playwright)** | qualquer um dos ~10 fluxos críticos quebrado |
| **G18** | **Formato monetário** | qualquer `float`/`number` representando dinheiro fora de `bigint` de centavos |

---

## 8. O que NÃO fazer no MVP

> **Regra dura para a IA construtora:** o que está aqui **não deve ser construído por iniciativa própria**,
> nem "só a interface", nem "só um esqueleto", nem "já que estou aqui".
> Fundamento: com IA construtora, **o papel é o escopo** (Achado 0.3) — e o risco D2 (o plano inteiro ser
> construído e o projeto morrer sem cliente) tem probabilidade **50%**.
> Construir algo desta lista **é motivo para reverter o PR**, mesmo funcionando.

- [ ] **N1** **Sistema de módulos dinâmico** — manifesto completo, cosign, sidecar, gateway dinâmico, ESM remoto,
      SRI, circuit breaker, bulkhead. → Fase 1 é **módulo first-party compilado junto**, atrás das mesmas interfaces.
      **Exceção única: o contrato de pagamento (E13) é real desde já.**
- [ ] **N2** **NATS, JetStream, outbox transacional, relay.** → Postgres como fila + WebSocket mTLS.
- [ ] **N3** **Incus, ZFS, imagem dourada, `zfs send`.** → OCI/Docker + volume.
- [ ] **N4** **Migração ao vivo entre nós** (`environment.migrate`). → Runbook manual: pausar → backup →
      restaurar no outro nó → trocar DNS.
- [ ] **N5** **Caixas postais de e-mail** (Postfix/Dovecot/Stalwart, webmail, antispam, listas).
      → Só **relay SMTP de saída**. Quando houver, será Stalwart.
- [ ] **N6** **DNS autoritativo (PowerDNS).** → Instruções de NS + verificação automática + push por token.
- [ ] **N7** **Gerenciador de arquivos web.** → SFTP + terminal web resolvem no piloto.
- [ ] **N8** **Alta densidade, regra N-1, overcommit, autoscale, WAF, CDN, apps 1-click, staging, preview por PR.**
- [ ] **N9** **NFS-e** e qualquer emissão fiscal. → **Mas as 6 colunas fiscais ficam no schema** (E2.8).
- [ ] **N10** **Grafana/Loki como produto.** → Grafana só interno, para depuração. Loki cortado.
- [ ] **N11** **MinIO no control plane.** → Magalu Cloud desde o dia 1 (C10).
- [ ] **N12** **Kubernetes, multi-região, service mesh, event sourcing.** Não estavam no plano e não entram.
- [ ] **N13** **Telas do Hostoo que não estão nas 14 entregas** (apps 1-click, referral, webmail, listas de e-mail,
      antispam, alias avançado). O inventário de 36 telas é **referência**, não backlog.
- [ ] **N14** **Otimização sem medição.** Nenhuma otimização entra sem um número de B*/T*/M* que a justifique.

---

## 9. Rastreabilidade requisito → entrega

> Status: `⬜ não iniciado` · `🟨 em andamento` · `✅ pronto (DoD passou)` · `⚠️ buraco conhecido`
> Atualizar esta tabela é parte do DoD de toda entrega.

| # | Requisito (briefing) | Entregas que atendem | Transversais | Status | Buraco conhecido |
|---|---|---|---|---|---|
| **1** | PHP + Node.js, aberto a outras linguagens | E5, E6, E8, E9, E10 | T-MOD | ⬜ | Job "atualizar base instalada" (E9.6) precisa existir; sem ele a versão nova só alcança ambientes novos |
| **2** | Sistema modular | E9 (`runtime.generic`), E11, E13 (`payment.gateway`), E14.8 | **T-MOD** | ⬜ | Só vale se G9/G10 estiverem verdes; carregamento dinâmico está cortado (N1) |
| **3** | Dois painéis (cliente + super admin) | E3, E6, E7, E8, E12 | T-A11Y, T-PERF | ⬜ | ⚠️ **Escopo mínimo do super admin para lançar não foi definido** — pendente P2 |
| **4** | Cliente pausa e inicia | E4, E6, E12 | T-OBS | ⬜ | `stop` real, não `pause` (C2); cold start dentro de T2 |
| **5** | Cobrança por hora | **E12**, E13 | T-OBS | ⬜ | ⚠️ Margem não fecha com desconto (6.1); taxa de Pix e egress a modelar; regra de compromisso pago pendente |
| **6** | MySQL e PostgreSQL | E10, E11 | T-TEN | ⬜ | ⚠️ PITR por cliente não definido; destino do banco em migração (fora do MVP) |
| **7** | Trocar versão de linguagem | **E9** | T-OBS | ⬜ | Rollback em 1 clique é requisito novo (E9.4) — sem ele, não conta como pronto |
| **8** | Gráficos no painel do cliente | E5 (coleta), E12 (billing), E6 (SSE) | T-PERF, **T-OBS** | ⬜ | ⚠️ **Pipeline de "requisições" não existe** — exige log da borda → parse → série (T-OBS.7) |
| **9** | Super admin muda RAM/vCPU a quente | **E7**, E3 | T-SEG, T-OBS | ⬜ | ⚠️ Proration na janela de resize sem regra; relação com o plano contratado indefinida; T5 vira UX |
| **10** | Instalação simples de módulo + documentação | **E14**, E5.1, T-MOD.8 | **T-DOC** | ⬜ | ⚠️ **Bootstrap do control plane não tem dono** (C18) — E14.7 |
| **11** | (ADENDO 1 §C) Pagamento como módulo plugável | **E13** | **T-MOD** | ⬜ | Depende da spec do Achado 5.0 estar fechada (P0.5.7) |
| **12** | (ADENDO 1 §A) Front obrigatoriamente Next.js | E1, e todo o painel | T-PERF, T-A11Y | ⬜ | `03` D4 ainda diz React+Vite — corrigir (C19) |
| **13** | (ADENDO 1 §A) Especificação executável por IA | E1 (F1–F8), **todos os critérios de aceite** | T-DOC | ⬜ | Este checklist é parte da resposta; Ciclos 3 e 4 completam |
| **14** | (ADENDO 2 §E) Padrão "AAA" | Todas as entregas com UI | **T-A11Y**, T-PERF | ⬜ | ⚠️ Lista definitiva de AAA adotados/recusados vem do Ciclo 3 |

---

## 10. Registro de decisões pendentes

> Nada marcado `⚠️ PENDENTE` pode ser resolvido pela IA "por bom senso" durante a construção.
> Pendência aberta **bloqueia a entrega que depende dela**.

| # | Pendência | Bloqueia | Quem decide | Ciclo que resolve |
|---|---|---|---|---|
| **P1** | **Objetivo da fase**: validar o produto (margem não importa 12 meses) **ou** gerar renda | Todo o corte de escopo | **Dono** | **Ciclo 2** (15 min) |
| **P2** | **Escopo mínimo do super admin para lançar** — `01` lista 12 telas como se fossem do dia 1 | E3, E7, requisito 3 | Produto/UX + Dono | **Ciclo 2** |
| **P3** | **C17 — a unidade de venda é o *site* ou o *ambiente*?** Se o cliente puser 10 sites num ambiente de R$ 35, densidade e margem quebram | Preço, planos, E6, E12 | **Dono** + Produto | **Ciclo 2** |
| **P4** | **Modelo econômico com 16 GB**: reserva de host, ambientes por nó, escada de descontos, recarga mínima, ponto de ruptura | E12, preço, decisão de investir | Multi-tenancy + Billing + Dono | **Ciclo 2** |
| **P5** | **Regras do compromisso pré-pago**: o que acontece ao **pausar, redimensionar ou cancelar** durante um período já pago | E12.4 | Billing + Dono | **Ciclo 2** |
| **P6** | **Proration do resize** e relação com o plano contratado (requisito 9) | E7.5, E12 | Billing | **Ciclo 2** |
| **P7** | **Pipeline da métrica "requisições"** (log da borda → `vector` → série) | Requisito 8, E5, T-OBS.7 | Observabilidade | **Ciclo 2** |
| **P8** | **Bootstrap e backup do control plane** (C18): quem provisiona, PITR do Postgres, restore em 30 min | E14.7, requisito 10 | DevOps/Instalador | **Ciclo 3** |
| **P9** | **Lista definitiva de critérios AAA adotados × recusados** + declaração de acessibilidade | T-A11Y, requisito 14 | **Especialista de Acessibilidade (novo)** | **Ciclo 3** |
| **P10** | **Linguagem final do agente**: Node-SEA confirmado **ou** .NET AOT, conforme M2/M3/B11 | E5 e tudo que depende dela | Esp. Node/Next + Dono | **Ciclo 2** (após P0.2) |
| **P11** | **VPS 3**: qual provedor, quais recursos — contratação condicionada ao `veloz-node-doctor.sh` | Capacidade, N-1, RTO | Dono + Linux/SRE | **Ciclo 2** |
| **P12** | **Cota de banda e egress por VPS**; limite por ambiente na borda; meter `egress.gb` | E12.9, custo real, SLA | Linux/SRE + Billing | **Ciclo 2** |
| **P13** | **Object lock / imutabilidade no bucket**: qual provedor suporta e a que custo | E11.3 🔒 | Linux/SRE + Segurança | **Ciclo 2** |
| **P14** | **RTO/RPO declarados** substituindo a regra N-1 (inviável com 3 provedores) | SLA, E11, contrato | Dono + Linux/SRE | **Ciclo 2** |
| **P15** | **PITR por cliente** no banco compartilhado | Requisito 6, E10 | Banco de Dados | **Ciclo 2** |
| **P16** | **Termos de Uso, AUP e Política de Privacidade** — sem AUP não há respaldo para desligar quem ataca | Primeiro cliente, E14.5 | Segurança & Compliance | **Ciclo 3** |
| **P17** | **20 contradições do Achado 11.1** formalmente resolvidas nos documentos de origem, com changelog | Consistência do Ciclo 3 | Crítico + autores | **Ciclo 2** |
| **P18** | **Custo de suporte por cliente** (custo dominante, nunca calculado — Achado 6.5) | Preço, decisão de vender | Dono + Billing | **Ciclo 2** |
| **P19** | **Matriz de erro completa de E6** (disco cheio, imagem faltando, container zumbi, nó offline) | E6.5 | Arquiteto + Produto | **Ciclo 3** |
| **P20** | **Plano de documentação do produto** (além dos runbooks): manual do cliente, ajuda contextual | Requisito 10, T-A11Y.16 | Documentação/DX | **Ciclo 3** |
| **P21** | **Consolidação final**: roadmap com datas, custo total, plano de execução e critério de "lançar" | Início da construção | Ciclo 4 | **Ciclo 4** |

---

## Rodapé de controle

| Campo | Valor |
|---|---|
| **Versão do checklist** | 1.0 (Ciclo 2) |
| **Entregas cobertas** | E1–E14 (E0 virou o portão P0.1 da Fase 0) |
| **Benchmarks referenciados** | B0–B13, T0–T10, M1–M12 |
| **Portões de CI** | G1–G18 |
| **Pendências abertas** | P1–P21 |
| **Próxima revisão** | Ciclo 3 (Segurança, Módulos/Instalador, API/Agente, Documentação/DX, Acessibilidade) |
| **Autorização para codar** | ⛔ **NÃO CONCEDIDA** — depende de P0.5.10 (assinatura do dono) |
