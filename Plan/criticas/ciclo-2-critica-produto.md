# Crítica do Ciclo 2 — Produto & Negócio

> Autor: Crítico de Produto & Negócio
> Documentos atacados: `00-BRIEFING.md` (ADENDOS 1, 2, 3), `01-produto-ux.md`, `06-multitenancy-runtime.md`,
> `07-billing-metering.md` (§3.10), `08`, `09`, `10`, `11`, `criticas/ciclo-1-critica.md`
> Data: 20/08/2026
>
> A Crítica 1 perguntou *"isso é construível?"*. Esta pergunta outra coisa:
> **"isso deve ser construído, e nesta forma?"** As duas respostas não são a mesma.

---

## 0. O achado que precede todos os outros

O doc `07` §3.10.5 diz que o teto de faturamento desta frota é **R$ 1.144/mês**. Esse número está
**errado para cima**, e o erro é do próprio planejamento, não do meu cálculo.

R$ 1.144/mês pressupõe **22 ambientes vendidos** — que é a **postura C** (overcommit 1,30×) do doc `06`
§1.6. Só que o doc `06`, na mesma tabela, **recomenda explicitamente a postura A** (garantida,
`Σ MemoryMax vendidos ≤ 9.500 MB`), que dá **7 ambientes por nó = 14 na frota**. E o motivo dado é bom:
na postura C *"um cliente pode receber 'não foi possível iniciar seu ambiente'"* — o pior erro possível
num produto cujo argumento de venda é o botão de pausar.

**Os dois documentos fecharam decisões incompatíveis e ninguém somou as duas.** O Billing precificou a
frota na postura C; o Runtime recomendou a postura A. Refazendo a conta do `07` §3.10.6 com os 14
ambientes que o `06` de fato autoriza vender:

| Cenário (postura A — 14 ambientes, frota esgotada) | Receita líq. | Custo fixo | **Margem bruta** | Com tempo do dono (R$ 250) |
|---|---:|---:|---:|---:|
| A = 100% (tudo ligado 24/7, cenário impossível) | R$ 896 | R$ 1.027 | **− R$ 131** | − R$ 381 |
| A = 77% (teto sustentável) | R$ 710 | R$ 1.027 | **− R$ 317** | − R$ 567 |
| A = 70% | R$ 653 | R$ 1.027 | **− R$ 374** | − R$ 624 |
| A = 50% | R$ 517 | R$ 1.027 | **− R$ 510** | − R$ 760 |

> ### O teto real desta frota é R$ 896/mês, não R$ 1.144. E o ponto de equilíbrio de caixa exige 17 ambientes ativos numa frota que só pode vender 14.
>
> **O ponto de equilíbrio fica em 121% da capacidade vendável.** Não é "94% do teto, sem folga", como
> diz o `07` §3.10.4. É **acima do teto**. Faltam três ambientes que não existem e que nenhuma decisão
> comercial cria. **Não existe cenário de caixa positivo nesta infraestrutura — nem no melhor deles,
> nem ignorando o tempo do dono.**

Isso não muda a direção da conclusão do `07` — muda a magnitude, e muda o que se deve fazer com ela.
O `07` conclui *"prejuízo aceito como custo de aprendizado"*. Com R$ 896 de teto e equilíbrio em 121%,
a conclusão correta é diferente: **não é uma frota que dá prejuízo até encher. É uma frota que não é
um negócio em nenhuma configuração.** É um laboratório. Um laboratório pode valer o que custa — mas
aí ele deve ser projetado como laboratório, e o plano atual não foi.

**Correção exigida:** o `07` §3.10 deve ser reescrito sobre a postura A (14 ambientes), ou o `06` §1.6
deve ser revertido para a postura C com o risco de `start` recusado assumido por escrito pelo dono.
Uma das duas coisas. As duas versões não podem coexistir.

---

## 1. O projeto se justifica?

Cinco justificativas possíveis. Avaliadas uma a uma, com número.

### 1.1 "Hospedar meus próprios clientes mais barato que Hostoo/Locaweb" — **ILUSÃO, por 4× a 6×**

| Opção para hospedar os 4–5 sistemas do dono | Custo mensal | Tempo do dono |
|---|---:|---:|
| Hostoo, 5 planos Light (R$ 44,90) | **R$ 225** | ~0 h/mês |
| Hostoo, 5 planos de entrada (R$ 35,00) | **R$ 175** | ~0 h/mês |
| Coolify numa VPS de 16 GB que ele já tem | **R$ 250** | ~2 h/mês + 1 fim de semana de setup |
| **Frota VelozPanel (2 produção + 1 teste + control plane)** | **R$ 1.027** | **~3–6 h/mês + 180–1.200 h de construção** |

**A frota custa 4,6× o Hostoo para hospedar exatamente os mesmos 5 sistemas.** E isso ignorando a
construção. Somando 12 meses de infra (R$ 12.324) com uma estimativa conservadora de 1.000 h do dono a
R$ 80/h (R$ 80.000), o custo de "economizar" R$ 2.700/ano de Hostoo é **R$ 92.324**. Payback: 34 anos,
se o custo operacional depois fosse zero — e não é.

Existe uma versão desta justificativa que se salva, e ela não é o caso aqui: **se o dono tivesse
30–40 sites de clientes de consultoria**, R$ 1.027/mês contra R$ 1.400–1.800/mês de Hostoo começaria a
fazer sentido. Com **5 sistemas**, a conta é perdida por uma ordem de grandeza. **Nota: 1/10.**

### 1.2 "Ativo de software reutilizável" — **FRACO como planejado, REAL se reescopado**

