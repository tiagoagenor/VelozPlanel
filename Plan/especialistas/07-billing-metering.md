# 07 — Billing, Metering & Precificação

> Especialista #6 · **Ciclo 2 (planejar)**
> Fontes obrigatórias: `00-BRIEFING.md` (**ADENDO 1 §B/§C, ADENDO 2 e ADENDO 3 §G/§H/§I**), `01-produto-ux.md` §A.2–A.11
> (com as **17 perguntas** de §A.3.8), `criticas/ciclo-1-critica.md` §5 (modularidade de pagamento de
> fachada) e §6 (economia), `02-pesquisa-mercado.md` §4 (metering, PSPs) e §13 (compliance).
> Ordem de marcha do Ciclo 2: itens **2, 7, 11, 13, 14, 15**.

## Restrições fechadas do dono (não reavaliar)
1. **Nota fiscal está FORA do MVP** — mas o modelo de dados guarda hoje o que a NFS-e exigirá amanhã (§8).
2. **O meio de pagamento é um módulo plugável** — capability `payment.gateway v1`, zero acoplamento a PSP no core (§7).
3. **Cobrança por hora, com o cliente podendo pausar** a qualquer momento.
4. **O super admin muda RAM/vCPU a quente**, de qualquer ambiente, a qualquer hora.
5. Dinheiro **sempre** em `bigint` de centavos. Nenhum ponto flutuante em lugar nenhum.
6. **ADENDO 3 §G — a frota são 2 nós de produção + 1 nó de teste que não recebe cliente pagante.**
   Toda a economia deste documento foi refeita em **§3.10**, que prevalece sobre §3.3–§3.9.
7. **ADENDO 3 §H — catálogo fechado até 4 GB** (Start · Light · Plus · Pro). Nada de 8 GB ou 16 GB.
8. **ADENDO 3 §I — o momento é de validação, não de escala.** Prejuízo operacional nesta fase é
   esperado e aceito pelo dono. O plano otimiza para **aprender com poucos clientes e não perder dado**.

---

## 0. Resumo executivo — as 12 decisões que este documento fecha

| # | Decisão | Valor fechado |
|---|---|---|
| B1 | Granularidade de medição × cobrança | **Coleta a cada 60 s · cobra em minutos (fração de hora) · apresenta por hora · agrega no razão por hora** |
| B2 | Mês contábil | **720 h fixas.** O preço primário exibido é **R$/hora**; o valor mensal é rótulo de referência ("≈ em 30 dias de uso contínuo") |
| B3 | Fonte de verdade do faturamento | **A máquina de estados do control plane** (`state_windows`), não a telemetria do agente. Telemetria só reconcilia e prova |
| B4 | Nó offline / agente mudo / ambiente em erro | **Congela a cobrança de compute imediatamente**; disco congela em 60 min; sem cobrança retroativa; crédito de SLA automático |
| B5 | Preço unitário | **vCPU R$ 12,00/mês · RAM R$ 32,00/GB/mês · Disco R$ 0,25/GB/mês · Egress R$ 0,15/GB acima de 1 TB/mês** |
| B6 | Catálogo (ratificado pelo ADENDO 3 §H) | **Start R$ 30,50 · Light R$ 49,00 · Plus R$ 98,00 · Pro R$ 172,00.** Turbo (8 GB) e Max (16 GB) **fora do catálogo**. Preços **mantidos** após a reprojeção de 2 nós (§3.10.7) |
| B7 | **Ponto de equilíbrio** (frota real de 2 nós, §3.10) | **17 ambientes ativos = 94% do teto físico da frota.** Com o tempo do dono precificado, **não existe ponto de equilíbrio** |
| B8 | **Teto de desconto** | **Fase 1 (2 nós): 10%** — só 6 meses, só cliente âncora (§3.10.7). Escada plena **8/15/22%** (teto 25%) volta quando entrar o nó de 64 GB. Os 35% de `01` §A.3.7 são **refutados** |
| B9 | Compromisso | **Saldo dedicado em R$ + desconto travado no ambiente** (validado com a matemática, §4). Dinheiro **nunca** expira; o **desconto** expira em 1,5× o prazo |
| B10 | Fatura | **Não existe fatura no MVP.** Pré-pago puro: razão append-only + demonstrativo derivado. `invoices`/`invoice_items` de `03` §4.2 **saem do MVP** |
| B11 | Ciclo do inadimplente | **72 h carência → suspensão → 30 d arquivamento → exclusão em D+60.** 62 dias entre zerar o saldo e perder dados. Sem taxa de reativação, sem taxa de restauração |
| B12 | PSP | MVP **`mod-pagamento-asaas`** (Pix). Gatilho para `mod-pagamento-pix` (banco direto): **> 250 recargas/mês**. Stripe só com cliente fora do Brasil |

### O parágrafo que o dono precisa ler antes de tudo

*(atualizado pelo ADENDO 3 — a versão anterior supunha 3 nós de produção; a conta completa está em §3.10)*

A frota são **2 nós de produção de 16 GB** mais um nó de teste que é pago e não vende. Isso dá
**22 ambientes vendáveis, dos quais no máximo 17 podem estar ligados ao mesmo tempo**, e um teto absoluto
de faturamento de **R$ 1.144/mês**. O custo fixo é de **R$ 1.027/mês**, então o ponto de equilíbrio de
caixa fica em **17 ambientes ativos — exatamente 94% do teto físico da frota**. Não há folga nenhuma: o
melhor cenário possível, com tudo vendido e tudo rodando, rende **+R$ 88/mês**; e **contando o seu tempo
de suporte a R$ 80/h, o resultado é −R$ 162/mês — ou seja, esta frota dá prejuízo em 100% dos cenários,
inclusive no melhor deles.**

**Isso não é um problema de preço.** Subir a tabela para gerar R$ 500/mês de margem exigiria cobrar
R$ 72,60 pelo plano Light — 62% acima do concorrente direto, vindo de uma operação sem redundância e sem
histórico. Não vende, e ainda contamina a validação. **Os preços de §3.4 estão certos e ficam como estão.**

**A única alavanca é tamanho de nó.** Um único servidor de 64 GB acrescentado à frota leva a margem de
−R$ 1 para **+R$ 1.285/mês** e derruba o ponto de equilíbrio de 94% para 45% da capacidade. Até ele
chegar, o prejuízo de **R$ 700 a R$ 850/mês** é o custo do aprendizado — e o ADENDO 3 §I diz, com essas
palavras, que esse custo está aceito. O que este documento pede é que ele seja **escolhido com o número
na frente**, com no máximo **12 clientes** na fase 1 (§3.10.8) e com o gatilho de contratação do nó maior
escrito como número, não como intenção (§3.10.9).

---

## 1. Respostas às 17 perguntas de `01` §A.3.8

Cada resposta é **uma decisão**, com a justificativa e o custo de estar errado.

### P1 — Unidade de cobrança: hora cheia, minuto ou segundo?

> **DECISÃO: coleta por minuto, cobrança por minuto expressa como fração de hora, com piso de 5 minutos
> por ativação e teto de 6 transições pause/start por hora por ambiente.**

A tarifa continua sendo publicada em **R$/hora** (é a unidade que o cliente entende e a que o mercado
usa). O que muda é a **quantidade**: `quantidade = minutos_faturáveis / 60`, com 4 casas decimais.

Justificativa: a manchete do produto é *"pause e economize"*. Cobrar a hora cheia por 2 minutos de
ambiente ligado contradiz a manchete, gera ticket ("liguei pra testar 3 minutos e me cobraram 1 hora") e
é indefensável num modelo que se vende como honesto. O custo de implementar minuto é **zero**: já
amostramos por minuto de qualquer forma. O Hostoo cobra hora cheia; é exatamente onde ele é copiável e
onde ser melhor custa nada.

O **piso de 5 minutos por ativação** existe porque cada `start` custa trabalho real no nó (unpack de
camada, warmup de FPM, reload do proxy). Sem piso, um script que liga e desliga a cada 30 s consome
recurso de graça. O teto de 6 transições/hora é limite operacional que já deveria existir de qualquer
forma, e é o que impede o abuso virar problema de capacidade.

**Custo de estar errado:** se o piso de 5 min gerar reclamação, ele é um número numa tabela de
configuração — muda sem deploy.

### P2 — Mês contábil: 720 h fixas ou dias reais?

> **DECISÃO: 720 h fixas, e o preço primário exibido passa a ser R$/hora.**

O valor mensal deixa de ser uma promessa e vira um **rótulo de referência**, escrito assim em toda a UI e
na página de preços:

```
Veloz Light — R$ 0,068056/hora
≈ R$ 49,00/mês em 30 dias de uso contínuo
```

Justificativa: dias reais fazem a tarifa horária mudar todo mês (0,0680 em abril, 0,0658 em maio), o que
quebra três coisas de uma vez — o desconto travado do compromisso, todo orçamento em cache e toda
explicação de extrato. 720 h fixas mantêm **uma** tarifa por ambiente até alguém mudar o preço ou o
recurso, e é o que torna o razão auditável.

O risco real de 720 h é o consumidor que soma R$ 50,64 num mês de 31 dias e compara com "R$ 49,00/mês".
Isso é **3,3% de diferença** e vira Procon se o número anunciado for mensal. **Por isso o número
anunciado deixa de ser mensal.** Quem anuncia por hora e cobra por hora não tem o que explicar.

### P3 — Compromisso: bloco de horas, saldo dedicado em R$, ou percentual de desconto?

> **DECISÃO: saldo dedicado em R$ + percentual de desconto travado no AMBIENTE. Confirmado o §A.3.2/A.3.4
> do Produto/UX, com a matemática de §4 deste documento.**

Refutação das alternativas, com números em §4.1. Em resumo: **bloco de horas de um SKU morre no primeiro
resize do super admin** (o bloco passa a ser denominado numa unidade que não existe mais — requisito nº 9
do briefing quebra o produto); **desconto puro sem pré-pagamento** não gera caixa nem retenção, só
desconto. O saldo em R$ é a única denominação que sobrevive a resize, pausa, add-on e mudança de tabela
de preço, porque dinheiro é a unidade comum de todos eles.

### P4 — Pausar durante compromisso estende o prazo?

> **DECISÃO: estende automaticamente, sem regra especial. O teto é do DESCONTO, não do dinheiro: o
> desconto vale por `prazo × 1,5` (mínimo 6 meses); o saldo dedicado não consumido nunca expira — ao fim
> da validade ele vira crédito comum, sem desconto.**

Isso cai de graça do desenho: se o compromisso é um balde de reais e pausar consome menos reais por hora,
o balde dura mais. Não existe "estender o prazo" como operação — existe `término_aproximado` recalculado
a cada mudança de tarifa ou de estado, sempre exibido como *"termina em ~14/03/2027 no ritmo atual"*.

Por que o dinheiro não expira: dinheiro pré-pago que caduca é juridicamente frágil no Brasil (CDC art.
51, IV e §1º, III — vantagem exagerada). Já **benefício** (o desconto) pode ter prazo, porque foi
concedido em troca de um compromisso de prazo. Separar as duas coisas é o que permite ter teto sem ter
cláusula abusiva.

### P5 — Ambiente pausado cobra quanto? Por GB provisionado ou usado? IP reservado cobra?

> **DECISÃO: pausado cobra apenas disco, a R$ 0,25/GB **provisionado** por mês (R$ 0,000347/GB/h),
> cobrado por minuto como tudo o mais. Add-on de IP dedicado **continua cobrando** enquanto pausado.**

Provisionado, não usado: é o número que está no card do plano, é o que o cliente escolheu, é o que
reservamos na quota e é o único previsível. Cobrar por usado transforma a conta do cliente numa função do
crescimento do log dele e gera a pergunta "por que subiu sem eu mexer?" todo mês.

Regra geral para qualquer add-on, que responde P16 de uma vez: **add-on cujo custo para nós é
armazenamento continua cobrando pausado; add-on cujo custo é compute para.** Isso vira uma flag no
catálogo (`bills_while_paused`), não um caso especial no código.

Efeito em R$: Start pausado R$ 2,50/mês (8,2% do ativo) · Light R$ 5,00 (10,2%) · Plus R$ 10,00 (10,2%)
· Pro R$ 20,00 (11,6%). A crítica pediu "pausado a ~20% do ativo"; **discordo em preço e concordo no
diagnóstico**: o problema não é a tarifa de pausa ser baixa, é a **capacidade reservada** para o pausado
poder voltar. Isso se resolve com razão de commit (§3.3), que é um parâmetro de capacidade — não
inflando o preço de um estado em que o cliente não recebe serviço nenhum. Cobrar 20% por um site
desligado é o tipo de coisa que o cliente percebe e conta para os outros.

### P6 — Upgrade no meio do compromisso: pró-rata imediato ou próximo ciclo? Downgrade a quente?

> **DECISÃO: pró-rata imediato ao minuto, sempre. Não existe "próximo ciclo" — não existe ciclo.
> Downgrade de vCPU e RAM: a quente. Downgrade de disco: só se `usado < nova_quota`, bloqueado na UI com
> a conta aberta ("libere 4,2 GB para poder reduzir").**

Mecanicamente: toda mudança de recurso **fecha a janela de cobrança aberta e abre outra** (`state_windows`,
§2.4). Não há proration a calcular — a janela anterior já é o pró-rata. Essa é a razão de o modelo ser
por janela e não por assinatura: proration é o bug clássico de billing, e aqui ele simplesmente não
existe como conceito.

Efeito no compromisso: a tarifa com desconto sobe/desce, o balde esvazia mais rápido/devagar e
`término_aproximado` é recalculado. A UI **precisa** mostrar isso antes de confirmar:
*"seu compromisso passa a terminar em ~14/03/2027 em vez de 15/08/2027"*.

Caso RAM-para-baixo com uso acima do novo limite: o resize é aceito, mas exige **restart do ambiente**
(não é a quente) e a UI avisa; sem restart o OOM killer decide por nós. `03` §7 já trata `resizing`
cobrando pelo maior dos dois tamanhos durante a janela — ratificado.

### P7 — Saldo residual em cancelamento: dinheiro, crédito ou perda? Quem absorve a taxa do PSP?

> **DECISÃO, por bucket:**

| Bucket | Reembolso em dinheiro | Crédito | Taxa do PSP |
|---|---|---|---|
| **Recarga** não consumida | **Sim**, sempre, no mesmo meio e para o mesmo pagador | Sim, integral | **Cliente**, descontada e demonstrada — exceto dentro dos 7 dias do CDC art. 49, quando **nós absorvemos** |
| **Compromisso** não consumido | **Sim, com recomposição**: `pago − (consumo × tarifa cheia)`, nunca negativo | **Sim, integral, sem recomposição** (é o caminho destacado) | Igual acima |
| **Bônus** (cupom, indicação, cortesia) | **Nunca** | É crédito por natureza | — |

Regra antifraude que acompanha: **reembolso só volta pelo meio e para a titularidade de origem** (mesma
chave Pix do pagador, mesmo cartão), e **nunca** para meio diferente nos primeiros 90 dias. Reembolso é o
vetor de lavagem mais barato que existe num sistema de saldo.

Dentro dos 7 dias com consumo irrelevante (< R$ 20): devolução **integral**, sem deduzir consumo — o
custo de discutir R$ 12 é maior que os R$ 12.

### P8 — Saldo negativo é permitido? Durante a carência, acumula ou congela?

> **DECISÃO: acumula, com teto. Limite de descoberto = `min(R$ 30,00; 72 h de run-rate do tenant)`.
> Atingido o teto, a suspensão acontece na hora, mesmo antes das 72 h. Na suspensão, o medidor **para
> completamente** e a dívida congela no valor exato do momento.**

Congelar durante a carência seria entregar serviço de graça e produzir um extrato incoerente (o site
esteve no ar, o razão diz que não custou nada). Descoberto ilimitado seria criar contas a receber de R$
400 que nunca serão cobradas de alguém que sumiu.

Se a conta for encerrada com saldo negativo: **baixa contábil** (não existe cobrança judicial de R$ 30), e
o CPF/CNPJ entra numa lista interna que exige pré-pagamento em cadastro futuro. Essa lista é **legítimo
interesse** sob a LGPD (art. 7º, IX), mas precisa estar na Política de Privacidade, ter prazo (24 meses) e
ter canal de contestação. Sem isso vira passivo, não proteção.

### P9 — Ordem de consumo dos buckets

> **DECISÃO: bônus → compromisso → recarga.** E, crucialmente: **o desconto do compromisso NÃO depende do
> bucket que está pagando.**

Consome-se primeiro o que não tem valor de resgate (bônus, que ainda expira em 12 meses), depois o
dinheiro que já foi reconhecido como passivo de serviço com desconto travado (compromisso), e por último o
dinheiro 100% reembolsável (recarga). O efeito é que, no cancelamento, **sobra o que é mais fácil de
devolver** — o que reduz atrito exatamente no momento em que o cliente está saindo irritado.

A separação "desconto é atributo do ambiente, bucket é de onde sai o dinheiro" é o que evita o pior bug
possível de UX financeira: o cliente que consome mais rápido que o previsto ver a tarifa **subir no meio
do compromisso** porque o balde esvaziou. Enquanto o compromisso estiver `ativo`, a tarifa é a
descontada, saia o dinheiro de onde sair.

### P10 — Expiração de créditos

> **DECISÃO: recarga em dinheiro NUNCA expira. Bônus expira em 12 meses da concessão. Saldo de
> compromisso: o dinheiro não expira, o desconto expira em `prazo × 1,5`. Dormência de 24 meses sem
> atividade → notificamos e oferecemos devolução; não confiscamos.**

Recarga que expira é dinheiro do cliente retido sem contraprestação. Bônus é liberalidade e pode ter
prazo, desde que o prazo esteja escrito **no momento da concessão** e no extrato (a linha do razão carrega
`expires_at`). Dormência: a alternativa (ficar com o dinheiro) é receita de R$ 200 por ano e risco
reputacional permanente.

### P11 — Cortesias do super admin: dentro ou fora do extrato?

> **DECISÃO: SEMPRE dentro do extrato do cliente, como lançamento visível, com motivo obrigatório e autor
> registrado. Nunca existe consumo que não aparece.**

Três formas, três tipos de lançamento distintos:

| Situação | Lançamento | Efeito no DRE |
|---|---|---|
| Crédito de cortesia comercial | `courtesy_credit` (+) no bucket `bonus`, com motivo e autor | **Desconto sobre a receita** (conta de resultado), nunca receita |
| Crédito por indisponibilidade | `sla_credit` (+) no bucket `bonus`, ligado ao incidente | Desconto sobre a receita, e entra no custo do incidente |
| Interruptor **"não cobrar"** num resize do admin | `price_override` com `discount_bp = 10000` na janela afetada → o extrato mostra a linha de consumo com **valor R$ 0,00** e a etiqueta "cortesia — autorizado por X" | Receita bruta menor, com rastro |

O que **não** existe: janela de consumo sem lançamento. Se o admin "não cobra", o razão registra o
consumo a zero — porque o único jeito de a conciliação fechar é o consumo ter sempre uma linha.

### P12 — NFS-e é emitida na recarga (venda de crédito) ou no consumo (prestação do serviço)?

> **DECISÃO (fora do MVP, mas registrada e refletida no schema): no CONSUMO, por competência mensal.
> Recarga é adiantamento de cliente — receita diferida, não fato gerador de ISS.**
> **Confirmar com contador antes de ligar.** É a única pergunta desta lista que não é de engenharia.

Justificativa: o fato gerador do ISS é a **prestação do serviço** (LC 116/2003), e o serviço aqui é
prestado hora a hora conforme o ambiente roda. Emitir na recarga antecipa tributo sobre serviço não
prestado e cria uma bagunça quando há reembolso (nota já emitida sobre valor devolvido → cancelamento ou
nota de crédito). Emitir por competência mensal agregada por tomador é o que o resto do mercado de cloud
faz e é o que o modelo de dados de §8 sustenta sem migração.

Item da LC 116 provável: **1.03 — processamento, armazenamento ou hospedagem de dados**, tributado no
**domicílio do prestador**. Guardar `service_code_lc116`, `service_code_municipal` e
`municipality_ibge_code` desde hoje (§8).

### P13 — Chargeback depois do crédito consumido

> **DECISÃO:** (a) a contestação **debita de volta** o valor creditado (lançamento `chargeback`, o saldo
> pode ficar negativo, sem teto de descoberto neste caso); (b) a conta vai para `risk_hold` — não cria
> ambiente novo, os existentes rodam até o saldo zerar; (c) perdida a disputa, suspensão e marcação do
> CPF/CNPJ; (d) **exposição máxima de conta nova em cartão: R$ 50 mínimo por transação e R$ 300
> acumulados nos primeiros 30 dias — acima disso, só Pix.**

O ponto estratégico: **Pix é irreversível**. Isso não é só taxa mais barata — é **risco de chargeback
zero**. Num produto pré-pago com consumo imediato (o crédito vira serviço em horas), o cartão é o meio de
pagamento estruturalmente perigoso, e o cartão de conta nova é o mais perigoso de todos. A política acima
custa conversão e economiza fraude; para uma operação de 1 pessoa, é a troca certa.

### P14 — Pix Automático no MVP?

> **DECISÃO: não no MVP. MVP = Pix cobrança (QR dinâmico) manual. v1 = cartão tokenizado com recarga
> automática. v2 = Pix Automático. Mas o modelo `payment_methods` já nasce com `mandate_id` e
> `mandate_status`, para que v2 seja um módulo e não uma migração.**

Pix Automático exige o pagador autorizar um mandato no app do próprio banco — passo fora do nosso
controle, com evasão real, e superfície de integração maior (mandato, ciclo, falha de cobrança,
cancelamento pelo pagador). Não é o que falta no dia 1.

