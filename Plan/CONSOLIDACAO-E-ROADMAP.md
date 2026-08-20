# VelozPanel — Consolidação e Roadmap Executável

> **Status: planejamento concluído — aguardando aprovação para construir. Nenhuma linha de código de produção foi escrita.**
>
> Documento único de decisão e roadmap. Fecha os 2 ciclos de `planejar → criticar` (Ciclos 3 e 4 formais
> dispensados por decisão do dono e recomendação convergente dos dois críticos do Ciclo 2 — ADENDO 5 §N).
> Consolida `00-BRIEFING.md` (ADENDOS 1–5), as 3 críticas, os 12 documentos de especialista e os 6 manuais.
> Onde uma decisão ainda depende do dono, está marcada **⚠️ PENDENTE**. Uma recomendação por tema.
>
> **Regra de precedência:** ADENDOS do briefing > críticas > documentos de especialista. Onde um documento
> de especialista contradiz um ADENDO ou uma arbitragem de crítica, o documento está desatualizado e a
> decisão aqui registrada prevalece (ex.: doc 03 ainda cita Incus/Go/NATS — todos revogados).

---

## 1. Sumário executivo

**O que é.** O VelozPanel é um painel de hospedagem multi-inquilino (estilo Hostoo) para rodar em VPS
próprias, com dois painéis — **cliente** e **super admin** —, cobrança **por hora de uso com saldo
pré-pago em BRL**, botão de **pausar/iniciar** o ambiente, **troca de versão de linguagem** por cliente
(PHP/Node e, no futuro, outras) e **gráficos** de consumo. A arquitetura é **modular**: cada capacidade
(banco, backup, SSL, DNS, pagamento…) é um módulo, e o meio de pagamento em especial é um módulo plugável
(requisito fechado do dono).

**Para quem.** Nesta fase, para o próprio dono (hospedar 4–5 sistemas dele) e, se houver demanda validada,
para um perfil estreito de cliente externo: **desenvolvedor freelancer ou agência de 1–3 pessoas, com
projetos intermitentes** (staging, homologação, demo, side project) em PHP ou Node, **sem necessidade de
caixa de e-mail** e que entende que está ajudando a validar um produto sem SLA contratual.

**A aposta central.** A originalidade não está no painel (Enhance, HestiaCP, CloudPanel e Coolify já
fazem 85% disso, três de graça). Está na **camada de cobrança por hora, com saldo pré-pago em BRL, Pix e
pausa real** — que não existe pronta no mercado brasileiro. É ~15% do escopo e concentra 100% do
diferencial.

**Veredito honesto de viabilidade.** A frota atual **não fecha como negócio em cenário nenhum** — é
matemática, não pessimismo. Com 2 nós de 16 GB, o teto de receita é **~R$ 918/mês bruto** e o ponto de
equilíbrio exige **17 ambientes ativos numa frota que só comporta 14** (equilíbrio a 121% da capacidade
física). O melhor caso possível — frota cheia, tudo ligado, preço de tabela, zero desconto — é um prejuízo
de caixa de **R$ 131/mês**, ou **R$ 371/mês** contando o tempo do dono. **A frota atual é um laboratório,
não uma empresa.** Como laboratório de aprendizado — aprender container por inquilino, metering
idempotente, backup com restore ensaiado e, sobretudo, **dirigir uma IA construindo um sistema real** —
ela vale o que custa. **A única alavanca que transforma isto em negócio é um nó grande** (dedicado de 64 GB,
tendência EUA por ser mais barato por GB): sozinho, ele leva a margem de −R$ 1 para **+R$ 1.285/mês**. Mas
esse nó só se justifica **depois** de demanda comprovada. **Postura correta desta fase: validação — otimizar
para aprender com poucos clientes e não perder dado, aceitando o prejuízo operacional como custo de escola**
(ADENDO 3 §I).

---

## 2. Decisões de arquitetura fechadas

> Todas ratificadas contra os ADENDOS e as arbitragens das críticas. As "alternativas descartadas" incluem
> propostas de documentos do Ciclo 1 que foram revogadas (Incus, Go, NATS, React+Vite).