Como planejado (painel de hospedagem completo: DNS, e-mail, apps, WAF, backup, multi-nó), o ativo
compete com Enhance (**US$ 0,15/site/mês, mínimo US$ 10 ≈ R$ 56/mês**, escrito em Rust, por uma empresa
com time), HestiaCP e CloudPanel (**gratuitos**) e Coolify (**gratuito, 57 mil estrelas**). Um ativo que
compete com quatro produtos maduros, sendo três de graça, não é um ativo — é um passivo de manutenção.

**Mas existe um pedaço que é genuinamente escasso:** uma **camada de cobrança por hora com saldo
pré-pago em BRL, Pix e pausa real**, plugável sobre um painel existente. Isso não existe pronto no
mercado brasileiro. É 15% do escopo especificado e é onde está 100% da originalidade.
**Nota: 2/10 como está planejado. 5/10 se o escopo for só a camada de billing.**

### 1.3 "Aprendizado" — **A ÚNICA QUE SE SUSTENTA, e mesmo assim está superprecificada**

Esta é real e é a melhor justificativa que o projeto tem. Aprender container por inquilino, cgroups v2,
metering append-only, máquina de estados, backup com restore ensaiado e — o mais valioso de todos —
**gerenciar uma IA construindo um sistema de verdade** vale dinheiro e não se compra em curso.

O problema é a curva de retorno: **80% desse aprendizado está nas primeiras ~200 h**, no MVP de um nó
(§3). As 800 h seguintes ensinam DNS autoritativo, antispam, WAF, marketplace `.vpm` e i18n multi-locale
— coisas que ele pode nunca precisar e que o mercado entrega prontas. Pagar R$ 80.000 de tempo e
R$ 12.324/ano de infra pelos 20% finais é uma troca ruim.
**Nota: 8/10 para o MVP de um nó. 3/10 para o escopo especificado.**

### 1.4 "Base para revenda futura" — **CONDICIONALMENTE REAL, mas na ordem invertida**

A revenda só existe depois do nó de 64 GB (`07` §3.10.9: margem vai de −R$ 1 para +R$ 1.285/mês). Ou
seja: a justificativa depende de um investimento futuro de R$ 1.000/mês que ainda não foi feito, e que
só se justifica com demanda comprovada — que ainda não foi testada.

**O erro de ordem:** para validar se existe demanda por hospedagem gerenciada em BRL com pausa por hora,
**não é preciso construir nada**. Dá para revender Hostoo/Enhance com marca própria, cobrar por fora e
descobrir em 60 dias se alguém compra. O plano inverteu: 21.555 linhas de especificação de **oferta**,
zero hora de validação de **demanda**.
**Nota: 4/10, e só depois de um teste de demanda que ainda não foi feito.**

### 1.5 "Independência de fornecedor" — **ILUSÃO, e na direção contrária**

Hoje: 1 fornecedor (Hostoo), com o SLA deles e o suporte deles.
Depois: **2 provedores de VPS + 1 PSP (Asaas) + 1 object storage (Magalu) + 1 relay de e-mail + 1
helpdesk**, e o dono vira o plantão de todos. A dependência não diminuiu — **ela foi trocada por cinco
dependências e um turno de sobreaviso**.

Existe um núcleo verdadeiro aqui: *"não quero perder os sites dos meus clientes se um provedor virar o
jogo"*. Legítimo — e resolvido por **Coolify + backup off-site, de graça, num fim de semana**.
**Nota: 2/10.**

### 1.6 A justificativa que faltava na lista — e que é a melhor de todas

**"Quero aprender a dirigir uma IA construindo um sistema real, de ponta a ponta, e este é o exercício."**

Essa é honesta, é a que melhor descreve o que está acontecendo, e é a única que aguenta um prejuízo de
R$ 1.027/mês sem se envergonhar — porque nela o prejuízo é **mensalidade de escola**, não erro de
precificação. Só que ela tem uma consequência que o plano não tirou: **se o objetivo é aprender, o
tamanho ótimo do projeto é o menor que ainda ensina.** E o plano fez o oposto: especificou o maior que
cabia no papel.

### 1.7 Veredito da seção

| Justificativa | Nota | Veredito |
|---|:---:|---|
| Hospedar os próprios clientes mais barato | 1/10 | **Ilusão.** Custa 4,6× o Hostoo |
| Ativo de software reutilizável | 2/10 | **Ilusão** no escopo atual; **5/10** só na camada de billing |
| Aprendizado | 8/10 | **Se sustenta** — no MVP de um nó. 3/10 no escopo completo |
| Base para revenda futura | 4/10 | **Condicional**, e depende de um teste de demanda não feito |
| Independência de fornecedor | 2/10 | **Ilusão.** Troca 1 fornecedor por 5 + plantão próprio |
| *(faltava)* Aprender a construir com IA | 9/10 | **A justificativa real.** E ela pede o MVP, não o escopo |

**O projeto se justifica como laboratório de aprendizado com ambição comercial adiada. Não se
justifica como negócio de hospedagem nesta frota, e nenhuma decisão de preço, plano ou funil muda
isso** — como o próprio `07` §3.10.7 já concluiu, e esta crítica só piora com o número da postura A.

---

## 2. Comparação honesta com não construir

### 2.1 Cobertura dos 10 requisitos do briefing, por alternativa