O que falta no dia 1 é **não deixar o cliente ser suspenso por esquecimento**, e isso se resolve mais
barato: aviso de runway em 7 d / 72 h / 24 h, recarga em 1 clique com o valor sugerido pelo run-rate, QR
já pronto na notificação, e o cartão salvo como opção em v1.

### P15 — Preço por região desde o dia 1?

> **DECISÃO: sim. `region` é dimensão de `price_tables` desde a primeira migration, com um único valor
> (`br-se1`).**

Custo hoje: uma coluna e uma chave composta. Custo depois: migrar toda a tabela de preço, todo o
histórico de `usage_rollups` e todo o razão, com dinheiro dentro. É a decisão mais barata da lista.

### P16 — Add-ons cobrados por hora ou por mês? Backup continua cobrando com ambiente pausado?

> **DECISÃO: por hora, como tudo. E a regra geral: `bills_while_paused = true` para add-on cujo custo é
> armazenamento; `false` para add-on cujo custo é compute.**

| Add-on | Preço | `bills_while_paused` | Por quê |
|---|---|---|---|
| Disco extra (R$/GB) | R$ 0,25/GB/mês | **true** | o dado continua ocupando NVMe |
| Backup retenção 30 d | R$ 12,00/mês | **true** | o snapshot continua no bucket |
| Backup off-site | R$ 18,00/mês | **true** | idem, em outro DC |
| IP dedicado | R$ 25,00/mês | **true** | o IP segue reservado no provedor |
| Acelerador / workers extras | por recurso | **false** | não há compute rodando |
| **Restauração de backup** | **R$ 0,00 — sempre** | — | contraposição direta ao Hostoo; é argumento de venda |

### P17 — Tráfego: entra na conta ou é ilimitado com uso justo?

> **DECISÃO: medido sempre, cobrado acima de franquia. Franquia de 1.000 GB/mês por ambiente; excedente a
> R$ 0,15/GB; alerta em 70% da franquia; limite de banda por ambiente na borda; tráfego para o nosso
> próprio bucket de backup nunca é cobrado.**

"Ilimitado" é bomba-relógio confirmada pelo Achado 6.4 da crítica: a cota de banda da VPS é finita, um
único vídeo viral consome a cota do nó e **degrada todos os outros clientes**, e hoje não existe nem
métrica por ambiente nem limite na borda. Franquia de 1 TB é generosa (um site típico usa < 50 GB/mês),
não aparece na conta de 99% da base, e dá o instrumento contratual para tratar o 1%.

O meter `env.egress.gb` é alimentado pelo contador do proxy de borda por ambiente, a cada 5 min, por
delta. É o mesmo pipeline dos demais meters — nenhuma peça nova.

---

## 2. Modelo de metering

### 2.1 O que é medido

| Meter | Unidade | Fonte | Coleta | Cobrança | Pausado |
|---|---|---|---|---|---|
| `env.vcpu.hour` | vCPU-hora | estado do CP (limite alocado, **não** uso real) | 60 s | minuto → fração de hora | não |
| `env.ram.gb_hour` | GB-hora | estado do CP (`MemoryMax` alocado) | 60 s | minuto → fração de hora | não |
| `env.disk.gb_hour` | GB-hora **provisionado** | estado do CP (quota) | 60 s | minuto → fração de hora | **sim** |
| `env.egress.gb` | GB | contador do proxy de borda, por delta | 5 min | GB, acima da franquia mensal | sim (residual) |
| `addon.<key>.hour` | hora | assinatura de add-on no CP | 60 s | minuto → fração de hora | conforme `bills_while_paused` |
| `backup.storage.gb_hour` | GB-hora | inventário do restic | 1 h | minuto → fração de hora | **sim** |
| `db.storage.gb_hour` | GB-hora | inventário do MariaDB/Postgres compartilhado | 1 h | idem | **sim** |

**Decisão estruturante: cobra-se o recurso ALOCADO, não o consumido.** Ninguém cobra "vCPU realmente
usada" em hospedagem — o cliente comprou a reserva, e é a reserva que nos impede de vender aquela RAM para
outro. Cobrar uso real transformaria a conta numa loteria e destruiria a previsibilidade que é metade do
valor do produto. Uso real é métrica de **observabilidade** (gráficos do requisito nº 8), não de billing.
As duas coisas viajam pelo mesmo pipeline e nunca se misturam.

Métricas de uso real que **não** são faturáveis e não podem virar meter sem decisão explícita do dono:
CPU%, RAM residente, IOPS, requisições HTTP, invocações de cron.

### 2.2 Granularidade: coleta 60 s · cobrança minuto · razão hora

```
agente (60 s)  ──►  usage_samples        idempotente por (env, meter, minuto UTC)
                          │
CP state machine ──►  state_windows      append-only, uma janela por (env, forma), sem sobreposição
                          │
    hora cheia + 5 min ──►  usage_rollups   (env, meter, hora) × preço vigente → millicents
                          │
                       ledger_entries    UM lançamento por (env, hora), em CENTAVOS, com carry
                          │
                    account_balances     por (tenant, bucket) — cache, recomputável do zero
```

Por que o razão recebe **um lançamento por ambiente por hora** e não um por meter:
- legibilidade: 33 ambientes × 720 h = 23.760 linhas/mês, e o extrato do cliente lê como extrato bancário;
- auditabilidade preservada: cada linha do razão referencia a hora, e a hora abre em `usage_rollups`
  mostrando `quantidade × tarifa × desconto` por meter;
- suspensão exata: o saldo é preciso ao fim de cada hora, sem precisar de "consumo pendente".

### 2.3 A fonte de verdade é a máquina de estados, não a telemetria

**Regra dura:** o que é faturado sai de `state_windows`, escrita pelo control plane quando ele **comanda**
uma transição e recebe confirmação do agente. `usage_samples` serve para (a) reconciliar, (b) provar ao
cliente em disputa, (c) detectar divergência.

O job de rollup compara os dois. Se divergirem por mais de **2 minutos** na hora, ele:
1. fatura pela `state_windows` (fonte de verdade);
2. grava `usage_rollups.divergence_minutes`;
3. abre alerta na tela de conciliação do admin.

Isso resolve de uma vez os três casos que quebram metering ingênuo:

| Situação | O que acontece com a cobrança | Por quê |
|---|---|---|
| **Agente mudo > 5 min** (processo morto, link caído) | Nada muda ainda: o CP considera a última janela válida e continua faturando por 5 min | Falha de telemetria não é falha de serviço; o site do cliente segue no ar sem o agente |
| **Nó `unreachable` > 5 min** (heartbeat perdido, não é só o agente) | **Congela compute na hora** (`state_windows` fecha com `billable=false`); **disco congela em +60 min**; nada é cobrado retroativamente quando o nó volta | Não conseguimos provar entrega. Cobrar indisponibilidade é o caminho mais curto para chargeback e Procon |
| **Ambiente em `error`** | Congela compute a partir do instante da transição; **disco continua** (o dado está lá) | O cliente não está recebendo serviço, mas o dado dele ocupa NVMe |
| **`provisioning` / `starting` / `migrating` / `archiving`** | Não fatura nada | É o nosso trabalho, não o consumo dele |
| **`resizing`** | Fatura pelo **maior** dos dois tamanhos na janela | Ratifica `03` §7.1; é o pior caso para nós, e é o único defensável |
| **`suspended` por saldo ou por abuso** | **Não fatura nada.** A dívida congela no valor do instante da suspensão | Aprofundar dívida que não será paga é contabilidade de ficção |
| **`paused` pelo cliente** | Só disco (+ add-ons com `bills_while_paused`) | O produto |

Quando o congelamento por nó indisponível ultrapassa o SLA declarado, o job `sla.evaluate` gera
automaticamente um `sla_credit` — sem o cliente pedir. Crédito automático custa menos que ticket.

### 2.4 Idempotência — as chaves exatas

Nenhuma delas é opcional. Todas têm índice `UNIQUE`.

| Objeto | Chave de idempotência (texto exato) |
|---|---|
| Amostra de uso | `environment_id ‖ '\|' ‖ meter ‖ '\|' ‖ to_char(window_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI"Z"')` |
| Rollup horário | PK natural `(environment_id, meter, hour_utc)` |
| Lançamento de consumo | `'usage\|' ‖ environment_id ‖ '\|' ‖ to_char(hour_utc,'YYYY-MM-DD"T"HH24"Z"')` |
| Lançamento de recarga | `'topup\|' ‖ provider ‖ '\|' ‖ provider_ref` |
| Lançamento de reembolso | `'refund\|' ‖ refund_id` |
| Lançamento de chargeback | `'chargeback\|' ‖ provider ‖ '\|' ‖ provider_ref ‖ '\|' ‖ dispute_id` |
| Ajuste manual do admin | `'adj\|' ‖ adjustment_id` (uuid gerado na UI, enviado no request — protege o duplo-clique) |
| Evento de webhook do PSP | PK `(provider, event_id)` em `payment_events` |
| Liquidação (`host.payments.settle`) | `(provider, provider_ref, event_id)` |
| Criação de cobrança no PSP | `(gateway_installation_id, idempotency_key)`, com `idempotency_key = 'topup|' ‖ topup_id` |

**Resolução de conflito em `usage_samples`: primeiro que escreve vence, e divergência de quantidade gera
alerta.** `ON CONFLICT DO NOTHING`, nunca `DO UPDATE`. Se o agente reenvia a mesma janela com quantidade
diferente, significa que ele recalculou — e sobrescrever silenciosamente uma quantidade já faturada é bug
de dinheiro, não detalhe.

### 2.5 Razão append-only — como é garantido

Três camadas, porque uma só sempre falha:

1. **Permissão**: `REVOKE UPDATE, DELETE ON billing.ledger_entries FROM vp_app;` — a aplicação só tem
   `INSERT` e `SELECT`.
2. **Trigger**: `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION` — pega migration, script de manutenção e
   psql do dono às 2 h da manhã.
3. **Verificação diária**: job `ledger.verify` recomputa `SUM(amount_cents)` por `(tenant, bucket)` desde
   o início e compara com `account_balances`. Divergência de **1 centavo** aciona alerta de severidade
   crítica e **bloqueia novos débitos naquele tenant** até intervenção. É dinheiro; não é log.

Correção nunca é `UPDATE`. É um lançamento `adjustment` novo, com `reason`, `actor_user_id` e
`reverses_entry_id` apontando para o lançamento errado.

**Sub-centavo sem drift:** o preço unitário é `numeric(18,10)` em **centavos por unidade-hora**; o rollup
acumula em `bigint` de **millicents** (1 centavo = 1.000 mc); o lançamento do razão arredonda o total da
hora para centavo (HALF_UP) e guarda o resto em `environments_billing.carry_millicents`, somado na hora
seguinte. Resultado: erro acumulado **exatamente zero**, tudo inteiro, nenhum float. (Sem o carry, um
plano de R$ 0,068056/h acumularia até R$ 3,60/mês de erro de arredondamento — em ambos os sentidos.)

### 2.6 Como o cliente audita o próprio saldo

Quatro instrumentos, todos obrigatórios no MVP:

1. **Extrato = razão completo**, uma linha por lançamento **inclusive os débitos horários**, com coluna
   **`Saldo após`**. Agrupado por dia por padrão, expansível para hora. Filtro por tipo/ambiente/período,
   exportação **CSV e PDF**.
2. **Drill-down de qualquer linha de consumo** para o detalhe da hora: `meter · quantidade · tarifa
   unitária · desconto · valor`, mais os minutos ativos e pausados. É onde se responde "por que essa hora
   custou R$ 0,09 e a outra R$ 0,07".
3. **Botão "Conferir saldo"**: recomputa `Σ lançamentos` do zero, mostra `Σ = saldo exibido ✓` com o
   número dos dois lados e o horário da conferência. Custa 40 linhas de código e mata a classe de ticket
   "acho que vocês cobraram errado".
4. **Página `/financeiro/regras`**, linkada de todo alerta de saldo, com a tabela de §5 escrita
   literalmente: prazos, o que acontece com os dados, o que é reversível.

Invariantes que o billing tem de garantir (ratificando `01` §A.8): `saldo = Σ lançamentos` sempre;
nenhum lançamento é alterado ou apagado; janelas de consumo de um mesmo `(ambiente, forma)` nunca se
sobrepõem; webhook de PSP é idempotente; toda alteração de recurso — do cliente **ou** do admin — fecha
as janelas abertas antes de aplicar.

### 2.7 Volume (dimensionamento real, não hipotético)

Com **33 ambientes** e 6 meters ativos: 33 × 6 × 60 × 24 × 30 = **8,5 M amostras/mês**. Com retenção de
95 dias em partição mensal e `quantity numeric(18,6)`, são ~1,2 GB/mês de tabela. Postgres engole sem
suar. Rollups: 33 × 6 × 720 = **142 k linhas/mês**. Razão: **23,8 k linhas/mês**.
Nada disso justifica Lago, OpenMeter, ClickHouse ou Kafka. Ratifica `02` §4.4.

---

## 2.8 DDL — tabelas de uso e de razão financeira

