# 02 — Pesquisa de Mercado & Tecnologia (estado da arte 2026)

> Especialista: Pesquisa de Mercado & Tecnologia
> Base: `Plan/00-BRIEFING.md`
> Data da pesquisa: agosto/2026 · 32 buscas/fetches na web
> Contexto de decisão fixo em todo o documento: **time de 1–3 pessoas, 2–3 servidores dedicados, mercado BR**.

## Como ler este documento
Cada seção traz: (a) **fatos verificados** com link, (b) **tabela comparativa**, (c) **recomendação única** com justificativa.
Onde a informação pública é escassa ou contraditória, está marcado com ⚠️ **incerto — validar em PoC**.

---

## 1. Painéis de hospedagem existentes

### 1.1 Fatos

**Comerciais clássicos**
- **cPanel/WHM**: preço por conta e por faixa. Em 2026: Solo ~US$ 17/mês (1 conta), Admin ~US$ 30–35 (5 contas), Pro ~US$ 48–53 (30 contas), Premier ~US$ 57 (100 contas) + **US$ 0,30→0,35 por conta adicional**. Isolamento real de shared hosting **não vem do cPanel**, vem do CloudLinux (LVE + CageFS) vendido à parte. Fonte: [LicensePanel](https://licensepanel.io/cpanel-license-pricing-2026/), [adminbolt](https://adminbolt.com/blog/hosting-control-panel-pricing-compared/), [panelica](https://panelica.com/blog/hidden-licensing-math-500-cpanel-accounts-real-annual-cost).
- **Plesk**: licença **por servidor**, não por conta — Web Admin US$ 16,99, Web Pro US$ 29,99, Web Host US$ 62,99/mês. Fonte: [adminbolt](https://adminbolt.com/blog/cpanel-vs-plesk-vs-directadmin-showdown/).
- **DirectAdmin**: ~US$ 5/mês com contas ilimitadas no tier Standard; custo efetivo cai a ~US$ 0,03/conta em 1000 contas. É o "barato que funciona". Fonte: [adminbolt](https://adminbolt.com/blog/is-directadmin-cheaper-than-cpanel/), [ispmanager](https://www.ispmanager.com/blog/cpanel-vs-directadmin-2026).

**Modernos / open source**
- **Enhance** — o mais próximo do que o VelozPanel quer ser. Escrito em **Rust**, **cada site roda no próprio container Linux leve** ("zero-overhead lightweight Linux container"), mesmo sob a mesma assinatura. Multi-servidor por **papéis** (Application, Database, Backup, Email, DNS) de 1 a 10.000+ servidores, **US$ 0 por servidor**. Suporta LiteSpeed/OLS/Apache/NGINX e MySQL/MariaDB/**PostgreSQL**, permite trocar o web server ou **mover o site entre servidores a quente**. Preço: **US$ 0,15/site/mês** (1–5k sites), US$ 0,10 (5k–25k), US$ 0,075 (25k–100k), mínimo US$ 10/mês. Já inclui staging, backup incremental, resource limits, WordPress toolkit, API com paridade total. Fontes: [enhance.com/features](https://enhance.com/features), [enhance.com/pricing](https://enhance.com/pricing), [community.enhance.com — arquitetura multi-servidor](https://community.enhance.com/d/2319-feedback-on-multi-server-architecture-for-hosting-70-websites).
- **CyberPanel**: motor único **OpenLiteSpeed/LiteSpeed Enterprise**. Ótima performance de cache, mas **histórico de segurança péssimo**: CVE-2024-51378 (CVSS 9.8–10, RCE pré-autenticação em `dns/views.py`) foi explorada em massa pelo ransomware **PSAUX/C3RB3R/Babuk** atingindo **22.000+ servidores**, com ~61.000 painéis expostos na internet. Fontes: [Censys](https://censys.com/advisory/cve-2024-51378/), [SonicWall](https://www.sonicwall.com/blog/critical-cyberpanel-vulnerability-cve-2024-51378-how-to-stay-protected), [SOCRadar](https://socradar.io/blog/over-22000-cyberpanel-servers-at-risk-from-critical-vulnerabilities-exploitation-by-psaux-ransomware/).
- **HestiaCP**: camada de **scripts Bash** sobre stack padrão (Nginx + Apache + PHP-FPM + MariaDB/PostgreSQL + Exim + Dovecot). Simples, auditável, sem container. Fonte: [forgenex](https://www.forgenex.com/en/blog/hestiacp-vs-cyberpanel-la-batalla-silenciosa-por-el-control-de-tu-hosting).
- **CloudPanel**: NGINX + PHP-FPM enxuto, foco em dev/cloud, sem multi-tenant real. Fonte: [aapanel blog](https://www.aapanel.com/blog/best-cloudpanel-alternatives-compared/).
- **aaPanel**: feature-heavy (Docker manager, code editor, 1-click apps), origem chinesa, **paywall de plugins**. Fonte: [ctrlops](https://ctrlops.io/blog/aapanel-alternatives).
- **ISPConfig**: multi-servidor master/slave (web, mail, DNS separados) — a visão certa, mas **implementação Perl datada, replicação de banco quebra sob carga**, debug distribuído difícil. Mindshare 21,2% (fev/2026). Fonte: [panelica](https://panelica.com/blog/ispconfig-alternative-2026-multi-server-management), [PeerSpot](https://www.peerspot.com/products/comparisons/froxlor-server-management-panel_vs_ispconfig).
- **Froxlor**: arquitetura enxuta, single-server, mindshare subindo (2,4% → 6,7%). **Webuzo**: painel multiusuário genérico, pouco relevante para o caso.

### 1.2 Tabela

| Painel | Isolamento | Stack | Licença | O que aproveitar |
|---|---|---|---|---|
| cPanel/WHM | usuário Unix (+CloudLinux LVE/CageFS pago) | Apache/EA4, PHP-FPM, Exim, BIND | US$/conta, caro | Vocabulário do usuário final (addon domain, alias, subdomínio, cron, FTP) |
| Plesk | usuário Unix + chroot opcional | nginx+Apache | US$/servidor | Extension framework (módulos!) |
| DirectAdmin | usuário Unix | Apache/nginx/OLS | US$5/mês ilimitado | Simplicidade brutal; templates de config |
| **Enhance** | **1 container por site** | Rust, OLS/nginx/Apache, MySQL/PG | **US$0,15/site**, 0 por servidor | **Modelo de papéis por servidor + container por site + API 1:1 com a UI** ← copiar |
| CyberPanel | usuário Unix | OpenLiteSpeed, Python/Django | GPL / LSWS pago | Cache LiteSpeed; **antimodelo de segurança** |
| HestiaCP | usuário Unix + quota | Bash + stack padrão | GPL | Templates nginx/PHP-FPM parametrizados |
| CloudPanel | usuário Unix | nginx + PHP-FPM | MIT-ish | UI limpa, curva de aprendizado |
| aaPanel | usuário Unix / Docker opcional | LNMP | free + plugins pagos | Marketplace de apps |
| ISPConfig | usuário Unix + jailkit | Perl + PHP | BSD | **Modelo master/slave e o que evitar nele** |
| Froxlor | usuário Unix | PHP | GPL | Código pequeno para leitura |

### 1.3 Recomendação
**Modelar o VelozPanel pelo Enhance, não pelo cPanel.** Concretamente: (1) **um ambiente = um container**, não um usuário Unix; (2) **servidores têm papéis** (app / db / backup / mail / dns) declarados no banco de controle, com o painel escolhendo onde colocar; (3) **API primeiro, UI consome a própria API** — isso é o que viabiliza revenda, CLI e automação depois sem retrabalho.
Estudar código de **HestiaCP** (templates de vhost/PHP-FPM) e **Froxlor** (modelo de dados) porque são pequenos e legíveis; **não** usar CyberPanel como referência (histórico de RCE crítico com exploração em massa).

---

## 2. PaaS modernos self-hosted

### 2.1 Fatos
- **Coolify** — o líder de mercado open-source (~57k estrelas GitHub em jun/2026). Laravel/PHP + Docker. Bancos 1-click (PostgreSQL, MySQL, MongoDB, Redis) com backup agendado para S3, preview deploy por PR, multi-servidor. Fonte: [selfhostable.dev](https://selfhostable.dev/blog/coolify-vs-caprover-vs-dokku/), [buildmvpfast](https://www.buildmvpfast.com/blog/coolify-vs-dokku-vs-caprover-self-hosted-paas-production-2026).
- **Dokploy** — ~34,5k estrelas, já passou CapRover. **Docker Swarm + Traefik**, UI mais leve/rápida que Coolify, mas **pré-1.0** e menos testado em produção. Fonte: [bitdoze](https://www.bitdoze.com/coolify-vs-dokploy-vs-kamal-2/), [deploynix](https://deploynix.io/blog/self-hosted-paas-showdown-2026-coolify-vs-dokploy-vs-caprover-vs-deploynix).
- **CapRover** — Docker Swarm, marketplace 1-click, **desenvolvimento desacelerado**.
- **Dokku** — ~32k estrelas, **10 anos de produção**, só CLI (GUI é Dokku Pro, US$ 849 vitalício). Buildpacks Heroku nativos.
- **Kamal 2** (37signals/Basecamp) — **sem painel, sem daemon no servidor**: é uma gem Ruby rodada do laptop/CI. Trocou Traefik pelo **kamal-proxy** próprio (imperativo) porque esperar o Traefik detectar config atrasava o deploy. Fonte: [kamal-deploy.org](https://kamal-deploy.org/docs/upgrading/proxy-changes/), [nts.strzibny.name](https://nts.strzibny.name/kamal-proxy/).
- **Cloudron** — cada app em **container Docker com filesystem read-only**, só `/run`, `/app/data` e `/tmp` graváveis; `CloudronManifest.json` declara portas e addons; **serviços (bancos) compartilhados mas isolados entre apps**; backup **por app** (não snapshot), criptografado, para S3/GCS/Spaces, permitindo migrar o Cloudron inteiro de provedor. 100+ apps curados. Fonte: [docs.cloudron.io/packages](https://docs.cloudron.io/packages/), [docs.cloudron.io/backups](https://docs.cloudron.io/backups/).
- **RunCloud / Ploi / Laravel Forge** — gerenciam servidores do cliente, isolamento por **usuário Unix**, não container. Um pesquisador reportou falhas de isolamento: Ploi investigou 2 meses, RunCloud algumas semanas, **Forge "não se importou"**. Fonte: [forum.cloudron.io](https://forum.cloudron.io/topic/11869/security-hole-in-cloud-hosting-control-panels-article-vladimir-vs-hosting-industry).

### 2.2 Tabela

| Ferramenta | Deploy | Isolamento | Multi-versão de runtime | Multi-servidor | Licença |
|---|---|---|---|---|---|
| Coolify | git push / Dockerfile / compose / nixpacks | container Docker | via imagem/buildpack | sim (agentes SSH) | Apache-2.0 |
| Dokploy | git / compose | Docker Swarm | via imagem | sim (Swarm workers) | Apache-2.0 |
| CapRover | git / Dockerfile | Docker Swarm | via imagem | sim | Apache-2.0 |
| Dokku | `git push dokku` | Docker + buildpacks | **buildpack escolhe** | limitado | MIT |
| Kamal 2 | CLI/CI, imagem OCI | Docker + kamal-proxy | via imagem | sim (hosts declarativos) | MIT |
| Cloudron | pacote curado | Docker read-only FS | via imagem do pacote | não (1 servidor) | pago |
| RunCloud/Ploi/Forge | git deploy em servidor do cliente | **usuário Unix** | php-fpm multi-versão | agente por servidor | SaaS pago |

### 2.3 Recomendação
**Roubar o modelo mental do Dokku/Coolify (git push → build → container roda) mas com o vocabulário do cPanel (domínio, e-mail, banco, cron, FTP) na UI.** É exatamente o vazio de mercado: PaaS moderno com cara de hospedagem.
**Não** usar Docker **Swarm** (Dokploy/CapRover) — Swarm está em manutenção há anos; com 2–3 servidores, **agente próprio por servidor + Docker/Podman local** é mais simples de debugar e não te prende a um orquestrador semi-abandonado.
Copiar do Cloudron duas ideias fortes: **backup por app/ambiente (não snapshot de VM)** e **manifesto declarativo do ambiente** (`velozpanel.yml`) versionado junto ao site.

---

## 3. Isolamento multi-tenant em 2026

### 3.1 Fatos
- **Docker/OCI padrão**: namespaces + seccomp bloqueando ~44 syscalls. **Insuficiente sozinho para código hostil multi-tenant**; rootless elimina o risco do daemon root mas não o kernel compartilhado. Fonte: [dev.to — sandboxing 2026](https://dev.to/manveerchawla/how-to-sandbox-ai-agents-in-2026-firecracker-gvisor-runtimes-isolation-strategies-14pk).
- **gVisor**: intercepta syscalls em user space. Syscall simples **2,2× mais lento** (~800ns vs ~70ns nativo); +40–150ms de startup; **10–25% de penalidade em workloads syscall-heavy tipo sqlite/nginx**; **I/O e rede são o pior caso — bancos sofrem**. Mas no Ant Group em escala: **70% dos apps com <1% de overhead, 25% com <3%**. Fontes: [gvisor.dev/production](https://gvisor.dev/docs/user_guide/production/), [Ant Group](https://gvisor.dev/blog/2021/12/02/running-gvisor-in-production-at-scale-in-ant/), [safeguard.sh](https://safeguard.sh/resources/blog/container-runtime-runc-vs-crun-vs-gvisor-2026).
- **Firecracker/microVM**: VM real sobre KVM, boot ~125ms, isolamento mais forte. Custo: kernel por tenant, RAM dedicada, densidade menor. Fonte: [alekseialeinikov](https://www.alekseialeinikov.com/en/blog/topics/devops/microvms-firecracker-vs-gvisor-secure-workloads-2026), [pistack](https://www.pistack.xyz/posts/2026-05-09-microvm-platforms-firecracker-cloud-hypervisor-crosvm-guide/).
- **LXC/Incus**: system containers (distro inteira menos kernel, init próprio). Incus é o fork comunitário do LXD pelos autores originais; **mesma API para container LXC e VM KVM**, **live migration**, controle fino de CPU/memória/rede/storage, roda como serviço em qualquer distro (não precisa ser o SO do host, ao contrário do Proxmox). Fontes: [gyptazy](https://gyptazy.com/blog/incus-for-containers-and-vms-a-powerful-proxmox-alternative-a-step-by-step-guide-to-build-a-cluster/), [xylentis](https://xylentis.com/blog/migrating-from-proxmox-to-incus-the-ultra-lightweight-kernel-level-container-and-vm-management-solution).
- **systemd-nspawn**: boota userspace completo com systemd como PID 1; controles de recurso via cgroups v2 na seção `[Exec]` do `.nspawn`; mais simples de configurar que LXC. Fonte: [ArchWiki](https://wiki.archlinux.org/title/Systemd-nspawn).
- **Usuário Unix + chroot (clássico)**: é o que cPanel/DirectAdmin/Hestia/RunCloud/Ploi/Forge fazem. Densidade máxima, **isolamento fraco** — o ataque de symlink e a leitura de `/etc/passwd`/config de outros clientes são o pão-com-manteiga do shared hosting. A resposta comercial é **CloudLinux CageFS** (filesystem virtualizado por usuário, só binários seguros visíveis) **+ LVE** (limites por usuário). Equivalentes open source citados: **cgroups v2** no lugar do LVE e **grsecurity** no lugar do CageFS — mas "exigem integração num sistema só, enquanto o CloudLinux vem integrado". Fontes: [blog.adly.dev](https://blog.adly.dev/comparing-cloudlinux-to-open-source-alternatives-part-1/), [HostingSpell](https://hostingspell.com/blog/what-are-cloudlinux-lve-and-cagefs/).
- **Densidade de containers**: ~220 MB/container de overhead somado (10 MB runtime + app + 10 MB metadata) → **num servidor com 128 GB, 100–200 containers confortáveis, ~500 no limite**, contra 10–15 VMs. Fonte: [oneuptime](https://oneuptime.com/blog/post/2026-01-16-containers-vs-vms-density-efficiency-comparison/view).
- **Quem usa o quê**: Enhance = 1 container por site em produção comercial de hosting; Cloudron = Docker read-only por app; cPanel/DA/Hestia/Plesk/Forge/RunCloud/Ploi = usuário Unix; Fly.io = Firecracker; Google/Ant = gVisor.

### 3.2 Tabela

| Tecnologia | Segurança | Densidade | Complexidade p/ 1 dev | Multi-versão de runtime | Veredito |
|---|---|---|---|---|---|
| Usuário Unix + chroot | ★★☆☆☆ | ★★★★★ | ★★★★★ (baixa) | php-fpm pools OK, Node feio | Só se o cliente não tiver shell/PHP arbitrário — não é o caso |
| Usuário Unix + CloudLinux | ★★★★☆ | ★★★★★ | ★★★★☆ | ótimo (alt-php) | Resolve, mas **licença paga por servidor e te amarra ao ecossistema cPanel-like** |
| **Docker/Podman rootless** | ★★★☆☆ | ★★★★☆ | ★★★★★ | **trivial (imagem por versão)** | **Melhor custo-benefício com user namespaces por tenant** |
| systemd-nspawn | ★★★☆☆ | ★★★★☆ | ★★★☆☆ | manual | Sem ecossistema de imagens; pula |
| LXC/Incus | ★★★★☆ | ★★★★☆ | ★★★☆☆ | manual dentro do container | Excelente para "VPS gerenciado", pesado para "1 site" |
| gVisor (runsc) | ★★★★☆ | ★★★★☆ | ★★★☆☆ | igual Docker | **Plugável depois** como runtime opcional para tenant suspeito |
| Firecracker/microVM | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ | igual VM | Só se vender "VPS isolado" como tier premium |

### 3.3 Recomendação
**Docker (ou Podman) com um container por ambiente, rodando rootless/com userns-remap, cgroups v2 para CPU/RAM, e quota de disco no filesystem — com `runsc` (gVisor) plugável como runtime opcional.**

Justificativa: (1) resolve o requisito 7 do briefing (multi-versão de runtime) **de graça**, porque versão de linguagem vira tag de imagem; (2) resolve o requisito 4 e 5 (pausar/iniciar e cobrar por hora) porque `docker stop` é o evento de faturamento; (3) resolve o requisito 9 (super admin muda RAM/vCPU a quente) via `docker update --memory --cpus` sem restart; (4) densidade de 100–200 ambientes por servidor cabe em 2–3 servidores por anos; (5) 1 dev consegue debugar Docker às 3h da manhã — não consegue debugar Firecracker.

O que **não** fazer: (a) não misturar containers de clientes diferentes no mesmo user namespace; (b) não montar socket do Docker dentro de container de cliente, nunca; (c) o container do cliente **não** roda como root nem com `--privileged`; (d) mesmo com container, aplicar `noexec,nosuid,nodev` no volume de dados e `open_basedir`/`disable_functions` no PHP — defesa em profundidade, porque container escape existe.
**Manter o gVisor como plano B documentado**: se um tenant abusar, troca-se o runtime dele sem reescrever nada. Registrar `runtime` como coluna do ambiente desde o dia 1.

---

## 4. Cobrança por hora / metered billing

### 4.1 Como o mercado cobra
| Provedor | Modelo | Detalhe crítico |
|---|---|---|
| **Fly.io** | **por segundo**, machine parada não paga CPU/RAM | máquina parada paga só rootfs **US$ 0,15/GB/30d**; volume continua cobrando. [fonte](https://www.toolpick.dev/reviews/fly-io-review) |
| **Railway** | assinatura + **por segundo** de CPU/RAM/volume/egress | US$ 10/GB RAM/mês, US$ 20/vCPU/mês; a assinatura vira crédito. [fonte](https://northflank.com/blog/railway-vs-flyio) |
| **Render** | **preço fixo** de instância | paga parado ou ocupado (Starter ~US$7, Standard ~US$25). [fonte](https://hostim.dev/blog/render-vs-railway-vs-fly-pricing/) |
| **Hetzner** | **por hora com teto mensal**; relógio começa na criação e para na **exclusão** | **desligar NÃO para o faturamento** — disco e IP seguem reservados. Snapshot €0,0143/GB/mês. [fonte](https://cloudtally.eu/blog/why-hetzner-charges-for-stopped-servers) |
| **DigitalOcean** | por hora com teto mensal, mesma lógica de "existe = cobra" | idem |
| **Hostoo** | **créditos pré-pagos descontados por hora** conforme serviços ativos e plano; permite alternar entre mensal tradicional e por hora; upgrade/downgrade de plano em 1 clique | [hostoo.io/supercloud](https://hostoo.io/supercloud/), [hostoo.io/revenda](https://hostoo.io/revenda/) (white-label para agências) |

**Ponto de decisão que o mercado já resolveu**: Fly.io é o único que realmente **para de cobrar** o compute quando você para a máquina, e mesmo assim continua cobrando o disco. O briefing (item 5) pede exatamente isso — **ambiente pausado cobra só disco**. Isso é uma vantagem competitiva real sobre Hetzner/DO e está alinhado com o Hostoo.

### 4.2 Arquitetura de metering
- **Padrão canônico** (Lago): ingestão de eventos crus → **`transaction_id` único garante idempotência** e impede cobrança dupla → agregação em métricas faturáveis (COUNT, UNIQUE COUNT, SUM, MAX, SQL custom) → aplicação de preço → fatura. Lago ingere até 1M eventos/s via REST, batch, SDK, Kafka, Kinesis, S3. Fontes: [Lago — playbook de arquitetura de billing](https://getlago.com/blog/architect-billing-systems), [Lago metering](https://getlago.com/platform/usage-metering).
- **Todos** (Lago, Orb, Metronome) usam chave de idempotência: mesmo evento duas vezes = um registro.
- **Metronome** aceita ingestão **pré-agregada** e integra CloudWatch/Datadog — métricas de infra viram evento de cobrança **sem passar pelo código da aplicação**. Fonte: [Lago vs Metronome](https://getlago.com/blog/lago-vs-metronome).
- **Stripe**: desde a API `2025-03-31.basil` a API antiga de usage records **morreu**; todo preço metered exige um **Meter**. Em março/2026 lançaram metering para tokens de LLM. **Stripe Billing cobra +0,7%** sobre assinaturas usage-based. Fontes: [docs.stripe.com/api/billing/meter](https://docs.stripe.com/api/billing/meter), [PYMNTS](https://www.pymnts.com/news/artificial-intelligence/2026/stripe-introduces-billing-tools-to-meter-and-charge-ai-usage/).
- **OpenMeter**: só metering (sem faturamento), open source — bom se você quer o motor de agregação e escreve a fatura você mesmo.

### 4.3 Pagamentos BR
| Meio | Recorrência | Pré-pago/saldo | Taxa (2026) | Observação |
|---|---|---|---|---|
| **Asaas** | sim (assinaturas nativas) + Pix Automático | sim (conta digital com saldo, split, subcontas) | **Pix R$1,99** (promo R$0,99), boleto R$1,99, cartão R$0,49+2,99%, **NF-e R$0,49/nota** | [precos-e-taxas](https://www.asaas.com/precos-e-taxas), [docs.asaas.com](https://docs.asaas.com/docs/visao-geral). **Sem taxa de integração.** Emite nota fiscal. |
| Pagar.me | sim, split forte | não nativo | ~% por transação | referência para marketplace/split |
| Iugu | sim | parcial | % | participante Pix Automático |
| Stripe BR | sim, metered nativo | não | +0,7% Billing sobre o processamento | melhor motor de billing, pior fit fiscal BR |
| Mercado Pago | sim | sim (conta MP) | % | ótima conversão B2C |
| Vindi/Cielo/Stone | sim | — | % | Pix Automático suportado |

**Pix Automático**: participantes incluem Stripe Brasil, Pagar.me, Mercado Pago, Stone, Cielo, **Asaas**, Iugu, Vindi, PagSeguro; MDR típico 0,8%–1,5%. Fonte: [FWC](https://fwctecnologia.com/blog/post/pix-automatico-apps-recorrencia-sem-cartao-2026), [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/).

### 4.4 Recomendação
**Metering caseiro + Asaas como PSP.** Nada de Lago/OpenMeter/Stripe Billing no dia 1.

Motivo: o volume de eventos aqui é **ridiculamente pequeno** — não é API SaaS com milhões de chamadas, é "N ambientes × 1 amostra por minuto". Com 300 ambientes são 432k linhas/mês, que o Postgres engole sem suar. Um Lago inteiro na infra para isso é overhead operacional puro para 1 dev.

Desenho concreto:
1. **Tabela `usage_events`** append-only: `(environment_id, metric, quantity, period_start, period_end, idempotency_key UNIQUE)`. A chave de idempotência é `env_id:metric:period_start` — reenvio do agente **nunca** duplica. Este é o padrão do Lago, só que dentro do seu Postgres.
2. **Agente amostra por minuto**, painel **agrega por hora** (job idempotente que faz `INSERT ... ON CONFLICT DO NOTHING` em `usage_hourly`).
3. **Cobrar o estado, não a média**: se o ambiente esteve *running* em qualquer momento da hora, cobra a hora cheia do plano; se esteve só *paused*, cobra a tarifa de disco. Regra simples, explicável ao cliente, e imune a perda de amostra. (Fly cobra por segundo; para 1 dev, **hora é a granularidade certa** — é o que o Hostoo faz.)
4. **Saldo pré-pago em centavos**, débito horário, com `ledger` append-only (nunca UPDATE em saldo — sempre lançamento). Recarga via **Pix (Asaas)**, autorecarga opcional no cartão.
5. **Regra de tolerância**: saldo negativo → aviso em D+0, pausa automática em D+3, retenção do disco por 15 dias, purga em 30. Escrever isso nos Termos **antes** de codar.

Por que Asaas: única da lista que junta **Pix + boleto + cartão + assinatura + saldo/subconta + split + emissão de NF-e a R$0,49** numa API só, sem taxa de integração — para 1–3 pessoas isso elimina uma integração fiscal inteira. Stripe entra depois, só se houver cliente internacional.

---

## 5. Multi-versão de runtime

### 5.1 Fatos
- **PHP bare-metal**: cada versão instalada expõe seu próprio serviço FPM (`php7.4-fpm`, `php8.3-fpm`...) com socket Unix próprio; o vhost aponta para o socket certo. Debian/Ubuntu via **PPA ondrej/sury**; RHEL/Alma/Rocky via **Remi**. Fontes: [oneuptime Ubuntu](https://oneuptime.com/blog/post/2026-03-02-how-to-install-multiple-php-versions-on-ubuntu/view), [oneuptime RHEL](https://oneuptime.com/blog/post/2026-03-04-install-multiple-php-versions-side-by-side-rhel/view), [DCHost](https://www.dchost.com/blog/en/one-server-many-phps-how-i-run-per%E2%80%91site-nginx-php%E2%80%91fpm-pools-without-the-drama/).
- **Ciclo de vida PHP (crítico para o produto)**: 7.4 EOL 28/11/2022; 8.0 EOL 26/11/2023; **8.1 EOL 31/12/2025**; suportadas hoje: **8.2, 8.3, 8.4**. Ou seja, **PHP 7.4–8.1 é território de "legado sem patch de segurança"** — precisa ser oferecido (o mercado brasileiro exige), mas **em container isolado e com aviso explícito na UI**.
- **Node**: `fnm` (Rust) é o substituto moderno do `nvm`, 10–40× mais rápido, lê `.nvmrc`; `Volta` fixa versão no `package.json`. Para servidor, a recomendação corrente é **fixar a versão no artefato de deploy** e usar LTS. Fontes: [pkgpulse](https://www.pkgpulse.com/guides/fnm-vs-nvm-vs-volta-nodejs-version-managers-2026), [DeployHQ](https://www.deployhq.com/guides/node-version-managers).
- **Buildpacks**:
  - **Nixpacks** (Railway, Rust, gera Dockerfile/OCI direto sem lifecycle de buildpack) está **em modo manutenção**; a própria Railway recomenda o sucessor.
  - **Railpack** (Railway, beta desde **04/03/2026**, Go + **BuildKit**, abandonou Nix): **imagens Node 38% menores, Python 77% menores**, melhor cache — mas **beta com suporte limitado de linguagens**.
  - **Cloud Native Buildpacks (CNB)**: spec incubada na CNCF, base do Paketo, descendente direto dos buildpacks do Heroku; padrão enterprise, mais maduro, porém mais pesado.
  - Fontes: [bitdoze](https://www.bitdoze.com/nixpacks-vs-railpack/), [bex.co](https://bex.co/blog/2026/07/13/railway-nixpacks-railpack-buildkit), [devopsboys](https://devopsboys.com/blog/nixpacks-vs-buildpacks-vs-dockerfile-review-2026).

### 5.2 Tabela

| Abordagem | Troca de versão | Isolamento | Custo p/ 1 dev | Abre outras linguagens? |
|---|---|---|---|---|
| php-fpm pools (sury/remi) | mudar socket + reload nginx | nenhum extra | baixo | **não** |
| **Imagem OCI por versão** | **trocar tag + recriar container (segundos)** | herda o do container | baixo (você já tem Docker) | **sim, trivialmente** |
| nvm/fnm no host | mudar PATH do serviço | nenhum | médio (frágil) | não |
| CNB/Paketo | rebuild | herda | **alto** (lifecycle, builder, stack) | sim |
| Railpack | rebuild | herda | médio, **beta** | parcial |
| Nixpacks | rebuild | herda | médio, **manutenção** | sim |

### 5.3 Recomendação
**Imagens OCI próprias, uma por (linguagem × versão), publicadas num registry interno. Zero buildpack no dia 1.**

- `velozpanel/php:7.4-fpm`, `:8.0`, `:8.1`, `:8.2`, `:8.3`, `:8.4` — todas com o **mesmo entrypoint e mesmo layout de paths**, para que trocar a versão seja literalmente trocar a tag e recriar o container. Isso entrega o requisito 7 do briefing com um dropdown.
- `velozpanel/node:18|20|22|24` idem. Python/Go/Ruby/Bun/Deno entram depois **sem mudar nada na arquitetura** — é só publicar mais uma imagem, o que satisfaz o requisito 1.
- **Botão "testar antes de aplicar"**: subir o container novo em paralelo, apontar o proxy para ele por 60s numa URL de preview, e só então promover. Trocar PHP 7.4→8.3 quebra site — o painel que faz isso com rollback de 1 clique é um diferencial vendável.
- **Buildpack só quando existir demanda de "git push e adivinhe minha stack"**: aí a aposta é **Railpack** (é o caminho que a Railway escolheu depois de queimar o Nixpacks) — mas revisar a maturidade, hoje é beta. **CNB é overkill** para 1–3 pessoas.
- **Regra de produto**: versões EOL (7.4/8.0/8.1) disponíveis, mas com badge vermelho "sem atualizações de segurança", **preço igual** e **cláusula de responsabilidade na AUP**.

---

## 6. Observabilidade barata

### 6.1 Fatos
- **VictoriaMetrics vs Prometheus** no benchmark de node_exporter: VM estável em **4,3 GB RSS**, Prometheus subindo de 6,5 GB para **14 GB com picos de 23 GB**. Prometheus consome ~8 GB RAM por milhão de séries ativas; VictoriaMetrics ~1 GB. Fontes: [valyala/Medium](https://valyala.medium.com/prometheus-vs-victoriametrics-benchmark-on-node-exporter-metrics-4ca29c75590f), [Last9](https://last9.io/blog/prometheus-vs-victoriametrics/), [pkgpulse](https://www.pkgpulse.com/guides/prometheus-vs-victoriametrics-vs-grafana-mimir-metrics-2026).
- **cAdvisor é caro**: relato de que sozinho consumia mais CPU que todo o resto da stack de monitoramento junto. Fonte: [medium/veerendra](https://veerendra2.medium.com/how-i-simplified-my-homeserver-monitoring-stack-b1a29b5013b9).
- **Netdata**: ~200 MB RAM para 5.000 métricas/s (docs oficiais); no mundo real **200–500 MB por agente**. Stack Prometheus+node_exporter: 1–3 GB; +Grafana: 2–4 GB. Fontes: [Netdata](https://www.netdata.cloud/blog/netdata-vs-prometheus-2025/), [devopsboys](https://devopsboys.com/blog/netdata-monitoring-review-vs-prometheus-2026), [instapods](https://instapods.com/blog/best-server-monitoring-tools/).

### 6.2 Tabela (3 servidores, ~150 ambientes)

| Stack | RAM total estimada | Esforço | Gráficos no painel do cliente |
|---|---|---|---|
| Prometheus + node_exporter + cAdvisor + Grafana | **2–4 GB+** | médio | via iframe Grafana (feio, multi-tenant difícil) |
| **VictoriaMetrics single + vmagent + node_exporter** | **~300–600 MB** neste porte | baixo-médio | **API PromQL própria → gráficos no seu front** |
| Netdata (agente por nó + parent) | 600 MB–1,5 GB (3 agentes) | muito baixo | UI própria, difícil de embutir multi-tenant |
| Só agente próprio → Postgres/Timescale | ~0 extra | baixo, mas você escreve tudo | total controle |

### 6.3 Recomendação
**VictoriaMetrics single-node + vmagent + node_exporter, sem cAdvisor e sem Grafana; gráficos desenhados no próprio front consumindo a API PromQL do VictoriaMetrics.**

Justificativa: (1) VM é **um binário Go, um processo, um diretório de dados** — instalação e backup triviais para 1 dev, contra Prometheus+Grafana+datasources; (2) o ganho de 5–10× em RAM importa muito quando os 3 servidores são para **vender**, não para monitorar; (3) **cAdvisor está fora** — as métricas por container vêm direto de `/sys/fs/cgroup` lidas pelo agente do VelozPanel, que **já vai existir** para o metering de cobrança. **Um agente só serve gráfico e fatura** — é a economia estrutural do projeto; (4) Grafana embutido cria pesadelo de multi-tenancy (o cliente A não pode ver a dashboard do B) — como você já tem front próprio, 4 gráficos (CPU, RAM, disco, rede/req) via API são meio dia de trabalho e ficam com a cara do produto.
Reter: 15 dias em alta resolução, 13 meses agregado por hora (a série horária **é** a base de auditoria da fatura — o cliente que contestar a cobrança vê o gráfico que a gerou).

---

## 7. Segurança de hospedagem compartilhada

### 7.1 Ataques que importam
1. **Symlink attack / travessia entre tenants** — clássico do shared hosting; a mitigação comercial é CageFS. Com **container por ambiente o vetor morre por construção** (não existe filesystem comum para atravessar).
2. **Container escape** — o vetor novo em troca. Mitigação: rootless/userns, seccomp, sem `--privileged`, sem socket do Docker montado, kernel atualizado, `runsc` para tenant suspeito.
3. **Abuso de recurso** (fork bomb, mineração, crawler) — cgroups v2 com `cpu.max`, `memory.max`, `pids.max`.
4. **Spam saindo do servidor** — o que mata a reputação do IP e derruba o e-mail de *todos* os clientes. Mitigação: rate limit de SMTP por ambiente, bloqueio de porta 25 outbound por padrão, relay obrigatório via provedor externo.
5. **PHP legado com CVE** — sites em 7.4/8.0/8.1 sem patch.

### 7.2 Ferramentas
| Ferramenta | Papel | Fato |
|---|---|---|
| **CrowdSec** | IPS colaborativo | Go, **~60× mais rápido que Fail2ban** (Python), IPv6 nativo, parsing Grok, compartilha threat intel entre instâncias. [fonte](https://selfhostedguides.com/crowdsec-vs-fail2ban/), [DoHost](https://dohost.us/index.php/2026/03/05/the-agentic-shift-comparing-fail2ban-with-crowdsec-and-wazuh-in-2026/) |
| Fail2ban | IPS local | mais implantado do mundo, simples, **regex sofre com ataque L7 moderno** |
| **Coraza** | WAF Go, SecLang | **100% compatível com OWASP CRS e sintaxe ModSecurity**, sem dependência C, footprint menor, conectores nativos Caddy/Traefik/Envoy. [coraza.io](https://www.coraza.io/docs/tutorials/introduction/), [OWASP](https://owasp.org/www-project-coraza-web-application-firewall/) |
| ModSecurity | WAF C | +2–8 ms/req, 50–150 MB RAM; **conector nginx vira gargalo acima de 10k req/s**. [pistack](https://www.pistack.xyz/posts/self-hosted-waf-bot-protection-modsecurity-coraza-crowdsec-2026/) |
| Imunify360 | AV+WAF+patch pago | ecossistema CloudLinux; sem equivalente OSS integrado |
| ClamAV | antivírus de upload/e-mail | pesado em RAM (~1 GB com signatures); rodar **só no nó de e-mail/backup**, não em todo servidor web |

### 7.3 Recomendação
**Camada 1: CrowdSec** no host (SSH, nginx, painel, FTP, SMTP) — substitui Fail2ban e ainda traz blocklist comunitária de graça.
**Camada 2: Coraza + OWASP CRS** no proxy de borda, **em modo detecção por 30 dias antes de bloquear**, com toggle por site no painel (o cliente liga/desliga o WAF dele — é feature vendável, ver seção 14).
**Camada 3: cgroups v2** com limites e **alerta automático de abuso** para o super admin.
**Camada 4: porta 25 outbound bloqueada por padrão**, envio só via relay autenticado (ver seção 8). Isso é a decisão mais importante de segurança operacional do projeto — protege a reputação do IP.
**ClamAV** só no fluxo de e-mail e no upload do gerenciador de arquivos, nunca varredura periódica do disco inteiro (custo de I/O não compensa).
**Não** comprar Imunify360 — o modelo de container já cobre o que o CageFS cobre.
**Regra de ouro tirada do caso CyberPanel**: o painel é o alvo mais valioso do servidor. **A UI do super admin não fica exposta na internet aberta** — atrás de VPN/WireGuard ou allowlist de IP + 2FA obrigatório. 22.000 servidores foram ransomeados por um bug num handler de DNS de painel.

---

## 8. E-mail em 2026

### 8.1 Fatos
- **Mailcow**: Postfix + Dovecot + Rspamd + ClamAV + SOGo + nginx + Redis + MariaDB via docker-compose. O mais "batteries-included". **~1,5 GB+ de RAM**, 8+ containers.
- **Stalwart**: **um binário Rust** cobrindo SMTP, IMAP4, POP3, JMAP, antispam e UI admin. **~100 MB de RAM**. Contra: antispam menos maduro que Rspamd, projeto mais novo.
- **Stack clássico** Postfix+Dovecot+Rspamd: 20+ anos, documentação infinita, maior pool de gente que sabe operar.
- Entregabilidade exige **MX + SPF + DKIM + DMARC**, os quatro, ou Gmail/Outlook mandam para spam.
- Fontes: [sumguy](https://sumguy.com/self-hosted-email-mailcow-mailu-stalwart/), [profor.pro](https://profor.pro/blog/self-hosted-email-2026-mailcow-stalwart-mailu/), [vectismail](https://vectismail.com/guides/best-self-hosted-email-servers-2026/), [Privacy Guides](https://www.privacyguides.org/en/self-hosting/email-servers/).
- **Terceirizar envio**: Amazon SES **US$ 0,10/1.000 e-mails**, sem mensalidade, mas é "infra crua" (você gerencia supressão e reputação); Mailgun US$ 35/mês por 50k com IP dedicado e suporte; Zoho ZeptoMail ~US$ 2,50 por 10k (relatos de aprovação de conta difícil). Fontes: [SaaSPricePulse SES](https://www.saaspricepulse.com/tools/amazon-ses), [Mailgun](https://www.saaspricepulse.com/tools/mailgun), [emailtooltester](https://www.emailtooltester.com/en/blog/best-transactional-email-service/).

### 8.2 Tabela

| Opção | RAM | Esforço de operação | Risco de reputação | Fit VelozPanel |
|---|---|---|---|---|
| Mailcow | 1,5 GB+ | alto (8 containers, upgrades) | **você é o dono do problema** | caixa postal sim, envio não |
| **Stalwart** | **~100 MB** | **baixo** | idem | **melhor candidato para caixa postal** |
| Postfix+Dovecot+Rspamd manual | ~500 MB | alto (config artesanal) | idem | só se já dominar |
| Migadu/Zoho (terceirizar tudo) | 0 | mínimo | do fornecedor | mata a feature "e-mail no painel" |
| SES/Mailgun **só para envio** | 0 | baixo | **do fornecedor** | ✅ combinar com caixa postal própria |

### 8.3 Recomendação
**Módulo de e-mail em duas metades, e essa separação é a decisão que salva o projeto:**

1. **Recebimento e caixa postal: self-hosted com Stalwart**, em um servidor com papel `mail` dedicado. 100 MB de RAM contra 1,5 GB do Mailcow importa quando se tem 3 servidores. IMAP/JMAP + webmail cobrem as telas de e-mail/webmail/antispam/listas que aparecem nos screenshots do Hostoo. ⚠️ **incerto — validar em PoC**: qualidade do antispam do Stalwart contra Rspamd treinado; se o spam entrar demais, o plano B é Mailcow.
2. **Envio (SMTP outbound): terceirizado, sempre.** Amazon SES (região `sa-east-1`) como relay padrão, com porta 25 outbound **bloqueada** para os containers de cliente. Custo de US$ 0,10/1.000 é irrisório perto do custo de um IP em blocklist.

Justificativa dura: com 2–3 servidores você tem **poucos IPs**. Um cliente com WordPress comprometido disparando spam coloca o **/24 inteiro** em blocklist e derruba o e-mail de toda a base — e no Brasil recuperar reputação de IP demora semanas. Terceirizar o envio transfere esse risco para quem tem equipe de deliverability. Configurar SPF/DKIM/DMARC automaticamente para cada domínio criado no painel (é gerar 3 registros DNS, e você já controla o DNS — ver seção 10).
**E-mail deve ser um módulo opcional e desligável** (requisito 2 do briefing) — muitos clientes vão querer Google Workspace e só precisam que o painel não atrapalhe o MX deles.

---

## 9. Backup

### 9.1 Fatos
| Ferramenta | Dedup | Object storage | Nota |
|---|---|---|---|
| **restic** | content-defined chunking, **60–80%** em workload de servidor típico | **S3, B2, R2 nativos** — ecossistema mais profundo | melhor equilíbrio velocidade/simplicidade |
| borg | melhor compressão/eficiência, mais rápido no 1º backup | **precisa de ponte SSH** para nuvem | ideal para NAS/SSH, não para S3 |
| kopia | ~igual | S3/B2 + **upload paralelo de chunks** (melhor em alta latência); restore 20–40% mais rápido que restic em benchmarks de 2026 | GUI, um pouco mais lento no backup |
| Fontes | [computingforgeeks](https://computingforgeeks.com/borg-restic-kopia-comparison/), [eastkode](https://eastkode.in/articles/restic-vs-borg-vs-kopia/), [pistack](https://www.pistack.xyz/posts/restic-vs-borg-vs-kopia-backup-guide/) | | Em arquivos >128 MB, dedup dos três fica em 95–99% |

**Object storage (preço real, ago/2026)**
| Provedor | Armazenamento | Egress | Nota |
|---|---|---|---|
| **Magalu Cloud (BR)** | **R$ 0,10/GiB/mês** (Standard) · **R$ 0,06** (Cold Instant) | **R$ 0,10/GiB** (Standard) · R$ 0,20 (Cold) | S3-compatível, **dado no Brasil** → argumento LGPD. [preços](https://magalu.cloud/precos/object-storage/) |
| Backblaze B2 | US$ 6,95/TB/mês (~R$ 0,038/GB) | **grátis até 3× o storage médio**, depois US$0,01/GB; grátis via Cloudflare/Fastly/bunny | [comparação](https://tech-insider.org/backblaze-b2-vs-wasabi-vs-s3-2026/) |
| Wasabi | US$ 7,99/TB/mês | sem taxa, mas **mínimo de 90 dias por arquivo** e política de "uso razoável" não publicada | [Backblaze vs Wasabi](https://www.backblaze.com/cloud-storage/comparison/backblaze-vs-wasabi) |
| AWS S3 sa-east-1 | mais caro | caro | só se já usar AWS |

### 9.2 Recomendação
**restic + Magalu Cloud Object Storage (Standard), com repositório por cliente e cópia local de curto prazo.**

3-2-1 barato e concreto:
- **Cópia 1 (local, servidor de origem)**: snapshot restic para disco local, retenção 3 dias → restore de "apaguei o arquivo" é instantâneo e não gasta egress.
- **Cópia 2 (offsite, Magalu)**: restic para bucket BR, retenção 7 diários + 4 semanais + 3 mensais.
- **Cópia 3 (cold)**: `restic copy` mensal para bucket **Cold Instant** (R$0,06/GiB) ou Backblaze B2, para desastre total.

Por que restic e não kopia: kopia ganha no restore, restic ganha no **ecossistema e na quantidade de gente que já debugou o mesmo problema que você vai ter às 3h da manhã**. Para 1 dev isso vale mais que 20% de restore.
Por que Magalu e não B2: **dado no Brasil resolve a conversa de LGPD com cliente corporativo antes dela começar**, e a latência intra-BR torna o restore utilizável. R$0,10/GiB é ~2,6× o B2, mas 500 GB de backup custam R$ 50/mês — irrelevante perto do argumento comercial. **Egress do Magalu é pago (R$0,10/GiB)**: orçar restore completo antes de prometer SLA.
**Regra não-negociável**: `restic check --read-data-subset` semanal + **restore automatizado de 1 ambiente aleatório por semana** com verificação. Backup não testado é ficção. E **chave de criptografia do restic fora dos servidores** — se o ransomware pegar o painel, o backup precisa sobreviver (ver caso CyberPanel/PSAUX).

---

## 10. DNS

### 10.1 Fatos
- **PowerDNS Authoritative**: guarda zonas em **banco real** (MySQL, PostgreSQL, SQLite, LMDB) em vez de zone files, e expõe **API HTTP**. "Escolha o PowerDNS quando você quer um servidor autoritativo que se comporta como um serviço, com API e banco, para portais multi-tenant e automação". Fontes: [pinggy](https://pinggy.io/blog/best_open_source_dns_servers_for_self_hosting/), [ipaddresslocation](https://ipaddresslocation.net/articles/bind-vs-powerdns-vs-knot-dns-which-authoritative-server-to-choose).
- **Knot DNS** (CZ.NIC): performance/QPS altíssimo — resolve problema que você não tem.
- **BIND**: maior superfície de features e base de conhecimento; zone files em texto, integração via `rndc`/scripts.
- **CoreDNS**: plugin-based, ótimo em Kubernetes; para autoritativo público de hospedagem é fora de contexto.
- **Cloudflare API**: `api.cloudflare.com/client/v4` cobre tudo que o dashboard faz — criar zona, atualizar registro, page rules, SSL. [docs](https://developers.cloudflare.com/registrar/registrar-api/).
- **Registro.br**: ⚠️ **incerto — validar**. Não há API pública de registro/DNS para não-registradores; a discussão da comunidade gira em torno de acesso EPP (restrito a registradores credenciados). Fonte: [Portal do Host](https://portaldohost.com.br/topic/29586-api-do-registrobr-para-registro-de-dominios-e-alterar-dns-sem-ser-epp/page/5/). Novidade: extensões **.ia.br e .api.br** liberadas em 01/09.

### 10.2 Recomendação
**PowerDNS Authoritative com backend PostgreSQL (o mesmo cluster do painel), 2 instâncias (ns1/ns2 em servidores diferentes), gerenciado pela API HTTP do PowerDNS.**

Justificativa: o painel **já tem** um Postgres; o PowerDNS lendo zonas dali significa que criar um domínio na UI é um `INSERT` — sem gerar arquivo, sem `rndc reload`, sem risco de config inválida derrubar o DNS de todo mundo. É o único dos quatro desenhado para esse caso.
- **Não** escrever no banco do PowerDNS direto: usar a **API HTTP dele**, para não acoplar ao schema interno entre versões.
- **DNSSEC**: PowerDNS faz nativo — deixar desligado por padrão, ligável por domínio (feature de venda, dor de suporte se automático).
- **Registro.br**: assumir **fluxo manual** — o painel mostra "aponte seus nameservers para ns1/ns2.velozpanel.com.br" com instruções ilustradas e **verifica automaticamente** a propagação. Não prometer registro de domínio automatizado até confirmar credenciamento.
- **Cloudflare**: oferecer **modo "DNS externo"** onde o painel gera os registros necessários (A, MX, SPF, DKIM, DMARC, _acme-challenge) e permite **exportar em BIND zone file / copiar** ou **empurrar via token de API do cliente**. Cliente com Cloudflare é comum e não pode ser tratado como erro.

---

## 11. Certificados TLS

### 11.1 Fatos
- **Let's Encrypt, limites reais (2026)**: **50 certificados por domínio registrado a cada 7 dias** — limite **global**, todas as contas somam. **Renovações não contam** nesse limite, mas caem no limite de **certificado duplicado: 5 por semana**. Let's Encrypt publicou mudanças ligadas a **certificados de 45 dias**. Fontes: [letsencrypt.org/docs/rate-limits](https://letsencrypt.org/docs/rate-limits/), [LE — shorter lifetimes and rate limits](https://letsencrypt.org/2026/02/24/rate-limits-45-day-certs).
- **Armadilha documentada e diretamente aplicável**: um SaaS multi-tenant subindo **80 subdomínios de clientes no dia do lançamento estourou a cota ao meio-dia** usando TLS automático do Caddy. Fonte: [tech-insider](https://tech-insider.org/caddy-vs-nginx-2026/).
- **Clientes ACME**: certbot (EFF, integra com Apache/nginx e recarrega sozinho), **acme.sh** (POSIX shell puro, zero dependência, mais provedores DNS que o certbot), **lego** (Go, binário estático único, **90+ provedores DNS**). Os limites são do CA, iguais para todos. [oneuptime](https://oneuptime.com/blog/post/2026-03-02-use-acme-clients-certbot-lego-acmesh-ubuntu/view), [letsecure.me — ARI](https://letsecure.me/acme-automation-ssl-renewal-best-practices-2026/).

### 11.2 Recomendação
**lego como biblioteca/binário chamado pelo painel, nunca ACME automático do web server.**

Justificativa: (1) binário Go único, sem dependência de sistema, fácil de embarcar no agente; (2) o painel precisa **controlar a fila de emissão** — com centenas de domínios você tem que enfileirar, respeitar backoff, e **não** deixar um proxy pedir certificado sozinho a cada request de host desconhecido (foi assim que o caso dos 80 subdomínios estourou); (3) 90+ provedores DNS cobre DNS-01 para wildcard.

Regras de operação:
- **Subdomínio de painel para o cliente** (`cliente.velozpanel.app`) → **um wildcard `*.velozpanel.app` via DNS-01**, renovado num lugar só. **Isso é o que impede estourar o limite de 50/semana** — sem wildcard, cada novo cliente é um certificado no mesmo domínio registrado.
- **Domínios do cliente** → HTTP-01 individual, com **fila serializada, retry exponencial e alerta** ao super admin em falha.
- Implementar **ARI (ACME Renewal Info)** para acompanhar a redução para certificados de ~45 dias: renovar quando o CA mandar, não em cron fixo.
- **ZeroSSL como CA de fallback** configurável: se o LE bloquear ou cair, um `--server` diferente destrava a operação. Custa 15 minutos codar, salva um dia inteiro.

---

## 12. Web server

### 12.1 Fatos
| Servidor | Fatos | Ponto de dor |
|---|---|---|
| **nginx** | 32,8% dos sites; ~**6 MB de RAM**; 310k req/s em estáticos | reload de config; erro de sintaxe em 1 vhost **derruba o reload de todos** |
| **Caddy** | 142k req/s em um benchmark (22% acima do nginx 1.26), 285k em outro de estáticos; **28 MB de RAM**; **API JSON para mudar config em runtime sem reload**; TLS automático | TLS automático **estoura rate limit do LE em multi-tenant**; Caddyfile compila para JSON verboso (5–20 linhas por diretiva) — usado pela HashiCorp na frente de serviços multi-tenant |
| OpenLiteSpeed | cache LSCache muito forte para WordPress; base do CyberPanel | ecossistema menor, config própria, versão Enterprise paga |
| Angie | fork do nginx (ex-devs do nginx) | ⚠️ **incerto** — pouca informação comparativa pública; risco de fornecedor com origem russa para mercado corporativo |
| Fontes | [techplained](https://www.techplained.com/caddy-vs-nginx), [tech-insider](https://tech-insider.org/caddy-vs-nginx-2026/), [xTom](https://xtom.com/blog/comparing-apache-nginx-litespeed-openlitespeed-and-caddy/) | |

### 12.2 Recomendação
**Arquitetura em duas camadas:**
- **Borda (1 por servidor, roteia por Host): Caddy**, configurado **exclusivamente pela API JSON**, com **`auto_https off`** (certificados vêm do lego, seção 11). Motivo: adicionar/remover site em multi-tenant é a operação mais frequente do painel, e fazer isso com um `POST` sem reload — sem risco de um vhost quebrado derrubar todos os outros — **elimina a classe inteira de bug mais chata de painel de hospedagem**. É exatamente o caso de uso pelo qual a HashiCorp o adotou. Coraza (seção 7) tem conector nativo para Caddy.
- **Dentro do container do cliente: nginx + php-fpm** (ou o processo Node). Config gerada por template, escopo de 1 site só — se quebrar, quebra **um** cliente, e o painel valida com `nginx -t` **antes** de aplicar.

**Não** usar OpenLiteSpeed (amarra ao ecossistema LiteSpeed e é a base do painel com pior histórico de segurança) nem Angie (informação pública insuficiente para apostar a borda de produção).
Se o time preferir nginx na borda por familiaridade: **obrigatório** validar cada vhost com `nginx -t` em diretório temporário antes do reload, e usar `include /etc/nginx/sites/*.conf` — mas você reintroduz o reload global. **Caddy na borda é a recomendação.**

---

## 13. Compliance BR

### 13.1 Fatos
- **Marco Civil (Lei 12.965/2014)**: **provedor de conexão** guarda registros de conexão por **1 ano** (art. 13); **provedor de aplicação** guarda registros de acesso a aplicações por **6 meses** (art. 15), salvo ordem judicial que amplie. Guarda em **ambiente controlado e de segurança, sob sigilo**. Vale para grandes e pequenos, sem distinção de porte. Fontes: [NATVault — guia de logs](https://natvault.com.br/blog/marco-civil-internet-logs-guia-completo), [AbraCloud](https://abracloud.com.br/a-guarda-de-logs-e-o-marco-civil-da-internet-aspectos-tecnicos-e-juridicos/), [Jurídico Certo](https://juridicocerto.com/p/faria-cendao-e-maia/artigos/prazo-de-guarda-de-registros-de-acesso-a-aplicacoes-de-internet-1736). Há **conflito jurisprudencial** sobre prazos e termo inicial ainda não pacificado pelo STF. Fonte: [ConJur](https://www.conjur.com.br/2025-ago-27/incoerencia-dos-prazos-de-guarda-de-dados-no-marco-civil-o-conflito-nao-solucionado-pelo-stf/).
- **LGPD**: o **controlador** define finalidade e meios; o **operador** trata em nome do controlador. Provedor de hospedagem/SaaS é tipicamente **operador** dos dados dos clientes dele — e **controlador** dos dados cadastrais dos próprios clientes. **DPA** (Data Processing Agreement) já é exigência comum em B2B/governo. Fontes: [Assis e Mendes](http://assisemendes.com.br/controladores-e-operadores-na-lgpd/), [BL Consultoria — cláusula LGPD em SaaS](https://blconsultoriadigital.com.br/clausula-lgpd-em-contratos-de-licenciamento-de-saas/).
- **NFS-e Nacional**: padronização nacional via **Resolução CGNFS-e 03/2023**; **desde 01/01/2026 toda NFS-e destaca IBS e CBS** (novos campos obrigatórios); **a partir de 01/09/2026 emissão no padrão nacional é obrigatória para ME e EPP do Simples que prestam serviço com ISS**; +5.400 municípios aderiram. Fontes: [TecnoSpeed](https://blog.tecnospeed.com.br/nfse-nacional-tudo/), [Notaas — integrando a API NFS-e Nacional](https://www.notaas.com.br/blog/post/integrando-api-nfse-nacional-software).
- **AUP**: documento que define o permitido/proibido, integra e complementa Termos de Serviço e Política de Privacidade. Exemplo público: [Rollin Host AUP](https://www.rollinhost.com.br/politica-de-uso-aceitavel).

### 13.2 Recomendação (é obrigação legal, não opcional)
1. **Logs de acesso a aplicações por 6 meses** (art. 15 Marco Civil): IP de origem, timestamp com fuso, e identificação do recurso — para o painel **e** para os sites hospedados. Guardar **comprimido, em bucket separado, com acesso auditado**, e **retenção automática de 6 meses** (dado além do prazo vira passivo LGPD, não ativo). ⚠️ Note o conflito de prazos ainda aberto no STF — **guardar 6 meses é o mínimo legal**; considerar 12 meses após parecer jurídico.
2. **Papéis LGPD explícitos** nos Termos: VelozPanel é **operador** dos dados que o cliente hospeda e **controlador** do cadastro dele. Publicar **DPA** e sub-operadores (Magalu, SES, Asaas) — vai ser pedido pelo primeiro cliente corporativo.
3. **NFS-e automatizada desde o dia 1**: usar a **emissão do Asaas (R$0,49/nota)** já ligada ao evento de cobrança — não construir integração fiscal própria. Confirmar com contador o enquadramento do município e o prazo de 01/09/2026 se a empresa for Simples/ME/EPP.
4. **Três documentos antes do primeiro cliente pagante**: **Termos de Uso**, **AUP** (proibir spam, mineração, phishing, conteúdo ilegal, e reservar o direito de suspender por abuso de recurso) e **Política de Privacidade**. A AUP é o que dá respaldo para desligar um cliente que está atacando os outros — sem ela, desligar é quebra de contrato.
5. **Canal de encarregado (DPO)** e **procedimento de resposta a ordem judicial** escritos: quem responde, em quanto tempo, que dado é entregue. Você vai receber ofício.
6. **Direito ao esquecimento operacional**: exclusão de conta precisa **realmente** apagar de backups dentro do ciclo de retenção — documentar "em até 90 dias" nos Termos, porque restic não apaga retroativo.

---

## 14. O que mais colocar no VelozPanel

Ideias que aparecem no mercado e **não estão explícitas no briefing**.
Esforço: **P** = ≤1 semana · **M** = 2–4 semanas · **G** = >1 mês (para 1 dev).
Valor percebido: ★ a ★★★★★.

| # | Feature | Esforço | Valor | Por que (evidência de mercado) |
|---|---|---|---|---|
| 1 | **Staging / clone de ambiente com push-to-live** | M | ★★★★★ | Enhance inclui staging **sem custo extra**; Cloudways vende "staging ilimitado" como diferencial; hPanel tem staging 1-clique. Com container por ambiente, clonar é copiar volume + dump do banco — **barato para você, caro de imitar para o concorrente**. |
| 2 | **Git deploy (`git push velozpanel main`) + deploy hooks** | M | ★★★★★ | É o mecanismo central de Dokku/Coolify/Forge; "deploy via git push é transformador" para o dev. Junta o público de PaaS com o de hospedagem. |
| 3 | **Preview por branch/PR (URL efêmera)** | M | ★★★★ | Coolify tem preview por PR. Combina com nº 1; usa a mesma máquina de criar ambiente. |
| 4 | **Rollback de deploy em 1 clique** | P | ★★★★★ | Imagem OCI anterior ainda existe: é trocar a tag. **Esforço quase zero, percepção de "produto sério" enorme.** |
| 5 | **Terminal web (SSH no navegador)** | P | ★★★★ | Está nos screenshots do Hostoo (tela SSH); resolve o cliente atrás de firewall corporativo. `docker exec` + websocket. |
| 6 | **Cron visual com histórico de execução e saída** | P | ★★★★ | Todo painel tem cron; **quase nenhum mostra o log da última execução e alerta em falha**. Diferencial barato. |
| 7 | **WAF por site (liga/desliga, modo detecção)** | M | ★★★★ | Coraza+CRS já vai estar no proxy (seção 7); expor como toggle transforma custo de segurança em item de plano superior. |
| 8 | **CDN integrada (bunny.net white-label)** | M | ★★★★ | bunny: **US$0,002/GB**, mínimo US$1/mês, Edge Storage US$0,01/GB, egress de API grátis, 119 PoPs em 82 países. [preços](https://bunny.net/pricing/cdn/). Revender com margem é receita quase pura. |
| 9 | **Object storage S3 para o cliente** | M | ★★★ | Revenda de Magalu (R$0,10/GiB) com markup; casa com backup e com apps que precisam de storage. |
| 10 | **API pública + tokens com escopo + CLI** | M | ★★★★★ | Enhance tem "API-first com paridade total de features". Sem API não existe revenda, integração de agência, nem automação — e **fazer depois custa 3×**. |
| 11 | **White-label / revenda para agências** | M | ★★★★★ | O Hostoo tem [painel white label para agências](https://hostoo.io/revenda/) — é o canal de aquisição B2B mais barato do setor. Cliente traz 30 sites de uma vez. |
| 12 | **Marketplace de apps 1-clique** | M | ★★★★ | Cloudron (100+ apps com manifesto), CapRover, aaPanel. Com imagem OCI, um app é um YAML. Screenshots do Hostoo já mostram tela de apps/1-click. |
| 13 | **WordPress toolkit** (updates, plugins, staging, hardening em lote) | G | ★★★★★ | Enhance e Plesk incluem. **No Brasil, a maioria absoluta do que se hospeda é WordPress** — é o maior multiplicador de valor da lista. |
| 14 | **Alertas proativos** (disco 80%, CPU sustentada, site fora do ar, SSL vencendo, saldo baixo) via e-mail/WhatsApp/webhook | P | ★★★★★ | Ninguém no segmento faz bem. **Reduz ticket de suporte**, que é o custo real de um time de 1–3 pessoas. Asaas cobra R$0,55 por notificação WhatsApp. |
| 15 | **Status page pública + histórico de incidentes** | P | ★★★ | Confiança na hora da venda e menos ticket "está fora do ar?". |
| 16 | **Assistente de IA no painel** (explica erro de log, sugere versão de PHP, escreve regra de redirect) | M | ★★★★ | Kodee da Hostinger atende **43.000 conversas/dia e 400+ tipos de tarefa**. É onde o mercado está indo em 2026; para 1 dev, é **suporte nível 1 terceirizado por token**. |
| 17 | **Migração automática de cPanel/Hostoo/Hostinger** (importar backup ou puxar por FTP+DB) | M | ★★★★★ | **É o maior bloqueio de aquisição do setor.** Enhance/Plesk investem pesado nisso. Sem migração, o cliente não troca. |
| 18 | **Modo manutenção + página de erro personalizada** | P | ★★ | Trivial no proxy, esperado pelo cliente. |
| 19 | **Gerenciador de arquivos com editor e undo** (+ scan ClamAV no upload) | M | ★★★ | Está nos screenshots do Hostoo; caro de fazer bem, mas é o que o cliente não-técnico usa todo dia. |
| 20 | **Logs em tempo real no painel** (access, error, PHP, deploy) com filtro e download | P | ★★★★ | Screenshot do Hostoo tem tela de logs. Baratíssimo (`docker logs` + websocket), mata muito ticket. |
| 21 | **Métricas de aplicação, não só de máquina**: req/s, p95 de latência, 4xx/5xx, top URLs lentas | M | ★★★★ | Diferencia de todo painel tradicional (que só mostra CPU/RAM). O agente e o proxy já têm o dado. |
| 22 | **Firewall/allowlist por ambiente + bloqueio geográfico** | P | ★★★ | CrowdSec já provê a base; expor por ambiente é UI. |
| 23 | **Autoscale de plano / "modo burst"** (permitir estourar RAM por N horas cobrando extra) | M | ★★★★ | Casa perfeitamente com cobrança por hora (seção 4) e é receita incremental sem custo fixo. Nenhum painel BR faz. |
| 24 | **Agendamento de pausa** ("desliga meu ambiente de staging das 20h às 8h e nos fins de semana") | P | ★★★★ | **Monetiza a feature de pausa do briefing (item 4/5)** de um jeito que o cliente sente no bolso — argumento de venda direto contra hospedagem de preço fixo. |
| 25 | **Convidados/equipe com permissões por ambiente + log de auditoria** | M | ★★★★ | Agência precisa dar acesso ao freelancer sem entregar a conta inteira. Pré-requisito do white-label (nº 11) e exigência de LGPD/auditoria. |

**Se só couberem cinco no MVP+1**: nº 17 (migração), nº 13 (WordPress toolkit), nº 2 (git deploy), nº 14 (alertas), nº 10 (API pública). Os dois primeiros trazem cliente, os dois seguintes reduzem custo de suporte, o último evita reescrita.

---

## 15. Resumo das recomendações

| Área | Decisão | Justificativa em uma linha |
|---|---|---|
| Modelo de painel | Enhance-like: container por ambiente, servidores com papéis, API-first | único modelo comercial provado que entrega multi-versão + pausa + multi-servidor |
| Isolamento | **Docker/Podman rootless + userns + cgroups v2 + quota**, `runsc` plugável | resolve 4 requisitos do briefing de uma vez e 1 dev consegue operar |
| PaaS/deploy | git push → build → container, sem Swarm, sem k8s | Swarm está estagnado; k8s é injustificável em 3 servidores |
| Runtime | **imagem OCI por (linguagem × versão)**, sem buildpack no dia 1 | trocar versão = trocar tag; abre outras linguagens de graça |
| Billing | **metering caseiro em Postgres (idempotente) + Asaas**, saldo pré-pago, granularidade de 1 hora | volume é pequeno; Asaas cobre Pix+cartão+assinatura+saldo+NF-e numa API |
| Observabilidade | **VictoriaMetrics + vmagent**, sem cAdvisor, sem Grafana; gráficos próprios | 5–10× menos RAM; o agente de cobrança já coleta o dado |
| Segurança | CrowdSec + Coraza/CRS + cgroups + **porta 25 outbound fechada**; painel admin fora da internet aberta | o painel é o alvo — 22.000 servidores CyberPanel viraram ransomware |
| E-mail | **Stalwart para caixa postal + Amazon SES para envio** | 100 MB de RAM; e terceirizar envio protege a reputação dos seus poucos IPs |
| Backup | **restic + Magalu Cloud**, 3-2-1, restore testado semanalmente, chave fora dos servidores | ecossistema maduro + dado no Brasil resolve LGPD comercialmente |
| DNS | **PowerDNS + Postgres via API HTTP**, 2 instâncias | criar domínio vira INSERT; sem reload, sem zone file |
| TLS | **lego** com fila própria, **wildcard** para subdomínios do painel, ARI, ZeroSSL de fallback | 50 certs/domínio/semana é limite global — wildcard é o que impede o estouro |
| Web server | **Caddy na borda via API JSON (auto_https off)** + nginx dentro do container | adicionar site sem reload elimina a pior classe de bug de painel |
| Compliance | logs 6 meses, DPA + papéis LGPD, NFS-e via Asaas, Termos+AUP+Privacidade antes do 1º cliente | obrigação legal e pré-requisito de venda B2B |

---

## 16. Riscos e incertezas a validar em PoC

1. ⚠️ **Antispam do Stalwart** contra Rspamd treinado — se falhar, plano B é Mailcow (custo: +1,4 GB de RAM por servidor de e-mail).
2. ⚠️ **Registro.br sem API pública** para não-registradores — assumir fluxo manual de nameservers até confirmar credenciamento EPP.
3. ⚠️ **Angie**: informação pública insuficiente; não apostar a borda nele.
4. ⚠️ **Densidade real**: 100–200 containers/servidor é estimativa de literatura; medir com WordPress real (php-fpm ocioso consome mais que os 220 MB do modelo genérico).
5. ⚠️ **Egress do Magalu é pago** (R$0,10/GiB) — orçar o custo de um restore em massa antes de prometer RTO.
6. ⚠️ **Railpack ainda é beta** — não colocar no caminho crítico agora; reavaliar em 6 meses.
7. ⚠️ **Prazo de guarda de logs** tem conflito jurisprudencial aberto no STF — validar 6 vs 12 meses com advogado.