| # | Requisito | (a) Hostoo | (b) Enhance | (b') HestiaCP/CloudPanel | (c) Coolify/Dokploy | VelozPanel |
|---|---|:---:|:---:|:---:|:---:|:---:|
| 1 | PHP + Node + outras linguagens | ◐ PHP+Node | ◐ PHP forte, Node fraco | ◐ PHP; Node manual | ● qualquer, via imagem | ● |
| 2 | Sistema modular | ○ | ◐ extensões | ○ | ○ | ● |
| 3 | Painel cliente + super admin | ○ *(você é o cliente)* | ● cliente + admin + revenda | ◐ admin + user | ○ *(1 painel só)* | ● |
| 4 | Cliente pausa/inicia | ◐ *(suspende, sem preço)* | ◐ suspende | ○ | ● start/stop via API | ● |
| 5 | **Cobrança por hora** | ● *(mas você é quem paga)* | ○ | ○ | ○ | ● |
| 6 | MySQL + PostgreSQL | ● | ● | ● | ● | ● |
| 7 | Versão de linguagem por cliente | ● | ● | ● | ● *(tag de imagem)* | ● |
| 8 | Gráficos no painel do cliente | ● | ● | ◐ | ◐ *(por app)* | ● |
| 9 | Admin muda RAM/vCPU a quente | ○ | ● *(limites por plano)* | ○ | ◐ *(limites, com restart)* | ● |
| 10 | Instalação simples de módulo + docs | n/a | ● | ● | ● | ● |
| | **Custo mensal (5 sistemas do dono)** | **R$ 175–225** | **R$ 306** *(1 VPS + licença)* | **R$ 250** *(1 VPS)* | **R$ 250** *(1 VPS)* | **R$ 1.027** |
| | **Tempo de construção** | **0 h** | **0 h** | **0 h** | **~16 h** | **180–1.200 h** |

● atende · ◐ atende parcialmente · ○ não atende

### 2.2 O que exatamente se perde em cada alternativa

**(a) Continuar no Hostoo — perde-se:**
- os requisitos **2, 3, 9** integralmente (modularidade, painel de super admin, controle de recursos);
- a possibilidade de **revender** (ele é cliente final, não operador);
- todo o aprendizado de infraestrutura — que é a justificativa 1.3, a única que se sustenta;
- **nada mais.** Os requisitos 1, 4, 5, 6, 7, 8 o Hostoo já entrega, e é literalmente de onde eles foram
  copiados. **Vale registrar o desconforto:** os requisitos do briefing foram extraídos de 36
  screenshots de um produto que já os implementa e cobra R$ 35/mês por isso.

**(b) Enhance (ou HestiaCP/CloudPanel) + camada própria de billing — perde-se:**
- o requisito **5** de origem: nenhum deles tem medição horária; seria preciso ler o estado pela API e
  fazer o metering fora — **possível, e é exatamente a camada original de valor** (§1.2);
- o requisito **4** com semântica de preço (suspender existe; "pausar e pagar só o disco" não);
- **Node como cidadão de primeira classe** — Enhance e Hestia são PHP-cêntricos; é a lacuna mais séria
  para este dono, que vive de Node/.NET;
- a modularidade do requisito **2** como ele a definiu (mas ganha-se extensões do Enhance);
- **a capacidade de depurar a camada de baixo**: Enhance é Rust fechado, Hestia é Bash, CloudPanel é PHP
  — nenhum é Node ou .NET. Esse é o argumento técnico **honesto** a favor de construir, e é o único.
- **Ganha-se de graça:** e-mail, DNS, WordPress toolkit, migração de cPanel, staging, backup incremental,
  painel de revenda — os quatro riscos de reputação da §6 já resolvidos por terceiros.

**(c) Coolify/Dokploy sem billing — perde-se:**
- os requisitos **3 e 5** por inteiro: não há painel de cliente nem cobrança. Coolify é ferramenta de
  operador, não produto de hospedagem;
- isolamento entre inquilinos hostis (Docker sem `userns-remap` por padrão, mesmo daemon, sem cota XFS
  por ambiente) — **irrelevante para os 5 sistemas do próprio dono, bloqueador para cliente pagante**;
- cota de disco, SFTP por inquilino, ACME por domínio de cliente, vocabulário de hospedagem na UI.
- **Ganha-se:** requisitos 1, 4, 6, 7 e metade do 8 e do 9, **hoje, de graça, em um fim de semana**.

### 2.3 Quando construir do zero é a resposta certa — e quando não é

**É a resposta certa quando as três condições valem ao mesmo tempo:**
1. **O diferencial mora na camada que você vai construir** e nenhuma base expõe os ganchos de que ele
   precisa. Aqui **falha**: Coolify expõe start/stop e limites por API; Enhance expõe suspend e API com
   paridade total. A cobrança por hora **pode** ser construída por cima de qualquer um dos dois.
2. **A licença da base escala mal contra o seu preço.** Aqui **falha**: Enhance a US$ 0,15/site custa
   **1,7% da receita** de um plano de R$ 49. cPanel a US$ 0,35/conta seria problema; Enhance não é.
3. **Você precisa consertar a camada de baixo às 3h da manhã, na sua língua.** Aqui **passa** — e é a
   única das três que passa. Rust fechado, Bash e Laravel não são Node nem .NET.

**Uma de três condições satisfeitas não autoriza reconstruir a pilha inteira. Autoriza construir a
camada de cima e escolher uma base que você consiga operar.**

**Não é a resposta certa quando** — como aqui — o teto de receita não paga sequer o custo fixo, o
diferencial cabe em 15% do escopo, e 85% do que se vai construir já existe pronto, de graça, e melhor
testado. Reescrever nginx-vhost-ACME-quota-backup-SFTP-provisionamento-de-banco não gera um centavo de
diferenciação; gera 800 h de trabalho e uma superfície de bug que você mantém sozinho para sempre.

### 2.4 A conta que resume a seção

| | Construir o escopo especificado | Coolify (uso próprio) | Enhance + billing próprio |
|---|---:|---:|---:|
| Infra, 12 meses | R$ 12.324 | R$ 3.000 | R$ 3.672 |
| Tempo do dono (a R$ 80/h) | R$ 80.000 *(1.000 h [EST])* | R$ 1.280 *(16 h)* | R$ 20.000 *(250 h [EST])* |
| **Custo total do ano 1** | **R$ 92.324** | **R$ 4.280** | **R$ 23.672** |
| Receita bruta máxima do ano 1 | R$ 10.750 *(postura A)* | R$ 0 | R$ 10.750 |
| Cobre os 10 requisitos | 10/10 | 5,5/10 | 8/10 |