```sql
-- ═══════════════════════════════════════════════════════════════════════════════
-- VelozPanel · schema billing · PostgreSQL 16+
-- Convenções:
--   · TODO valor monetário fechado: bigint de CENTAVOS  (amount_cents)
--   · Acumulador sub-centavo:        bigint de MILLICENTS (1 centavo = 1000 mc)
--   · Preço unitário:                numeric(18,10) em CENTAVOS por unidade-hora
--   · Percentual:                    int em BASIS POINTS (2200 = 22,00%)
--   · Nenhum float, nenhum double, nenhum numeric para valor fechado.
--   · Todo horário em timestamptz, todas as janelas alinhadas em UTC.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE SCHEMA billing;
SET search_path = billing, core, public;

-- ─── Catálogo de meters (populado pelos manifestos de módulo + core) ───────────
CREATE TABLE meters (
  key              text PRIMARY KEY,             -- 'env.ram.gb_hour'
  unit             text NOT NULL,                -- 'gb-hour','vcpu-hour','gb','hour'
  aggregation      text NOT NULL CHECK (aggregation IN ('duration','delta','max','sum')),
  bills_while_paused boolean NOT NULL DEFAULT false,
  provided_by      text NOT NULL DEFAULT 'core', -- 'core' ou slug do módulo
  visible_to_client boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── Tabela de preço unitário, VERSIONADA e por REGIÃO (P15) ──────────────────
CREATE TABLE price_tables (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region       text NOT NULL,                     -- 'br-se1'
  version      int  NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to   timestamptz,                     -- NULL = vigente
  published_by uuid REFERENCES core.users(id),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (region, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX price_tables_current ON price_tables (region) WHERE effective_to IS NULL;

CREATE TABLE price_items (
  price_table_id uuid NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
  meter          text NOT NULL REFERENCES meters(key),
  -- preço em CENTAVOS por unidade-hora; ex.: RAM R$32,00/GB/mês => 3200/720 = 4,4444444444
  unit_price_cents numeric(18,10) NOT NULL CHECK (unit_price_cents >= 0),
  -- franquia mensal isenta (ex.: egress 1000 GB); NULL = sem franquia
  free_allowance numeric(18,6),
  paused_unit_price_cents numeric(18,10),         -- NULL = não cobra pausado
  PRIMARY KEY (price_table_id, meter)
);

-- ─── Degraus nomeados: PRESET de recursos. O preço é DERIVADO, nunca digitado ──
CREATE TABLE plan_presets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text UNIQUE NOT NULL,            -- 'veloz-light'
  name           text NOT NULL,
  region         text NOT NULL,
  vcpu           numeric(6,3) NOT NULL,
  ram_mb         int NOT NULL,
  disk_gb        int NOT NULL,
  sort_order     int NOT NULL DEFAULT 0,
  visible        boolean NOT NULL DEFAULT true,   -- Turbo/Max: false até haver nó >= 32 GB
  max_ram_mb_per_node_pct int NOT NULL DEFAULT 40,-- guarda de capacidade (§3.3)
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Tarifa EFETIVA de um ambiente, versionada. É o que faz o requisito nº 9 caber ──
CREATE TABLE environment_pricing (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES core.environments(id) ON DELETE RESTRICT,
  tenant_id      uuid NOT NULL,
  price_table_id uuid NOT NULL REFERENCES price_tables(id),   -- grandfathering
  plan_preset_id uuid REFERENCES plan_presets(id),            -- NULL = 'Personalizado'
  discount_bp    int  NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  discount_source text NOT NULL DEFAULT 'none'
                 CHECK (discount_source IN ('none','commitment','coupon','admin_courtesy')),
  commitment_id  uuid,
  effective_from timestamptz NOT NULL,
  effective_to   timestamptz,
  created_by     uuid REFERENCES core.users(id),
  reason         text,                                        -- obrigatório se created_by é admin
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX env_pricing_current ON environment_pricing (environment_id) WHERE effective_to IS NULL;
CREATE INDEX ON environment_pricing (tenant_id, effective_from DESC);

-- ─── Estado faturável ao longo do tempo. FONTE DE VERDADE do faturamento ──────
-- É o "LançamentoDeConsumo" de 01 §A.8, escrito pela máquina de estados do CP.
CREATE TABLE state_windows (
  id             bigserial,
  tenant_id      uuid NOT NULL,
  environment_id uuid NOT NULL,
  node_id        uuid,
  form           text NOT NULL CHECK (form IN ('vcpu','ram','disk','addon','egress')),
  meter          text NOT NULL REFERENCES meters(key),
  addon_key      text,                                  -- só quando form='addon'
  quantity       numeric(18,6) NOT NULL,                -- 1.0 vCPU, 1.0 GB, 20 GB...
  env_state      text NOT NULL,                         -- active|paused|error|suspended|resizing...
  billable       boolean NOT NULL,
  unbillable_reason text,                               -- 'node_unreachable','error','suspended',...
  origin         text NOT NULL CHECK (origin IN ('client','admin','system','provision')),
  opened_at      timestamptz NOT NULL,
  closed_at      timestamptz,                           -- NULL = janela aberta
  opened_by_job  uuid,
  PRIMARY KEY (id, opened_at)
) PARTITION BY RANGE (opened_at);
CREATE INDEX ON state_windows (environment_id, form, opened_at DESC);
CREATE INDEX ON state_windows (environment_id, form) WHERE closed_at IS NULL;
-- Invariante 3 de 01 §A.8: no máximo UMA janela aberta por (ambiente, forma, addon_key).
CREATE UNIQUE INDEX state_windows_one_open
  ON state_windows (environment_id, form, COALESCE(addon_key,'')) WHERE closed_at IS NULL;

-- ─── Amostras cruas do agente. Reconciliação e prova, NÃO fonte de verdade ────
CREATE TABLE usage_samples (
  id             bigserial,
  tenant_id      uuid NOT NULL,
  environment_id uuid NOT NULL,
  node_id        uuid NOT NULL,
  meter          text NOT NULL,
  quantity       numeric(18,6) NOT NULL,
  unit           text NOT NULL,
  env_state      text NOT NULL,
  window_start   timestamptz NOT NULL,             -- alinhado ao minuto UTC
  window_end     timestamptz NOT NULL,
  -- '<env_id>|<meter>|2026-08-20T14:37Z'
  idempotency_key text NOT NULL,
  observed_at    timestamptz NOT NULL DEFAULT now(),
  received_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, window_start)
) PARTITION BY RANGE (window_start);
CREATE UNIQUE INDEX ON usage_samples (idempotency_key, window_start);
CREATE INDEX ON usage_samples (environment_id, meter, window_start);
CREATE INDEX ON usage_samples (node_id, window_start);

-- ─── Rollup horário, JÁ PRECIFICADO. Base do extrato detalhado ────────────────
CREATE TABLE usage_rollups (
  tenant_id        uuid NOT NULL,
  environment_id   uuid NOT NULL,
  meter            text NOT NULL REFERENCES meters(key),
  hour_utc         timestamptz NOT NULL,            -- date_trunc('hour', ...)
  billable_minutes int  NOT NULL CHECK (billable_minutes BETWEEN 0 AND 60),
  quantity         numeric(18,6) NOT NULL,          -- ex.: GB × (minutos/60)
  unit_price_cents numeric(18,10) NOT NULL,
  discount_bp      int NOT NULL DEFAULT 0,
  gross_millicents bigint NOT NULL,
  discount_millicents bigint NOT NULL DEFAULT 0,
  amount_millicents   bigint NOT NULL,              -- gross - discount
  price_table_id   uuid NOT NULL REFERENCES price_tables(id),
  env_pricing_id   uuid NOT NULL REFERENCES environment_pricing(id),
  divergence_minutes int NOT NULL DEFAULT 0,        -- |state_windows - usage_samples|
  ledger_entry_id  uuid,                            -- NULL enquanto não lançado
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, meter, hour_utc)
);
CREATE INDEX ON usage_rollups (tenant_id, hour_utc);
CREATE INDEX ON usage_rollups (hour_utc) WHERE ledger_entry_id IS NULL;
CREATE INDEX ON usage_rollups (hour_utc) WHERE divergence_minutes > 2;

-- ═══ RAZÃO FINANCEIRO — APPEND-ONLY, A FONTE DE VERDADE DO DINHEIRO ═══════════
CREATE TYPE ledger_kind AS ENUM (
  'usage',            -- débito horário de consumo            (-)
  'topup',            -- recarga paga                          (+)
  'commitment',       -- compra de compromisso                 (+ no bucket commitment)
  'bonus',            -- cupom / indicação                     (+ no bucket bonus)
  'courtesy_credit',  -- cortesia comercial do admin           (+)
  'sla_credit',       -- crédito por indisponibilidade         (+)
  'refund',           -- devolução ao cliente                  (-)
  'chargeback',       -- contestação de cartão                 (-)
  'expiry',           -- expiração de bônus                    (-)
  'adjustment',       -- correção manual auditada              (±)
  'transfer'          -- movimentação entre buckets            (±, soma zero)
);
CREATE TYPE ledger_bucket AS ENUM ('recharge','commitment','bonus');

CREATE TABLE ledger_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES core.tenants(id),
  seq              bigint GENERATED ALWAYS AS IDENTITY,   -- ordem global imutável
  kind             ledger_kind NOT NULL,
  bucket           ledger_bucket NOT NULL,
  amount_cents     bigint NOT NULL,                       -- assinado: (+) crédito, (-) débito
  balance_after_cents bigint NOT NULL,                    -- saldo do BUCKET após este lançamento
  total_balance_after_cents bigint NOT NULL,              -- saldo TOTAL após este lançamento
  currency         char(3) NOT NULL DEFAULT 'BRL',
  environment_id   uuid REFERENCES core.environments(id),
  description      text NOT NULL,
  -- referências (exatamente uma preenchida, conforme kind)
  usage_hour_utc   timestamptz,
  payment_id       uuid,
  commitment_id    uuid,
  refund_id        uuid,
  coupon_id        uuid,
  reverses_entry_id uuid REFERENCES ledger_entries(id),
  -- rastro
  actor_type       text NOT NULL CHECK (actor_type IN ('system','client','admin','module')),
  actor_user_id    uuid REFERENCES core.users(id),
  reason           text,                                  -- obrigatório se actor_type='admin'
  expires_at       timestamptz,                           -- só para bucket='bonus'
  -- fiscal (§8) — preenchido hoje, usado quando a NFS-e entrar
  competence       date,                                  -- primeiro dia do mês de competência
  revenue_recognized_at timestamptz,                      -- = created_at para kind='usage'
  deferred         boolean NOT NULL DEFAULT false,        -- true para topup/commitment
  nfse_id          uuid,
  idempotency_key  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_type <> 'admin' OR reason IS NOT NULL),
  CHECK (amount_cents <> 0 OR kind = 'adjustment')
);
CREATE UNIQUE INDEX ON ledger_entries (idempotency_key);
CREATE INDEX ON ledger_entries (tenant_id, created_at DESC);
CREATE INDEX ON ledger_entries (tenant_id, seq DESC);
CREATE INDEX ON ledger_entries (environment_id, usage_hour_utc);
CREATE INDEX ON ledger_entries (tenant_id, competence) WHERE kind = 'usage';
CREATE INDEX ON ledger_entries (expires_at) WHERE bucket = 'bonus' AND expires_at IS NOT NULL;

-- Append-only, camada 2 (a camada 1 é REVOKE UPDATE,DELETE; a camada 3 é o job de verificação)
CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing.ledger_entries e append-only (tentativa de % no id %)',
        TG_OP, COALESCE(OLD.id::text,'?');
END $$;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
-- exceção controlada: só o job fiscal pode carimbar nfse_id, via coluna em tabela lateral:
CREATE TABLE ledger_fiscal_link (
  ledger_entry_id uuid PRIMARY KEY REFERENCES ledger_entries(id),
  nfse_id         uuid NOT NULL,
  linked_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── Saldo por bucket: CACHE recomputável, atualizado na MESMA transação ──────
CREATE TABLE account_balances (
  tenant_id     uuid NOT NULL REFERENCES core.tenants(id),
  bucket        ledger_bucket NOT NULL,
  balance_cents bigint NOT NULL DEFAULT 0,
  last_entry_seq bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, bucket)
);
-- carry sub-centavo por ambiente, para arredondamento com drift zero
CREATE TABLE environment_billing_state (
  environment_id   uuid PRIMARY KEY REFERENCES core.environments(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL,
  carry_millicents bigint NOT NULL DEFAULT 0,
  last_billed_hour timestamptz,
  egress_gb_month  numeric(18,6) NOT NULL DEFAULT 0,   -- zerado no dia 1
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── Compromisso (P3, P4, §4) ─────────────────────────────────────────────────
CREATE TABLE commitments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES core.tenants(id),
  environment_id     uuid REFERENCES core.environments(id),  -- NULL = conta inteira
  term_months        int  NOT NULL CHECK (term_months IN (3,6,12)),
  discount_bp        int  NOT NULL CHECK (discount_bp BETWEEN 0 AND 2500),  -- teto 25% (B8)
  paid_cents         bigint NOT NULL,
  list_value_cents   bigint NOT NULL,                        -- sem desconto, para recomposição
  dedicated_balance_cents bigint NOT NULL,                   -- passivo remanescente
  started_at         timestamptz NOT NULL,
  discount_expires_at timestamptz NOT NULL,                  -- started_at + term*1.5 (mín. 6 m)
  estimated_end_at   timestamptz,                            -- recalculado; NUNCA promessa
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','exhausted','expired','canceled')),
  canceled_at        timestamptz,
  cancel_settlement_cents bigint,
  terms_version      text NOT NULL,
  payment_id         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON commitments (tenant_id, status);
CREATE INDEX ON commitments (status, discount_expires_at) WHERE status = 'active';

-- ─── Pagamentos: o CORE registra, o MÓDULO só informa (§7) ────────────────────
CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES core.tenants(id),
  purpose        text NOT NULL CHECK (purpose IN ('topup','commitment','addon_oneoff')),
  method         text NOT NULL,                     -- pix | card | boleto | wallet | manual
  provider       text NOT NULL,                     -- slug do módulo: 'asaas','pix','fake'
  gateway_installation_id uuid NOT NULL,
  provider_ref   text,                              -- id da cobrança no PSP
  idempotency_key text NOT NULL,                    -- 'topup|<payment_id>'
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  received_cents bigint,                            -- o que REALMENTE entrou (pode divergir)
  fee_cents      bigint NOT NULL DEFAULT 0,         -- taxa do PSP, para conciliação e DRE
  currency       char(3) NOT NULL DEFAULT 'BRL',
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','authorized','succeeded','failed',
                                   'expired','canceled','refunded','partially_refunded','disputed')),
  failure_code   text,
  checkout_url   text,
  pix_qrcode     text,
  pix_copia_cola text,
  expires_at     timestamptz,
  paid_at        timestamptz,
  settled_at     timestamptz,                       -- quando o dinheiro caiu na nossa conta
  ledger_entry_id uuid REFERENCES ledger_entries(id),
  orphan         boolean NOT NULL DEFAULT false,    -- entrou dinheiro sem cobrança nossa
  raw            jsonb,                             -- sem PAN, sem CVV, sem token bruto
  deferred       boolean NOT NULL DEFAULT true,     -- §8: recarga = receita diferida
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref),
  UNIQUE (gateway_installation_id, idempotency_key)
);
CREATE INDEX ON payments (tenant_id, created_at DESC);
CREATE INDEX ON payments (status, expires_at) WHERE status = 'pending';
CREATE INDEX ON payments (settled_at) WHERE status = 'succeeded';

-- ─── Eventos de webhook: deduplicação e reprocessamento ───────────────────────
CREATE TABLE payment_events (
  provider     text NOT NULL,
  event_id     text NOT NULL,
  provider_ref text,
  event_type   text NOT NULL,
  payload_hash text NOT NULL,                       -- sha256 do corpo cru
  raw_body     bytea,                               -- retido 30 d, para reprocessar/defender
  signature_ok boolean NOT NULL,
  processed_at timestamptz,
  process_result text,                              -- 'settled','duplicate','orphan','ignored','error'
  error        text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX ON payment_events (received_at DESC);
CREATE INDEX ON payment_events (provider_ref);
CREATE INDEX ON payment_events (processed_at) WHERE processed_at IS NULL;

CREATE TABLE refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES core.tenants(id),
  payment_id      uuid REFERENCES payments(id),
  commitment_id   uuid REFERENCES commitments(id),
  requested_cents bigint NOT NULL,
  policy_cents    bigint NOT NULL,                  -- o que a política calcula
  approved_cents  bigint,
  form            text NOT NULL CHECK (form IN ('cash','credit')),
  psp_fee_cents   bigint NOT NULL DEFAULT 0,
  absorbed_by     text NOT NULL DEFAULT 'client' CHECK (absorbed_by IN ('client','company')),
  cdc_7d          boolean NOT NULL DEFAULT false,   -- art. 49 CDC
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','approved','rejected','processing','done','failed')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES core.users(id),
  decided_at      timestamptz,
  provider_ref    text,
  processed_at    timestamptz
);

-- ─── Ciclo de vida do inadimplente (§5) ───────────────────────────────────────
CREATE TABLE dunning_states (
  tenant_id        uuid PRIMARY KEY REFERENCES core.tenants(id),
  stage            text NOT NULL DEFAULT 'normal'
                   CHECK (stage IN ('normal','warn_7d','warn_72h','warn_24h',
                                    'grace','suspended','archived','deleted')),
  stage_since      timestamptz NOT NULL DEFAULT now(),
  next_action_at   timestamptz,
  overdraft_limit_cents bigint NOT NULL DEFAULT 3000,
  runway_hours     numeric(10,2),
  notices_sent     jsonb NOT NULL DEFAULT '[]',      -- [{stage,channel,at,delivery_id}]
  hold_reason      text,                             -- 'open_billing_ticket','legal','manual'
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON dunning_states (next_action_at) WHERE stage <> 'normal';

-- ─── Cupons (resumo; detalhe em 01 §A.8) ──────────────────────────────────────
CREATE TABLE coupons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          citext UNIQUE NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('bonus_credit','percent_off')),
  value_cents   bigint,
  percent_bp    int CHECK (percent_bp IS NULL OR percent_bp <= 2500),  -- teto 25% (B8)
  max_uses_global int, max_uses_per_tenant int NOT NULL DEFAULT 1,
  first_purchase_only boolean NOT NULL DEFAULT false,
  bonus_expires_days int NOT NULL DEFAULT 365,
  valid_from timestamptz NOT NULL, valid_to timestamptz,
  campaign text, created_by uuid REFERENCES core.users(id),
  active boolean NOT NULL DEFAULT true
);

-- ─── Custo do nó: sem isto não existe margem por nó (§9) ──────────────────────
CREATE TABLE node_costs (
  node_id        uuid NOT NULL REFERENCES core.nodes(id),
  effective_from date NOT NULL,
  effective_to   date,
  provider       text NOT NULL,
  monthly_cost_cents bigint NOT NULL,
  bandwidth_quota_gb int,                            -- Achado 6.4 da crítica
  allocatable_ram_mb int NOT NULL,
  commit_ratio_bp  int NOT NULL DEFAULT 13000,       -- 1,30× (§3.3)
  PRIMARY KEY (node_id, effective_from)
);
```

**Saem do MVP** (ratificando `01` §A.10 item 10 e a decisão B10): `core.invoices` e `core.invoice_items`.
Não existe fatura num modelo pré-pago. O "Demonstrativo mensal" é um **relatório derivado do razão** —
`SELECT ... FROM ledger_entries WHERE kind='usage' AND competence = $1` — e o mesmo relatório vira a base
da NFS-e quando ela entrar. Manter `invoices` no MVP é construir um segundo lugar onde o dinheiro mora, e
dois lugares sempre divergem.

---

## 3. Economia e preço — a conta refeita com os números reais do Ciclo 2

> ⚠️ **§3.3 a §3.9 foram calculados com 3 nós de produção e estão SUPERADOS pelo ADENDO 3.**
> O método, a estrutura de custo unitário (§3.2, §3.4) e o raciocínio continuam válidos; os totais
> de capacidade, receita, ponto de equilíbrio, margem e teto de desconto foram **refeitos em §3.10**,
> que é a seção a citar. As duas versões ficam no documento de propósito: a comparação entre elas é
> a medida exata do que custou perder um nó de produção.

> Toda premissa desta seção é rastreável a uma linha do ADENDO 1 §B, da crítica do Ciclo 1 ou a um
> preço público de mercado em agosto/2026. Onde for estimativa minha, está marcado **[EST]**.

### 3.1 Custo real de VPS — Brasil × exterior (ago/2026)

| Origem | Configuração | Preço/mês | R$/mês (câmbio USD 5,60 · EUR 6,20) | RTT até São Paulo |
|---|---|---:|---:|---|
| **Brasil — provedor nacional** | 8 vCPU · 16 GB · 200 GB NVMe | R$ 250–400 | **R$ 250–400** | 5–20 ms |
| Brasil — hyperscaler nacional (Magalu/UOL) | 8 vCPU · 16 GB · 200 GB | R$ 400–600 | R$ 400–600 | 5–15 ms |
| Hetzner (DE) CPX41 | 8 vCPU · 16 GB · 240 GB | € 27,50 | **R$ 171** | ~200 ms |
| Hetzner (US-East) | 8 vCPU · 16 GB · 240 GB | US$ 32 | R$ 179 | ~130 ms |
| Contabo (DE/US) | 8 vCPU · 24 GB · 200 GB NVMe | US$ 17 | **R$ 95** | 130–200 ms |
| **Dedicado BR** (referência de escala) | Xeon 8c · **64 GB** · 2 TB NVMe | R$ 800–1.400 | **R$ 1.000** [EST] | 5–20 ms |

**Premissa adotada: R$ 250/mês por nó de 16 GB no Brasil** (VPS 1 e VPS 2 já contratadas; VPS 3 no mesmo
patamar). Control plane: VPS 2 vCPU / 4 GB, **R$ 80/mês**.

**Decisão sobre exterior:** ambiente de cliente **não** vai para fora do Brasil. 130–200 ms de RTT
destroem TTFB de WordPress (que faz 10–40 round-trips por página) e o mercado alvo é BR. O exterior entra
**só** como destino de backup off-site (Contabo/Hetzner Storage Box a fração do preço) e, eventualmente,
como réplica fria do control plane. Isso está de acordo com `02` §9.

### 3.2 Reserva de host e RAM alocável (ratifica o Achado 0.2 da crítica)

| Item | RAM |
|---|---:|
| Kernel + systemd + sshd + journald | 500 MB |
| Agente + coletor de métricas | 150 MB |
| Proxy de borda | 50 MB |
| MariaDB compartilhado (buffer pool 256 MB) | 450 MB |
| PostgreSQL compartilhado (shared_buffers 256 MB) | 350 MB |
| Margem de segurança (page cache, picos) | 1.000 MB |
| **Reserva do host** | **2.500 MB** |
| **Alocável a ambientes (85% de 13,5 GB)** | **11.500 MB** |

### 3.3 Densidade: RAM limita o ATIVO, disco limita o PROVISIONADO

Este é o achado que muda a conta em relação ao Ciclo 1. **Ambiente pausado não consome RAM.** Portanto o
nó comporta mais ambientes *provisionados* do que *ativos simultâneos* — e é exatamente esse delta que
torna o modelo por hora economicamente possível numa VPS de 16 GB.

**Mix de planos assumido** (puxado para baixo pela realidade do Achado 6.2 — 512 MB não roda WooCommerce):

| Plano | Fatia | RAM | Disco provisionado |
|---|---:|---:|---:|
| Veloz Start (512 MB) | 30% | 0,5 GB | 10 GB |
| Veloz Light (1 GB) | 40% | 1,0 GB | 20 GB |
| Veloz Plus (2 GB) | 20% | 2,0 GB | 40 GB |
| Veloz Pro (4 GB) | 10% | 4,0 GB | 80 GB |
| **Média ponderada** | | **1,35 GB** | **27 GB** (uso real ~8 GB [EST]) |

**Razão de commit = 1,30×** (política inicial, conservadora): provisionado ≤ 11,5 GB × 1,30 = **14,95 GB**
por nó → **11 ambientes por nó** → **33 ambientes na frota de 3 nós**.

Sanidade cruzada:
- **RAM ativa:** com 70% ativos, 7,7 × 1,35 = 10,4 GB < 11,5 GB. Folga de 9%. ✔
- **Disco:** 200 GB − 40 GB (host, imagens, bancos) = 160 GB. 11 × 8 GB de uso real = 88 GB. Folga de 45%.
  Provisionado seria 297 GB (overcommit de disco de 1,9× — aceitável com quota fina e alerta em 80%). ✔
- **Se todos os 11 ligarem ao mesmo tempo:** 14,95 GB contra 11,5 GB alocáveis → **falta 3,45 GB**.
  Por isso existe **admission control**: acima de 85% de RAM ativa no nó, o `start` entra em fila
  ("retomando em instantes") e o scheduler tenta outro nó. Isso precisa ser um SLO medido, não uma
  esperança — **meta: < 0,5% dos `start` enfileirados por mais de 60 s**.

**Governança da razão de commit** (regra operacional, não opinião):

| Fração ativa média (4 semanas) | Ação |
|---|---|
| > 80% | baixar commit para 1,15× e parar de vender no nó |
| 55–80% | manter 1,30× |
| 45–55% | subir para 1,50× (vende 13/nó) |
| < 45% | subir para 1,50× **e** reprecificar a tarifa de pausa em contratos novos |

**Corte de catálogo (decisão B6):** `Veloz Turbo` (8 GB) ocupa 70% da RAM alocável de um nó e `Veloz Max`
(16 GB) não cabe. Ambos saem do catálogo (`plan_presets.visible = false`) até existir nó de ≥ 32 GB.
Guarda no código: nenhum preset pode passar de **40% da RAM alocável do menor nó**.

### 3.4 Tabela de preço unitário e planos derivados

**Preços unitários v1 · região `br-se1` · vigência 01/09/2026:**

| Meter | Preço mensal de referência | Preço por hora (÷ 720) | Em centavos/unidade-hora |
|---|---:|---:|---:|
| `env.vcpu.hour` | R$ 12,00 / vCPU | R$ 0,0166667 | 1,6666666667 |
| `env.ram.gb_hour` | R$ 32,00 / GB | R$ 0,0444444 | 4,4444444444 |
| `env.disk.gb_hour` | R$ 0,25 / GB | R$ 0,0003472 | 0,0347222222 |
| `env.egress.gb` | R$ 0,15 / GB acima de 1.000 GB/mês | — | 15,0000000000 |
| `backup.storage.gb_hour` | R$ 0,20 / GB | R$ 0,0002778 | 0,0277777778 |

**Planos (preço CALCULADO, nunca digitado — `01` §A.4.3):**

| Plano | vCPU | RAM | Disco | Conta | **R$/mês** | **R$/hora ativo** | **R$/hora pausado** | R$/mês pausado |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| **Veloz Start** | 1 | 512 MB | 10 GB | 12,00 + 16,00 + 2,50 | **30,50** | 0,0423611 | 0,0034722 | 2,50 |
| **Veloz Light** | 1 | 1 GB | 20 GB | 12,00 + 32,00 + 5,00 | **49,00** | 0,0680556 | 0,0069444 | 5,00 |
| **Veloz Plus** | 2 | 2 GB | 40 GB | 24,00 + 64,00 + 10,00 | **98,00** | 0,1361111 | 0,0138889 | 10,00 |
| **Veloz Pro** | 2 | 4 GB | 80 GB | 24,00 + 128,00 + 20,00 | **172,00** | 0,2388889 | 0,0277778 | 20,00 |
| ~~Veloz Turbo~~ | 4 | 8 GB | 160 GB | 48 + 256 + 40 | ~~344,00~~ | — | — | **fora do catálogo** |
| ~~Veloz Max~~ | 6 | 16 GB | 320 GB | 72 + 512 + 80 | ~~664,00~~ | — | — | **fora do catálogo** |

Diferenças para a tabela de `01` §A.4.5, e por quê:
- **Start R$ 30,50** (era 29,90): o preço passa a ser derivado dos unitários; centavo redondo some, e isso
  é o preço de o requisito nº 9 funcionar. **Ganho colateral:** ficamos abaixo dos R$ 35,00 do Hostoo com
  o dobro do disco (10 GB × 15 GB… e 512 MB contra 512 MB).
- **Plus R$ 98,00** (era 89,90) e **Pro R$ 172,00** (era 159,90): os preços antigos estavam abaixo do custo
  unitário implícito. Ajustar agora é gratuito; ajustar com 40 clientes na base custa *grandfathering*.
- **Turbo e Max saem.** Não é preço, é física: não cabem no nó.
- **Add-ons:** mantidos de `01` §A.4.5, com `bills_while_paused` conforme P16, e **restauração de backup
  sempre R$ 0,00**.

**Recarga mínima R$ 50,00** (sugestões R$ 100 / R$ 200 / R$ 500, com "≈ N dias" ao lado de cada uma).
Motivo aritmético: Pix Asaas custa R$ 1,99 fixo por recarga → 9,95% numa recarga de R$ 20, **3,98% em R$
50**, **1,99% em R$ 100**, 0,40% em R$ 500. A crítica pediu mínimo de R$ 100; **discordo por meio degrau**:
R$ 100 é barreira de entrada para um plano de R$ 30,50, e o efeito prático se consegue tornando **R$ 100
o valor pré-selecionado**. Média esperada de recarga: R$ 120 → **taxa efetiva de 1,7%**.

### 3.5 Estrutura de custo da frota (3 nós, mensal)

| Item | R$/mês | Natureza |
|---|---:|---|
| 3 VPS de 16 GB × R$ 250 | 750 | fixo por nó |
| Control plane (2 vCPU / 4 GB) | 80 | fixo |
| Backup object storage (33 × 4 GiB × R$ 0,10) | 13 | variável por ambiente |
| DNS, TLS, e-mail transacional, monitoramento externo | 50 | fixo |
| Helpdesk (Crisp/Chatwoot Cloud) | 130 | fixo |
| Domínio, certificados, miscelânea | 10 | fixo |
| **Custo fixo total** | **R$ 1.033** | |
| Taxa de PSP | 1,7% da receita | variável |
| *(fora do caixa, mas real)* suporte: 22 clientes × 0,5 ticket × 25 min = 4,6 h/mês a R$ 80/h | *367* | **custo de oportunidade do dono** |

