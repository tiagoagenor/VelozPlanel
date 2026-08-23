# Jamees — Brief de Design (para redesenhar a interface)

> Documento para pedir ao **Claude Design** um novo design da interface.
> Descreve **o que o produto é, quais telas existem, o que cada uma mostra, os
> fluxos e os estados**. O objetivo é redesenhar a aparência mantendo a
> arquitetura de informação e as funções. Português do Brasil em toda a UI.

---

## 1. O que é o produto

**Jamees** é um **painel de hospedagem** (control panel) self-hosted, parecido em
espírito com hPanel/cPanel, mas moderno e enxuto. O cliente cria **ambientes**
(sites/apps e serviços), gerencia **domínios/DNS**, faz **deploy por Git**, e paga
por uso. Existe também uma área de **super admin** para operar a plataforma
(servidores, usuários, preços, cobrança, rede, DNS do sistema).

**Duas interfaces distintas, no mesmo app:**
- **Painel do cliente** — quem contrata e usa os ambientes.
- **Painel do super admin** — quem administra a plataforma (visual propositalmente
  diferente do cliente, para nunca confundir o contexto).

**Plataforma:** web (desktop e mobile responsivo). Next.js. Hoje o visual é claro,
com acento **roxo**, cantos arredondados, cards com sombra suave, tabelas densas.
O redesign pode manter ou repropor — o que importa é cobrir as telas e estados abaixo.

---

## 2. Marca e tom

- **Nome:** Jamees (logo atual = um quadrado arredondado com a letra “J” + a palavra
  “Jamees”, com parte em cor de acento).
- **Tom:** direto, confiável, sem jargão desnecessário. Explica o que está
  acontecendo (ex.: “Provisionando…”, “DNS propagando”), nunca deixa o usuário no escuro.
- **Acessibilidade (AAA):** contraste alto, nunca depender só de cor (sempre
  texto+ícone em status), foco visível, rótulos ARIA, tabelas com cabeçalho.

---

## 3. Arquitetura de informação

### 3.1 Painel do CLIENTE (casca “AppShell”: sidebar à esquerda + topbar)
Sidebar, seção **Principal**:
- **Ambientes** (home) — lista dos ambientes do cliente.
- **Meus domínios** — domínios do cliente e o DNS deles.
- **Bancos** — (em breve)
- **Financeiro** — (em breve)
- **Suporte** — (em breve)

Topbar do cliente: saldo/estimativa de gasto, usuário, sair. Botão de recolher a sidebar.

Dentro de um **ambiente** há um segundo nível de navegação (submenu):
Visão geral · Domínio & DNS · Configurações · Arquivos · Banco de dados · SSL ·
SSH · SFTP · Deploy · Variáveis · Backups (em breve).

### 3.2 Painel do SUPER ADMIN (casca “AdminShell”: distinta — faixa roxa, selo “Modo administrador”)
Sidebar:
- **Visão geral** (dashboard da operação)
- **Servidores** (nós de hospedagem)
- **Usuários**
- **Ambientes** (frota inteira)
- **Rede** (WireGuard)
- **Domínios** (DNS do sistema)
- **Planos**
- **Preços por tipo**
- **Faturamento**
- **Módulos**
- **Auditoria**
Rodapé: “‹ Voltar ao painel do cliente”.

---

## 4. Telas do CLIENTE (detalhe)

### 4.1 Ambientes (home)
- **Lista de ambientes** em cards. Cada card: nome, tipo/runtime (PHP, Node, Redis,
  MySQL, n8n, WordPress…), **badge de estado** (Rodando / Pausado / Provisionando /
  Removendo / Erro), região (nó), IP interno, e ações (Abrir site, Pausar/Iniciar).
- **Estados especiais:** “Provisionando…” e “Removendo…” com spinner (a lista se
  atualiza sozinha até virar Rodando/sumir). Estado de **Erro** com mensagem +
  botão “Tentar de novo”.
- **Botão “Criar ambiente”** → abre um **wizard (modal) de 2 passos**:
  1. **Escolher tipo**: uma tela única com duas seções — **Código** (PHP, Node) e
     **Serviços** (Redis, MySQL, MariaDB, PostgreSQL, RabbitMQ, n8n, WordPress),
     com filtro (Tudo/Código/Serviços) e cards com **preço por tipo**.
  2. **Configurar**: nome + versão/tipo + **seleção de região** (com aviso da
     máquina, ex.: “servidor instável, só testes”) + plano + **resumo de custo**.
- Estado vazio: “você ainda não tem ambientes” + CTA criar.

### 4.2 Ambiente → Visão geral
- Cabeçalho com nome + estado + ações (Pausar/Iniciar, Abrir site, Excluir com
  confirmação “digite o nome”).