---

## 3. Qual é o MVP mínimo real

**Pergunta a responder:** a menor versão que hospeda 4–5 sistemas do dono, cobra por hora, deixa pausar,
troca versão de linguagem e mostra gráfico.

### 3.1 O que ENTRA (e nada além disso)

| # | Item | Por que é irredutível |
|---|---|---|
| 1 | `veloz-node-doctor.sh` rodado nos 3 nós | Achado 0.1 da Crítica 1. Se um nó for OpenVZ, nada abaixo existe |
| 2 | **1 nó** (o de teste), Docker com `userns-remap`, nginx de borda, XFS `prjquota`, nftables | Base física de tudo |
| 3 | Ambiente = **1 container OCI**. **Duas imagens: `php:8.3` e `node:22`** | Requisito 1. Doze imagens no MVP é catálogo, não necessidade |
| 4 | Máquina de estados `create/start/stop/resize/delete` + reconciliação no boot | É o produto (req. 4 e 9) |
| 5 | Agente do nó (HTTP + **mTLS pela internet pública, mesmo no mesmo host**) | §4.3 explica por que o mTLS não pode esperar |
| 6 | Control plane: Next.js + Postgres + motor de jobs no próprio Postgres | Stack fechada pelo ADENDO 1 |
| 7 | **Painel do cliente: 6 telas.** Lista de ambientes · Resumo com 4 gráficos · Pausar/Iniciar · Trocar versão · Logs · Extrato de consumo | Requisitos 3, 4, 7, 8 |
| 8 | **Painel do admin: 4 telas.** Nós · Ambientes · Resize a quente · Lançar crédito na mão | Requisito 9 |
| 9 | **Metering:** `state_windows` → `usage_events` → razão append-only → saldo pré-pago + demonstrativo | Requisito 5. É o coração original do produto |
| 10 | **Pagamento: `mod-pagamento-fake` + recarga lançada pelo admin** | Prova o contrato `payment.gateway v1` sem integrar PSP. Asaas só quando existir cliente externo pagante |
| 11 | MariaDB compartilhado no nó + criar database/usuário/grant | Requisito 6, metade |
| 12 | SSL via `lego` com fila no CP | Sem HTTPS não se hospeda nada em 2026 |
| 13 | **Backup `restic` + dump horário + RESTORE ensaiado** | Único item que **não pode ser cortado nem adiado**. Backup sem restore ensaiado é ficção (`02` §9) |
| 14 | SFTP por ambiente | Como o dono põe código lá dentro |
| 15 | Auth: e-mail + senha + TOTP, **dois papéis** (dono, cliente), auditoria de escrita | Piso de segurança |
| 16 | **Três runbooks:** restaurar backup · nó caiu · subir ambiente novo | Requisito 10. Testado pelo critério do `08` D7 |
| 17 | Acessibilidade **AA** e CWV no verde | AA é piso barato se feito desde o commit 1; AAA não é MVP |

### 3.2 O que SAI — explicitamente, e por decisão, não por esquecimento

| Sai do MVP | Substituto imediato | Volta quando |
|---|---|---|
| **E-mail** (caixas, webmail, antispam, listas) | Zoho/Google Workspace/Titan, com botão de MX na tela de DNS | Nunca construir. Terceirizar sempre |
| **`mod-email-relay`** | SES/Resend configurado à mão nos 5 sistemas | Primeiro cliente externo que envia e-mail transacional |
| **DNS autoritativo** | `mod-dns` em modo instrução (mostra o registro, verifica propagação) | Só se um cliente exigir zona gerenciada |
| **Apps 1-click** (WordPress, Laravel, Ghost, n8n) | O dono sabe instalar | Fase 4 |
| **WAF / Coraza / CRS** | Cloudflare grátis na frente | Primeiro incidente de abuso |
| **Indicação / referral / gamificação** | — | Nunca nesta escala. 12 clientes não têm rede |
| **Tickets / helpdesk** | WhatsApp e e-mail do dono | Acima de 30 conversas/mês |
| **Compromisso pré-pago, descontos, cupons, campanhas** | Preço de tabela, sem desconto | Depois do nó de 64 GB (`07` §3.10.7 já suspendeu a escada) |
| **Faturas / `invoices` / NFS-e** | Extrato + razão (o `07` B10 já cortou) | Quando o CNPJ existir |
| **Multi-nó: scheduler, evacuação, migração ao vivo, admission control** | 1 nó só | Fase 2 (§4.4) |
| **Git deploy, build step, rollback, preview por PR** | `git pull` por SSH | Fase 4 |
| **Gerenciador de arquivos web, editor de código, zip/unzip** | SFTP | Fase 4 ou nunca |
| **Cron pela UI + histórico de execução** | `crontab` dentro do container | Primeiro cliente que pedir |
| **Adminer, export/import, seletor de versão de banco, Redis** | `mysql` via SSH | Sob demanda |
| **PostgreSQL** | Só se um dos 5 sistemas do dono precisar | Sob demanda real |
| **Runtimes Python/Go/Bun/Deno, extensões PHP por toggle** | Imagem derivada na mão | Fase 4 — é o teste de fogo da modularidade, e o teste pode esperar |
| **Alias, redirect, subdomínio pela UI** | `server_name` na mão | Fase 3 |
| **Staging/clone, restauração seletiva** | — | Fase 4 |
| **Marketplace `.vpm`, cosign, iframe sandbox** | `builtin` (o `08` D2/D3 já adiou) | Quando existir módulo de terceiro |
| **UI plugável por slots + `React.lazy` + manifesto por tenant** | Rotas estáticas | Quando existir o segundo módulo com UI |
| **i18n multi-locale** | `pt-BR` (mas **strings em arquivo desde o commit 1** — isso não custa nada e economiza um refactor) | Primeiro cliente estrangeiro |
| **AAA (`10`)** | **AA obrigatório** | Fase 4 |
| **VictoriaMetrics, downsampling, retenção em camadas, 13 regras de alerta** | 4 séries por ambiente em tabela Postgres + **4 alertas** (nó mudo, disco > 85%, saldo < 3 dias, restore falhou) | Acima de 30 ambientes |
| **Status page pública, crédito automático de SLA** | E-mail do dono | Primeiro cliente externo |
| **Reembolso, chargeback, conciliação, inadimplência automatizada** | Planilha e bom senso com ≤ 5 clientes | Fase 3 |
| **Migração assistida de outro provedor** | Na mão, pelo dono | Fase 4 |
| **`mod-pagamento-asaas`** | Fake + crédito manual | Primeiro cliente externo pagante |