**Custo unitário derivado:** R$ 830 (VPS + CP) ÷ 44,85 GB provisionáveis (3 × 14,95) = **R$ 18,50 por GB
de RAM provisionado por mês**. Custo de infra do ambiente médio (1,35 GB) = **R$ 24,98/mês**.

### 3.6 Margem por cenário de ocupação — a conta que decide se isso é negócio

Receita média por ambiente: **ativo R$ 65,55/mês** · **pausado R$ 6,75/mês** (mix de §3.3).
`Receita = N × [A × 65,55 + (1−A) × 6,75] × 0,983`, onde `A` = fração média de horas ativas.

**Ocupação 25% (8 ambientes vendidos) — é a fase de validação do ADENDO §B:**

| A (fração ativa) | Receita | Custo fixo | **Margem bruta** |
|---:|---:|---:|---:|
| 100% | R$ 515 | R$ 1.033 | **− R$ 518** |
| 70% | R$ 377 | R$ 1.033 | **− R$ 656** |
| 50% | R$ 285 | R$ 1.033 | **− R$ 748** |

**Ocupação 50% (17 ambientes):**

| A | Receita | Custo fixo | **Margem bruta** |
|---:|---:|---:|---:|
| 100% | R$ 1.095 | R$ 1.033 | **+ R$ 62** |
| 70% | R$ 801 | R$ 1.033 | **− R$ 232** |
| 50% | R$ 604 | R$ 1.033 | **− R$ 429** |

**Ocupação 100% (33 ambientes — o teto físico da frota):**

| A | Receita | Custo fixo | **Margem bruta** | Margem líq. com suporte a R$ 80/h |
|---:|---:|---:|---:|---:|
| 100% *(impossível: exige ≤ 25 ambientes)* | R$ 2.126 | R$ 1.033 | + R$ 1.093 | + R$ 726 |
| 80% *(no limite: máx. sustentável 77%)* | R$ 1.745 | R$ 1.033 | **+ R$ 712** | **+ R$ 345** |
| 70% | R$ 1.554 | R$ 1.033 | **+ R$ 521** | + R$ 154 |
| 60% | R$ 1.363 | R$ 1.033 | + R$ 330 | − R$ 37 |
| **44%** | R$ 1.058 | R$ 1.033 | **+ R$ 25 — equilíbrio** | − R$ 342 |
| 30% | R$ 791 | R$ 1.033 | **− R$ 242** | − R$ 609 |

### 3.7 **Onde começa o lucro e onde começa o prejuízo — com todas as letras**

> **1. Prejuízo garantido até o 16º ambiente ativo.** O ponto de equilíbrio é
> **16 ambientes ativos no mix médio**, equivalente a **R$ 1.051/mês de receita**
> (`R$ 1.033 ÷ (R$ 65,55 × 0,983)`). Abaixo disso, todo mês fecha no vermelho, e não existe desconto,
> promoção ou add-on que mude isso — é custo fixo de três VPS.
>
> **2. Na fase de validação (4–5 sistemas do ADENDO §B), o prejuízo é de R$ 700 a R$ 800 por mês.**
> Esse é o preço do laboratório, e é dinheiro do bolso do dono. Está correto gastá-lo — mas com o
> número na frente, não por surpresa.
>
> **3. Com a frota cheia (33 ambientes) e 70% de horas ativas, a margem bruta é de +R$ 521/mês.**
> Com 80% ativos (o limite físico sustentável é 77%), +R$ 712/mês. **Esse é o teto do negócio nesta
> infraestrutura:** não há cenário em que 3 VPS de 16 GB rendam mais de **~R$ 720/mês** de margem bruta.
>
> **4. Descontando o seu tempo de suporte a R$ 80/h, o lucro real fica entre R$ 150 e R$ 350/mês** com
> a frota cheia — e vira **prejuízo abaixo de 62% de horas ativas**.
>
> **5. O negócio volta ao prejuízo em quatro situações, todas mensuráveis:**
> (a) desconto médio acima de **30%**; (b) fração ativa média abaixo de **44%** com a frota cheia;
> (c) ocupação abaixo de **50%** com fração ativa típica de 70%; (d) suporte passando de **~6,5 h/mês**
> precificadas. Os quatro devem virar alerta na tela de DRE (§9), não descoberta no fim do ano.
>
> **6. A alavanca não é preço. É tamanho de nó.**

| Configuração | RAM alocável | Provisionável (1,30×) | Ambientes | Custo fixo/mês | Receita (A=70%) | **Margem bruta** | R$/GB provisionado |
|---|---:|---:|---:|---:|---:|---:|---:|
| **3 × VPS 16 GB** (o plano atual) | 34,5 GB | 44,9 GB | **33** | R$ 1.033 | R$ 1.554 | **+ R$ 521** | R$ 18,50 |
| **1 × dedicado BR 64 GB** | 51,0 GB | 66,3 GB | **49** | R$ 1.290 | R$ 2.307 | **+ R$ 1.017** | R$ 16,29 |
| **2 × dedicado BR 64 GB** | 102,0 GB | 132,6 GB | **98** | R$ 2.309 | R$ 4.615 | **+ R$ 2.306** | R$ 16,29 |

*(nó de 64 GB: reserva de host de 4 GB — bancos compartilhados maiores — e o mesmo teto de 85% de alocação.)*

Um único servidor de 64 GB entrega **quase o dobro da margem dos três VPS juntos**, com **um terço** do
trabalho operacional e 12% menos custo por GB. O motivo é aritmético: a reserva de host é quase constante,
então um nó de 16 GB entrega apenas **72% da sua RAM como alocável**, contra **80% num nó de 64 GB** — e
fragmentar em VPS pequenas é pagar essa reserva três vezes, além de triplicar patch, monitoramento,
backup e conta de provedor.
**Recomendação:** manter os 3 nós de 16 GB **enquanto a fase for validação** (o ADENDO §B é explícito
sobre isso, e a diversidade de provedor é a justificativa da modularidade). **Assim que a base passar de
25 ambientes, o próximo nó não é uma VPS de 16 GB — é um servidor de 64 GB.** Escrever isso no roadmap
como gatilho numérico, não como intenção.

### 3.8 O efeito das pausas na receita

Por ambiente Veloz Light (720 h no mês, R$ 0,0680556/h ativo × R$ 0,0069444/h pausado):

| Horas pausadas | Receita do ambiente | Δ vs sempre ativo | Custo de infra se a RAM ficar reservada |
|---:|---:|---:|---:|
| 0 h | R$ 49,00 | — | R$ 18,50 |
| 180 h (25%) | R$ 38,00 | −22,4% | R$ 18,50 |
| 360 h (50%) | R$ 27,00 | −44,9% | R$ 18,50 |
| 540 h (75%) | R$ 16,00 | −67,3% | R$ 18,50 |
| 648 h (90%) | R$ 9,40 | −80,8% | R$ 18,50 |

**Leitura, em dois níveis — os dois importam e são diferentes:**

| Referência de custo | Fórmula | Ponto de virada |
|---|---|---|
| **Infra apenas**, com a RAM reservada para o ambiente pausado (R$ 18,50) | `49,00 − 44,00 p = 18,50` | **69% de horas pausadas** |
| **Custo total de servir** um Light (infra 18,50 + overhead 8,58 + PSP + suporte ≈ R$ 39,30) | `49,00 − 44,00 p = 39,30` | **22% de horas pausadas** |
| **Frota inteira**, já com a razão de commit de 1,30× absorvendo as pausas | §3.6 | **56% de horas pausadas (A = 44%)** |

A terceira linha é a que governa, e ela só é melhor que a segunda **porque a razão de commit existe**.
É por isso que a razão de commit não é opcional: ela é o mecanismo que transforma a pausa do cliente em
capacidade vendável. Sem ela, cada pausa é receita perdida com custo mantido — e o negócio quebra com 22%
de pausa. Com ela, cada pausa é um slot que outro cliente ocupa, e o limite sobe para 56%.

Traduzido em regra: **a pausa é rentável para nós exatamente enquanto a fração ativa da frota ficar acima
de 44%.** Esse é o número a monitorar semanalmente. Se a base inteira começar a pausar (por exemplo,
porque vendemos para desenvolvedores que ligam o ambiente só para trabalhar), a resposta correta é subir
a razão de commit — vender mais slots —, **não** encarecer a pausa. Encarecer a pausa mata o argumento de
venda; vender mais slots é invisível para o cliente.

### 3.9 Política de desconto — o teto seguro

**Custo de servir um ambiente médio, mês a mês:**

| Componente | R$/ambiente/mês |
|---|---:|
| Infra (1,35 GB × R$ 18,50) | 24,98 |
| Rateio do overhead fixo (R$ 283 ÷ 33) | 8,58 |
| Taxa de PSP (1,7%) | 1,11 |
| Suporte (R$ 367 ÷ 33) | 11,12 |
| **Custo total de servir** | **R$ 45,79** |
| *sem contar suporte* | *R$ 34,67* |

Preço de tabela médio: **R$ 65,55**.

| Desconto | Preço realizado | Margem sobre custo total | Veredito |
|---:|---:|---:|---|
| 0% | R$ 65,55 | + R$ 19,76 (30%) | saudável |
| 8% (3 meses) | R$ 60,31 | + R$ 14,52 (24%) | ✔ |
| 15% (6 meses) | R$ 55,72 | + R$ 9,93 (18%) | ✔ |
| **22% (12 meses)** | **R$ 51,13** | **+ R$ 5,34 (10%)** | ✔ **piso recomendado** |
| **25% (teto absoluto)** | R$ 49,16 | + R$ 3,37 (7%) | limite; nada além disto |
| **30,1%** | R$ 45,79 | **R$ 0,00** | **ponto de ruína** |
| **35% (proposta de `01` §A.3.7)** | R$ 42,61 | **− R$ 3,18** | ✘ **REFUTADO** |
| 47% | R$ 34,74 | − R$ 11,05 | **empata mesmo ignorando o suporte** (custo sem suporte = R$ 34,67) |
| **60% (a escada do Hostoo, 36 meses)** | R$ 26,22 | − R$ 19,57 | **o cliente paga a conta da VPS e mais nada** |

> **Política fechada:**
> - **Teto absoluto de desconto: 25%**, somando **tudo** — compromisso + cupom + indicação + cortesia
>   comercial. Validado no código: `discount_bp <= 2500` como CHECK em `commitments` e `coupons`, e um
>   guard no motor de preço que rejeita a soma acima de 2500.
> - **Escada: 3 meses −8% · 6 meses −15% · 12 meses −22%.** Nada de 24 ou 36 meses.
> - **Nunca pré-selecionado.** Default do funil = sem compromisso.
> - **Refutados os 35% de `01` §A.3.7**: dão prejuízo de R$ 3,18 por ambiente por mês assim que o
>   suporte é precificado — e o cliente de 12 meses é justamente o que mais abre ticket, porque fica.
> - Confirmado o "teto de 25%" da crítica do Ciclo 1, agora com a conta por trás.

**Por que 22% ainda é competitivo:** o padrão do mercado para pagamento anual é "2 meses grátis em 12" =
16,7%. Nossos 22% são **mais** generosos que o mercado, e vêm com pausa que estende o prazo — algo que
nenhum concorrente oferece.

---

## 3.10 REPROJEÇÃO com a frota real — **2 nós de produção** (ADENDO 3 §G)

> **Esta seção substitui os números de §3.3, §3.5, §3.6, §3.7 e §3.9.** Tudo antes dela foi calculado com
> 3 nós de produção; o ADENDO 3 corrige para **2 nós de produção + 1 nó de teste que não recebe cliente
> pagante**. O método não muda — os números mudam, e mudam para pior. As decisões de metering (§2), o
> contrato `payment.gateway v1` (§6) e as 17 respostas (§1) continuam valendo integralmente.

### 3.10.1 O que mudou, em uma linha

**O custo fixo é praticamente o mesmo; a capacidade caiu um terço.** O nó de teste continua sendo pago,
mas deixou de ser capacidade vendável. É a pior combinação possível para a unidade econômica.

| | Ciclo 2, versão anterior (3 nós de produção) | **ADENDO 3 (2 produção + 1 teste)** |
|---|---:|---:|
| Nós que recebem cliente | 3 | **2** |
| Nós pagos | 3 | **3** (o de teste é despesa pura) |
| RAM alocável de produção | 34,5 GB | **23,0 GB** |
| Ambientes provisionáveis | 33 | **22** |
| Ambientes ativos simultâneos (teto físico) | 25,6 | **17,0** |
| Custo fixo mensal | R$ 1.033 | **R$ 1.027** |
| **Custo fixo por ambiente vendável** | R$ 31,30 | **R$ 46,68 (+49%)** |

### 3.10.2 Capacidade da frota de produção

Reserva de host e teto de 85% de §3.2 inalterados: **11,5 GB alocáveis por nó**.

| Recurso | Por nó | **2 nós** | Limite que impõe |
|---|---:|---:|---|
| RAM alocável | 11,5 GB | **23,0 GB** | **ambientes ATIVOS simultâneos: 17** |
| RAM provisionável (commit 1,30×) | 14,95 GB | **29,9 GB** | **ambientes VENDIDOS: 22** |
| vCPU | 6 | 12 | 22 × 1,3 vCPU médio = 28,6 vCPU → overcommit **2,4× provisionado / 1,7× ativo**. Aceitável para carga web (o padrão do setor é 4×), mas é o segundo recurso a estourar |
| Disco (160 GB úteis/nó) | 20 amb. a 8 GB reais | 40 | folga; não é o limite |

**Fração ativa máxima sustentável = 23,0 ÷ 29,9 = 77%.** Acima disso o admission control enfileira
`start`, e o cliente vê "retomando em instantes" — o que é aceitável em 0,5% dos casos e inaceitável em
5%.

### 3.10.3 Custo por ambiente, recalculado com os números fechados do Ciclo 2

Inclui o nó de teste rateado, backup a **R$ 0,45/ambiente/mês** (fechado pelo especialista de Banco de
Dados) e observabilidade a **R$ 32/mês na frota**.

| Item | R$/mês na frota | R$/ambiente (÷ 22) | Natureza |
|---|---:|---:|---|
| Nó de produção 1 (6 vCPU / 16 GB) | 250,00 | 11,36 | fixo |
| Nó de produção 2 (6 vCPU / 16 GB) | 250,00 | 11,36 | fixo |
| **Nó de teste / homologação** | **250,00** | **11,36** | **fixo, sem receita** |
| Control plane (2 vCPU / 4 GB) | 80,00 | 3,64 | fixo |
| Observabilidade | 32,00 | 1,45 | fixo |
| DNS, TLS, e-mail transacional | 25,00 | 1,14 | fixo |
| Helpdesk (Crisp/Chatwoot Cloud) | 130,00 | 5,91 | fixo |
| Domínio, certificados, miscelânea | 10,00 | 0,45 | fixo |
| **Subtotal fixo** | **1.027,00** | **46,68** | |
| Backup off-node (R$ 0,45 × 22) | 9,90 | 0,45 | variável |
| Taxa de PSP (1,7% da receita) | ~18,90 | 0,86 | variável |
| **CUSTO DE CAIXA** | **R$ 1.055,80** | **R$ 47,99** | |
| Suporte: ~15 clientes × 0,5 ticket × 25 min = 3,1 h/mês a R$ 80/h | 250,00 | 11,36 | custo de oportunidade do dono |
| **CUSTO TOTAL DE SERVIR** | **R$ 1.305,80** | **R$ 59,35** | |

Comparação direta com o preço: **preço médio de tabela do mix é R$ 65,55/mês**. Contra R$ 59,35 de custo
total, sobram **R$ 6,20 por ambiente por mês — 9,5% de margem** *se o ambiente ficar 100% do tempo
ligado*. Não fica: a 77% de horas ativas, a receita média por ambiente vendido cai para **R$ 52,02**, que
é **R$ 7,33 abaixo do custo total de servir**.

**Custo por GB de RAM provisionado subiu de R$ 18,50 para R$ 27,76** — `(2 × 250 de produção + 250 do nó
de teste + 80 do control plane) ÷ 29,9 GB provisionáveis` —, porque um terço do parque de nós é pago e
não gera receita. Contando **só** os nós de produção seriam R$ 19,40/GB; a diferença de R$ 8,36 por GB é
exatamente o preço do nó de homologação, e §3.10.10 argumenta por que ele vale o que custa.

### 3.10.4 Ponto de equilíbrio — e o problema com ele

Contribuição líquida por ambiente **ativo** = R$ 65,55 × 0,983 − R$ 0,45 = **R$ 63,99/mês**.
Custo fixo (sem o backup, que já saiu da contribuição) = **R$ 1.027**.

```
Ponto de equilíbrio de caixa = 1.027 ÷ 63,99 = 16,05  →  17 ambientes ativos
Teto físico de ambientes ativos simultâneos           =  17,04
```

> ## O ponto de equilíbrio fica em 94% do teto físico da frota.
>
> **Com todas as letras: esta frota só empata no caixa no cenário em que ela está inteiramente vendida
> E rodando no máximo físico que a RAM permite. Não existe folga. Qualquer cliente a menos, qualquer
> desconto, qualquer hora de pausa acima do previsto, e o mês fecha no vermelho.**
>
> E isso é só o **caixa**. Incluindo o tempo de suporte do dono a R$ 80/h, o ponto de equilíbrio sobe
> para **20 ambientes ativos — acima do teto físico de 17.**
> **Ou seja: contando o próprio trabalho, esta frota NÃO tem ponto de equilíbrio. Ela dá prejuízo em
> 100% dos cenários possíveis, inclusive no melhor deles.**

### 3.10.5 Receita máxima possível nesta frota

| | Valor |
|---|---:|
| Ambientes vendidos (teto) | **22** |
| Fração ativa máxima sustentável | **77%** |
| Receita bruta por ambiente vendido (0,77 × 65,55 + 0,23 × 6,75) | R$ 52,02 |
| **Receita bruta máxima da frota** | **R$ 1.144/mês** · R$ 13.730/ano |
| Menos PSP (1,7%) e backup | − R$ 29 |
| **Receita líquida máxima** | **R$ 1.115/mês** |
| Custo fixo | − R$ 1.027 |
| **MARGEM BRUTA MÁXIMA** | **+ R$ 88/mês** |
| Menos suporte (R$ 250) | |
| **RESULTADO MÁXIMO COM O TEMPO DO DONO PRECIFICADO** | **− R$ 162/mês** |

**R$ 1.144/mês é o teto absoluto de faturamento desta infraestrutura.** Não há preço, desconto,
add-on, cupom ou esforço de vendas que passe disso — o limite é a RAM de dois servidores de 16 GB.

### 3.10.6 Margem por cenário de ocupação (25% · 50% · 100%)

`Receita = N × [A × 65,55 + (1−A) × 6,75] × 0,983 − N × 0,45` · Custo fixo = R$ 1.027

**Ocupação 25% — 6 ambientes (a fase que começa agora, ADENDO 3 §I):**

| A (fração ativa) | Receita | **Margem bruta** | Com suporte precificado (~4 clientes = R$ 67) |
|---:|---:|---:|---:|
| 77% (máx.) | R$ 304 | **− R$ 723** | − R$ 790 |
| 70% | R$ 280 | **− R$ 747** | − R$ 814 |
| 50% | R$ 211 | **− R$ 816** | − R$ 883 |

**Ocupação 50% — 11 ambientes:**

| A | Receita | **Margem bruta** | Com suporte (~7 clientes = R$ 117) |
|---:|---:|---:|---:|
| 77% | R$ 558 | **− R$ 469** | − R$ 586 |
| 70% | R$ 513 | **− R$ 514** | − R$ 631 |
| 50% | R$ 386 | **− R$ 641** | − R$ 758 |

**Ocupação 100% — 22 ambientes (frota esgotada):**

| A | Receita | **Margem bruta** | Com suporte (~15 clientes = R$ 250) |
|---:|---:|---:|---:|
| **77% (teto físico)** | R$ 1.115 | **+ R$ 88** | **− R$ 162** |
| 70% | R$ 1.026 | **− R$ 1** *(equilíbrio exato de caixa)* | − R$ 251 |
| 60% | R$ 899 | **− R$ 128** | − R$ 378 |
| 50% | R$ 772 | **− R$ 255** | − R$ 505 |
| 44% | R$ 695 | **− R$ 332** | − R$ 582 |
| 30% | R$ 518 | **− R$ 509** | − R$ 759 |

**Leitura:** o ponto de equilíbrio de caixa passa a exigir **frota cheia + 70% de horas ativas**. O número
de §3.7 (44% de fração ativa) valia para 3 nós; **com 2 nós ele sobe para 70%** e a folga desaparece.

### 3.10.7 **Os preços continuam válidos? Sim. E isso é a má notícia, não a boa.**

O ADENDO 3 §H ratifica o catálogo até 4 GB — Start, Light, Plus, Pro —, o que confirma o corte de Turbo e
Max feito em §3.4. A pergunta que resta é se **R$ 30,50 / 49,00 / 98,00 / 172,00** ainda fecham.

Quanto o preço precisaria subir para a frota cheia (22 ambientes, A = 70%) produzir margem:

| Margem bruta alvo | Fator sobre a tabela | **Light passaria a** | Contra o mercado |
|---:|---:|---:|---|
| R$ 0 (equilíbrio) | **1,00×** | **R$ 49,00** | Hostoo Nuvem Pro 1 GB: R$ 44,90 → estamos **+9%** — competitivo |
| R$ 250/mês | 1,24× | R$ 60,80 | **+35% sobre o Hostoo** |
| R$ 500/mês | 1,48× | R$ 72,60 | **+62% sobre o Hostoo** |
| R$ 1.000/mês | 1,97× | R$ 96,30 | **+114% sobre o Hostoo** — e 2,75× o plano de R$ 35,00 |

> **Decisão: manter os preços de §3.4 exatamente como estão. Não subir.**
>
> Três motivos, nesta ordem:
> 1. **Subir preço não resolve o problema, porque o problema não é preço — é teto de capacidade.** Mesmo
>    dobrando a tabela, o faturamento máximo iria a R$ 2.288/mês, e junto viria a evasão que torna
>    "frota cheia" impossível. O gargalo é 22 ambientes, e ele não se move com preço.
> 2. **A R$ 72,60 o Light fica 62% acima do concorrente direto**, oferecido por uma operação de dois
>    servidores, sem redundância, sem histórico de uptime e sem SLA. Ninguém compra isso, e quem comprar
>    vai embora no primeiro incidente.
> 3. **O objetivo declarado é validar, não faturar** (ADENDO 3 §I). Preço alto contamina a validação: se
>    ninguém comprar, você não vai saber se o produto é ruim ou se o preço é caro.
>
> **Dito com todas as letras: o preço competitivo não fecha nesta infraestrutura.** Não é um erro de
> precificação e não tem solução comercial. É um problema de tamanho de nó, e a solução é a de §3.7 —
> um nó maior. Os preços atuais estão certos **para o produto**; a infraestrutura é que está errada
> **para o preço**. Até que ela mude, o prejuízo é o custo do aprendizado, e o ADENDO 3 §I diz
> explicitamente que isso é aceito.

**Ajuste de desconto para a fase 1 (substitui §3.9 enquanto durarem 2 nós):**

| Referência de custo por ambiente | Break-even de desconto sobre R$ 65,55 |
|---|---:|
| Custo total de servir (R$ 59,35) | **9,5%** |
| Custo de caixa (R$ 47,99) | **26,8%** |
| Custo de caixa sem o nó de teste (R$ 36,63) | 44,1% |

> **Fase 1: teto de desconto = 10%.** A escada 8/15/22% de §3.9 fica **suspensa** — a 22% o compromisso
> de 12 meses queima toda a margem de caixa e ainda congela o preço por um ano sobre uma infra que
> pretendemos trocar. Oferecer apenas **6 meses a −10%**, e só para cliente âncora.
> **A escada completa (8/15/22%) volta quando o gatilho de §3.10.9 disparar e o nó maior entrar.**
> O CHECK `discount_bp <= 2500` do schema continua; o limite operacional de 1000 bp fica na configuração,
> não no schema — para voltar sem migration.

### 3.10.8 Política comercial da fase 1 — quem aceitar e quem recusar

O objetivo do ADENDO 3 §I é **aprender com poucos clientes e não perder dado**. A política decorre disso:

| Item | Decisão |
|---|---|
| **Quantos clientes aceitar** | **Máximo 12 clientes / 15 ambientes provisionados** na fase 1 — 68% do teto de 22. A folga de 7 slots é o que permite sobreviver a um erro de dimensionamento, a um cliente que cresce e à perda de um nó (§3.10.10) |
| **Perfil ideal** | Site institucional, blog, landing, Laravel/Next pequeno, ambiente de staging de agência. Cliente **tolerante a incidente** e disposto a dar retorno — é isso que estamos comprando com o prejuízo |
| **Recusar: não cabe em 4 GB** | Qualquer carga que precise de mais de 4 GB de RAM. Catálogo fechado (ADENDO 3 §H). "Orçamento sob medida" só depois de existir nó maior — **e não vender antecipadamente** |
| **Recusar: exige SLA contratual** | Empresa que pede SLA com multa, 99,9%, janela de manutenção acordada, ou DPA com auditoria. Não temos redundância para prometer isso (§3.10.10) |
| **Recusar: tráfego alto** | Projeção acima de **300 GB/mês** por ambiente, streaming, download de arquivo grande, mídia. Com 2 nós, a cota de banda da VPS é um recurso compartilhado e um cliente pesado degrada os outros (Achado 6.4) |
| **Recusar: e-commerce em pico** | WooCommerce com campanha/Black Friday. O Achado 6.2 mostra pico de 600–800 MB; num nó de 16 GB com 11 vizinhos, um pico desses é OOM alheio |
| **Recusar: quem exige janela de migração** | Migração assistida sim; migração com hora marcada e rollback garantido, não |
| **Aceitar de bom grado** | O cliente que **pausa muito** — ele custa quase nada, paga o disco e valida justamente a mecânica que diferencia o produto |
| **Preço na fase 1** | Tabela de §3.4, sem desconto acima de 10%, sem compromisso de 12 meses |
| **O que prometer** | RTO de 12 h, RPO de 1 h para banco e 24 h para arquivos, backup verificado, crédito automático por indisponibilidade, exportação livre a qualquer momento, **sem taxa de saída** |
| **O que medir desde o cliente nº 1** | tickets/cliente/mês, fração ativa da frota, RAM real por plano, horas de operação do dono, incidentes e MTTR. **São essas cinco métricas — não a receita — que decidem se existe fase 2** |

### 3.10.9 Gatilho numérico para contratar o nó maior

> **Contratar um nó de 64 GB quando QUALQUER uma destas condições se sustentar:**
> - **(a) 15 ambientes ativos simultâneos** (88% do teto de 17) **por 14 dias corridos**; ou
> - **(b) RAM alocada acima de 85% em qualquer nó de produção por 7 dias corridos**; ou
> - **(c) receita reconhecida ≥ R$ 900/mês por 2 meses consecutivos**; ou
> - **(d) fila de `start` acima de 0,5% dos pedidos por 7 dias** (o SLO de §3.10.2 estourou).
>
> **Não contratar mais uma VPS de 16 GB.** O próximo nó é de 64 GB — a matemática de §3.7 não mudou:
> um nó de 16 GB entrega 72% da RAM como alocável, um de 64 GB entrega 80%, e o custo por GB cai de
> R$ 27,76 (frota atual, com o nó de teste rateado) para R$ 16,29.

Efeito de acrescentar **um** nó de 64 GB à frota atual (mantendo os 2 nós de 16 GB, o que preserva a
diversidade de provedor exigida pelo ADENDO 3 §G item 4):

| | Frota atual | **+ 1 nó de 64 GB** |
|---|---:|---:|
| Ambientes vendáveis | 22 | **71** |
| Custo fixo mensal | R$ 1.027 | R$ 2.027 |
| Receita a A = 70%, frota cheia | R$ 1.026 | **R$ 3.312** |
| **Margem bruta** | **− R$ 1** | **+ R$ 1.285** |
| Ponto de equilíbrio (ambientes ativos) | 17 (= o teto) | **32 de 71 — 45% do teto** |

**É esse um único nó que transforma um laboratório em negócio.** Ele custa R$ 1.000/mês e devolve
R$ 1.286/mês de margem — payback no primeiro mês em que a frota estiver 45% ocupada.

### 3.10.10 Perder um nó = perder metade da capacidade

Com 2 nós, não existe N-1: reservar um nó inteiro significaria jogar fora 50% de uma capacidade que já
não fecha a conta. **A regra N-1 de `03` R10 está definitivamente morta** (a crítica já a havia derrubado
para 3 nós; com 2, é aritmeticamente absurda).

**Impacto financeiro de uma queda longa — e a boa notícia escondida nele:**

| Duração da queda de 1 nó | Ambientes congelados | **Receita perdida** (o medidor congela, §2.3) |
|---|---:|---:|
| 4 h | 11 | R$ 3,18 |
| 24 h | 11 | R$ 19,08 |
| 7 dias | 11 | R$ 133 |
| 30 dias | 11 | R$ 572 |

> **A receita perdida é irrisória — e isso é de propósito.** A regra de congelamento de §2.3 (nó
> `unreachable` para de faturar) transforma a indisponibilidade num não-evento financeiro: o cliente
> simplesmente não paga o que não usou, o crédito de SLA é automático e não há o que discutir.
>
> **O custo real de um incidente longo é churn, não medidor.** Com 11 clientes, perder 3 num incidente
> mal conduzido custa **R$ 156/mês recorrentes** — 8× o que o medidor deixou de faturar numa queda de
> 24 h, e permanente. **Numa base de 11 clientes, a comunicação durante o incidente vale mais dinheiro
> que a infraestrutura que caiu.**

**O nó de teste deixa de ser custo perdido: ele é a apólice de seguro.** Ele custa R$ 250/mês e entrega
duas coisas ao mesmo tempo — o ambiente de homologação que o ADENDO 3 §G item 2 pede, e a **capacidade
quente de substituição** para onde os ambientes do nó morto são restaurados dentro do RTO. Isso muda a
leitura contábil dele: não é 24% do custo fixo jogado fora, é **staging + hot spare** por um quarto do
orçamento. Requisito que decorre: o nó de teste tem de ser **provisionado com a mesma imagem base e o
mesmo agente da produção**, e o `node.evacuate` tem de ser ensaiado nele — senão a apólice não paga.

**O que prometer (e o que NÃO prometer) no SLA da fase 1:**

| | Fase 1 |
|---|---|
| **SLA numérico com multa** | **NÃO PROMETER.** 99,9% são 43 min/mês — um único reboot de kernel do provedor estoura, e não temos redundância para absorver. Prometer é criar passivo contra si mesmo |
| Meta interna, publicada sem virar cláusula | **99,0% mensal** (≈ 7,2 h), medida e publicada numa **status page pública** com histórico real |
| **RTO** | **12 h** para restaurar num nó novo ou no nó de teste promovido. Declarado no contrato, e **ensaiado trimestralmente** |
| **RPO** | **1 h** para banco de dados (dump horário), **24 h** para arquivos |
| Compensação | **Crédito automático** proporcional às horas indisponíveis, sem o cliente pedir — decorre do congelamento do medidor (§2.3) |
| Janela de manutenção | Anunciada com 72 h, fora do horário comercial, com o nó de teste validando a mudança **antes** |
| Postura contratual | Termos dizem, na primeira pessoa: *"estamos em fase de validação, com dois servidores e sem redundância de nó. Não oferecemos SLA com multa. Oferecemos backup verificado, RTO de 12 h, crédito automático por indisponibilidade e exportação dos seus dados a qualquer momento, sem taxa."* **Cliente que não aceita isso não é cliente desta fase** (§3.10.8) |

Ser honesto aqui é mais barato que ser otimista: um SLA de 99,9% vendido sobre 2 VPS produz, no primeiro
incidente, uma multa contratual **e** um cliente perdido. A frase acima produz, no máximo, uma venda
perdida — e provavelmente a venda certa a perder.

### 3.10.11 As sete conclusões da reprojeção

1. **Capacidade: 22 ambientes vendidos, 17 ativos simultâneos.** É o teto absoluto da frota.
2. **Receita máxima possível: R$ 1.144/mês bruta (R$ 13.730/ano).** Nenhum preço muda esse número.
3. **Ponto de equilíbrio de caixa: 17 ambientes ativos — 94% do teto físico.** Não há folga.
4. **Contando o tempo do dono a R$ 80/h, não existe ponto de equilíbrio: a frota dá prejuízo em 100%
   dos cenários, inclusive no melhor deles (− R$ 162/mês com tudo vendido e tudo rodando).**
5. **Os preços estão certos e não devem subir.** O preço competitivo não fecha nesta infra, e isso não
   tem solução comercial — só tem solução de infraestrutura.
6. **Fase 1: no máximo 12 clientes / 15 ambientes**, desconto no teto de 10%, sem SLA numérico,
   recusando quem não cabe em 4 GB, quem exige SLA e quem tem tráfego acima de 300 GB/mês.
7. **O gatilho de §3.10.9 é a decisão mais importante do plano financeiro.** Um único nó de 64 GB leva a
   margem de −R$ 1 para +R$ 1.285/mês e baixa o ponto de equilíbrio de 94% para 45% do teto. Até ele
   chegar, o prejuízo é o custo do aprendizado — e o ADENDO 3 §I diz que esse custo está aceito.

---

## 4. Compromisso / pré-pagamento — validação matemática

O Produto/UX recomendou **"saldo dedicado em R$ + desconto travado, não plano travado"** (`01` §A.3.4).
**Validado.** Abaixo a conta que sustenta isso, e a refutação das duas alternativas.

### 4.1 As três formas possíveis, testadas contra os quatro eventos que sempre acontecem

Caso-base: **Veloz Light, compromisso de 12 meses, −22%**.
Valor de tabela: R$ 49,00 × 12 = **R$ 588,00**. Pago à vista: **R$ 458,64**.
Tarifa travada: R$ 0,0680556 × 0,78 = **R$ 0,0530833/h**.
Verificação: R$ 458,64 ÷ R$ 0,0530833 = **8.640,0 h = 12 × 720 h exatas**. ✔ O balde e o prazo fecham.

| Evento | **(A) Bloco de horas do SKU** | **(B) Só desconto, sem pré-pagamento** | **(C) Saldo dedicado em R$ + desconto travado** |
|---|---|---|---|
| Super admin muda RAM 1 GB → 2 GB (requisito nº 9) | **Quebra.** O bloco está denominado em "horas de Light"; Light não existe mais para este ambiente. Exige tabela de conversão entre SKUs — caso especial permanente | Funciona, mas não há caixa nem retenção | **Funciona sem regra nova.** Tarifa vai a R$ 0,1061667/h; o balde de R$ 458,64 passa a durar 4.320 h ≈ 6 meses; `estimated_end_at` recalcula sozinho |
| Cliente pausa 300 h | Ambíguo: pausa consome hora do bloco? O Hostoo não responde e a UI dele se contradiz | Nada acontece (não há bloco) | **Consome R$ 2,08 de disco em vez de R$ 15,92 de compute.** O balde dura mais. Zero código especial |
| Cliente compra add-on de backup | Fora do bloco (o bloco é do plano) → segunda conta, segundo extrato | Desconto não se aplica | **Sai do mesmo balde**, com o mesmo desconto se assim definido. Um extrato só |
| Cliente cancela no 4º mês | Quanto vale "5.760 horas de Light não usadas"? Discussão | Nada a devolver — mas também nada foi pago | **R$ 305,76 de residual**, com duas saídas calculadas (§4.3) |
| Caixa antecipado | R$ 458,64 | **R$ 0** | R$ 458,64 |
| Passivo contábil | difícil de mensurar (horas) | zero | **exato: `dedicated_balance_cents`** |

**(A) é refutado pelo requisito nº 9. (B) é refutado por não gerar caixa nem retenção.
(C) é a única que sobrevive aos quatro eventos sem caso especial.** E, não por acaso, (C) é também a
única cuja contabilidade é trivial: o saldo dedicado **é** a receita diferida, linha a linha.

### 4.2 Regras operacionais do compromisso

| Situação | Regra fechada |
|---|---|
| **Pausar durante o compromisso** | O balde esvazia mais devagar. `estimated_end_at` recalcula. Nunca prometemos data — a UI diz *"termina em ~DD/MM no ritmo atual"* |
| **Upgrade no meio** | Pró-rata imediato ao minuto; balde esvazia mais rápido; a UI mostra **antes de confirmar** a nova data estimada e oferece completar o balde |
| **Downgrade no meio** | Idem, ao contrário. Disco só reduz se `usado < nova quota` |
| **Override do super admin** | Igual a upgrade/downgrade, **mais** o interruptor "não cobrar" (P11), que gera janela com valor R$ 0,00 e etiqueta no extrato do cliente |
| **Balde esvazia antes do prazo** | O ambiente **continua rodando**, consumindo o bucket `recharge`, **com o desconto ainda aplicado** (o desconto é do ambiente, não do bucket — P9). Notificação em 20%, 10% e 0% do balde |
| **Prazo/validade do desconto vence com balde cheio** | `discount_expires_at = started_at + term × 1,5` (mínimo 6 meses). Nesse instante: `status='expired'`, o **desconto acaba**, e o saldo remanescente é transferido para o bucket `recharge` (lançamento `transfer`, soma zero). **O dinheiro não evapora** |
| **Cancelamento** | §4.3 |
| **Um compromisso por ambiente** | Sim. Compromisso de conta inteira fica para v2 — dobra a complexidade do rateio e não tem demanda comprovada |
| **Renovação** | Sempre manual e opt-in. **Renovação automática de compromisso plurianual está proibida no produto** — é o mecanismo que gera reclamação em massa |

### 4.3 Cancelamento — a conta aberta na tela

Exemplo real, cancelamento no 4º mês (2.880 h consumidas, todas ativas):

```
Você pagou ..................................... R$ 458,64
Consumiu 2.880 h à tarifa travada de R$ 0,0530833/h .. R$ 152,88
Saldo dedicado restante ........................ R$ 305,76

  ▸ OPÇÃO 1 — Crédito na conta            R$ 305,76   (integral, sem prazo para usar)
  ▸ OPÇÃO 2 — Devolução em dinheiro       R$ 262,64
      recomposição do desconto: 2.880 h × R$ 0,0680556 (tarifa cheia) = R$ 196,00
      458,64 − 196,00 = 262,64   (menos taxa do PSP, fora dos 7 dias do CDC)
```

Diferença entre as opções: **R$ 43,12**. A opção de crédito é maior e é a que queremos — mas as duas
aparecem, com a conta aberta. Transparência aqui é retenção, não risco (`01` §A.3.5, ratificado).

Casos de borda fechados:
- **Dentro de 7 dias do pagamento (CDC art. 49)**: devolução **integral** de R$ 458,64, **nós absorvemos a
  taxa do PSP**, e o consumo não é deduzido se for menor que R$ 20,00.
- **Recomposição nunca gera valor negativo.** Se o consumo a preço cheio superar o pago, a devolução é
  R$ 0,00 — e nunca uma cobrança adicional.
- Devolução vai **para o mesmo meio e o mesmo titular** (P7/P13).
- Cancelamento **não** apaga o ambiente. Ele passa a consumir do bucket `recharge` à tarifa cheia.

### 4.4 O passivo — a parte que ninguém lembra e que quebra empresa

Com 33 ambientes e 30% em compromisso de 12 meses: **10 compromissos × R$ 458,64 = R$ 4.586 recebidos**,
dos quais em regime permanente **~R$ 2.300 são passivo de serviço** (dinheiro recebido, serviço a
entregar). Esse dinheiro **já foi gasto em VPS** — é caixa, não é lucro.

> **Regra de caixa, escrita e monitorada na tela §9.3:** nunca usar mais de **50% do caixa de
> compromissos** em custeio corrente. Os outros 50% são **reserva de serviço** — é o que paga os nós
> durante os meses em que o cliente já pagou e ainda vai consumir. Sem essa regra, um mês bom de vendas
> de compromisso vira um trimestre ruim de caixa doze meses depois.

Contabilmente (e é assim que o schema já está): `payments.deferred = true` para `purpose IN
('topup','commitment')`; a receita é **reconhecida** no lançamento `usage`, que carrega
`revenue_recognized_at` e `competence`. Isso é o que permite emitir NFS-e por competência depois (§8)
sem reprocessar histórico.

---

## 5. Ciclo de vida do inadimplente

Princípio: **62 dias entre o saldo zerar e o dado sumir, com no mínimo 7 avisos, exportação disponível o
tempo todo e nenhuma taxa para voltar.** Uma política que só é dura no fim e generosa no meio é o que
separa "consequência contratual comunicada" de "armadilha".

### 5.1 A escada completa

| # | Etapa | Gatilho | Prazo | O que acontece com os dados | O que o cliente vê | Medidor | Reversível |
|---|---|---|---|---|---|---|---|
| 0 | **Normal** | runway > 7 d | — | — | chip verde | rodando | — |
| 1 | **Aviso 7 d** | runway ≤ 7 d | D−7 | nada | e-mail + caixa de entrada + chip âmbar "saldo acaba em 5 dias" | rodando | — |
| 2 | **Aviso 72 h** | runway ≤ 72 h | D−3 | nada | e-mail + banner fixo no painel | rodando | — |
| 3 | **Aviso 24 h** | runway ≤ 24 h | D−1 | nada | e-mail + WhatsApp/SMS (opt-in) + banner vermelho + QR de recarga pronto | rodando | — |
| 4 | **Carência** | saldo ≤ 0 | **72 h** | tudo no ar, intacto | contador regressivo, botão recarregar em destaque, valor exato para sair | rodando, **saldo fica negativo até o teto de descoberto** (P8) | sim, automática ao recarregar |
| 5 | **Suspensão** | fim das 72 h **ou** descoberto no teto | imediato | container parado; **disco, banco, e-mail, DNS, certificados: intactos**; site responde **503 com página explicativa personalizável** | chip "Suspenso por saldo"; extrato mostra a dívida **congelada**; botão "baixar backup completo" ativo | **para completamente** | sim — recarga religa em < 2 min, **sem taxa** |
| 6 | **Aviso de arquivamento** | 15, 23 e 29 d de suspensão | D+15/23/29 | nada | 3 e-mails + caixa de entrada, com a data exata e o botão de exportar | parado | sim |
| 7 | **Arquivamento** | 30 d de suspensão | **D+30** | ambiente exportado num único arquivo (código + banco + config + certificados) no bucket; **recursos do nó liberados**; container destruído | "Arquivado — seus dados estão guardados até DD/MM"; download disponível; **restauração gratuita** mediante recarga (job de 15–60 min) | parado | sim, com restauração |
| 8 | **Aviso de exclusão** | 53 e 59 d | D+53/59 | nada | 2 e-mails com assunto inequívoco ("Seus dados serão apagados em 7 dias") | parado | sim |
| 9 | **Exclusão** | 60 d de suspensão | **D+60** | arquivo destruído; backups expiram no ciclo do restic (≤ 90 d); **dados cadastrais e fiscais preservados 5 anos** (obrigação legal); **logs de acesso 6 meses** (Marco Civil art. 15) | e-mail no ato, com a lista do que foi apagado e o hash do arquivo destruído | — | **não** |