- **Gráficos de métricas** (CPU %, Memória) em série temporal.
- **Card de conexão** (para serviços: host interno/porta/usuário/senha revelável,
  com aviso “sem porta pública”). Região + IP interno.

### 4.3 Ambiente → Domínio & DNS
- Lista de **domínios/subdomínios que apontam para este ambiente** (FQDN, para
  qual IP resolve, **status de serviço** em escada, botão remover cada um).
- Bloco **“Apontar um domínio para este ambiente”**: seletor de domínio (começa em
  “Selecionar domínio…”), campo de nome (@ / subdomínio), opção “apontar www”,
  botão Apontar, link “Gerenciar todos os registros →”.
- Estado vazio (sem domínio): CTA “Adicionar domínio”.

### 4.4 Ambiente → demais seções
Configurações, Arquivos (gerenciador de arquivos), Banco de dados, SSL (força
HTTPS, status do cert), SSH e SFTP (habilitar, chaves/fingerprint, dados de
conexão — **credenciais aparecem só na tela, nunca por e-mail**), Deploy (conectar
repositório Git, branch, passos do pipeline, histórico de deploys com log),
Variáveis de ambiente. Backups = “em breve” (tela honesta, não 404).

### 4.5 Meus domínios (lista)
- Card **“Servidores de nomes (nameservers)”**: lista ns1..ns4 com botão copiar —
  o que o cliente cola no registrador.
- **Lista de domínios**: nome, nº de registros, **badge de status** (Ativo /
  Aguardando delegação / Confirme a posse / Verificando… / Erro), botão **excluir
  domínio** (confirmação), e link para gerenciar.
- **“Adicionar domínio”** (modal): informar o domínio; se já resolve na internet,
  aviso de “confirme a posse / anti-tomada”.

### 4.6 Domínio (detalhe) — a tela mais rica
Três seções empilhadas:
1. **Apontar (sub)domínio** — a forma fácil. Alterna entre **Ambiente** (escolhe um
   ambiente do cliente) e **Endereço (IP)** (digita um IP público). Campo de nome
   (@ ou subdomínio), “apontar www”, botão Apontar. Abaixo, lista dos apontamentos
   atuais com **escada de status**: ① Apontado · ② DNS propagando · ③ DNS pronto ·
   ✓ Publicado (HTTPS no ar). Botão remover em cada.
2. **Registros DNS (avançado)** — editor **estilo Hostinger**, recolhível:
   - **Dropdown de tipo** com **descrição amigável** por tipo (A, AAAA, CNAME, MX,
     TXT, SRV, CAA) — ex.: “A: Conecta seu domínio a um site usando um IPv4”.
   - **Atalhos/presets** (chips): “Verificação do Google”, “E-mail: SPF”, “E-mail: MX”.
   - **Linha de adicionar**: Tipo · Nome · (Prioridade só p/ MX/SRV) · Valor · TTL
     (Automático 5min / 30min / 1h / 12h / 1 dia) · botão Adicionar.
   - **Tabela**: Tipo · Nome · Prioridade · Conteúdo · TTL · editar/excluir. Registros
     estruturais (SOA/NS) aparecem com **cadeado** (não editáveis).
   - Botão **Exportar**.
3. **Como está ficando a configuração** — um **resumo em linguagem simples** do que
   o domínio faz hoje: “X abre o ambiente Y (③ DNS pronto)”, “E-mails vão para …”,
   “Verificação Google em …”, “Só letsencrypt pode emitir SSL”. Avisos amarelos
   quando algo não bate.
- Botão **“Verificar propagação”** no topo (diagnóstico da delegação).

---

## 5. Telas do SUPER ADMIN (detalhe)

### 5.1 Visão geral (dashboard)
- **Cards de estatística**: Servidores online (2/2), Ambientes ativos, Ambientes
  pausados, Ambientes com erro, Usuários, Bancos de dados.
- Card grande **“Receita estimada / mês”** (ex.: R$ 183,00).
- **Atalhos** para as seções principais.

### 5.2 Servidores (nós)
- Tabela: nome, região, **status** (Online/Degradado/Offline), host público, vCPU,
  RAM, nº de ambientes, último contato, editar. Modal de edição de endereços
  (host público, host HTTP, **mensagem de alerta da máquina**). Cards no mobile.

### 5.3 Usuários
- Tabela: e-mail, nome, papel, status, nº de ambientes, **saldo**, criado em.
- Ações: criar/editar/excluir usuário; **adicionar crédito/saldo** (auditado);
  ver ambientes do usuário.

### 5.4 Ambientes (frota)
- Tabela de todos os ambientes de todos os clientes: dono, nó, plano, runtime,
  estado. Ação de **alterar vCPU/RAM a quente**.