### 3.3 Tamanho relativo

| Medida | Escopo especificado | **MVP mínimo** | Fração |
|---|---:|---:|---:|
| Módulos do catálogo `08` | 25 | **7** | **28%** |
| Features do inventário `01` §3 | ~85 | **18** | **21%** |
| Telas (cliente + admin) | ~60 | **10** | **17%** |
| Linhas de especificação a implementar | 21.555 | ~3.000 | **14%** |
| **Esforço estimado do dono** [EST] | 900–1.200 h | **180–250 h** | **~22%** |

O esforço cai menos que a superfície (22% contra 14–17%) porque **o que fica é a parte difícil**: agente,
máquina de estados, metering idempotente e backup com restore. O que sai é a parte volumosa e fácil.
Isso é o corte certo — cortar o difícil e ficar com o volumoso seria construir um CRUD bonito que não
hospeda nada.

---

## 4. A sequência certa

### 4.1 "Dá para construir tudo num nó de teste primeiro, só para ver como vai ficar?"

**Sim — e deve ser a primeira entrega formal do roadmap.** Mas não pela razão que o dono deu.
*"Só para ver como vai ficar"* é razão de protótipo descartável; o que se deve construir aqui é o
**produto de verdade, num nó só, hospedando os 5 sistemas dele em produção**. A diferença entre as duas
coisas é se o código sobrevive.

### 4.2 Riscos que isso REDUZ (e são grandes)

1. **Aptidão do hardware.** O bloqueador nº 1 da Crítica 1 (VPS container-based) morre na primeira
   semana, antes de qualquer linha de produto.
2. **Risco de dado de terceiro: zero.** Os 5 sistemas são dele. Se o restore falhar, o prejudicado é
   quem tomou a decisão. **Este é o argumento mais forte a favor da sequência, e o plano não o
   explicitou.**
3. **Custo de errar: baixo.** Destruir e recriar o nó quantas vezes for preciso não tem custo político.
4. **Densidade medida em vez de estimada.** O experimento B1/T9 do `06` §2149 roda aqui. Se der < 12
   Start por nó, toda a economia é refeita **antes** de existir cliente.
5. **Descobre o custo operacional real do dono** — a variável mais importante do plano financeiro e a
   única que ninguém mediu. Se operar isso custar 10 h/mês, o projeto acabou e é melhor saber agora.

### 4.3 Riscos que isso ESCONDE (e o plano não tratou)

1. **A rede desaparece.** Com CP e agente no mesmo host, tudo funciona por `localhost`: sem mTLS, sem
   latência, sem partição, sem relógio dessincronizado, sem certificado expirado. **É exatamente onde
   os bugs de 2 nós vivem.** → **Regra obrigatória: no nó de teste, o agente fala com o control plane
   pelo IP público, com mTLS, desde o primeiro commit. `localhost` proibido no código do transporte.**
2. **Vizinhança some.** Com 5 sistemas amigos, não há barulho de vizinho, não há OOM alheio, não há
   inquilino hostil. A segurança de isolamento nunca é exercitada. → **Rodar um "inquilino hostil"
   sintético** (fork bomb, disco cheio, CPU 100%, tentativa de ler `/srv/veloz` alheio) como teste de
   aceite da fase 1.
3. **A cobrança nunca é contestada.** Você não discute fatura consigo mesmo. O metering pode estar
   errado em 15% e ninguém percebe. → **Critério de aceite: reconciliar a razão contra a máquina de
   estados por 30 dias, com desvio ≤ 1%**, e **incluir um teste de queda de nó no meio do faturamento**.
4. **Falsa sensação de conclusão.** "Ficou bonito, está pronto" — e o que falta é justamente evacuação,
   scheduler, admission control e restore cruzado, que só existem com 2 nós.
5. **O problema econômico não é tocado.** O nó de teste não responde a única pergunta que decide o
   projeto: **alguém compra isso?** → Por isso a validação de demanda (F0b) corre em paralelo, não
   depois.

### 4.4 Roadmap em fases, com gatilho objetivo de passagem