### 5.2 O que impede a exclusão de acontecer

Guardas obrigatórias no job `dunning.archive` e `dunning.delete` — se qualquer uma bater, o job **para e
alerta o admin** em vez de executar:

1. **Ticket aberto** sobre cobrança, saldo ou reembolso naquela conta.
2. **Reembolso ou chargeback em andamento.**
3. **Divergência de conciliação** não resolvida envolvendo aquela conta (dinheiro pode ter entrado sem
   ser creditado — o pior caso de todos).
4. **Falha de entrega** de qualquer um dos avisos obrigatórios (bounce de e-mail): se não conseguimos
   avisar, não podemos apagar. Isso exige a tabela `EntregaDeNotificação` de `01` §A.8 funcionando —
   ela deixa de ser diagnóstico e vira **pré-condição jurídica**.
5. **`dunning_states.hold_reason` preenchido** (trava manual do admin).
6. **Fila de exclusão com botão de abortar** e janela de 24 h entre agendar e executar (`01` §A.9.4).

### 5.3 Por que isso respeita a LGPD e não vira armadilha jurídica

| Exigência | Como é atendida |
|---|---|
| **Finalidade e transparência** (LGPD art. 6º, I e VI) | A tabela de §5.1 aparece **literalmente** em `/financeiro/regras`, linkada de todo alerta de saldo, e nos Termos. O cliente conhece a regra antes de precisar dela |
| **Portabilidade / não aprisionamento** (art. 18, V) | Botão "baixar backup completo" ativo em **todos** os estados, inclusive suspenso e arquivado. Nunca cobramos por exportação nem por restauração |
| **Eliminação a pedido** (art. 18, VI) | Exclusão imediata a pedido, com a ressalva escrita das retenções legais abaixo |
| **Retenção por obrigação legal** (art. 16, I) | Fiscal: **5 anos** (prescrição tributária). Registros de acesso: **6 meses** (Marco Civil art. 15). Guardados **segregados**, criptografados e com acesso auditado — **só o cadastro e os logs, nunca o conteúdo hospedado** |
| **Backups** (art. 16 + realidade do restic) | Termos dizem "eliminação efetiva em até 90 dias, pelo ciclo de retenção de backup". `02` §13.2 item 6 já exigia isso |
| **CDC art. 39, V e art. 51** | Sem taxa de reativação. Sem taxa de restauração. Sem multa de cancelamento. Sem cláusula de perda de saldo. Sem renovação automática de compromisso |
| **Ônus de prova do aviso** | Toda notificação obrigatória gera registro em `EntregaDeNotificação` com canal, destino, status e provedor. Sem prova de entrega, não há exclusão (§5.2 item 4) |
| **Ofício judicial** | Procedimento escrito (`02` §13.2 item 5). O arquivamento **não** apaga o que estiver sob ordem judicial: `hold_reason='legal'` |

**Contraste deliberado com o Hostoo:** ele cobra R$ 25,00 por restauração de hospedagem (linha real do
histórico, `01` §A.2.2). Nós cobramos **R$ 0,00**, sempre, e dizemos isso na página de preços. Monetizar
o socorro do cliente é o comportamento que produz avaliação ruim, ticket hostil e Procon — nesta ordem.

### 5.4 O que dispara cada etapa, tecnicamente

Job `dunning.evaluate`, a cada **15 minutos**, idempotente:

```
runway_hours = saldo_total_cents / max(tarifa_horaria_agregada_cents, 1)
```
onde `tarifa_horaria_agregada` = soma das janelas abertas de todos os ambientes do tenant, à tarifa
vigente. Se o tenant não tem ambiente ativo, `runway = ∞` e ele nunca entra na escada — quem está
totalmente pausado só é suspenso quando o saldo não cobrir nem o disco.

Transições sempre **para frente** por tempo, e **para trás** instantaneamente por recarga: qualquer
crédito que leve `saldo_total > 0` devolve o tenant a `normal` e reagenda tudo. Recarga durante `archived`
enfileira o job de restauração automaticamente — o cliente não precisa pedir.

---

## 6. Capability `payment.gateway v1` — o contrato do módulo de pagamento

