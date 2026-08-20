# Briefing — VelozPanel (painel de hospedagem tipo Hostoo)

> Documento fonte de verdade. Todos os especialistas devem ler este arquivo antes de escrever.

## Objetivo
Construir um painel de hospedagem próprio, inspirado no Hostoo (https://hostoo.io), rodando em
infraestrutura própria de **2 a 3 servidores** dedicados, com painel do **cliente** e painel de
**super admin**.

## Requisitos declarados pelo dono do produto (Tiago)
1. Hospedar **PHP** e **Node.js**, com arquitetura **aberta a outras linguagens** (Python, Go, Ruby, Java, Deno, Bun...).
2. Sistema **modular** — cada capacidade (e-mail, DNS, backup, SSL, filas...) é um módulo instalável/removível.
3. Dois planos de UI: **painel do cliente** e **painel do super admin**.
4. Cliente pode **parar (pause) e iniciar** o ambiente dele a qualquer momento.
5. **Cobrança por hora de uso** (ambiente pausado não gera custo, ou gera custo reduzido só de disco).
6. Bancos suportados: **MySQL** e **PostgreSQL**.
7. Cliente pode **trocar a versão da linguagem** (ex.: PHP 7.4 → 8.3, Node 18 → 22) de forma fácil,
   e **cada cliente pode estar numa versão diferente**.
8. Painel do cliente com **gráficos** do ambiente (CPU, RAM, disco, rede, requisições).
9. Super admin pode **alterar memória e vCPU** de qualquer cliente a quente.
10. **Instalação simples de cada módulo** + **documentação** para o dono entender e operar.

## Restrições de contexto
- Escala inicial pequena: 2–3 servidores. Não superdimensionar (nada de Kubernetes multi-região no dia 1),
  mas o desenho deve permitir crescer para N servidores sem reescrever.
- Time pequeno (potencialmente 1 dev). Simplicidade operacional > sofisticação.
- Mercado alvo: Brasil (preço em BRL, Pix, LGPD, latência local).

## Material de referência
- Screenshots do Hostoo em `Plan/hostoo/*.png` — **36 telas**, em dois lotes:
  - **Lote 1 (25 telas) — painel da hospedagem:** resumo, domínio, DNS, subdomínio, alias, redirect,
    arquivos, FTP, deploy (+ modal de integração Git), banco de dados, backup, e-mail, antispam, webmail,
    listas de e-mail, acessos de e-mail, apps/1-click, instalação de app, PHP, SSL, SSH, cron (+ modal), logs.
  - **Lote 2 (11 telas) — conta, billing e criação:** funil `hosting/create` em 5 passos
    (Produto → Plano → Recursos → Checkout → Configuração), `payment/recharge`, `payment/history`,
    `payment/billing` (Consumo), `payment/cost` (Demonstrativo), `user/notifications`,
    `support/tickets`, `referral`.

## Descoberta que altera o requisito 5 (cobrança por hora)
O lote 2 mostra que o Hostoo **não** cobra puramente por hora. O modelo real é **híbrido**:
- preço de tabela mensal (ex.: plano "Nuvem Light" 512 MB / 1 GHz / 15 GB = R$ 35,00/mês),
- convertido em tarifa horária (R$ 0,0486/h ≈ 35/720) debitada de um **saldo pré-pago em créditos**,
- com upsell de **compromisso pré-pago** com desconto agressivo no ato da criação:
  1 mês sem desconto · 6 m 40% OFF · 12 m 48% · 24 m 54% · 36 m 60% (R$ 13,90/mês).

Consequência para o VelozPanel: o motor de cobrança precisa suportar simultaneamente saldo pré-pago,
débito horário e compromisso de período com desconto — e definir o que acontece ao pausar, redimensionar
ou cancelar durante um compromisso já pago.

## Método de trabalho
Planejamento em **4 ciclos** de `planejar → criticar`, cada ciclo com especialistas dedicados por área.
Saídas em `Plan/especialistas/`, críticas em `Plan/criticas/`, consolidação numerada em `Plan/`.

## Regras de escrita para os especialistas
- Português do Brasil, objetivo, sem enrolação.
- Decisões com **trade-off explícito** e uma **recomendação única** (não deixar "depende").
- Sempre citar riscos operacionais e custo de manutenção.
- Nada de tecnologia por moda: justificar cada escolha para um time de 1–3 pessoas.

---

# ADENDO 1 — Respostas do dono do produto (decisões que substituem premissas anteriores)

> Coletado diretamente do Tiago. **Prevalece sobre qualquer suposição feita pelos especialistas
> nos documentos do Ciclo 1.** Onde um documento do Ciclo 1 contradisser esta seção, o documento
> está errado e deve ser corrigido no Ciclo 2.

## A. Stack e quem constrói
- Tiago domina **Node.js**, **.NET**, **HTML/CSS**.
- **O front-end DEVE ser Next.js.** Requisito fechado, não é para reavaliar.
- Dúvida explícita dele, que precisa ser respondida por um especialista:
  *"não sei se na parte de integração com Linux dá para fazer com Node e se vai ser boa performance"*.
  → Um **Especialista Node.js / Next.js** foi adicionado ao elenco para responder isso.
- **Quem vai construir o sistema é a IA** (Claude), sob gestão do Tiago, **depois** que o planejamento
  terminar. Consequências para o plano:
  - O plano precisa ser **executável por um agente de IA**: especificação precisa, contratos explícitos,
    critérios de aceite testáveis, ordem de construção sem ambiguidade.
  - "Facilidade de contratar dev no mercado" **deixa de ser critério** de escolha de stack.
  - "O Tiago consegue ler, entender e depurar o código em produção" **continua sendo critério** —
    ele é quem opera o sistema.
  - Documentação não é opcional: é o que permite ao Tiago operar o que a IA construiu.

## B. Infraestrutura real (muda densidade, isolamento e rede)
Não são servidores dedicados grandes num mesmo datacenter. São **VPS pequenas, cada uma em um
provedor/parceiro diferente**:

| Nó | Recursos | Situação |
|---|---|---|
| VPS 1 | 6 vCPU · 16 GB RAM · 200 GB NVMe | já tem |
| VPS 2 | 8 vCPU · 16 GB RAM | já tem |
| VPS 3 | a definir | vai contratar |

- Carga inicial modesta: **4 a 5 sistemas hospedados**, para aprender e validar.
- **Cada nó em um provedor diferente é a justificativa central da modularidade.**

Consequências que o Ciclo 2 precisa tratar obrigatoriamente:
1. **Não existe rede privada entre os nós.** Control plane ↔ agente trafega pela internet pública →
   mTLS obrigatório, tolerância a latência e a queda de link, nada de suposição de LAN.
2. **RAM é o recurso escasso** (16 GB, não 64 GB). Toda estimativa de densidade dos documentos do
   Ciclo 1 está superdimensionada e precisa ser refeita para 16 GB.
3. **ZFS em VPS de 16 GB é suspeito** (ARC consome RAM) e precisa ser reavaliado contra alternativas
   mais baratas de memória.
4. **RISCO BLOQUEADOR A VERIFICAR ANTES DE TUDO:** se a VPS for baseada em container (OpenVZ/LXC/Virtuozzo)
   em vez de virtualização real (KVM), **não será possível rodar Incus/LXC nem Docker com isolamento
   adequado, nem carregar módulos de kernel**. Isso invalidaria a arquitetura inteira.
   → Criar um **script de diagnóstico de nó** que verifique isto e rode ANTES de qualquer decisão.
5. Balanceamento e migração entre nós ficam mais caros (banda entre provedores diferentes, sem rede interna).

## C. Objetivo comercial
- Quer **vender hospedagem**, mas **começar simples**.
- **Nota fiscal está FORA do escopo** por enquanto — *"nota depois vou imprimir"*.
  → Toda a discussão de NFS-e Nacional / obrigatoriedade 01/09/2026 sai do MVP.
  → Mas o modelo de dados **não pode impedir** emitir nota depois (guardar o que a nota exigiria).
- **Cobrança e meios de pagamento são obrigatórios** desde cedo.
- **O meio de pagamento DEVE ser um módulo plugável** — requisito explícito:
  *"quero que seja um módulo que eu posso adicionar módulo de pagamento"*.
  → Ou seja: `mod-pagamento-pix`, `mod-pagamento-asaas`, `mod-pagamento-stripe`,
    `mod-pagamento-mercadopago` etc., com uma **interface de gateway de pagamento** bem definida
    no core, e nenhum acoplamento do core a um PSP específico.

## D. Reprioritização decorrente
- **Sobe:** modularidade real, instalador por módulo, diagnóstico de nó, gateway de pagamento plugável,
  documentação operacional, especificação executável por IA.
- **Desce/sai do MVP:** NFS-e, e-mail (caixas postais), alta densidade, otimizações para escala grande,
  migração ao vivo entre nós.

---

# ADENDO 2 — Qualidade do painel e checklist

> Coletado do Tiago durante o Ciclo 2. Prevalece sobre suposições anteriores.

## E. Padrão de qualidade do painel: "AAA"
Pedido literal: *"quero que o site seja padrão AAA"*.

Interpretação adotada (cobre as duas leituras possíveis, sem precisar escolher):
1. **Acessibilidade WCAG 2.2** — meta de conformidade. Ressalva honesta que o especialista deve tratar:
   o próprio W3C desaconselha exigir **nível AAA para um site inteiro**, porque alguns critérios AAA são
   impossíveis para certos tipos de conteúdo. O especialista deve entregar:
   - **AA como piso obrigatório e inegociável** em 100% do painel;
   - **AAA aplicado onde é viável**, com lista explícita dos critérios AAA adotados, dos recusados e do porquê;
   - eMAG (padrão do governo brasileiro) e LBI/Lei 13.146 como referência complementar.
2. **Qualidade de engenharia de primeira linha** — Core Web Vitals no verde, performance, SEO técnico do site
   público, segurança de front-end (CSP), i18n PT-BR, dark mode, responsividade real, teclado e leitor de tela.

Isso vale para: painel do cliente, painel do super admin e site público/marketing.

## F. Checklist de desenvolvimento
Pedido literal: *"crie um checklist de desenvolvimento, mas não é para começar desenvolver"*.
- Produzir `Plan/docs/CHECKLIST-DESENVOLVIMENTO.md`: documento **vivo**, com itens verificáveis
  (caixinhas), organizado por entrega, com critério de aceite objetivo para cada item.
- **Nenhuma linha de código de produção deve ser escrita enquanto o planejamento não for aprovado pelo dono.**
  O checklist é artefato de planejamento, não autorização para começar.

---

# ADENDO 3 — Infraestrutura definitiva e catálogo (Ciclo 2)

> Respostas do dono. **Prevalece sobre o ADENDO 1** na parte de servidores e sobre qualquer
> cálculo de densidade/economia feito nos Ciclos 1 e 2.

## G. A frota real
Correção importante: **não são 3 nós de produção. São 2.**

| Nó | Recursos | Papel |
|---|---|---|
| Produção 1 | 6 vCPU · 16 GB RAM | **produção** |
| Produção 2 | 6 vCPU · 16 GB RAM | **produção** |
| Teste | 16 GB (o já existente) | **só teste/homologação — não recebe cliente pagante** |

Consequências obrigatórias para o Ciclo 3:
1. Capacidade de produção = **2 nós**, não 3. Toda projeção de densidade, receita, ponto de
   equilíbrio e margem precisa ser refeita com 2 nós.
2. O nó de teste é uma **vantagem de engenharia**, não um custo perdido: vira o ambiente onde
   se valida upgrade de módulo, migração, restore e mudança de imagem base **antes** de tocar
   em produção. Incorporar isso ao processo de release e aos runbooks.
3. Com 2 nós, **perder um nó significa perder metade da capacidade**. O plano de evacuação e o
   backup deixam de ser teoria e viram requisito de MVP.
4. A distribuição "um nó por parceiro/provedor" continua valendo para os 2 de produção — é a
   justificativa da modularidade.

## H. Catálogo de planos — decidido
Catálogo fechado **até 4 GB**: Start 512 MB · Light 1 GB · Plus 2 GB · Pro 4 GB.
Planos de 8 GB e 16 GB **ficam fora do catálogo**. Cliente que precisar de mais vai para
orçamento sob medida, e só quando existir nó maior.

## I. Postura comercial
O dono é explícito: os servidores atuais são pequenos e o momento é de **validação**, não de
escala. O plano deve otimizar para **aprender com poucos clientes e não perder dado**, não para
maximizar receita. Prejuízo operacional nesta fase é esperado e aceito.

---

# ADENDO 4 — Multi-região (Brasil + EUA) e gestão de domínios

> Requisitos novos trazidos pelo dono no Ciclo 2. **Não estavam previstos** nos Ciclos 1 e 2 —
> os documentos existentes precisam ser revisados à luz disto no Ciclo 3.

## J. Multi-região: haverá nós no Brasil E nos Estados Unidos
Até aqui todo o planejamento assumiu nós no Brasil. Isso muda.

Estado atual do planejamento (verificado): existe apenas um **gancho**, não um desenho.
- `03-arquitetura.md` §4 tem a coluna `region text NOT NULL DEFAULT 'br-sp'` na tabela de nós.
- `07-billing-metering.md` P15 decidiu **tabela de preço unitário versionada e por região** desde o dia 1.
- `01-produto-ux.md` documentou que o Hostoo exibe região com bandeira e cobra preços diferentes.
Nada além disso foi projetado.

Pontos que o Ciclo 3 **tem** que resolver:
1. **Residência de dados e LGPD.** Cliente brasileiro hospedado nos EUA = transferência internacional
   (LGPD arts. 33–36): base legal, informação ao titular, cláusulas contratuais, e escolha explícita
   e consciente da região pelo cliente. Definir se dado de brasileiro pode ir para os EUA e sob que condições.
2. **Onde fica o control plane** e qual a latência aceitável até a região mais distante
   (BR↔EUA ≈ 110–180 ms). O que quebra com essa latência e o que não quebra.
3. **Moeda e preço.** Cobrar em BRL para nó nos EUA? Em USD? Variação cambial vira risco de margem.
   O custo de VPS nos EUA é menor — repassar ou embolsar?
4. **Backup por região** — o backup de um nó dos EUA vai para bucket nos EUA ou no Brasil?
   (custo de egress entre continentes é relevante).
5. **Escolha de região pelo cliente** no funil de criação, e se é possível migrar de região depois.
6. **Latência ao usuário final** — nó nos EUA serve público brasileiro mal, e vice-versa. Como orientar o cliente.
7. **Observabilidade e alertas** com nós em fusos e latências diferentes (drift de relógio já é alerta previsto).
8. **Certificados e DNS** — propagação e ACME funcionam igual, mas o `nameserver` do painel precisa
   de anycast ou de servidores nos dois lados?
9. Impacto na conta de capacidade e no ponto de equilíbrio: nós nos EUA são mais baratos por GB.
   **Refazer a economia com a possibilidade de nó dos EUA.**

## K. Gestão de domínios — separar dois produtos distintos
1. **Gerenciamento de DNS** (zona e registros) — ✅ já planejado como `mod-dns` (PowerDNS).
   Cobre A/AAAA/CNAME/MX/TXT, subdomínio, alias e redirecionamento.
2. **Registro / transferência de domínio (registrar)** — ⚠️ marcado como "futuro" em
   `01-produto-ux.md` §453, complexidade Alta. Barreira conhecida: **o Registro.br não expõe API
   pública para não-registradores** (exige credenciamento EPP), conforme `02-pesquisa-mercado.md` §325.
   Fluxo assumido hoje: manual, com apontamento de nameservers e verificação automática de propagação.

O Ciclo 3 deve decidir: vender registro de domínio faz parte do produto ou não? Se sim, por revenda
(Namecheap/OpenSRS/Porkbun/Enom para gTLDs) e o que fazer com `.com.br`. Se não, como o painel
conduz o cliente que não tem domínio (proposta existente: subdomínio grátis `cliente.veloz.app`).

---

# ADENDO 5 — Ambiente de desenvolvimento e decisão de nós (fim do Ciclo 2)

## L. Desenvolvimento local → produção (fluxo confirmado)
- O sistema será **construído e testado numa máquina local** e depois promovido para produção.
  Isso é suportado nativamente pelo desenho: control plane + agente rodam na mesma máquina em
  **modo nó único**; o mesmo código/imagem sobe para a VPS.
- **Requisito de ambiente de dev:** o painel (Next.js/API/Postgres) roda em qualquer SO, mas o
  **isolamento real (Docker + userns-remap + cgroup v2 + quota XFS) exige Linux real**. Em macOS/Windows,
  usar uma **VM Debian 13** que passe no `veloz-node-doctor.sh` idêntico à produção. Docker Desktop
  não reproduz fielmente cgroup v2 + userns.
- Ambientes criados localmente são descartáveis; produção nasce limpa. Mover ambiente entre máquinas
  usa o mesmo mecanismo de migração de nó já especificado (doc 06).
- **Item de roadmap:** a "Fase Piloto — modo nó único" é a primeira entrega formal, validada primeiro
  na VM local e depois promovida ao primeiro nó de produção.

## M. Nós de produção — decisão do dono
- O dono opta por **2 nós de produção, ambos pequenos** (não 1), justificando pela necessidade de
  redundância de DNS (ns1/ns2) enquanto o desenho de DNS não está batido.
- **Observação técnica registrada (não bloqueia a decisão):** a redundância de DNS NÃO exige 2 nós de
  produção — o doc 12 §8 recomenda **PowerDNS próprio (ns1) + Hurricane Electric anycast GRÁTIS (ns2)**
  via AXFR/TSIG. Ou seja, é possível ter DNS redundante com 1 nó de produção. A escolha por 2 nós
  permanece válida (dá redundância N-1 de hospedagem), mas o motivo "DNS" pode ser satisfeito sem o 2º nó.
- Construção: **1 máquina local (VM Debian 13)** para desenvolver e testar → promover para os nós de produção.

## N. Método — decisão do dono
- Os Ciclos 3 e 4 formais foram **dispensados** a pedido do dono e por recomendação convergente dos dois
  críticos do Ciclo 2 ("o essencial está coberto; continuar planejando tem retorno decrescente").
- Fecha-se o planejamento com um **documento único de consolidação + roadmap executável**, e a finalização
  do CHECKLIST-DESENVOLVIMENTO. Nada de código de produção até aprovação explícita do dono.

---

# ADENDO 6 — Rede privada WireGuard como opção oficial (decisão do dono)

## O. WireGuard mesh entre painel e nós
Decisão do dono: adicionar, **na configuração e na documentação**, a opção de ligar os nós ao painel
por uma **rede privada WireGuard** (malha/mesh), de modo que todas as máquinas fiquem "na mesma rede".

Motivação declarada: *"como o WireGuard a máquina vai estar na mesma rede"* — isto habilita, entre outras
coisas, anexar um **servidor local SEM IP público** (ex.: máquina em casa/escritório atrás de NAT) como
nó, usando o padrão **"Opção A" (proxy reverso sobre WireGuard)**:
```
Visitante → nó público (nginx borda) → [túnel WireGuard] → nó local (container do cliente)
```

Requisitos para o especialista de redes tratar:
1. WireGuard como **camada de rede privada padrão** entre control plane e nós — resolve a lacuna
   "sem rede privada entre provedores" já registrada (o transporte CP↔agente passa a poder ir por dentro
   da WG, mantendo mTLS por cima como defesa em profundidade).
2. **Endereçamento**: plano de IPs privados (ex.: `10.varejo.0.0/16`), atribuição por nó, DNS interno.
3. **Topologia**: hub-and-spoke (painel como hub) vs mesh completa. Escolher, com prós/contras para 2–5 nós
   em provedores diferentes + nós locais atrás de NAT. Tratar NAT traversal, keepalive, MTU.
4. **Opção A documentada**: nó sem IP público servindo sites via nginx da borda de um nó público, com
   `upstream` apontando para o **IP WireGuard** do nó local. Especificar a geração de vhost/upstream, TLS
   (onde termina), cabeçalhos (X-Forwarded-For/Proto), e o custo de banda/latência do pulo pelo túnel.
5. **Segurança**: a WG não pode virar uma rede plana onde um nó comprometido alcança tudo. Segmentar:
   o que cada nó pode falar com o quê (agente↔CP sim; nó↔nó só o necessário; container do cliente NUNCA
   na WG). Firewall (nftables) por peer. Chaves, rotação, revogação de peer.
6. **Acesso a banco e serviços**: hoje o banco é por nó; a WG muda algo no acesso do cliente ao próprio
   banco? Backup e métricas passam a trafegar pela WG?
7. **Impacto no bootstrap de nó e no `veloz-node-doctor.sh`**: checar módulo WireGuard, kernel, e a
   capacidade de subir interface `wg0`. Adicionar item ao doctor.
8. **Failure modes**: se o hub (painel) cair, os nós continuam servindo sites? A WG cai junto? A regra
   "painel cai, sites no ar" precisa continuar válida — o tráfego de visitante do nó PÚBLICO não pode
   depender da WG; só o nó local-atrás-de-NAT depende, e isso deve ficar explícito como trade-off.
9. **Quando usar cada modo**: matriz de decisão — nó com IP público direto vs nó via WG/Opção A vs
   Cloudflare Tunnel como alternativa. Recomendar o padrão e as exceções.
10. Este é um recurso **opcional e modular** (`mod-rede-wireguard`?), coerente com a filosofia do sistema.

Saída: `Plan/especialistas/13-rede-wireguard.md` + atualização dos manuais em `Plan/docs/`
(configuração e operação). Depois, passar por **crítica dedicada** (método planejar→criticar).

### ADENDO 6.1 — Veredito da crítica de rede (fecha o ciclo planejar→criticar da WireGuard)
Crítica em `criticas/critica-rede-wireguard.md`. Resultado: **aprovado com correções + refazer partes**.

Decisões que passam a valer:
- **Opção A (nó sem IP público servindo site via proxy WG) NÃO é oferecida a cliente pagante.**
  Disponibilidade composta ~98–99% (≈ 8–11 h/mês fora) e teto de banda do upload residencial tornam
  isso um outage mensal previsível. É recurso **só para os sistemas do próprio dono**; a UI deve
  **bloquear Opção A para ambiente pagante** e nunca listá-la como plano. (reversível se o dono decidir
  assumir o risco por escrito.)
- **WireGuard deixa de ser transporte padrão de todo nó público** — é over-engineering para 3–4 nós.
  WG fica **obrigatória só para o nó local atrás de NAT**; nós públicos seguem no transporte já decidido
  (WebSocket/long-poll + mTLS), com WG opcional.
- **TLS da Opção A: usar TLS passthrough** (o certificado vai até o nó local), não terminar no nó público.
  É mais barato que re-cifrar e protege contra o provedor do nó público bisbilhotar o tráfego.
- **Correções técnicas obrigatórias antes de construir** (detalhe no doc de crítica): a barreira
  "10/8 já bloqueado" é ilusória sob Docker (a regra de egress é por interface WAN, não pega `wg0`) —
  precisa de regra em `DOCKER-USER` + `forward wg0↔bridge = drop` explícito; `PersistentKeepalive=15`
  (não 25) para CGNAT; política escrita para "nó local offline > (definir) h" (o que acontece com os
  sites e com a cobrança); revogação de peer precisa derrubar também a aresta lateral da Opção A.

Dívida de documentação exposta pela crítica (não é da WG, é anterior): **o doc `03-arquitetura.md`
ainda está inteiro em NATS**, embora a Crítica do Ciclo 1 tenha trocado o transporte para Postgres
long-poll. Idem resquício em `12` §3.2. Pendência: **passe de reconciliação** no doc 03 antes de codar.

---

# ADENDO 7 — Acesso remoto ao banco "aberto" (0.0.0.0/0) como opção do super admin

## P. Decisão do dono (sobrepõe o D7 do doc 09)
O doc 09 §1.6 (D7) proibia terminantemente `0.0.0.0/0` / `%` / "qualquer IP" no acesso remoto ao banco.
O dono decide **adicionar essa funcionalidade**, porque *"talvez o cliente pode querer isso"*, mas de
forma controlada: **é uma configuração no painel do SUPER ADMIN para ativar ou desativar**, não algo que
o cliente liga sozinho.

Requisitos (o especialista deve detalhar e o crítico deve atacar):
1. **Desligado por padrão.** O modo "aberto" (`0.0.0.0/0` / `%`) só existe se o super admin habilitar.
2. **Granularidade** — decidir e recomendar: a chave é global? por nó? por plano? por cliente/ambiente?
   O cliente **pede** e o admin **aprova**, ou o admin libera e o cliente passa a poder escolher `0.0.0.0/0`?
3. **Salvaguardas que permanecem obrigatórias mesmo no modo aberto** (o ponto central): TLS obrigatório
   (`require_secure_transport ON`), conta/senha de acesso remoto separada da aplicação, política de senha
   forte, `MAX_USER_CONNECTIONS`/`CONNECTION LIMIT`, proteção de força-bruta na porta do banco
   (CrowdSec/fail2ban no 3306/5432), e o grant continuar restrito **só ao database daquele cliente**
   (o modo aberto expõe o IP, não pode expor o banco do vizinho — banco é compartilhado por nó).
4. **Blast radius** — o banco é compartilhado por nó. Abrir a porta para a internet expõe a instância
   inteira a brute-force, não só um cliente. Tratar: o que isso significa para os OUTROS clientes do nó,
   e se o modo aberto deveria forçar o cliente para uma instância dedicada.
5. **Responsabilidade/LGPD/AUP** — se o banco de um cliente vaza por acesso aberto, de quem é a culpa?
   Que aviso/aceite o cliente assina, que texto o super admin vê ao ativar, e o que a auditoria registra.
6. **Interação com o resto**: pausa (o acesso é revogado na pausa — mantém?), expiração de 30 dias
   (mantém no modo aberto ou o aberto é permanente?), alerta ao ativar, e registro em auditoria.
7. **UI**: a chave no super admin (com aviso honesto), e o que muda na tela do cliente quando habilitado.

Princípio a preservar: **o padrão continua seguro** (allowlist /32 temporária). O modo aberto é uma
exceção consciente, auditada, reversível e com o máximo de mitigação em cima.

### ADENDO 7.1 — Veredito da crítica do acesso remoto aberto
Crítica em `criticas/critica-acesso-remoto-banco.md`. Resultado: **especificação aprovada como
contingência, com 7 correções — mas manter a chave OFF e NÃO construir agora.**

Achados que pesam:
- **Duas salvaguardas se anulam:** o gateway ProxySQL na frente **cega o CrowdSec** (o banco só enxerga
  o IP do gateway, não o do atacante) — a proteção de força-bruta por IP deixa de funcionar. mTLS também
  não fica fim-a-fim com ProxySQL. (PgBouncer valida certificado melhor.)
- **mTLS obrigatório é inusável** para o cliente médio (WordPress/dev júnior) — vira ticket, contradiz a
  própria persona do produto.
- **CrowdSec na porta de banco é furado contra brute-force distribuído** (mil IPs, uma tentativa cada) e
  MariaDB nem loga o IP por padrão; "tarpit de protocolo de banco" não existe pronto.
- **Blast radius não é resolvido pelo "dedicado":** o banco dedicado é um container no MESMO nó; expô-lo à
  internet reabre o risco nº 1 do doc 06 (escape de kernel → 21 vizinhos). Pior: o doc 09 §2.2 sobe o
  dedicado com menos isolamento que o padrão. Precisa reconciliar isolamento do dedicado antes.
- **Existe caminho melhor, já oficial:** **WireGuard (ADENDO 6) + túnel SSH entregam "acessar de qualquer
  lugar" com a porta FECHADA.** Tornam o modo aberto quase sempre desnecessário. Para SaaS de terceiro que
  não tunela, **allowlist de faixas** é melhor que `0.0.0.0/0`.

Decisão pendente do dono (ver conversa): manter como contingência desligada (recomendado), construir
mesmo assim, ou adotar a alternativa de túnel/web-based (Adminer+2FA) que dá o mesmo sem abrir porta.

---

# ADENDO 8 — Sistema operacional alvo: Ubuntu (decisão do dono) + ambiente de build

## Q. OS alvo = Ubuntu (substitui a escolha de Debian 13 do doc 04)
Decisão do dono: *"o projeto vai ser feito mas voltado para Ubuntu"*.
- Os documentos do Ciclo 1/2 (esp. `04-infra-linux.md`) escolheram **Debian 13**; isso muda para **Ubuntu**.
- **Host KVM de desenvolvimento:** `server-local@192.168.2.111` — Ubuntu 22.04.5 LTS, kernel 5.15,
  4 vCPU / 15 GB RAM / 98 GB disco (48 GB livres no início).
- **VMs de nó (dev):** **Ubuntu 24.04 LTS (Noble)** — cgroup v2 por padrão; multi-PHP via `ppa:ondrej/php`
  (mesmo mantenedor do Sury); Node via nodesource/fnm; Docker via repo oficial. Onde o doc 04 citava
  pacotes "Sury/Debian", ler o equivalente Ubuntu (ondrej PPA).
- **Produção futura:** Ubuntu LTS (24.04). Reavaliar 26.04 quando sair, se for LTS.

## R. Ambiente de desenvolvimento — validado em 20/08/2026
- Mac local: git ✅, ssh ✅. GitHub SSH ✅ (autenticado como `tiagoagenor`).
- Servidor KVM alcançável por `ssh server-local@192.168.2.111` (sem senha).
- **Estratégia:** desenvolver e testar TUDO local (VMs KVM no server-local) antes de subir para prod.
  O computador do dono NÃO tem IP fixo → nada vai para produção sem passar pelo teste local.
- **Repositório GitHub:** `git@github.com:tiagoagenor/VelozPlanel.git` (nome do repo conforme o dono: "VelozPlanel").
- Regra mantida: validar cada etapa (sem erro) ANTES de reportar "ok"; só então o dono testa.

---

# ADENDO 9 — Identidade visual (branco + roxo) e correção do login (núcleo)

## S. Tema visual: branco com roxo (decisão do dono)
- O núcleo nasceu dark; o dono quer **fundo branco / claro com roxo como cor primária**, no estilo
  dos painéis de hospedagem do mercado (o próprio Hostoo é branco + roxo — ver `Plan/hostoo/*.png`).
- Aplicar mantendo **acessibilidade AA** (doc 10): contraste ≥ 4.5:1, estado sempre cor+ícone+texto,
  foco visível. Tema **claro como padrão**; dark opcional.

## T. Login obrigatório (bug encontrado no teste do dono)
- Ao abrir o painel pelo IP da rede (`http://192.168.2.105:3000`) NÃO foi pedido login e a tela
  carregou. Causa: proteção só no cliente + API em `localhost:4000` inacessível de outra origem.
- Correções: (1) exigir sessão válida antes de renderizar rota protegida (redirect para /login);
  (2) API base do painel configurável por env (`NEXT_PUBLIC_API_URL`) para funcionar na rede;
  (3) CORS da API aceitar as origens de rede (`localhost:3000` + IP da LAN), configurável por env.