| Fase | Escopo | **Gatilho objetivo para passar à próxima** | **Gatilho de aborto** |
|---|---|---|---|
| **F0 — Diagnóstico** *(1 semana)* | `veloz-node-doctor.sh` nos 3 nós | **3/3 nós aptos**: KVM/bare metal, cgroup v2 com escrita em `memory.max` e `cpu.max`, `overlay2`, `prjquota`, nftables | Qualquer nó reprovado → **trocar de VPS antes de escrever código** |
| **F0b — Demanda** *(2 semanas, em paralelo)* | Conversar com **10 candidatos reais** com a proposta honesta da §5 e a tabela de preço | **≥ 3 dizem "quero, a este preço, sabendo que não tem SLA nem e-mail"** | **0–1 de 10** → o projeto vira ferramenta interna, ponto final. Escopo cai para a §7 |
| **F1 — Laboratório de 1 nó** *(8–12 sem.)* | O MVP da §3, no nó de teste, com os 5 sistemas do dono **em produção** | (a) 5 sistemas rodando **30 dias** sem intervenção manual; **(b) o dono restaura um ambiente do zero, sozinho, seguindo o runbook, sem consultar código**; (c) razão × máquina de estados com desvio **≤ 1%** em 30 dias; (d) 4 drills de backup consecutivos verdes; (e) teste do inquilino hostil passa | Operação do dono **> 8 h/mês** → parar e automatizar antes de seguir |
| **F2 — Dois nós, ainda sem cliente** *(4–6 sem.)* | mTLS pela internet, scheduler, admission control, evacuação, restore cruzado | (a) **`node.evacuate` ensaiado com sucesso dentro do RTO de 12 h**; (b) 30 dias com **< 2 h/mês** de operação manual; (c) B1/T9 medido: **≥ 12 ambientes Start por nó** | B1/T9 **< 12** → refazer a economia (`06` §2237). Evacuação falha → **não vender para ninguém** |
| **F3 — Três clientes-âncora** *(60 dias)* | Asaas/Pix, extrato, ciclo de inadimplência, status page. **Máximo 3 clientes conhecidos** | (a) 60 dias, **zero perda de dado**; (b) **≤ 0,5 ticket/cliente/mês**; (c) **zero contestação de cobrança**; (d) os 3 renovam | **1 perda de dado** → parar de vender e voltar à F2. **2 saídas em 60 dias** → encerrar a venda |
| **F4 — Abertura controlada** | Até **12 clientes / 15 ambientes** (`07` §3.10.8) — **mas 10 ambientes na postura A**, ver §0 | Gatilhos do `07` §3.10.9: **(a)** 15 ativos por 14 dias · **(b)** RAM > 85% por 7 dias · **(c)** receita ≥ R$ 900/mês por 2 meses · **(d)** fila de `start` > 0,5% por 7 dias | **Novos, que faltavam:** **(e)** operação do dono ≥ 8 h/mês → automatizar antes de vender · **(f)** 12 meses sem atingir R$ 900/mês → **encerrar a operação comercial e ficar com a ferramenta interna** |
| **F5 — Nó de 64 GB e o resto** | E-mail relay, git deploy, apps, DNS Cloudflare, `.vpm`, AAA | Só depois de qualquer gatilho de F4 disparar | — |

**Nota sobre §3.10.9:** os quatro gatilhos originais são todos de **capacidade**. Faltavam os dois de
**sustentabilidade humana e comercial** — (e) e (f). Um projeto de uma pessoa não morre de RAM cheia;
morre de o dono cansar. O gatilho (f) é o mais importante do roadmap inteiro: **é o único que permite
parar sem que parar seja fracasso.**

---

## 5. Perfil de cliente

### 5.1 O que o `07` §3.10.8 acertou

A lista de quem recusar está **certa e é corajosa** — recusar SLA contratual, tráfego > 300 GB/mês,
e-commerce em pico e carga acima de 4 GB é a decisão certa. Manter no máximo 12 clientes é certo.
Medir cinco métricas operacionais em vez de receita é a melhor linha do documento.

### 5.2 O que o `07` §3.10.8 errou — três coisas

**Erro 1 — o perfil ideal declarado exige e-mail, e o MVP não tem e-mail.**
O documento diz que o cliente ideal é *"site institucional, blog, landing"*. No Brasil, site
institucional de PME significa `contato@dominio.com.br`. **O perfil declarado é incompatível com o
escopo declarado.** Ou entra e-mail (e aí voltam reputação de IP, blacklist e spam de saída — o pior
módulo do inventário, como o próprio `01` §3.5 reconhece), ou o perfil muda.

**Erro 2 — "aceitar de bom grado o cliente que pausa muito, ele custa quase nada" está aritmeticamente
errado na postura A.** Na postura A, ambiente **vendido** reserva RAM mesmo pausado. Um cliente que
pausa 90% do tempo ocupa um dos **14** slots da frota e paga **R$ 6,75/mês** contra um custo fixo de
**R$ 73,36/slot** (R$ 1.027 ÷ 14). Ele não custa quase nada — **ele custa um slot inteiro e paga 9% dele.**
A frase só seria verdadeira na postura C, que o `06` recomenda não usar.

> **Consequência desconfortável: a única funcionalidade genuinamente diferenciada do produto — pausar e
> pagar só o disco — é também a que destrói a receita por ambiente.** Isso não é motivo para não
> construí-la; é motivo para **precificar a reserva**: cobrar pelo *slot reservado*, não só pelo disco.
> Sugestão concreta: **preço de pausa = R$ 12,00/mês fixo (reserva) + R$ 0,25/GB de disco**, com a
> alternativa "arquivar e liberar o slot" a R$ 0,25/GB puro e retomada em até 6 h. Sem isso, o modelo
> horário é uma promessa que o dono paga do bolso.

**Erro 3 — nada é dito sobre onde encontrar o cliente.** Uma política de aceitação sem canal de
aquisição é uma lista de quem recusar de uma fila que não existe.

### 5.3 O cliente ideal desta fase, corrigido

**Quem é:** desenvolvedor freelancer ou agência de 1–3 pessoas, que já conhece o dono pessoalmente, com
**projetos intermitentes** — staging, homologação, demo para cliente, projeto sazonal, side project —
em PHP ou Node, **sem necessidade de caixa de e-mail** (usa Google Workspace ou não usa nada), que
entende o que é um incidente e sabe que está ajudando a testar.

**Não é** dono de PME com site institucional. Esse precisa de e-mail, não tolera incidente e não dá
retorno técnico. É o cliente errado desta fase, e é justamente o que o `07` §3.10.8 nomeia como ideal.

**Onde encontrar (nesta ordem):**
1. **A agenda do próprio dono** — clientes de consultoria, ex-colegas, amigos com projetos parados.
   Com meta de 12 clientes, **a rede pessoal é suficiente e é o único canal com CAC zero.** Marketing
   pago para uma frota de 14 ambientes é dinheiro queimado.