> Fecha o item **7** da ordem de marcha do Ciclo 2 e o Achado 5.0 da crítica ("a modularidade do doc 03 é
> de fachada"), em conjunto com o Arquiteto (#3). Requisito fechado do ADENDO §C.

### 6.1 Os cinco princípios do contrato

1. **O motor de faturamento é core. Os meios de pagamento são módulos.** O core sabe o que é saldo,
   razão, cobrança e liquidação. Não sabe o que é Asaas, Pix, Stripe ou boleto.
2. **O módulo nunca escreve em tabela do core.** Ele **informa um fato** por `host.payments.settle()`; o
   core valida, deduplica, persiste e credita. Isso preserva o isolamento de schema de `03` §2.4 sem
   inventar exceção.
3. **O módulo nunca decide o valor do saldo.** Ele diz quanto entrou; o core decide o que isso significa.
4. **`amount_cents` é `bigint` de centavos em toda a superfície.** Nenhum `number`, nenhum `float`,
   nenhuma string de dinheiro atravessa a interface.
5. **Teste de fachada no CI:** `grep -rniE "asaas|stripe|mercadopago|mercado ?pago|pagar\.?me|gerencianet|efi(pay)?|pix.?copia" packages/core packages/api packages/web` **deve retornar zero**. Se retornar, alguém acoplou. Roda em todo PR.

### 6.2 O contrato em TypeScript

```ts
// packages/contracts/src/payment-gateway/v1.ts
// @velozpanel/contracts — capability "payment.gateway", version "1"
// Implementado POR módulos. Consumido PELO core. Nunca o contrário.

/** Dinheiro. Sempre centavos, sempre bigint, sempre não-negativo salvo indicado. */
export type Cents = bigint;
export type Currency = 'BRL';
export type PaymentMethod = 'pix' | 'card' | 'boleto' | 'wallet';

export type ChargeStatus =
  | 'pending'       // criada, aguardando pagamento
  | 'authorized'    // autorizada, ainda não capturada (cartão)
  | 'succeeded'     // paga e confirmada
  | 'failed'        // recusada
  | 'expired'       // venceu sem pagamento
  | 'canceled'      // cancelada por nós ou pelo cliente
  | 'refunded'
  | 'partially_refunded'
  | 'disputed';     // chargeback aberto

// ─────────────────────────────────────────────────────────────────────────────
// describe()
// ─────────────────────────────────────────────────────────────────────────────
export interface GatewayDescriptor {
  /** slug do módulo; é o valor gravado em payments.provider */
  readonly provider: string;
  readonly displayName: string;
  readonly capabilityVersion: '1';
  readonly methods: readonly PaymentMethod[];
  readonly currencies: readonly Currency[];
  readonly supportsRefund: boolean;
  readonly supportsPartialRefund: boolean;
  readonly supportsMandate: boolean;          // Pix Automático / recorrência de cartão
  readonly supportsTokenization: boolean;     // guardar cartão sem PAN
  readonly supportsWebhookReplay: boolean;    // consegue reenviar evento a pedido
  readonly minAmountCents: Cents;
  readonly maxAmountCents: Cents | null;
  /** taxa declarada, só para a tela de conciliação estimar; nunca para calcular saldo */
  readonly feeModel: ReadonlyArray<{
    method: PaymentMethod; fixedCents: Cents; percentBp: number; settlementDays: number;
  }>;
  readonly sandbox: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// createCharge()
// ─────────────────────────────────────────────────────────────────────────────
export interface Payer {
  readonly name: string;
  readonly email: string;
  /** CPF/CNPJ apenas em dígitos. Obrigatório para Pix/boleto no Brasil. */
  readonly taxId?: string;
  readonly taxIdType?: 'cpf' | 'cnpj';
  readonly phone?: string;
  readonly address?: {
    readonly zip: string; readonly street: string; readonly number: string;
    readonly complement?: string; readonly district: string;
    readonly city: string; readonly state: string; readonly country: 'BR';
    /** código IBGE de 7 dígitos — guardado hoje, exigido pela NFS-e amanhã (§8) */
    readonly municipalityIbgeCode?: string;
  };
}

export interface CreateChargeInput {
  readonly idempotencyKey: string;       // 'topup|<payment_id>' — o core gera, o módulo respeita
  readonly amountCents: Cents;
  readonly currency: Currency;
  readonly method: PaymentMethod;
  readonly description: string;          // "VelozPanel — recarga de saldo"
  readonly payer: Payer;
  readonly expiresAt?: string;           // ISO-8601 UTC
  readonly returnUrl?: string;           // pós-checkout (cartão)
  readonly webhookUrl: string;           // rota pública do MÓDULO, montada pelo core
  readonly metadata: Readonly<Record<string, string>>; // { tenantId, paymentId, purpose }
  readonly mandateId?: string;           // cobrança sobre mandato existente
}

export interface Charge {
  readonly providerRef: string;          // id no PSP; único por instalação
  readonly status: ChargeStatus;
  readonly amountCents: Cents;
  readonly currency: Currency;
  readonly method: PaymentMethod;
  readonly checkoutUrl?: string;
  readonly pix?: { readonly qrcodeBase64?: string; readonly copiaECola: string; readonly txid?: string };
  readonly boleto?: { readonly url: string; readonly barcode: string; readonly dueDate: string };
  readonly expiresAt?: string;
  readonly paidAt?: string;
  readonly feeCents?: Cents;             // se o PSP informar
  /** payload cru do PSP, JÁ SANITIZADO: sem PAN, sem CVV, sem token de sessão. */
  readonly raw: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyWebhook() — função PURA. Sem I/O, sem escrita, sem efeito colateral.
// ─────────────────────────────────────────────────────────────────────────────
export interface WebhookInput {
  readonly headers: Readonly<Record<string, string>>;
  /** BYTES CRUS. O gateway do core não faz parse: a assinatura é sobre os bytes originais. */
  readonly rawBody: Uint8Array;
  readonly sourceIp: string;
}

export type WebhookVerdict =
  | { readonly valid: false; readonly reason: 'bad_signature' | 'unknown_event' | 'malformed' | 'stale' }
  | {
      readonly valid: true;
      readonly eventId: string;          // id do EVENTO no PSP — chave de deduplicação
      readonly eventType: string;        // taxonomia do PSP, só para log
      readonly providerRef: string;      // id da COBRANÇA no PSP
      readonly status: ChargeStatus;
      readonly amountCents: Cents;       // o valor REALMENTE recebido
      readonly currency: Currency;
      readonly feeCents?: Cents;
      readonly paidAt?: string;
      readonly disputeId?: string;       // quando status = 'disputed'
      readonly raw: Readonly<Record<string, unknown>>;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Erros — discriminados, com retentabilidade explícita
// ─────────────────────────────────────────────────────────────────────────────
export type GatewayErrorCode =
  | 'invalid_config'        // credencial ausente/errada        → não retentar, alertar admin
  | 'auth_failed'           // credencial rejeitada pelo PSP    → não retentar, alertar admin
  | 'invalid_request'       // payload rejeitado                → não retentar, bug nosso
  | 'method_unsupported'    // método não habilitado            → não retentar
  | 'amount_below_minimum' | 'amount_above_maximum'
  | 'payer_data_missing'    // ex.: CPF exigido para Pix        → pedir dado ao cliente
  | 'idempotency_conflict'  // mesma chave, payload diferente   → não retentar, bug nosso
  | 'not_found'
  | 'already_refunded'
  | 'refund_window_closed'
  | 'rate_limited'          // → retentar com backoff
  | 'provider_unavailable'  // 5xx/timeout do PSP               → retentar com backoff
  | 'unknown';

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly providerMessage?: string,
    readonly httpStatus?: number,
  ) { super(message); this.name = 'GatewayError'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexto entregue pelo host ao módulo
// ─────────────────────────────────────────────────────────────────────────────
export interface GatewayContext {
  readonly installationId: string;
  readonly config: Readonly<Record<string, unknown>>;  // validado contra o configSchema
  readonly secret: (key: string) => Promise<string>;   // cofre; NUNCA vem no config
  readonly log: (level: 'debug'|'info'|'warn'|'error', msg: string, meta?: object) => void;
  readonly now: () => Date;                            // injetado: testes determinísticos
  readonly sandbox: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// A INTERFACE
// ─────────────────────────────────────────────────────────────────────────────
export interface PaymentGatewayV1 {
  describe(ctx: GatewayContext): Promise<GatewayDescriptor>;
  /** Idempotente por input.idempotencyKey. Mesma chave + mesmo payload = mesma Charge. */
  createCharge(input: CreateChargeInput, ctx: GatewayContext): Promise<Charge>;
  getCharge(providerRef: string, ctx: GatewayContext): Promise<Charge>;
  cancelCharge(providerRef: string, ctx: GatewayContext): Promise<Charge>;
  refund(input: {
    readonly providerRef: string;
    readonly amountCents: Cents;              // parcial permitido se supportsPartialRefund
    readonly reason: string;
    readonly idempotencyKey: string;          // 'refund|<refund_id>'
  }, ctx: GatewayContext): Promise<{ readonly refundRef: string; readonly status: ChargeStatus; readonly raw: Readonly<Record<string, unknown>> }>;
  /** PURA. Valida a assinatura ANTES de devolver valid:true. Nunca confia no corpo. */
  verifyWebhook(input: WebhookInput, ctx: GatewayContext): Promise<WebhookVerdict>;
  /** Teste de conexão obrigatório na instalação (§6.6). Não move dinheiro. */
  healthCheck(ctx: GatewayContext): Promise<{ readonly ok: boolean; readonly detail: string }>;

  // ─── opcionais, declarados em describe() ───
  createMandate?(input: { payer: Payer; returnUrl: string; idempotencyKey: string },
                 ctx: GatewayContext): Promise<{ mandateId: string; status: 'pending'|'active'|'rejected'; authorizationUrl?: string }>;
  cancelMandate?(mandateId: string, ctx: GatewayContext): Promise<void>;
  tokenizeCard?(input: { payer: Payer; cardToken: string },
                ctx: GatewayContext): Promise<{ methodToken: string; brand: string; last4: string; expMonth: number; expYear: number }>;
  replayWebhook?(providerRef: string, ctx: GatewayContext): Promise<void>;
}
```

### 6.3 Host API — como o módulo liquida sem tocar na tabela do core

```ts
// packages/contracts/src/host/payments.ts — exposto em unix:///run/vp/host.sock
export interface SettlementFact {
  readonly provider: string;
  readonly installationId: string;
  readonly providerRef: string;
  readonly eventId: string;               // dedup (provider, providerRef, eventId)
  readonly status: ChargeStatus;
  readonly amountCents: Cents;            // o valor RECEBIDO, não o esperado
  readonly currency: Currency;
  readonly feeCents?: Cents;
  readonly paidAt?: string;
  readonly disputeId?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export type SettlementResult =
  | { readonly outcome: 'settled';        readonly paymentId: string; readonly ledgerEntryId: string; readonly creditedCents: Cents }
  | { readonly outcome: 'duplicate';      readonly paymentId: string }   // já processado: NO-OP idempotente
  | { readonly outcome: 'amount_mismatch';readonly paymentId: string; readonly expectedCents: Cents; readonly receivedCents: Cents; readonly creditedCents: Cents }
  | { readonly outcome: 'orphan';         readonly parkedId: string }    // dinheiro sem cobrança nossa
  | { readonly outcome: 'ignored';        readonly reason: string };     // status não terminal

export interface HostPaymentsApi {
  settle(fact: SettlementFact): Promise<SettlementResult>;
  /** falha/expiração/cancelamento: só muda o status; nunca mexe em saldo. */
  markFailed(f: { provider: string; providerRef: string; eventId: string; status: 'failed'|'expired'|'canceled'; failureCode?: string; raw: object }): Promise<{ outcome: 'updated'|'duplicate'|'orphan' }>;
  settleRefund(f: { provider: string; providerRef: string; refundRef: string; eventId: string; amountCents: Cents; raw: object }): Promise<SettlementResult>;
  openDispute(f: { provider: string; providerRef: string; disputeId: string; eventId: string; amountCents: Cents; raw: object }): Promise<SettlementResult>;
  closeDispute(f: { provider: string; disputeId: string; eventId: string; won: boolean; raw: object }): Promise<SettlementResult>;
}
```

**O que o CORE faz dentro de `settle()`, numa única transação `SERIALIZABLE`:**

```
1. Advisory lock por tenant (evita corrida entre webhook e polling).
2. INSERT em payment_events (provider, event_id) ON CONFLICT DO NOTHING.
   Se já existia → devolve { outcome: 'duplicate' } e ENCERRA. Webhook duplicado é regra, não exceção.
3. Localiza payments por (provider, provider_ref).
   Não achou → grava payment com orphan = true, NÃO credita nada, e joga na tela de conciliação.
              → devolve { outcome: 'orphan' }.  Dinheiro nunca some, mas também nunca entra às cegas.
4. Se status não for terminal ('pending','authorized') → 'ignored'.
5. Se amountCents ≠ payments.amount_cents:
     credita o RECEBIDO (dinheiro é dinheiro), marca divergência e alerta.
     → outcome 'amount_mismatch'.
6. UPDATE payments SET status, received_cents, fee_cents, paid_at.
7. INSERT ledger_entries:
     kind = 'topup' | 'commitment'
     bucket = 'recharge' | 'commitment'
     idempotency_key = 'topup|' || provider || '|' || provider_ref
     amount_cents = received_cents  (positivo)
     deferred = true, competence = NULL, revenue_recognized_at = NULL   ← §8
   UPDATE account_balances na MESMA transação.
8. Se purpose='commitment': cria/ativa commitments e environment_pricing com o desconto travado.
9. Emite evento de domínio 'payment.settled' → dunning.evaluate → religa ambiente suspenso, se houver.
10. COMMIT. Só então responde 200 ao PSP.
```

O módulo **não conhece nada disso**. Ele conhece uma função e três resultados possíveis.

### 6.4 Rota de webhook de entrada — o tipo de rota que faltava em `03` §2.2

```yaml
api:
  webhooks:
    - path: "/webhooks/pix"          # público: https://painel.veloz.app/api/v1/modules/pagamento-pix/webhooks/pix
      auth: none                     # a validação é do MÓDULO, via verifyWebhook()
      rawBody: true                  # o gateway NÃO faz parse: a assinatura é sobre os bytes originais
      maxBodyBytes: 262144
      rateLimit: "600/min"
      ipAllowlist: []                # configurável pelo super admin; vazio = qualquer origem
      timeoutMs: 5000
      persistRawFor: "30d"           # payment_events.raw_body — reprocessamento e defesa de disputa
```

O que o gateway do core garante **antes** de chamar o módulo, e que nenhum módulo reimplementa:
corpo cru intacto; limite de tamanho; rate limit; allowlist de IP; registro em `payment_events`
(incluindo os inválidos, com `signature_ok=false`); **resposta 200 imediata** se o evento já existir
(deduplicação antes do processamento); timeout com enfileiramento para retry; e o log de auditoria.

Fluxo completo, ponta a ponta:

```
PSP ──POST bytes crus──► vp-gateway ──rawBody──► módulo.verifyWebhook()  (puro, valida assinatura)
                              │                          │
                              │                    { valid, eventId, providerRef, status, amountCents }
                              │                          ▼
                              └──────────────► host.payments.settle(fact)
                                                         │
                                       CORE: dedup → payments → ledger_entries → account_balances
                                                         │
                                                  evento 'payment.settled'
                                                         ▼
                                        dunning.evaluate → religa ambiente suspenso
```

**Rede de segurança obrigatória — webhook não é confiável por natureza:** job `payments.poll`, a cada
**2 minutos**, chama `getCharge()` para toda cobrança `pending` criada nos últimos 60 min, e a cada
**30 minutos** para as demais até expirar. Se o polling descobrir uma cobrança paga cujo webhook não
chegou, ele chama o **mesmo** `settle()` com `eventId = 'poll|' + providerRef + '|' + paidAt` — a
deduplicação por `(provider, providerRef, eventId)` garante que webhook e polling nunca creditem duas
vezes o mesmo pagamento. Sem esse job, um webhook perdido = cliente que pagou e ficou suspenso. É o modo
de falha nº 1 de sistemas pré-pagos.

### 6.5 `module.yaml` de `mod-pagamento-pix` (exemplo real)

```yaml
apiVersion: veloz.panel/v1
kind: Module
metadata:
  name: mod-pagamento-pix
  version: 1.0.0
  displayName: "Pix (API Pix do BC via banco/PSP)"
  description: "Cobrança Pix com QR dinâmico, conciliação por txid e webhook assinado.
                Suporta Efí, Banco Inter, Banco do Brasil e Sicoob via mTLS."
  vendor: "VelozPanel"
  license: "Apache-2.0"
  icon: "ui/pix.svg"
  categories: [payment]
  scope: platform                    # não é por ambiente: é da plataforma

spec:
  core: { minVersion: "1.0.0", maxVersion: "<2.0.0", sdk: "1" }
  requires: []
  conflicts: []

  provides:
    capabilities:
      - name: payment.gateway
        version: "1"
        attributes:
          methods: ["pix"]
          currencies: ["BRL"]
          supportsRefund: true
          supportsPartialRefund: true
          supportsMandate: false     # Pix Automático fica para a v2 do módulo
          supportsTokenization: false
          minAmountCents: 5000       # R$ 50,00 — recarga mínima (§3.4)
          maxAmountCents: 5000000    # R$ 50.000,00
    meters: []                       # módulo de pagamento não gera unidade faturável

  nodeRequirements: {}               # roda só no control plane

  configSchema:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    properties:
      provider:      { type: string, enum: ["efi","inter","bb","sicoob"], default: "efi" }
      environment:   { type: string, enum: ["sandbox","production"], default: "sandbox" }
      client_id:     { type: string, minLength: 8, title: "Client ID" }
      pix_key:       { type: string, title: "Chave Pix recebedora" }
      expiration_seconds: { type: integer, minimum: 300, maximum: 86400, default: 3600 }
      payer_name_on_qr:   { type: string, default: "VELOZPANEL TECNOLOGIA" }
      require_tax_id:     { type: boolean, default: true,
                            description: "Exigir CPF/CNPJ do pagador (recomendado: antifraude e NFS-e futura)" }
      ip_allowlist:  { type: array, items: { type: string }, default: [] }
    required: [provider, environment, client_id, pix_key]

  secrets:                            # NUNCA no config; ficam no cofre
    - key: "client_secret"     label: "Client Secret"                 required: true
    - key: "certificate_p12"   label: "Certificado mTLS (.p12)"       required: true   format: "file/base64"
    - key: "certificate_pass"  label: "Senha do certificado"          required: false
    - key: "webhook_hmac"      label: "Segredo de assinatura do webhook" required: false

  service:
    image: "ghcr.io/velozpanel/mod-pagamento-pix:1.0.0"
    listen: "unix:///run/vp/mod-pagamento-pix.sock"
    healthcheck: { path: "/healthz", intervalSeconds: 15, timeoutSeconds: 3, failureThreshold: 3 }
    resources: { cpu: "0.25", memoryMB: 128 }

  api:
    basePath: "/api/v1/modules/pagamento-pix"
    routes:
      - { method: POST, path: "/test-charge", permission: "admin.billing.gateway.manage", audit: true, rateLimit: "6/min" }
    webhooks:
      - path: "/webhooks/pix"
        auth: none
        rawBody: true
        maxBodyBytes: 262144
        rateLimit: "600/min"
        ipAllowlist: []              # preenchido do config na habilitação
        timeoutMs: 5000
        persistRawFor: "30d"

  database:
    schema: mod_pagamento_pix
    migrations: "migrations/"        # só cache de txid e log do PSP; nada de saldo
    maxSchemaSizeMB: 128

  ui:
    entry: "ui/index.js"
    integrity: "sha384-..."
    mounts:
      - { slot: "admin.billing.gateways", id: "pix-config", label: "Pix", component: "PixGatewayConfig",
          permission: "admin.billing.gateway.manage" }
      - { slot: "client.topup.method",   id: "pix-checkout", component: "PixCheckout", order: 10 }

  permissions:
    - { key: "admin.billing.gateway.manage", label: "Configurar meios de pagamento", defaultRoles: ["superadmin"] }

  healthcheck:
    service: { httpPath: "/healthz", intervalSeconds: 15 }
    degradedPolicy: "disable_ui_writes"     # some do checkout, o core roteia para outro gateway

  uninstall:
    dataPolicy: "retain_then_purge"
    retentionDays: 90
    blockIf:
      - "pending_charges > 0"               # não desinstala com cobrança em aberto
      - "is_primary_for_any_method"         # não desinstala se é o único gateway de um método
    dropSchema: false

  telemetry:
    metrics: ["pix_charge_created_total","pix_webhook_received_total",
              "pix_webhook_invalid_signature_total","pix_settle_latency_seconds"]
  docs:
    operator: "docs/operator.md"     # obrigatório: como o DONO opera
    runbook:  "docs/runbook.md"      # obrigatório: o que fazer quando quebra

signature:
  algorithm: "cosign/sigstore"
  keyId: "velozpanel-modules-2026"
```

### 6.6 Instalação e configuração de um módulo de pagamento pelo painel

`/admin/financeiro/meios-de-pagamento`, em 7 passos, nenhum deles opcional:

1. **Catálogo** → `Instalar`. O core verifica assinatura cosign, `spec.core.minVersion` e conflitos.
2. **Migrations** do schema `mod_pagamento_*` (nunca tocam em `core` nem em `billing`).
3. **Configurar**: o formulário é **gerado do `configSchema`**; os campos de `secrets` são gravados no
   cofre e nunca mais são exibidos (só "substituir"). Não existe campo de credencial em `config`.
4. **Teste de conexão obrigatório**: o core chama `describe()` e `healthCheck()`. **Falhou, não habilita.**
5. **Cobrança de teste**: em `sandbox`, uma cobrança de R$ 0,01 ponta a ponta (criar → pagar → webhook →
   `settle()` → lançamento). O botão `Habilitar` só acende depois disso passar.
6. **Webhook**: o painel exibe a URL pública pronta para colar no PSP, com botões `Copiar`,
   `Enviar evento de teste` e `Reprocessar últimos 50 eventos`.
7. **Roteamento**: define prioridade por método, faixa de valor e status. Um método pode ter vários
   gateways com ordem de fallback. Um deles é `primary`.

```sql
CREATE TABLE billing.gateway_installations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_slug     text NOT NULL,
  provider        text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  config          jsonb NOT NULL,           -- validado contra configSchema; SEM segredo
  descriptor      jsonb NOT NULL,           -- resultado do último describe()
  sandbox         boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'configured'
                  CHECK (status IN ('configured','testing','enabled','degraded','disabled')),
  last_health_at  timestamptz, last_health_ok boolean, last_health_detail text,
  webhook_path    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing.gateway_routes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method          text NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'BRL',
  gateway_installation_id uuid NOT NULL REFERENCES billing.gateway_installations(id),
  priority        int NOT NULL DEFAULT 100,          -- menor = tentado antes
  min_amount_cents bigint NOT NULL DEFAULT 0,
  max_amount_cents bigint,
  active          boolean NOT NULL DEFAULT true,
  UNIQUE (method, currency, gateway_installation_id)
);
CREATE UNIQUE INDEX gateway_primary ON billing.gateway_routes (method, currency)
  WHERE active AND priority = 0;
```

**Desabilitar** um gateway é bloqueado enquanto houver cobrança `pending` dele, e nunca remove o
histórico — `payments` guarda `provider` e `provider_ref` para sempre, porque é o que a conciliação e a
defesa de chargeback precisam três anos depois.

### 6.7 `mod-pagamento-fake` — o teste que prova que a modularidade é real

Módulo de PSP fictício, empacotado com o core, **habilitado só em `NODE_ENV=test` e em staging**.

```ts
// modules/mod-pagamento-fake/src/gateway.ts
import type { PaymentGatewayV1, Charge, GatewayContext, CreateChargeInput,
              WebhookInput, WebhookVerdict, GatewayDescriptor } from '@velozpanel/contracts/payment-gateway/v1';
import { GatewayError } from '@velozpanel/contracts/payment-gateway/v1';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Comportamento dirigido por config, para o CI exercitar TODOS os caminhos. */
type FakeConfig = {
  autoApproveAfterMs: number;        // default 3000
  behavior: 'approve' | 'decline' | 'expire' | 'timeout' | 'duplicate_webhook'
          | 'amount_mismatch' | 'orphan' | 'late_webhook' | 'dispute';
  mismatchDeltaCents?: number;
};

export const gateway: PaymentGatewayV1 = {
  async describe(): Promise<GatewayDescriptor> {
    return {
      provider: 'fake', displayName: 'PSP Fictício (teste)', capabilityVersion: '1',
      methods: ['pix', 'card', 'boleto'], currencies: ['BRL'],
      supportsRefund: true, supportsPartialRefund: true, supportsMandate: true,
      supportsTokenization: true, supportsWebhookReplay: true,
      minAmountCents: 1n, maxAmountCents: null,
      feeModel: [{ method: 'pix', fixedCents: 199n, percentBp: 0, settlementDays: 0 }],
      sandbox: true,
    };
  },

  async createCharge(input: CreateChargeInput, ctx: GatewayContext): Promise<Charge> {
    const cfg = ctx.config as FakeConfig;
    if (input.amountCents <= 0n) throw new GatewayError('invalid_request', 'amount must be > 0', false);
    if (cfg.behavior === 'timeout') throw new GatewayError('provider_unavailable', 'simulated timeout', true);
    const ref = `fake_${input.idempotencyKey}`;          // idempotência trivial e verificável
    scheduleWebhook(ref, input, cfg, ctx);               // dispara o(s) webhook(s) no futuro
    return {
      providerRef: ref, status: 'pending', amountCents: input.amountCents,
      currency: input.currency, method: input.method,
      pix: { copiaECola: `00020126FAKE${ref}`, txid: ref },
      expiresAt: new Date(ctx.now().getTime() + 3_600_000).toISOString(),
      raw: { simulated: true, behavior: cfg.behavior },
    };
  },

  async verifyWebhook(i: WebhookInput, ctx: GatewayContext): Promise<WebhookVerdict> {
    const secret = await ctx.secret('webhook_hmac');
    const sent = Buffer.from(i.headers['x-fake-signature'] ?? '', 'hex');
    const calc = createHmac('sha256', secret).update(i.rawBody).digest();
    if (sent.length !== calc.length || !timingSafeEqual(sent, calc))
      return { valid: false, reason: 'bad_signature' };   // o CI TEM um caso que cai aqui
    const e = JSON.parse(Buffer.from(i.rawBody).toString('utf8'));
    return { valid: true, eventId: e.event_id, eventType: e.type, providerRef: e.charge_id,
             status: e.status, amountCents: BigInt(e.amount_cents), currency: 'BRL',
             feeCents: 199n, paidAt: e.paid_at, raw: e };
  },

  async getCharge(ref, ctx) { /* espelha o estado simulado — alimenta o job payments.poll */ },
  async cancelCharge(ref, ctx) { /* ... */ },
  async refund(i, ctx) { /* ... */ },
  async healthCheck() { return { ok: true, detail: 'fake gateway sempre saudável' }; },
};
```

**Os 10 testes de aceitação que rodam no CI** (falhou um, o build quebra):

| # | Cenário | Resultado esperado |
|---|---|---|
| 1 | Recarga feliz: criar → webhook → creditar | saldo +R$ 100,00; 1 lançamento `topup`; ambiente suspenso volta a `active` |
| 2 | Webhook duplicado (mesmo `event_id`) | `outcome='duplicate'`; **exatamente 1** lançamento |
| 3 | Webhook com `event_id` diferente e mesmo `provider_ref` | `duplicate` por `(provider, provider_ref)` já liquidado; 1 lançamento |
| 4 | Assinatura inválida | HTTP 400; `payment_events.signature_ok=false`; **zero** lançamento; alerta |
| 5 | Valor divergente (paga R$ 90 numa cobrança de R$ 100) | credita **R$ 90,00**; `amount_mismatch`; linha na conciliação |
| 6 | Pagamento órfão (`provider_ref` desconhecido) | `orphan`; zero crédito; linha vermelha na conciliação; **dinheiro não some** |
| 7 | Webhook nunca chega, polling descobre | `payments.poll` liquida com `eventId='poll\|...'`; 1 lançamento |
| 8 | Webhook chega **depois** do polling | `duplicate`; continua 1 lançamento |
| 9 | Reembolso total e parcial | lançamentos `refund` negativos; saldo bate |
| 10 | Chargeback pós-consumo | lançamento `chargeback`; saldo negativo permitido; conta em `risk_hold` |

**Teste 11, o mais importante — o de fachada:**
> O fluxo completo "cliente recarrega → cobrança criada → webhook recebido → saldo creditado → ambiente
> suspenso religado" roda ponta a ponta com `mod-pagamento-fake`, **sem uma única linha no core mencionando
> Asaas, Pix, Stripe ou Mercado Pago**. O `grep` de §6.1 roda no mesmo job e precisa retornar zero.

---

## 7. Módulos de pagamento a construir, e em que ordem

**Pix é obrigatório** (ADENDO §C + evidência de `01` §A.2.2: 15 de 15 recargas reais observadas no Hostoo
foram Pix). **NF-e está fora do MVP**, então a emissão de nota **não pode ser critério de escolha de PSP** —
o que elimina o principal argumento a favor do Asaas em `02` §4.4 e obriga a refazer a comparação.

### 7.1 Comparação com os dois critérios que restam: custo por transação e esforço

Cenário de custo: **recarga média de R$ 120**, **30 recargas/mês** no ano 1, **300/mês** no ano 3.

| PSP | Taxa Pix | Custo/mês (30 rec.) | Custo/mês (300 rec.) | Cartão | Chargeback | Esforço de integração | Observação |
|---|---|---:|---:|---|---|---|---|
| **Asaas** | **R$ 1,99** fixo (promo R$ 0,99) | R$ 59,70 | R$ 597,00 | R$ 0,49 + 2,99% | sim (cartão) | **Baixo — 1 a 2 dias.** REST + token Bearer, sandbox real, webhook com token próprio, sem certificado | Pix + boleto + cartão + estorno numa API só. Uma superfície de conciliação |
| **Mercado Pago** | **0,99%** do valor | R$ 35,64 | R$ 356,40 | 3,79%–4,98% | sim | **Médio — 3 a 5 dias.** API extensa, muitos conceitos herdados do marketplace | Vence em recarga pequena; perde em recarga grande (R$ 500 → R$ 4,95 contra R$ 1,99) |
| **Pix direto (Efí / Inter / BB / Sicoob)** | **R$ 0,00–0,99** | **R$ 0,00–29,70** | **R$ 0,00–297,00** | não tem | **zero** | **Alto — 5 a 8 dias.** mTLS com `.p12`, OAuth, EVP/txid, e a API muda por banco | Mais barato de todos e sem chargeback. Só Pix |
| **Stripe BR** | ~1,19% | R$ 42,84 | R$ 428,40 | 3,99% + R$ 0,39 | sim | **Médio.** A melhor DX do mercado | Billing metered nativo (+0,7%) que **não vamos usar** — nosso metering é caseiro (`02` §4.4). Repasse e enquadramento BR piores |
| Pagar.me / Iugu / Vindi | % variável | — | — | sim | sim | Médio | Sem vantagem que justifique. Fora |

**Ponto de virada Asaas × Mercado Pago:** `1,99 = 0,0099 × V` → **R$ 201**. Abaixo de R$ 201 por recarga o
Mercado Pago é mais barato; acima, o Asaas. Como o valor sugerido padrão é R$ 100 e a média esperada é
R$ 120, **o Mercado Pago é ~R$ 24/mês mais barato no ano 1** — irrelevante contra 2 a 3 dias a mais de
integração.

**Ponto de virada Asaas × Pix direto:** economia = `R$ 1,99 × N`. Vira R$ 500/mês em **N ≈ 250
recargas/mês**. Esse é o gatilho numérico para construir o módulo do banco direto — e a beleza da
arquitetura de §6 é que trocar de PSP passa a ser **instalar outro módulo e mudar a prioridade da rota**,
não uma migração.

### 7.2 Ordem de construção

| Ordem | Módulo | Quando | Gatilho / motivo | Esforço |
|---|---|---|---|---|
| **1** | **`mod-pagamento-fake`** | **antes de qualquer PSP real** | É o teste que prova que o core não está acoplado. Construir depois do Asaas é garantir que o Asaas vaze para o core | 1 dia |
| **2** | **`mod-pagamento-asaas`** (só Pix ligado) | **MVP** | Menor esforço com Pix funcionando; sandbox honesto; boleto e cartão já no mesmo módulo, desligados por flag | 2 dias |
| **3** | `mod-pagamento-asaas` — cartão tokenizado + recarga automática | **v1** | Resolve a suspensão por esquecimento, que é a causa nº 1 de churn involuntário. Sujeito aos limites de exposição de P13 | 2 dias |
| **4** | `mod-pagamento-pix` (banco direto: Efí ou Inter) | **v1.5** | **Gatilho: > 250 recargas/mês.** Economia ≥ R$ 500/mês e chargeback zero | 5–8 dias |
| **5** | `mod-pagamento-mercadopago` | **v2** | **Gatilho: aprovação de cartão < 85% no Asaas** ou recarga média < R$ 150 sustentada | 3–5 dias |
| **6** | Pix Automático | **v2** | Dentro do módulo do PSP que já tiver homologação do BC. Não é módulo novo | 3 dias |
| **7** | `mod-pagamento-stripe` | **só sob demanda** | **Gatilho: primeiro cliente que paga em USD/EUR.** Antes disso, zero valor | 3 dias |

**Recomendação única:** **Asaas no MVP, com Pix**. Não porque emite nota (não vamos emitir), mas porque é
a única que entrega Pix + boleto + cartão + estorno + sandbox com **uma** integração de 2 dias, sem
certificado, sem taxa de setup e sem mensalidade — e porque uma superfície de conciliação é
administrável por uma pessoa, enquanto três não são. A diferença de custo contra a alternativa mais
barata é de **R$ 60/mês no ano 1**, que é ruído contra o custo fixo de R$ 1.033.

**O que NÃO fazer:** Stripe Billing, Lago, OpenMeter ou qualquer motor de billing externo. Nosso metering
tem 8,5 M amostras/mês e o Postgres do control plane resolve (`02` §4.4, §2.7 deste documento). Stripe
Billing cobraria +0,7% sobre tudo para fazer o que 300 linhas de SQL fazem melhor, com nossos meters.

---

## 8. Guardar hoje o que a nota fiscal exigirá amanhã

NFS-e está fora do MVP (ADENDO §C). O que **não** pode acontecer é descobrir, no dia em que ela entrar,
que falta a competência de cada lançamento ou o código IBGE do município do cliente — e ter que
reprocessar dois anos de razão. Estes campos custam **zero** hoje e custam uma migração dolorosa depois.

### 8.1 No cadastro (`core.tenants` + `billing.tax_profiles`)

```sql
CREATE TABLE billing.tax_profiles (
  tenant_id            uuid PRIMARY KEY REFERENCES core.tenants(id),
  person_type          text NOT NULL CHECK (person_type IN ('pf','pj','foreign')),
  tax_id               text,            -- CPF/CNPJ só dígitos, criptografado em repouso
  tax_id_type          text CHECK (tax_id_type IN ('cpf','cnpj','passport','vat')),
  legal_name           text,            -- razão social / nome civil
  trade_name           text,            -- nome fantasia
  municipal_registration text,          -- inscrição municipal
  state_registration   text,
  tax_regime           text CHECK (tax_regime IN ('mei','simples_nacional','lucro_presumido','lucro_real','pf')),
  iss_withheld_by_taker boolean NOT NULL DEFAULT false,  -- tomador é substituto tributário
  -- endereço fiscal completo
  zip                  text,
  street               text, street_number text, complement text, district text,
  city                 text, state_uf char(2), country_code char(2) NOT NULL DEFAULT 'BR',
  -- >>> O CAMPO QUE TODO MUNDO ESQUECE E QUE A NFS-e NACIONAL EXIGE <<<
  municipality_ibge_code char(7),       -- 7 dígitos, ex.: 3550308 = São Paulo
  country_bacen_code   text,            -- exterior
  nfse_email           citext,
  nfse_consent         boolean NOT NULL DEFAULT true,
  validated_at         timestamptz,     -- consulta de CNPJ/CPF já feita
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Regra de UX que decorre disso (`01` §A.2.6 item 4):** não pedir CPF, endereço e IBGE no primeiro Pix de
R$ 50. Pedir **quando** houver necessidade fiscal, e permitir completar depois. O schema aceita nulo hoje
porque a nota não existe; quando existir, o job de emissão bloqueia por **falta de dado**, não por falta
de coluna — e a UI pede exatamente o que falta.

### 8.2 No lançamento (colunas já presentes em `ledger_entries`, §2.8)

| Coluna | Para que serve na nota | Preenchida desde o dia 1 por |
|---|---|---|
| `competence` (date) | **Competência da NFS-e.** Sem isso, agregar consumo por mês depois é adivinhação | job `ledger.post_hour`, para `kind='usage'` |
| `revenue_recognized_at` | Momento do fato gerador do ISS | idem |
| `deferred` (bool) | Recarga/compromisso = **adiantamento de cliente**, receita diferida, **não** fato gerador | `settle()` marca `true` |
| `nfse_id` via `ledger_fiscal_link` | Vínculo lançamento ↔ nota, sem violar o append-only | job fiscal, futuro |
| `environment_id` | Discriminação do serviço na nota | sempre |
| `description` | Descrição do serviço | sempre |

### 8.3 No documento fiscal (tabela criada agora, vazia até a nota entrar)

```sql
CREATE TABLE billing.fiscal_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES core.tenants(id),
  kind               text NOT NULL DEFAULT 'nfse' CHECK (kind IN ('nfse','nfse_cancel','nfse_replace')),
  competence         date NOT NULL,
  gross_cents        bigint NOT NULL,
  deductions_cents   bigint NOT NULL DEFAULT 0,
  net_cents          bigint NOT NULL,
  -- serviço
  service_code_lc116 text,          -- '1.03' — processamento/armazenamento/hospedagem de dados
  service_code_municipal text,
  cnae               text,
  service_municipality_ibge char(7),-- município de incidência do ISS
  -- tributos, todos em centavos, todos bigint, todos anuláveis
  iss_rate_bp        int,  iss_cents   bigint,  iss_withheld boolean NOT NULL DEFAULT false,
  pis_cents bigint, cofins_cents bigint, csll_cents bigint, irrf_cents bigint, inss_cents bigint,
  -- Reforma Tributária: obrigatórios na NFS-e desde 01/01/2026
  cst                text,          -- código de situação tributária
  classificacao_tributaria text,    -- cClassTrib
  ibs_uf_rate_bp int,  ibs_uf_cents  bigint,
  ibs_mun_rate_bp int, ibs_mun_cents bigint,
  cbs_rate_bp    int,  cbs_cents     bigint,
  -- emissão
  provider           text,          -- quem emitiu (PSP, prefeitura, gateway fiscal) — plugável
  number text, series text, verification_code text, access_key text,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','issued','rejected','canceled','replaced')),
  rejection_reason   text,
  pdf_url text, xml_url text,
  replaces_document_id uuid REFERENCES billing.fiscal_documents(id),
  issued_at timestamptz, canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, competence, kind)
);
```

### 8.4 As cinco regras que evitam a migração dolorosa

1. **Nunca apagar `ledger_entries`.** Já garantido (§2.5). A nota se emite a partir do razão.
2. **`competence` e `revenue_recognized_at` preenchidos desde o primeiro lançamento**, mesmo sem nota.
3. **`deferred = true` em toda recarga e todo compromisso.** É o que separa caixa de receita e o que
   torna a decisão de P12 (nota no consumo, não na recarga) implementável sem reprocessar nada.
4. **`municipality_ibge_code` no cadastro** desde o dia 1, mesmo nulo. Derivar de CEP depois é uma tabela
   de-para de 5.570 linhas e um monte de exceção.
5. **Emissão fiscal também é módulo** (`nfse.issuer v1`), na mesma forma de §6 — o core registra
   `fiscal_documents`, o módulo fala com prefeitura/Nacional/gateway. Não repetir o acoplamento que a
   crítica encontrou no pagamento. **Não construir agora**, mas reservar o nome da capability.
6. **Retenção fiscal de 5 anos** é exceção legítima ao direito de eliminação da LGPD (art. 16, I) e já
   está prevista em §5.3 e na Política de Privacidade.

---

## 9. Telas de billing do super admin

Ratifica `01` §A.9 e fecha as fórmulas. **Toda tela abaixo tem uma métrica definida em SQL, não em
opinião** — métrica financeira sem definição é a origem de metade das brigas com o contador.

### 9.1 `/admin/financeiro` — DRE e visão de topo

Num modelo pré-pago, **MRR não existe**. Os três números que existem são diferentes e não podem ser
confundidos:

| Métrica | Definição | SQL |
|---|---|---|
| **Caixa do mês** | dinheiro que entrou | `Σ payments.received_cents WHERE status='succeeded' AND paid_at IN mês` |
| **Receita reconhecida** | serviço efetivamente prestado | `Σ -ledger_entries.amount_cents WHERE kind='usage' AND competence = mês` |
| **Run-rate horário** | receita se tudo continuar como está agora | `Σ tarifa horária das janelas abertas × 720` |
| **Passivo de saldo** | dinheiro do cliente que ainda não virou serviço | `Σ account_balances.balance_cents` (todos os buckets) |
| Margem bruta | receita reconhecida − custo de infra do mês | §9.2 |
| **Fração ativa da frota** | o número de §3.8 | `Σ minutos ativos / Σ minutos provisionados` no mês |

Alertas obrigatórios na tela, com os limiares de **§3.10** (frota real de 2 nós): **fração ativa < 70%**;
ocupação < 90%; **desconto médio > 10%**; horas de suporte > 3,5/mês; **ambientes ativos < 17**; e os
quatro gatilhos de contratação do nó maior de §3.10.9, cada um com o seu contador de dias.

### 9.2 `/admin/financeiro/margem-por-no` — a tela que decide onde comprar o próximo nó

Uma linha por nó, alimentada por `node_costs`:

| Coluna | Fórmula |
|---|---|
| Custo do nó | `node_costs.monthly_cost_cents` |
| RAM alocável / provisionada / **ativa agora** | de `nodes` + soma das janelas abertas |
| Ambientes provisionados / ativos / pausados | contagem por estado |
| **Razão de commit efetiva** | `RAM provisionada ÷ RAM alocável` (alvo 1,30) |
| Receita reconhecida do nó | `Σ usage` dos ambientes que estavam no nó no período |
| **Margem do nó** | receita − custo do nó − rateio do CP − backup |
| **Margem por GB de RAM** | margem ÷ RAM provisionada — **é o número que compara VPS de 16 GB com dedicado de 64 GB** |
| Cota de banda | consumido / cota, com alerta em 70% (Achado 6.4) |
| Ambientes enfileirados no `start` | o SLO de §3.3 |

### 9.3 `/admin/financeiro/compromissos` — passivo de serviço

Lista com cliente, ambiente, prazo, desconto travado, pago, **saldo dedicado restante (= passivo)**,
consumo × contratado, término aproximado, validade do desconto. Totalizadores:
**passivo total**, **receita diferida projetada por mês pelos próximos 12 meses**, **margem projetada**
(receita a reconhecer − custo de infra do horizonte) e o **indicador da regra de caixa de §4.4**
(*"% do caixa de compromissos já consumido em custeio"*, com alerta acima de 50%).

### 9.4 `/admin/financeiro/conciliacao`

Abas por gateway. Colunas: data, `provider_ref`, valor no PSP, valor no razão, taxa, cliente, status,
**divergência**. Filtros que importam, em ordem de gravidade:

1. **Órfãos no PSP** (`payments.orphan = true`) — **dinheiro entrou e não creditamos. O pior caso.**
2. Divergência de valor (`amount_mismatch`).
3. Webhooks com assinatura inválida (`payment_events.signature_ok = false`).
4. Webhooks não processados (`processed_at IS NULL`).
5. Cobranças `pending` há mais de 24 h.
6. Créditos no razão sem pagamento correspondente.

Ações: **reprocessar webhook** (usa o `raw_body` retido por 30 d), creditar manualmente com motivo,
marcar como conciliado, exportar CSV para o contador. Painel de saúde: webhooks perdidos em 24 h, latência
mediana de liquidação Pix, taxa de aprovação de cartão. **Tela de checagem diária obrigatória do dono.**

### 9.5 `/admin/financeiro/inadimplencia`

Fila priorizada por urgência (runway < 24 h / < 3 d / < 7 d), contas em carência com contador, suspensas
com dias até arquivamento e exclusão, saldo negativo. Colunas: cliente, saldo por bucket, runway,
gasto/mês, ambientes afetados, LTV, tem recarga automática, último contato.
Ações em massa: notificar, **conceder cortesia** (com motivo, valor e **teto por admin**), estender
carência, suspender agora, **abortar exclusão agendada**.
**Fila de exclusão em destaque, com as 6 guardas de §5.2 visíveis por linha** — quando uma guarda está
ativa, a linha mostra por que aquele cliente **não** será excluído.

### 9.6 `/admin/financeiro/reembolsos`

Fila com cliente, transação de origem, valor pedido, **valor calculado pela política com a conta de
recomposição aberta** (§4.3), motivo, tempo desde a compra, histórico de reembolsos do cliente, flag
CDC-7d. Ações: aprovar em dinheiro, converter em crédito, recusar com justificativa. **Alçada por valor**
(acima de R$ 500 exige segundo aprovador) e prazo de resposta visível.
Aba **Chargebacks**: disputas abertas, prazo de defesa, evidências anexadas automaticamente (logs de
acesso, IP das sessões, uso real medido — é exatamente para isso que `usage_samples` existe), resultado.
Todo chargeback marca a conta com risco e bloqueia indicações pendentes.

### 9.7 `/admin/planos` e `/admin/financeiro/meios-de-pagamento`

- **Planos:** CRUD de `price_tables` (o preço real) e `plan_presets` (a vitrine), com **versionamento por
  vigência** e **simulação obrigatória antes de publicar** — *"esta mudança afeta 21 ambientes; o run-rate
  vai de R$ 1.376 para R$ 1.512 (+9,9%); 6 clientes com compromisso ativo ficam grandfathered"*. Publicar
  preço sem simular é `DROP TABLE` sem `WHERE`.
- **Meios de pagamento:** o fluxo de 7 passos de §6.6, mais o roteamento por método e a saúde de cada
  gateway.

### 9.8 O que muda nas telas já previstas

- **Dashboard (`01` §6.1):** acrescentar `Passivo de saldo`, `Passivo de compromissos`, `Contas em
  carência`, `Divergências de conciliação hoje` e **`Fração ativa da frota`**.
- **Alterar vCPU/RAM (`01` §6.4):** mostrar o impacto financeiro antes de aplicar (nova tarifa, efeito no
  término do compromisso em dias) e o interruptor **cobrar / não cobrar** com motivo obrigatório (P11).
- **Cliente `/admin/clientes/{id}/financeiro`:** saldo por bucket, razão completo, botão de conferência,
  cortesias com motivo, compromissos, reembolsos, risco.

---

## 10. Riscos, o que pode dar errado, e os critérios de aceite

### 10.1 Riscos de billing, com mitigação

| # | Risco | Prob × Impacto | Mitigação |
|---|---|---|---|
| BR1 | **Webhook perdido → cliente pagou e foi suspenso** | Alta × Alto | Job `payments.poll` a cada 2 min (§6.4). É a mitigação mais importante do documento |
| BR2 | **Divergência entre saldo e razão** | Média × Crítico | Append-only em 3 camadas + `ledger.verify` diário que **bloqueia débitos** ao divergir 1 centavo (§2.5) |
| BR3 | **Cobrança durante indisponibilidade** → chargeback e Procon | Média × Alto | Congelamento por nó `unreachable` + crédito de SLA automático (§2.3) |
| BR4 | **Overselling de RAM: todos retomam ao mesmo tempo** | Média × Alto | Razão de commit 1,30× + admission control + SLO de fila de `start` (§3.3). **Com 2 nós a folga caiu: teto de 17 ativos contra 22 vendidos** (§3.10.2) |
| BR12 | **Perda de um nó = metade da capacidade.** Com 2 nós não existe N-1 | Média × **Crítico** | Medidor congela (custo financeiro irrisório, §3.10.10); **nó de teste promovido a produção dentro do RTO de 12 h**; `node.evacuate` ensaiado trimestralmente **no nó de teste**; limite de 12 clientes na fase 1. O risco real é churn, não receita perdida |
| BR13 | **Vender acima do que a frota comporta** por não haver limite explícito | Alta × Alto | Teto de 22 ambientes no admission control **e** teto comercial de 15 na fase 1 (§3.10.8), com bloqueio no funil de criação |
| BR5 | **Desconto composto passar do teto** (compromisso + cupom + indicação) | Alta × Médio | CHECK ≤ 2500 bp em `commitments` e `coupons` + guard no motor de preço somando tudo (§3.9) |
| BR6 | **Passivo de compromisso gasto em custeio** | Média × Crítico | Regra dos 50% + tela §9.3 com alerta (§4.4) |
| BR7 | **Chargeback pós-consumo em cartão de conta nova** | Média × Médio | Limites de exposição de P13; Pix em destaque; cartão só a partir de R$ 50 |
| BR8 | **Exclusão indevida de dados de cliente** | Baixa × Crítico | 6 guardas de §5.2 + janela de 24 h + botão de abortar + prova de entrega dos avisos |
| BR9 | **Módulo de pagamento acoplado ao core sob pressão de prazo** | **Alta** × Crítico | `mod-pagamento-fake` construído **antes** do Asaas + `grep` de fachada no CI (§6.1) |
| BR10 | **Drift de arredondamento sub-centavo** | Alta × Baixo | Millicents + `carry_millicents` por ambiente; erro acumulado exatamente zero (§2.5) |
| BR11 | **Egress não medido estoura a cota da VPS** | Média × Alto | Meter `env.egress.gb` no MVP, não em v2; franquia 1 TB; limite na borda; alerta em 70% (P17) |

### 10.2 Benchmark obrigatório antes do primeiro cliente pagante

Complementa o **B10 (metering)** do item 11 da ordem de marcha do Ciclo 2:

> **B10 — Fidelidade do metering.** Simular 72 h de operação com 10 ambientes, executando: 40 pausas e
> retomadas, 6 resizes (3 pelo cliente, 3 pelo admin), 2 quedas de nó de 20 min, 1 agente mudo por 40 min,
> 1 ambiente em `error` por 3 h. **Critérios de aceite:**
> 1. `Σ ledger_entries = Σ usage_rollups` ao centavo;
> 2. divergência entre `state_windows` e `usage_samples` ≤ 2 min em 100% das horas com o nó saudável;
> 3. **zero** cobrança nas janelas de nó indisponível e de `error`;
> 4. reenviar 100% das amostras do agente **não** altera um único centavo;
> 5. drift de arredondamento em 72 h = **R$ 0,00**;
> 6. o extrato do cliente reproduz o total exato, e o botão "Conferir saldo" fecha.

E, junto com ele, o **teste de fachada** (§6.1) e os **11 testes de `mod-pagamento-fake`** (§6.7) no CI.

### 10.3 O que este documento pede que o dono decida

| # | Decisão que só o dono toma | Impacto se ficar em aberto |
|---|---|---|
| D1 | ~~Validar produto ou gerar renda?~~ **RESPONDIDO pelo ADENDO 3 §I: validação.** O que resta decidir é **por quanto tempo** o prejuízo de R$ 700–850/mês é aceitável | Define quando o gatilho de §3.10.9 tem de disparar, mesmo sem demanda |
| D2 | **Aceita que, com 2 nós, não existe ponto de equilíbrio contando o próprio tempo** (−R$ 162/mês no melhor cenário possível)? | É o número mais importante do documento. Precisa ser escolha, não descoberta |
| D3 | Aceita **suspender a escada de desconto na fase 1** (teto de 10%, sem compromisso de 12 meses)? | A 22% o compromisso queima toda a margem de caixa e congela preço sobre infra que será trocada |
| D4 | ~~Tirar Turbo e Max do catálogo?~~ **RATIFICADO pelo ADENDO 3 §H** | — |
| D7 | Aceita o **limite de 12 clientes / 15 ambientes** e a lista de recusa da fase 1 (§3.10.8)? | Sem limite explícito, a frota lota antes de a operação estar madura, e o primeiro incidente pega 22 clientes em vez de 12 |
| D8 | Aceita **não prometer SLA numérico** e publicar status page com uptime real (§3.10.10)? | Prometer 99,9% sobre 2 VPS é criar passivo contra si mesmo |
| D9 | Aceita que o **próximo nó seja de 64 GB, não mais uma VPS de 16 GB**, disparado pelo gatilho de §3.10.9? | É a decisão que separa laboratório de negócio: −R$ 1 vira +R$ 1.285/mês |
| D5 | **Confirmar com contador** a decisão P12 (NFS-e no consumo, por competência) | Não bloqueia o MVP; bloqueia a ativação da nota |
| D6 | Aceita **Asaas** como PSP do MVP, sabendo que a nota não é mais o critério? | Sem decisão, não há módulo de pagamento no MVP |

---

## 11. Correções que este documento faz em documentos anteriores

| Documento | O que dizia | Correção |
|---|---|---|
| `01` §A.4.5 | Start R$ 29,90 · Light R$ 49,90 · Plus R$ 89,90 · Pro R$ 159,90 · Turbo R$ 289,90 · Max R$ 529,90 | **R$ 30,50 / 49,00 / 98,00 / 172,00**; **Turbo e Max saem do catálogo**. Preço passa a ser derivado dos unitários (§3.4) |
| `01` §A.4.5 | "3 servidores de 128 GB / 32 threads · ~120 ambientes por nó · ~360 no total" | **11 ambientes por nó · 33 na frota** (VPS de 16 GB, mix realista, commit 1,30×) — §3.3 |
| `01` §A.3.7 | Compromisso 3/6/12 meses a **15% / 25% / 35%** | **8% / 15% / 22%**, teto absoluto de 25% somando tudo. Os 35% dão prejuízo de R$ 3,18/ambiente/mês (§3.9) |
| `01` §A.2.6 / §A.3.3 | "mês contábil = 720 h" com preço mensal anunciado | 720 h mantidas, mas **o preço primário exibido passa a ser R$/hora** (P2) |
| `01` §A.10 item 10 | "Não existe Fatura no modelo pré-pago" | **Ratificado e levado ao schema:** `core.invoices` e `core.invoice_items` **saem do MVP** (B10) |
| `03` §4.2 | `plans.price_hour_cents` gravado no plano | Substituído por `price_tables` + `price_items` + `environment_pricing` versionados. Preço no plano quebra o requisito nº 9 e o grandfathering |
| `03` §4.2 | `usage_events` como base do faturamento | Rebatizada `usage_samples` e **rebaixada a instrumento de reconciliação**. A fonte de verdade é `state_windows` (§2.3) |
| `03` §4.2 | `transactions` genérica | Desdobrada em `payments` (movimento com PSP) + `ledger_entries` (razão append-only). Confundir as duas é o bug clássico de billing |
| `03` §6.3 | "Webhook de PSP (entrada)" como mecanismo do core | **Removido.** Vira o tipo de rota `webhooks:` do manifesto de módulo (§6.4) |
| `02` §4.4 | "Asaas porque emite NF-e a R$ 0,49" | **Argumento inválido** — NF-e saiu do escopo (ADENDO §C). Asaas continua recomendado, mas por esforço de integração e superfície única de conciliação (§7.1) |
| `02` §4.4 item 3 | "se esteve running em qualquer momento da hora, cobra a hora cheia" | **Refutado.** Minuto, com piso de 5 min por ativação (P1). Hora cheia contradiz "pause e economize" |
| `02` §4.4 item 5 | "pausa automática em D+3, retenção 15 d, purga em 30 d" | Substituído pela escada de §5.1: carência 72 h → suspensão → arquivamento D+30 → exclusão D+60 |
| crítica §6.1 | 66 ambientes · margem bruta de teto ~R$ 1.320/mês | **33 ambientes · teto ~R$ 712/mês.** A crítica supôs a base inteira em 512 MB; com o mix realista de planos a densidade cai pela metade e o preço médio sobe (§3.3, §3.6) |
| crítica §6.1 item 3 | "pausado a ~20% do ativo" | **Discordo no preço, concordo no diagnóstico.** Pausado fica em ~10% (só disco); o problema de capacidade se resolve com razão de commit, não com preço (P5, §3.8) |
| crítica §6.1 item 2 | "recarga mínima de R$ 100" | **R$ 50 de mínimo, R$ 100 pré-selecionado.** Mesmo efeito na taxa efetiva, sem barreira de entrada (§3.4) |
| **este documento, §3.3–§3.9** (1ª versão) | 3 nós de produção · 33 ambientes · equilíbrio em 16 ativos (44% da frota) · teto de margem ~R$ 720/mês · desconto até 25% | **SUPERADO pelo ADENDO 3 §G.** 2 nós de produção + 1 de teste como despesa: **22 ambientes · equilíbrio em 17 ativos (94% do teto) · teto de margem +R$ 88/mês · desconto de fase 1 em 10%** (§3.10) |
| `03` R10 | "nunca alocar acima de N-1; com 3 nós, teto de ~66% de ocupação" | **Definitivamente morto.** Com 2 nós, N-1 significaria descartar 50% de uma capacidade que já não fecha a conta. Substituído por **RTO declarado de 12 h + nó de teste como hot spare** (§3.10.10) |
| `02` §4.4 / senso comum de hospedagem | SLA implícito de "alta disponibilidade" | **Nenhum SLA numérico com multa na fase 1.** Meta interna de 99,0%, status page pública com uptime real, crédito automático por congelamento do medidor (§3.10.10) |

---

## 12. Ordem de construção do billing (para o plano de execução)

| # | Entrega | Critério de aceite objetivo | Depende de |
|---|---|---|---|
| 1 | Schema `billing` completo + `ledger.verify` | Migration aplica e reverte; `ledger.verify` detecta divergência plantada de 1 centavo | — |
| 2 | `state_windows` escrita pela máquina de estados | Pausar, retomar, resize (cliente e admin) fecham e abrem janela; **zero** sobreposição em 1.000 transições aleatórias | motor de jobs |
| 3 | Coleta de amostras no agente + ingestão idempotente | Reenviar 100% das amostras não cria linha nova | agente |
| 4 | `usage.rollup` + `ledger.post_hour` com carry | **B10** completo (§10.2) | 1, 2, 3 |
| 5 | Extrato do cliente + drill-down + "Conferir saldo" | O total do extrato bate com o saldo ao centavo; exporta CSV e PDF | 4 |
| 6 | **`mod-pagamento-fake`** + capability + `host.payments.settle()` + rota `webhooks` | Os 11 testes de §6.7 passam; o `grep` de fachada retorna zero | 1 |
| 7 | `mod-pagamento-asaas` (Pix) + `payments.poll` | Recarga real de R$ 0,01 em sandbox credita em < 10 s; webhook derrubado é recuperado pelo polling em < 2 min | 6 |
| 8 | `dunning.evaluate` + a escada de §5.1 + `/financeiro/regras` | Conta de teste percorre normal → carência → suspensão → arquivamento com todos os avisos entregues e registrados | 4, 7 |
| 9 | Compromisso (compra, desconto travado, cancelamento com as duas contas) | O exemplo numérico de §4.3 reproduz ao centavo na UI | 4, 7 |
| 10 | Telas de admin §9.1–9.6 | Conciliação detecta um pagamento órfão plantado; margem por nó bate com `node_costs` | 4, 7, 8 |
| 11 | Egress medido + franquia + limite na borda | 1 TB de tráfego simulado gera cobrança correta e alerta em 70% | 3, proxy |

**Nada disso começa antes de o `veloz-node-doctor.sh` rodar** (item 1 da ordem de marcha do Ciclo 2). Se as
VPS forem container-based, não há isolamento, não há cgroup para medir, e todo este documento é sobre um
sistema que não pode existir.