| Tema | Decisão | Alternativa descartada | Doc de origem |
|---|---|---|---|
| **Isolamento do ambiente** | **1 container OCI por ambiente via Docker Engine com `userns-remap: default` + cgroup v2 (`systemd` driver) + quota de disco XFS `prjquota` (project id = 10000+env_id)**. UID interno único por ambiente (`10000+env_id`), nenhum container roda como uid 0, `--read-only` + `--cap-drop=ALL` + `no-new-privileges` + seccomp. Sem ZFS (ARC come RAM em nó de 16 GB), sem Incus. | Incus/LXD + ZFS (doc 03 D5); Podman `--userns=auto` fica como gatilho de reabertura se algum ambiente precisar de root | 06 §10; Crítica 1 Conflito 1 / Achado 1.6; checklist P0.5.3 |
| **Stack do control plane** | **Next.js (apenas front) + API Fastify separada (Node/TS) + PostgreSQL + Drizzle ORM + fila `pg-boss` no próprio Postgres + `better-auth`**. Front sem `DATABASE_URL`; toda mutação passa por `/api/v1` com entrada/saída validada por zod (`packages/contracts`). Monorepo pnpm + Turborepo. | Go dos dois lados (doc 03 D3 — dono não domina Go); Next.js full-stack com Server Actions; NATS/Redis para fila; tRPC | 05 §7 (decisões 6–10); ADENDO 1 §A; Crítica 1 Conflito 3; checklist P0.5.5 |
| **Agente do nó** | **Node.js 24 LTS distribuído como SEA (binário único)**, `MemoryMax=128M`, `Restart=always`, estado em `node:sqlite` (builtin), ≤6 dependências diretas, zero módulos nativos. **Não roda como root**; ações privilegiadas passam pelo helper `veloz-nodectl` (allowlist). Plano B: **.NET 10 Native AOT** (gatilho: ≥1 incidente/mês por 8 semanas). | Go (doc 03); agente rodando como root (doc 03 §1.1, revogado por C1) | 05 §2/§7; checklist P0.5.5 |
| **Transporte CP↔nó** | **WebSocket sobre mTLS, conexão iniciada pelo agente (só abre 443 de saída)**, com **fila durável em tabela Postgres `node_commands`** (ack + idempotência) e **buffer local de 72 h** no nó. Sobrevive a queda de link sem perder evento. | NATS JetStream (doc 03 D2/D8) — arquivado com gatilho de reintrodução **>15 nós** ou replay real; gRPC bidi; HTTP polling | 05 §7 (decisão 11); Crítica 1 Conflito 4; checklist P0.5.6 |
| **Banco do cliente** | **MariaDB 11.8 LTS (rótulo "MySQL" na UI) + PostgreSQL 17, ambos compartilhados por nó**, 1 database + 1 role por ambiente. Pausa = `ACCOUNT LOCK`/`CONNECTION LIMIT 0`. Acesso remoto **desligado por padrão** (allowlist /32, validade ≤30 dias). Tier "banco dedicado" pago (container próprio, R$ 49–159/mês). | Banco por ambiente (doc 03 §4.1, revogado por Conflito 2); MySQL 8.4 (400–600 MB idle); PG 18 (esperar 18.4) | 09 D1–D11; Crítica 1 Conflito 2; checklist P0.5.4 |
| **Web server de borda** | **nginx mainline** (gera vhost, valida com `nginx -t` antes do reload). ACME **nunca** pelo web server. | **Caddy (API JSON, ACME automático)** — proposto no doc 03, mantido como **plano B** se o reload do nginx passar de 3 s (gatilho B5/C4) | 08 `mod-node-base`; 04 §6.1; Crítica 1 C4/C5 |
| **TLS / certificados** | **`lego`** com **fila serializada no control plane** (`auto_https off` no web server), emissão wildcard por **DNS-01**, delegação de `_acme-challenge` via **`acme-dns`** (zona `acme-cd.veloz.app` fora do PowerDNS). Wildcard único `*.veloz.app` + **override de rate limit da Let's Encrypt para `veloz.app`** (nunca PSL). Renovação D-30. **ARI recomendado** (renovações ARI são isentas de rate limit — pesquisa de apoio). | ACME automático do web server (estoura cota da LE e trava emissão para todos — C5) | 12 §8–9; 08 `mod-ssl`; `_pesquisa-dns-acme-anycast.md` |
| **DNS autoritativo** | **PowerDNS 5.1.3** — `ns1` no BR (master SQL, fonte da verdade), `ns2` no US (slave), **+ Hurricane Electric (`ns2–ns5.he.net`) anycast global GRÁTIS via AXFR/TSIG**. Sem anycast próprio (ASN+/24+BGP só compensa acima de milhares de zonas). No MVP, `mod-dns` opera em **modo externo (não autoritativo)**: gera instruções de NS/A/CNAME e verifica propagação. | Anycast próprio (US$ 90–128/mês + US$ 500 entrada); Cloudflare Secondary (só Enterprise) | 12 D11/D12; `_pesquisa-dns-acme-anycast.md`; ADENDO 4 §M |
| **Backup** | **`restic` 0.18, um repositório por ambiente**, destino primário **Backblaze B2 com Object Lock (governance, 30 dias)** — egress grátis até 3× o armazenado; **cópia 3 no Magalu Cloud (BR, Cold Instant)**. Dump lógico horário por database (**RPO 1 h**). Duas identidades no bucket (nó = write-only sem delete; **warden de expurgo fora dos servidores**, ex. GitHub Actions com OIDC). Control plane: **pgBackRest**, WAL contínuo (RPO ≤60 s, RTO 30 min). **Restore ensaiado semanalmente com prova assinada** — o restore é o critério de aceite, não o backup. | borg (sem S3 nativo), kopia, Wasabi (mínimo 90 dias), Hetzner Storage Box (sem Object Lock), MinIO no CP (C10) | 09 D14–D20; Crítica 1 D3/D4; checklist E11 🔒 |
| **Observabilidade** | **VictoriaMetrics single-node, só no control plane** (`-memory.allowedBytes=256MB`, retenção **21 dias**, série de 15 s descartável). **Rollup horário no Postgres (13 meses) é a base da fatura e do gráfico >21 d**. Agente faz push em texto (`/api/v1/import/prometheus`). **13 regras de alerta** (job de 60 s no scheduler, sem Grafana/Loki/Alertmanager). Log legal 180 d, log de métrica 7 d. | Prometheus (5–10× RAM), Netdata, Timescale, downsampling do VM (é Enterprise), Grafana/Loki como produto (C8) | 11 O1–O8; checklist E12 |
| **Pagamento (plugável)** | **Capability `payment.gateway v1`** no core + método `host.payments.settle()` + tipo de rota `webhook`; **nenhum acoplamento do core a PSP** (teste de fachada no CI: grep por "asaas/stripe/…" em core deve retornar zero). MVP: **`mod-pagamento-asaas` (Pix)** + `mod-pagamento-fake`. Gatilho para `mod-pagamento-pix` (banco direto EFI/Inter): **>250 recargas/mês**. | Core acoplado a um PSP (Achado 5.0); Stripe Billing/Lago/OpenMeter (metering caseiro resolve) | 07 §6–7; 08 D3; ADENDO 1 §C; checklist E13/P0.5.7 |
| **Multi-região** | **Cobrança sempre em BRL**, inclusive para nó nos EUA (**câmbio administrado, revisão trimestral, gatilho ±8%** — nunca dólar do dia). **Control plane fica no Brasil (definitivo)**. Brasileiro só é hospedado nos EUA sob **cláusulas-padrão da ANPD (Res. CD/ANPD 19/2024) + consentimento específico gravado** (texto versionado + hash + IP + timestamp). Região é entidade de primeira classe (`environments.region` imutável); trocar de região = recriação com novo consentimento. **`us-east1` só é provisionado com ≥3 clientes consentidos em fila.** | Cobrar em USD; CP nos EUA (+130 ms/clique); migração silenciosa entre continentes (incidente de LGPD) | 12 D1–D10; ADENDO 4 §J |
| **Topologia** | Control plane em **VPS separada** (≈4 vCPU / 8 GB / 80 GB, Debian 13), fora dos nós de produção. Data plane = agente + Docker + nginx + bancos por nó. CP nunca está no caminho do tráfego (painel cai, sites continuam no ar). | CP co-hospedado num nó de produção | 03 D1/§1.2; 08 §6 |