2. Comunidades técnicas locais (grupos de Laravel BR, Next.js BR, PHP-SP, meetups) — mas como pessoa,
   não como anúncio.
3. **Não usar:** Google Ads, marketplace de hospedagem, comparadores de preço. Traz exatamente o cliente
   que a §3.10.8 manda recusar.

### 5.4 A proposta de valor honesta

Não dá para prometer SLA. Não dá para ser mais barato que o Hostoo. Sobram cinco coisas, e elas são
verdadeiras:

1. **"Seu staging custa preço de disco."** Ambiente pausado a R$ 5–17/mês contra R$ 45 parado no
   concorrente. **É a única promessa que nenhum concorrente brasileiro faz** — e é a razão de o produto
   existir.
2. **"Você fala comigo, não com um formulário."** Com 12 clientes isso é verdade e é raro. Com 200 seria
   mentira — e é por isso que o teto de 12 é produto, não limitação.
3. **"Troca PHP 8.1 → 8.3 em 30 segundos, com rollback."** Blue/green com upstream atômico (`06` §5.1)
   é melhor do que a maioria dos painéis do mercado faz.
4. **"Você sai quando quiser, leva tudo, sem taxa."** Exportação livre, backup baixável. Anti-lock-in é
   uma promessa que custa pouco e vale muito para quem já se queimou.
5. **"Extrato hora a hora, e o medidor congela quando estamos fora do ar."** Transparência radical no
   lugar do SLA que não pode ser dado. O congelamento do medidor (`07` §2.3) transforma indisponibilidade
   em não-evento financeiro — **é honestidade que se pode escrever no contrato**.

**E o que se diz na cara, na primeira conversa:** *"São dois servidores, sem redundância, operados por
uma pessoa. Não tem SLA com multa, não tem caixa de e-mail e não tem nota fiscal ainda. O que tem é
backup testado toda semana, RTO de 12 horas, seu dado exportável a qualquer momento e eu no telefone."*

**Isso é defensável?** Para o perfil da §5.3, **sim** — o desenvolvedor com projeto intermitente compra
"staging por preço de disco" e tolera o resto. Para qualquer outro perfil, **não**, e não adianta
insistir. Se a F0b terminar com menos de 3 interessados nesse perfil, **a resposta certa é a §7: o
projeto é ferramenta interna e o billing nunca entra em produção.**

---

## 6. Riscos de produto e reputação

Quatro primeiros clientes, quatro primeiras crises. Cada uma acontece uma vez e define o resto.

### 6.1 O primeiro que perde dado

| | |
|---|---|
| **Probabilidade em 12 meses** | **Alta.** Um nó, um operador, sem N-1. É quando, não se |
| **Tratamento** | `restic` por ambiente + dump horário (RPO 1 h banco / 24 h arquivos) · **drill semanal automatizado com restore real** (`09` §5) · chave do restic **fora dos servidores** · botão de exportação sempre disponível ao cliente |
| **Regra dura que falta no plano** | **Nenhum cliente externo entra antes de o dono restaurar um ambiente completo, sozinho, cronometrado, seguindo só o runbook.** Não é critério técnico; é critério de licença para vender |
| **Dano se acontecer** | Numa base de 12 clientes vindos da rede pessoal, **o dano não é churn — é social.** Perder o dado de um conhecido custa o cliente, os próximos três indicados e a vontade de continuar. É o risco que encerra o projeto |
| **Mitigação de reputação** | Comunicar em ≤ 1 h, com o que se sabe e o que não se sabe. `07` §3.10.10 está certo: **numa base de 11 clientes, a comunicação durante o incidente vale mais que a infraestrutura que caiu** |

### 6.2 O primeiro que reclama de cobrança

| | |
|---|---|
| **Probabilidade** | **Certa.** Cobrança por hora com pausa gera dúvida por desenho — o cliente esqueceu que deixou ligado |
| **Tratamento** | Extrato hora a hora auditável (`07` §2.6) · congelamento do medidor com nó mudo (§2.3) · razão append-only · alerta proativo de "saldo para N dias" |
| **Regra que falta** | **Toda contestação abaixo de R$ 50 é estornada na hora, sem investigação, e investigada depois em silêncio.** A conta é trivial: 1 h do dono custa R$ 80; a maior disputa possível num plano de R$ 49 custa menos que descobrir quem tem razão. Estornar é o resultado economicamente correto **e** o reputacionalmente correto |
| **Dano se acontecer** | Baixo em dinheiro (R$ 10–50), **alto em confiança**: cobrança contestada e defendida vira post. Cobrança contestada e estornada em 5 minutos vira indicação |
| **Onde o plano está bem** | O congelamento do medidor e o extrato hora a hora são as decisões mais maduras dos 11 documentos |

### 6.3 O primeiro que exige nota fiscal

| | |
|---|---|
| **Probabilidade** | **Alta e cedo.** Qualquer cliente PJ precisa de nota para lançar a despesa. Agência é PJ por definição — e agência é o perfil-alvo da §5.3 |
| **Tratamento previsto no plano** | `07` §8 guarda no modelo de dados o que a nota exigiria. Correto e necessário |
| **O que o plano NÃO trata** | **O problema não é o modelo de dados — é a regra de compra do cliente.** Ele não pode pagar sem nota, independentemente do seu banco estar preparado. `07` §8 resolve o problema de 2027 e ignora o de fevereiro |
| **Tratamento correto** | Decidir a pessoa jurídica **antes do cliente nº 1**, não depois. MEI ou Simples custa pouco e resolve. Enquanto não existir: **aceitar apenas pessoa física e dizer isso na primeira conversa**, antes de mostrar preço |
| **Dano se acontecer** | Perde-se a venda — ou, muito pior, opera-se irregularmente recebendo Pix de PJ sem nota. **O segundo cenário é o único risco jurídico real do projeto inteiro**, e é 100% evitável com uma decisão administrativa de R$ 70/mês |

