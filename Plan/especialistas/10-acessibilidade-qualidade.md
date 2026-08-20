# 10 — Acessibilidade & Qualidade Web

> **Especialista:** Acessibilidade & Qualidade Web · **Ciclo 2**
> **Origem:** ADENDO 2, seção E do `00-BRIEFING.md` — pedido literal do dono: *"quero que o site seja padrão AAA"*.
> **Insumos lidos:** `00-BRIEFING.md`, `especialistas/05-nodejs-nextjs.md` (Next.js 16 App Router, shadcn/ui,
> Tailwind v4, uPlot, SSE, registry de módulos em build-time), `especialistas/01-produto-ux.md`
> (telas do painel do cliente e do super admin).
> **Escopo:** painel do cliente, painel do super admin e site público/marketing.

---

## 0. Leitura rápida (se ler só uma seção, leia esta)

1. **"AAA em tudo" não existe** — nem como meta, nem como declaração. O próprio W3C escreve, na
   norma, que **não recomenda exigir AAA como política geral para sites inteiros**, porque para
   alguns conteúdos é impossível satisfazer todos os critérios AAA.
   ([WCAG 2.2 §Conformance](https://www.w3.org/TR/WCAG22/#cc1))
2. **O que o VelozPanel entrega, e vai declarar publicamente:**
   > **WCAG 2.2 Nível AA em 100% do produto (piso inegociável), mais 24 dos 31 critérios AAA.**
   Isso é mensuravelmente melhor que qualquer painel de hospedagem do mercado brasileiro e é
   **declarável sem mentir**. "Conformidade AAA" completa **não** será declarada.
3. **7 critérios AAA são recusados**, todos por motivo escrito e defensável (5 deles deixam de
   existir por uma decisão de produto: *o painel não publica mídia sincronizada*).
4. **A segunda leitura de "AAA" — qualidade de engenharia — é tratada na §6** com metas numéricas
   de Core Web Vitals, orçamento de KB, CSP estrita sem `unsafe-inline`, Trusted Types e i18n.
5. **Nada disso funciona sem portão automático.** A §5.6 define o que **reprova um merge**.
   Acessibilidade que não é testada no CI vira dívida em duas semanas.

---

## 1. A conversa honesta sobre AAA

### 1.1 O que o W3C realmente diz

A norma tem 3 níveis: **A** (o mínimo, sem o qual há gente que simplesmente não usa o produto),
**AA** (o nível que praticamente toda lei do mundo adota como referência) e **AAA** (o teto).

A frase da norma, traduzida:

> *"Não se recomenda que a conformidade Nível AAA seja exigida como política geral para sites
> inteiros, porque não é possível satisfazer todos os Critérios de Sucesso Nível AAA para alguns
> conteúdos."* — [WCAG 2.2, Understanding Conformance](https://www.w3.org/WAI/WCAG22/Understanding/conformance)

Isso não é preguiça do W3C. É reconhecimento de três problemas reais:

| Problema | Exemplo concreto no VelozPanel |
|---|---|
| **Critérios impossíveis para certos conteúdos** | 3.1.5 *Reading Level* exige que o texto seja compreensível por quem tem escolaridade de ensino fundamental II. Explicar "delegação de zona DNS com registro NS e glue record" nesse nível **e manter a precisão técnica** é impossível. |
| **Critérios sem suporte de tecnologia assistiva** | 1.3.6 *Identify Purpose* depende de semântica de personalização (WAI-Adapt) que **nenhum leitor de tela consome hoje**. Implementar é gastar dinheiro em algo que nenhum usuário percebe. |
| **Critérios que conflitam entre si na prática** | 2.5.5 *Target Size (Enhanced)* pede alvo de 44×44 px. Uma tabela de auditoria com 200 linhas × 5 ações, com 44 px por alvo, vira uma tela onde cabem 12 linhas — o que **piora** a vida de todo mundo, inclusive de quem tem deficiência motora, porque multiplica o scroll. |

E há um detalhe de conformidade que quase ninguém sabe: **a conformidade WCAG é por página, e é
tudo-ou-nada**. Se uma única tela do painel viola um único critério AAA, o produto **não** é AAA.
Não existe "AAA em 90%". Existe "AA, com 24 critérios AAA atendidos" — que é o que vamos declarar.
([WCAG 2.2 §5.2 Conformance Requirements](https://www.w3.org/TR/WCAG22/#conformance-reqs))

### 1.2 A decisão: o "AAA do VelozPanel"

> **Decisão fechada.**
> **Piso:** WCAG 2.2 **Nível AA em 100%** das telas do painel do cliente, do super admin e do site
> público. Sem exceção, sem "depois a gente arruma", sem tela legada.
> **Teto:** um **conjunto fechado e nominal de 24 critérios AAA** (20 integrais + 4 com escopo
> declarado), listado na §1.4, que passa a fazer parte do *Definition of Done* de qualquer tela.
> **Declaração pública:** *"WCAG 2.2 Nível AA, com 24 critérios de Nível AAA atendidos"*.
> Nunca *"site AAA"*.

O ganho de posicionamento é maior assim, não menor: um concorrente que escreve "site AAA" no rodapé
sem declaração de conformidade está mentindo e é processável; o VelozPanel publica uma **declaração
de acessibilidade** (§7) que lista item a item o que cumpre e o que não cumpre. Isso é o que a
LBI e a EN 301 549 realmente esperam de um fornecedor sério.

### 1.3 Os 31 critérios AAA da WCAG 2.2, um por um

Base normativa: WCAG 2.2 tem **86 critérios ativos — 31 A, 24 AA, 31 AAA** (mais o 4.1.1 *Parsing*,
marcado como **obsoleto e removido** na 2.2). Lista extraída da própria Recomendação em
[w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/).

Legenda de **Custo**: 🟢 baixo (disciplina/regra de lint) · 🟡 médio (trabalho de design + código) ·
🔴 alto (conteúdo recorrente, fornecedor externo, ou pesquisa).

#### Princípio 1 — Perceptível

| SC | Nome | Aplicável ao VelozPanel? | Adotamos? | Custo | Justificativa |
|---|---|---|---|---|---|
| **1.2.6** | Sign Language (Prerecorded) | Só se houver vídeo com áudio | ❌ **Não** | 🔴 | Exige intérprete de Libras em janela sincronizada, por vídeo. Custo de produção por peça é maior que o vídeo em si e é **recorrente**. **Decisão de produto que anula o critério:** o painel não publica mídia sincronizada — documentação é texto + imagem estática + GIF sem áudio. Se marketing produzir vídeo, entra com **legenda + transcrição completa** (AA), sem Libras. |
| **1.2.7** | Extended Audio Description | idem | ❌ **Não** | 🔴 | Mesma decisão de produto. Sem mídia sincronizada, é **N/A**. |
| **1.2.8** | Media Alternative (Prerecorded) | idem | ❌ **Não** *(mas cumprido de fato)* | 🟡 | Sem mídia, N/A. Onde houver vídeo de marketing, publicaremos transcrição textual completa — que é exatamente o que o critério pede — mas **não reivindicamos** o critério, porque ele exigiria isso para *toda* mídia, inclusive futura. |
| **1.2.9** | Audio-only (Live) | Não | ❌ **Não** | 🔴 | Não existe áudio ao vivo no produto. N/A por design. |
| **1.3.6** | Identify Purpose | Sim, tecnicamente | ❌ **Não** *(implementamos a parte útil)* | 🔴 | Depende de vocabulário de personalização (WAI-Adapt) **sem suporte em nenhum agente de usuário ou leitor de tela em produção**. Reivindicar seria conformidade de papel. **O que fazemos assim mesmo:** landmarks ARIA completos, `autocomplete` em 100% dos campos pessoais (já exigido pelo AA 1.3.5) e todo ícone com nome acessível. |
| **1.4.6** | **Contrast (Enhanced)** — 7:1 | **Sim, central** | ✅ **Sim, integral** | 🟡 | O critério AAA de maior impacto real num painel operado 8 h/dia. Paleta completa na §3. |
| **1.4.7** | Low or No Background Audio | Não | ❌ **Não** | 🟢 | Não há áudio. N/A por design. |
| **1.4.8** | Visual Presentation | Parcial | ⚠️ **Sim, com escopo** | 🟡 | **Adotado em superfícies de prosa** (documentação, ajuda, marketing, textos legais, e-mails): largura ≤80 caracteres, texto não justificado, entrelinha ≥1,5, espaço entre parágrafos ≥1,5× a entrelinha, 200% de zoom sem scroll horizontal, e 3 temas selecionáveis (claro/escuro/alto contraste). **Não reivindicado em telas de dados** — tabela, log, terminal e gráfico não são "blocos de texto" e a regra de 80 caracteres os destruiria. |
| **1.4.9** | **Images of Text (No Exception)** | **Sim** | ✅ **Sim, integral** | 🟢→🟡 | Regra de disciplina: zero texto rasterizado. Pega uma armadilha não óbvia — **o rótulo de eixo do uPlot é desenhado em `<canvas>`, o que conta como imagem de texto**. Tratado na §2.2. |

#### Princípio 2 — Operável

| SC | Nome | Aplicável? | Adotamos? | Custo | Justificativa |
|---|---|---|---|---|---|
| **2.1.3** | **Keyboard (No Exception)** | **Sim, central** | ✅ **Sim, integral** | 🟡 | Painel de infraestrutura é ferramenta de teclado. Armadilhas reais: terminal web, gerenciador de arquivos com arrastar-e-soltar, pan/zoom do gráfico. §2.3. |
| **2.2.3** | **No Timing** | Sim | ⚠️ **Sim, com escopo** | 🟡 | **Zero limite de tempo na UI**: nenhum contador regressivo, nenhum passo de wizard cronometrado, nenhum toast que leva embora informação essencial, nenhuma sessão de terminal que cai por inatividade. **Exceção declarada e permitida pela própria norma ("essencial"):** expiração da sessão autenticada, por segurança — mitigada por 2.2.5 e 2.2.6, que **adotamos**. §2.4. |
| **2.2.4** | Interruptions | Sim | ✅ **Sim, integral** | 🟡 | O painel é uma fonte de interrupção contínua (SSE de job, alerta de saldo, fim de deploy). Adotamos: preferências de notificação por canal e por tipo, modo "não perturbe", e **nenhuma notificação rouba o foco** — nunca. Exceção de emergência prevista na norma: saldo zerado e ambiente fora do ar podem interromper. |
| **2.2.5** | Re-authenticating | Sim | ✅ **Sim, integral** | 🟡 | Se a sessão expirar no meio do funil de criação de ambiente ou de um formulário de DNS, o usuário reautentica **em modal** e **nada** do que ele digitou se perde. Alto valor real, não só de conformidade. |
| **2.2.6** | Timeouts | Sim | ✅ **Sim, integral** | 🟢 | Rascunho de formulário longo persistido localmente (>20 h) **e** aviso explícito da duração de inatividade antes de expirar. |
| **2.3.2** | Three Flashes | Sim | ✅ **Sim, integral** | 🟢 | Zero piscada em toda a UI. Custo zero: é uma regra, não um trabalho. Inclui banir "pulso" em badge de alerta e blink em cursor de terminal acima de 3 Hz. |
| **2.3.3** | Animation from Interactions | Sim | ✅ **Sim, integral** | 🟢 | `prefers-reduced-motion: reduce` desliga **toda** transição não essencial (acordeões, deslizamento de painel lateral, animação de gráfico, skeleton pulsante). §6.6. |
| **2.4.8** | **Location** | **Sim** | ✅ **Sim, integral** | 🟢 | Breadcrumb em toda rota com profundidade ≥2, `aria-current="page"` na navegação, e `<title>` refletindo a posição. Num painel com ~60 rotas, isso é usabilidade pura. §2.5. |
| **2.4.9** | Link Purpose (Link Only) | Sim | ✅ **Sim, integral** | 🟡 | Proibido "ver mais", "clique aqui", "detalhes". Ação em linha de tabela carrega o nome do recurso no nome acessível. §4.1. |
| **2.4.10** | Section Headings | Sim | ✅ **Sim, integral** | 🟢 | Todo card/seção do painel tem heading real (`<h2>`/`<h3>`), hierarquia sem pulo de nível. Lint automatizável. |
| **2.4.12** | Focus Not Obscured (Enhanced) | Sim | ✅ **Sim, integral** | 🟡 | **Nenhuma** parte do indicador de foco pode ficar escondida (o AA 2.4.11 permite esconder parte). Armadilhas: header fixo, barra de saldo fixa no topo, rodapé de ações do modal, coluna sticky de tabela. §2.6. |
| **2.4.13** | **Focus Appearance** | **Sim** | ✅ **Sim, integral** | 🟢 | Anel de foco de 3 px com halo de contraste, especificado na §3.5. Um único token de CSS resolve o produto inteiro. |
| **2.5.5** | **Target Size (Enhanced)** — 44×44 | **Sim** | ⚠️ **Sim, com escopo** | 🟡 | 44×44 CSS px como **padrão do design system**, obtido por área de toque expandida sem inflar o layout. **Escopo declarado:** o modo "tabela densa" (opt-in explícito do usuário, usado por admin em tela grande) cai para o piso AA 2.5.8 (24 px) e **é declarado como não-conforme AAA** naquele modo. §2.7. |
| **2.5.6** | Concurrent Input Mechanisms | Sim | ✅ **Sim, integral** | 🟢 | Nunca desabilitar uma modalidade por detecção de dispositivo. Proibido `if (isMobile)` que remova handler de teclado, e proibido bloquear mouse em tela de toque. Custo zero — é "não fazer besteira". |

#### Princípio 3 — Compreensível

| SC | Nome | Aplicável? | Adotamos? | Custo | Justificativa |
|---|---|---|---|---|---|
| **3.1.3** | **Unusual Words** | **Sim, muito** | ✅ **Sim, integral** | 🟡 | Painel de hospedagem é sopa de jargão: TTL, CNAME, PTR, SPF, DKIM, DMARC, vCPU, OPcache, PHP-FPM, cron, SFTP, chave SSH, *glue record*, *overcommit*, *drenar nó*. **Este é o AAA de melhor retorno do projeto**: um glossário de ~120 verbetes com definição inline reduz ticket de suporte. §2.8. |
| **3.1.4** | Abbreviations | Sim | ✅ **Sim, integral** | 🟢 | Consequência do 3.1.3: `<abbr>` ligado ao mesmo glossário, com tooltip **acessível a teclado e toque** (não só `title`). |
| **3.1.5** | Reading Level | Parcial | ⚠️ **Sim, com escopo** | 🔴 | **Adotado onde o usuário decide e onde há dinheiro envolvido:** funil de criação, pausar/iniciar, excluir, cobrança, saldo, suspensão, termos e política de privacidade — cada um com bloco "**Em resumo**" em linguagem simples. **Recusado na documentação técnica, nos logs e no terminal**: simplificar "registro NS delegado" abaixo do nível técnico produz texto errado, e texto errado sobre infraestrutura causa perda de dados. |
| **3.1.6** | Pronunciation | Sim, tecnicamente | ❌ **Não** | 🔴 | Em PT-BR não há, no vocabulário do produto, palavra cujo **sentido** dependa da pronúncia a ponto de tornar o texto ambíguo. Marcar pronúncia exigiria conteúdo de áudio ou notação fonética em cada tela, com benefício não demonstrável. Recusado por custo/benefício. |
| **3.2.5** | **Change on Request** | **Sim, crítico** | ✅ **Sim, integral** | 🟡 | Painel com SSE é uma máquina de mudar contexto sozinho. Proibido: redirecionar depois que um job termina, abrir modal sozinho, reordenar tabela quando chega dado novo, dar logout sem aviso. §2.9. |
| **3.3.5** | Help | Sim | ✅ **Sim, integral** | 🟡 | Ajuda contextual em **todo** campo de entrada e em toda tela. Casa direto com o requisito nº 10 do briefing (cada módulo entrega sua própria documentação dentro do painel). |
| **3.3.6** | **Error Prevention (All)** | **Sim, central** | ✅ **Sim, integral** | 🟡 | Toda submissão é reversível, **ou** verificada, **ou** confirmada. Num painel onde um clique errado apaga um site de produção, isto não é acessibilidade — é o produto. §2.11. |
| **3.3.9** | Accessible Authentication (Enhanced) | Sim | ✅ **Sim, integral** | 🟡 | **Zero CAPTCHA de qualquer tipo**, colar habilitado no campo de senha, suporte a gerenciador de senhas, `autocomplete="one-time-code"` no TOTP, e **passkey (WebAuthn) como método primário**. §2.11. |

#### Princípio 4 — Robusto

Não há critério AAA no princípio 4 na WCAG 2.2. O antigo **4.1.1 *Parsing*** foi marcado como
**obsoleto e removido** na WCAG 2.2 — não é mais critério em nenhum nível. Continuamos validando
HTML no CI mesmo assim, por higiene de engenharia, não por conformidade.

### 1.4 Resultado: a lista fechada

#### ✅ AAA que o VelozPanel **vai cumprir** (24)

**Integral (20):**
`1.4.6` Contraste 7:1 · `1.4.9` Sem imagem de texto · `2.1.3` Teclado sem exceção ·
`2.2.4` Interrupções · `2.2.5` Reautenticação sem perda · `2.2.6` Timeouts ·
`2.3.2` Três flashes · `2.3.3` Animação por interação · `2.4.8` Localização ·
`2.4.9` Propósito do link isolado · `2.4.10` Títulos de seção ·
`2.4.12` Foco não obscurecido (aprimorado) · `2.4.13` Aparência do foco ·
`2.5.6` Modalidades concorrentes · `3.1.3` Palavras incomuns · `3.1.4` Abreviaturas ·
`3.2.5` Mudança sob demanda · `3.3.5` Ajuda · `3.3.6` Prevenção de erro (tudo) ·
`3.3.9` Autenticação acessível (aprimorada)

**Com escopo declarado (4):**

| SC | Onde vale | Onde **não** vale (e é declarado) |
|---|---|---|
| `1.4.8` Apresentação visual | Prosa: docs, ajuda, marketing, legais, e-mail | Tabela, log, terminal, gráfico |
| `2.2.3` Sem limite de tempo | Toda a UI | Expiração da sessão autenticada (segurança — exceção "essencial" da norma) |
| `2.5.5` Alvo 44×44 | Padrão do design system, todas as telas | Modo "tabela densa", opt-in explícito → cai para AA 2.5.8 (24 px) |
| `3.1.5` Nível de leitura | Decisão, dinheiro, ciclo de vida da conta, textos legais | Documentação técnica, log, terminal |

#### ❌ AAA que o VelozPanel **recusa** (7)

| SC | Motivo da recusa, em uma frase |
|---|---|
| `1.2.6` Libras | Custo recorrente de intérprete por peça; **anulado por decisão de produto**: não publicamos mídia sincronizada. |
| `1.2.7` Audiodescrição estendida | Idem — sem mídia sincronizada, N/A. |
| `1.2.8` Alternativa para mídia | Idem; faremos transcrição onde houver vídeo, mas não reivindicamos o critério para mídia futura. |
| `1.2.9` Áudio ao vivo | Não existe áudio ao vivo no produto. |
| `1.4.7` Áudio de fundo | Não existe áudio no produto. |
| `1.3.6` Identificar propósito | Depende de WAI-Adapt, **sem suporte em agente de usuário** — seria conformidade de papel. Implementamos landmarks e `autocomplete` assim mesmo. |
| `3.1.6` Pronúncia | Nenhuma ambiguidade real de sentido em PT-BR no vocabulário do produto; custo alto, benefício nulo. |

> **Nota metodológica honesta:** cinco das sete recusas (`1.2.6`–`1.2.9`, `1.4.7`) são
> **eliminadas por decisão de produto**, não vencidas. Isso é legítimo e a norma prevê
> ("não aplicável"), mas é preciso escrever, e está escrito: **o dia em que o marketing publicar um
> vídeo com áudio, o VelozPanel volta a ter 5 critérios AAA em aberto** e a declaração da §7 precisa
> ser revista no mesmo *pull request* que publica o vídeo. Isso vira item de checklist.

### 1.5 Marco legal e normativo — o que de fato obriga o VelozPanel

Esta seção existe porque acessibilidade, no Brasil, **não é boa vontade: é lei desde 2015**, e o
VelozPanel é exatamente o tipo de empresa alcançada pelo texto.

#### Brasil

| Norma | O que diz | Vale para o VelozPanel? |
|---|---|---|
| **LBI — Lei 13.146/2015, art. 63** | *"É obrigatória a acessibilidade nos sítios da internet mantidos por **empresas com sede ou representação comercial no País** ou por órgãos de governo (...) conforme as **melhores práticas e diretrizes de acessibilidade adotadas internacionalmente**."* §1º exige **símbolo de acessibilidade em destaque**. ([Planalto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm)) | **Sim, integralmente.** Não há exceção por porte, receita ou setor. Alcança o site público **e o painel** (é "sítio mantido pela empresa"). "Melhores práticas internacionais" = **WCAG**, na prática. |
| **Penalidade real** | Não há multa administrativa no art. 63. O vetor é **ação civil pública** (LBI art. 98, alterando a Lei 7.853/1989) movida por MP, Defensoria ou associação — com obrigação de fazer, **astreintes** e dano moral coletivo. LBI art. 88 §3º, II chega a permitir **interdição de página na internet**. | **Sim.** O risco não é multa: é decisão judicial com multa diária e exposição. |
| **ABNT NBR 17225:2025** | *Acessibilidade em conteúdo e aplicações web — Requisitos*. Lançada em **11/03/2025**, 69 páginas, **146 diretrizes**, alinhada ao WCAG. É a materialização técnica brasileira do art. 63. ([MDHC](https://www.gov.br/mdh/pt-br/assuntos/noticias/2025/marco/com-apoio-do-governo-federal-nova-norma-tecnica-da-abnt-e-instituida-para-impulsionar-acessibilidade-digital-no-brasil), [CTA/IFRS](https://cta.ifrs.edu.br/abnt-nbr-17225-2025-acessibilidade-em-conteudo-e-aplicacoes-web-requisitos/)) | **Sim, como referência.** Norma ABNT é paga e não é lei por si só, mas é o que um perito citaria numa ACP. **WCAG 2.2 AA a satisfaz.** |
| **ABNT NBR 17060:2022** | Acessibilidade em **aplicativos móveis** — 54 requisitos. ([CTA/IFRS](https://cta.ifrs.edu.br/abnt-nbr-17060-2022-acessibilidade-em-aplicativos-de-dispositivos-moveis-requisitos/)) | **Não hoje** (não há app nativo). Vira relevante se o painel virar app. |
| **eMAG 3.1** | Modelo do governo eletrônico, **abril/2014**, **45 recomendações**, baseado em **WCAG 2.0**. Obrigatório para o **governo federal (SISP)** por força da Portaria nº 3/2007 e do Decreto 5.296/2004 art. 47. ([emag.governoeletronico.gov.br](https://emag.governoeletronico.gov.br/)) | **Não obriga empresa privada.** E está **tecnicamente obsoleto**: WCAG 2.0 de 2008. **WCAG 2.2 AA cobre o eMAG inteiro com folga.** Só volta a importar se o VelozPanel disputar edital público — aí é exigência contratual. |
| **Lei 14.126/2021** | Classifica **visão monocular** como deficiência visual para todos os efeitos legais. ([Planalto](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14126.htm)) | **Sim, e tem efeito de design:** amplia o público e reforça contraste alto, alvos grandes e não depender de percepção fina de profundidade/posição. Reforça `1.4.6` e `2.5.5`. |
| **Selo de acessibilidade** | **Não existe selo federal em vigor.** Existe o Selo de Acessibilidade Digital do **município de São Paulo (SMPED)**, desde 2018. ([Prefeitura SP](https://prefeitura.sp.gov.br/w/noticia/selo-de-acessibilidade-digital-completa-tres-anos-de-existencia)) | Opcional. O que é **obrigatório** é o **símbolo de acessibilidade em destaque** (art. 63 §1º) — entra no rodapé, linkando a declaração da §7. |

> **Nota de status (agosto/2026):** MGI e MDHC anunciaram em março/2025 que o padrão nacional de
> conformidade seria formalizado **por decreto**, com base na NBR 17225. **Não localizamos publicação
> desse decreto até agosto/2026**; a página oficial do gov.br ainda lista eMAG, NBR 17060 e NBR 17225
> lado a lado. Item para revisitar a cada 6 meses.

#### Europa (só importa se vendermos para a UE)

| Norma | Situação | Impacto |
|---|---|---|
| **EN 301 549 V3.2.1 (2021-03)** | Versão **harmonizada vigente**, citada no JOUE pela Decisão de Execução (UE) 2021/1339. Exige **WCAG 2.1 A + AA** na cláusula 9. ([ETSI](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_60/en_301549v030201p.pdf)) | WCAG 2.2 AA **excede**. |
| **EN 301 549 V4.1.x** | **Ainda é rascunho** — o diretório da ETSI mostra `04.01.00_20` (draft, nov/2025) e `04.01.00_30` (voto, jun/2026), **sem versão publicada**. Final alinhada a **WCAG 2.2 AA**, esperada no JOUE por volta de **out/2026**. ([ETSI](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/)) | Já estamos no alvo dela. |
| **O que a EN exige ALÉM do WCAG** | **11.7** respeitar preferências do sistema operacional (fonte, cor, contraste, cursor); **11.5** interoperabilidade com tecnologia assistiva; **12.1** documentação do produto descrevendo os recursos de acessibilidade, em formato acessível; **12.2** suporte (help desk, chat, tickets) prestado de forma acessível. | **Isto muda o nosso escopo.** Três consequências entram no plano: (a) `prefers-color-scheme`, `prefers-reduced-motion`, `prefers-contrast` e **`forced-colors` (Modo de Alto Contraste do Windows)** são obrigatórios — §6.6; (b) a documentação de cada módulo precisa dizer o que é acessível nele — §6.7; (c) o **ticket de suporte** (`01-produto-ux.md` §A.5.2) é parte do escopo de conformidade, não um anexo. |
| **European Accessibility Act — Diretiva (UE) 2019/882** | **Aplicável desde 28/06/2025.** Alcança operador de fora da UE que preste serviço abrangido a consumidor na UE. Isenção de microempresa vale **só para serviços**: <10 funcionários **E** faturamento ≤ €2 mi. Penalidades definidas por cada Estado (de ~€5.000 a €250.000+). ([Comissão Europeia](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/union-equality-strategy-rights-persons-disabilities-2021-2030/european-accessibility-act_en)) | **Hoje, não nos alcança**: mercado-alvo é Brasil, venda em BRL/Pix, e hospedagem B2B não é "comércio eletrônico ao consumidor". **Mas** se o site público passar a vender para consumidor na UE, alcança. Barato manter a porta aberta agora; caro reformar depois. |
| **Precedente que mostra como isso é cobrado** | **Carrefour, Tribunal Judiciário de Caen, 04/06/2026:** o tribunal rejeitou o argumento de "71% de conformidade" e afirmou que acessibilidade digital é **obrigação de resultado, não de meio**. Prazo de 6 meses, **astreinte de €500/dia**, €10.000 de danos. ([EcommerceMag](https://www.ecommercemag.fr/retail-1220/le-tribunal-de-caen-oblige-carrefour-a-rendre-son-site-accessible-58340)) | Reforça a §1.2: **"parcialmente acessível" não é defesa.** É exatamente por isso que declaramos AA integral em vez de "AAA quase todo". |

#### EUA (referência apenas)

**ADA Title II** — regra final do DOJ de 24/04/2024 exige **WCAG 2.1 AA** de governos estaduais e
locais. Em **17/04/2026** o DOJ publicou *Interim Final Rule* **adiando os prazos em um ano**
(≥50.000 hab.: 26/04/2027; <50.000: 26/04/2028). Não alcança empresa privada estrangeira.
([Federal Register](https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web))

#### WCAG 3.0 — vale planejar para ela? **Não.**

Status em **março de 2026**: **W3C Working Draft** ([w3.org/TR/wcag-3.0](https://www.w3.org/TR/wcag-3.0/)).
Fatos que importam para a decisão:

- **O modelo bronze/prata/ouro saiu do rascunho.** A versão de março/2026 diz apenas que "vários
  níveis de conformidade estarão disponíveis" e mantém a seção de conformidade **em aberto**.
  Blogs comerciais que ainda citam bronze/silver/gold e "174 requisitos" estão desatualizados —
  o documento normativo não confirma número nenhum.
- Mudança estrutural do draft de março/2026: *outcomes* passaram a se chamar **requirements**.
- O próprio documento adverte que **é inadequado citá-lo como algo que não seja trabalho em
  andamento**, e o WAI diz que WCAG 3 "não é esperado como padrão concluído por mais alguns anos".
  Estimativas externas: **2028–2029+**.
- O WAI confirma que **WCAG 2 não será depreciado por vários anos** após a finalização da 3.0.

> **Decisão: alvo único = WCAG 2.2.** Cobre LBI art. 63, supera eMAG 3.1 (que é WCAG 2.0), satisfaz
> NBR 17225, satisfaz EN 301 549 V3.2.1 e já antecipa a V4.1.1. Nada do que fizermos para 2.2 é
> perdido quando a 3.0 sair. **WCAG 3.0: monitorar a cada 6 meses, não planejar.**

#### O que muda no WCAG 2.2 em relação à 2.1 (e por que isso é bom para nós)

Recommendation em **5/10/2023**, com atualizações editoriais em **12/12/2024** e **6/5/2025**
(nenhum critério mudou). **Nove critérios novos, um removido:**

| Nº | Nome | Nível | Impacto no VelozPanel |
|---|---|---|---|
| 2.4.11 | Focus Not Obscured (Minimum) | **AA** | Piso. Header fixo do ambiente é o risco. |
| 2.4.12 | Focus Not Obscured (Enhanced) | AAA | **Adotado** — §2.6 |
| 2.4.13 | Focus Appearance | AAA | **Adotado** — §3.5 |
| 2.5.7 | Dragging Movements | **AA** | Piso. Atinge gerenciador de arquivos, slider e reordenação de registros DNS. |
| 2.5.8 | Target Size (Minimum) — 24 px | **AA** | Piso. É o fallback do modo "tabela densa". |
| 3.2.6 | Consistent Help | **A** | Piso — e é **Nível A**, o mais fácil de esquecer. §2.10 |
| 3.3.7 | Redundant Entry | **A** | Piso. O funil de criação em 5 passos não pode pedir o mesmo dado duas vezes. |
| 3.3.8 | Accessible Authentication (Minimum) | **AA** | Piso. |
| 3.3.9 | Accessible Authentication (Enhanced) | AAA | **Adotado** — §2.11 |
| ~~4.1.1~~ | ~~Parsing~~ | **removido** | Deixou de ser critério em qualquer nível na 2.2. Continuamos validando HTML por higiene, não por conformidade. |

Ou seja: **6 dos 9 novos são de nível A/AA**, portanto já estão no nosso piso obrigatório, e
**3 dos 9 são AAA e nós adotamos os três**. O VelozPanel nasce direto na 2.2 — não há custo de
migração, que é a única vantagem real de começar um produto do zero em 2026.

---

## 2. Os AAA de alto impacto, em profundidade

Esta seção traduz cada critério adotado em **obrigação concreta de design e de código**. É o que a
IA construtora deve seguir; não é discussão.

### 2.1 `1.4.6` Contraste aprimorado (7:1)

**O que obriga:** todo texto normal com **≥7:1** contra o fundo imediato; texto grande
(≥24 px, ou ≥18,66 px em negrito) com **≥4,5:1**. Não vale média, não vale "quase".

Consequências que mudam o design, e não são óbvias:

1. **Morre a paleta de cinza claro.** O `text-muted-foreground` padrão do shadcn/ui
   (`oklch(0.556 0 0)`, ≈4,6:1 no claro) **reprova**. Todo *token* de texto secundário precisa ser
   recalculado — feito na §3.
2. **Morre o "botão colorido com texto branco" em cores vivas.** Verde de sucesso `#22C55E` com
   texto branco dá 2,2:1. O botão de sucesso precisa de verde **escuro** (`#0B5F2E`, 7,8:1).
3. **Contraste é contra o fundo *imediato*, não contra a página.** Um chip claro sobre um card
   claro sobre o fundo da página tem três camadas — o texto precisa de 7:1 contra o **chip**.
   Por isso a §3 valida cada token contra `bg`, `surface` **e** `elevated`.
4. **`1.4.6` não cobre elementos não textuais.** Bordas, ícones sem texto, trilha de slider e a
   linha do gráfico continuam regidos pelo AA `1.4.11` (3:1). **Decisão do VelozPanel:** elevamos
   voluntariamente o piso não textual para **4,5:1** onde o elemento carrega informação
   (série do gráfico, ícone de estado, borda de campo com erro). Não é exigência AAA — é
   coerência: não faz sentido texto a 7:1 e ícone de erro a 3:1.
5. **O modo escuro é mais difícil que o claro.** Para 7:1 sobre `#0D1117` a cor precisa de
   luminância relativa ≥0,34, o que exclui quase todos os "acentos vibrantes". Resultado prático:
   no escuro as cores de estado ficam **pastéis claras**, não neon. Isso é feio para quem espera
   dashboard "hacker" e é a coisa certa a fazer.

### 2.2 `1.4.9` Imagens de texto sem exceção — e a armadilha do `<canvas>`

**O que obriga:** nenhum texto pode ser entregue como imagem, exceto **decoração pura** e
**essencial** (logotipo conta como essencial).

Regras diretas para o repositório:
- Nenhum `.png`/`.jpg` de UI com texto embutido. Diagrama de documentação = **SVG com `<text>` real**
  ou HTML/CSS, jamais captura de tela com legenda embutida.
- Captura de tela em documentação é permitida **apenas** como ilustração redundante: o texto que ela
  mostra precisa existir também no corpo da página.
- Ícone sempre em SVG com `currentColor`, nunca com texto dentro.
- **Nada de fonte-ícone** (Font Awesome como glifo): o mapeamento para caractere Unicode faz alguns
  leitores de tela lerem lixo, e o "texto" fica sem alternativa.

**A armadilha que ninguém vê:** o `05-nodejs-nextjs.md` fecha **uPlot** para toda série temporal
(decisão correta por performance — SVG com 35 mil pontos trava a aba). Mas uPlot desenha os
**rótulos de eixo, os valores e a legenda dentro do `<canvas>`**. Texto pintado em canvas:

- não é selecionável, não é traduzível pelo navegador, não é lido por leitor de tela;
- **não reescala** quando o usuário aumenta só o tamanho da fonte (WCAG 1.4.4 *Resize Text*, AA);
- para efeito de conformidade, **é imagem de texto** → viola `1.4.9`.

> **Regra obrigatória do VelozPanel:** todo `<canvas>` que contenha texto é acompanhado de
> **(a)** uma alternativa textual completa em HTML — a tabela de dados da §4.2 — e
> **(b)** um observador de `resize`/zoom que redesenha o gráfico com `devicePixelRatio` e com o
> tamanho de fonte efetivo lido do DOM (`getComputedStyle(container).fontSize`), nunca com um `px`
> fixo no código.
> Com a alternativa textual presente e equivalente, o texto do canvas passa a ser **redundante**, o
> que satisfaz `1.4.9` (decoração/redundância) e `1.1.1`.

Onde for possível, os rótulos dos eixos são **HTML sobreposto ao canvas** (`position:absolute`)
em vez de pintados — uPlot permite desligar o desenho dos *ticks* e posicioná-los por hook. Custo
baixo, e resolve `1.4.4`, `1.4.9` e `1.4.12` (*Text Spacing*) de uma vez.

### 2.3 `2.1.3` Teclado sem exceção

**O que obriga:** **toda** funcionalidade operável por teclado, **sem** exigir tempo específico
por tecla. O AA (`2.1.1`) permite a exceção de "entrada dependente de traçado" (desenho livre,
assinatura). O AAA **não permite exceção nenhuma**.

As quatro armadilhas reais deste painel:

| Onde | Problema | Solução obrigatória |
|---|---|---|
| **Gerenciador de arquivos** (`01-produto-ux.md` §1.9) | Mover/organizar por arrastar-e-soltar | Toda ação de arrastar tem equivalente em menu: *Recortar* (Ctrl+X) → navegar → *Colar* (Ctrl+V), e item de menu "Mover para…" que abre seletor de pasta. Isso também é exigido pelo AA `2.5.7` *Dragging Movements*. |
| **Gráfico de consumo** | Pan e zoom só com mouse/roda | Gráfico é `tabindex="0"` com teclas documentadas: `←/→` move o cursor entre amostras (anunciando valor por `role="status"`), `+/−` zoom, `Home/End` extremos, `Esc` sai. Alternativa sempre disponível: seletor de período (1h/6h/24h/7d/30d) em `<button>` reais. |
| **Terminal web** (xterm.js) | O terminal precisa capturar `Tab` — e vira armadilha de teclado (`2.1.2`, Nível **A**) | Ver §4.7: rota de fuga documentada e visível, com `Esc Esc` e um botão "Sair do terminal" fora do foco capturado. |
| **Slider de RAM/vCPU** | Componente customizado com `div` e `onMouseDown` | Usar `<input type="range">` nativo, ou o `Slider` do Radix, que já implementa `←/→/Home/End/PageUp/PageDown`. Ver §4.9. |

Regra de lint que fecha 80% dos casos: **`onClick` em elemento não interativo é erro de build**
(`jsx-a11y/no-noninteractive-element-interactions` + `click-events-have-key-events` no nível `error`).

### 2.4 `2.2.3` Sem limite de tempo (e o que fazer com a sessão)

**O que obriga:** o conteúdo **não impõe** limite de tempo, salvo em evento em tempo real
(ex.: um leilão) ou quando o limite é **essencial**.

Obrigações concretas:

- **Nenhum contador regressivo em nenhum lugar.** Nem no funil de criação, nem no checkout, nem em
  "sua reserva expira em 10:00" (padrão de pressão que o mercado adora e que aqui é proibido).
- **Toast nunca carrega informação que não exista em outro lugar.** Um toast que some em 5 s é um
  limite de tempo. **Regra:** todo toast é espelhado na central de notificações
  (`01-produto-ux.md` §4.15) e, se for erro, permanece na tela até ser fechado.
- **O log ao vivo e o gráfico têm botão de pausa.** "Pausar atualização" congela a região sem parar
  o SSE, e existe um controle "Retomar". Isso atende também o `2.2.2` (Nível A).
- **Terminal não cai por inatividade** — o `TMOUT` do shell é desabilitado no PTY do painel.
- **Nada de auto-logout silencioso.**

**A exceção declarada — sessão autenticada.** Um painel que controla servidores de produção não pode
ter sessão eterna. A norma permite o limite quando ele é **essencial**, e segurança de sessão é o
caso de livro. Como fica honesto:

1. Sessão de **12 h** com renovação silenciosa enquanto a aba estiver em uso.
2. **Aviso a 5 minutos do fim**, em `role="alertdialog"`, com botão "Continuar conectado" — e o
   aviso **não** tem contador visual regressivo piscando; tem um texto estático "sua sessão expira
   em cerca de 5 minutos" atualizado a cada minuto por `role="status"`.
3. Ao expirar, **modal de reautenticação** sem sair da tela, e **todo estado de formulário
   preservado** (`2.2.5`).
4. Rascunho de qualquer formulário longo persistido localmente por **>20 h** (`2.2.6`), o que
   dispensa até o aviso segundo a própria letra do critério.

### 2.5 `2.4.8` Localização — "3 cliques" e onde eu estou

O critério pede **informação sobre a localização do usuário dentro de um conjunto de páginas**.
Não existe "regra dos 3 cliques" na WCAG — ela é folclore de UX. O que existe, e é o que o dono
quis dizer, é a combinação de `2.4.5` *Multiple Ways* (AA) + `2.4.8` *Location* (AAA). Vamos
cumprir os dois e ainda adotar a meta de 3 cliques como **regra de produto**.

Obrigações concretas:

1. **Breadcrumb em toda rota com profundidade ≥2**, dentro de `<nav aria-label="Trilha de navegação">`,
   com o item atual marcado por `aria-current="page"` e **não sendo link**.
   Ex.: `Ambientes › oliveirafacil.com › Configurações › PHP`.
2. **`aria-current="page"`** no item ativo da navegação lateral e das abas.
3. **`<title>` hierárquico e único**: `PHP · oliveirafacil.com · VelozPanel` — nunca só "VelozPanel".
   É o que o leitor de tela anuncia primeiro a cada navegação do App Router.
4. **Três formas de chegar a qualquer tela** (`2.4.5`): navegação lateral, busca global (`Ctrl+K`,
   com equivalente em botão visível — atalho de tecla única é proibido por `2.1.4`), e mapa do site
   em `/mapa` (também é onde o site público cumpre o critério).
5. **Meta de produto — 3 cliques:** qualquer tela do painel do cliente alcançável em **≤3 cliques**
   a partir do dashboard, e qualquer tela do super admin em **≤3** a partir de `/admin`. Isso é
   verificável: um teste automatizado percorre o mapa de rotas gerado e falha se alguma rota exigir
   4 níveis. Vira portão de CI (§5.6).
6. **`SkipLink`** para o conteúdo principal como primeiro elemento focável de toda página (`2.4.1`, A).

### 2.6 `2.4.12` Foco não obscurecido (aprimorado)

**O que obriga:** quando um componente recebe foco, **nenhuma parte** do indicador pode ficar
coberta por outro conteúdo. O AA (`2.4.11`) tolera cobertura parcial; o AAA não tolera nada.

Cada elemento fixo/sticky do `01-produto-ux.md` é um risco. Obrigações:

- **Header fixo do ambiente** (§1.2 do doc de UX) e **chip global de saldo** (§5.5): a soma das
  alturas fixas vira uma variável CSS `--vp-sticky-top`, e **todo elemento focável** recebe
  `scroll-margin-top: calc(var(--vp-sticky-top) + 8px)`. Um seletor global resolve:
  ```css
  :where(a, button, input, select, textarea, summary, [tabindex]) {
    scroll-margin-top: calc(var(--vp-sticky-top, 0px) + 8px);
    scroll-margin-bottom: calc(var(--vp-sticky-bottom, 0px) + 8px);
  }
  ```
- **Rodapé de ações do modal** (`[Cancelar] [Pausar ambiente]`): o corpo do modal rola **dentro**
  de si; o rodapé é irmão do corpo, nunca sobreposto a ele.
- **Coluna sticky de tabela** (nome do ambiente fixo à esquerda em rolagem horizontal): ela cobre o
  foco das células que passam por baixo. **Decisão: não usamos coluna sticky.** Em vez disso, a
  tabela larga vira *cards* empilhados abaixo de 1024 px, e no desktop a primeira coluna é apenas
  a mais larga, sem `position: sticky`.
- **Tooltip e popover** nunca aparecem sob o cursor de foco: usar `@floating-ui` com
  `flip` + `shift` e `padding` igual a `--vp-sticky-top`.
- **Cookie banner / barra de aviso**: só no site público, e ela **empurra** o conteúdo
  (`position: relative`), não flutua sobre ele.

### 2.7 `2.5.5` Alvo de toque 44×44

**O que obriga:** área de alvo de ponteiro de pelo menos **44 × 44 CSS px**. Exceções da norma:
alvo **inline** dentro de um bloco de texto, alvo controlado pelo agente de usuário, alvo
**essencial**, e quando o tamanho é determinado pelo conteúdo.

O conflito é real: uma tabela de auditoria com 44 px por alvo mostra menos da metade das linhas.
Resolução em três partes:

1. **Alvo expandido sem inflar o layout.** O botão pode ser visualmente 32 px e ter alvo de 44 px,
   via pseudo-elemento. Isto é o truque central do design system:
   ```css
   .vp-target-44 { position: relative; }
   .vp-target-44::after {
     content: ""; position: absolute; inset: 50% 50% 50% 50%;
     width: 44px; height: 44px; transform: translate(-50%, -50%);
     left: 50%; top: 50%;
   }
   ```
   Funciona para ícone de ação em linha, botão de fechar chip, item de paginação e caixa de seleção.
2. **Alvos não podem se sobrepor.** Consequência: a altura mínima de linha de tabela no modo padrão
   é **48 px** (44 de alvo + 4 de respiro). Isso é a densidade padrão do VelozPanel e não se discute.
3. **Modo "tabela densa"** — linha de 36 px, alvo de 32 px — existe, é **opt-in explícito** na
   preferência do usuário (não é o padrão, não é lembrado por dispositivo, tem rótulo
   "Densidade compacta — reduz o tamanho dos botões"), e **é declarado como não-conforme AAA** na
   declaração de acessibilidade (§7). Continua conforme AA (`2.5.8`, 24 px).

Outros alvos que passam despercebidos e são obrigatórios: célula clicável inteira em tabela
(a linha toda navega, não só o link do nome), *handle* do slider, marcador do gráfico, ponto de
redimensionamento do painel dividido do gerenciador de arquivos, e o `<summary>` do acordeão.

### 2.8 `3.1.3` / `3.1.4` Palavras incomuns e abreviaturas — o glossário

**O que obriga:** um mecanismo para identificar a definição de palavras usadas de forma incomum ou
técnica, e a forma expandida de toda abreviatura.

Implementação única que resolve os dois:

- **`packages/contracts/glossario.pt-BR.ts`** — fonte única, ~120 verbetes, cada um com
  `termo`, `sigla?`, `expansao?`, `definicao` (1–2 frases em linguagem simples), `saibaMais?` (link).
- Componente `<Termo id="ttl">TTL</Termo>` renderiza `<abbr>` quando há sigla, e abre a definição
  num **popover acessível** (não `title`, que é invisível para teclado e toque):
  ```tsx
  <Termo id="cname" />           // → "CNAME" com botão de definição
  <Termo id="ttl">TTL</Termo>    // → <abbr title="Time To Live"> + popover
  ```
- **Primeira ocorrência por página é obrigatória**; as seguintes são opcionais (a norma exige
  o mecanismo, não a repetição).
- Página `/glossario` lista tudo, é indexável pelo site público e vira **SEO de cauda longa**
  ("o que é CNAME", "para que serve o TTL") — o critério AAA paga o próprio custo em aquisição.
- Os módulos **entregam seus próprios verbetes** (`host.glossario.register()`), como entregam suas
  mensagens de i18n. Regra de conformidade de módulo na §6.7.

### 2.9 `3.2.5` Mudança sob demanda — o critério que o SSE mais ameaça

**O que obriga:** mudanças de contexto (troca de página, mudança de foco, mudança substancial de
conteúdo) só acontecem **por solicitação do usuário**, ou há um mecanismo para desligá-las.

Lista de proibições diretas neste painel, todas derivadas de comportamentos que o
`01-produto-ux.md` descreve ou que a IA construtora tenderia a implementar sozinha:

| ❌ Proibido | ✅ Substituto obrigatório |
|---|---|
| Redirecionar para `/ambientes/{id}` quando o job de provisionamento terminar | Card de progresso vira card de sucesso **no lugar**, com botão "Abrir ambiente" |
| Abrir modal automaticamente quando um deploy falha | Toast em `role="status"` + item na central de notificações; o modal só abre por clique |
| Reordenar/reinserir linhas na tabela de jobs quando chega evento SSE | Barra "**3 novos jobs** — [Mostrar]" no topo; a lista só muda ao clicar |
| Mover o foco para o campo com erro na validação | Foco vai para o **resumo de erros** no topo, e só quando o usuário submete |
| Trocar a aba ativa quando um job de outra aba termina | Marcador visual (ponto) na aba, sem trocar |
| Auto-focar o campo de busca ao carregar a página | Nunca. `autoFocus` é proibido fora de modal |
| Submeter formulário no `onChange` de um `<select>` | `<select>` + botão "Aplicar" (isto também é `3.2.2`, Nível A) |
| Trocar o tema sozinho quando o SO troca no meio da sessão | Respeitar `prefers-color-scheme` **na carga**; depois, só o controle do usuário manda |

Nota: **atualizar o gráfico a cada 15 s não é mudança de contexto** — é mudança de conteúdo, que é
permitida. Ela é regida por `4.1.3` *Status Messages* (AA) e por `2.2.2` (botão de pausa).

### 2.10 `3.2.6` Ajuda consistente (A) + `3.3.5` Ajuda (AAA)

Dois critérios diferentes que o dono juntou em "ajuda consistente". Ambos entram.

**`3.2.6` Consistent Help — Nível A (novo na WCAG 2.2, portanto obrigatório no piso):**
se houver mecanismo de ajuda (contato humano, chat, formulário de suporte, telefone), ele deve
aparecer **na mesma ordem relativa** em todas as páginas onde existe.
→ **Obrigação:** o botão **Ajuda** vai no header global, sempre na mesma posição, em **100%** das
rotas do cliente, do admin e do site público. Não pode existir tela sem ele, e não pode mudar de
lugar entre `(cliente)` e `(admin)`.

**`3.3.5` Help — Nível AAA:** ajuda **sensível ao contexto** disponível para entrada de dados.
→ Obrigações concretas:
- Todo campo tem **texto de apoio persistente** (`aria-describedby`), não só `placeholder`
  (placeholder some ao digitar e frequentemente reprova contraste — é proibido como único rótulo).
- Todo campo com formato exigido mostra o formato **antes** do erro: "TTL em segundos, entre 60 e
  86400", "Chave SSH começa com `ssh-rsa` ou `ssh-ed25519`".
- Toda tela tem um painel "**Sobre esta tela**" (`<details>`), com 3–5 linhas em linguagem simples e
  link para a documentação do módulo dentro do painel (requisito nº 10 do briefing).
- Toda mensagem de erro de infraestrutura mostra **causa provável + próximo passo**, nunca só o
  código: "Falha ao emitir certificado: o DNS de `www.exemplo.com` ainda aponta para outro servidor.
  [Ver registros DNS] [Tentar novamente]".

### 2.11 `3.3.6` Prevenção de erro (tudo) e `3.3.9` Autenticação

**`3.3.6`** obriga que **toda** submissão seja: **reversível**, **ou** verificada com oportunidade de
corrigir, **ou** confirmada. O AA (`3.3.4`) só exige isso para o que é legal, financeiro ou apaga
dados. Aqui, praticamente tudo no painel é uma dessas três coisas — então o custo marginal do AAA é
menor do que parece.

Matriz obrigatória (toda ação do painel cai em uma linha):

| Classe de ação | Exemplos | Mecanismo obrigatório |
|---|---|---|
| **Reversível** | trocar versão de PHP, ligar/desligar extensão, mudar diretiva, editar registro DNS | Botão **Desfazer** por 30 s no toast **e** histórico de alterações com "reverter" na tela |
| **Verificada** | criar registro DNS, adicionar chave SSH, cron, `.htaccess`, regra de redirect | Validação de sintaxe no cliente (mesmo `zod` de `packages/contracts`) **+ dry-run no servidor** antes de aplicar |
| **Confirmada** | pausar, redimensionar, restaurar backup, trocar domínio principal, excluir ambiente, excluir conta | Modal com **impacto explícito** (tempo fora do ar, custo novo, o que se perde) — e, nas três mais graves, **confirmação por digitação** (§4.10) |
| **Reversível *e* confirmada** | excluir ambiente | Confirmação por digitação **+ lixeira de 7 dias** + backup final retido 15 dias (já previsto em `01-produto-ux.md` §A.3) |

Ponto que a norma exige e que é fácil esquecer: **toda ação com custo financeiro mostra o valor
novo antes de confirmar** — o que já é o Princípio 3 do `01-produto-ux.md` §5.1. Conveniente: o
produto já queria fazer isso.

**`3.3.9` Autenticação acessível (aprimorada)** proíbe **qualquer** teste de função cognitiva no
login. Diferença para o AA `3.3.8`: o AA ainda permite "reconhecer objetos" (aquele *"clique nas
motos"*); o AAA **não permite nada**.

| Regra | Detalhe |
|---|---|
| **Zero CAPTCHA** | Nenhum reCAPTCHA, hCaptcha ou puzzle. Antiabuso por *rate limit* por IP e por conta, atraso progressivo, e bloqueio com desbloqueio por e-mail. Se um desafio invisível for necessário, ele **não pode exigir interação do usuário**. |
| **Colar habilitado** | `onPaste` **nunca** bloqueado em senha, TOTP ou código de recuperação. Bloquear colar é o erro nº 1 que reprova este critério. |
| **Gerenciador de senhas** | `autocomplete="username"`, `autocomplete="current-password"`, `autocomplete="new-password"`, `autocomplete="one-time-code"`. Campo de senha em `<form>` real com `<input type="password">`. |
| **Passkey (WebAuthn) primário** | Elimina memorização e transcrição de uma vez. É também o melhor 2FA para um painel de infraestrutura. |
| **TOTP permitido** | Com `autocomplete="one-time-code"`, colar liberado e sem limite de tempo na digitação (só o do próprio TOTP, que é do protocolo, não da UI). |
| **Sem "digite a 3ª e a 7ª letra da sua senha"** | Isso é teste cognitivo puro. Proibido. |
| **Mostrar senha** | Botão "Mostrar senha" (`aria-pressed`) em todo campo de senha — reduz erro de transcrição e é recomendação direta do *Understanding* do critério. |

---

## 3. Paleta e design tokens que atendem 7:1

Todos os valores abaixo foram **calculados**, não estimados — fórmula de luminância relativa da
WCAG 2.2 ([§Contrast Ratio](https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio)), com verificação de
cada par contra **as três superfícies** onde o texto pode cair. O script que gera esta tabela vive em
`packages/design-tokens/scripts/contrast-audit.ts` e **roda no CI** (§5.6): qualquer token novo
abaixo do piso reprova o build.

### 3.1 Superfícies

| Papel | Token | Claro | Escuro |
|---|---|---|---|
| Fundo da página | `--vp-bg` | `#FFFFFF` | `#0D1117` |
| Superfície de card | `--vp-surface` | `#F4F6F9` | `#161B22` |
| Superfície elevada (modal, popover, linha destacada) | `--vp-elevated` | `#FFFFFF` | `#1F2733` |
| Borda padrão (não textual, piso 3:1) | `--vp-border` | `#7E8A9A` | `#657385` |
| Borda sutil (decorativa, **sem** exigência) | `--vp-border-subtle` | `#DDE3EA` | `#2A323D` |

> **Nota:** no tema claro, `surface` e `elevated` invertem de propósito — o card é levemente
> acinzentado e o modal é branco puro. Isso dá hierarquia sem sombra pesada e mantém o cálculo de
> contraste simples.
> **`--vp-border-subtle` só pode ser usada em separadores decorativos.** Toda borda que **informa**
> (contorno de campo, contorno de card selecionável, divisor de coluna clicável) usa `--vp-border`,
> que passa 3:1.

### 3.2 Texto — tema claro (piso 7:1 contra `#FFFFFF` **e** `#F4F6F9`)

| Token | Hex | vs `#FFFFFF` | vs `#F4F6F9` | Uso |
|---|---|---|---|---|
| `--vp-text` | `#10151C` | **18,32:1** | **16,92:1** | Texto principal, valores, títulos |
| `--vp-text-2` | `#3D4757` | **9,39:1** | **8,67:1** | Texto secundário, descrição de campo |
| `--vp-text-3` | `#46505F` | **8,16:1** | **7,54:1** | Rótulo de tabela, metadados, *placeholder* |
| `--vp-link` | `#0A46B8` | **8,14:1** | **7,51:1** | Link e ação textual |

> O token `text-muted-foreground` padrão do shadcn/ui (≈4,6:1) **não existe** no VelozPanel.
> O piso mais baixo do produto é `--vp-text-3`, a 7,54:1. Placeholder usando cinza claro é
> **erro de build**.

### 3.3 Texto — tema escuro (piso 7:1 contra `#0D1117`, `#161B22` **e** `#1F2733`)

| Token | Hex | vs `bg` | vs `surface` | vs `elevated` | Uso |
|---|---|---|---|---|---|
| `--vp-text` | `#F2F5F9` | **17,31:1** | **15,82:1** | **13,75:1** | Texto principal |
| `--vp-text-2` | `#C7D0DC` | **12,15:1** | **11,11:1** | **9,66:1** | Texto secundário |
| `--vp-text-3` | `#A9B4C4` | **9,02:1** | **8,25:1** | **7,17:1** | Metadados, *placeholder* |
| `--vp-link` | `#8FBBFF` | **9,66:1** | **8,83:1** | **7,68:1** | Link e ação textual |

### 3.4 Cores semânticas — texto sobre superfície

**Tema claro** (contra `#FFFFFF` / `#F4F6F9`):

| Papel | Token | Hex | vs `#FFF` | vs `#F4F6F9` |
|---|---|---|---|---|
| Marca / primário | `--vp-brand` | `#0A46B8` | **8,14:1** | **7,51:1** |
| Sucesso | `--vp-success` | `#0B5F2E` | **7,81:1** | **7,21:1** |
| Aviso | `--vp-warning` | `#6E4200` | **8,60:1** | **7,94:1** |
| Erro / perigo | `--vp-danger` | `#9E1420` | **8,16:1** | **7,53:1** |
| Informação | `--vp-info` | `#095078` | **8,64:1** | **7,98:1** |
| Neutro / inativo | `--vp-neutral` | `#4A5462` | **7,68:1** | **7,09:1** |
| Destaque (impersonação, beta) | `--vp-accent` | `#5A2296` | **9,98:1** | **9,22:1** |

**Tema escuro** (contra `#0D1117` / `#161B22` / `#1F2733`):

| Papel | Token | Hex | vs `bg` | vs `surface` | vs `elevated` |
|---|---|---|---|---|---|
| Marca / primário | `--vp-brand` | `#8FBBFF` | **9,66:1** | **8,83:1** | **7,68:1** |
| Sucesso | `--vp-success` | `#6EDB97` | **11,03:1** | **10,08:1** | **8,77:1** |
| Aviso | `--vp-warning` | `#FFC53D` | **11,99:1** | **10,96:1** | **9,53:1** |
| Erro / perigo | `--vp-danger` | `#FF9A94` | **9,28:1** | **8,49:1** | **7,38:1** |
| Informação | `--vp-info` | `#7CC7F0` | **10,17:1** | **9,30:1** | **8,08:1** |
| Neutro / inativo | `--vp-neutral` | `#C7D0DC` | **12,15:1** | **11,11:1** | **9,66:1** |
| Destaque | `--vp-accent` | `#C4A2F5` | **8,86:1** | **8,10:1** | **7,04:1** |

### 3.5 Botões sólidos e anel de foco

**Botão sólido — tema claro** (texto `#FFFFFF` sobre o preenchimento):

| Variante | Preenchimento | Texto | Contraste |
|---|---|---|---|
| Primário | `#0A46B8` | `#FFFFFF` | **8,14:1** |
| Sucesso | `#0B5F2E` | `#FFFFFF` | **7,81:1** |
| Perigo | `#9E1420` | `#FFFFFF` | **8,16:1** |
| Aviso | `#6E4200` | `#FFFFFF` | **8,60:1** |

**Botão sólido — tema escuro** (texto `#0D1117` sobre preenchimento claro): primário **9,66:1**,
sucesso **11,03:1**, perigo **9,28:1**, aviso **11,99:1**.

**Anel de foco — `2.4.13` Focus Appearance (AAA).** O critério exige: área ≥ a de um perímetro de
**2 px** ao redor do componente, e **mudança de contraste ≥3:1** entre o estado focado e o não
focado nos mesmos pixels. ([Understanding 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html))

A solução única do VelozPanel — **anel de 3 px com halo de 1 px**, que passa sobre qualquer fundo,
inclusive sobre um botão colorido:

```css
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 3px solid var(--vp-focus);        /* claro #0A46B8 · escuro #8FBBFF */
  outline-offset: 2px;
  box-shadow: 0 0 0 1px var(--vp-focus-halo); /* claro #FFFFFF · escuro #0D1117 */
  border-radius: inherit;
}
/* Modo de Alto Contraste do Windows: o anel do SO manda, mas garantimos que exista */
@media (forced-colors: active) {
  :where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
    outline: 3px solid Highlight; box-shadow: none;
  }
}
```

| Verificação | Valor | Exigido |
|---|---|---|
| Anel `#0A46B8` vs fundo branco | **8,03:1** | ≥3:1 (mudança) ✓ |
| Anel `#0A46B8` vs superfície `#F4F6F9` | **7,42:1** | ✓ |
| Anel `#8FBBFF` vs `#0D1117` / `#161B22` / `#1F2733` | **9,66 / 8,83 / 7,68:1** | ✓ |
| Halo `#FFFFFF` vs anel `#0A46B8` | **8,03:1** | garante o anel sobre botão escuro ✓ |
| Espessura | 3 px + offset 2 px | ≥ perímetro de 2 px ✓ |

> **Regra absoluta:** `outline: none` sem substituto é **erro de build**
> (`no-restricted-syntax` no ESLint + regra de Stylelint). Não existe exceção "por design".

### 3.6 Estados — cor **nunca** é o único indicador (`1.4.1`, Nível A)

O `01-produto-ux.md` propõe chips coloridos (`● Ativo`, `⏸ Pausado`) e medidores "verde <70,
âmbar 70–90, vermelho >90". Cor sozinha reprova. **Todo estado do VelozPanel é a tripla
`cor + ícone + texto`**, e o texto é obrigatório — nunca só o ícone, nunca só a bolinha.

#### Estados de ambiente

| Estado | Texto (obrigatório) | Ícone (SVG, `aria-hidden`) | Forma | Claro: fundo / texto / borda | Escuro: fundo / texto / borda | Contraste do texto |
|---|---|---|---|---|---|---|
| **Ativo** | `Ativo` | ▶ círculo preenchido | círculo sólido | `#EAF6EE` / `#0A5A2C` / `#3E8B5C` | `#0F2A1A` / `#6EDB97` / `#4A9E6B` | **7,53:1** · **8,96:1** |
| **Pausado** | `Pausado` | ⏸ duas barras | círculo vazado | `#EDF0F4` / `#3D4757` / `#78838F` | `#232B37` / `#C7D0DC` / `#788697` | **8,21:1** · **9,16:1** |
| **Suspenso** | `Suspenso por saldo` | ⚠ triângulo | losango | `#FDF0DA` / `#6E4200` / `#9A6A18` | `#2E2208` / `#FFC53D` / `#A8862A` | **7,64:1** · **9,87:1** |
| **Erro** | `Com erro` | ✕ círculo com X | octógono | `#FDEEEF` / `#961320` / `#C2555E` | `#31161A` / `#FF9A94` / `#B25E63` | **7,74:1** · **8,17:1** |
| **Provisionando / Pausando** | `Pausando…` | ⟳ seta circular | círculo tracejado | `#E4F0FA` / `#095078` / `#3F86B8` | `#0E2536` / `#7CC7F0` / `#4787B4` | **7,47:1** · **8,44:1** |
| **Manutenção** (admin) | `Em manutenção` | 🔧 chave | círculo tracejado | `#F0E9FA` / `#5A2296` / `#8B5FC4` | `#241A38` / `#C4A2F5` / `#8467BC` | **8,43:1** · **7,68:1** |

Reforços obrigatórios além da cor:
- **Forma diferente por estado** (círculo sólido / vazado / losango / octógono) — resolve daltonismo
  e visão monocular (Lei 14.126/2021).
- **Ícone com forma distinta**, nunca apenas cor diferente do mesmo ícone.
- **Borda do chip ≥3:1** contra o fundo do próprio chip (valores acima, todos ≥3,1:1).
- Estado do ambiente exposto também em `aria-label` da linha e no `<title>` da página.

#### Estados de mensagem (sucesso / aviso / erro / info)

Mesma tripla, mais duas regras:
1. **Prefixo textual obrigatório** na mensagem: `Erro:`, `Aviso:`, `Sucesso:`, `Informação:` —
   é o que o leitor de tela lê primeiro, e o que funciona em impressão em preto e branco.
2. **Papel ARIA correto:** erro de validação em `role="alert"`; confirmação e progresso em
   `role="status"`. Nunca `role="alert"` para sucesso — ele interrompe a leitura atual.

#### Medidores de CPU / RAM / Disco

O `01-produto-ux.md` §5.2 pede "cor por faixa (verde <70, âmbar 70–90, vermelho >90)". Correção:

| Faixa | Cor | **+ Padrão de preenchimento** | **+ Texto obrigatório** |
|---|---|---|---|
| <70% | `--vp-success` | liso | `412 MB / 1 GB · 41% · normal` |
| 70–90% | `--vp-warning` | listras diagonais | `812 MB / 1 GB · 81% · atenção` |
| >90% | `--vp-danger` | listras diagonais densas + ícone ⚠ | `950 MB / 1 GB · 95% · crítico` |

O valor absoluto **e** o percentual **e** a palavra de estado sempre visíveis — nunca só a barra.
Marcação: `role="meter"` com `aria-valuenow/min/max` e `aria-valuetext="950 MB de 1 GB, 95 por cento, crítico"`.

#### Séries do gráfico

Quatro séries (CPU, RAM, disco, rede) distinguidas **apenas por cor** reprovam. Obrigatório:
**cor + estilo de traço + marcador**, e legenda com o marcador desenhado ao lado do nome.

| Série | Cor (claro / escuro) | Traço | Marcador |
|---|---|---|---|
| CPU | `#0A46B8` / `#8FBBFF` | sólido | círculo |
| RAM | `#5A2296` / `#C4A2F5` | tracejado longo | quadrado |
| Disco | `#6E4200` / `#FFC53D` | pontilhado | triângulo |
| Rede (entrada) | `#095078` / `#7CC7F0` | traço-ponto | losango |
| Rede (saída) | `#0B5F2E` / `#6EDB97` | tracejado curto | cruz |

Piso de contraste para linha de gráfico: **≥4,5:1** contra o fundo do gráfico (nosso piso elevado
voluntário; o AA `1.4.11` pediria 3:1). Espessura mínima **2 px** — linha de 1 px some em tela
de alta densidade e em visão reduzida.

### 3.7 Formato dos tokens (Tailwind v4 + `@theme`)

O `05-nodejs-nextjs.md` §4.7 fecha Tailwind v4 com config em CSS e tema por `class="dark"`.
Os tokens vivem em `packages/design-tokens/tokens.css`, gerados a partir de um `tokens.ts` tipado —
**a fonte de verdade é o TS**, porque é ele que o script de auditoria de contraste lê.

```css
/* packages/design-tokens/tokens.css — GERADO, não editar */
@theme {
  --color-vp-bg: #FFFFFF;      --color-vp-surface: #F4F6F9;  --color-vp-elevated: #FFFFFF;
  --color-vp-text: #10151C;    --color-vp-text-2: #3D4757;   --color-vp-text-3: #46505F;
  --color-vp-brand: #0A46B8;   --color-vp-success: #0B5F2E;  --color-vp-warning: #6E4200;
  --color-vp-danger: #9E1420;  --color-vp-info: #095078;     --color-vp-neutral: #4A5462;
  --color-vp-border: #7E8A9A;  --color-vp-focus: #0A46B8;    --color-vp-focus-halo: #FFFFFF;
}
.dark {
  --color-vp-bg: #0D1117;      --color-vp-surface: #161B22;  --color-vp-elevated: #1F2733;
  --color-vp-text: #F2F5F9;    --color-vp-text-2: #C7D0DC;   --color-vp-text-3: #A9B4C4;
  --color-vp-brand: #8FBBFF;   --color-vp-success: #6EDB97;  --color-vp-warning: #FFC53D;
  --color-vp-danger: #FF9A94;  --color-vp-info: #7CC7F0;     --color-vp-neutral: #C7D0DC;
  --color-vp-border: #657385;  --color-vp-focus: #8FBBFF;    --color-vp-focus-halo: #0D1117;
}
```

Três regras de governança do token, que viram lint:
1. **Nenhum hexadecimal literal em componente.** `bg-[#22C55E]` é erro de build.
2. **Nenhuma cor do Tailwind padrão** (`text-gray-500`, `bg-red-600`): a paleta padrão do Tailwind
   **não** foi desenhada para 7:1 e é a origem nº 1 de regressão de contraste.
3. **Todo token novo passa pelo `contrast-audit`** antes de ser mesclado.

> **Ressalva honesta sobre o tema escuro:** a WCAG 2.x calcula contraste por luminância relativa,
> um modelo que **superestima** o contraste percebido em texto claro sobre fundo escuro. Um par de
> 7:1 no escuro é percebido como menos legível que 7:1 no claro. Por isso o escuro do VelozPanel
> tem folga: o token mais apertado (`--vp-text-3` sobre `--vp-elevated`) está em **7,17:1**, e a
> maioria passa de 9:1. Não usamos APCA (o modelo do rascunho da WCAG 3.0) para **declarar**
> conformidade, porque não é normativo — usamos só como sanidade visual.

---

## 4. Componentes críticos do painel e sua acessibilidade

Para cada componente: **o padrão ARIA correto**, **as armadilhas** e **o código**. Os exemplos
assumem shadcn/ui + Radix + TanStack Table + uPlot, conforme `05-nodejs-nextjs.md` §4.7.

> **Regra que evita 90% dos problemas:** use **elementos nativos** (`<button>`, `<table>`, `<input>`,
> `<dialog>`, `<details>`). ARIA só entra quando o HTML nativo não dá conta. *"Nenhum ARIA é melhor
> que ARIA ruim"* — [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/).

### 4.1 Tabela de dados com ordenação e paginação

**Padrão correto:** `<table>` real com `<caption>`, `<th scope="col">`, e `aria-sort` no `<th>`
que está ordenado (**apenas um por vez**). O controle de ordenação é um `<button>` **dentro** do
`<th>` — nunca `onClick` no `<th>`.

**Armadilhas:**

| Armadilha | Consequência | Correção |
|---|---|---|
| `aria-sort` em todas as colunas | Leitor de tela anuncia ordenação múltipla inexistente | `aria-sort="none"` é o padrão implícito — **omita**; só a coluna ativa recebe `ascending`/`descending` |
| Div-grid com `role="table"` | Perde navegação nativa de tabela do NVDA/VoiceOver | `<table>` de verdade |
| Ordenar sem anunciar | Usuário cego não sabe que a tabela mudou | `role="status"` com "Ordenado por Nome, crescente" |
| Ação em linha só com ícone | `2.4.9` reprova: "Excluir" ×50 linhas | Nome acessível composto com o recurso |
| Paginação sem contexto | `2.4.8` reprova | `<nav aria-label="Paginação">` + status "Página 2 de 7, itens 21 a 40 de 132" |
| Linha inteira clicável via `onClick` no `<tr>` | Não é focável nem operável por teclado (`2.1.3`) | Link real na célula do nome; a linha só **realça** no hover |
| Rolagem horizontal sem foco | Região rolável precisa ser alcançável por teclado | `tabindex="0"` + `role="region"` + `aria-label` no wrapper com `overflow:auto` |

```tsx
// apps/painel/src/components/DataTable.tsx (essência acessível)
export function DataTable<T>({ caption, columns, rows, sort, onSort, page }: Props<T>) {
  const [anuncio, setAnuncio] = useState('');

  function ordenar(col: Col<T>) {
    const dir = sort?.id === col.id && sort.dir === 'asc' ? 'desc' : 'asc';
    onSort({ id: col.id, dir });
    setAnuncio(`Ordenado por ${col.header}, ${dir === 'asc' ? 'crescente' : 'decrescente'}.`);
  }

  return (
    <>
      {/* 4.1.3 Status Messages (AA): mudanças assíncronas precisam ser anunciadas */}
      <p role="status" className="sr-only">{anuncio}</p>

      {/* wrapper rolável precisa ser focável — senão teclado não alcança o overflow */}
      <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">
            {caption}. {rows.length} itens nesta página.
          </caption>
          <thead>
            <tr>
              {columns.map((col) => {
                const ativo = sort?.id === col.id;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    // só a coluna ativa declara aria-sort
                    aria-sort={ativo ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {col.sortable ? (
                      <button type="button" onClick={() => ordenar(col)} className="vp-target-44">
                        {col.header}
                        <SortIcon dir={ativo ? sort!.dir : undefined} aria-hidden="true" />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="h-12">{/* 48px = alvo 44 + respiro (2.5.5) */}
                <th scope="row">
                  <Link href={`/ambientes/${r.id}`}>{r.dominio}</Link>
                </th>
                <td><EstadoChip estado={r.estado} /></td>
                <td>
                  {/* 2.4.9: o nome do link/botão sozinho identifica o alvo */}
                  <IconButton
                    icon={<PauseIcon />}
                    label={`Pausar ambiente ${r.dominio}`}
                    className="vp-target-44"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Paginação">
        <p role="status">
          Página {page.atual} de {page.total} · itens {page.de} a {page.ate} de {page.itens}
        </p>
        <button disabled={page.atual === 1}>Página anterior</button>
        <button disabled={page.atual === page.total}>Próxima página</button>
      </nav>
    </>
  );
}
```

Detalhe de `3.3.7` *Redundant Entry* (**Nível A**, novo na 2.2) que atinge tabelas com filtro:
o filtro aplicado precisa sobreviver à navegação de ida e volta — o usuário não pode ser obrigado
a redigitar o mesmo filtro. Estado do filtro vai na **query string**, não em `useState`.

### 4.2 Gráfico de consumo — como um gráfico fica acessível

Um gráfico em `<canvas>` é, para tecnologia assistiva, **um retângulo vazio**. Não existe conserto
por ARIA: é preciso oferecer **outra forma de obter a mesma informação**. Quatro camadas, em ordem
de obrigatoriedade:

| Camada | Obrigatória? | O que resolve |
|---|---|---|
| **1. `<figure>` + `role="img"` + `aria-label` com o resumo** | ✅ Sim | `1.1.1` — dá sentido imediato sem forçar leitura de tabela |
| **2. Tabela de dados alternativa** | ✅ Sim | `1.1.1` + `1.4.9` (torna o texto do canvas redundante) + `1.4.4` |
| **3. Navegação por teclado ponto a ponto** | ✅ Sim | `2.1.3` — explorar a série sem mouse |
| **4. Sonificação (áudio)** | ❌ Não | — |

**Camada 1 — o resumo é o que mais importa.** Ninguém quer ouvir 1.440 pontos. O `aria-label`
carrega a **conclusão**, não os dados:

> `"Gráfico de uso de CPU do ambiente oliveirafacil.com nas últimas 24 horas. Média de 34%, pico de 91% às 14h10, mínimo de 4% às 03h20. Tendência estável. Tabela com os dados completos logo abaixo."`

Este resumo é **calculado no servidor** junto com a série (média, pico com horário, mínimo, tendência),
não montado no cliente — é dado, não apresentação.

**Camada 2 — a tabela alternativa**, dentro de um `<details>` fechado por padrão (não polui a tela
visual e está sempre a um `Enter` de distância), com os dados **agregados** — 1.440 linhas é inútil
para qualquer um. Regra: **no máximo 24 linhas por gráfico**, agregando por hora/dia conforme o
período, e com link "Baixar CSV completo".

**Camada 3 — navegação por teclado** com anúncio por `role="status"` (com *debounce* de 150 ms,
senão o leitor de tela engasga ao segurar a seta).

**Camada 4 — sonificação: recusada, com motivo.** Existe (Highcharts Sonification, `sonify-charts`).
Custo: dependência nova, ~40 KB, tuning por tipo de série, e teste manual que ninguém no time sabe
fazer. Benefício: marginal sobre um resumo textual bem escrito **em séries de infraestrutura**, que
são monótonas por natureza. **Não entra.** Revisitar só se um cliente real pedir.

```tsx
// apps/painel/src/components/GraficoConsumo.tsx
export function GraficoConsumo({ serie, resumo, periodo, metrica, ambiente }: Props) {
  const [cursor, setCursor] = useState<number | null>(null);
  const anunciar = useDebouncedAnnounce(150);

  return (
    <figure className="vp-card">
      <figcaption id="cap-cpu">
        <h3>Uso de {metrica} — {periodo}</h3>
        {/* 3.1.5: resumo em linguagem simples, visível para todos */}
        <p className="text-vp-text-2">
          Média {resumo.media}% · pico {resumo.pico}% às {resumo.picoHora} · {resumo.tendencia}
        </p>
      </figcaption>

      <div
        role="img"
        aria-label={resumo.textoLongo}
        tabIndex={0}
        onKeyDown={(e) => {
          const passo = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!passo) return;
          e.preventDefault();
          const i = clamp((cursor ?? 0) + passo, 0, serie.length - 1);
          setCursor(i);
          anunciar(`${formatarHora(serie[i].t)}: ${serie[i].v}%`);
        }}
        aria-describedby="ajuda-grafico"
      >
        <UplotCanvas serie={serie} cursor={cursor} />
      </div>

      <p id="ajuda-grafico" className="text-vp-text-3">
        Use as setas esquerda e direita para percorrer os pontos, Home e End para ir aos extremos.
      </p>

      {/* região viva só para o valor sob o cursor */}
      <p role="status" className="sr-only" />

      {/* 1.1.1 + 1.4.9: alternativa textual equivalente */}
      <details>
        <summary className="vp-target-44">Ver dados em tabela ({serie.agregada.length} linhas)</summary>
        <table>
          <caption>Uso de {metrica} de {ambiente}, agregado por hora — {periodo}</caption>
          <thead>
            <tr><th scope="col">Hora</th><th scope="col">Média</th><th scope="col">Pico</th></tr>
          </thead>
          <tbody>
            {serie.agregada.map((p) => (
              <tr key={p.t}>
                <th scope="row">{formatarHora(p.t)}</th>
                <td>{p.media}%</td>
                <td>{p.pico}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a href={`/api/v1/environments/${ambiente}/metrics.csv?periodo=${periodo}`} download>
          Baixar série completa em CSV
        </a>
      </details>
    </figure>
  );
}
```

Duas exigências extras que caem sobre o gráfico:
- **Botão "Pausar atualização"** (`2.2.2`, Nível A) — o auto-refresh de 30 s é conteúdo em
  movimento e precisa ser pausável.
- **`prefers-reduced-motion`**: a animação de entrada da linha e a transição entre períodos
  desligam (`2.3.3`). O uPlot recebe `{ animate: false }`.

### 4.3 Log ao vivo por SSE — a região `aria-live` que **não** gagueja

Este é o componente que mais quebra leitor de tela num painel, e o erro é sempre o mesmo:
`aria-live="polite"` numa lista que recebe 40 linhas por segundo. O resultado é o leitor de tela
travado numa fila de anúncios de vários minutos, incapaz de ler qualquer outra coisa — o usuário
literalmente perde o controle do computador até fechar a aba.

> **Regra do VelozPanel: o log em si NUNCA é uma região viva. Quem anuncia é um resumo separado.**

Desenho em três partes:

| Parte | Marcação | Comportamento |
|---|---|---|
| **Corpo do log** | `role="log"` **com `aria-live="off"`** | Renderização virtualizada, navegável por teclado, lido sob demanda pelo usuário |
| **Resumo de progresso** | `role="status"` (polite) | Anuncia **só mudança de fase** ("Fase 3 de 6: provisionando runtime") e, no máximo, a cada 10 s ("142 linhas, sem erros") |
| **Falha** | `role="alert"` (assertive) | Só quando o job falha. Uma vez. |

E um controle explícito: **"Anunciar novas linhas"**, desligado por padrão, que troca o corpo do log
para `aria-live="polite"` para quem quiser acompanhar linha a linha em job curto.

```tsx
// apps/painel/src/components/LogAoVivo.tsx
export function LogAoVivo({ jobId }: { jobId: string }) {
  const { linhas, fase, estado } = useJobLog(jobId);   // hook SSE do 05-nodejs §4.3
  const [anunciarLinhas, setAnunciarLinhas] = useState(false);
  const [pausado, setPausado] = useState(false);
  const resumo = useResumoPeriodico(linhas, fase, 10_000);   // no máx. 1 anúncio a cada 10 s

  return (
    <section aria-labelledby="h-log">
      <h3 id="h-log">Registro de execução</h3>

      <div className="flex gap-2">
        {/* 2.2.2 (A): conteúdo em movimento precisa de pausa */}
        <button aria-pressed={pausado} onClick={() => setPausado((p) => !p)} className="vp-target-44">
          {pausado ? 'Retomar atualização' : 'Pausar atualização'}
        </button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={anunciarLinhas}
                 onChange={(e) => setAnunciarLinhas(e.target.checked)} />
          Anunciar cada nova linha no leitor de tela
        </label>
        <button onClick={() => copiar(linhas)} className="vp-target-44">Copiar registro</button>
        <a href={`/api/v1/jobs/${jobId}/logs.txt`} download className="vp-target-44">Baixar</a>
      </div>

      {/* 1) resumo — ESTE é o que fala */}
      <p role="status" className="sr-only">{resumo}</p>
      {/* 2) falha — assertivo, uma vez só */}
      {estado === 'failed' && (
        <p role="alert">Erro: o job {jobId} falhou na fase {fase.nome}. Veja o registro abaixo.</p>
      )}

      {/* 3) corpo do log — mudo por padrão */}
      <div
        role="log"
        aria-live={anunciarLinhas ? 'polite' : 'off'}
        aria-relevant="additions"
        aria-label="Saída do job, mais recente no fim"
        tabIndex={0}
        className="h-96 overflow-y-auto font-mono"
      >
        <VirtualList itens={pausado ? congelado : linhas} render={(l) => (
          <p key={l.id}>
            <span className="sr-only">{rotuloNivel(l.nivel)}: </span>
            <time dateTime={l.ts}>{formatarHora(l.ts)}</time> {l.texto}
          </p>
        )} />
      </div>

      {/* progresso visível, com texto — nunca só barra (1.4.1) */}
      <p>
        <progress value={fase.indice} max={fase.total} aria-labelledby="h-progresso" />
        <span id="h-progresso">Fase {fase.indice} de {fase.total}: {fase.nome}</span>
      </p>
    </section>
  );
}
```

Detalhes que fazem diferença e são fáceis de errar:
- **A região viva precisa existir no DOM *antes* de receber conteúdo.** Se você monta o
  `role="status"` no mesmo *render* em que insere o texto, nada é anunciado. Por isso o
  `<p role="status">` está sempre presente, vazio.
- **`aria-atomic="false"`** (padrão) no `role="log"`: anuncia só o que foi adicionado, não a lista toda.
- **Nível da linha (erro/aviso) vai como texto**, não só como cor (`1.4.1`).
- **Sem `autoscroll` forçado**: se o usuário rolou para cima, o log **não** salta para o fim
  (`3.2.5`). Aparece um botão "Ir para o fim · 12 novas linhas".

### 4.4 Modal / dialog e o foco

**Padrão correto:** Radix `Dialog` (é o que o shadcn/ui usa) ou o `<dialog showModal()>` nativo.
Ambos entregam `aria-modal="true"`, foco preso, `Esc` para fechar e inerte no fundo. **Não
implemente à mão.**

Checklist obrigatório (cada item já quebrou algum produto real):

| Item | Regra |
|---|---|
| Nome | `aria-labelledby` apontando para o `<h2>` do modal |
| Descrição | `aria-describedby` apontando para o parágrafo de impacto |
| Foco inicial | No **primeiro elemento interativo**, ou no `<h2>` com `tabIndex={-1}` se o modal for longo. **Nunca** no botão destrutivo |
| Foco no fechamento | Volta **exatamente** para o gatilho. Se o gatilho sumiu (linha excluída), vai para um alvo estável e anuncia |
| `Esc` | Sempre fecha. Se houver dado não salvo, abre confirmação — não descarta em silêncio (`3.3.6`) |
| Fundo | `inert` / `aria-hidden` no resto da aplicação. Radix faz; `<dialog>` nativo faz |
| Rolagem | O **corpo** rola; cabeçalho e rodapé ficam. Rodapé nunca cobre o foco (`2.4.12`) |
| Alerta | Modal que exige decisão imediata usa `role="alertdialog"` |
| Empilhamento | **Proibido modal sobre modal.** Um fluxo com dois passos é um formulário com dois passos |
| Largura | `max-width` que não force scroll horizontal a 320 px / 400% zoom (`1.4.10`) |

```tsx
<AlertDialog.Content
  aria-labelledby="t-pausar"
  aria-describedby="d-pausar"
  onOpenAutoFocus={(e) => { e.preventDefault(); cancelarRef.current?.focus(); }}
>
  <h2 id="t-pausar">Pausar oliveirafacil.com?</h2>
  <div id="d-pausar">
    <p>O site sai do ar imediatamente. Arquivos, bancos e e-mails são preservados.</p>
    <dl>
      <dt>Custo enquanto pausado</dt><dd>R$ 0,004/h (somente armazenamento)</dd>
      <dt>Custo hoje</dt>            <dd>R$ 0,0486/h</dd>
      <dt>Economia estimada</dt>     <dd>R$ 1,06 por dia</dd>
      <dt>Tempo para reativar</dt>   <dd>cerca de 10 segundos</dd>
    </dl>
  </div>
  <footer>
    <AlertDialog.Cancel ref={cancelarRef}>Cancelar</AlertDialog.Cancel>
    <AlertDialog.Action variant="warning">Pausar ambiente</AlertDialog.Action>
  </footer>
</AlertDialog.Content>
```

### 4.5 Toast / notificação

**Padrão correto:** uma **única** região `role="status"` persistente no DOM, que recebe os toasts.
Nunca `role="alert"` para o caso comum — `alert` é assertivo e interrompe a leitura.

| Armadilha | Correção |
|---|---|
| Toast rouba o foco | **Nunca.** Isso é `3.2.5` e é o erro mais irritante de painel |
| Toast some em 5 s levando informação única | `2.2.3`: **todo toast é espelhado na central de notificações**; toast de erro **não some sozinho** |
| Toast fora da ordem de tabulação | Precisa ser alcançável: `F6` alterna para a região de notificações, e há um botão "Notificações (3)" no header |
| Toast empilhado cobrindo botão | Posiciona-se em canto que não sobrepõe controle nem indicador de foco (`2.4.12`) |
| Botão "Desfazer" dentro de toast que expira | Se há "Desfazer", o toast **não expira** enquanto tiver foco ou hover, e a ação continua disponível no histórico da tela |

```tsx
// montado uma vez no layout raiz — precisa existir ANTES de receber conteúdo
<div role="status" aria-live="polite" aria-atomic="false" id="vp-toasts" className="fixed bottom-4 right-4" />
```

Regra de ouro: **o toast é redundância, nunca a única fonte da informação.**

### 4.6 Formulário de criação com validação

**Padrão correto:** `<form>` real, `<label for>` sempre (nunca só `placeholder`), `aria-describedby`
encadeando ajuda **e** erro, `aria-invalid`, e um **resumo de erros** no topo ao submeter.

| Regra | Motivo |
|---|---|
| Validar no `blur`, não a cada tecla | Validar por tecla dispara `aria-live` a cada caractere e é insuportável no leitor de tela |
| Ao submeter com erro: foco no **resumo**, não no primeiro campo | O usuário precisa saber **quantos** erros existem antes de ser jogado num campo (`3.3.1`) |
| `aria-describedby` aceita **múltiplos ids** | `aria-describedby="ajuda-ttl erro-ttl"` — ajuda + erro juntos |
| Erro diz **como corrigir** | `3.3.3` Error Suggestion (AA): "TTL deve estar entre 60 e 86400 segundos. Você digitou 30." |
| Campo obrigatório | `required` + `aria-required` + marcação textual "(obrigatório)" — **nunca só asterisco vermelho** (`1.4.1`) |
| `autocomplete` em dado pessoal | `1.3.5` (AA) + `3.3.9` |
| Não repedir dado já informado | `3.3.7` *Redundant Entry* (**A**) — o funil de 5 passos do `01-produto-ux.md` §A.1 precisa carregar o passo anterior, não perguntar de novo |
| `<fieldset>` + `<legend>` para grupo | Rádio de plano, rádio de forma de pagamento |
| Botão de submissão **nunca** `disabled` por validação | Botão desabilitado não é focável: o usuário não descobre por que não pode enviar. Use `aria-disabled` e explique ao acionar |

```tsx
export function CampoTTL({ valor, erro, onBlur }: Props) {
  return (
    <div>
      <label htmlFor="ttl">
        TTL <span className="text-vp-text-2">(obrigatório)</span>
      </label>
      <input
        id="ttl" name="ttl" type="number" inputMode="numeric"
        required aria-required="true"
        aria-invalid={erro ? 'true' : undefined}
        aria-describedby={erro ? 'ajuda-ttl erro-ttl' : 'ajuda-ttl'}
        defaultValue={valor} onBlur={onBlur}
      />
      {/* 3.3.5 Help (AAA): a ajuda é persistente e existe ANTES do erro */}
      <p id="ajuda-ttl" className="text-vp-text-2">
        Tempo em segundos que os servidores de DNS guardam esta resposta. Entre 60 e 86400.
        <Termo id="ttl" />
      </p>
      {erro && (
        <p id="erro-ttl" className="text-vp-danger">
          <ErroIcon aria-hidden="true" /> <strong>Erro:</strong> {erro}
        </p>
      )}
    </div>
  );
}

// Resumo de erros — recebe o foco na submissão inválida
{errosGerais.length > 0 && (
  <div role="alert" tabIndex={-1} ref={resumoRef} className="vp-card-danger">
    <h2>Não foi possível salvar: {errosGerais.length} campo(s) com problema</h2>
    <ol>
      {errosGerais.map((e) => (
        <li key={e.campo}><a href={`#${e.campo}`}>{e.rotulo}: {e.mensagem}</a></li>
      ))}
    </ol>
  </div>
)}
```

### 4.7 Terminal web

O componente mais hostil à acessibilidade do painel inteiro, e o único onde a solução é
**contorno, não conformidade do widget**.

| Problema | Solução obrigatória |
|---|---|
| **Armadilha de teclado** (`2.1.2`, Nível **A**) — o terminal captura `Tab`, `Ctrl`, setas | **Rota de fuga documentada e visível**: `Esc` `Esc` libera o foco. Um parágrafo **acima** do terminal, sempre visível (não em tooltip), descreve isso. Além disso, um botão **"Sair do terminal"** fora da área capturada |
| Canvas/WebGL não lido | `screenReaderMode: true` no xterm.js — ele mantém uma região viva com a saída |
| Saída longa inunda o leitor de tela | Mesma regra da §4.3: região viva só com o **prompt e o resultado do último comando**, com controle "Anunciar saída" |
| Contraste do tema do terminal | Tema do xterm **derivado dos nossos tokens**, não o padrão. Verificado a 7:1 pelo mesmo `contrast-audit` |
| Cursor piscando | `cursorBlink: false` quando `prefers-reduced-motion: reduce` (e nunca acima de 3 Hz — `2.3.2`) |
| Redimensionar por arrastar | Alternativa por teclado: botões de tamanho de fonte e um `<select>` de altura do painel (`2.5.7`) |

**E a alternativa que resolve de verdade:** o terminal **nunca é o único caminho**. Toda operação
que o cliente faria por terminal tem tela equivalente (arquivos, banco, cron, logs, deploy).
O terminal é conveniência para quem prefere; a conformidade vive nas telas. Isso é declarado na §7.

### 4.8 Upload de arquivo

| Regra | Detalhe |
|---|---|
| **Nunca só arrastar-e-soltar** | `2.5.7` *Dragging Movements* (**AA**). A zona de soltar sempre contém um `<button>`/`<input type="file">` real |
| `<input type="file">` real | Estilizar com `opacity:0` sobre um `<label>` estilizado, **não** substituir por `<div onClick>` |
| Progresso | `<progress>` + `role="status"` anunciando em marcos (25/50/75/100%), **não** a cada evento |
| Erro por arquivo | Lista com o **nome do arquivo** no erro: "`foto.psd`: tipo não aceito. Aceitamos .zip, .tar.gz e .sql." |
| Fila removível | Cada item tem botão "Remover `nome.zip` da fila" com alvo de 44 px |
| Sem limite de tempo | `2.2.3`: upload lento não expira sozinho; se cair, retomável |
| Formatos aceitos **antes** de escolher | `3.3.5`: texto persistente, não só erro depois |

### 4.9 Slider de RAM / vCPU (tela `/admin/ambientes/{id}/recursos`)

Este slider **muda o preço cobrado do cliente**. Ele é, ao mesmo tempo, um caso de `2.5.7`,
`2.5.5`, `3.3.6` e `4.1.3`.

| Regra | Detalhe |
|---|---|
| Base nativa | `<input type="range">` ou Radix `Slider` — traz `←/→/Home/End/PageUp/PageDown` de graça |
| **Valores discretos** | RAM não é contínua: `step` percorre apenas os valores válidos (512 MB, 1, 2, 4, 8 GB) |
| `aria-valuetext` | **Obrigatório.** Sem ele o leitor de tela diz "3". Com ele: `"2 GB — R$ 0,1120 por hora"` |
| Alternativa a arrastar | `2.5.7`: além do slider, um `<select>` com os mesmos valores **e** botões `−`/`+`. O slider nunca é o único controle |
| Alvo do *handle* | 44×44 px (`2.5.5`) |
| Anúncio de preço | O novo preço vai para `role="status"` com **debounce de 400 ms** — não a cada passo de seta |
| `3.3.6` | Nada é aplicado ao soltar. Existe painel de confirmação com preço antes/depois, motivo obrigatório e botão "Aplicar alteração" |
| Capacidade do nó | "web02: 6 GB livres ✓" — o ✓ tem texto: `Cabe no servidor` (`1.4.1`) |

```tsx
<label htmlFor="ram">Memória RAM</label>
<input
  id="ram" type="range" list="ram-opcoes"
  min={0} max={OPCOES_RAM.length - 1} step={1}
  value={indice} onChange={(e) => setIndice(+e.target.value)}
  aria-describedby="ram-ajuda ram-capacidade"
  aria-valuetext={`${OPCOES_RAM[indice].rotulo} — ${formatarBRL(tarifa)} por hora`}
/>
<datalist id="ram-opcoes">{/* marcas visíveis dos passos válidos */}</datalist>

{/* 2.5.7: alternativa sem arrastar */}
<div role="group" aria-label="Ajuste da memória sem arrastar">
  <button onClick={() => setIndice(i => i - 1)} aria-label="Diminuir memória">−</button>
  <select value={indice} onChange={(e) => setIndice(+e.target.value)} aria-label="Memória RAM">
    {OPCOES_RAM.map((o, i) => <option key={o.mb} value={i}>{o.rotulo}</option>)}
  </select>
  <button onClick={() => setIndice(i => i + 1)} aria-label="Aumentar memória">+</button>
</div>

<p id="ram-ajuda" className="text-vp-text-2">Aplicado a quente, sem reiniciar o ambiente.</p>
<p id="ram-capacidade">Servidor web02: 6 GB livres. <strong>Cabe no servidor.</strong></p>
<p role="status">{`Nova tarifa: ${formatarBRL(tarifa)} por hora, equivalente a ${formatarBRL(tarifa * 720)} por mês.`}</p>
```

### 4.10 Botão destrutivo com confirmação por digitação

O `01-produto-ux.md` §5.6 pede confirmação por digitação do nome do recurso para excluir ambiente,
restaurar backup e trocar domínio principal. É a implementação canônica de `3.3.6`. Duas armadilhas:

**Armadilha 1 — o botão `disabled`.** O padrão do mercado desabilita "Excluir" até o texto bater.
Botão `disabled` **não recebe foco**: quem navega por teclado tabula, não encontra o botão, e não
tem como descobrir o motivo. **Correção: `aria-disabled="true"` em vez de `disabled`** — o botão
continua focável e, ao ser acionado, explica o que falta.

**Armadilha 2 — a comparação de texto.** Exigir maiúscula/minúscula exata e proibir colar é teste
de transcrição. Colar é **permitido** (coerente com `3.3.9`), e a comparação normaliza espaços em
volta. O domínio a digitar é exibido em texto **selecionável**, com botão "Copiar".

```tsx
export function ConfirmarExclusao({ dominio, onConfirmar }: Props) {
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const confere = texto.trim() === dominio;

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!confere) { setAviso(`Digite exatamente ${dominio} para liberar a exclusão.`); return; }
      onConfirmar();
    }}>
      <h2 id="t-excluir">Excluir o ambiente {dominio}?</h2>
      <div id="d-excluir">
        <p><strong>Em resumo:</strong> o site sai do ar e os dados vão para a lixeira.</p>
        <ul>
          <li>Arquivos, bancos e e-mails vão para a <strong>lixeira por 7 dias</strong> e podem ser restaurados.</li>
          <li>Um backup final fica disponível para download por <strong>15 dias</strong>.</li>
          <li>A cobrança deste ambiente para <strong>imediatamente</strong>.</li>
          <li>Após 15 dias a exclusão é <strong>definitiva</strong>.</li>
        </ul>
      </div>

      <label htmlFor="conf">
        Para confirmar, digite <code>{dominio}</code> <BotaoCopiar valor={dominio} />
      </label>
      <input
        id="conf" value={texto} onChange={(e) => { setTexto(e.target.value); setAviso(''); }}
        autoComplete="off" spellCheck={false} autoCapitalize="off"
        aria-describedby="conf-ajuda conf-aviso"
      />
      <p id="conf-ajuda" className="text-vp-text-2">Pode colar. Maiúsculas e minúsculas contam.</p>
      <p id="conf-aviso" role="alert">{aviso}</p>

      {/* aria-disabled, NÃO disabled: continua focável e explicável */}
      <button type="submit" variant="danger" aria-disabled={!confere}>
        Excluir ambiente
      </button>
    </form>
  );
}
```

---

## 5. Como testar

### 5.1 A verdade desconfortável sobre ferramenta automática

Ferramenta automática detecta, na melhor das hipóteses, **cerca de 30–40% dos problemas** de
acessibilidade — e essa fração é quase toda de **Nível A/AA**. O próprio projeto axe-core publica
essa limitação. Para os critérios **AAA que adotamos**, a cobertura automática é ainda menor:

| Critério adotado | Automatizável? |
|---|---|
| `1.4.6` Contraste 7:1 | ✅ **Sim, integralmente** (axe com `wcag2aaa`) |
| `2.4.13` Aparência do foco | 🟡 Parcial (dá para checar que existe `outline`, não que é suficiente) |
| `2.4.10` Títulos de seção · `2.4.9` Propósito do link | 🟡 Parcial (detecta heading ausente e "clique aqui"; não julga qualidade) |
| `2.5.5` Alvo 44 px | 🟡 Parcial (mede o *bounding box*; erra com alvo expandido por pseudo-elemento) |
| `1.4.9`, `2.1.3`, `2.2.3`, `2.2.4`, `2.2.5`, `2.2.6`, `2.4.8`, `2.4.12`, `3.1.3`, `3.1.4`, `3.2.5`, `3.3.5`, `3.3.6`, `3.3.9` | ❌ **Não. Exigem julgamento humano.** |

> **Conclusão que precisa estar escrita:** **a maior parte do AAA que adotamos só é verificável
> manualmente.** Por isso a §5.5 define um roteiro que o dono executa sozinho, e a §5.6 define o
> que o CI consegue de fato barrar. Quem confia só no Lighthouse tem um painel com 100 de pontuação
> e inutilizável por teclado.

### 5.2 Ferramentas — o que cada uma serve e onde ela mente

| Ferramenta | Papel no VelozPanel | Limite honesto |
|---|---|---|
| **axe-core** (via `@axe-core/playwright`) | **Motor oficial do projeto.** Roda dentro dos testes E2E, na página **já autenticada e já interagida** (modal aberto, tabela ordenada, log rodando) | Não avalia semântica nem fluxo. Zero violação ≠ acessível |
| **`eslint-plugin-jsx-a11y`** | Primeira barreira, no editor. Pega `onClick` em `<div>`, `alt` ausente, `<label>` órfão | Só vê JSX estático; não vê composição em runtime |
| **Pa11y CI** | Varredura de **URLs públicas** (marketing, docs, status, glossário) em cada deploy, com `standard: WCAG2AAA` | Ruim com app autenticado e SPA; usar só no público |
| **Lighthouse CI** | Core Web Vitals + orçamento de performance + SEO (§6). A parte de acessibilidade dele **é axe, com menos regras** | Pontuação 100 de acessibilidade **não significa nada**. Nunca usar como meta |
| **WAVE** (extensão) | Inspeção visual pontual pelo dono: ordem de headings, landmarks, contraste | Manual, não entra em CI |
| **NVDA** (Windows) + **Firefox** | **Combinação de referência do projeto.** É o leitor de tela mais usado no mundo e é gratuito | Curva de aprendizado de ~2 h |
| **VoiceOver** (macOS/Safari) | Segunda verificação obrigatória — o ambiente do dono é macOS | Comportamento diferente do NVDA; achado num não vale pelo outro |
| **Teclado, sem mouse** | **O teste mais valioso do conjunto.** Custa zero e pega `2.1.3`, `2.4.12`, `2.4.13`, `3.2.5` | — |
| **Zoom 400% / janela 320 px** | `1.4.10` Reflow. Pega layout quebrado que nenhum axe vê | — |
| **Modo de Alto Contraste do Windows** (`forced-colors`) | EN 301 549 cláusula 11.7 | Só no Windows |
| **`contrast-audit` (nosso)** | Valida **os tokens**, na origem, antes de virarem CSS | Não vê cor escrita à mão no componente — por isso o lint que proíbe hex literal |

### 5.3 Onde os testes rodam

```
packages/design-tokens/scripts/contrast-audit.ts   → todo par token×superfície ≥7:1 (texto) / ≥4,5:1 (não textual informativo)
apps/painel/e2e/a11y/*.spec.ts                     → axe-core em 22 estados críticos (lista §5.4)
apps/site/pa11y.json                               → Pa11y CI em 8 URLs públicas, WCAG2AAA
.lighthouserc.json                                 → CWV + orçamento de KB, 3 rotas públicas + 3 autenticadas
eslint.config.js                                   → jsx-a11y no nível error
```

### 5.4 Os 22 estados que o axe precisa ver (e que ninguém lembra de testar)

Rodar axe na página em repouso é o erro clássico — os problemas moram nos estados. Lista fechada,
que vira `test.describe` no Playwright:

`1` dashboard do cliente carregado · `2` dashboard com ambiente pausado · `3` dashboard com ambiente
em erro · `4` tabela ordenada por coluna · `5` tabela na página 3 · `6` tabela com filtro ativo e
resultado vazio · `7` modal de pausar aberto · `8` modal de exclusão com texto inválido digitado ·
`9` formulário submetido com 3 erros · `10` toast de sucesso visível · `11` toast de erro visível ·
`12` log ao vivo com 500 linhas · `13` log ao vivo com job falhado · `14` gráfico com `<details>` da
tabela aberto · `15` menu `⋯` aberto · `16` popover de glossário aberto · `17` combobox de busca
global com resultados · `18` seletor de versão de runtime com confirmação inline aberta ·
`19` tela de recursos do admin com slider movido · `20` painel em 320 px de largura ·
`21` painel com zoom de 400% · `22` tema escuro em **todos** os anteriores (o axe roda duas vezes,
`light` e `dark`).

### 5.5 Roteiro de teste manual — para o dono executar sozinho

**Frequência:** antes de todo *release*, e sempre que uma tela nova entrar. **Tempo:** ~45 min na
primeira vez, ~20 min depois. **Não precisa saber programar.**

#### Preparação (uma vez)
1. **macOS:** VoiceOver já está instalado. Liga e desliga com `Cmd + F5`.
   Tutorial embutido: `Cmd + F5`, depois `Ctrl + Option + Cmd + F8`. Faça uma vez, inteiro.
2. **Windows (recomendado ter):** baixe o **NVDA** (gratuito, nvaccess.org) e use com **Firefox**.
   Liga com `Ctrl + Alt + N`, desliga com `Insert + Q`. **Silenciar rápido: `Ctrl`.**
3. Instale a extensão **WAVE** no navegador.
4. Guarde a tabela de teclas:

| Tecla | O que faz |
|---|---|
| `Tab` / `Shift+Tab` | Próximo / anterior elemento focável |
| `Enter` | Aciona link e botão |
| `Espaço` | Aciona botão, marca caixa, rola a página |
| `Setas` | Move dentro de rádio, aba, menu, slider, tabela |
| `Esc` | Fecha modal, menu, popover |
| **NVDA:** `H` / `1`–`6` | Pula por título / por nível |
| **NVDA:** `D` | Pula por região (landmark) |
| **NVDA:** `T` | Pula por tabela |
| **NVDA:** `F` | Pula por campo de formulário |
| **NVDA:** `Insert + F7` | **Lista tudo** da página (links, títulos, regiões) |
| **VoiceOver:** `Ctrl+Option+U` | Abre o Rotor (o equivalente ao `Insert+F7`) |
| **VoiceOver:** `Ctrl+Option+setas` | Navega pelos elementos |

---

#### Bloco A — Só teclado, sem tocar no mouse (15 min) — **o mais importante**

> Regra: **tire a mão do mouse.** Se você precisar do mouse, é uma falha, anote e siga.

| # | Passo | ✅ Passa se | ❌ Falha se |
|---|---|---|---|
| A1 | Abra `painel.velozpanel.com.br`. Pressione `Tab` **uma vez**. | Aparece **"Pular para o conteúdo"** como primeiro item | Não aparece nada visível |
| A2 | Continue `Tab` pela página inteira, devagar. | **Você sempre vê onde está.** O anel de foco é azul, grosso e nítido | Alguma hora você "perde" o foco |
| A3 | Enquanto tabula, observe o topo e o rodapé fixos. | O item focado **nunca** fica escondido atrás do header ou da barra de saldo | O anel some parcialmente sob a barra fixa (**falha `2.4.12`**) |
| A4 | Tabule até o fim e continue. | Volta para a barra do navegador — não fica preso | Fica girando dentro de uma área (**armadilha de teclado, `2.1.2`**) |
| A5 | Chegue no botão **Pausar** de um ambiente e aperte `Enter`. | Modal abre e o foco vai **para dentro dele** | O foco continua atrás do modal |
| A6 | Com o modal aberto, tabule várias vezes. | O foco **circula só dentro** do modal | Você alcança algo atrás do modal |
| A7 | Aperte `Esc`. | Modal fecha e o foco volta **exatamente** para o botão "Pausar" | O foco volta para o topo da página |
| A8 | Abra o menu `⋯` de um ambiente com `Enter`, navegue com `↓`, saia com `Esc`. | Setas navegam, `Esc` fecha, foco volta ao `⋯` | Precisa de `Tab` para navegar o menu |
| A9 | Vá até uma tabela. `Tab` até o cabeçalho de uma coluna e `Enter`. | A tabela reordena **e** você ouve/vê aviso de que reordenou | Reordena em silêncio |
| A10 | Abra o **terminal**. Tente sair dele **só com teclado**. | `Esc` `Esc` libera, e havia um texto visível dizendo isso **antes** de você entrar | Você fica preso (**falha grave, `2.1.2`**) |
| A11 | Vá até o **gráfico** e aperte `→` várias vezes. | Um cursor anda pelos pontos e o valor aparece | Nada acontece (**falha `2.1.3`**) |
| A12 | Abra a tela de exclusão de ambiente. Tabule. | O botão **"Excluir ambiente"** recebe foco mesmo antes de você digitar o domínio, e ao acioná-lo ele **explica** o que falta | O botão é pulado pelo `Tab` |
| A13 | Preencha um formulário com erro de propósito e envie. | O foco vai para um **resumo no topo** dizendo quantos erros existem, com links para cada campo | O foco vai direto para um campo, sem contexto |
| A14 | Deixe um **deploy rodando** e continue navegando por `Tab`. | Nada rouba seu foco quando o job termina | O foco pula para uma notificação (**falha `3.2.5`**) |

---

#### Bloco B — Leitor de tela (20 min)

> Dica de sanidade: **feche os olhos ou desligue o monitor** nos passos B4 e B7. É desconfortável
> e é exatamente o ponto.

| # | Passo | ✅ Passa se | ❌ Falha se |
|---|---|---|---|
| B1 | Ligue o NVDA (`Ctrl+Alt+N`) ou o VoiceOver (`Cmd+F5`) e abra o dashboard. | A **primeira coisa** anunciada é o título da página, e ele diz onde você está: *"Ambientes · VelozPanel"* | Anuncia só "VelozPanel" ou nada |
| B2 | `Insert+F7` (NVDA) ou `Ctrl+Opt+U` (VO) → **Títulos**. | Existe **um** `h1`, e os `h2`/`h3` descrevem os cards em ordem lógica, **sem pular nível** | Não há `h1`, ou há vários, ou salta de `h1` para `h3` |
| B3 | Na mesma lista → **Regiões / Landmarks**. | Existem `banner`, `navigation`, `main`, `contentinfo` — nomeados | Página inteira é uma região só |
| B4 | **Sem olhar**, navegue pelos cards e diga em voz alta o estado de cada ambiente. | Você ouve *"Ativo"*, *"Pausado"*, *"Suspenso por saldo"* — **em palavras** | Você só ouve o nome do domínio (**cor como único indicador, `1.4.1`**) |
| B5 | Navegue pela tabela com `T` e setas. | Ao entrar numa célula, ouve **o nome da coluna** junto com o valor | Ouve só o valor solto |
| B6 | Tabule pelos botões de ação de 3 linhas diferentes da tabela. | Ouve *"Pausar ambiente oliveirafacil.com"* — **com o domínio** | Ouve *"Pausar"* três vezes iguais (**falha `2.4.9`**) |
| B7 | **Sem olhar**, dispare um deploy e acompanhe. | Ouve mudanças de fase e, no fim, sucesso ou erro. **Não** ouve uma enxurrada de linhas de log | O leitor engasga e fica minutos atrás do que está na tela (**falha grave, §4.3**) |
| B8 | Abra o modal de pausar. | Ouve o título do modal **e** o texto de impacto (custo, tempo fora do ar) | Ouve só "diálogo" |
| B9 | Vá a um campo de formulário. | Ouve o **rótulo**, se é **obrigatório**, e o **texto de ajuda** | Ouve só "editar, em branco" |
| B10 | Digite um valor inválido e saia do campo. | Ouve o erro **e o que fazer para corrigir** | Ouve só "inválido" |
| B11 | Encontre uma sigla técnica (TTL, CNAME, SPF) e acione a definição. | A definição é lida, em linguagem simples | Não há definição, ou ela só aparece no `title` do mouse |
| B12 | Vá até o **gráfico**. | Ouve um **resumo com média, pico e horário do pico**, e a menção de que há tabela abaixo | Ouve "imagem" ou "gráfico" e nada mais |
| B13 | Abra o `<details>` "Ver dados em tabela". | Existe tabela com os valores, com `caption` | Não existe |

---

#### Bloco C — Visão, zoom e movimento (10 min)

| # | Passo | ✅ Passa se | ❌ Falha se |
|---|---|---|---|
| C1 | `Ctrl/Cmd` + `+` até **400%** de zoom. | Tudo continua utilizável, em coluna única, **sem barra de rolagem horizontal** | Aparece rolagem horizontal ou algo é cortado (**falha `1.4.10`**) |
| C2 | Estreite a janela até **320 px**. | Mesmo resultado | Layout quebra |
| C3 | Aumente **só o tamanho da fonte** do navegador para 200% (sem zoom de página). | Texto cresce, inclusive **os rótulos do gráfico** | Os rótulos do gráfico não crescem (**falha `1.4.4`/`1.4.9`** — o canvas não está reagindo, §2.2) |
| C4 | Ative **Reduzir movimento** no sistema (macOS: Acessibilidade › Vídeo). Recarregue. | Nenhuma animação: sem deslizar, sem *skeleton* pulsando, sem transição de gráfico | Alguma coisa ainda anima (**falha `2.3.3`**) |
| C5 | Alterne para o **tema escuro** e repita A2, B4 e C1. | Tudo continua legível e o anel de foco continua visível | Algum texto ou o anel some no escuro |
| C6 | Tire um **print da tela e converta para preto e branco** (Visualização › Ajustar cor › saturação 0). | Você ainda distingue Ativo / Pausado / Suspenso / Erro | Todos os chips ficam iguais (**falha `1.4.1`**) |
| C7 | Passe a extensão **WAVE** em 3 telas. | Zero "Errors" e zero "Contrast Errors" | Qualquer um dos dois > 0 |
| C8 | Ligue o **Modo de Alto Contraste** (Windows) ou "Aumentar contraste" (macOS). | Bordas, campos e o anel de foco continuam visíveis | Campos viram retângulos invisíveis |

---

#### Registro do resultado

Cada execução gera uma linha em `Plan/docs/registro-acessibilidade.md`:
`data · versão · quem testou · itens A/B/C que falharam · issues abertas`.
**Item falhado sem issue aberta é considerado falha do processo, não do produto.**

### 5.6 O portão de CI — o que **reprova um merge**

Regra de governança: acessibilidade e performance não são revisão de gosto. São **checagem
booleana** no *pull request*. Se o portão está vermelho, não mescla — sem exceção, sem
"eu arrumo depois".

#### 🔴 Bloqueia o merge (falha dura)

| # | Verificação | Ferramenta | Critério de reprovação |
|---|---|---|---|
| 1 | **Violações axe de nível A e AA** | `@axe-core/playwright` nos 22 estados da §5.4, temas claro e escuro | **Qualquer** violação `critical`, `serious`, `moderate` ou `minor`. Tolerância: **zero** |
| 2 | **Contraste 7:1 dos tokens** | `contrast-audit` | Qualquer par texto×superfície <7:1, ou não textual informativo <4,5:1 |
| 3 | **Regra `color-contrast-enhanced` do axe** | axe com `runOnly: ['wcag2aaa']` limitado a essa regra | Qualquer violação — pega cor escrita à mão que escapou do token |
| 4 | **`jsx-a11y` no nível `error`** | ESLint | Qualquer erro |
| 5 | **Hex literal ou cor Tailwind padrão em componente** | Regra ESLint/Stylelint própria | Qualquer ocorrência de `#RRGGBB`, `text-gray-*`, `bg-red-*` etc. fora de `packages/design-tokens` |
| 6 | **`outline: none` sem substituto** | Stylelint | Qualquer ocorrência |
| 7 | **Idioma e título de página** | Playwright | `<html lang>` ausente, ou `<title>` duplicado/genérico em qualquer rota |
| 8 | **Profundidade de navegação ≤3 cliques** | Teste sobre o mapa de rotas gerado | Qualquer rota do cliente ou do admin exigindo 4 níveis (§2.5) |
| 9 | **Alvo mínimo de 44 px nos componentes do design system** | Teste de componente (Testing Library + `getBoundingClientRect`) | Qualquer controle do DS abaixo de 44×44 fora do modo denso |
| 10 | **Orçamento de JS** | `size-limit` sobre o output do `next build` | Estouro do orçamento da §6.2 |
| 11 | **Core Web Vitals de laboratório** | Lighthouse CI, mediana de 3 execuções | LCP, INP ou CLS fora das metas da §6.1 |
| 12 | **CSP sem `unsafe-inline` / `unsafe-eval`** | Teste que lê o header da resposta | Presença de qualquer um dos dois em `script-src` |
| 13 | **Conformidade de módulo** | Suíte de conformidade da §6.7 | Módulo que reprova qualquer item do contrato |
| 14 | **Pa11y CI nas URLs públicas** | `standard: WCAG2AAA` | Qualquer erro (o público é 100% nosso, não tem desculpa) |

#### 🟡 Avisa, não bloqueia

| Verificação | Por que não bloqueia |
|---|---|
| Violações axe de regras **"experimental"** e **"best-practice"** | Ruído alto, benefício incerto |
| Regras `wcag2aaa` do axe **fora** de contraste | Algumas delas cobrem critérios que **recusamos** (`3.1.5`, `1.3.6`) — bloquear seria mentir para nós mesmos |
| Lighthouse "Accessibility score" | **Nunca é meta.** É apenas registrado no histórico |
| Novo termo técnico sem verbete no glossário | Vira comentário automático no PR listando os termos novos detectados |

#### 🧍 Só humano decide (checklist obrigatória no template de PR)

Nenhum robô valida estes; são caixas que o autor do PR marca e o revisor confere:

- [ ] Rodei o **Bloco A** (só teclado) nas telas que mudei.
- [ ] Nenhuma ação nova rouba o foco (`3.2.5`).
- [ ] Toda ação nova se encaixa numa linha da matriz de `3.3.6` (reversível / verificada / confirmada).
- [ ] Todo campo novo tem rótulo, texto de ajuda persistente e mensagem de erro que ensina a corrigir.
- [ ] Todo estado novo tem **cor + ícone + forma + texto**.
- [ ] Todo termo técnico novo tem verbete no glossário.
- [ ] Se entrou vídeo com áudio: **a declaração de acessibilidade da §7 foi atualizada neste mesmo PR.**

---

## 6. Qualidade de engenharia — a outra leitura de "AAA"

### 6.1 Core Web Vitals — metas por superfície

**Duas superfícies, dois orçamentos.** Tratá-las igual é o erro que faz painel autenticado ser
lento "porque é painel". O painel tem *menos* desculpa que o site: não tem imagem de herói, não tem
banner de terceiro e serve um usuário logado que abre a mesma tela 30 vezes por dia.

| Métrica | Limite "verde" oficial | **Meta do site público** | **Meta do painel autenticado** | Onde medimos |
|---|---|---|---|---|
| **LCP** | ≤2,5 s (p75) | **≤1,8 s** | **≤2,0 s** (shell + primeiro card real) | Lab (LHCI) + campo (RUM) |
| **INP** | ≤200 ms (p75) | **≤150 ms** | **≤180 ms** | Campo, principalmente |
| **CLS** | ≤0,1 (p75) | **≤0,03** | **≤0,05** | Lab + campo |
| **TTFB** | ≤0,8 s | **≤0,3 s** (estático) | **≤0,6 s** | Lab + campo |
| **FCP** | ≤1,8 s | ≤1,0 s | ≤1,2 s | Lab |

Metas **de laboratório** (LHCI, *Moto G Power*, 4G lento) são as que o CI barra; as **de campo** são
o que o RUM monitora e o que vira alerta operacional.

**Como atingir cada uma no Next.js 16 App Router**, respeitando as decisões do `05-nodejs-nextjs.md`:

| Métrica | Risco concreto neste produto | O que fazer |
|---|---|---|
| **LCP — público** | Imagem de herói e fonte | `use cache`/PPR (liberado só no público pela §4.1), `next/image` com AVIF, `priority` no LCP, `next/font` com `display: swap` e `preload`, e **fonte variável auto-hospedada** — zero requisição a `fonts.googleapis.com` (também é ganho de CSP e de LGPD) |
| **LCP — painel** | O doc de Node decidiu **buscar dados no cliente** com TanStack Query; isso empurra o LCP para depois do JS | O **shell** (nav, header, títulos, esqueleto dos cards) é **RSC estático** e pinta antes de qualquer JS. O LCP é medido no shell, não no dado. Prefetch da rota no `hover`/`focus` do link (`next/link` já faz) |
| **INP — painel** | **O maior risco do projeto.** Tabela de 500 linhas, log de 2.000 linhas, gráfico com 35.000 pontos | (a) Virtualização obrigatória (`@tanstack/react-virtual`) em toda lista >50 itens; (b) o `setData` do uPlot **fora do ciclo do React** (já decidido na §4.2 do doc de Node); (c) `startTransition` em filtro e ordenação; (d) **nenhuma** parse de JSON grande na thread principal — o SSE entrega incremental; (e) `content-visibility: auto` em card fora da viewport |
| **CLS — ambos** | Skeleton com altura diferente do conteúdo; chip de saldo que aparece depois; toast que empurra layout | Skeleton com **exatamente** a altura final; toda imagem com `width`/`height`; toast em `position: fixed`; fonte com `size-adjust` para casar métrica com a de fallback; **nenhum banner injetado no topo depois da carga** |
| **TTFB — painel** | Next standalone no mesmo VPS do CP, com 512 MB (`05-nodejs` §4.6) | Não fazer *fetch* de domínio no RSC (já decidido). `Cache-Control` correto no shell. `MemoryMax` e `Restart=always` já previstos |

**Regra que resolve o LCP do painel de uma vez:** o **shell não depende de API nenhuma**. Se a API
estiver fora do ar, o painel pinta a moldura, o menu e uma mensagem de erro — em vez de uma tela
branca. Isso é performance *e* resiliência *e* acessibilidade (`3.3.1`).

### 6.2 Orçamento de performance

Orçamento **fechado**, verificado por `size-limit` sobre o output do `next build`. Todos os
valores são **transferidos, comprimidos com Brotli**.

| Superfície | JS de primeira carga | CSS | Requisições até o LCP | Peso total da rota |
|---|---|---|---|---|
| **Site público — home** | **≤ 90 KB** | ≤ 20 KB | ≤ 12 | ≤ 400 KB |
| **Site público — docs/glossário** | **≤ 70 KB** | ≤ 20 KB | ≤ 10 | ≤ 300 KB |
| **Painel — shell** (layout, nav, header, auth) | **≤ 165 KB** | ≤ 35 KB | ≤ 15 | — |
| **Painel — `/ambientes`** (lista + tabela) | +≤ 45 KB | — | — | ≤ 480 KB |
| **Painel — `/ambientes/{id}`** (dashboard + uPlot) | +≤ 60 KB | — | — | ≤ 560 KB |
| **Painel — `/terminal`** (xterm.js) | +≤ 130 KB, **carregado só nesta rota** | — | — | — |
| **Qualquer chunk isolado** | **≤ 150 KB** | — | — | — |

Regras que sustentam o orçamento:
1. **Nenhum chunk único acima de 150 KB.** Chunk grande é chunk que bloqueia a thread e mata o INP.
2. **`xterm.js`, `Recharts` e o editor de código são `next/dynamic` com `ssr: false`** — só existem
   na rota que os usa. `Recharts` fica confinado a `/financeiro` (decisão do `05-nodejs` §4.2).
3. **Zero biblioteca de data pesada.** `Intl.DateTimeFormat` e `Intl.NumberFormat` nativos.
   `date-fns` só com import por função, se realmente necessário.
4. **Zero biblioteca de ícones inteira.** Ícones como componentes SVG individuais gerados no build.
5. **Zero script de terceiro no painel.** Analytics, chat de suporte e *heatmap* **não entram** —
   custam KB, custam INP, custam CSP e custam LGPD. Se houver analytics, é no site público e é
   *self-hosted*, sem cookie.
6. **Orçamento é por rota, medido no CI, e estourar reprova o merge** (§5.6, item 10).

Medição no CI:
```jsonc
// .lighthouserc.json (essência)
{ "ci": { "collect": { "numberOfRuns": 3 },
  "assert": { "assertions": {
    "largest-contentful-paint": ["error", { "maxNumericValue": 1800 }],
    "cumulative-layout-shift":  ["error", { "maxNumericValue": 0.03 }],
    "total-blocking-time":      ["error", { "maxNumericValue": 200 }],
    "resource-summary:script:size":   ["error", { "maxNumericValue": 92160 }],
    "resource-summary:total:count":   ["error", { "maxNumericValue": 12 }]
  } } } }
```
Além do laboratório, **RUM próprio**: `next/web-vitals` envia LCP/INP/CLS/TTFB reais para um
endpoint nosso (`POST /api/v1/rum`), agregado no VictoriaMetrics que já existe na infra
(`05-nodejs` §4.6). Zero terceiro. **Alerta quando o p75 de INP do painel passar de 200 ms por
24 h** — é o sintoma de "a tabela cresceu e ninguém percebeu".

### 6.3 SEO técnico do site público

O painel autenticado é `noindex`. Todo o SEO vive no site público, e **acessibilidade e SEO são a
mesma disciplina em 80% dos itens** — HTML semântico, `h1` único, texto alternativo, links com
propósito claro, performance.

| Item | Decisão |
|---|---|
| Renderização | **RSC estático + `use cache`/PPR** — o único lugar do projeto onde eles são permitidos (`05-nodejs` §4.1) |
| Metadados | `generateMetadata` por rota, com `title` (≤60 caracteres), `description` (≤155), `canonical`, `openGraph` e `twitter` |
| `sitemap.xml` / `robots.txt` | `app/sitemap.ts` e `app/robots.ts` nativos. Painel e admin com `Disallow` **e** `noindex` no header |
| Dados estruturados | JSON-LD de `Organization`, `Product` + `Offer` (planos, com preço em BRL), `FAQPage`, `BreadcrumbList` e `DefinedTerm` para cada verbete do glossário |
| **URLs em português** | `/planos`, `/hospedagem-node-js`, `/precos`, `/glossario/o-que-e-cname`. Sem `/pt-br/` no caminho enquanto houver uma só língua |
| `hreflang` | Preparado, inativo. Quando o inglês entrar: `/en/...` + `hreflang` recíproco + `x-default` |
| **O glossário é o ativo de SEO** | ~120 verbetes = ~120 páginas de cauda longa ("o que é TTL", "para que serve o registro CNAME"), com `DefinedTerm` e link interno para o produto. **O critério AAA `3.1.3` paga a própria conta em aquisição orgânica** |
| Página de status | Pública, indexável, `noindex` só nos detalhes de incidente antigo |
| Imagens | AVIF + WebP, `alt` real (não decorativo) em imagem que informa, `loading="lazy"` fora da dobra, `fetchpriority="high"` no LCP |
| Core Web Vitals | São fator de classificação. As metas da §6.1 já cobrem |
| **Sem `alt` "keyword stuffing"** | `alt` descreve a imagem para quem não a vê. Enfiar palavra-chave nele piora a acessibilidade e não ajuda o buscador |

### 6.4 Segurança de front-end — CSP estrita sem `unsafe-inline`

Um painel que dá `root` em servidor de produção não pode ter CSP frouxa. Meta:
**`script-src` sem `unsafe-inline` e sem `unsafe-eval`**, verificada no CI (§5.6, item 12).

O problema conhecido: o Next.js injeta scripts inline de hidratação. A única forma segura hoje é
**nonce por requisição + `strict-dynamic`**, gerado no middleware, com o Next propagando o nonce
para os próprios scripts. ([Next.js — Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy),
[discussão vercel/next.js#81703](https://github.com/vercel/next.js/discussions/81703))

```ts
// apps/painel/src/proxy.ts  (middleware)
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    // strict-dynamic: o que o script com nonce carregar herda a confiança.
    // 'unsafe-inline' fica como fallback IGNORADO por navegador que entende nonce.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,                       // fonte auto-hospedada: nada de Google Fonts
    `connect-src 'self'`,                    // API e SSE na mesma origem, via nginx
    `frame-src 'self' https://modulos.velozpanel.com.br`,  // fase 2 (iframe de terceiro)
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `require-trusted-types-for 'script'`,
    `trusted-types nextjs default veloz-sanitizer`,
    `upgrade-insecure-requests`,
  ].join('; ');

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}
```

Cinco consequências que precisam estar no plano, porque cada uma pega alguém de surpresa:

1. **Nonce exige renderização dinâmica.** A rota deixa de ser estática. **No painel autenticado
   isso é irrelevante** — não há nada estático lá. **No site público, o custo é real**: perderíamos
   PPR e o TTFB de 0,3 s.
   > **Decisão: CSP com nonce apenas no painel** (`painel.` e `admin.`). No **site público**, CSP
   > estática sem nonce e **sem inline nenhum**, com `script-src 'self'` puro — possível porque o
   > site de marketing não tem script de terceiro (§6.2, regra 5). Duas políticas, aplicadas por
   > hostname no nginx do CP.
2. **`'unsafe-inline'` aparece na string acima e isso é correto.** Navegador que entende `nonce`
   **ignora** `'unsafe-inline'`; ele existe só como *fallback* para navegador antigo.
   O teste de CI precisa validar que **o nonce está presente**, não a ausência literal da string.
3. **`style-src` com nonce e Tailwind v4.** O Tailwind gera CSS em arquivo — sem inline. O que gera
   `style` inline é animação e posicionamento de popover (`@floating-ui`). Solução: variáveis CSS
   em `style={{ '--x': ... }}` são **atributo `style`**, controlado por `style-src-attr`, não por
   `style-src`. Mantemos `style-src-attr 'unsafe-inline'` (risco desprezível: atributo `style` não
   executa script) e `style-src` com nonce.
4. **Trusted Types** (`require-trusted-types-for 'script'`) elimina a classe inteira de XSS por
   sink de DOM. O Next.js registra a política `nextjs`; precisamos declarar a nossa
   (`veloz-sanitizer`) para o único lugar que escreve HTML: **o log e a saída do terminal**.
   Regra absoluta: **`dangerouslySetInnerHTML` é proibido no repositório** (regra ESLint), exceto
   dentro de `packages/ui/src/SafeHtml.tsx`, que passa por `DOMPurify` sob a política registrada.
   Rollout: subir primeiro como `Content-Security-Policy-Report-Only` por 2 semanas, coletar
   violações no nosso endpoint, depois travar.
5. **Headers que acompanham** (no nginx do CP, aplicados a ambos os hostnames):

| Header | Valor |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Frame-Options` | `DENY` (redundante com `frame-ancestors`, mantido por compatibilidade) |

**Como isso conversa com a UI plugável por módulo.** O `05-nodejs-nextjs.md` §4.4 já matou o ESM
remoto **justamente por causa da CSP**, e escolheu registry em build-time (fase 1) + iframe
sandbox (fase 2). Isso resolve o conflito de raiz:

| Fase | Mecanismo | Efeito na CSP |
|---|---|---|
| **1 — módulos próprios** | `React.lazy(() => import('@veloz/mod-x/ui'))`, código no nosso bundle | **Nenhum.** `script-src 'self'` continua bastando. O módulo é código nosso, revisado e assinado no mesmo build |
| **2 — módulos de terceiros** | `<iframe sandbox="allow-scripts allow-forms">` em `modulos.velozpanel.com.br`, **origem separada, sem cookie de sessão** | Adiciona **uma** entrada em `frame-src`. O iframe tem a **própria CSP**, mais frouxa, e não alcança o DOM nem a sessão do painel |
| **Nunca** | ESM remoto na origem do painel | Exigiria afrouxar `script-src` para host externo — o oposto do propósito da CSP |

Contrato de segurança do iframe da fase 2: `postMessage` com **origem verificada em ambas as
direções**, esquema de mensagens validado por `zod` (`packages/contracts`), token de escopo estreito
e curta duração (nunca o cookie de sessão), e altura negociada por mensagem `resize` — nunca
`allow-same-origin` junto com `allow-scripts` (essa combinação anula o sandbox).

### 6.5 i18n PT-BR, moeda e data

Decisão herdada e mantida do `05-nodejs-nextjs.md` §4.7: **`next-intl`, `pt-BR` como única locale
ativa, com 100% das strings em `messages/pt-BR.json` desde o primeiro commit.**

| Item | Decisão | Motivo |
|---|---|---|
| Estrutura | `messages/pt-BR.json` com namespace por domínio (`ambiente.*`, `financeiro.*`, `admin.*`) e por módulo (`mod-php.*`) | Módulo entrega as próprias mensagens via `host.i18n.register()` |
| Estrutura para inglês | Roteamento já preparado: `[locale]` no App Router, `hreflang`, `<html lang={locale}>` **dinâmico** (`3.1.1`), e `pluralRules` do ICU desde já | Adicionar `en` vira um arquivo + tradução. Extrair string *hardcoded* depois é refactor de semanas |
| **Nada de concatenação de string** | `t('ambiente.pausadoEm', { data })`, nunca `t('pausadoEm') + data` | Concatenação quebra em qualquer língua com ordem diferente, e quebra a leitura por leitor de tela |
| **Plural e gênero via ICU** | `{n, plural, =0 {nenhum ambiente} one {# ambiente} other {# ambientes}}` | "1 ambientes" é o erro mais visível de produto brasileiro |
| Moeda | `Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })` → `R$ 35,00` | Zero dependência |
| **Moeda de tarifa horária** | `minimumFractionDigits: 4` → `R$ 0,0486/h`. E **sempre** com o equivalente mensal ao lado | 4 casas é ilegível sozinho; o par resolve (`3.1.5`) |
| Data e hora | `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' })` → `20/08/2026 14:32` | **Fuso do usuário, configurável**; o banco guarda UTC |
| **Data relativa sempre acompanhada da absoluta** | `<time dateTime="2026-08-20T14:32:00Z" title="20/08/2026 14:32">há 3 minutos</time>` | "há 3 minutos" sozinho é inútil em log de incidente. E `<time>` é o elemento semântico correto |
| Bytes | `1,5 GB` com vírgula decimal e espaço antes da unidade | Padrão brasileiro |
| **Números em tabela** | Alinhados à direita, com `font-variant-numeric: tabular-nums` | Comparação de coluna fica possível |
| **Nunca traduzir termo de infraestrutura consagrado** | `deploy`, `commit`, `branch`, `cron`, `log`, `cache` ficam. `environment` → **ambiente**; `hosting` → **hospedagem** | Traduzir `deploy` para "implantação" confunde quem já usa a ferramenta |

### 6.6 Tema escuro, responsividade e preferências do sistema

Isto não é só estética: é a **cláusula 11.7 da EN 301 549** (respeitar as preferências do sistema
operacional), citada na §1.5.

| Preferência | Comportamento obrigatório |
|---|---|
| `prefers-color-scheme` | Define o tema **na primeira carga**. Depois, a escolha do usuário (cookie) manda. **Nunca** trocar sozinho no meio da sessão (`3.2.5`). Script de tema inline no `<head>` **com nonce** — é o único inline permitido, e existe para evitar o flash de tema errado |
| `prefers-reduced-motion: reduce` | Desliga **toda** animação e transição não essencial (`2.3.3`). Implementado uma vez, globalmente, e não por componente |
| `prefers-contrast: more` | Ativa o terceiro tema, **alto contraste** (bordas mais fortes, sombra trocada por borda, `--vp-text-3` promovido a `--vp-text-2`). É também parte do mecanismo do `1.4.8` |
| `forced-colors: active` (Alto Contraste do Windows) | Nenhuma informação pode se perder: ícone com `forced-color-adjust: auto`, borda em `ButtonBorder`, foco em `Highlight`, e **estado nunca comunicado só por `background-color`** (que o modo substitui) |
| `prefers-reduced-transparency` | Remove *glassmorphism* e *backdrop-filter* — que, aliás, já são proibidos porque destroem o cálculo de contraste |

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
}
```

**Responsividade real** — não "encolhe e reza". `01-produto-ux.md` §5.6 exige que o celular sirva
para: ver status, ver custo, pausar/iniciar, ver log e reiniciar.

| Largura | Comportamento |
|---|---|
| **320 px** (piso obrigatório, `1.4.10`) | Coluna única. **Zero rolagem horizontal.** Tabela vira lista de cards, com o rótulo da coluna dentro de cada card |
| 320–767 px | Navegação em gaveta (`Dialog` do Radix, foco preso, `Esc` fecha). Gráfico com no máximo 2 séries e período padrão de 6 h |
| 768–1023 px | Navegação recolhida em ícones **com rótulo em `aria-label` e tooltip acessível** |
| ≥1024 px | Layout completo |
| **Zoom de 400%** | Equivale a 320 px de largura — o mesmo *breakpoint* atende (`1.4.10`) |
| **Orientação** | Funciona em retrato **e** paisagem, sem travar (`1.3.4`, AA) |

Regras que impedem a quebra clássica: nada de `width` fixo em px acima de 320; toda tabela larga
dentro de um contêiner `overflow-x:auto` **focável** (§4.1); nenhum modal com `min-width` maior
que `100vw - 32px`; e o terminal em celular vira "abra no desktop" com explicação — não uma
experiência quebrada.

### 6.7 Acessibilidade de módulo de terceiro — **regra de conformidade obrigatória**

Este é o ponto onde o padrão do VelozPanel morre se ninguém escrever a regra. O produto é modular
por requisito do dono (briefing, item 2); um módulo injeta tela no painel; se ele usar
`<div onClick>` com cinza claro, o painel inteiro deixa de ser conforme — porque **conformidade
WCAG é por página, e a página é composta**.

> **Regra: o módulo não é conforme por confiança. Ele é conforme por construção e por teste.**

#### O que o módulo **não** pode fazer

O Host SDK entrega os componentes prontos. O módulo **consome**, não reimplementa.

- ❌ Cor literal, cor do Tailwind padrão, ou qualquer coisa fora de `--vp-*`.
- ❌ Botão, campo, modal, tabela, toast ou tooltip próprios. Usa `host.ui.*` (`Button`, `Field`,
  `DataTable`, `Dialog`, `Toast`, `Termo`) — que já carregam foco, alvo de 44 px, ARIA e contraste.
- ❌ `dangerouslySetInnerHTML`, `document.write`, `eval`, injeção de `<style>` global ou `<script>`.
- ❌ Roubar foco, abrir modal sozinho, redirecionar (`3.2.5`).
- ❌ Criar `aria-live` própria. Anúncios passam por `host.a11y.announce(texto, 'polite'|'assertive')`,
  que é a **única** região viva do painel — isso impede a colisão de regiões que faz leitor de tela
  ler tudo duas vezes.
- ❌ Registrar atalho de tecla única (`2.1.4`) ou capturar `Tab`.
- ❌ String *hardcoded*. Toda string via `host.i18n`.

#### O que o módulo **deve** entregar

| Entregável | Formato |
|---|---|
| **Declaração no manifesto** | `a11y: { nivel: 'wcag22-aa' \| 'wcag22-aa+veloz-aaa', criteriosAAA: [...], excecoes: [...], testadoEm: '2026-08-20' }` |
| **Mensagens de i18n** | `messages/pt-BR.json` do módulo |
| **Verbetes de glossário** | Todo termo técnico que a tela dele introduz (`3.1.3`) |
| **Heading raiz** | Toda tela de módulo começa em `<h2>` — o `<h1>` é do host. O host renderiza o módulo dentro de `<section aria-labelledby>` com o nome do módulo |
| **Ajuda contextual** | Painel "Sobre esta tela" e ajuda por campo (`3.3.5`) |
| **Classificação de cada ação** | Cada ação declarada como `reversivel`, `verificada` ou `confirmada` (`3.3.6`), no manifesto — o host **recusa** ação não classificada |
| **Documentação de acessibilidade** | Exigência da **EN 301 549 cláusula 12.1**: o que a tela do módulo faz e quais recursos de acessibilidade tem |

#### Como isso é **forçado**, e não apenas pedido

| Camada | Mecanismo |
|---|---|
| **1. Tipagem** | O Host SDK não exporta primitivo cru. `host.ui.Button` existe; `<button>` estilizado à mão não passa no lint do pacote do módulo |
| **2. Lint no pacote do módulo** | O mesmo `eslint.config.js` e `stylelint` do core, herdados por `packages/module-preset`. Hex literal, `outline:none` e `dangerouslySetInnerHTML` reprovam |
| **3. Suíte de conformidade** | `pnpm veloz:module-check <modulo>` monta cada tela declarada do módulo num harness com o layout real do painel e roda **axe (A+AA + contraste 7:1)**, checagem de heading, de alvo de 44 px e de nome acessível. **Reprovar = não publica.** É o item 13 do portão de CI |
| **4. Portão de instalação** | `/admin/modulos` **recusa instalar** módulo cujo manifesto não declare `a11y` ou cujo relatório de conformidade tenha mais de 180 dias |
| **5. Degradação honesta** | Se um módulo instalado reprovar em auditoria periódica, o host **não o esconde**: mostra a tela com um aviso `role="status"` — *"Este módulo não atende ao padrão de acessibilidade do VelozPanel. Relatado ao fornecedor em DD/MM."* — e o fato entra na declaração pública da §7 |
| **6. Fase 2 (iframe)** | O host não consegue auditar o DOM de outra origem. Por isso o módulo de terceiro em iframe **só é publicado** com relatório da suíte executada no build **dele**, entregue como artefato assinado. Sem relatório, sem publicação |

**A regra em uma frase, para o catálogo de módulos:**
> *Nenhum módulo é publicado no VelozPanel sem passar na suíte de conformidade de acessibilidade
> do host. O nível declarado pelo módulo aparece no catálogo, ao lado da versão — e um módulo que
> só atinge AA aparece marcado como tal.*

---

## 7. Declaração de acessibilidade — texto pronto para publicar

**Onde publica:** `https://velozpanel.com.br/acessibilidade`, com link no **rodapé de todas as
páginas** (site público, painel do cliente e painel do super admin), ao lado do **símbolo
internacional de acessibilidade**, conforme exige o art. 63 §1º da LBI. Também linkada da
página `/mapa` e da central de ajuda.

**Regra de manutenção:** a data de revisão é atualizada **a cada release que mexe em UI**, e a
seção "O que ainda não está conforme" é revisada **no mesmo PR** que cria ou resolve uma
não conformidade. Declaração desatualizada é pior que declaração ausente.

---

> # Declaração de Acessibilidade
>
> **Última atualização:** DD/MM/AAAA · **Versão avaliada do painel:** X.Y.Z
>
> ## Nosso compromisso
>
> O VelozPanel foi feito para ser usado por todo mundo — inclusive por quem navega só com o teclado,
> por quem usa leitor de tela, por quem enxerga pouco, por quem não distingue cores e por quem
> precisa de mais tempo para concluir uma tarefa.
>
> Levamos isso a sério porque é a coisa certa a fazer e porque é a lei: o art. 63 da Lei
> 13.146/2015 (Lei Brasileira de Inclusão) obriga a acessibilidade nos sites de empresas com sede
> no Brasil.
>
> ## Nível de conformidade
>
> **O VelozPanel está em conformidade com a WCAG 2.2 no Nível AA, e atende adicionalmente
> 24 dos 31 critérios de Nível AAA.**
>
> Isso vale para as três partes do produto: o site público, o painel do cliente e o painel
> administrativo.
>
> Escolhemos declarar exatamente isto, e não "site AAA", por honestidade técnica. O próprio W3C,
> que escreve a norma, **desaconselha** exigir Nível AAA para um site inteiro, porque alguns
> critérios AAA são impossíveis de cumprir para certos tipos de conteúdo. Preferimos dizer o que
> cumprimos, item a item, a exibir um selo que não se sustenta.
>
> ## O que fizemos além do mínimo
>
> - **Contraste reforçado (7:1)** em todo o texto, nos temas claro e escuro — quase o dobro do
>   exigido pelo Nível AA.
> - **Tudo funciona só com o teclado**, sem exceção — inclusive gráficos, tabelas e o terminal.
> - **Nenhum limite de tempo** na interface: não há contador regressivo, nenhuma tela expira
>   enquanto você a usa, e nenhum aviso desaparece levando embora a informação.
> - **Se a sua sessão expirar**, você entra de novo sem perder nada do que já tinha preenchido.
> - **Nada muda de lugar sozinho.** Notificações não roubam o foco, a tela não pula e listas não
>   se reordenam sem você pedir.
> - **Indicador de foco reforçado**, sempre visível e nunca escondido atrás de barras fixas.
> - **Áreas de clique de pelo menos 44 × 44 pixels** em toda a interface.
> - **Nenhuma informação é dada só pela cor.** Todo estado tem cor, ícone, forma e texto.
> - **Glossário integrado** com mais de 100 termos técnicos explicados em linguagem simples,
>   acessível de dentro das telas onde eles aparecem.
> - **Ajuda em todo campo** de formulário, e mensagens de erro que dizem como corrigir.
> - **Toda ação pode ser desfeita, é verificada antes ou pede confirmação** — nenhuma exclusão
>   acontece por um clique errado.
> - **Login sem CAPTCHA**, com suporte a passkey e a gerenciadores de senha, e com "colar"
>   sempre habilitado.
> - **Gráficos com resumo em texto e tabela de dados equivalente**, além de exportação em CSV.
> - **Respeitamos as preferências do seu sistema**: tema escuro, alto contraste e redução de
>   movimento.
>
> ## O que ainda **não** está conforme
>
> Preferimos listar isto do que escondê-lo.
>
> 1. **Conteúdo em vídeo não tem interpretação em Libras nem audiodescrição estendida**
>    (critérios 1.2.6 e 1.2.7, Nível AAA). Hoje não publicamos vídeo com áudio; se publicarmos,
>    ele terá legenda e transcrição completa, mas não janela de Libras.
> 2. **A documentação técnica não é simplificada para o nível de leitura do ensino fundamental**
>    (critério 3.1.5, Nível AAA). Simplificar instruções de infraestrutura abaixo de certo nível
>    torna o texto impreciso, e imprecisão sobre servidores causa perda de dados. Em compensação,
>    **todas as telas de decisão, de cobrança e de ciclo de vida da conta têm um resumo em
>    linguagem simples**, e há um glossário para cada termo técnico.
> 3. **O modo "densidade compacta" das tabelas** — que é opcional e vem desligado — usa alvos de
>    clique menores que 44 pixels. Nesse modo específico atendemos o Nível AA (24 pixels), não o
>    AAA. O modo padrão atende o AAA.
> 4. **O terminal web** é um componente de linha de comando e, por natureza, oferece uma
>    experiência limitada com leitor de tela. Ele tem modo compatível com leitor de tela e uma
>    saída de teclado documentada e visível. **Nenhuma função do VelozPanel exige o terminal**:
>    tudo que ele faz também pode ser feito por telas acessíveis (arquivos, banco de dados,
>    agendamentos, registros, publicação).
> 5. **Não usamos semântica de personalização** (critério 1.3.6, Nível AAA) porque ainda não há
>    navegador ou leitor de tela que a interprete. Revisaremos quando houver suporte real.
> 6. **Módulos de terceiros** passam por uma verificação obrigatória de acessibilidade antes de
>    serem publicados, mas não são desenvolvidos por nós. Se um módulo instalado deixar de atender
>    ao nosso padrão, isso aparece como aviso dentro da própria tela dele e é listado aqui.
>
> *(Nenhuma não conformidade adicional conhecida na data desta revisão.)*
>
> ## Como avaliamos
>
> - **Autoavaliação**, feita pela equipe do VelozPanel — ainda não contratamos auditoria externa
>   independente. Quando contratarmos, o laudo será publicado aqui.
> - **Verificação automática a cada alteração de código**, com `axe-core` (regras de Nível A, AA e
>   de contraste reforçado) executada em 22 estados diferentes da interface, nos temas claro e
>   escuro, e com `Pa11y` no site público.
> - **Verificação manual a cada versão**, com navegação exclusivamente por teclado, com os leitores
>   de tela **NVDA** (Windows/Firefox) e **VoiceOver** (macOS/Safari), com zoom de 400%, com
>   largura de 320 pixels, em preto e branco, e no Modo de Alto Contraste do Windows.
> - **Referências normativas:** WCAG 2.2 (W3C), ABNT NBR 17225:2025, art. 63 da Lei 13.146/2015 e,
>   como referência complementar, o eMAG 3.1 e a EN 301 549.
>
> ## Encontrou uma barreira? Fale com a gente.
>
> Queremos saber. Um relato seu vale mais que qualquer ferramenta automática.
>
> - **E-mail:** acessibilidade@velozpanel.com.br
> - **Formulário:** velozpanel.com.br/acessibilidade/relatar *(acessível, com apenas 3 campos e
>   nenhum CAPTCHA)*
> - **Dentro do painel:** botão **Ajuda** → *"Relatar problema de acessibilidade"*
> - **WhatsApp:** (XX) XXXXX-XXXX
>
> Ao relatar, se puder, diga: **em qual tela**, **o que você tentou fazer**, **o que aconteceu** e
> **qual navegador e tecnologia assistiva você usa**. Se não puder, mande do jeito que der — a
> gente descobre o resto.
>
> **Nosso compromisso de resposta:**
> - Confirmação de recebimento em até **2 dias úteis**.
> - Diagnóstico com prazo estimado de correção em até **10 dias úteis**.
> - **Barreira que impede completamente uma tarefa é tratada como incidente**, com correção
>   priorizada acima de qualquer funcionalidade nova.
>
> Se não obtiver resposta satisfatória, você pode acionar o Ministério Público do seu estado ou a
> Defensoria Pública, que têm legitimidade para tratar de acessibilidade digital nos termos da
> Lei 13.146/2015 e da Lei 7.853/1989.
>
> ---
> *Esta declaração foi elaborada em DD/MM/AAAA e é revisada a cada versão do VelozPanel que
> altere a interface.*

---

## 8. Decisões fechadas

| # | Decisão | Trade-off aceito |
|---|---|---|
| **D1** | **Alvo é WCAG 2.2 AA em 100% + 24 critérios AAA nominais.** Não declaramos "AAA". | Perde-se o marketing de "site AAA"; ganha-se uma declaração verdadeira e defensável em juízo |
| **D2** | **7 critérios AAA recusados**, com motivo escrito (§1.4). 5 deles anulados por decisão de produto: **o VelozPanel não publica mídia sincronizada com áudio** | Marketing perde o vídeo institucional, ou o assume com legenda+transcrição e reabre 5 critérios |
| **D3** | **Contraste 7:1 em toda a paleta**, claro e escuro, validado por script no CI | Paleta menos vibrante, especialmente no escuro. Aceito |
| **D4** | **Cor nunca é indicador único**: todo estado é cor + ícone + forma + texto | Chip mais largo, tabela mais densa de informação. Aceito |
| **D5** | **`role="log"` do log ao vivo é `aria-live="off"` por padrão**; quem anuncia é um `role="status"` com resumo a cada 10 s | Quem quer linha a linha precisa ligar a opção. É o preço de não travar o leitor de tela |
| **D6** | **Gráfico em canvas sempre acompanhado de tabela alternativa agregada (≤24 linhas) + resumo textual calculado no servidor** | Endpoint de métricas passa a devolver `resumo` além da série. Custo pequeno no backend |
| **D7** | **Sonificação de gráfico: não entra** | Revisitar só sob demanda real de cliente |
| **D8** | **Alvo de 44 px é o padrão; "densidade compacta" é opt-in e declarado como não-conforme AAA** | Admin com muitos registros troca conformidade AAA por densidade, conscientemente |
| **D9** | **Glossário de ~120 verbetes é obrigatório** (`3.1.3`/`3.1.4`) e vira ativo de SEO | ~120 textos curtos para escrever. Paga-se em redução de ticket e em tráfego orgânico |
| **D10** | **CSP com nonce + `strict-dynamic` + Trusted Types no painel; CSP estática sem inline no site público.** Duas políticas por hostname | Painel perde renderização estática — irrelevante, pois ele não tem nada estático |
| **D11** | **Zero script de terceiro no painel** (analytics, chat, heatmap). RUM próprio no VictoriaMetrics | Perde-se ferramenta pronta de produto; ganha-se INP, CSP, LGPD e orçamento de KB |
| **D12** | **Nenhum módulo é publicado sem passar na suíte de conformidade do host** (`veloz:module-check`), e o nível dele aparece no catálogo | Fricção para o autor de módulo. É o único jeito de a conformidade sobreviver à modularidade |
| **D13** | **WCAG 3.0 não entra no planejamento.** Monitorar a cada 6 meses | Nenhum. O rascunho de março/2026 não tem sequer modelo de conformidade definido |
| **D14** | **Declaração de acessibilidade pública é obrigatória e é atualizada no mesmo PR que cria a não conformidade** | Disciplina de processo. Sem isso a declaração vira ficção em 3 meses |

---

## 9. O que fica para os próximos ciclos

1. **Auditoria externa independente** antes do lançamento comercial. Autoavaliação é o que temos
   hoje e está declarado como tal na §7. Custo estimado no mercado brasileiro: R$ 8.000–25.000 para
   um escopo deste tamanho.
2. **Teste com usuário real com deficiência** — o único método que encontra o que nenhuma norma
   descreve. Uma sessão de 90 min com um usuário de leitor de tela vale mais que um mês de axe.
3. **Revisar o marco legal em fev/2026 e ago/2027**: o decreto federal que oficializaria a
   NBR 17225 foi anunciado e não localizamos publicação; a EN 301 549 V4.1.1 deve ser citada no
   JOUE por volta de out/2026.
4. **Rever a §7 se o marketing publicar vídeo com áudio** — reabre 5 critérios AAA (item de
   checklist no template de PR).

---

## 10. Fontes

**Normas e especificações**
- [WCAG 2.2 — W3C Recommendation](https://www.w3.org/TR/WCAG22/) (05/10/2023; atualizações editoriais em 12/12/2024 e 06/05/2025)
- [Understanding Conformance — W3C WAI](https://www.w3.org/WAI/WCAG22/Understanding/conformance)
- [Understanding SC 2.4.13 Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- [WCAG 3.0 — W3C Working Draft, 03/03/2026](https://www.w3.org/TR/wcag-3.0/)
- [WCAG 3 Introduction — W3C WAI](https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/)
- [ARIA Authoring Practices Guide — W3C](https://www.w3.org/WAI/ARIA/apg/)
- [EN 301 549 V3.2.1 (2021-03) — ETSI (PDF)](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_60/en_301549v030201p.pdf)
- [Diretório de versões da EN 301 549 — ETSI](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/)

**Brasil**
- [Lei 13.146/2015 (LBI) — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm) (art. 63, art. 88, art. 98)
- [Lei 14.126/2021 (visão monocular) — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14126.htm)
- [Decreto 5.296/2004 — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2004/decreto/d5296.htm) (art. 47)
- [eMAG 3.1 — Governo Eletrônico](https://emag.governoeletronico.gov.br/) (abril/2014, 45 recomendações, base WCAG 2.0)
- [Acessibilidade Digital — gov.br / Governo Digital](https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/acessibilidade-digital)
- [ABNT NBR 17225:2025 — resumo CTA/IFRS](https://cta.ifrs.edu.br/abnt-nbr-17225-2025-acessibilidade-em-conteudo-e-aplicacoes-web-requisitos/)
- [ABNT NBR 17060:2022 — resumo CTA/IFRS](https://cta.ifrs.edu.br/abnt-nbr-17060-2022-acessibilidade-em-aplicativos-de-dispositivos-moveis-requisitos/)
- [Nova norma ABNT de acessibilidade digital — MDHC, março/2025](https://www.gov.br/mdh/pt-br/assuntos/noticias/2025/marco/com-apoio-do-governo-federal-nova-norma-tecnica-da-abnt-e-instituida-para-impulsionar-acessibilidade-digital-no-brasil)
- [Selo de Acessibilidade Digital — Prefeitura de São Paulo](https://prefeitura.sp.gov.br/w/noticia/selo-de-acessibilidade-digital-completa-tres-anos-de-existencia)

**Europa e EUA**
- [European Accessibility Act — Comissão Europeia](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/union-equality-strategy-rights-persons-disabilities-2021-2030/european-accessibility-act_en)
- [Carrefour condenado — Tribunal Judiciário de Caen, 04/06/2026 (EcommerceMag)](https://www.ecommercemag.fr/retail-1220/le-tribunal-de-caen-oblige-carrefour-a-rendre-son-site-accessible-58340)
- [ADA Title II — extensão dos prazos, Federal Register 20/04/2026](https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web)
- [ADA Title II Web Rule — ada.gov](https://www.ada.gov/resources/2024-03-08-web-rule/)

**Implementação**
- [Content Security Policy — Next.js Docs](https://nextjs.org/docs/app/guides/content-security-policy)
- [CSP e `unsafe-inline` em produção — discussão vercel/next.js #81703](https://github.com/vercel/next.js/discussions/81703)
- [Next.js: consequência do App Router na sua CSP](https://0xdbe.github.io/NextJS-CSP-AppRouter/)
- [Next.js 16 — release](https://nextjs.org/blog/next-16)

**Documentos internos**
- `Plan/00-BRIEFING.md` (ADENDO 2, seções E e F)
- `Plan/especialistas/05-nodejs-nextjs.md` (§4.1 App Router, §4.2 uPlot e SSE, §4.3 log ao vivo, §4.4 UI plugável, §4.6 orçamento de RAM, §4.7 design system e i18n)
- `Plan/especialistas/01-produto-ux.md` (§5 painel do cliente, §6 super admin, §A.1 funil, §A.3 ciclo de vida da conta)