**Estados do ambiente (máquina de estados, fonte da verdade = control plane).** Estáveis:
`provisioning` (não cobra) → `active` (cobra hora cheia CPU+RAM+disco) ⇄ `paused` (**`docker stop`**, RAM
100% liberada, cobra só disco a R$ 0,25/GB/mês) → `suspended` (inadimplência/abuso; container parado, dados
intactos; cliente não sai sozinho) → `archived` (D+30; ambiente exportado, container destruído) →
`deleted` (D+60; terminal, purga LGPD). Transitórios (com job vivo + `deadline_at`): `starting`,
`pausing`, `resizing` (cobra pelo maior dos dois tamanhos), `migrating`, `archiving`, `error` (congela
cobrança de CPU/RAM). Autostart derivado do estado desejado; idempotência garantida (pausar já-pausado →
200; iniciar suspenso → 409 `payment_required`). *(Fonte: 03 §7; a máquina foi reescrita de `incus pause`
para `docker stop` — 06 D4.)*

---

## 3. Modelo comercial

**Modelo de cobrança (híbrido, herdado do Hostoo).** Preço de tabela mensal convertido em **tarifa
horária** (mês contábil de **720 h fixas**), debitada de um **saldo pré-pago em créditos (BRL)**. Coleta a
cada 60 s, cobra por minuto (fração de hora), apresenta por hora. Ambiente pausado cobra **só disco**. Sem
fatura no MVP — pré-pago puro com razão append-only + demonstrativo (a nota fiscal fica fora, mas o schema
guarda o que ela exigiria — ADENDO 1 §C).

**Catálogo de planos (fechado até 4 GB — ADENDO 3 §H; vigência `br-se1`).**

| Plano | Recursos | Preço/mês | R$/h ativo | Pausado (só disco) |
|---|---|---:|---:|---:|
| **Veloz Start** | 1 vCPU · 512 MB · 10 GB | **R$ 30,50** | R$ 0,0423611 | R$ 2,50/mês |
| **Veloz Light** | 1 vCPU · 1 GB · 20 GB | **R$ 49,00** | R$ 0,0680556 | R$ 5,00/mês |
| **Veloz Plus** | 2 vCPU · 2 GB · 40 GB | **R$ 98,00** | R$ 0,1361111 | R$ 10,00/mês |
| **Veloz Pro** | 2 vCPU · 4 GB · 80 GB | **R$ 172,00** | R$ 0,2388889 | R$ 20,00/mês |
| ~~Turbo (8 GB)~~ / ~~Max (16 GB)~~ | — | fora do catálogo | — | — |

- **Preço unitário do motor** (o que gera os planos): vCPU R$ 12,00/mês · RAM R$ 32,00/GB/mês · Disco
  R$ 0,25/GB/mês · Egress R$ 0,15/GB acima de 1 TB/mês.
- **Saldo pré-pago:** recarga mínima **R$ 50,00** (sugestões R$ 100 / 200 / 500). Pix Asaas custa R$ 1,99
  fixo por recarga → taxa efetiva média esperada **~1,7%** (recarga média ~R$ 120). **Pix primeiro**;
  cartão tokenizado com recarga automática na v1; Pix Automático na v2.
- **Compromisso pré-pago** = **saldo dedicado em R$ + percentual de desconto travado no ambiente** (não
  bloco de horas, não plano travado). **O dinheiro nunca expira**; o **desconto** expira em `prazo × 1,5`
  (mín. 6 meses). Cancelamento devolve o residual como crédito (ou dinheiro com recomposição do desconto);
  dentro de 7 dias, devolução integral (CDC art. 49). Regra de caixa: nunca usar >50% do caixa de
  compromissos em custeio corrente. **⚠️ PENDENTE (P5):** as regras de pausar/redimensionar/cancelar
  durante um compromisso já pago precisam ser ratificadas pelo dono.
- **Política de desconto:** teto absoluto **25%** (`discount_bp ≤ 2500`), escada plena **8% / 15% / 22%**
  (3/6/12 meses). **Na Fase 1 (2 nós), o teto de desconto é 10%**, só cliente âncora, só 6 meses — a escada
  plena só volta com o nó de 64 GB. Ponto de ruína ≈ 30% (os 35% de `01` foram refutados).
- **Inadimplência:** aviso (D-7) → **72 h de carência** → **suspensão** (container parado, dados/DNS/certs
  intactos, religa em <2 min sem taxa) → **arquivamento D+30** (exportado, restauração grátis) →
  **exclusão D+60**. São **62 dias entre zerar o saldo e perder dados**, com ≥7 avisos, exportação sempre
  disponível e **nenhuma taxa** para voltar (o Hostoo cobra R$ 25 por restauração; aqui é R$ 0,00).

**"Planejar para 14 / vender para 20–26".** No mix assumido (30% Start / 40% Light / 20% Plus / 10% Pro =
1.382 MB médios), cabem **7 ambientes por nó = 14 na frota**, postura garantida (sem overcommit sobre o
vendido). Mas restringindo o catálogo vendável da fase a **Start + Light** (máx. 1 Plus/nó, zero Pro), a
mesma infraestrutura comporta **20 a 26 ambientes** — um único Pro consome 38% do vendável de um nó. Logo:
**planejar a capacidade para 14, mas orientar a venda para Start+Light e chegar a 20–26** é a única
configuração desta frota com unidade econômica defensável.

**Veredito comercial.** Preço competitivo **não fecha na infraestrutura BR** atual. Para 14 ambientes
empatarem no caixa, o preço teria de subir 1,215× (Light de R$ 49 → R$ 59,55, ~33% acima do Hostoo). A
decisão de **não subir preço** está correta: o problema não é preço, é o **custo fixo de VPS pequenas por
GB**. A saída é tamanho de nó (§4), não tabela de preços.