### 6.4 O primeiro que precisa de e-mail

| | |
|---|---|
| **Probabilidade** | **A mais alta das quatro.** No mercado brasileiro, hospedagem e e-mail são a mesma palavra para o cliente |
| **Tratamento** | **Não construir.** Nunca. `01` §3.5 já concluiu isso e está certo: pior relação valor/manutenção do inventário, e o próprio Hostoo terceirizou o antispam |
| **O que fazer** | Botão na tela de DNS: **"Usar e-mail do Google Workspace / Zoho / Titan"**, que aplica os MX corretos em um clique e verifica a propagação. Duas horas de trabalho, resolve 90% dos casos, zero risco de blacklist |
| **Dano se acontecer** | **O dano real não é perder essa venda — é o dono ceder e construir o módulo.** E-mail é o buraco negro que consome os R$ 92 mil de tempo da §2.4 e traz reputação de IP, spam de saída e LGPD junto |
| **Consequência de produto** | Como está na §5.2, isso **elimina o perfil "site institucional de PME"** do alvo desta fase. Assumir isso explicitamente é melhor que descobrir na quinta conversa de vendas |

---

## 7. O maior erro deste planejamento

Um só, o mais grave:

> ## O plano tratou dois projetos diferentes como se fossem um, e especificou a união dos dois.
>
> **Projeto A — ferramenta interna:** hospedar 4–5 sistemas do próprio dono. Não precisa de cobrança, de
> saldo pré-pago, de gateway plugável, de painel de cliente, de isolamento contra inquilino hostil, de
> ciclo de inadimplência, de SLA, de nota fiscal, de status page, de tickets ou de acessibilidade AAA.
> Precisa de container, quota, HTTPS, backup e gráfico. **É 15% do que foi especificado, e resolve 100%
> da necessidade que existe hoje.**
>
> **Projeto B — empresa de hospedagem:** precisa de tudo isso e de mais. E precisa, antes de qualquer
> linha, de uma coisa que o plano nunca produziu: **uma pessoa disposta a pagar.**
>
> Ao especificar A ∪ B, o planejamento produziu **21.555 linhas de especificação de oferta e zero hora
> de validação de demanda**, para uma frota cujo teto é **R$ 896/mês** e cujo ponto de equilíbrio está
> **acima da capacidade física**. O custo de planejar já passou do faturamento anual do que se planejou.

**Por que este é o erro raiz e não os outros:** todos os outros problemas — as 15 mil linhas, a
contradição das posturas A × C, o perfil de cliente que precisa de e-mail que o produto não tem, os 25
módulos, o AAA — são sintomas de não ter separado os dois projetos. Cada especialista, sem saber qual
dos dois estava especificando, especificou os dois. E ninguém somou.

### A correção

1. **Congelar o planejamento no Ciclo 2.** Os Ciclos 3 e 4 não acontecem agora. O que está escrito já é
   mais do que suficiente para construir o MVP da §3 — e continuar planejando é a forma mais confortável
   de não descobrir se alguém compra.
2. **Executar F0 e F0b nas próximas duas semanas, em paralelo:** o `node-doctor` nos 3 nós, e **10
   conversas** com a proposta honesta da §5.4 e a tabela de preço na mão.
3. **Construir o Projeto A** (MVP da §3, um nó, os 5 sistemas dele) **independentemente do resultado das
   conversas.** Ele se paga em aprendizado (§1.3) e é o pré-requisito físico do Projeto B.
4. **O Projeto B só começa se ≥ 3 das 10 conversas virarem "quero".** Se não virarem, o billing nunca sai
   do `mod-pagamento-fake`, os dois nós de produção são cancelados, e o que fica é uma ferramenta interna
   excelente rodando num nó — **que é um bom resultado, não um fracasso.**
5. **Retomar os Ciclos 3 e 4 só na fase F2**, e apenas sobre o que a operação real provar que falta.

---

## Recomendação ao dono

1. **Não construa isto como negócio de hospedagem. Esta frota não fecha em cenário nenhum** — o teto é
   R$ 896/mês e o equilíbrio exige mais ambientes do que ela cabe. Isso é matemática, não pessimismo.
2. **Construa como laboratório, porque como laboratório vale a pena.** Aprender a dirigir uma IA
   construindo um sistema real é a justificativa verdadeira, e é boa.
3. **Rode o `node-doctor` nos 3 nós esta semana.** Se algum for OpenVZ, o plano inteiro morre — melhor
   saber em uma tarde do que em três meses.
4. **Nas mesmas duas semanas, converse com 10 pessoas** oferecendo "staging por preço de disco, sem SLA,
   sem e-mail, sem nota". Se menos de 3 disserem sim, **o projeto é ferramenta interna e pronto** — e
   você economizou R$ 80 mil de tempo com dez telefonemas.
5. **Construa a versão pequena: um nó, seus 5 sistemas, 10 telas, pausa, troca de versão, gráfico,
   medidor e backup com restore testado.** São ~200 h, não ~1.000.
6. **Não construa e-mail. Nunca.** É o buraco que engole o projeto.
7. **Não venda para ninguém antes de restaurar um ambiente do zero sozinho, com o cronômetro na mão.**
8. **Cancele o segundo nó de produção até ter cliente.** São R$ 250/mês de capacidade que ninguém usa.
9. **Pare de planejar agora.** O que está escrito já sustenta a construção; os Ciclos 3 e 4 podem esperar
   a realidade.
10. **Escreva hoje o gatilho de parada:** 12 meses sem R$ 900/mês de receita, você encerra a venda e fica
    com a ferramenta. Decidir isso agora, frio, é o que permite tocar o projeto sem medo.