### 5.5 Rede (WireGuard)
- Lista de peers (nó, IP privado, endpoint, chave pública, status). Adicionar/remover.

### 5.6 Domínios (do sistema)
- **“Domínios do sistema”** — só os domínios do próprio painel (ex.: geestao.top /
  jamees.com), com coluna **Dono = Sistema**. Cadastrar novos. Card de nameservers.
  Mesma tela de registros/verificação do cliente, porém para os domínios do sistema.

### 5.7 Planos
- CRUD de planos (id, rótulo, vCPU, RAM, disco, **preço/mês**, limite de máquinas,
  ativo). Tabela + modal.

### 5.8 Preços por tipo
- CRUD do catálogo de tipos (PHP, Node, Redis, MySQL, … n8n, WordPress) com o
  **preço mensal de cada tipo**, editável.

### 5.9 Faturamento
- **Configuração da cobrança** (cron): ligar/desligar, “rodar a cada (minutos)”,
  **Gerência por domínio (R$/mês)**, “suspender ambiente quando o saldo zerar”.
- **Status**: última execução, próxima execução, debitado hoje, botão “Rodar agora”.

### 5.10 Módulos
- Catálogo de módulos/recursos da plataforma (ativos, embutidos, planejados).

### 5.11 Auditoria
- Log append-only de ações (quem, quando, ação, alvo, detalhe, IP).

---

## 6. Componentes recorrentes (o design precisa cobrir)
- **Casca com sidebar + topbar** (duas variantes: cliente e admin).
- **Submenu de segundo nível** (dentro do ambiente).
- **Cards de estatística / KPI** (número grande + rótulo + subtexto).
- **Cards de item** (ambiente, domínio) com badge de estado + ações.
- **Tabelas densas** (desktop) que viram **cards** no mobile.
- **Badges de status** (sucesso/aviso/erro/info/neutro) — sempre texto+ícone.
- **Escada de status** de 3–4 degraus (apontamento DNS → publicado).
- **Modais/Dialogs** (criar ambiente wizard, adicionar domínio, editar registro,
  confirmar exclusão com “digite o nome”).
- **Formulários** (inputs, selects, textarea, toggles, chips/presets, dropdown com
  descrição, rad/segmented “Ambiente | Endereço IP”).
- **Gráficos de série temporal** (CPU/Memória).
- **Botão copiar** (nameservers, credenciais, IP).
- **Toasts** (sucesso/erro).
- **Estados**: carregando (skeleton), vazio (ilustração + CTA), erro (mensagem +
  retry), transição (spinner “Provisionando…/Removendo…”).

---

## 7. Fluxos principais (jornadas a desenhar bem)
1. **Criar um ambiente** (wizard 2 passos → aparece “Provisionando…” → “Rodando”).
2. **Apontar um domínio para um ambiente** (fácil) e ver a escada de status até
   “Publicado (HTTPS)”.
3. **Editar DNS avançado** (adicionar A/MX/TXT com o editor estilo Hostinger).
4. **Delegar um domínio** (copiar nameservers → verificar propagação).
5. **Deploy por Git** (conectar repo → rodar → ver log/histórico).
6. **Admin: cadastrar servidor/plano/preço** e **configurar cobrança** (incl. taxa
   por domínio).
7. **Admin: adicionar saldo a um usuário**.

---

## 8. Referência do design atual (pode ser repensado)
- **Cor de acento:** roxo (brand) + roxo-forte; admin usa uma faixa roxa mais
  escura para se diferenciar.
- **Semânticas:** sucesso (verde), aviso (amarelo), erro (vermelho), info (azul),
  neutro (cinza) — cada uma com versão “soft” (fundo claro + texto escuro).
- **Superfícies:** fundo levemente cinza, cards brancos com borda sutil e sombra
  leve, cantos arredondados (lg/xl).
- **Tipografia:** sans para texto, **mono** para domínios/IPs/registros DNS.
- **Densidade:** tabelas densas no admin; cards mais espaçados no cliente.
- Suporta **tema claro** (dark é desejável no redesign).

---

## 9. O que priorizar no redesign
1. As duas cascas (cliente x admin) claramente distintas.
2. A **tela de Ambientes** e o **wizard de criação**.
3. A **tela de Domínio (detalhe)** com as 3 seções (apontar / editor / resumo) —
   é a mais complexa e a que mais aparece.
4. **Badges e escadas de status** consistentes (é a linguagem do produto).
5. Estados de **carregando / vazio / erro / transição** bem resolvidos.
6. Responsivo: tabela↔card no mobile.

> Observação: “Jamees” é a marca visível. Nomes internos de código/infra ainda
> usam “velozPanel” (invisível ao usuário) — não precisam aparecer no design.