---

## 4. Números que mandam

> Todos com o documento de origem. Onde uma crítica corrigiu um número do planejamento, as duas colunas
> aparecem: **planejado** e **corrigido/arbitrado**.

| Métrica | Valor planejado | Corrigido/arbitrado | Doc / achado |
|---|---:|---:|---|
| **Frota de produção** | 3 nós (docs 08/09/11) | **2 nós de 16 GB** + 1 nó de teste (não vende) | ADENDO 3 §G |
| **Densidade (mix 1.382 MB)** | 11/nó (07) · 22/nó (09) | **7/nó = 14 na frota** (postura A garantida) | 06 §1.6; Crítica 2 §1.5 |
| **Densidade (só Start / só Light)** | — | **20 / 10 por nó** (40 / 20 na frota) | Crítica 2 §1.5 |
| **Reserva fixa de RAM por nó** | 2.898 MB (06) | **~3.060–3.121 MB** (faltavam SFTPGo 40 MB e db-warden 10 MB; PG real 433 MB, não 350) | 06 §1.1; Crítica 2 Achado 1.1 |
| **Reserva operacional por nó** | 2.000 MB (06) | **1.000 MB** (os 4 usos são mutuamente exclusivos; build sai do nó de produção) | Crítica 2 Achado 1.3 |
| **RAM vendável por nó** | 9.500 MB | 10.500 MB (não muda o mix: 7/nó) | 06 §1.6; Crítica 2 Achado 1.3 |
| **RAM por componente (nó 16 GB)** | Kernel+systemd 450–500 · dockerd+containerd 150 · agente Node 128 · nginx 60 · MariaDB 11.8 ~480–490 · PostgreSQL 17 ~350–433 · margem 1.000 | idem, com PG corrigido para 433 | 06 §1.1; 09 §1.4 |
| **Disco livre para volumes (nó 200 GB)** | **128 GB → 51 volumes** (06) | **75 GB reais → 30 volumes** (arbitrado após correções: **103 GB → 41 volumes**) | Crítica 2 **Achado 1.2** (o disco não fecha e ninguém somou) |
| **Custo fixo mensal da frota** | **R$ 1.027/mês** (2 nós R$ 250 + teste R$ 250 + CP R$ 80 + obs R$ 32 + DNS/TLS/e-mail R$ 25 + helpdesk R$ 130 + misc R$ 10) | **R$ 865/mês** cortando helpdesk pago (−R$ 130) e o erro contábil de obs (−R$ 32) | 07 §3.10.3; Crítica 2 §1.6 |
| **Custo por ambiente** | R$ 59,35/amb (÷22, com suporte) | **R$ 73,36 de custo fixo por vendável** (÷14) | 07 §3.10.3; Crítica 2 Achado 1.6 |
| **Teto de receita da frota** | **R$ 1.144/mês** (postura C, 22 vendidos) | **R$ 918 bruto / R$ 896 líquido** (postura A, 14) | 07 §3.10.5; Crítica 2 Achado 1.6 |
| **Ponto de equilíbrio** | 17 ativos = 94% do teto | **17 ativos = 121% do teto de 14 → inatingível.** Não existe ponto de equilíbrio | 07 §3.10.4; Crítica 2 Achado 1.6 |
| **Melhor caso possível (margem)** | +R$ 88/mês | **−R$ 131/mês (caixa); −R$ 371/mês** com o tempo do dono | Crítica 2 Achado 1.6 / Produto §0 |
| **Custo de backup** | — | **R$ 0,45/ambiente/mês** (~R$ 2,60/mês na Fase 1; ~R$ 29/mês na maturidade). B2 R$ 0,0373/GiB, Object Lock +15–20% | 09 §5.5; D3 |
| **Custo de observabilidade** | — | **≤470 MB de RAM na frota ≈ R$ 32/mês** (VictoriaMetrics no CP) | 11 §0 |
| **Gatilho do nó de 64 GB** | — | Margem vai de **−R$ 1 para +R$ 1.285/mês**; equilíbrio cai de 94% para **45%** da capacidade | 07 §3.10.9 |

> **A leitura de uma frase:** esta frota é um laboratório sem lucro em qualquer configuração; o disco tem
> menos folga do que o planejamento supôs (75 GB, não 128); e a única alavanca real é trocar VPS pequenas
> por um nó grande — depois de provar demanda.

---

## 5. Escopo do MVP

> Corte guiado pela crítica de produto (§3) e pelo inventário do doc 01 §3. **Com IA construtora, o
> documento é o escopo** (Achado 0.3): o que está na coluna "CORTADO" **não deve ser construído por
> iniciativa própria** — nem "só a interface", nem "só um esqueleto" (risco D2 = 50%).

| DENTRO do MVP (Fase Piloto) | v1 (depois do MVP) | CORTADO / futuro (não construir agora) |
|---|---|---|
| `veloz-node-doctor.sh` aprovado nos nós | E-mail **relay de saída** (`mod-email-relay`: SES/Resend, DKIM, sem caixa) | **E-mail com caixa postal / webmail / antispam / listas** — nunca construir, terceirizar sempre (Zoho/Google/Titan, botão de MX) |
| 1 container OCI/ambiente (Docker userns-remap, XFS quota, nftables) | Git deploy + build step + rollback (`mod-git-deploy`) | **Registro/transferência de domínio** (`mod-registrar`) — Registro.br sem API para não-registrador |
| Duas imagens base: **`php:8.3` e `node:22`** | Cron pela UI + histórico (`mod-cron`) | **Migração ao vivo entre nós** — substituída por runbook (pausar→backup→restaurar→trocar DNS) |
| Máquina de estados `create/start/stop/resize/delete` + reconciliação | `mod-pagamento-pix` (banco direto, >250 recargas/mês) | **Apps 1-click** (WordPress/Laravel/Ghost/n8n) |
| Agente + enroll + WebSocket mTLS (IP público, `localhost` proibido) | Alias / redirect / subdomínio pela UI | **WAF / Coraza / CRS** — Cloudflare grátis na frente até o 1º incidente |
| Control plane: Next.js + Fastify + Postgres + pg-boss | Adminer / export-import / SSH+chaves pela UI | **Tickets / helpdesk pago** — WhatsApp e e-mail do dono |
| **Painel do cliente: ~6 telas** (lista · resumo c/ 4 gráficos · pausar/iniciar · trocar versão · logs · extrato) | IAM (compartilhar ambiente) + 2FA do cliente | **Indicação / referral / gamificação** — 12 clientes não têm rede |
| **Painel do admin: ~4 telas** (nós · ambientes · resize a quente · lançar crédito na mão) | Restauração seletiva / staging-clone | **Compromisso pré-pago, cupons, campanhas, escada de desconto** — só depois do nó de 64 GB |
| **Metering:** `state_windows`→`usage_events`→razão append-only→saldo→demonstrativo | DNS autoritativo (`mod-dns` completo / Cloudflare) | **Faturas / NFS-e** — extrato + razão bastam (mas 6 colunas fiscais ficam no schema) |
| **Pagamento:** `mod-pagamento-fake` + recarga lançada pelo admin; contrato `payment.gateway v1` real | `mod-pagamento-asaas` (Pix) real ao entrar o 1º cliente externo | **Multi-nó: scheduler, evacuação, migração, admission control** — 1 nó só no Piloto (Fase 1 em diante) |
| MariaDB compartilhado + criar database/role/grant | Runtimes Python/Go/Bun/Deno; extensões PHP por toggle | **Gerenciador de arquivos web / editor de código** — SFTP resolve |
| SSL via `lego` (fila no CP, wildcard `*.veloz.app`) | PostgreSQL para o cliente (sob demanda real) | **Marketplace `.vpm`, cosign, iframe sandbox, ESM remoto** — módulos são `builtin` first-party |
| **Backup `restic` + dump horário + RESTORE ENSAIADO** 🔒 (inegociável) | Cartão tokenizado + recarga automática | **VictoriaMetrics completo, 13 alertas, retenção em camadas** — 4 séries + 4 alertas bastam abaixo de 30 ambientes |
| SFTP por ambiente (`mod-ftp-sftp`) | Status page pública + crédito de SLA | **i18n multi-locale** — `pt-BR` (mas strings em arquivo desde o commit 1) |
| Auth: e-mail+senha+TOTP, 2 papéis, auditoria de escrita | Inadimplência automatizada / conciliação | **AAA completo** — **AA é o piso do MVP** (barato se feito desde o commit 1); AAA vem depois |
| Subdomínio grátis `*.veloz.app` (wildcard TLS único) | Multi-região (`us-east1`) com consentimento LGPD | **Registro de domínio, apps, e-mail com caixa, migração ao vivo** (repetidos: NÃO construir) |
| 3 runbooks (restaurar backup · nó caiu · subir ambiente) + acessibilidade **AA** + CWV no verde | — | — |

**O que NÃO se constrói, dito com todas as letras:** e-mail com caixa postal/webmail/antispam/listas;
registro de domínio; migração ao vivo entre nós; apps 1-click; WAF; tickets/helpdesk pago; indicação;
compromisso pré-pago, cupons e escada de desconto; faturas/NFS-e; scheduler/evacuação multi-nó no Piloto;
gerenciador de arquivos web; marketplace de módulos de terceiros; i18n multi-locale; AAA completo.

**Tamanho do corte:** ~7 dos 25 módulos (28%), ~18 das ~85 features (21%), ~10 das ~60 telas (17%),
~3.000 das 21.555 linhas de especificação (14%), **~180–250 h de esforço do dono** contra 900–1.200 h do
escopo completo. O corte fica com **a parte difícil** (agente, máquina de estados, metering idempotente,
backup com restore) e joga fora a parte volumosa e fácil.

---

## 6. Roadmap em fases com gatilho de passagem

> Cada fase referencia as entregas **E1–E14** do `docs/CHECKLIST-DESENVOLVIMENTO.md` (E0 virou o portão
> P0.1 da Fase 0). Cada gatilho de passagem é **numérico e objetivo**. Inegociáveis em qualquer fase:
> **E11 (restore ensaiado), E12 (metering conferido) e o teste de isolamento entre inquilinos**.

### Fase 0 — Portões que bloqueiam tudo *(≈1–2 semanas)*
- **Objetivo:** provar que o hardware serve e fechar as decisões de papel antes de qualquer código.
- **Entregas:** `veloz-node-doctor.sh` rodado nos nós (P0.1); medições M1–M12 (spike do agente, teste
  decisivo do runtime T0–T10, stack); decisões P0.5.1–P0.5.9 ratificadas por escrito; **P0.5.10 —
  aprovação explícita do planejamento pelo dono** (único item que autoriza a 1ª linha de código).
- **Critério de conclusão:** node-doctor sai 0 ou 2 em todos os nós; medições registradas; escopo do MVP
  congelado e assinado em `Plan/05-escopo-mvp.md`.
- **Gatilho de passagem:** **todos os nós aptos** (KVM/bare metal, cgroup v2 com escrita em `memory.max`,
  `overlay2`, `prjquota`, `userns-remap`, nftables) **E aprovação escrita do dono**.
- **Gatilho de aborto:** qualquer nó reprovado (OpenVZ/LXC/Virtuozzo) → **trocar de VPS antes de escrever
  código**. É o risco D1.
- *(Em paralelo — validação de demanda, F0b da crítica de produto: **10 conversas** com a proposta honesta
  e a tabela de preço. **≥3 "quero" a este preço, sem SLA e sem e-mail" → Projeto B (billing real) segue;
  0–1 de 10 → o billing nunca sai do `mod-pagamento-fake` e o produto vira ferramenta interna.**)*

### Fase Piloto — Modo nó único: VM local → 1º nó de produção *(≈8–12 semanas)*
- **Objetivo:** construir **o produto de verdade num nó só** e hospedar **os 4–5 sistemas do dono em
  produção** (não protótipo descartável). Validado primeiro na **VM Debian 13 local** (que passa no mesmo
  `node-doctor` da produção) e depois promovido ao 1º nó de produção (ADENDO 5 §L).
- **Entregas:** **E1–E14** do checklist — monorepo (E1), modelo de dados (E2), auth+RBAC+auditoria (E3),
  motor de jobs (E4), agente+enroll+long-poll (E5), ciclo de vida do ambiente (E6), limites+hot-resize
  (E7), borda+domínio+TLS (E8), runtime PHP com troca de versão (E9), bancos+SFTP+terminal (E10),
  **backup+restore (E11) 🔒**, **metering+fatura sombra (E12) 🔒**, gateway de pagamento plugável com
  `mod-pagamento-fake` (E13), documentação operacional/runbooks (E14).
- **Regra dura:** no nó de teste, o agente fala com o CP **pelo IP público, com mTLS, desde o primeiro
  commit** — `localhost` proibido no transporte (senão os bugs de 2 nós ficam escondidos).
- **Critério / gatilho de passagem (todos):** (a) 5 sistemas rodando **30 dias sem intervenção manual**;
  (b) **o dono restaura um ambiente do zero, sozinho, cronometrado, seguindo só o runbook**; (c) razão ×
  máquina de estados com desvio **≤1% em 30 dias**; (d) **4 drills de backup consecutivos verdes**; (e)
  teste do **"inquilino hostil" sintético** (fork bomb, disco cheio, CPU 100%, tentativa de ler `/srv` alheio)
  passa.
- **Gatilho de aborto:** operação do dono **>8 h/mês** → parar e automatizar antes de seguir.

### Fase 1 — Dois nós e primeiros clientes externos *(≈4–6 semanas + 60 dias)*
- **Objetivo:** validar a operação multi-nó e abrir para o perfil-alvo, **no máximo 12 clientes / 12–15
  ambientes** (a política original de 15 ambientes estoura o teto de 14 — corrigir para 12 clientes / 12
  ambientes, deixando 2 slots de folga).
- **Entregas:** mTLS pela internet entre os 2 nós; scheduler + admission control (409 na **criação** que
  não cabe, nunca no `start` de ambiente vendido — Achado 1.5); evacuação e **restore cruzado** ensaiados;
  `mod-pagamento-asaas` (Pix) real; extrato, ciclo de inadimplência, status page.
- **Critério / gatilho de passagem:** (a) **`node.evacuate` ensaiado com sucesso dentro do RTO** (alvo 90
  min, teto contratual 4 h); (b) **B1/T9 medido ≥12 ambientes Start por nó**; (c) 30 dias com <2 h/mês de
  operação manual; (d) **60 dias com zero perda de dado, zero contestação de cobrança, ≤0,5 ticket/
  cliente/mês**.
- **Gatilho de aborto:** B1/T9 <12 → refazer a economia antes de vender. Evacuação falha → **não vender
  para ninguém**. **1 perda de dado** → parar de vender e voltar à estabilização.

### Fase 2 — Nó grande (dedicado / EUA) quando o gatilho disparar
- **Objetivo:** a decisão mais importante do plano financeiro — trocar a alavanca. Só entra **depois** de
  um dos gatilhos objetivos do doc 07 §3.10.9 (reescritos para o teto real de 14):
  - **(a)** 12 ambientes ativos simultâneos (86% do teto de 14) por 14 dias corridos; **ou**
  - **(b)** RAM ativa >85% por 7 dias; **ou**
  - **(c)** receita ≥ **R$ 750/mês** por 2 meses; **ou**
  - **(d)** fila de `start`/criação >0,5% por 7 dias.
- **Entregas:** contratar 1 nó dedicado de 64 GB (tendência EUA por custo/GB); se EUA, ligar multi-região
  (`us-east1`) com consentimento LGPD; refazer a economia (a margem vira positiva: +R$ 1.285/mês).
- **Critério de conclusão:** margem de caixa positiva sustentada por 2 meses.

### Fase 3 — Features de v1
- **Objetivo:** só depois de a operação real provar que faltam. E-mail **relay de saída**, git deploy,
  cron pela UI, apps 1-click, DNS autoritativo/Cloudflare, cartão tokenizado, AAA completo, i18n.
- **Gatilho de entrada de cada feature:** um número concreto (primeiro cliente que pede, primeiro
  incidente), nunca "já que estou aqui".

### 🛑 Gatilho de PARADA (o mais importante do roadmap)
> **12 meses sem atingir R$ 900/mês de receita → encerra a operação comercial e fica com a ferramenta
> interna.** Decidir isso agora, a frio, é o que permite tocar o projeto sem medo — é o único gatilho que
> **permite parar sem que parar seja fracasso** (Produto §4.4 (f) e Recomendação 10). Complementar:
> operação do dono ≥8 h/mês de forma sustentada → automatizar antes de vender qualquer coisa nova.

---

## 7. Riscos de morte do projeto

> Os 5 piores, consolidados das duas críticas (Crítica 1 §9 D1–D5 + Crítica 2). Mitigação e fase.

| # | Risco | Prob. | Mitigação | Fase que endereça |
|---|---|---|---|---|
| **D1** | **VPS não-KVM** (container-based: OpenVZ/LXC/Virtuozzo) — sem cgroup delegado, sem userns, sem módulo de kernel → arquitetura inteira inviável, descoberto tarde | Alta (40%) até rodar o diagnóstico; ~0% depois | **`veloz-node-doctor.sh` rodado ANTES de tudo** e usado como critério de contratação da VPS 3. É a mitigação mais barata e valiosa de todo o planejamento | **Fase 0** (P0.1) |
| **D3** | **Cliente perde dado** — backup nunca restaurado de verdade + perda de VPS (provedor pequeno, um por nó, sem SLA forte; N-1 só a partir de 2 nós) | Alta ("é quando, não se") | `restic` por ambiente + dump horário (RPO 1 h) · **drill semanal de restore com prova assinada** · **Object Lock (imutabilidade) no bucket B2** · chave `age` fora dos servidores · warden de expurgo fora dos nós/CP · **nenhum cliente externo entra antes de o dono restaurar um ambiente do zero, sozinho, cronometrado** | **Piloto (E11) + Fase 1** |
| **Disco** | **Disco estourando** — a folga real é **75 GB, não 128** (Achado 1.2); `restic cache`, dump horário e restore-ao-lado somam sem ninguém contabilizar; a 2ª camada de redundância da frota de 2 nós é mais apertada do que o doc afirma | Média-Alta | Tabela única de disco (06 §1.3) com PG-db 30 GB + logs 8 GB + backup local 12 GB + cache restic 5 GB (`--cleanup --max-age 30`); **bloqueio de criação/restore em 80% (contra 103 GB, não 128)**; cota de 2 GB de log comprimido por ambiente | **Piloto + Fase 1** |
| **D4/Spam** | **Spam derruba o IP** (ou fuga de container → ransomware no nó, molde CyberPanel) — reputação de IP e blacklist quando entrar e-mail; kernel comprometido | Baixa-Média (15%) | **Não construir e-mail com caixa; só relay externo com DKIM e cota diária** (o pior módulo do inventário fica de fora); painel admin fora da internet aberta (VPN/allowlist + 2FA); **ZFS fora** devolve kernel atualizável; backup imutável transforma ransomware em incidente de horas | **v1 (relay) / nunca (caixa)** |
| **D5** | **Cobrança divergente em escala** — drift de metering, evento duplicado, cobrança de ambiente pausado → chargeback, Procon, reputação | Média (25%) | Razão append-only + chave idempotente; **extrato hora a hora visível antes de qualquer cobrança**; congelamento do medidor quando o nó fica mudo; reconciliação diária gráfico×fatura (alerta P1 `ReconciliacaoDivergente` **bloqueia o fechamento da fatura**); **toda contestação <R$ 50 estornada na hora** | **Piloto (E12) + Fase 1** |

---

## 8. Requisitos do dono × onde foram atendidos

| # | Requisito | Decisão / onde é atendido | Doc | Status |
|---|---|---|---|---|
| 1 | PHP + Node.js, aberto a outras linguagens | Imagens OCI `php:8.3`/`node:22` no MVP; runtime novo = manifesto `.toml`, zero código no core; Python/Go/Bun depois | 06 D7/D11; 08 `mod-runtime-*` | **Resolvido** (linguagens extras na v2) |
| 2 | Sistema modular | Modularidade é **contrato** (capability), não carregamento dinâmico; `builtin` first-party na Fase 1; `.vpm`+cosign+iframe na Fase 2 | 08 D1–D4; 03 §2 | **Resolvido** (fase 1 = builtin) |
| 3 | Painel cliente + super admin | 6 telas cliente + 4 telas admin no MVP | 01 §2/§4; Produto §3 | **Parcial** — ⚠️ escopo mínimo do super admin a fechar (P2) |
| 4 | Cliente pausa/inicia | `docker stop` (RAM 100% liberada), cobra só disco; start p95 <5 s | 06 D4; 03 §7 | **Resolvido** |
| 5 | Cobrança por hora | Metering por minuto, exibe por hora, saldo pré-pago; congela quando o nó fica mudo | 07; 11 O4 | **Parcial** — ⚠️ margem não fecha na frota atual; regra do compromisso pendente (P5) |
| 6 | MySQL + PostgreSQL | MariaDB 11.8 (UI "MySQL") + PostgreSQL 17, compartilhados por nó | 09 D1/D2 | **Resolvido** (PITR por cliente fora do MVP) |
| 7 | Trocar versão de linguagem por cliente | Blue/green por porta, swap atômico, **rollback <2 s**, cada cliente numa versão | 06 D6; checklist E9 | **Resolvido** |
| 8 | Gráficos no painel | CPU/RAM/disco/rede via agente; "requisições" via log da borda | 11; checklist E12 | **Parcial** — ⚠️ pipeline de "requisições" a construir (P7) |
| 9 | Super admin muda RAM/vCPU a quente | `systemctl set-property` a quente; redução abaixo do uso é recusada com procedimento | 06 D5; checklist E7 | **Parcial** — ⚠️ proration do resize sem regra (P6) |
| 10 | Instalação simples de módulo + documentação | Bootstrap por 1 comando com token; docs `operator.md`+`runbook.md` reprovam CI se ausentes; 6 manuais | 08 D6/D7; docs/ | **Parcial** — ⚠️ bootstrap do CP sem dono (P8/C18) |
| 11 | (ADENDO 1 §C) Pagamento como módulo plugável | `payment.gateway v1` + `host.payments.settle()` + teste de fachada no CI | 07 §6; 08 D3; E13 | **Resolvido** (no papel; construir E13) |
| 12 | (ADENDO 1 §A) Front obrigatoriamente Next.js | Next.js só front + API Fastify | 05 §7 | **Resolvido** (doc 03 D4 a corrigir — C19) |
| 13 | (ADENDO 1 §A) Especificação executável por IA | Checklist E1–E14 com critério de aceite testável por entrega | CHECKLIST | **Parcial** — é a própria natureza deste acervo |
| 14 | (ADENDO 2 §E) Padrão "AAA" | **AA em 100% (piso) + 24 dos 31 critérios AAA**; 7 recusados por motivo escrito; 14 portões de CI | 10 §0/§1.4/§5.6 | **Resolvido** (AA no MVP; AAA declarado sem mentir) |
| — | (ADENDO 4) Multi-região BR+EUA | BRL sempre, CP no BR, consentimento LGPD (ANPD 19/2024), `us-east1` só com ≥3 consentidos | 12 D1–D10 | **Resolvido** (no papel; ligar na Fase 2) |
| — | (ADENDO 5 §L) Dev local → produção | Modo nó único na VM Debian 13 → promover ao nó de produção | ADENDO 5; 06 | **Resolvido** (é a Fase Piloto) |

---

## 9. Decisões que ainda dependem do dono

> Nada aqui pode ser resolvido "por bom senso" pela IA durante a construção. Pendência aberta bloqueia a
> entrega que depende dela.

1. **Rodar o `veloz-node-doctor.sh` nos nós e contratar/validar a VPS 3** condicionada ao resultado
   (P11). Bloqueia absolutamente tudo.
2. **Objetivo desta fase, por escrito:** validar o produto (margem não importa por 12 meses) **ou** gerar
   renda. O acervo recomenda o primeiro (P1 / P0.5.2 — 1 parágrafo no briefing).
3. **Teste de demanda antes do Projeto B:** conversar com 10 candidatos; **≥3 "quero"** libera o billing
   real, senão o billing fica no `mod-pagamento-fake` e o produto é ferramenta interna (F0b).
4. **PSP e pessoa jurídica (nota fiscal):** decidir a conta (MEI/Simples) **antes do cliente nº 1**;
   enquanto não existir, aceitar só pessoa física. Sem isso, receber Pix de PJ sem nota é o único risco
   jurídico real do projeto (Produto §6.3).
5. **Unidade de venda: o *site* ou o *ambiente*?** Se o cliente puser 10 sites num ambiente de R$ 35, a
   densidade e a margem quebram (P3 / C17).
6. **Regras do compromisso pré-pago** ao pausar/redimensionar/cancelar durante um período já pago (P5).
7. **Escopo mínimo do super admin para lançar** — o doc 01 lista 12 telas como se fossem do dia 1 (P2).
8. **RTO/RPO declarados** substituindo a regra N-1 (inviável com provedores diferentes) e o custo do
   Object Lock por provedor (P14/P13).
9. **Escrever hoje o gatilho de parada:** 12 meses sem R$ 900/mês → encerra a venda e fica com a
   ferramenta (Produto Recomendação 10).
10. **Assinar a aprovação do planejamento** em `Plan/05-escopo-mvp.md` (P0.5.10) — é o único ato que
    autoriza a primeira linha de código de produção.

---

## 10. Como usar este acervo

**Manuais operacionais (`Plan/docs/`)** — escritos para o dono operar o que a IA construir:
- **`10-COMO-FUNCIONA.md`** — o sistema inteiro sem jargão, de uma sentada. Leia primeiro.
- **`20-INSTALAR-NO-ZERO.md`** — do servidor cru ao primeiro cliente, numerado.
- **`30-MODULOS.md`** — instalar/configurar/atualizar/remover e criar módulo.
- **`40-OPERACAO-DIARIA.md`** — runbooks: site caiu, nó sumiu, disco encheu, restaurar backup, cliente não
  pagou, suspeita de invasão.
- **`50-GLOSSARIO.md`** — todo termo técnico, uma frase cada.
- **`CHECKLIST-DESENVOLVIMENTO.md`** — as **14 entregas E1–E14**, a Fase 0 e os critérios de aceite. É o
  documento que a IA construtora segue.

**Documentos de especialista (`Plan/especialistas/`)** — consulta densa por área:
- **01 produto-ux** — mapa de navegação, inventário de features (MVP/v1/v2), telas de super admin,
  onboarding com subdomínio grátis `*.veloz.app`.
- **02 pesquisa-mercado** — concorrentes (Enhance, HestiaCP, CloudPanel, Coolify), estado da arte.
- **03 arquitetura** — control plane × data plane, sistema de módulos, modelo de dados, estados do
  ambiente. *(Atenção: D2/D3/D4/D5 revogados — ver seção 2.)*
- **04 infra-linux** — cgroups, storage, rede, runtimes multi-versão.
- **05 nodejs-nextjs** — as 22 decisões fechadas, stack, agente SEA, integração Node×Linux.
- **06 multitenancy-runtime** — densidade (14), pausar/resize/troca de versão, isolamento, o que o cliente
  pode fazer no container.
- **07 billing-metering** — preços, ponto de equilíbrio, `payment.gateway`, inadimplência, escada de
  desconto, gatilho do nó de 64 GB.
- **08 modulos-instalacao** — catálogo de módulos, `module.yaml`, instalação, bootstrap de nó,
  `veloz-node-doctor.sh`.
- **09 banco-backup** — MariaDB/PG tuning, backup (restic+B2 Object Lock+Magalu), restore (matriz, RTO/RPO).
- **10 acessibilidade** — AA piso + 24 AAA adotados / 7 recusados, 14 portões de CI, Core Web Vitals.
- **11 observabilidade** — VictoriaMetrics 21 d + rollup Postgres 13 m, os 13 alertas, retenção de log.
- **12 multiregiao-dominios** — região, LGPD/EUA, moeda BRL, DNS (PowerDNS + HE.net), TLS, registrar
  (fora do produto).
- `_pesquisa-dns-acme-anycast.md` — material bruto verificado de DNS/ACME/anycast.

**Críticas (`Plan/criticas/`)** — leitura útil e desconfortável:
- **ciclo-1-critica.md** — viabilidade, os 3 achados que reordenam tudo (node-doctor, densidade, IA
  construtora), 7 bloqueadores, ordem de marcha, E0–E14.
- **ciclo-2-critica.md** — consistência entre docs: veredito **densidade = 14** (§1.5), **o disco não
  fecha** (Achado 1.2), o ponto de equilíbrio inatingível.
- **ciclo-2-critica-produto.md** — "isso *deve* ser construído?": as 5 justificativas, o MVP mínimo, a
  proposta de valor honesta, os 10 pontos da Recomendação ao dono.

**Onde procurar por dúvida:**
- *"Isto vale a pena?"* → `criticas/ciclo-2-critica-produto.md` + seção 1 e 4 deste documento.
- *"O que construir primeiro?"* → `docs/CHECKLIST-DESENVOLVIMENTO.md` + seção 6.
- *"Como cobrar?"* → `07-billing-metering.md` + seção 3.
- *"Como não perder o dado do cliente?"* → `09-banco-backup.md` + seção 7 (D3).
- *"O hardware serve?"* → `Plan/scripts/veloz-node-doctor.sh` + Fase 0.
- *"Isto é acessível?"* → `10-acessibilidade-qualidade.md` + requisito 14.

---

> **Fim do planejamento.** Próximo ato do dono: rodar o `node-doctor`, ter as 10 conversas, e — se decidir
> seguir — assinar a aprovação em `Plan/05-escopo-mvp.md`. Nenhuma linha de código de produção antes disso.
