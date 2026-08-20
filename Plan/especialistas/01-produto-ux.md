# 01 — Produto & UX: Inventário Funcional do Hostoo e Especificação do VelozPanel

> Especialista: Produto & UX · Ciclo 1 (planejar)
> Fonte primária: 25 screenshots de página inteira em `Plan/hostoo/*.png` (conta real, domínio `oliveirafacil.com`, plano "Nuvem Light").
> Convenção: tudo que **não** aparece nas imagens está marcado como **[PROPOSTA NOVA]**.

---

## 0. Leitura rápida do concorrente

O Hostoo é, na prática, um **wrapper de cPanel/CloudLinux com UX moderna e cobrança por hora**. Evidências nas imagens:

| Evidência | Onde | O que revela |
|---|---|---|
| `_cpanel-dcv-test-record` na zona DNS | Editor de DNS | Backend é cPanel/WHM |
| `/opt/cpanel/ea-php83/root/usr/bin/php` no cron | Cron | EasyApache 4 + PHP-FPM multi-versão |
| `8.0.46-cll-lve` na versão do MySQL | Banco de Dados | CloudLinux (LVE + CageFS) |
| `p1ulbhre` como usuário FTP/SSH | FTP, SSH | Usuário de sistema por hospedagem, nome gerado |
| `cluster-web02.br`, IP `200.9.22.2` | Resumo, FTP | Fleet de servidores nomeados, IP compartilhado |
| `spf.samtooweb.com`, `pmg2/pmg3.samtooweb.com` | DNS, Antispam | E-mail **terceirizado** (Proxmox Mail Gateway em domínio próprio da operação) |
| `R$ 35,00 | R$ 0,0486 / hora` | Resumo | Precificação híbrida: mensal exibido + taxa horária derivada |

**Conclusão estratégica:** o Hostoo não construiu isolamento próprio — comprou (CloudLinux). O VelozPanel precisa decidir isso explicitamente (assunto do especialista de infra), mas do ponto de vista de **produto** a lição é: o cliente nunca vê "container", "LVE", "cgroup". Ele vê **CPU / RAM / Disco em %** e um botão de pausar. Toda a complexidade de isolamento é invisível na UI. Copiar isso.

---

## 1. Inventário tela a tela

### 1.1 Chrome global (presente em 100% das telas)

**Rota equivalente:** layout raiz `/app/*`

| Elemento | Tipo | Operação de backend implicada |
|---|---|---|
| Logo (canto sup. esq.) | link → dashboard | — |
| Barra de busca lateral ("Buscar...") | input | Busca client-side na lista de hospedagens |
| "Hospedagens" + botão `+` verde | lista + CTA | `GET /hostings`; `+` → wizard de criação (provisionamento) |
| Item da lista com **bolinha verde** | status | Estado do ambiente (ativo/pausado/suspenso) via poll ou WebSocket |
| Widget roxo animado (gamificação/"missões") | badge | Programa de engajamento — **não copiar no MVP** |
| "Indique e ganhe" | botão | Programa de indicação (crédito por referral) |
| `R$ 147,96` + `+` verde | saldo | Saldo pré-pago em conta; `+` abre recarga (Pix/cartão) |
| Nome do usuário + avatar | menu | Perfil, sair, acessos |
| FAB inferior direito: chat, `?`, suporte | overlay | Chat de suporte, help center, abrir ticket |

**Bom copiar:** saldo em BRL sempre visível no topo — deixa a cobrança por hora tangível. Lista lateral de ambientes persistente.
**Ruim:** três botões flutuantes empilhados cobrem conteúdo; o widget de gamificação polui e não comunica nada.
**Melhorar:** juntar os 3 FABs em um só; transformar o saldo num **chip com previsão de esgotamento** ("R$ 147,96 · ~87 dias no ritmo atual").

---

### 1.2 Header da hospedagem (presente em todas as abas internas)

**Rota:** `/hosting/{dominio}` (header persistente)

| Elemento | Tipo | Operação implicada |
|---|---|---|
| Ícone da stack (logo PHP) | badge visual | Runtime primário do ambiente |
| Nome do domínio | título | — |
| Botão ⏸ (pause) | ação | **Parar ambiente**: parar PHP-FPM/pool + serviços, manter disco. Dispara fim de janela de cobrança |
| Botão ⬆ (upload/migração) | ação | Assistente de migração/importação de site |
| Botão ✏ (editar) | ação | Renomear/editar metadados da hospedagem |
| Botão ⤫ (shuffle/trocar) | ação | Trocar domínio principal do ambiente (rewrite vhost + reemissão de cert) |
| Botão 🗑 (excluir) | ação | Destruir ambiente (irreversível) |
| Chip `ATIVO` | estado | Estado do ambiente |
| Chip `🔒 HTTPS` | estado | Certificado válido presente |
| Chip `PHP 8.3` | estado | Versão de runtime ativa |
| Chip `COMPARTILHAR` | ação | Convidar colaborador com acesso ao ambiente |
| Barras CPU / RAM / Disco (%) | métrica | Leitura de métricas quase em tempo real (13%→18% entre screenshots) |
| Linha verde fina abaixo do Disco | sparkline | Provável indicador de rede/uptime — **ilegível, mau design** |
| Abas: Resumo, Domínio, Arquivos, Banco de Dados, E-mail, Aplicativos, Configurações | navegação | — |

**Bom copiar:** o header é excelente — identidade + estado + saúde + ações destrutivas, tudo acima da dobra, em qualquer aba. Os 3 chips (`ATIVO`/`HTTPS`/`PHP 8.3`) são um resumo de saúde de altíssima densidade.
**Ruim:** cinco ícones sem rótulo, todos cinza, **incluindo excluir**. O botão de destruir o ambiente tem o mesmo peso visual do de renomear. Convite a acidente. O ⤫ (shuffle) é indecifrável.
**Melhorar:** rótulos nos ícones (ou ao menos tooltip + cor de perigo no excluir); mover excluir para um menu "⋯"; a barra verde órfã vira um mini-gráfico rotulado ou some.

---

### 1.3 Resumo

**Rota:** `/hosting/{dominio}` · **Rota VelozPanel:** `/ambientes/{id}`

| Bloco | Campos | Operação implicada |
|---|---|---|
| Dados da Hospedagem | Plano (`Nuvem Light | 512 MB / 1 GHz / 15 GB`), Preço (`R$ 35,00 | R$ 0,0486/hora`), Região (`🇧🇷 Brasil`), Data de criação | Leitura do plano contratado; botão **Alterar plano** → resize de recursos (quota LVE/cgroup) |
| Botão "Alterar plano" (verde, destaque) | CTA | Upsell/downsell: altera limites de CPU/RAM/disco a quente e a taxa horária |
| Endereços | Principal, Alternativo (`p1ulbhre.srv-200-9-22-2.webserverhost.top`), Servidor (`cluster-web02.br`), IP (`200.9.22.2`) | Hostname técnico gerado; expõe o nó físico ao cliente |
| Gráficos de Consumo | Séries CPU e RAM, ~1h de janela, botões ↻ (refresh) e `+` (adicionar gráfico) | Time-series de métricas por ambiente; faixa vermelha 80–100% = zona de saturação |
| Acelerador de WordPress | Status: Desativado + botão "Ativar acelerador" + toggle ⏻ | Cache (LSCache/Redis/Varnish) plugável por ambiente |
| Acesso Rápido | Migração, WordPress, Hospedagens, Domínios, Suporte, Créditos, Acessos, Perfil | Atalhos globais (repetidos em TODAS as telas) |

**Bom copiar:** exibir preço **mensal E por hora** lado a lado — resolve a ansiedade de "quanto isso me custa agora". Gráficos com faixa de saturação destacada. Botão `+` para o usuário escolher quais métricas ver.
**Ruim:** (a) o rodapé "Acesso Rápido" se repete em todas as 25 telas, empurrando conteúdo e sem valor após o 1º dia; (b) não há **gasto acumulado do ciclo** — só a taxa; (c) plano descrito como "1 GHz" é unidade sem sentido para o usuário; (d) expor `cluster-web02.br` cria suporte desnecessário.
**Melhorar:** substituir "Acesso Rápido" por um card **"Consumo do ciclo"** (gasto até agora, projeção do mês, horas ativo vs. pausado). Trocar "1 GHz" por "1 vCPU".

---

### 1.4 Domínio → Status

**Rota:** `/hosting/{d}/domain` · **VelozPanel:** `/ambientes/{id}/dominio`

| Elemento | Tipo | Operação implicada |
|---|---|---|
| Alerta verde "Seu domínio já está configurado corretamente!" | estado | Resolução DNS ao vivo comparando NS atual × NS esperado |
| Tabela DNS atual × DNS recomendado (`ns1..ns4.hostoo.io`) | tabela | Consulta de NS autoritativos do domínio |
| Aviso "modificações podem demorar até 24 horas" | texto | Educação sobre TTL |

**Bom copiar:** o diagnóstico verde/vermelho automático é o melhor elemento desta tela — elimina ticket de suporte. Manter.
**Ruim:** exige 4 nameservers; não mostra **quando** foi a última verificação nem oferece "verificar agora".
**Melhorar:** botão "Verificar novamente" + timestamp; e um caminho alternativo ("não quero trocar NS, quero só apontar A/CNAME") que hoje não existe.

---

### 1.5 Domínio → Editor de DNS

**Rota:** `/hosting/{d}/dns`

| Elemento | Tipo | Operação implicada |
|---|---|---|
| Busca, **Exportar**, **Restaurar padrões**, **Adicionar registro** | ações | Export de zona (BIND), reset de zona, criação de RR |
| Tabela agrupada por tipo: A, CNAME, MX, DKIM, DMARC, SPF, TXT | tabela | Leitura da zona autoritativa |
| Registros vistos: `@`, `mail`, `ftp`, `webmail` (A); `www` (CNAME); `@`→`mail.` prio 0 (MX); `default._domainkey` (DKIM); `_dmarc` v=DMARC1 p=none (SPF/DMARC); `_acme-challenge` (TXT) | dados | Zona provisionada automaticamente no ato da criação |
| Chevron ▾ por linha | menu | Editar / excluir registro |

**Bom copiar:** **agrupar por tipo de registro com nome amigável entre parênteses** ("MX (Mail Exchanger)") — é a melhor tradução de DNS para leigo que vi. Provisionar DKIM/SPF/DMARC automaticamente na criação. Botão "Restaurar padrões" (rede de segurança).
**Ruim:** valores longos truncados com `...` sem forma de ver o inteiro sem abrir o menu; sem coluna de TTL; sem indicação de quais registros são gerenciados pelo sistema (mexer no `_acme-challenge` quebra o SSL e nada avisa).
**Melhorar:** marcar registros gerenciados como **somente leitura com cadeado**; adicionar TTL; permitir importar zona.

---

### 1.6 Domínio → Apontamentos (alias)

**Rota:** `/hosting/{d}/alias`

| Elemento | Operação implicada |
|---|---|
| Texto explicativo (meudominio.net exibe conteúdo de meudominio.com) | — |
| Busca + **Adicionar domínio** | Adicionar `ServerAlias` ao vhost + reload + incluir domínio no SAN do certificado |
| Tabela `Domínio` (ex.: `rotativo.net`) + chevron ▾ | Remover alias |

**Bom copiar:** a explicação em linguagem natural antes da tabela — o Hostoo faz isso em toda tela e funciona.
**Ruim:** não mostra se o alias já resolve para o servidor nem se o certificado o cobre. O cliente adiciona e não sabe se funcionou.
**Melhorar:** coluna **Status** (DNS OK / SSL OK / pendente) por alias.

---

### 1.7 Domínio → Subdomínios

**Rota:** `/hosting/{d}/subdomain`

| Elemento | Operação implicada |
|---|---|
| Busca + **Adicionar subdomínio** | Criar registro A + vhost/diretório + incluir no certificado |
| Tabela `Subdomínio` × `Diretório` (`webmail.oliveirafacil.com` → `/public_html`) | Mapeamento subdomínio → docroot |

**Ruim:** `webmail.*` aparece como subdomínio "do cliente" mas é do sistema, apontando para `/public_html` (o que é enganoso — o webmail não está lá).
**Melhorar:** separar subdomínios de sistema dos criados pelo usuário.

---

### 1.8 Domínio → Redirecionamentos

**Rota:** `/hosting/{d}/redirect`

| Elemento | Operação implicada |
|---|---|
| Busca + **Adicionar redirecionamento** | Regra de rewrite/redirect no servidor web + reload |
| Tabela `Tipo` × `Origem` × `Destino` (vazia: "Nenhum redirecionamento encontrado") | — |
| Nota: funciona com/sem `https` e `www` | Normalização automática de variantes |

**Bom copiar:** tratar as 4 variantes (http/https × com/sem www) automaticamente — é exatamente a dor real e o Hostoo resolve calado.
**Melhorar:** expor escolha 301 vs 302 e suporte a wildcard de path.

---

### 1.9 Arquivos → Gerenciador

**Rota:** `/hosting/{d}/files`

| Elemento | Operação implicada |
|---|---|
| Banner verde "Garanta a integridade dos seus dados" + **Ativar** | Upsell de backup diário (repetido nas 4 abas de Arquivos) |
| Breadcrumb `📁 /` | Navegação |
| Ícones: home, subir nível, voltar, avançar, atualizar, **Selecionar todos** | Navegação no FS do ambiente |
| **Nova Pasta**, **Novo Arquivo**, Renomear, Compactar, Excluir, Download, Upload | Operações de FS como o usuário do sistema (mkdir, touch, mv, zip, rm, stream, upload multipart) |
| Tabela `Nome` × `Tamanho` × `Modificação` — estado **"Carregando..."** | Listagem de diretório |
| Botão **? Ajuda** | Documentação contextual |

**Bom copiar:** botões contextuais **desabilitados até haver seleção** (Renomear/Compactar/Excluir estão cinza) — feedback correto. Botão de ajuda por tela.
**Ruim:** a tela foi capturada em "Carregando..." — o gerenciador é lento; não há editor de código visível; sem indicação de permissões (chmod) nem de dono.
**Melhorar:** editor de texto/código embutido (é o que o cliente PHP mais usa), coluna de permissões, drag-and-drop de upload com barra de progresso, e busca recursiva.

---

### 1.10 Arquivos → FTP

**Rota:** `/hosting/{d}/ftp`

| Bloco | Campos | Operação implicada |
|---|---|---|
| Acesso FTP | Host `ftp.dominio`, Porta **21**, Usuário `p1ulbhre`, Senha (mascarada), Host alternativo `cluster-web02.br`, IP | Conta FTP principal = usuário do sistema |
| **Alterar senha** | botão | Reset de senha do usuário de sistema (afeta FTP **e** SSH — não avisado) |
| Usuários FTP Adicionais | busca + **Adicionar usuário**, tabela `Usuário` × `Diretório` | Usuários virtuais FTP com chroot em subdiretório |
| Link para FileZilla | externo | — |

**Ruim grave:** **porta 21, FTP puro**, sem menção a FTPS/SFTP. Isso é senha em texto claro na rede em 2026. Inaceitável para o VelozPanel.
**Melhorar:** VelozPanel oferece **SFTP como padrão** (mesma porta do SSH, mesma chave), FTPS explícito como legado opcional e FTP simples **desligado por padrão**.

---

### 1.11 Arquivos → Deploy (Git)

**Rota:** `/hosting/{d}/deploy`

| Elemento | Operação implicada |
|---|---|
| Texto: publica repo e atualiza a cada `git push` no branch configurado | Webhook do provedor → pull/checkout no ambiente |
| Busca + **Adicionar integração** | OAuth com o provedor |
| Tabela `Serviço` × `Repositório` × `Branch` × `Diretório` (vazia) | — |
| **Modal "Adicionar integração com repositório GIT"**: cards GitLab (**Integrar**), GitHub (**Integrar**), Bitbucket (**Em breve**, desabilitado) | OAuth app por provedor |

**Bom copiar:** deploy por push sem CI externo é exatamente o que o público PHP/Node quer, e o modal de 3 cards é claríssimo. Estado "Em breve" desabilitado é honesto.
**Ruim:** não há **build step** (sem `composer install`, `npm ci`, `npm run build`, `artisan migrate`). Para Node isso é inutilizável; para Laravel, quase. Não há histórico de deploys nem rollback.
**Melhorar (diferencial VelozPanel):** deploy com **fases declaradas** (build → hooks → swap de symlink atômico), **log de deploy em streaming**, **histórico com rollback em 1 clique** e chave de deploy própria como alternativa ao OAuth.

---

### 1.12 Arquivos → Backup

**Rota:** `/hosting/{d}/backup`

| Bloco | Elementos | Operação implicada |
|---|---|---|
| Restauração de Backup | Tabela `Data` (carregando) + texto: restaura arquivos, bancos, subdomínios e configurações | Snapshot completo do ambiente; restore destrutivo |
| Backup Diário | Alerta vermelho "não está ativo" + **Ativar backup diário** | Feature **paga**, opt-in |

**Ruim:** backup é add-on pago e **desligado por padrão** — e o painel implora por ele com banner verde em 4 telas. Isso é dark pattern leve: o produto sabe que o cliente vai perder dados.
**Melhorar (diferencial):** VelozPanel inclui **retenção curta grátis** (ex.: 7 diários) no preço, e vende retenção longa/off-site. Além disso: **restauração seletiva** (só o banco, só um diretório, só um arquivo) e **download do backup** — nenhum dos dois existe no Hostoo. E **confirmação com digitação do domínio** antes de restaurar (a operação é destrutiva e hoje está a um clique de um chevron).

---

### 1.13 Banco de Dados

**Rota:** `/hosting/{d}/database`

| Bloco | Elementos | Operação implicada |
|---|---|---|
| Bancos de Dados | Busca + **Adicionar banco de dados**; tabela `Tipo` (MySQL) × `Nome` (`db_rotativo`) × `Usuário` (`user_rotativo`) × `Uso de Disco` (9 MB) + ▾ | CREATE DATABASE + CREATE USER + GRANT; medição de tamanho |
| Acesso Remoto (MySQL) | **Toggle ligado**; IP `200.9.22.2`, Porta `3306`; radio: "Permitir acesso a partir de qualquer IP" (selecionado) × "Limitar acesso a apenas alguns IPs" | Bind + firewall + host do grant (`user@'%'`) |
| Versão do Banco de Dados | MySQL `8.0.46-cll-lve`, PostgreSQL `10.23` | Somente leitura |

**Bom copiar:** mostrar uso de disco por banco; ter MySQL **e** PostgreSQL no mesmo lugar com o mesmo fluxo.
**Ruim (crítico):** o padrão exibido é **acesso remoto ligado + qualquer IP** — porta 3306 aberta para a internet. É a pior configuração possível como default. Além disso: PostgreSQL **10.23** está morto (EOL 2022) e não é selecionável; não há phpMyAdmin/Adminer visível; não há export/import; não há botão de resetar senha do usuário do banco na tabela principal.
**Melhorar:** acesso remoto **desligado por padrão**; se ligado, exigir lista de IPs (a opção "qualquer IP" deve exigir confirmação explícita). **Seletor de versão** do banco (MySQL 8.0/8.4, MariaDB, PostgreSQL 15/16/17). Botões **Exportar (dump)** e **Importar**, e um cliente web (Adminer) por ambiente.

---

### 1.14 E-mail → Contas de e-mail

**Rota:** `/hosting/{d}/email`

| Bloco | Elementos | Operação implicada |
|---|---|---|
| Contas de E-mail | Busca + **Adicionar conta de e-mail**; tabela `E-mail` × `Uso de Disco` × `Limite` (carregando) | Criação de caixa postal com quota |
| Encaminhadores de e-mail | Busca + **Adicionar encaminhador**; tabela `E-mail` × `Destino` (vazia); nota "não ocupa espaço em disco" | Alias/forward no MTA |

**Bom copiar:** distinguir claramente **caixa** (ocupa disco) de **encaminhador** (não ocupa) — evita cliente criando caixa à toa.

### 1.15 E-mail → Listas de e-mails
**Rota:** `/hosting/{d}/email-lists` — Busca + **Criar lista de e-mails**; tabela `Lista` × `Uso de Disco` (vazia). Implica gerenciador tipo Mailman por domínio.
**Avaliação:** feature de baixíssimo uso e alto custo de manutenção. **Não implementar** no VelozPanel (nem em v2).

### 1.16 E-mail → Dados de acesso
**Rota:** `/hosting/{d}/email-access` — Duas colunas: **SSL ativado (recomendado)** — servidor `mail.dominio`, IMAP 993, POP3 995, SMTP 465 — e **SSL desativado** — IMAP 143, POP3 110, SMTP 587.
**Bom copiar:** layout de duas colunas com o recomendado à esquerda e rotulado. Ótima densidade, zero ambiguidade.
**Ruim:** oferecer a coluna sem SSL com igual proeminência; SMTP 587 classificado como "sem SSL" é tecnicamente errado (587 é STARTTLS).
**Melhorar:** coluna insegura colapsada atrás de "mostrar configurações legadas" + botão **copiar** em cada valor.

### 1.17 E-mail → Antispam
**Rota:** `/hosting/{d}/antispam`

| Elemento | Operação implicada |
|---|---|
| Alerta amarelo: MX precisa estar correto | Diagnóstico |
| Tabela `MX atual` (0 `mail.oliveirafacil.com`) × `MX recomendado` (0 `pmg2.samtooweb.com`, 10 `pmg3.samtooweb.com`) | Roteamento do MX para gateway antispam externo |
| Exceções: select "Conta de e-mail" → allow/block list | Regras por caixa |

**Ruim:** o painel diz que o antispam precisa do MX apontado para `samtooweb.com`, mas o próprio provisionamento automático criou o MX para `mail.oliveirafacil.com`. **O produto contradiz a si mesmo e joga a resolução no cliente.** Nenhum botão "corrigir para mim".
**Melhorar:** botão **"Aplicar configuração recomendada"** que reescreve o MX. Esse é o padrão que o VelozPanel deve adotar em toda tela de diagnóstico: nunca só apontar o erro — oferecer o conserto.

### 1.18 E-mail → Webmail
**Rota:** `/hosting/{d}/webmail` — **Acessar webmail** (link externo), **Logotipo** (upload JPG/PNG, máx 100 KB, ideal 210×70) e **Personalização** (select "Cor personalizada: Padrão" + **Salvar**).
**Bom copiar:** white-label leve do webmail é ótimo argumento para o público **agência**, que é justamente quem revende hospedagem. Barato de fazer, alto valor percebido.

---

### 1.19 Aplicativos (lista) e Instalar aplicativo

**Rotas:** `/hosting/{d}/apps` e `/hosting/{d}/app-install`

Lista: busca + **Instalar aplicativo**; tabela `Aplicativo` × `Diretório` × `Instalado em` (vazia).
Catálogo (14 itens, todos PHP): WordPress (CMS), **Admin Host (Revenda)**, Joomla, Drupal, Magento, PrestaShop, OpenCart, WHMCS, Mautic, MediaWiki, phpBB, Moodle, **Laravel (Framework)**, **CodeIgniter (Framework)** — cada card com ícone, nome, categoria e botão **Instalar**.

**Operação implicada:** download da release → extração no docroot → criação de banco + usuário → escrita de config → seed/migrate → (para WP) criação de admin.

**Bom copiar:** incluir **frameworks vazios** (Laravel, CodeIgniter) e não só CMS — atende dev, não só dono de site. Categoria abaixo do nome.
**Ruim:** catálogo 100% PHP (zero Node/Python); sem versão do app exibida; sem escolha de diretório/subdomínio no card; a categoria "Revenda" (Admin Host, WHMCS) sinaliza que o público real é revenda — e o produto não tem tela nenhuma de revenda.
**Melhorar:** catálogo com **stacks Node** (Next.js, Strapi, n8n, Ghost, Directus) e Python; wizard de instalação com domínio/subdiretório, versão e criação de admin; e marcação de apps que exigem mais RAM do que o plano atual comporta.

---

### 1.20 Configurações → PHP

**Rota:** `/hosting/{d}/php`

| Elemento | Detalhe | Operação implicada |
|---|---|---|
| **Versão do PHP** | Botões segmentados: 5.6, 7.0, 7.2, 7.3, 7.4, 8.0, 8.1, 8.2, **8.3** (ativo), 8.4 | Troca de pool PHP-FPM / handler EasyApache + restart |
| post_max_size | slider, 20 MB | php.ini por usuário |
| upload_max_filesize | slider, 20 MB | idem |
| memory_limit | slider, 128 MB | idem |
| max_execution_time | slider, 30 seg | idem |
| max_input_time | slider, 60 seg | idem |
| max_input_vars | slider, 1000 | idem |
| display_errors | toggle, off | idem |
| output_compression | toggle, off | idem |
| **Restaurar padrões** / **Salvar** | ações | Rewrite do ini + reload do pool |

**Bom copiar — esta é a melhor tela do painel.** Dez versões em uma linha de botões, troca instantânea, e diretivas em **slider com valor e explicação em português**. É o requisito nº 7 do briefing já resolvido pelo concorrente; o VelozPanel precisa igualar isso no dia 1 e generalizar para Node/Python.
**Ruim:** não há aviso de risco/impacto ao trocar de versão (nem "seu site pode quebrar", nem teste de compatibilidade, nem downtime esperado); não há gestão de **extensões** (imagick, redis, intl); não mostra se é FPM ou CGI; oferecer PHP 5.6 e 7.x (EOL) sem sinalizar risco de segurança é irresponsável.
**Melhorar:** marcar versões EOL com selo vermelho; mostrar "reinicia o ambiente, ~2s de indisponibilidade"; aba de **extensões** com toggles; e **[PROPOSTA NOVA]** um "modo de teste": aplicar a nova versão só ao domínio alternativo antes de promover.

### 1.21 Configurações → HTTPS
**Rota:** `/hosting/{d}/ssl`

| Elemento | Operação implicada |
|---|---|
| Texto: Let's Encrypt, gratuito, renovação automática, cobre domínio principal + subdomínios | ACME (HTTP-01 ou DNS-01) + renovação por job |
| Alerta verde "O certificado SSL está habilitado em sua hospedagem!" | Estado do cert |
| **Sempre usar HTTPS** — toggle (desligado) | Redirect 301 HTTP→HTTPS no vhost + reload |

**Ruim:** o toggle "Sempre usar HTTPS" está **desligado** num site que já tem certificado válido — configuração pior que o default de mercado. Não mostra **emissor, validade nem data da próxima renovação**. Não há upload de certificado próprio nem botão de reemitir.
**Melhorar:** HTTPS forçado **ligado por padrão**; card com emissor, SANs cobertos, expira em / renova em; botões **Reemitir** e **Importar certificado próprio**; e HSTS como opção avançada.

### 1.22 Configurações → SSH
**Rota:** `/hosting/{d}/ssh`

| Elemento | Detalhe | Operação implicada |
|---|---|---|
| **Habilitar acesso SSH** | toggle (ligado) | Shell do usuário: `/bin/bash` ↔ `nologin` |
| Dados | IP `200.9.22.2`, Usuário `p1ulbhre`, **Porta 46136**, Senha (mascarada), Comando CLI `ssh -m hmac-sha2-512 p1ulbhre@ssh.samtooweb.com -p 46136` | Porta não-padrão por servidor |
| Chaves públicas autorizadas | Busca + **Adicionar**; tabela `Título` × `Criada em` (`id_rsa` 27/07/2026, `local` 14/08/2026) + ▾ | Escrita em `authorized_keys` |

**Bom copiar:** entregar o **comando pronto para colar** — elimina erro de digitação e ticket. Gestão de chaves com título e data.
**Ruim:** permite senha no SSH (deveria ser chave-only quando houver chave); o `-m hmac-sha2-512` no comando denuncia configuração legada; não há botão "copiar".
**Melhorar:** botão copiar; opção "desabilitar login por senha"; e mostrar **último acesso** por chave.

### 1.23 Configurações → Cron
**Rota:** `/hosting/{d}/cron`

Lista: busca + **Adicionar tarefa**; tabela `Intervalo` (`*/1 * * * *`) × `Comando` (`cd /home/p1ulbhre/rotativo-back && /opt/cpanel/ea-php83/root/usr/bin/php artisan integracao:disparar-nota-paga`) + ▾.
Modal **Adicionar tarefa**: select **Intervalo de execução** ("A cada 5 minutos"), input **Comando**, caixa de exemplo (`/usr/local/bin/php ~/public_html/caminho/do/script.php`), botões **Cancelar** / **Salvar**.

**Bom copiar:** select de intervalos amigáveis em vez de exigir sintaxe cron. Exemplo pronto dentro do modal.
**Ruim grave:** o exemplo mostra `/usr/local/bin/php`, mas o cron **real** funcional usa `/opt/cpanel/ea-php83/root/usr/bin/php`. **A documentação do próprio painel está errada e leva o usuário a criar cron quebrado.** Pior: não há **histórico de execução, saída (stdout/stderr), status nem duração**. O cliente não tem como saber se a tarefa rodou. A tabela também não mostra "última execução" nem "próxima".
**Melhorar (diferencial claro):** (1) o painel injeta o binário correto — o usuário digita `php artisan ...` e o sistema resolve a versão do ambiente; (2) **log de execuções** com status, duração e saída (últimas N); (3) colunas próxima/última execução; (4) botão **Executar agora**; (5) alerta por e-mail em falha; (6) proteção contra sobreposição (lock).

### 1.24 Configurações → Logs
**Rota:** `/hosting/{d}/logs`

Toggle de fonte: **PHP** | **Servidor Web**. Tabela `Data` × `Tipo` (com `?` explicativo) × `Mensagem` — "Nenhum log de erro encontrado." Texto: registros com ícone de lâmpada 💡 têm **dica de como resolver**.

**Bom copiar — é o recurso mais inteligente do painel:** **sugestão de correção anexada à linha de log**. Transforma log em suporte automatizado. Copiar e ampliar.
**Ruim:** só logs de **erro**; sem acesso ao log de **acesso** (nenhuma analítica de tráfego em todo o painel); sem download, sem busca, sem filtro por data/severidade, sem tail ao vivo.
**Melhorar:** busca + filtro de severidade + intervalo; **stream ao vivo**; download; e incluir logs de **deploy**, **cron** e **serviço/aplicação Node** na mesma tela, com seletor de fonte.

---

## 2. Mapa de navegação do painel do cliente (Hostoo, reconstruído)

```
GLOBAL
├── Topo: saldo (R$) · recarregar · indique e ganhe · gamificação · perfil/avatar
├── FABs: chat · ajuda · suporte
├── Sidebar: busca · Hospedagens [+] · lista de ambientes (com status)
└── Rodapé "Acesso Rápido" (em todas as telas):
    Migração · WordPress · Hospedagens · Domínios · Suporte · Créditos · Acessos · Perfil

HOSPEDAGEM /hosting/{dominio}
├── Header persistente: ⏸ pausar · ⬆ migrar · ✏ editar · ⤫ trocar domínio · 🗑 excluir
│                       chips ATIVO / HTTPS / PHP 8.3 / COMPARTILHAR
│                       barras CPU · RAM · Disco
├── Resumo ......... dados do plano · Alterar plano · endereços · gráficos · acelerador WP
├── Domínio
│   ├── Status ............. NS atual × recomendado
│   ├── Editor de DNS ...... A/CNAME/MX/DKIM/DMARC/SPF/TXT · exportar · restaurar · adicionar
│   ├── Apontamentos ....... domínios alias
│   ├── Subdomínios ........ subdomínio → diretório
│   └── Redirecionamentos .. tipo · origem · destino
├── Arquivos
│   ├── Gerenciador ........ FS: pasta/arquivo/renomear/compactar/excluir/download/upload
│   ├── FTP ................ credenciais (porta 21) · alterar senha · usuários adicionais
│   ├── Deploy ............. Git: GitLab/GitHub/Bitbucket(em breve) · repo/branch/diretório
│   └── Backup ............. restaurar por data · ativar backup diário (pago)
├── Banco de Dados ......... bancos MySQL/PgSQL · acesso remoto (toggle+IPs) · versões
├── E-mail
│   ├── Contas de e-mail ... caixas + encaminhadores
│   ├── Listas de e-mails
│   ├── Dados de acesso .... IMAP/POP3/SMTP com e sem SSL
│   ├── Antispam ........... MX atual × recomendado · exceções por conta
│   └── Webmail ............ acessar · logotipo · cor
├── Aplicativos ............ instalados · [Instalar aplicativo] → catálogo de 14 apps PHP
└── Configurações
    ├── PHP ................ versão (5.6→8.4) · 6 sliders · 2 toggles
    ├── HTTPS .............. status do cert · Sempre usar HTTPS (toggle)
    ├── SSH ................ habilitar · credenciais · chaves públicas
    ├── Cron ............... intervalo · comando
    └── Logs ............... PHP | Servidor Web
```

**Áreas globais existentes mas não capturadas** (inferidas do "Acesso Rápido"): Migração, Domínios (registro/gestão), Suporte, Créditos (saldo/faturas), Acessos (usuários e permissões), Perfil.

---

## 3. Inventário de features

Complexidade = esforço para um time de 1–3 devs. Prioridade = MVP (lançar) / v1 (90 dias) / v2 (6–12 meses) / futuro.

### 3.1 Núcleo do ambiente

| Feature | Tela | Complexidade | Módulo sugerido | Prioridade |
|---|---|---|---|---|
| Criar ambiente (provisionar) | Hospedagens [+] | Alta | `core-provision` | MVP |
| Header de estado (chips + métricas) | Header | Baixa | `core-ui` | MVP |
| Pausar / iniciar ambiente | Header ⏸ | Média | `core-lifecycle` | MVP |
| Excluir ambiente (com confirmação forte) | Header 🗑 | Baixa | `core-lifecycle` | MVP |
| Alterar plano (resize CPU/RAM/disco a quente) | Resumo | Alta | `core-resize` | MVP |
| Renomear / trocar domínio principal | Header ✏ ⤫ | Média | `core-domain` | v1 |
| Compartilhar ambiente com colaborador | Header | Média | `iam` | v1 |
| Migração assistida de outro provedor | Header ⬆ | Alta | `migration` | v2 |

### 3.2 Domínio e DNS

| Feature | Tela | Complexidade | Módulo | Prioridade |
|---|---|---|---|---|
| Diagnóstico de NS (atual × esperado) | Domínio/Status | Baixa | `dns` | MVP |
| Editor de DNS agrupado por tipo | Domínio/DNS | Média | `dns` | MVP |
| Provisionar zona padrão (A, www, MX, SPF, DKIM, DMARC) | automático | Média | `dns` | MVP |
| Exportar / restaurar zona | Domínio/DNS | Baixa | `dns` | v1 |
| Registros gerenciados travados (cadeado) | Domínio/DNS | Baixa | `dns` | v1 |
| Subdomínios → diretório | Domínio/Sub | Baixa | `web` | MVP |
| Apontamentos (alias) + status DNS/SSL por alias | Domínio/Alias | Média | `web` | v1 |
| Redirecionamentos (301/302, 4 variantes) | Domínio/Redirect | Baixa | `web` | v1 |
| Registro/transferência de domínio | global | Alta | `registrar` | futuro |

### 3.3 Arquivos, deploy e backup

| Feature | Tela | Complexidade | Módulo | Prioridade |
|---|---|---|---|---|
| Gerenciador de arquivos (CRUD + upload/download) | Arquivos | Média | `files` | MVP |
| Editor de código embutido | Arquivos | Média | `files` | v1 |
| Compactar / descompactar | Arquivos | Baixa | `files` | v1 |
| **SFTP** (chave + senha) | Arquivos/FTP | Baixa | `files` | MVP |
| FTPS (legado, opt-in) | Arquivos/FTP | Média | `files` | v2 |
| Usuários FTP/SFTP adicionais com chroot | Arquivos/FTP | Média | `files` | v2 |
| Deploy via Git (GitHub/GitLab) | Arquivos/Deploy | Alta | `deploy` | v1 |
| Build step (composer/npm) + hooks | Arquivos/Deploy | Alta | `deploy` | v1 |
| Histórico de deploy + rollback | Arquivos/Deploy | Média | `deploy` | v1 |
| Backup automático + restauração total | Arquivos/Backup | Alta | `backup` | MVP |
| Restauração seletiva (arquivo/dir/banco) | Arquivos/Backup | Alta | `backup` | v2 |
| Download do backup | Arquivos/Backup | Média | `backup` | v1 |

### 3.4 Banco de dados

| Feature | Tela | Complexidade | Módulo | Prioridade |
|---|---|---|---|---|
| Criar/excluir banco + usuário + grant (MySQL) | Banco | Baixa | `db-mysql` | MVP |
| Idem PostgreSQL | Banco | Baixa | `db-postgres` | MVP |
| Uso de disco por banco | Banco | Baixa | `db-*` | MVP |
| Acesso remoto com allowlist de IP (off por padrão) | Banco | Média | `db-*` | MVP |
| Export (dump) / import | Banco | Média | `db-*` | v1 |
| Cliente web (Adminer) | Banco | Baixa | `db-*` | v1 |
| **Seletor de versão do banco** | Banco | Alta | `db-*` | v2 |
| Redis / Valkey por ambiente | — | Média | `db-redis` | v2 |

### 3.5 E-mail

| Feature | Tela | Complexidade | Módulo | Prioridade |
|---|---|---|---|---|
| Contas de e-mail com quota | E-mail/Contas | Alta | `mail` | v1 |
| Encaminhadores | E-mail/Contas | Baixa | `mail` | v1 |
| Dados IMAP/POP3/SMTP com botão copiar | E-mail/Acesso | Baixa | `mail` | v1 |
| Antispam + botão "aplicar MX recomendado" | E-mail/Antispam | Alta | `mail-antispam` | v2 |
| Webmail (Roundcube/SnappyMail) | E-mail/Webmail | Média | `mail-webmail` | v1 |
| White-label do webmail (logo + cor) | E-mail/Webmail | Baixa | `mail-webmail` | v2 |
| Listas de e-mail | E-mail/Listas | Alta | — | **não fazer** |
| SMTP relay de saída (só envio) | — | Baixa | `mail-relay` | v1 |

> **Recomendação:** e-mail é o módulo com pior relação valor/manutenção (reputação de IP, blacklists, spam de saída, LGPD). O próprio Hostoo terceirizou o antispam. **VelozPanel: no MVP, entregar apenas SMTP de saída (relay via provedor externo). Caixas postais completas só em v1, e sempre como módulo removível.**

### 3.6 Aplicativos

| Feature | Tela | Complexidade | Módulo | Prioridade |
|---|---|---|---|---|
| Catálogo 1-click (WordPress, Laravel) | Aplicativos | Média | `apps` | v1 |
| Catálogo estendido PHP (Joomla, Moodle, ...) | Aplicativos | Média | `apps` | v2 |
| **Catálogo Node** (Next.js, Strapi, Ghost, n8n) | Aplicativos | Média | `apps` | v1 |
| Aviso de app que excede o plano | Aplicativos | Baixa | `apps` | v2 |
| Acelerador/cache (Redis + page cache) | Resumo | Média | `cache` | v2 |

### 3.7 Runtime e operação

| Feature | Tela | Complexidade | Módulo | Prioridade |
|---|---|---|---|---|
| **Seletor de versão PHP (5.6→8.4)** | Config/PHP | Média | `runtime-php` | MVP |
| **Seletor de versão Node** | Config/Node | Média | `runtime-node` | MVP |
| Diretivas php.ini via slider | Config/PHP | Baixa | `runtime-php` | MVP |
| Extensões PHP (toggles) | Config/PHP | Média | `runtime-php` | v1 |
| Selo de EOL + aviso de impacto na troca | Config/PHP | Baixa | `runtime-*` | MVP |
| Gestão de processo Node (start/stop/restart, env vars) | Config/Node | Alta | `runtime-node` | MVP |
| Runtimes extras (Python, Go, Bun, Deno) | Config | Alta | `runtime-*` | v2 |
| SSL Let's Encrypt automático + renovação | Config/HTTPS | Média | `ssl` | MVP |
| Forçar HTTPS (padrão **ligado**) | Config/HTTPS | Baixa | `ssl` | MVP |
| Importar certificado próprio | Config/HTTPS | Baixa | `ssl` | v2 |
| SSH habilitável + chaves públicas | Config/SSH | Média | `ssh` | v1 |
| Cron com intervalos amigáveis | Config/Cron | Baixa | `cron` | MVP |
| **Log de execução do cron (saída/status/duração)** | Config/Cron | Média | `cron` | v1 |
| Logs de erro (PHP + web) | Config/Logs | Baixa | `logs` | MVP |
| Dica de correção anexada ao log | Config/Logs | Média | `logs` | v2 |
| Log ao vivo (stream) + download | Config/Logs | Média | `logs` | v1 |
| Logs de acesso / analítica de tráfego | — | Média | `logs` | v2 |

### 3.8 Conta, cobrança e suporte

| Feature | Tela | Complexidade | Módulo | Prioridade |
|---|---|---|---|---|
| Saldo pré-pago em BRL no topo | Global | Baixa | `billing` | MVP |
| Recarga (Pix + cartão) | Créditos | Média | `billing` | MVP |
| **Medidor de consumo por hora + gasto do ciclo** | Resumo/Créditos | Média | `billing` | MVP |
| Faturas / extrato de consumo | Créditos | Média | `billing` | MVP |
| Usuários e permissões da conta | Acessos | Média | `iam` | v1 |
| Perfil / 2FA | Perfil | Média | `iam` | v1 |
| Suporte (tickets/chat) | Suporte | Média | `support` | v1 |
| Indique e ganhe / gamificação | Global | Média | `growth` | futuro |

---

## 4. Telas que o Hostoo NÃO tem e que o VelozPanel precisa ter

Todas as seguintes são **[PROPOSTA NOVA]** — nenhuma aparece nas 25 imagens.

### 4.1 Painel Super Admin — Dashboard da operação
Visão única da frota: nº de servidores, ambientes ativos/pausados/suspensos, CPU/RAM/disco **agregados e por nó**, receita do dia/mês, margem estimada (receita − custo de servidor), jobs em fila e falhas nas últimas 24h, alertas abertos. É a tela que o Tiago abre de manhã.

### 4.2 Super Admin — Servidores (frota)
Lista de nós com: nome, IP, região, papel (web/db/mail/proxy), estado (online/degradado/manutenção), versão do agente, **capacidade x alocado x usado** (overcommit visível), nº de ambientes, uptime. Ações: **drenar** (parar de receber novos ambientes), **entrar em manutenção**, atualizar agente, reiniciar serviço. Detalhe do nó com gráficos e lista de ambientes hospedados nele.

### 4.3 Super Admin — Detalhe do cliente / ambiente
Espelho do painel do cliente **em modo somente-leitura + ações administrativas**: impersonar ("ver como cliente"), suspender/reativar, **alterar vCPU e RAM a quente** (requisito nº 9 do briefing), mover ambiente entre servidores, forçar backup, forçar restart, ver auditoria daquele ambiente.

### 4.4 Super Admin — Alteração de recursos (vCPU / RAM / disco)
Formulário dedicado com: valores atuais → novos, **impacto na tarifa horária calculado ao vivo**, se exige restart, capacidade disponível no nó de destino, campo obrigatório de **motivo**, e registro em auditoria. Suporta aplicar como override permanente ou temporário (ex.: 24h para uma campanha).

### 4.5 Super Admin — Planos e preços
CRUD de planos (nome, vCPU, RAM, disco, tráfego, preço/hora, preço/mês equivalente, teto mensal), custo de disco em ambiente pausado, add-ons (backup, IP dedicado, RAM extra), e cupons. Sem essa tela, mudar preço vira deploy.

### 4.6 Super Admin — Faturamento e receita
Receita por dia/mês, MRR estimado, consumo por cliente, **clientes com saldo baixo** (risco de suspensão nas próximas 48h), inadimplência, conciliação Pix/cartão, emissão de nota. Inclui **simulador**: "se eu subir o preço/hora em X%, o efeito é Y".

### 4.7 Super Admin — Clientes
Lista com busca: nome, e-mail, CPF/CNPJ, saldo, nº de ambientes, gasto/mês, data de cadastro, estado (ativo/suspenso/inadimplente), nível de risco (abuso, spam). Ações: creditar saldo, suspender, exportar dados (LGPD), excluir conta (LGPD).

### 4.8 Super Admin — Filas e jobs
Toda ação do painel (provisionar, resize, emitir SSL, backup, deploy, restore) é um job assíncrono. Tela com: fila, em execução, concluídos, **falhados com log e botão reprocessar**, tempo médio por tipo, jobs travados. **É a tela mais importante para operação de 1 pessoa** — sem ela, qualquer falha silenciosa vira ticket.

### 4.9 Super Admin — Módulos
Requisito nº 2 e 10 do briefing. Lista de módulos (e-mail, DNS, backup, SSL, filas, cache, runtimes) com: instalado/disponível, versão, nós em que está ativo, dependências, **instalar/atualizar/remover**, link para a documentação do módulo e status de saúde. Instalar um módulo é um job visível na tela 4.8.

### 4.10 Super Admin — Observabilidade e alertas
Métricas de plataforma (não de um ambiente): latência do painel, erros 5xx por nó, saturação de disco projetada ("nó web02 enche em 12 dias"), certificados expirando, backups falhando, IP em blacklist. Regras de alerta com destino (e-mail/Telegram/WhatsApp).

### 4.11 Super Admin — Auditoria
Log imutável: quem, o quê, quando, em qual ambiente, de qual IP, resultado. Inclui **ações de impersonação** (obrigatório para LGPD e para confiança do cliente). Filtro por ator, ambiente, tipo de ação e período. Exportável.

### 4.12 Super Admin — Abuso e segurança
Ambientes com consumo anômalo, envio de spam, arquivos suspeitos, tentativas de brute force, ambientes suspensos automaticamente. Ação: limitar, suspender, notificar.

### 4.13 Cliente — Consumo e custos (falta grave no Hostoo)
Extrato horário do ambiente: horas ativo × pausado, custo acumulado no ciclo, projeção de fechamento, comparação com o mês anterior, e o **efeito financeiro de pausar** ("pausado, você gastaria R$ 0,004/h em vez de R$ 0,0486/h"). É o que transforma "cobrança por hora" de risco percebido em vantagem percebida.

### 4.14 Cliente — Status da plataforma
Página de status (incidentes, manutenções programadas por nó, histórico de uptime do **servidor do cliente**). Reduz drasticamente tickets durante incidente.

### 4.15 Cliente — Notificações
Central de eventos: deploy concluído/falhou, backup feito, cron falhou, certificado renovado, saldo baixo, ambiente pausado automaticamente. Com preferência de canal.

### 4.16 Cliente — Métricas de aplicação (v2)
Requisições/s, tempo de resposta p50/p95, taxa de erro, top URLs lentas. O Hostoo mostra só CPU/RAM/disco — infraestrutura, não aplicação. Aqui há diferencial real para o público dev.

---

## 5. Especificação de UX — Painel do cliente

### 5.1 Princípios
1. **Nunca só diagnosticar: consertar.** Todo alerta tem botão de correção (aprendizado do Antispam do Hostoo).
2. **O padrão é o seguro.** HTTPS forçado ligado, acesso remoto ao banco desligado, SFTP em vez de FTP, backup ligado.
3. **Custo sempre visível.** Cada ação que muda o gasto mostra o novo valor **antes** de confirmar.
4. **Toda operação demorada é um job com log.** Nada de spinner infinito ("Carregando..." é o que se vê em 3 telas do Hostoo).
5. **Idioma do usuário.** "1 vCPU", não "1 GHz". "Reinicia em ~2s", não "reload do pool".

### 5.2 Dashboard do ambiente (`/ambientes/{id}`)

Layout em 3 faixas:

**Faixa 1 — Header persistente** (copiado e corrigido do Hostoo)
`[ícone da stack] dominio.com` · chips: `● Ativo` `🔒 HTTPS válido (renova 12/10)` `PHP 8.3` `Node 22`
Ações primárias com rótulo: **Pausar** · **Abrir site** · **Deploy** · **Terminal**
Menu `⋯`: renomear, trocar domínio, mover de servidor, **Excluir** (vermelho, dentro do menu, com confirmação por digitação do domínio).
À direita: três medidores CPU / RAM / Disco com valor absoluto **e** percentual (`412 MB / 1 GB · 41%`), cor por faixa (verde <70, âmbar 70–90, vermelho >90).

**Faixa 2 — Três cards**
- **Custo agora** (novo): `R$ 0,0486/h` · gasto no ciclo `R$ 21,40` · projeção `R$ 35,00` · barra de horas ativo/pausado · botão "Ver extrato".
- **Saúde**: uptime 30d, últimos erros (link para Logs), status do último backup, status do último deploy.
- **Ações rápidas contextuais**: instalar app / conectar Git / criar banco — **some quando já foram feitas** (ao contrário do "Acesso Rápido" fixo do Hostoo).

**Faixa 3 — Gráficos de consumo**
Seletor de período: 1h · 6h · 24h · 7d · 30d. Métricas em abas/checkbox: CPU, RAM, Disco, Rede (in/out), Requisições/s, Tempo de resposta. Faixa de saturação sombreada (copiar do Hostoo). Marcadores verticais de eventos (deploy, restart, troca de versão, pausa) sobre o gráfico — isso responde "por que ficou lento às 14h?" sem ticket. Auto-refresh a cada 30s com indicador de "atualizado há Xs".

### 5.3 Botão pausar / iniciar

Estado **Ativo** → botão `⏸ Pausar`. Ao clicar, modal:
> **Pausar oliveirafacil.com?**
> O site sai do ar imediatamente. Arquivos, bancos e e-mails são preservados.
> Custo enquanto pausado: **R$ 0,004/h** (só armazenamento) em vez de R$ 0,0486/h.
> Economia estimada: **R$ 1,06/dia**.
> Reativar leva cerca de 10 segundos.
> `[Cancelar]` `[Pausar ambiente]`

Durante a transição: chip vira `⟳ Pausando...` com barra e link para o log do job. Estado final: chip `⏸ Pausado`, header em tom dessaturado, gráficos congelados com faixa cinza "ambiente pausado", botão `▶ Iniciar` verde. Todas as abas continuam **navegáveis em leitura**; ações de escrita ficam desabilitadas com tooltip "inicie o ambiente para editar".

**[PROPOSTA NOVA] Pausa automática:** opção "pausar automaticamente se ficar sem tráfego por N horas" e "agendar pausa" (ex.: ambiente de homologação pausa às 20h, inicia às 8h). É o argumento de venda mais forte da cobrança por hora.

### 5.4 Seletor de versão de linguagem

Copiar a régua de botões do Hostoo, generalizada por runtime e corrigida:

```
Runtime do ambiente
┌───────────────────────────────────────────────────────┐
│  PHP        ● 8.3      [5.6⚠ 7.4⚠ 8.0 8.1 8.2 (8.3) 8.4]│
│  Node.js    ● 22       [18⚠  20   (22)  24]              │
│  + adicionar runtime (Python, Go, Bun...)                │
└───────────────────────────────────────────────────────┘
⚠ = fora de suporte de segurança
```
Ao clicar numa versão, painel de confirmação inline:
> Trocar PHP 8.3 → 8.4. O ambiente reinicia (~3s de indisponibilidade). Extensões `imagick`, `redis` serão mantidas. `[Testar antes]` `[Aplicar agora]`

**[PROPOSTA NOVA] "Testar antes":** aplica a nova versão apenas ao domínio alternativo (`p1ulbhre.veloz.app`) por 30 min, com botão **Promover** ou **Descartar**. Elimina o medo de trocar versão — dor real e não resolvida pelo concorrente.

Abaixo, abas: **Diretivas** (sliders do Hostoo — copiar como está, é excelente), **Extensões** (toggles com busca), **Variáveis de ambiente** (chave/valor, valores sensíveis mascarados — essencial para Node e inexistente no Hostoo), **Processo** (para Node: comando de start, porta, instâncias, restart automático, botão Reiniciar).

### 5.5 Medidor de gasto em tempo real

Presente em dois lugares:
- **Global (topo):** chip `R$ 147,96 ▾`. Ao expandir: consumo de hoje, taxa atual somada de todos os ambientes (`R$ 0,0972/h`), **saldo dura até 14/09 (≈25 dias)**, botão **Adicionar créditos**. Chip fica âmbar com <7 dias de saldo e vermelho com <48h, sempre com o mesmo texto de urgência (nunca alarme sem explicação).
- **Por ambiente (card "Custo agora"):** ver 5.2.

**Tela `/creditos`:** saldo, botão recarregar (Pix com QR + cartão), gráfico de consumo diário dos últimos 30 dias empilhado por ambiente, tabela de lançamentos (data, ambiente, horas, taxa, valor), filtro por período e ambiente, exportar CSV, e **alertas de saldo** configuráveis. Regra de negócio exposta com clareza: o que acontece quando o saldo zera (aviso → pausa automática em X h → retenção de dados por Y dias → exclusão). Isso **precisa** estar escrito na UI, não só nos termos.

### 5.6 Padrões transversais
- **Estado vazio** sempre com CTA e uma frase de explicação (o Hostoo acerta nisso).
- **Estado de carregamento**: skeleton, nunca "Carregando..." em texto.
- **Confirmação destrutiva**: digitar o nome do recurso para excluir ambiente, restaurar backup e trocar domínio principal.
- **Copiar em 1 clique** em toda credencial, host, porta e comando.
- **Toda ação assíncrona** vira um item na central de notificações com link para o log.
- **Responsivo**: o painel do Hostoo é claramente desktop-first; o VelozPanel deve funcionar em celular ao menos para: ver status, ver custo, pausar/iniciar, ver logs e reiniciar.

---

## 6. Especificação de UX — Painel do super admin

**Rota base:** `/admin`. Visual **deliberadamente distinto** do painel do cliente (tema escuro ou faixa de cor fixa) para evitar confusão de contexto — risco real quando se usa impersonação.

### 6.1 Dashboard `/admin`
Linha de KPIs: `Servidores 3 (1 degradado)` · `Ambientes 128 (97 ativos / 31 pausados)` · `Receita hoje R$ 412` · `MRR R$ 11.240` · `Jobs falhados 24h: 2` · `Alertas abertos: 1`.
Abaixo: gráfico de receita diária (30d), heatmap de utilização por nó, lista dos 10 ambientes que mais consomem, feed de eventos críticos.

### 6.2 Lista de servidores `/admin/servidores`
| Coluna | Conteúdo |
|---|---|
| Nome / IP | `web01` · `200.9.22.1` |
| Papel | web · db · mail · proxy |
| Estado | online / degradado / manutenção / drenando |
| Agente | versão + último heartbeat |
| vCPU | alocado / capacidade (barra, com **overcommit** destacado) |
| RAM | alocado / capacidade |
| Disco | usado / capacidade + **projeção de esgotamento** |
| Ambientes | contagem (link) |
| Ações | Detalhe · Drenar · Manutenção · Atualizar agente |

Detalhe do nó: gráficos do host, serviços e seus estados, lista de ambientes com consumo, logs do agente, botão **Reprovisionar**.

### 6.3 Lista de clientes `/admin/clientes`
Colunas: Cliente · E-mail · Documento · Ambientes · Saldo · Gasto 30d · Estado · Risco · Cadastro.
Filtros: saldo baixo, inadimplente, suspenso, sem ambiente ativo, alto consumo.
Ações em massa: creditar, notificar, suspender.
Detalhe do cliente: dados, ambientes (com link para 6.4), extrato financeiro, tickets, auditoria das ações dele, botões **Creditar saldo**, **Suspender**, **Exportar dados (LGPD)**, **Ver como cliente** (impersonar — exige motivo e é auditado).

### 6.4 Ação "Alterar vCPU / RAM" `/admin/ambientes/{id}/recursos`
Requisito nº 9 do briefing, especificado:

```
Ambiente: oliveirafacil.com · nó web02 · plano Nuvem Light

              ATUAL          NOVO
vCPU          1              [ 2 ▾ ]      nó web02: 4 vCPU livres ✓
RAM           512 MB         [ 2 GB ▾ ]   nó web02: 6 GB livres ✓
Disco         15 GB          [ 30 GB ▾ ]  nó web02: 220 GB livres ✓

Tarifa:  R$ 0,0486/h  →  R$ 0,1120/h   (+130%)
Equivalente mensal:  R$ 35,00 → R$ 80,64
Aplicação:  ⦿ imediata, sem restart (CPU/RAM)   ○ agendada
Disco:  aumentar não requer restart · reduzir NÃO é permitido a quente
Cobrar do cliente?  ⦿ sim, a partir de agora   ○ não (cortesia até [data])
Motivo (obrigatório): [_______________________]
                                     [Cancelar]  [Aplicar alteração]
```
Após aplicar: job visível em 6.6, notificação ao cliente, registro em auditoria, e o card "Alterar plano" do cliente reflete o novo estado.

### 6.5 Receita e consumo `/admin/financeiro`
Receita (dia/semana/mês), MRR, ARPU, **custo de infraestrutura** cadastrado por servidor → **margem bruta por nó e por cliente**, top 20 clientes por receita, clientes com saldo <48h, conciliação de pagamentos, relatório de horas faturadas × horas pausadas (mede o impacto real do modelo por hora). Simulador de preço.

### 6.6 Filas e jobs `/admin/jobs`
Abas: **Em execução** · **Na fila** · **Falhados** · **Concluídos**.
Colunas: id, tipo (`provision`, `resize`, `ssl.issue`, `backup.run`, `deploy.run`, `restore`), ambiente, nó, iniciado, duração, tentativas, estado.
Ações: ver log completo (streaming), **reprocessar**, cancelar, marcar como resolvido. Painel lateral com tempo médio e taxa de falha por tipo — é o termômetro de saúde da automação.

### 6.7 Auditoria `/admin/auditoria`
Tabela imutável: quando · ator (admin/cliente/sistema) · IP · ação · alvo · resultado · diff (antes/depois em JSON). Filtros por ator, alvo, tipo e período. Destaque visual para **sessões de impersonação** (início, fim, tudo que foi feito dentro). Exportação CSV/JSON. Retenção mínima 12 meses.

### 6.8 Módulos `/admin/modulos`
Cards por módulo: nome, versão instalada × disponível, estado por nó, dependências, saúde, **Instalar / Atualizar / Remover**, link "Documentação". Requisito nº 10 do briefing: cada módulo entrega sua própria página de doc dentro do painel, não num wiki externo.

---

## 7. Modelo de informação (entidades expostas na UI)

Entidades derivadas do que a UI do Hostoo revela, mais o que o VelozPanel exige.

| Entidade | Campos visíveis na UI | Origem |
|---|---|---|
| **Conta** | nome, e-mail, avatar, saldo (R$), documento, estado | Hostoo (topo/perfil) |
| **Usuário** | nome, e-mail, papel, 2FA, último acesso | Hostoo ("Acessos") + proposta |
| **Colaboração** | ambiente, usuário convidado, permissões | Hostoo (chip "Compartilhar") |
| **Plano** | nome, vCPU, RAM, disco, preço/mês, **preço/hora**, região | Hostoo (Resumo) |
| **Ambiente / Hospedagem** | id, domínio principal, estado (ativo/pausado/suspenso), runtime + versão, servidor, IP, hostname alternativo, criado em, métricas CPU/RAM/disco, plano | Hostoo (header + Resumo) |
| **Servidor / Nó** | nome (`cluster-web02.br`), IP, região, papel, capacidade, estado | Hostoo expõe nome/IP; resto é proposta |
| **Domínio** | nome, tipo (principal/alias/subdomínio), diretório, status DNS, coberto por SSL | Hostoo (Domínio/*) |
| **RegistroDNS** | tipo (A/CNAME/MX/TXT/SPF/DKIM/DMARC), nome, valor, prioridade, TTL, gerenciado(bool) | Hostoo (Editor de DNS) |
| **Redirecionamento** | tipo, origem, destino | Hostoo |
| **Certificado** | emissor, domínios (SAN), emitido em, expira em, auto-renovação, forçar HTTPS | Hostoo (parcial: só status) |
| **Banco de Dados** | tipo (MySQL/PostgreSQL), nome, versão, uso de disco | Hostoo |
| **UsuárioBanco** | usuário, banco, privilégios, hosts permitidos | Hostoo (parcial) |
| **AcessoRemotoDB** | habilitado, IP, porta, allowlist | Hostoo |
| **CredencialAcesso** | tipo (FTP/SFTP/SSH), host, porta, usuário, diretório | Hostoo (FTP/SSH) |
| **ChaveSSH** | título, fingerprint, criada em, último uso | Hostoo (parcial: sem último uso) |
| **IntegraçãoGit** | serviço, repositório, branch, diretório, auto-deploy | Hostoo |
| **Deploy** [PROPOSTA] | commit, autor, iniciado, duração, estado, log, rollback-para | proposta |
| **App** | nome, categoria, versão, diretório, instalado em | Hostoo |
| **ContaEmail** | endereço, quota, uso de disco | Hostoo |
| **EncaminhadorEmail** | origem, destino | Hostoo |
| **RegraAntispam** | conta, tipo (permitir/bloquear), endereço | Hostoo |
| **TarefaCron** | intervalo, comando, ativa | Hostoo |
| **ExecuçãoCron** [PROPOSTA] | tarefa, início, duração, código de saída, stdout/stderr | proposta |
| **Backup** | data, escopo, tamanho, tipo (auto/manual), retenção | Hostoo (só data) |
| **Log** | fonte (PHP/web/deploy/cron), data, severidade, mensagem, dica | Hostoo |
| **Métrica** | ambiente, série (cpu/ram/disco/rede/req/latência), timestamp, valor | Hostoo (cpu/ram) |
| **Job** [PROPOSTA] | tipo, alvo, estado, tentativas, log, agendado para | proposta |
| **Módulo** [PROPOSTA] | nome, versão, nós ativos, dependências, saúde | proposta |
| **Lançamento de consumo** [PROPOSTA] | ambiente, início, fim, estado (ativo/pausado), taxa, valor | proposta |
| **Fatura / Extrato** | período, itens, total, pagamento, nota fiscal | Hostoo ("Créditos") |
| **Transação** | tipo (recarga/consumo/crédito), método (Pix/cartão), valor, data | Hostoo (parcial) |
| **Notificação** [PROPOSTA] | evento, ambiente, severidade, lida, canal | proposta |
| **RegistroAuditoria** [PROPOSTA] | ator, ação, alvo, IP, resultado, diff, impersonação | proposta |
| **Ticket** | assunto, estado, mensagens | Hostoo ("Suporte") |

**Relações principais:**
`Conta 1—N Ambiente` · `Ambiente N—1 Servidor` · `Ambiente N—1 Plano` · `Ambiente 1—N Domínio` · `Domínio 1—N RegistroDNS` · `Ambiente 1—N BancoDeDados` · `Ambiente 1—N ContaEmail` · `Ambiente 1—N TarefaCron 1—N ExecuçãoCron` · `Ambiente 1—N Backup` · `Ambiente 1—N Deploy` · `Ambiente 1—N LançamentoDeConsumo → Fatura` · `Job N—1 Ambiente` · `RegistroAuditoria N—1 (Usuário, Ambiente)`.

---

## 8. Recomendações finais (com trade-off e escolha única)

| Decisão | Trade-off | **Recomendação** |
|---|---|---|
| Escopo do MVP | Copiar tudo do Hostoo atrasa 6+ meses | **MVP = ambiente + domínio/DNS + arquivos/SFTP + banco + runtime (PHP/Node) + SSL + cron + logs + pausar + cobrança por hora.** E-mail e apps ficam para v1 |
| E-mail próprio | Alto valor percebido × altíssimo custo operacional | **Não fazer caixas no MVP.** Só SMTP de saída relay. Caixas em v1, como módulo removível |
| Listas de e-mail | Feature de nicho morto | **Nunca fazer** |
| FTP porta 21 | Compatibilidade com clientes legados × segurança | **SFTP como único padrão.** FTPS opt-in em v2; FTP simples jamais |
| Acesso remoto ao banco | Conveniência × porta 3306 exposta | **Desligado por padrão, allowlist obrigatória** |
| Forçar HTTPS | Pode quebrar site mal configurado | **Ligado por padrão**, com aviso e desfazer em 1 clique |
| Backup | Receita de add-on × cliente perder dados | **7 dias inclusos no preço**; retenção longa e off-site como add-on |
| Rodapé "Acesso Rápido" | Familiaridade × ruído em todas as telas | **Não copiar.** Substituir por card de consumo/custo |
| Ícones sem rótulo no header | Elegância × risco de excluir por engano | **Rótulos + excluir dentro de menu `⋯` com confirmação por digitação** |
| Exibir nome do servidor ao cliente | Transparência × tickets e vazamento de topologia | **Mostrar apenas região e, opcionalmente, um id opaco**; nome real só no admin |
| Diferenciais a perseguir | — | **(1)** log de execução do cron; **(2)** deploy com build + rollback; **(3)** troca de versão com "testar antes"; **(4)** medidor de gasto/hora e pausa agendada; **(5)** logs com dica de correção |


---
---

# Adendo — telas de conta, billing e criação (lote 2)

> Especialista: Produto & UX · Ciclo 1 (planejar) · **Lote 2**
> Fonte primária: 11 screenshots adicionais em `Plan/hostoo/*.png` — funil `hosting/create` (4 capturas, passos 2 a 5), `payment/recharge`, `payment/history`, `payment/billing`, `payment/cost`, `user/notifications`, `support/tickets`, `referral`.
> Convenção mantida: tudo que **não** aparece nas imagens está marcado como **[PROPOSTA NOVA]** ou como **[INFERÊNCIA]** quando é dedução a partir de evidência numérica.
> Este adendo **não substitui** nada do lote 1. Divergências estão isoladas em §A.10 "Correções ao lote 1".

---

## A.0 Resumo executivo do lote 2 (o que muda)

1. **O modelo do Hostoo não é cobrança por hora. É saldo pré-pago + débito horário + venda de compromisso plurianual com até 60% de desconto.** A "cobrança por hora" é a *mecânica de débito*; o produto vendido é mensalidade com trava de preço. Isso reescreve o requisito nº 5 do briefing.
2. **A data de renovação é calculada em meses de 30 dias** (1 mês → +30d, 36 meses → +1080d, conferido nas 5 opções). Isso é prova numérica de que o compromisso é comprado como **bloco de horas** (720 h/mês), não como assinatura de calendário. Consequência: pausar provavelmente **estende** o prazo, e o rótulo é "Renovação **aproximada**" exatamente por isso.
3. **Existe slider de RAM na criação** (512 MB → 32 GB), mas vCPU e disco são **derivados** da RAM, não escolhíveis. Existe escolha de **região** (Brasil × E.U.A., com preços diferentes). **Não existe** escolha de linguagem, versão de runtime, app ou servidor no funil.
4. **A área financeira é fraca justamente onde o modelo por hora exige força**: nenhuma das 4 abas mostra hora, tarifa, período, recurso ou projeção. "Demonstrativo" tem 2 colunas e 1 linha.
5. **Restaurar backup é cobrado** (`Restauração de hospedagem R$ -25,00` no histórico). O Hostoo monetiza o socorro do cliente. Não copiar.
6. **A recarga automática só aceita cartão de crédito**; todo o histórico real do cliente é **100% Pix**. O produto empurra o meio de pagamento que o cliente não usa.

---

## A.1 Funil de criação de hospedagem (`/hosting/create`)

### A.1.1 Estrutura dos 5 passos

Stepper numerado e persistente no topo de todas as telas: **1 Produto → 2 Plano → 3 Recursos → 4 Checkout → 5 Configuração**. Link `← Voltar` no canto superior direito. Coluna direita fixa com card **RESUMO** + CTA verde.

| Passo | Título da tela | Capturado? | O que realmente é |
|---|---|---|---|
| 1 | *(não capturado)* | ✗ | **[INFERÊNCIA]** Escolha da família de produto (Hospedagem / Domínio / E-mail / Revenda). O passo 2 já chega com a família definida ("Nuvem Pro" / "Nuvem Light") |
| 2 | **Escolha o seu plano** | ✓ | Dimensionamento (slider de RAM) + escolha de **região** |
| 3 | **Configure os recursos da sua hospedagem** | ✓ | **Add-ons pagos** — não é vCPU/RAM |
| 4 | **Pague agora e ganhe os melhores descontos!** | ✓ | **Upsell de compromisso pré-pago**, não é pagamento |
| 5 | **Configure o seu site para concluir** | ✓ | Informar o **domínio** e provisionar |

### A.1.2 Passo 2 — Plano

| Elemento | Tipo | Valor observado | Operação de backend implicada |
|---|---|---|---|
| Card do plano | header | `Nuvem Pro` (roxo) | Família de SKU selecionada no passo 1 |
| Texto guia | label | "Deslize para escolher a quantidade de **memória RAM** no seu plano." | — |
| **Slider de RAM** | slider discreto, 8 paradas | `512 MB · 1 GB · 2 GB · 4 GB · 8 GB · 16 GB · 24 GB · 32 GB` | Seleção de SKU; cada parada é um plano com preço próprio |
| Resumo de recursos | 3 chips ícone+valor | `1 GB RAM` · `2 GHz CPU` · `60 GB Disco` | **vCPU e disco são derivados da RAM** — não editáveis |
| Selo 1 | bullet ✓ | "**Escalável:** Ajustes os recursos da hospedagem a qualquer momento." (erro de português no original) | Promete resize a quente |
| Selo 2 | bullet ✓ | "**Foco em desempenho:** Sem compartilhamento de CPU e memória RAM." | Alocação garantida (LVE/cgroup dedicado) |
| **Escolha a região do servidor** | 2 radio cards | 🇧🇷 **Brasil** — "Seu site até **5x mais rápido** para visitantes no Brasil." · 🇺🇸 **E.U.A.** — "Velocidade padrão para visitantes no Brasil, porém **mais barato**." (selecionado) | Escolha de datacenter → afeta binpacking, IP, latência e **preço** |
| Card RESUMO | painel | `Nuvem Pro 🇺🇸` · Hospedagem ~~44,90~~ **R$ 17,90/mês** | Preço de tabela riscado + preço com desconto de compromisso já aplicado |
| **Continuar** | CTA verde | — | Avança |

**Respostas diretas às perguntas do escopo:**

- **Dá para escolher vCPU/RAM/disco separadamente?** **Não.** Só **RAM**, e em 8 degraus discretos. vCPU (`2 GHz`) e disco (`60 GB`) são **consequência** do degrau escolhido. É um híbrido: nem plano fechado puro, nem sliders granulares.
- **Dá para escolher região/servidor?** **Região sim** (Brasil × E.U.A.), com preço diferente por região. **Servidor não** — o nó (`cluster-web02.br`) é atribuído pelo sistema e só aparece depois, no Resumo.
- **Dá para escolher linguagem e versão na criação?** **Não.** Em nenhum dos 5 passos aparece PHP, Node, versão, stack ou aplicativo. O ambiente nasce com um default (PHP) e o cliente troca depois em Configurações → PHP. **Isto é uma falha de produto relevante para o VelozPanel**, que tem PHP + Node como requisito nº 1.
- **O que é o passo "Recursos"?** **Add-ons pagos**, não recursos computacionais. Nome enganoso.
- **O que é o passo "Configuração"?** Um único campo: o **domínio**.

### A.1.3 Passo 3 — Recursos (add-ons)

Texto: "Adicione recursos extras para melhorar ainda mais a performance do seu projeto." Três cards com **checkbox desmarcado** (opt-in):

| Add-on | Descrição na tela | Preço | Recorrência | Operação implicada |
|---|---|---|---|---|
| **Acelerador de WordPress** | "Aumente a velocidade do seu site em até 57%." + link `Saiba mais ⧉` | R$ 15 | /mês | Ativa camada de cache (LSCache/Redis/Varnish) |
| **Backup Diário** | "Garanta muito mais segurança para os dados do seu site." | R$ 10 | /mês | Habilita job de snapshot diário + retenção |
| **Migração Prioritária** | "Iniciaremos a migração do seu site em uma fila exclusiva." | R$ 25 | **avulso** (sem `/mês`) | Prioridade na fila de migração — é venda de **posição na fila**, não de recurso |

Resumo lateral neste passo: `Nuvem Light 🇧🇷` · Hospedagem ~~35,00~~ **R$ 13,90/mês**.

**Bom copiar:** add-ons como checkbox no funil, com preço unitário explícito e mensal/avulso distinguidos.
**Ruim:** "Migração Prioritária" vende fura-fila — é sinal de fila lenta, não de valor. **Backup Diário pago e desmarcado por padrão** contradiz o discurso de segurança (já criticado em §1.12 do lote 1) e agora sabemos que **restaurar também custa R$ 25** (§A.2.2). O cliente paga para se proteger e paga de novo para se salvar.
**Melhorar:** no VelozPanel, backup de 7 dias é incluso; add-ons são retenção estendida, off-site, IP dedicado, disco extra e RAM extra — coisas com custo marginal real.

### A.1.4 Passo 4 — Checkout (o achado central)

Cinco opções de compromisso, **radio única**, ordenadas do maior para o menor desconto, com a mais cara **pré-selecionada** e marcada com faixa roxa `MAIOR DESCONTO`:

| Opção | Selo | Preço/mês | Preço cheio | Renovação aproximada | Tarifa horária equivalente |
|---|---|---|---|---|---|
| **36 meses** ✓ selecionado | `60% OFF` + faixa `MAIOR DESCONTO` | **R$ 13,90** | ~~R$ 35,00~~ | 04/08/2029 | R$ 0,019306/h |
| 24 meses | `54% OFF` | R$ 15,90 | ~~R$ 35,00~~ | 09/08/2028 | R$ 0,022083/h |
| 12 meses | `48% OFF` | R$ 17,90 | ~~R$ 35,00~~ | 15/08/2027 | R$ 0,024861/h |
| 6 meses | `40% OFF` | R$ 21,00 | ~~R$ 35,00~~ | 16/02/2027 | R$ 0,029167/h |
| 1 mês | `SEM DESCONTO` (cinza) | R$ 35,00 | — | 19/09/2026 | R$ 0,048611/h |

Card RESUMO: `Nuvem Light 🇧🇷` · Hospedagem ~~35,00~~ R$ 13,90/mês · **Subtotal** ~~R$ 1.260,00~~ · **Desconto** − R$ 759,60 · **Total R$ 500,40** · CTA verde **Garantir esta oferta** · link cinza discreto **Pular esta etapa**.

**Aritmética conferida (e o que ela prova):**

| Verificação | Conta | Conclusão |
|---|---|---|
| Subtotal | 36 × R$ 35,00 = R$ 1.260,00 | ✓ |
| Total | 36 × R$ 13,90 = R$ 500,40 | ✓ |
| Desconto | 1.260,00 − 500,40 = R$ 759,60 | ✓ (60,3% ≈ "60% OFF") |
| Tarifa cheia | 35,00 ÷ 720 = R$ 0,04861/h | ✓ bate com o `R$ 0,0486/hora` da tela de Resumo (lote 1, §1.3) |
| **Datas** | data-base 20/08/2026 · 1 mês → 19/09/2026 (**+30 d**) · 6 m → 16/02/2027 (**+180 d**) · 12 m → 15/08/2027 (**+360 d**) · 24 m → 09/08/2028 (**+720 d**) · 36 m → 04/08/2029 (**+1080 d**) | **Mês = 30 dias = 720 h, sempre.** Não é calendário. |

> **Achado.** As cinco datas são exatamente `hoje + N × 30 dias`. Um compromisso de calendário daria 20/08/2029 para 36 meses; dá 04/08/2029. Portanto o Hostoo **não vende assinatura — vende um bloco de 720·N horas com tarifa travada**, e o rótulo "Renovação **aproximada**" existe porque a data real depende de quanto o cliente consumir. Toda a análise de §A.3 parte daí.

**Bom copiar:** subtotal / desconto / total explícito (transparência real); data de renovação por opção; "Pular esta etapa" existir.
**Ruim:** a opção de 36 meses vem **pré-selecionada** — o cliente que clica "Continuar" no automático compromete R$ 500,40 e 3 anos. Isso é *default nudging* na borda do abusivo. O link "Pular esta etapa" é cinza, sem borda, fora da hierarquia — desenhado para não ser visto. E **não há nenhuma menção, em lugar nenhum da tela, a política de cancelamento, reembolso ou ao que acontece com o saldo residual**.
**Melhorar (VelozPanel):** default = **1 mês**; compromisso é opt-in explícito; ao lado de cada opção, a frase "cancelando no mês X você recebe R$ Y de volta como crédito" calculada ao vivo; e o desconto máximo em 12 meses (ver §A.3.6).

### A.1.5 Passo 5 — Configuração

| Elemento | Tipo | Detalhe |
|---|---|---|
| Título | h1 | "Configure o seu site para concluir" |
| Seção **Domínio** | label + `?` tooltip | "Para concluir a criação do seu site, escolha o domínio que será utilizado." |
| Campo | input texto | placeholder `Exemplo: suaempresa.com ou seunome.com.br` |
| **Verificar** | botão roxo | Checagem de disponibilidade/propriedade → provisiona o ambiente |

Tela com **um único campo**. Não há: escolha de runtime, versão, app inicial, criação de usuário admin, escolha de subdomínio temporário, nem opção "ainda não tenho domínio".

**Ruim:** o cliente que ainda não tem domínio trava aqui. Um funil de 5 passos que termina exigindo um domínio registrado é um funil que perde conversão no último metro.
**Melhorar (VelozPanel):** o passo final deve aceitar três caminhos — (a) já tenho domínio, (b) registrar agora, (c) **começar com subdomínio grátis** `meuapp.veloz.app` e apontar o domínio depois — e deve incluir **stack + versão + app inicial** (ver §A.4.4).

### A.1.6 Avaliação do funil como um todo

**Bom:** stepper claro e persistente; resumo lateral sempre visível com preço; preço riscado × preço final; add-ons opt-in com preço unitário; região com explicação em linguagem de benefício, não de técnica ("até 5x mais rápido para visitantes no Brasil").
**Ruim:** cinco passos para criar uma hospedagem é longo; dois deles (Recursos e Checkout) são **puramente comerciais** e nenhum é sobre a aplicação; a nomenclatura "Recursos" para add-ons é enganosa; o compromisso de 36 meses pré-selecionado; nenhuma escolha técnica em nenhum passo.
**Melhorar:** VelozPanel em **3 passos** — **1 Ambiente** (nome/domínio ou subdomínio grátis + stack + versão + app inicial) → **2 Tamanho** (degrau + região, com custo/h e custo/mês ao vivo) → **3 Confirmar** (resumo, add-ons, saldo atual, "seu saldo cobre N dias", compromisso como *opt-in* claramente secundário). Provisionamento assíncrono com tela de progresso e log, nunca spinner.

---

## A.2 Área financeira — as 4 abas (`/payment/*`)

Navegação por **abas horizontais no topo**: `Recarga | Histórico | Consumo | Demonstrativo`. Todas com o rodapé "Acesso Rápido" repetido (já criticado no lote 1).

### A.2.1 Aba **Recarga** (`/payment/recharge`)

| Bloco | Campos / elementos | Estado observado | Operação implicada |
|---|---|---|---|
| Texto de topo | "**Ative a recarga automática** e garanta que suas hospedagens **nunca sejam suspensas**. O **consumo mensal** indicado abaixo representa quanto suas hospedagens consomem em créditos de sua conta no período de 30 dias." | — | Educação + medo (suspensão) |
| **Consumo mensal** | input `R$` + valor | `35,00` (editável) | Valor da recarga automática, pré-preenchido com o run-rate |
| Aviso azul | "Será realizada uma recarga automática no seu cartão sempre que faltar **7 dias ou menos** para o término dos seus créditos." | — | Gatilho: *runway* < 7 dias (não é saldo < X) |
| Aviso verde | "Esta é a forma de pagamento **mais recomendada**... Se mesmo assim ainda deseja realizar uma recarga manual, **clique aqui**." | — | Desincentivo à recarga manual |
| **Dados do cartão de crédito** | Número do cartão · Nome impresso · Validade (`00/00`) · Código de segurança | vazios | Tokenização no gateway |
| **Dados do cliente** | CPF/CNPJ · Nome completo/Razão social · E-mail · Telefone | vazios | KYC mínimo + emissão fiscal |
| **Endereço de cobrança** | CEP · Endereço · Número · Complemento · Bairro · Cidade · Estado (select) | vazios | AVS/antifraude + NF |
| Consentimento | checkbox "Li e concordo com os **Termos** e **Política de Privacidade**" | desmarcado | LGPD |
| **Ativar recarga automática** | CTA verde full-width | — | Cria mandato de cobrança recorrente |
| Link inferior | "Realizar apenas uma recarga manual ⧉" (cinza, ícone de link externo) | — | Sai do fluxo — **provável tela/checkout externo** |

**Meios de pagamento observados:** **cartão de crédito é o único meio presente nesta tela.** Pix **não aparece em nenhum campo** — mas o histórico (§A.2.2) mostra que **15 de 15 recargas reais do cliente foram via Pix**. Ou seja: o Pix existe, só que escondido atrás de dois links cinzas ("clique aqui" / "Realizar apenas uma recarga manual ⧉") e provavelmente num checkout externo. Não há boleto, débito automático, carteira digital nem parcelamento visíveis.

**Ruim (crítico de produto):** o produto empurra o meio de pagamento que o cliente **não usa** e esconde o que ele **sempre usa**. Além disso, pede endereço completo + CPF **antes** de qualquer recarga — 12 campos para colocar R$ 20 na conta. E não há: valores sugeridos, mínimo/máximo, previsão de quantos dias a recarga compra, nem gestão de cartões salvos.
**Melhorar (VelozPanel):** ver §A.2.5.

### A.2.2 Aba **Histórico** (`/payment/history`)

Título **Histórico de Recargas**. Busca. Tabela `Data | Descrição | Valor | Status` + ícone de documento (recibo/NF) por linha.

| Data | Descrição | Valor | Status |
|---|---|---|---|
| 13/08/2026 | Pix | R$ 20,00 | Pago |
| 27/07/2026 | Pix | R$ 150,00 | Pago |
| 30/06/2026 | Pix | R$ 50,00 | Pago |
| 30/03/2026 | Pix | R$ 100,00 | Pago |
| 13/02/2026 | Pix | R$ 50,00 | Pago |
| 30/06/2025 | Pix | R$ 70,00 | Pago |
| 18/02/2025 | Pix | R$ 100,00 | Pago |
| **01/10/2024** | **Restauração de hospedagem** | **R$ −25,00** (vermelho) | Pago |
| 01/10/2024 | Pix | R$ 100,00 | Pago |
| 22/03/2024 · 18/01/2024 | Pix | R$ 50,00 · R$ 50,00 | Pago |
| 30/08/2023 · 02/08/2023 · 11/04/2023 | Pix | R$ 100,00 · R$ 70,00 · R$ 50,00 | Pago |
| 21/07/2021 | Pix | R$ 10,00 | Pago |

**Três achados:**
1. **100% Pix** em 5 anos de histórico. Confirma que Pix é obrigatório no mercado brasileiro e que a tela de Recarga está desalinhada da realidade.
2. **A linha negativa `Restauração de hospedagem R$ −25,00`** prova que a tabela não é "histórico de recargas" — é um **razão de transações da conta**, misturando entrada (recarga) e saída avulsa (serviço cobrado). E prova que **o Hostoo cobra R$ 25 para restaurar um backup**. Cobrar pelo socorro de um cliente que já paga add-on de backup é a pior monetização possível: transforma um momento de crise em um momento de fricção comercial.
3. **O consumo horário não aparece aqui.** O débito diário/horário do plano não gera linha nenhuma nesta tabela. O cliente não consegue reconstruir seu saldo a partir desta tela — só vê entradas e uma saída avulsa. **Isso é uma falha grave de auditabilidade financeira**, e é exatamente o que um modelo por hora precisa ter.

**Ruim:** sem coluna de saldo acumulado; sem filtro por período/tipo; sem paginação visível; sem exportação; o ícone de documento não é rotulado (recibo? NF? comprovante Pix?); status só `Pago` (nenhum estado de pendente/expirado/estornado é exercitado).

### A.2.3 Aba **Consumo** (`/payment/billing`)

Título **Consumo de Créditos**. Busca + select de período (`Mês atual`) + botão **Buscar**.

| Domínio | Consumo |
|---|---|
| geestao.top | R$ 15,53 |
| oliveirafacil.com | R$ 22,29 |
| **Total consumido no mês** | **R$ 37,82** |

É a única tela do painel que mostra **dinheiro realmente gasto**. Valores quebrados (15,53 / 22,29) confirmam débito proporcional a tempo. Mas: sem horas, sem tarifa, sem recurso, sem dia, sem pausa, sem projeção.

### A.2.4 Aba **Demonstrativo** (`/payment/cost`)

Título **Demonstrativo de Custo**. Busca. Tabela de **duas colunas e uma linha**:

| Domínio | Custo |
|---|---|
| oliveirafacil.com (link) | R$ 35,00 |
| **Custo total** | **R$ 35,00** |

**Leitura correta desta tela** (comparando com Consumo): o Demonstrativo **não é o extrato** — é o **run-rate**: quanto os serviços ativos custam por mês a preço de tabela. Prova: mostra R$ 35,00 exatos (preço de tabela do Nuvem Light) e lista **apenas 1 domínio**, enquanto Consumo lista 2. Ou seja, `geestao.top` consome mas não entra no demonstrativo — provável ambiente sob compromisso já pago, cortesia ou outro produto.

**Isso é o problema, não a solução:** o painel tem uma aba chamada "Demonstrativo" que não demonstra nada, uma aba "Consumo" que não detalha o consumo, e as duas divergem entre si sem explicar por quê. Um cliente que vê `Consumo R$ 37,82` e `Demonstrativo R$ 35,00` na mesma sessão não tem como conciliar.

### A.2.5 Comparação das 4 abas e o que falta

| Dimensão | Recarga | Histórico | Consumo | Demonstrativo |
|---|:--:|:--:|:--:|:--:|
| Entradas de dinheiro (recargas) | — | ✓ | — | — |
| Saídas avulsas (serviços) | — | ✓ (1 caso) | — | — |
| **Débito horário do plano** | — | ✗ | agregado/mês | ✗ |
| **Horas ativo × pausado** | ✗ | ✗ | ✗ | ✗ |
| **Tarifa aplicada (R$/h)** | ✗ | ✗ | ✗ | ✗ |
| **Detalhe por recurso (vCPU/RAM/disco/add-on)** | ✗ | ✗ | ✗ | ✗ |
| **Saldo acumulado por linha** | ✗ | ✗ | ✗ | ✗ |
| **Projeção de fim de ciclo** | parcial (campo "consumo mensal") | ✗ | ✗ | run-rate estático |
| **Runway (dias de saldo)** | citado no texto ("7 dias") | ✗ | ✗ | ✗ |
| **Comparação com ciclo anterior** | ✗ | ✗ | ✗ | ✗ |
| **Economia gerada por pausas** | ✗ | ✗ | ✗ | ✗ |
| Filtro de período | ✗ | ✗ | ✓ (select) | ✗ |
| Exportação CSV/PDF | ✗ | ✗ | ✗ | ✗ |
| Nota fiscal de serviço | ✗ | ícone não rotulado | ✗ | ✗ |
| Recarga automática | ✓ (só cartão) | ✗ | ✗ | ✗ |
| **Pix** | ✗ (escondido) | evidente nos dados | — | — |
| Regra de saldo zerado / suspensão | só a ameaça, sem regra | ✗ | ✗ | ✗ |

**Diagnóstico:** o Hostoo tem 4 abas e **zero** delas responde a pergunta que o modelo por hora cria — *"por que gastei isso?"*. Em cobrança mensal fixa isso é tolerável; em cobrança por hora é o produto inteiro. **Aqui está o maior espaço competitivo do VelozPanel.**

### A.2.6 Especificação VelozPanel — área `/financeiro`

Reorganizada em **5 abas**: `Visão geral · Extrato · Consumo · Recarga · Documentos`.

#### (1) `Visão geral` — a tela que o Hostoo não tem

Faixa de topo com 5 números grandes:
`Saldo R$ 147,96` · `Gasto do ciclo R$ 37,82` · `Tarifa atual R$ 0,0972/h` · `Projeção do ciclo R$ 71,40` · `Saldo dura até 14/09 (25 dias)`

Abaixo:
- **Gráfico de barras diárias** dos últimos 30 dias, empilhado por ambiente, com linha de projeção pontilhada até o fim do ciclo.
- **Comparação com o ciclo anterior**: `R$ 37,82 este ciclo · R$ 44,10 no anterior · −14,2% ▼` com explicação automática ("você pausou `geestao.top` por 63 h").
- **Card "Economia por pausas"**: `Você economizou R$ 18,40 este mês mantendo ambientes pausados por 214 h.` — barra ativo/pausado por ambiente. **Este card é a peça central de marketing do modelo por hora**: transforma "cobrança variável" (percebida como risco) em "controle de gasto" (percebido como vantagem).
- **Alerta de saldo** com estados e cores, sempre com a regra escrita (ver quadro abaixo).

#### (2) `Extrato` — razão contábil completo (substitui "Histórico")

Uma linha por lançamento, **inclusive os débitos horários**, agregados por dia e expansíveis por hora:

| Data/hora | Tipo | Ambiente | Descrição | Qtd | Tarifa | Valor | **Saldo após** |
|---|---|---|---|---|---|---|---|
| 19/08 23:59 | Consumo | oliveirafacil.com | Ativo · 1 vCPU · 1 GB · 20 GB | 24 h | R$ 0,0693/h | − R$ 1,66 | R$ 147,96 |
| 19/08 23:59 | Consumo | geestao.top | **Pausado** · disco 20 GB | 24 h | R$ 0,0069/h | − R$ 0,17 | R$ 149,62 |
| 19/08 23:59 | Add-on | oliveirafacil.com | Backup estendido 30 d | 24 h | R$ 0,0139/h | − R$ 0,33 | R$ 149,79 |
| 13/08 10:12 | Recarga | — | Pix · e2e `E1234...` | — | — | + R$ 20,00 | R$ 150,12 |
| 01/08 00:00 | Bônus | — | Indicação `joao@…` | — | — | + R$ 20,00 | R$ 130,12 |

Requisitos: filtro por tipo/ambiente/período; busca; **exportar CSV e PDF**; toda linha de recarga com link para o comprovante e para a NFS-e; toda linha de consumo com link para o detalhe horário. Saldo após cada lançamento é **obrigatório** — é o que torna a conta auditável.

#### (3) `Consumo` — detalhamento por ambiente × recurso × horas × tarifa

Seletor de período (ciclo atual / anterior / intervalo). Uma seção por ambiente:

```
oliveirafacil.com                                    R$ 22,29   ▾
├ Plano Veloz Light · ativo              412 h × R$ 0,0693/h  = R$ 28,55
├ Plano Veloz Light · pausado            308 h × R$ 0,0069/h  = R$  2,13
├ Add-on Backup 30 d                     720 h × R$ 0,0139/h  = R$ 10,01
├ Disco extra (+20 GB)                   720 h × R$ 0,0069/h  = R$  4,97
├ Tráfego excedente                       —                    = R$  0,00
└ Crédito de compromisso 12 m (−48%)                          = − R$ 23,37
                                                 Subtotal ambiente  R$ 22,29
```

Mais: gráfico de barras horas ativo/pausado por dia; marcador dos eventos de resize sobre a linha do tempo (mostrando a mudança de tarifa no ponto exato); e botão **"O que mudou?"** comparando com o ciclo anterior linha a linha.

#### (4) `Recarga`

- **Pix em primeiro lugar**, com QR + copia-e-cola, expiração visível e confirmação em tempo real (webhook do PSP) — o saldo deve aparecer em segundos, não em minutos.
- Valores sugeridos calculados a partir do run-rate: `R$ 50 (≈17 dias)` · `R$ 100 (≈34 dias)` · `R$ 200 (≈68 dias)` · outro valor. **Sempre mostrar quantos dias a recarga compra** — é a única unidade que importa num modelo por hora.
- **Cartão de crédito** (tokenizado) como segunda opção, e **boleto** apenas para PJ acima de um valor (compensação D+1/D+3 é incompatível com suspensão por saldo).
- **Recarga automática**: opt-in, gatilho por *runway* (`recarregar R$ X quando faltarem N dias`) **ou** por piso de saldo; suportar **Pix automático** (mandato Pix Automático do BC, disponível desde 2025) além de cartão — porque o cliente brasileiro deste segmento paga por Pix.
- **Cartões e mandatos salvos**: listar, definir padrão, remover, ver últimas cobranças. Dados de endereço/CPF pedidos **só quando necessários para NF**, não no primeiro Pix de R$ 20.

#### (5) `Documentos`
NFS-e por competência (download PDF + XML), comprovantes de recarga, contratos de compromisso ativos com termos e cláusula de cancelamento, e histórico de reembolsos.

#### Regra de saldo zerado — escrita na UI, não só nos termos

| Estado | Gatilho | O que acontece | Sinal na UI |
|---|---|---|---|
| Normal | runway > 7 d | — | chip verde |
| **Atenção** | runway ≤ 7 d | e-mail + notificação; oferta de recarga | chip âmbar `Saldo acaba em 5 dias` |
| **Crítico** | runway ≤ 24 h | e-mail + notificação + banner fixo | chip vermelho |
| **Carência (grace)** | saldo ≤ 0 | ambientes seguem **no ar por 72 h**, com saldo negativo registrado no extrato | banner vermelho + contagem regressiva |
| **Suspenso** | 72 h após zerar | ambientes pausados automaticamente; dados **intactos**; cobrança cai para a tarifa de disco pausado | chip `Suspenso por saldo` + botão recarregar |
| **Retenção** | 30 d suspenso | aviso de exclusão em 3 marcos (D−15, D−7, D−1); backup final disponível para download | banner + e-mails |
| **Exclusão** | 45 d suspenso | destruição do ambiente após backup final retido por mais 15 d | irreversível, exige confirmação nenhuma — é automático e avisado |

Essa tabela precisa aparecer **literalmente** numa página `/financeiro/regras` linkada de todo alerta de saldo. Nenhum cliente deve descobrir a regra perdendo dados.

---

## A.3 Modelo comercial híbrido — análise e posição

### A.3.1 O modelo do Hostoo, completo

```
                    ┌─────────────────────────────────────────┐
  PREÇO DE TABELA   │  Plano × Região × Tamanho (RAM)         │
     (mensal)       │  Nuvem Light 512MB/1GHz/15GB = R$ 35,00 │
                    └──────────────────┬──────────────────────┘
                                       │  ÷ 720 h  (mês = 30 dias, sempre)
                                       ▼
                    ┌─────────────────────────────────────────┐
   TARIFA HORÁRIA   │        R$ 0,048611 / hora               │
                    └──────────────────┬──────────────────────┘
                                       │  débito horário
                                       ▼
                    ┌─────────────────────────────────────────┐
  SALDO PRÉ-PAGO    │  Créditos em BRL, alimentado por Pix    │
   (em créditos)    │  (recarga manual) ou cartão (auto)      │
                    └──────────────────┬──────────────────────┘
                                       │
                       ┌───────────────┴────────────────┐
                       ▼                                ▼
        ┌──────────────────────────┐    ┌────────────────────────────────┐
        │  SEM COMPROMISSO         │    │  COM COMPROMISSO (opt-in)      │
        │  tarifa cheia            │    │  bloco de 720·N horas pré-pago │
        │  R$ 0,0486/h             │    │  tarifa travada até −60%       │
        │  saldo dura o que durar  │    │  R$ 0,0193/h por 25.920 h      │
        └──────────────────────────┘    └────────────────────────────────┘
                       │                                │
                       └───────────────┬────────────────┘
                                       ▼
                    ┌─────────────────────────────────────────┐
      ADD-ONS       │  Acelerador WP R$15/m · Backup R$10/m   │
                    │  Migração prioritária R$25 (avulso)     │
                    │  Restauração R$25 (avulso, punitivo)    │
                    └─────────────────────────────────────────┘
```

Três camadas de receita, portanto: **run-rate horário** (recorrente variável), **compromisso pré-pago** (caixa antecipado + retenção), **add-ons e avulsos** (margem alta).

### A.3.2 O que acontece com o débito horário durante um compromisso ativo?

**Evidência:** o card RESUMO exibe `Nuvem Light 🇧🇷 · Hospedagem ~~35,00~~ R$ 13,90/mês` — o preço **exibido do plano muda**, não some. A tela de Resumo do ambiente (lote 1, §1.3) exibe `Preço: R$ 35,00 | R$ 0,0486/hora`, ou seja, preço mensal **e** horário lado a lado, sempre. E a aba Demonstrativo lista `oliveirafacil.com R$ 35,00` mas a aba Consumo lista **dois** domínios, sendo que `geestao.top` **não aparece** no Demonstrativo.

**As três hipóteses possíveis, avaliadas:**

| Hipótese | Mecânica | Compatível com as evidências? |
|---|---|---|
| **(A) Crédito reservado / bloco de horas** | O pagamento vira um saldo dedicado ao ambiente; o débito horário continua, mas à tarifa travada, consumindo esse bloco antes do saldo geral | **Sim — é a mais compatível.** Explica "Renovação **aproximada**", explica meses de 30 dias, explica `geestao.top` consumir (Consumo) sem custo de tabela (Demonstrativo) |
| **(B) Tarifa zerada durante o período** | Nada é debitado; ao fim do prazo volta a debitar | Explicaria `geestao.top` fora do Demonstrativo, mas **não explica** "renovação aproximada" (com tarifa zerada a data seria exata) nem o consumo de R$ 15,53 do `geestao.top` na aba Consumo |
| **(C) Desconto percentual sobre a tarifa, cobrado do saldo geral** | Débito segue, a R$ 0,0193/h, do saldo comum; o pagamento upfront é só uma recarga rotulada | Compatível com os números, mas **não explica** por que o compromisso é vendido com valor total fechado (R$ 500,40) e data de término |

**Posição para o VelozPanel:** adotar **(A) explicitamente e documentar**. O compromisso compra **N × 720 horas do plano X na região Y à tarifa travada T**, materializado como um *bucket* de horas vinculado ao ambiente, consumido antes do saldo geral. Isso torna todas as perguntas seguintes respondíveis por uma única regra, em vez de por casos especiais.

### A.3.3 E se o cliente pausar durante um compromisso pago?

**Inferência a partir do Hostoo:** como o compromisso é um bloco de horas e o rótulo diz "Renovação **aproximada**", pausar deveria **não consumir horas do bloco** e portanto **empurrar a data de renovação para frente** — o cliente "ganha" tempo. Mas o Hostoo **não afirma isso em lugar nenhum**, e o texto "Renovação aproximada em 04/08/2029" já é a data de 1080 dias corridos, o que sugere que na prática o cálculo é feito em **calendário**, não em consumo. **Há contradição interna e o cliente não tem como saber.**

**Posição VelozPanel — regra única, escrita no contrato e na UI:**

> **O compromisso compra horas, não dias.** Enquanto o ambiente está pausado, o bloco de horas **não é consumido** (só a tarifa de disco pausado, debitada do saldo geral). A data de término é recalculada continuamente e sempre exibida como *"termina em ~DD/MM, no ritmo atual"*.

Trade-off: isso é mais generoso e cria receita diferida mais longa; em compensação é a **única** regra coerente com "cobrança por hora" e com o botão de pausar como argumento de venda. A alternativa (calendário) transforma o compromisso num contrato mensal disfarçado e destrói o discurso do produto — o cliente que pausou 3 meses e não ganhou nada vira detrator.
**Mitigação:** teto de validade do bloco (ex.: horas do compromisso de 12 meses expiram em 18 meses corridos) — protege o balanço sem quebrar a promessa. Deve estar no contrato desde o dia 1.

### A.3.4 E no upgrade/downgrade de vCPU/RAM no meio de um compromisso?

O Hostoo promete "**Escalável:** Ajustes os recursos da hospedagem a qualquer momento" na tela de plano e tem botão "Alterar plano" no Resumo — mas **não diz nada** sobre o efeito no compromisso. Combinação obviamente instável: preço fixo por 36 meses + recurso mutável a qualquer momento.

**Posição VelozPanel — separar o que é travado do que é variável:**

> O compromisso **não trava o preço do plano. Trava um percentual de desconto** (`−48%` para 12 meses) aplicado à tarifa vigente do que o ambiente estiver rodando, e pré-paga um valor. O bloco de horas é convertido em **saldo dedicado em R$**, não em horas de um SKU específico.

| Cenário | Efeito | Exibição na UI |
|---|---|---|
| **Upgrade** (Light → Plus) | Tarifa com desconto sobe de R$ 0,0360/h para R$ 0,0649/h; o saldo dedicado passa a ser consumido mais rápido; a data de término **antecipa** | Antes de confirmar: "seu compromisso passa a terminar em ~14/03/2027 em vez de 15/08/2027. Quer estender por R$ X?" |
| **Downgrade** (Plus → Light) | Tarifa cai; data de término **estende** | "seu compromisso passa a durar até ~02/11/2027" |
| **Override do super admin** | idem upgrade/downgrade, mas com opção **"não cobrar"** (cortesia), que congela a tarifa antiga | Auditado + notificado ao cliente |

Regra dura: **o desconto do compromisso acompanha o ambiente, não o SKU.** Simples de implementar, simples de explicar, e — crucialmente — sobrevive ao requisito nº 9 do briefing.

### A.3.5 Saldo residual e cancelamento

O Hostoo **não diz nada** sobre isso em nenhuma das 11 telas. Não há política de reembolso, nem valor residual, nem menção a cancelamento no checkout de 36 meses. É a maior omissão do produto e o maior risco jurídico (CDC art. 51, cláusulas abusivas; art. 49 só cobre 7 dias de arrependimento).

**Posição VelozPanel — três buckets, três regras, escritas na tela de checkout:**

| Origem do saldo | Reembolsável em dinheiro? | Vira crédito? | Expira? |
|---|---|---|---|
| **Recarga avulsa** (Pix/cartão) não consumida | **Sim**, mediante solicitação, no mesmo meio, descontadas taxas do PSP | — | Não |
| **Compromisso** (saldo dedicado não consumido) | **Sim, com recomposição do desconto**: devolve-se `pago − (horas consumidas × tarifa cheia)`, nunca negativo. Dentro de 7 dias (CDC art. 49), devolução integral | Cliente pode optar por receber como crédito **sem** recomposição (100% do residual) — é o caminho que o produto deve destacar | Bloco expira em 1,5× o prazo contratado |
| **Bônus** (indicação, cupom, cortesia) | **Nunca** | É crédito por natureza | 12 meses |

Ao cancelar, a UI mostra a conta aberta: "você pagou R$ 500,40; consumiu 3.140 h; a preço cheio isso seria R$ 152,64; **reembolso em dinheiro R$ 347,76** ou **crédito de R$ 439,52** (você mantém o desconto)". A opção de crédito é maior e é a que o produto quer — mas o cliente vê as duas. Transparência aqui é retenção, não risco.

### A.3.6 Interação com o requisito nº 9 (super admin muda RAM/vCPU quando quiser)

Este é o ponto de colisão. Preço fixo por 36 meses + admin que redimensiona a quente + cobrança horária = três regras que se contradizem, a menos que o modelo de dados seja construído para isso desde o início. Consequências obrigatórias:

1. **O preço não pode viver no ambiente. Tem de viver numa tabela de preço unitário versionada.** `R$/vCPU-hora`, `R$/GB-RAM-hora`, `R$/GB-disco-mês`, `R$/GB-tráfego`. O "plano" é só um preset nomeado desses valores.
2. **Toda mudança de recurso fecha uma janela de cobrança e abre outra.** O lançamento de consumo tem `início`, `fim`, `forma` (vCPU/RAM/disco), `tarifa` e `origem` (cliente / admin / automático). Sem isso, nenhum extrato fecha.
3. **O desconto é um atributo do compromisso, não do preço.** (§A.3.4)
4. **O admin precisa de um interruptor "cobrar / não cobrar"** por alteração, com motivo obrigatório e auditoria — senão toda cortesia vira divergência de conciliação.
5. **A alteração precisa mostrar o impacto financeiro ao admin antes de aplicar** (a tela §6.4 do lote 1 já prevê isso; agora ela precisa também mostrar *"encurta o compromisso do cliente em 47 dias"*).
6. **O cliente precisa ser notificado** de toda alteração de recurso feita pelo admin que mude sua tarifa. Não notificar é o caminho mais curto para um Procon.

### A.3.7 Recomendação de modelo comercial do VelozPanel (escolha única)

> **Adotar o híbrido, mas invertendo a ênfase do Hostoo: o produto vendido é o consumo por hora; o compromisso é um acessório opcional e curto.**
>
> - **Padrão = pós-pago horário sobre saldo pré-pago**, sem compromisso, sem multa, sem fidelidade. É o diferencial e é o que casa com o botão de pausar.
> - **Compromisso opcional em 3 prazos apenas: 3, 6 e 12 meses**, com **15% / 25% / 35%** de desconto. Nada de 24 ou 36 meses.
> - **Compromisso é bloco de saldo dedicado com desconto travado**, consumido por hora, com data de término *aproximada e recalculada*.
> - **Cancelamento sempre possível**, com residual devolvido como crédito integral ou dinheiro com recomposição.

**Trade-off assumido:** 60% de desconto por 36 meses gera caixa imediato enorme e trava churn — é tentador para uma operação nova. Mas cria três problemas fatais para um time de 1–3 pessoas: (i) **passivo de serviço de 3 anos** com preço de energia, hardware e banda de 2026 congelado; (ii) impossibilidade prática de ajustar preço; (iii) responsabilidade de entregar disponibilidade por 36 meses numa operação de 2–3 servidores sem redundância comprovada. 12 meses a 35% já captura a maior parte do efeito de retenção com uma fração do risco. **Escolha: 12 meses, 35%, e nunca pré-selecionado.**

### A.3.8 Perguntas para o especialista de Billing

1. **Unidade de cobrança:** hora cheia, minuto ou segundo? O Hostoo usa hora (÷720). Recomendo **débito por hora, medido em minutos e arredondado para cima na hora** — mas isso precisa de decisão explícita, porque afeta o comportamento de quem pausa/inicia várias vezes ao dia.
2. **Mês contábil:** 720 h fixas (como o Hostoo) ou dias reais do mês? Se 720 h, um mês de 31 dias custa 3,3% a mais que o "preço mensal" anunciado — isso é passível de reclamação. Se dias reais, o preço/hora muda todo mês. **Qual?**
3. **Compromisso: bloco de horas, saldo dedicado em R$, ou percentual de desconto?** (§A.3.2 recomenda saldo dedicado em R$ + desconto travado — confirmar).
4. **Pausar durante compromisso estende o prazo?** Se sim, qual o teto de validade do bloco (1,5×? 2×?). Se não, como justificar isso ao lado de um botão "Pausar e economizar"?
5. **Ambiente pausado cobra quanto?** Proponho tarifa de disco (§A.4.5). É por GB provisionado ou por GB usado? E IP reservado, cobra?
6. **Upgrade no meio do compromisso: pró-rata imediato, ou só a partir do próximo ciclo?** E downgrade — permitido a quente? (disco não pode encolher a quente).
7. **Saldo residual em cancelamento: reembolso em dinheiro, crédito, ou perda?** Qual a política dentro e fora dos 7 dias do CDC art. 49? Quem absorve a taxa do PSP?
8. **Saldo negativo é permitido?** Durante a carência de 72 h o débito continua acumulando negativo (e será cobrado depois) ou congela?
9. **Ordem de consumo dos buckets:** bônus → compromisso → recarga, ou compromisso → recarga → bônus? Isso determina o que sobra em caso de cancelamento e precisa estar no contrato.
10. **Expiração de créditos:** bônus expira (12 m?); recarga expira? Recarga em dinheiro que expira é juridicamente frágil no Brasil.
11. **Cortesias do super admin** (recursos sem cobrar): viram crédito lançado no extrato do cliente ou lançamento fora do extrato? Como aparecem na conciliação e no DRE?
12. **Emissão fiscal:** NFS-e é emitida na **recarga** (venda de crédito) ou no **consumo** (prestação do serviço)? Isso muda ISS, competência e o regime tributário. É a pergunta com maior impacto contábil e precisa de contador, não de dev.
13. **Antifraude:** chargeback de cartão após o crédito já ter sido consumido — bloqueia conta, gera saldo negativo, ou prejuízo aceito? Qual o limite de exposição por conta nova?
14. **Pix Automático** (mandato recorrente do BC) entra no MVP ou só cartão para recarga automática? Dado que 100% das recargas reais observadas são Pix, isso pode ser decisivo.
15. **Preço por região:** o VelozPanel terá 1 região (Brasil) no dia 1. A tabela de preço já deve ser modelada com dimensão de região para não exigir migração depois?
16. **Add-ons cobrados por hora ou por mês?** Backup diário é R$ 10/mês no Hostoo — se o ambiente ficar pausado 20 dias, o backup continua sendo cobrado integralmente?
17. **Tráfego/banda:** entra na conta ou é ilimitado com política de uso justo? O Hostoo não cobra tráfego em nenhuma tela — é diferencial ou é bomba-relógio?

---

## A.4 Decisão de produto — planos fechados × recursos granulares

### A.4.1 O que o Hostoo escolheu

Um **híbrido em dois níveis**: família fixa (Nuvem Light / Nuvem Pro) × degrau discreto de RAM (8 paradas) com vCPU e disco **derivados**. Não é catálogo fechado (o slider dá sensação de controle) nem granular (o cliente não escolhe vCPU nem disco). Comercialmente esperto: o slider é um mecanismo de *upsell tátil* — o cliente arrasta, vê o preço subir, e o produto ganha a âncora.

### A.4.2 Trade-off

| | **Planos fechados** (catálogo de N SKUs) | **Granular** (3 sliders independentes) |
|---|---|---|
| Precificação | Trivial: N preços numa tabela | Precisa de preço unitário por recurso e por hora |
| Percepção do cliente | Simples, comparável, decidível em 10 s | Paralisia de escolha; ninguém sabe quanta RAM precisa |
| Resize a quente | Alvo conhecido; validação simples | Cada resize é um caso; risco de combinações inviáveis (8 vCPU + 512 MB) |
| **Capacity planning em 2–3 nós** | Binpacking com peças de tamanho conhecido — **tratável** | Binpacking com peças arbitrárias — problema aberto, com fragmentação real de RAM no nó |
| Cobrança por hora | 1 tarifa por SKU | Soma de 3 tarifas — na verdade **mais** correto e mais fácil de auditar |
| Requisito nº 9 (admin muda RAM/vCPU) | **Quebra**: o admin sai da grade e o ambiente vira órfão de plano | Atende naturalmente |
| Suporte | "qual plano você tem?" resolve | "quanto de RAM, CPU e disco você tem?" — três perguntas |
| Marketing / SEO / tabela de preços do site | Fácil (5 linhas numa página) | Difícil (calculadora) |

### A.4.3 Recomendação única

> **Degraus fechados na superfície, preço unitário por baixo.**
>
> 1. **O cliente escolhe entre 6 degraus nomeados** (§A.4.5) e, dentro do ambiente, pode **adicionar disco** separadamente (o único eixo que se descola naturalmente). Nada de 3 sliders.
> 2. **Por baixo, o motor de preço é 100% unitário**: `R$/vCPU-h`, `R$/GB-RAM-h`, `R$/GB-disco-mês`, `R$/add-on-h`. Cada degrau é apenas um *preset* nomeado desses valores, e seu preço é **calculado**, não digitado.
> 3. **O super admin escreve diretamente nos valores unitários** de qualquer ambiente. O resultado é um ambiente marcado como `Personalizado`, com tarifa recalculada automaticamente e visível para o cliente. Nenhum caso especial no código de cobrança.
> 4. **Sliders só aparecem no painel do super admin.** No painel do cliente, sliders são um convite a errar e a fragmentar o nó.

**Justificativa:** essa é a única arquitetura em que os três requisitos conflitantes coexistem sem gambiarra — o cliente tem simplicidade (requisito de conversão), o admin tem liberdade total (requisito nº 9), e a cobrança por hora (requisito nº 5) tem uma fonte de verdade única. O custo é uma tabela de preços unitários a mais no dia 1; o benefício é nunca precisar reescrever o billing quando o produto mudar. E, operacionalmente, degraus fixos são o que mantém o binpacking em 2–3 nós tratável por uma pessoa.

Uma consequência a assumir: **disco não encolhe a quente**. Downgrade de degrau só é permitido se o uso de disco couber no degrau menor; a UI deve dizer isso *antes* ("libere 4,2 GB para poder reduzir").

### A.4.4 Correção do funil

O funil VelozPanel tem **3 passos** e inclui o que o Hostoo omitiu:

| Passo | Conteúdo | Por quê |
|---|---|---|
| **1 · Ambiente** | Nome/domínio **ou subdomínio grátis** `x.veloz.app` · **Stack** (PHP / Node.js / Estático / *outros*) · **Versão** · **App inicial** opcional (WordPress, Laravel, Next.js, vazio) | Requisitos nº 1 e nº 7 do briefing, ausentes no Hostoo |
| **2 · Tamanho** | 6 degraus em cards · região (Brasil) · disco extra opcional · **custo/hora e custo/mês calculados ao vivo**, com "seu saldo cobre N dias" | O preço tem de ser tangível antes de confirmar (princípio 3 do lote 1) |
| **3 · Confirmar** | Resumo · add-ons opt-in · saldo atual · compromisso 3/6/12 m como **caixa secundária colapsada, nunca pré-marcada** · botão `Criar ambiente` | Conversão sem *dark pattern* |

Depois do clique: tela de progresso com as fases do job (`alocando nó → criando usuário → provisionando runtime → zona DNS → certificado → pronto`), log visível, e o ambiente já navegável em leitura.

### A.4.5 Tabela de planos inicial do VelozPanel

Premissas: 1 região (Brasil), 2–3 servidores dedicados; **mês contábil = 720 h**; tarifa horária = preço mensal ÷ 720; tarifa de ambiente **pausado** = apenas armazenamento a **R$ 0,25/GB/mês**.

| Plano | vCPU | RAM | Disco NVMe | **R$/mês** | **R$/hora (ativo)** | **R$/hora (pausado)** | Público |
|---|---:|---:|---:|---:|---:|---:|---|
| **Veloz Start** | 1 | 512 MB | 10 GB | 29,90 | 0,041528 | 0,003472 | site institucional, landing, teste |
| **Veloz Light** | 1 | 1 GB | 20 GB | 49,90 | 0,069306 | 0,006944 | WordPress pequeno, Laravel simples |
| **Veloz Plus** | 2 | 2 GB | 40 GB | 89,90 | 0,124861 | 0,013889 | WooCommerce, app Node em produção |
| **Veloz Pro** | 2 | 4 GB | 80 GB | 159,90 | 0,222083 | 0,027778 | e-commerce com tráfego, API |
| **Veloz Turbo** | 4 | 8 GB | 160 GB | 289,90 | 0,402639 | 0,055556 | agência com múltiplos sites, filas |
| **Veloz Max** | 6 | 16 GB | 320 GB | 529,90 | 0,735972 | 0,111111 | aplicação crítica, revenda |

**Add-ons (por hora, cobrados só enquanto ativos):**

| Add-on | Preço/mês | Preço/hora | Nota |
|---|---:|---:|---|
| Disco extra | R$ 0,25/GB | R$ 0,000347/GB | único eixo granular exposto ao cliente |
| RAM extra (degrau intermediário) | R$ 20,00/GB | R$ 0,027778/GB | só via suporte/admin no MVP |
| Backup retenção 30 dias | R$ 12,00 | R$ 0,016667 | **7 dias é incluso e gratuito** |
| Backup off-site (outro DC) | R$ 18,00 | R$ 0,025000 | v1 |
| IP dedicado | R$ 25,00 | R$ 0,034722 | v1 |
| **Restauração de backup** | **R$ 0,00** | — | **nunca cobrar** — contraposição direta ao Hostoo |
| Migração assistida | R$ 0,00 (1ª) | — | aquisição, não receita |

**Descontos por compromisso:** 3 meses **−15%** · 6 meses **−25%** · 12 meses **−35%**. Nenhum pré-selecionado.

**Sanidade de capacidade (por que estes degraus e não outros):** com 3 servidores de 128 GB RAM / 32 threads / 4 TB NVMe e *overcommit* de 1,5× em RAM e 4× em vCPU, cada nó comporta ~192 GB alocáveis. Com mix realista puxado para Light/Plus (média ~1,6 GB), são **~120 ambientes por nó**, ~360 no total — e o disco (4 TB ÷ ~30 GB médios ≈ 130 ambientes) é o limitante real, não a RAM. Isso valida a escada: o degrau **Max** (16 GB / 320 GB) é o teto sensato — acima disso um único cliente ocupa 8% do nó e a operação passa a precisar de servidor dedicado, que é outro produto. **Não oferecer degraus acima de 16 GB antes de ter 5+ nós.**

**Comparação com o Hostoo:** Nuvem Light 512 MB / 15 GB por R$ 35,00 × Veloz Start 512 MB / 10 GB por R$ 29,90. Ficamos mais baratos na entrada e mais caros no meio da escada (Light 1 GB/20 GB a R$ 49,90 contra ~R$ 44,90 do Nuvem Pro 1 GB), o que é aceitável porque entregamos **Node de primeira classe, backup incluso, restauração grátis e sem fidelidade** — atributos que o Hostoo não tem. O posicionamento não é "mais barato"; é "sem armadilha".

---

## A.5 Notificações, tickets e indicação

### A.5.1 Notificações (`/user/notifications`)

Página de **preferências**, não de caixa de entrada. Texto: "As notificações permitem que você seja avisado quando determinados eventos ou incidentes acontecerem em sua conta ou em suas hospedagens. Abaixo você pode habilitar ou desabilitar as notificações individualmente." Doze toggles em 3 grupos:

| Grupo | Evento | Estado | Operação implicada | VelozPanel |
|---|---|:--:|---|---|
| **Financeiro** | Faltar **5 dias** para acabar os créditos | ✅ on | Job diário calcula runway | **MVP** |
| | Faltar **3 dias** | ✅ on | idem | **MVP** |
| | Faltar **menos de 24 h** | ✅ on | idem | **MVP** |
| | Nova recarga realizada | ✅ on | Webhook do PSP | **MVP** |
| | Recarga negada ou cancelada | ✅ on | Webhook do PSP | **MVP** |
| **Hospedagens** | CPU > 80% por ≥ 10 min | ⬜ **off** | Regra sobre série temporal | **v1** |
| | RAM > 80% por ≥ 10 min | ⬜ **off** | idem | **v1** |
| | Menos de 2 GB de disco livre | ✅ on | Coleta de disco | **MVP** (limiar em % + absoluto) |
| | Perto de ser removida por tempo de suspensão | ✅ on | Estado do ciclo de vida | **MVP** |
| **Conta** | E-mail da conta alterado | ✅ on | Evento de IAM | **MVP** |
| | Senha alterada | ✅ on | Evento de IAM | **MVP** |
| | Acesso a partir de um novo IP | ✅ on | Fingerprint de sessão | **v1** |

**Bom copiar:** três limiares escalonados de saldo (5 d / 3 d / <24 h) é exatamente a granularidade certa para pré-pago; alertas de segurança de conta ligados por padrão.
**Ruim:** (a) **não há escolha de canal** — nem e-mail, nem in-app, nem WhatsApp, nem webhook; é tudo-ou-nada por evento; (b) **não há caixa de entrada**: o cliente não tem onde ver o que foi notificado, e uma notificação perdida é uma notificação inexistente; (c) alertas de CPU e RAM **desligados por padrão** — justamente os dois que evitam ticket; (d) **nenhum evento operacional**: backup falhou, cron falhou, deploy falhou, certificado renovado, ambiente pausado automaticamente, admin alterou recursos. Num painel que é 90% operação, isso é uma lacuna enorme; (e) limiar de disco fixo em 2 GB — sem sentido para um plano de 10 GB e para um de 320 GB ao mesmo tempo.

**Especificação VelozPanel — `/notificacoes`:** duas abas.
- **Caixa de entrada** (feed): evento, ambiente, severidade, horário, lida/não lida, link para o job/log correspondente, marcar todas como lidas, filtro por ambiente e severidade. Badge de não-lidas no header. Toda ação assíncrona do painel gera item aqui (princípio 4 do lote 1).
- **Preferências**: matriz **evento × canal** (in-app · e-mail · WhatsApp · webhook), não toggle único. Eventos adicionais obrigatórios: `deploy.falhou`, `deploy.concluido`, `cron.falhou`, `backup.falhou`, `ssl.renovado`, `ssl.falhou`, `ambiente.pausado_por_saldo`, `ambiente.recursos_alterados_pelo_admin`, `plataforma.manutencao_programada`, `plataforma.incidente`. Limiares configuráveis (percentual, não absoluto) e alertas de CPU/RAM **ligados por padrão**.

| Feature | VelozPanel |
|---|---|
| Preferências por evento | **MVP** |
| Caixa de entrada in-app com badge | **MVP** |
| Canal e-mail (transacional) | **MVP** |
| Eventos operacionais (deploy/cron/backup/SSL) | **MVP** |
| Matriz evento × canal | v1 |
| Canal WhatsApp | v1 |
| Webhook por conta (para agências) | v2 |
| Digest diário/semanal | v2 |
| Push mobile | não fazer |

### A.5.2 Tickets de suporte (`/support/tickets`)

| Elemento | Detalhe |
|---|---|
| Título | **Tickets de Suporte** |
| Busca | input `Buscar...` |
| CTA | **Abrir novo ticket** (verde, canto direito) |
| Tabela | `ID` (link, `128347`) · `Assunto` (link, `Composer`) · `Domínio` (vazio) · `Status` (`Fechado`) · `Atualizado em` (`há 9 meses`) · chevron ▾ |

Tela minimalista e correta no essencial: ticket vinculável a um **domínio/ambiente** (coluna existe), estado, tempo relativo. Falta: prioridade, SLA/tempo de resposta, categoria, anexos visíveis, contagem de mensagens não lidas, e — crítico — **nenhuma indicação de contexto técnico enviado junto**. Convive com 3 FABs (chat / `?` / suporte), ou seja, o Hostoo mantém 3 canais paralelos sem unificação.

**Construir × integrar — avaliação:**

| Opção | Custo inicial | Custo mensal | Custo de operação (1 dev) | WhatsApp | Dados no BR | Veredito |
|---|---|---|---|---|---|---|
| **Construir helpdesk próprio** | 3–6 semanas | R$ 0 | Alto e permanente (threading de e-mail, anexos, spam, SLA, notificações) | ✗ | ✓ | **Não fazer.** É um produto inteiro, não uma tela |
| **Chatwoot self-hosted** | 3–5 dias | ~R$ 0 (usa nosso servidor) | **Alto**: Rails + Sidekiq + Postgres + Redis + upgrades + backup | ✓ | ✓ | Ótimo destino, péssimo ponto de partida |
| **Chatwoot Cloud / Crisp** | 1 dia | US$ 25–95 | Baixo | ✓ | ✗ (dados fora) | **Melhor MVP** |
| **Zammad** | 1 semana | ~R$ 0 | Alto (Elasticsearch obrigatório) | parcial | ✓ | Descartar — pesado demais |
| **E-mail + Postmark/Resend** | 2 dias | US$ 15 | Muito baixo | ✗ | ✗ | Insuficiente sozinho: sem estado, sem fila, sem histórico no painel |

> **Recomendação:** **integrar, nunca construir.** No MVP, **Crisp** (ou Chatwoot Cloud) com widget **autenticado**, embutido no painel, e uma página `/suporte` que apenas **lista as conversas via API** — sem lógica de helpdesk do nosso lado. E-mail transacional separado, via **Postmark ou Resend**, com domínio e IP **distintos** do relay de saída dos clientes (proteger reputação — ver §3.5 do lote 1). Migrar para **Chatwoot self-hosted** apenas quando o volume passar de ~200 conversas/mês ou quando WhatsApp Business API se tornar requisito comercial.
>
> **O que realmente importa não é a ferramenta, é o contexto.** O widget deve enviar automaticamente: id da conta, ambiente ativo na tela, plano, região, nó, versões de runtime, saldo, runway, últimos 5 jobs e seus estados, e os últimos erros de log. Isso elimina as 3 primeiras mensagens de todo ticket ("qual domínio?", "qual plano?", "o que apareceu?") e é o que faz suporte de 1 pessoa funcionar.

| Feature | VelozPanel |
|---|---|
| Widget de chat autenticado com payload de contexto | **MVP** |
| Página `/suporte` listando conversas (via API) | **MVP** |
| Abrir conversa já vinculada a um ambiente | **MVP** |
| Base de conhecimento / help center | v1 |
| Ticket com anexo e log anexado em 1 clique | v1 |
| SLA e prioridade por plano | v2 |
| WhatsApp como canal | v1 |
| Helpdesk próprio | **não fazer** |

### A.5.3 Programa de indicações (`/referral`)

| Bloco | Elemento | Valor observado |
|---|---|---|
| Métricas | Convites restantes · Cadastros · Recargas | `3` · `0` · `0` |
| Regra 1 | "As indicações são limitadas a **3 convites**. Se desejar novos convites, entre em contato com o nosso suporte." | limite rígido, expansível só via suporte |
| Regra 2 | "O bônus é limitado a **R$ 20,00** por indicação. Se o seu indicado realizar uma primeira recarga superior a R$ 20,00, o excedente não contará como parte do bônus." | teto |
| Regra 3 | "Os bônus serão adicionados em sua conta **30 dias** após a recarga do seu indicado. Este prazo é necessário para **validação das transações** pelo nosso sistema." | carência antifraude explícita |
| Proposta | "receba em bônus na sua conta o valor da **primeira recarga** feita por cada indicado" | bônus = espelho da 1ª recarga, teto R$ 20 |
| Link | `https://hostoo.io/?ref=6c7d6fbab8a8dd0a8df42a5c16f1…` + botão **Copiar** | UUID por conta |
| Compartilhamento | Facebook · Twitter/X · LinkedIn · WhatsApp | deep links de share |
| Nota de rodapé | "* O bônus é limitado a R$ 20,00 por indicação." | reforço |

**Mecanismo de crédito, destrinchado:** indicado se cadastra pelo link → faz a **primeira** recarga → decorridos **30 dias** → indicador recebe `min(valor_da_recarga, R$ 20,00)` como **crédito** (bônus na conta, não dinheiro). Unilateral: **o indicado não ganha nada** — o que reduz a conversão do lado que mais importa. Teto total por conta: 3 × R$ 20 = **R$ 60**. É um programa desenhado para não custar caro, não para crescer.

**Riscos de fraude e mitigações:**

| Risco | Como acontece | Mitigação |
|---|---|---|
| **Auto-indicação** | Mesma pessoa cria contas com e-mails diferentes e recarrega R$ 20 em cada | Bloquear por CPF/CNPJ, cartão, chave Pix pagadora, IP, *device fingerprint* e domínio de e-mail descartável. **A chave Pix do pagador é o sinal mais forte no Brasil** |
| **Farming em escala** | Rede de contas descartáveis só para colher bônus | Limite de convites (o Hostoo usa 3); exigir que o indicado **consuma** X horas, não só recarregue; revisão manual acima de N indicações |
| **Arbitragem de bônus** | Bônus ≥ custo da recarga torna o ciclo lucrativo por si só | **Bônus deve ser < 100% da recarga.** O Hostoo espelha 100% até R$ 20 — matematicamente é `recarrego 20, ganho 20`. **Erro de desenho; não copiar** |
| **Lavagem / chargeback** | Recarga com cartão fraudado gera bônus; estorno vem depois | Carência de 30 d (o Hostoo faz certo); bônus só sobre pagamento **liquidado e fora da janela de contestação**; Pix reduz muito o risco |
| **Saque disfarçado** | Bônus vira crédito → cliente pede reembolso em dinheiro | **Bônus é intransferível, não reembolsável e não sacável**, e expira em 12 meses. Precisa estar no regulamento |
| **Spam do link** | Indicador polui fóruns/comentários com o link | Termos com cláusula de anti-spam e desqualificação |

**Recomendação VelozPanel:**

> Programa **bilateral e proporcional, com crédito atrelado a consumo**: o indicado ganha **R$ 25 de crédito de boas-vindas** ao criar o primeiro ambiente; o indicador ganha **R$ 25 de crédito quando o indicado consumir R$ 50** em serviço (não quando recarregar). Carência de **30 dias**, teto de **R$ 250/ano** por conta, sem limite artificial de convites (o limite é o consumo do indicado, que é autolimitante e alinhado a receita real).

Ganhar sobre **consumo** em vez de **recarga** elimina de uma vez a arbitragem, o farming e o chargeback — o fraudador teria de efetivamente rodar servidor por semanas para colher R$ 25.

| Feature | VelozPanel |
|---|---|
| Link de indicação + cópia + métricas | v1 |
| Crédito bilateral atrelado a consumo | v1 |
| Painel de indicados com estado (cadastrou / criou ambiente / consumiu / creditado) | v1 |
| Compartilhamento social (WhatsApp em primeiro lugar, no Brasil) | v1 |
| Controles antifraude (CPF, Pix pagador, device, IP) | v1 (junto, não depois) |
| Cupons de campanha (distintos de indicação) | v1 |
| Programa de afiliados com comissão recorrente em dinheiro | v2 |
| Gamificação / missões (o widget roxo do Hostoo) | **não fazer** |

---

## A.6 Mapa de navegação **global** do painel (nível conta/usuário)

Substitui e amplia o bloco `GLOBAL` de §2 do lote 1. A hospedagem continua tendo sua própria árvore (§2), aqui pendurada em `Hospedagens → {ambiente}`.

```
VELOZPANEL — CLIENTE
│
├── ⌂ Início  /                          visão da conta: ambientes, gasto do ciclo, alertas, jobs recentes
│
├── ▣ Hospedagens  /ambientes            lista (busca, filtro por estado/plano/nó) · [+ Criar]
│   ├── /ambientes/criar                 funil de 3 passos (§A.4.4)
│   └── /ambientes/{id}                  ► toda a árvore do lote 1 §2
│                                          (Resumo · Domínio · Arquivos · Banco · E-mail · Apps · Configurações)
│
├── ⊕ Domínios  /dominios                domínios da conta, independentes do ambiente
│   ├── Meus domínios                    registro, expiração, auto-renovação, ambiente vinculado
│   ├── Registrar / transferir           [futuro]
│   └── Zonas DNS                        zonas de domínios não vinculados a ambiente
│
├── ◈ Financeiro  /financeiro            (§A.2.6)
│   ├── Visão geral                      saldo · gasto do ciclo · tarifa · projeção · runway · economia por pausas
│   ├── Extrato                          razão completo com saldo após cada lançamento · CSV/PDF
│   ├── Consumo                          ambiente × recurso × horas × tarifa · comparativo de ciclos
│   ├── Recarga                          Pix (padrão) · cartão · recarga automática · mandatos salvos
│   ├── Compromissos                     blocos ativos, saldo restante, término aproximado, cancelar
│   └── Documentos                       NFS-e · comprovantes · contratos · reembolsos
│
├── ☂ Suporte  /suporte                  conversas (via helpdesk integrado) · abrir conversa com contexto
│   ├── Base de conhecimento             [v1]
│   └── Status da plataforma             /status — incidentes, manutenções, uptime do nó do cliente
│
├── ⇄ Indicações  /indicacoes            link · métricas · indicados e seus estágios · regulamento
│
├── ◔ Notificações  /notificacoes        Caixa de entrada (badge) · Preferências (matriz evento × canal)
│
└── ☺ Conta  /conta
    ├── Perfil                           nome, e-mail, telefone, avatar, idioma, fuso
    ├── Segurança                        senha, 2FA, sessões ativas, IPs recentes, chaves de API
    ├── Acessos                          usuários da conta, papéis, convites, permissões por ambiente
    ├── Dados fiscais                    CPF/CNPJ, razão social, endereço, e-mail de cobrança
    └── Privacidade (LGPD)               exportar meus dados · excluir conta · consentimentos
```

**Header global** (revisado a partir do lote 1): logo · busca global (`⌘K`, busca ambientes, domínios, bancos, tickets) · **chip de saldo com runway** (`R$ 147,96 · ~25 dias ▾`) · sino de notificações com badge · avatar → menu da conta. **Removidos** em relação ao Hostoo: widget de gamificação, botão "Indique e ganhe" no header (vira item de menu), os 3 FABs empilhados (viram 1) e o rodapé "Acesso Rápido".

---

## A.7 Novas linhas do inventário de features (lote 2)

Mesmo formato da §3 do lote 1. Complexidade = esforço para time de 1–3 devs.

### A.7.1 Funil de criação e planos

| Feature | Tela | Complexidade | Módulo sugerido | Prioridade |
|---|---|---|---|---|
| Funil de criação em 3 passos com preço ao vivo | `/ambientes/criar` | Média | `onboarding` | MVP |
| Escolha de stack + versão + app inicial na criação | Criar passo 1 | Média | `onboarding` | MVP |
| Subdomínio grátis `x.veloz.app` como alternativa a domínio | Criar passo 1 | Baixa | `onboarding` | MVP |
| Degraus de plano em cards com custo/h e custo/mês | Criar passo 2 | Baixa | `billing-catalog` | MVP |
| Escolha de região | Criar passo 2 | Baixa | `core-provision` | v1 (1 região no MVP) |
| Disco extra granular (add-on) | Criar passo 2 / Resumo | Média | `billing-catalog` | v1 |
| Add-ons opt-in no funil | Criar passo 3 | Baixa | `billing-catalog` | v1 |
| Compromisso com desconto (3/6/12 m), opt-in | Criar passo 3 | Alta | `billing-commitment` | v1 |
| "Seu saldo cobre N dias" antes de confirmar | Criar passo 3 | Baixa | `billing` | MVP |
| Tela de progresso do provisionamento com log de fases | pós-criação | Média | `core-provision` | MVP |

### A.7.2 Financeiro do cliente

| Feature | Tela | Complexidade | Módulo sugerido | Prioridade |
|---|---|---|---|---|
| Saldo com **runway** (dias restantes) no header | Global | Baixa | `billing` | MVP |
| Motor de débito horário por ambiente × recurso | — (backend) | Alta | `billing-metering` | MVP |
| Extrato completo com saldo após cada lançamento | `/financeiro/extrato` | Média | `billing` | MVP |
| Consumo detalhado ambiente × recurso × horas × tarifa | `/financeiro/consumo` | Alta | `billing` | MVP |
| Projeção de fim de ciclo | `/financeiro` | Média | `billing` | MVP |
| Comparação com o ciclo anterior | `/financeiro` | Média | `billing` | v1 |
| Card "Economia por pausas" | `/financeiro` | Média | `billing` | v1 |
| **Recarga via Pix (QR + copia-e-cola + webhook)** | `/financeiro/recarga` | Média | `billing-pix` | MVP |
| Recarga via cartão tokenizado | `/financeiro/recarga` | Média | `billing-card` | v1 |
| Recarga automática por runway (cartão) | `/financeiro/recarga` | Média | `billing-card` | v1 |
| **Pix Automático** (mandato recorrente) | `/financeiro/recarga` | Alta | `billing-pix` | v2 |
| Boleto (PJ, acima de valor) | `/financeiro/recarga` | Média | `billing` | v2 |
| Alertas de saldo (5 d / 3 d / 24 h) | `/notificacoes` | Baixa | `billing` + `notify` | MVP |
| **Grace period → suspensão → retenção → exclusão** | backend + `/financeiro/regras` | Alta | `billing-lifecycle` | MVP |
| Exportação CSV / PDF do extrato | `/financeiro/extrato` | Baixa | `billing` | v1 |
| **NFS-e (emissão + PDF/XML)** | `/financeiro/documentos` | Alta | `billing-fiscal` | v1 |
| Gestão de compromissos ativos + cancelamento com residual | `/financeiro/compromissos` | Alta | `billing-commitment` | v1 |
| Cupons resgatáveis pelo cliente | `/financeiro/recarga` | Média | `billing-coupon` | v2 |

### A.7.3 Conta, notificações, suporte, indicações

| Feature | Tela | Complexidade | Módulo sugerido | Prioridade |
|---|---|---|---|---|
| Caixa de entrada de notificações (feed + badge) | `/notificacoes` | Média | `notify` | MVP |
| Preferências de notificação por evento | `/notificacoes` | Baixa | `notify` | MVP |
| Eventos operacionais (deploy/cron/backup/SSL/resize) | `/notificacoes` | Média | `notify` | MVP |
| Matriz evento × canal (in-app/e-mail/WhatsApp/webhook) | `/notificacoes` | Média | `notify` | v1 |
| E-mail transacional (Postmark/Resend, domínio isolado) | — | Baixa | `notify-email` | MVP |
| Canal WhatsApp | — | Média | `notify-whatsapp` | v1 |
| Widget de suporte autenticado com payload de contexto | Global | Baixa | `support` | MVP |
| Página `/suporte` listando conversas via API | `/suporte` | Baixa | `support` | MVP |
| Base de conhecimento | `/suporte/ajuda` | Média | `support` | v1 |
| **Página pública de status da plataforma** | `/status` | Média | `status` | v1 |
| Helpdesk próprio | — | Alta | — | **não fazer** |
| Programa de indicação bilateral atrelado a consumo | `/indicacoes` | Média | `growth-referral` | v1 |
| Antifraude de indicação (CPF/Pix/device/IP) | backend | Média | `growth-referral` | v1 (junto) |
| Afiliados com comissão em dinheiro | — | Alta | `growth-affiliate` | v2 |
| Gamificação / missões | — | Média | — | **não fazer** |
| Dados fiscais da conta (CPF/CNPJ, endereço) | `/conta/fiscal` | Baixa | `iam` | MVP |
| 2FA + sessões ativas + IPs recentes | `/conta/seguranca` | Média | `iam` | v1 |
| Chaves de API da conta | `/conta/seguranca` | Média | `iam` | v2 |
| Exportar dados / excluir conta (LGPD) | `/conta/privacidade` | Média | `iam` | v1 |

---

## A.8 Novas entidades do modelo de informação

Complementa a §7 do lote 1. Convenção: **negrito** = entidade nova; `campo` = atributo principal.

| Entidade | Campos principais | Observações |
|---|---|---|
| **SaldoDeCrédito** | `conta_id`, `saldo_total`, `saldo_recarga`, `saldo_bonus`, `saldo_compromisso`, `runway_dias`, `atualizado_em` | **Três buckets separados**, não um número só — a ordem de consumo e as regras de reembolso diferem por bucket (§A.3.5). O "saldo" da UI é a soma |
| **Transação** | `id`, `conta_id`, `tipo` (recarga · consumo · bônus · estorno · ajuste · cobrança_avulsa · compromisso), `origem` (pix · cartão · boleto · sistema · admin · indicação), `valor` (± ), `bucket_afetado`, `saldo_apos`, `referencia_externa`, `criado_em`, `descricao` | **Razão imutável, append-only.** É a fonte de verdade do saldo — o saldo é derivado, nunca escrito diretamente |
| **Recarga** | `id`, `conta_id`, `metodo`, `valor`, `status` (pendente · pago · expirado · negado · estornado), `psp`, `psp_id`, `qr_code`, `copia_e_cola`, `expira_em`, `pago_em`, `nota_fiscal_id`, `transacao_id` | Uma recarga paga gera **uma** Transação. Idempotência por `psp_id` é obrigatória (webhook duplicado é regra, não exceção) |
| **LançamentoDeConsumo** *(refinado do lote 1)* | `id`, `ambiente_id`, `inicio`, `fim`, `estado` (ativo · pausado · suspenso), `forma` (vcpu · ram · disco · addon · trafego), `quantidade`, `unidade`, `tarifa_unitaria`, `desconto_pct`, `valor`, `origem_tarifa` (plano · override_admin), `transacao_id` | **Uma linha por recurso por janela**, não uma linha por ambiente. Toda mudança de recurso ou de estado **fecha** a janela e abre outra. É o que torna o extrato de §A.2.6(3) possível |
| **Pedido** | `id`, `conta_id`, `tipo` (criar_ambiente · alterar_plano · addon · compromisso), `itens[]`, `subtotal`, `desconto`, `total`, `cupom_id`, `status` (rascunho · aguardando_pagamento · pago · provisionando · concluido · cancelado · falhou), `ambiente_id`, `job_id`, `criado_em` | Materializa o funil de criação. Um Pedido pode gerar Transação (débito de saldo), Recarga (se saldo insuficiente), Compromisso e Job de provisionamento |
| **ItemDePedido** | `pedido_id`, `tipo` (plano · addon · disco_extra · compromisso), `sku`, `quantidade`, `preco_unitario`, `desconto`, `total`, `recorrencia` (hora · mes · avulso) | — |
| **Compromisso** | `id`, `conta_id`, `ambiente_id`, `prazo_meses`, `desconto_pct`, `valor_pago`, `saldo_dedicado_restante`, `horas_contratadas`, `horas_consumidas`, `inicio`, `termino_aproximado`, `expira_em` (teto absoluto), `status` (ativo · esgotado · cancelado · expirado), `politica_cancelamento_versao` | **Saldo dedicado em R$ + desconto travado**, não SKU travado (§A.3.4). `termino_aproximado` é **recalculado** a cada mudança de tarifa ou de estado |
| **Plano** *(refinado)* | `id`, `nome`, `familia`, `vcpu`, `ram_mb`, `disco_gb`, `regiao`, `preco_mes`, `preco_hora` (**derivado**), `preco_hora_pausado`, `ativo`, `visivel_no_catalogo`, `ordem` | Preço **calculado** a partir de `TabelaDePreçoUnitário`, nunca digitado (§A.4.3) |
| **TabelaDePreçoUnitário** | `id`, `regiao`, `vigente_de`, `vigente_ate`, `preco_vcpu_hora`, `preco_gb_ram_hora`, `preco_gb_disco_mes`, `preco_gb_disco_pausado_mes`, `preco_gb_trafego` | **Versionada por data de vigência.** Ambientes existentes ficam presos à versão vigente na contratação (*grandfathering*) até migração explícita |
| **AddOn** | `id`, `nome`, `descricao`, `preco_mes`, `preco_hora`, `recorrencia`, `escopo` (ambiente · conta), `modulo_requerido` | Backup estendido, off-site, IP dedicado, disco extra, acelerador |
| **AssinaturaDeAddOn** | `ambiente_id`, `addon_id`, `ativo_desde`, `ativo_ate`, `status` | Gera LançamentoDeConsumo próprio |
| **Cupom** | `codigo`, `tipo` (percentual · valor_fixo · credito_bonus · meses_gratis), `valor`, `aplicavel_a` (plano · addon · compromisso · recarga), `uso_maximo_global`, `uso_maximo_por_conta`, `valido_de`, `valido_ate`, `primeira_compra_apenas` (bool), `campanha`, `criado_por` | Resgate gera Transação do tipo `bônus` no bucket `saldo_bonus` |
| **UsoDeCupom** | `cupom_id`, `conta_id`, `pedido_id`, `valor_aplicado`, `usado_em` | Impede reuso e alimenta o relatório de campanha |
| **MétodoDePagamento** | `id`, `conta_id`, `tipo` (cartao · pix_automatico), `bandeira`, `ultimos4`, `validade`, `token_psp`, `padrao` (bool), `mandato_id`, `status` | Nunca armazenar PAN — só token do PSP |
| **RecargaAutomática** | `conta_id`, `metodo_id`, `gatilho` (runway_dias · saldo_minimo), `limiar`, `valor_recarga`, `teto_mensal`, `ativa`, `ultima_execucao`, `ultimo_resultado` | Teto mensal é proteção contra loop de cobrança |
| **NotaFiscal** | `id`, `conta_id`, `competencia`, `tipo` (NFS-e), `numero`, `serie`, `valor`, `status`, `pdf_url`, `xml_url`, `transacao_ids[]` | Vinculada a recarga ou a competência de consumo — decisão em aberto (pergunta 12 de §A.3.8) |
| **Reembolso** | `id`, `conta_id`, `transacao_origem_id`, `valor`, `forma` (dinheiro · credito), `motivo`, `status`, `solicitado_em`, `processado_em`, `aprovado_por` | Gera Transação negativa e, se em dinheiro, ordem de estorno no PSP |
| **Notificação** | `id`, `conta_id`, `usuario_id`, `evento` (chave), `severidade` (info · aviso · critico), `titulo`, `corpo`, `ambiente_id`, `job_id`, `link`, `lida_em`, `criado_em` | O **item** da caixa de entrada |
| **PreferênciaDeNotificação** | `conta_id`, `usuario_id`, `evento`, `canal` (in_app · email · whatsapp · webhook), `habilitado`, `limiar` (json) | Matriz evento × canal, com limiar configurável |
| **EntregaDeNotificação** | `notificacao_id`, `canal`, `destino`, `status` (enviado · falhou · bounce), `tentativas`, `provedor_id` | Necessário para diagnosticar "não recebi o aviso de saldo" |
| **Ticket** *(refinado)* | `id`, `conta_id`, `ambiente_id`, `assunto`, `categoria`, `status`, `prioridade`, `criado_em`, `atualizado_em`, `helpdesk_externo_id`, `contexto_snapshot` (json) | **Espelho local** do helpdesk integrado — só o suficiente para listar e correlacionar. `contexto_snapshot` guarda o payload enviado no momento da abertura |
| **Indicação** | `id`, `indicador_conta_id`, `indicado_conta_id`, `codigo_ref`, `estagio` (clicou · cadastrou · criou_ambiente · consumiu_minimo · creditado · rejeitado), `valor_bonus_indicador`, `valor_bonus_indicado`, `carencia_ate`, `creditado_em`, `motivo_rejeicao`, `sinais_antifraude` (json) | O `estagio` é uma máquina de estados; o crédito só acontece na transição para `creditado` |
| **CódigoDeIndicação** | `conta_id`, `codigo` (uuid), `criado_em`, `cliques`, `cadastros`, `ativo` | 1:1 com conta |

### A.8.1 Relações principais (novas)

```
Conta 1—1 SaldoDeCrédito
Conta 1—N Transação            (razão append-only; saldo é derivado)
Conta 1—N Recarga              → 1—1 Transação (quando paga) → 0..1 NotaFiscal
Conta 1—N Pedido 1—N ItemDePedido
Pedido 0..1—1 Compromisso · 0..1—1 Ambiente · 1—N Job
Conta 1—N Compromisso N—1 Ambiente
Ambiente 1—N LançamentoDeConsumo N—1 Transação   (agregação diária)
Ambiente N—1 Plano N—1 TabelaDePreçoUnitário     (versionada por vigência)
Ambiente 1—N AssinaturaDeAddOn N—1 AddOn
Conta 1—N MétodoDePagamento 0..1—1 RecargaAutomática
Cupom 1—N UsoDeCupom N—1 Conta
Conta 1—N Notificação;  Usuário 1—N PreferênciaDeNotificação
Notificação 1—N EntregaDeNotificação
Conta 1—N Ticket N—1 Ambiente
Conta 1—1 CódigoDeIndicação 1—N Indicação N—1 Conta (indicado)
Transação N—1 (Recarga | LançamentoDeConsumo | Compromisso | Cupom | Indicação | Reembolso | ajuste_admin)
```

**Invariantes que o billing precisa garantir:**
1. `SaldoDeCrédito.saldo_total == Σ Transação.valor` da conta. Sempre. Se divergir, é bug de dinheiro — deve disparar alerta ao admin, não log.
2. Nenhuma Transação é atualizada ou apagada. Correção é uma Transação de `ajuste` com motivo e autor.
3. `LançamentoDeConsumo` de um ambiente nunca tem janelas sobrepostas para a mesma `forma`.
4. Webhook de PSP é idempotente por `psp_id`.
5. Toda alteração de recurso (cliente **ou** admin) fecha as janelas abertas antes de aplicar.

---

## A.9 Telas de **super admin** exigidas pelo billing

Complementa §4 e §6 do lote 1. Todas **[PROPOSTA NOVA]**.

### A.9.1 `/admin/planos` — Catálogo, preços e vigência
CRUD de **TabelaDePreçoUnitário** (o preço real) e dos **degraus nomeados** (a vitrine). Colunas: plano, vCPU, RAM, disco, região, preço/mês **calculado**, preço/hora, preço/hora pausado, ambientes ativos no plano, receita mensal do plano, visível no catálogo (toggle), ordem.
Essencial: **versionamento por data de vigência** e um passo de **simulação obrigatório** antes de publicar — "esta mudança afeta 47 ambientes; receita mensal vai de R$ 4.120 para R$ 4.840 (+17,5%); 12 clientes com compromisso ativo ficam *grandfathered*". Publicar preço sem ver o impacto é como fazer `DROP TABLE` sem `WHERE`.
Inclui CRUD de **AddOn** e da política de desconto por compromisso (prazos e percentuais).

### A.9.2 `/admin/cupons` — Cupons e campanhas
CRUD de Cupom com todos os campos de §A.8. Lista com: código, tipo, valor, usos (atual/máximo), receita influenciada, CAC implícito, período, status. Ações: gerar lote de códigos, exportar CSV, desativar imediatamente. Detalhe da campanha com funil (resgates → contas criadas → ambientes criados → receita gerada em 90 d). Sem esta tela, toda promoção vira deploy — e todo cupom vazado vira prejuízo sem botão de desligar.

### A.9.3 `/admin/financeiro/conciliacao` — Conciliação de pagamentos
Abas por PSP (Pix, cartão). Tabela: data, `psp_id`, valor no PSP, valor no nosso razão, conta, status, **divergência**. Filtros: divergentes, órfãos no PSP (dinheiro entrou e não creditamos — **o pior caso**), órfãos no razão (creditamos e não entrou), webhooks falhados/reprocessáveis, pendentes há mais de N horas. Ações: **reprocessar webhook**, creditar manualmente com motivo, marcar como conciliado, exportar para o contador.
Painel de saúde: taxa de webhooks perdidos nas 24 h, tempo médio de liquidação Pix, taxa de aprovação de cartão. **É a tela que impede o vazamento silencioso de dinheiro** e deve ser checada diariamente.

### A.9.4 `/admin/financeiro/inadimplencia` — Saldo baixo e ciclo de vida
Lista priorizada por urgência: contas com runway < 24 h, < 3 d, < 7 d; contas em **grace period** com contador; contas **suspensas** com dias até retenção/exclusão; contas com saldo negativo. Colunas: cliente, saldo, runway, gasto/mês, ambientes afetados, LTV, último contato, tem recarga automática (bool).
Ações em massa: notificar, conceder crédito de cortesia (com motivo, valor e teto por admin), estender grace period, suspender agora, cancelar exclusão agendada. Cada ação gera Transação e entra na auditoria.
**Fila de exclusão** em destaque, com botão de abortar — porque exclusão automática de dados de cliente é o erro mais caro que a plataforma pode cometer.

### A.9.5 `/admin/financeiro/reembolsos` — Reembolsos, estornos e chargebacks
Fila de solicitações com: cliente, transação de origem, valor solicitado, **valor calculado pela política** (com a conta de recomposição de desconto aberta, §A.3.5), motivo, tempo desde a compra, histórico de reembolsos do cliente. Ações: aprovar em dinheiro, converter em crédito, recusar com justificativa. **Alçada por valor** (acima de X exige segundo aprovador) e prazo de resposta visível.
Aba **Chargebacks**: contestações abertas pelo PSP, prazo de defesa, evidências anexadas (logs de acesso, IP, uso real do serviço), resultado. Cada chargeback deve automaticamente marcar a conta com risco e bloquear indicações pendentes.

### A.9.6 `/admin/financeiro/compromissos` — Passivo de serviço
A tela que ninguém lembra de fazer e que quebra a empresa. Lista de todos os Compromissos ativos com: cliente, ambiente, prazo, valor pago, **saldo dedicado restante (= passivo)**, horas consumidas × contratadas, término aproximado, desconto travado. Totalizadores: **passivo total em R$**, receita diferida por mês pelos próximos 12 meses, e **margem projetada** (receita reconhecida − custo de infra) para o horizonte comprometido.
É aqui que se descobre, antes do contador, que R$ 80 mil já foram recebidos por serviço a entregar até 2029.

### A.9.7 `/admin/clientes/{id}/financeiro` — Aba financeira do cliente
Dentro do detalhe do cliente (§6.3 do lote 1): saldo por bucket, razão completo, recargas, compromissos, cupons usados, indicações, NFs, reembolsos, risco de fraude. Ações: **creditar/debitar com motivo obrigatório**, forçar recarga, cancelar compromisso com residual, isentar de cobrança por período, emitir NF avulsa. Tudo auditado (§6.7 do lote 1).

### A.9.8 `/admin/indicacoes` — Antifraude do programa
Lista de Indicações por estágio, com sinais de fraude agregados (mesmo CPF, mesmo cartão/chave Pix, mesmo IP, mesmo *device*, e-mail descartável, cadastros em rajada). Fila de revisão manual acima do limiar. Ações: aprovar, rejeitar com motivo, banir código, ajustar teto por conta. Métricas: bônus pago no mês, CAC por indicação, taxa de retenção do indicado em 90 d, % rejeitado por fraude.

### A.9.9 `/admin/notificacoes` — Broadcast e diagnóstico
Envio de comunicado a segmentos (todos, por plano, por nó, por região, saldo baixo) com pré-visualização e contagem de destinatários — necessário para manutenção programada e incidente. Aba de **diagnóstico de entrega**: bounces, falhas por canal, notificações não lidas de severidade crítica. Resolve a classe de ticket "eu não fui avisado".

### A.9.10 Impacto nas telas já previstas no lote 1
- **§6.1 Dashboard:** acrescentar `Passivo de compromissos`, `Contas em grace`, `Conciliação divergente hoje` e `Receita diferida do mês`.
- **§6.4 Alterar vCPU/RAM:** acrescentar o efeito sobre o compromisso do cliente (`encurta em N dias`) e o interruptor **cobrar / não cobrar** (§A.3.6, item 4).
- **§6.5 Financeiro:** passa a ser um hub com as abas A.9.1 a A.9.6, não uma tela única.

---

## A.10 Correções ao lote 1

| # | O que o lote 1 diz | Correção a partir do lote 2 |
|---|---|---|
| 1 | §1.3 — "Região: 🇧🇷 Brasil" tratado como dado fixo do ambiente | É uma **escolha do cliente no funil**, entre **Brasil e E.U.A.**, e **o preço muda por região** (Nuvem Pro 1 GB aparece a R$ 44,90 na região E.U.A.). `regiao` é dimensão da tabela de preço, não só metadado |
| 2 | §1.3 — "botão **Alterar plano** → resize de recursos" | Confirmado, mas o catálogo é uma **escada de RAM com vCPU e disco derivados**, não planos livres. E a promessa "Escalável: ajuste a qualquer momento" está impressa na tela de venda — vira obrigação contratual |
| 3 | §3.1 — feature única "Criar ambiente (provisionar) · Alta · `core-provision` · MVP" | Deve ser **dividida em duas**: `onboarding` (funil/checkout, Média) e `core-provision` (job de provisionamento, Alta). São times, telas e falhas diferentes |
| 4 | §3.8 — "Indique e ganhe / gamificação · `growth` · **futuro**" | **Separar:** indicação vira **v1** (mecânica simples, ROI direto, e o antifraude precisa nascer junto); **gamificação vira "não fazer"** |
| 5 | §3.8 — "Suporte (tickets/chat) · Média · `support` · **v1**" | Vira **MVP com complexidade Baixa**, porque a decisão é **integrar** (Crisp/Chatwoot Cloud), não construir (§A.5.2). Sem canal de suporte no dia 1 não há lançamento |
| 6 | §4.15 — "Cliente — Notificações" listado como **[PROPOSTA NOVA]** | **Parcialmente incorreto:** o Hostoo **tem** `/user/notifications`, com 12 toggles em 3 grupos. O que **não** existe é a **caixa de entrada**, a escolha de canal e os eventos operacionais. A proposta nova é o feed, não a página |
| 7 | §4.13 — "Cliente — Consumo e custos (falta grave no Hostoo)" | **Confirmado e agravado:** existem **4 abas financeiras** e nenhuma mostra hora, tarifa, recurso ou projeção. Além disso, o débito horário **não aparece no histórico de transações**, o que torna o saldo não auditável pelo cliente |
| 8 | §5.5 — "pausado, você gastaria R$ 0,004/h em vez de R$ 0,0486/h" | Valores eram ilustrativos. Substituir pela tabela de §A.4.5 (ex.: Veloz Light R$ 0,0693/h ativo × R$ 0,0069/h pausado) |
| 9 | §1.12 e §8 — backup como add-on pago, recomendação de "7 dias inclusos" | **Reforçar**: além do add-on de R$ 10/mês, o Hostoo **cobra R$ 25 por restauração** (linha `Restauração de hospedagem R$ −25,00` no histórico). VelozPanel: backup 7 d incluso **e restauração sempre gratuita** — vira argumento de venda explícito |
| 10 | §7 — "Fatura / Extrato" e "Transação (parcial)" no modelo de informação | Substituídos pelas entidades detalhadas de §A.8. Não existe "Fatura" no modelo pré-pago: existe **Transação**, **Recarga**, **NotaFiscal** e **LançamentoDeConsumo** |
| 11 | §7 — "Plano · preço/mês, preço/hora" como campos do Plano | Corrigir: preço é **derivado** de `TabelaDePreçoUnitário` versionada. Preço gravado no Plano impede o requisito nº 9 e o *grandfathering* |
| 12 | §1.1 — "R$ 147,96 + `+` verde · saldo" | Confirmado, e o `+` leva a `/payment/recharge`, cuja aba padrão é **recarga automática por cartão** — o Pix fica atrás de dois links cinzas. Não copiar essa hierarquia |
| 13 | §8 — tabela de recomendações finais | Acrescentar duas linhas: **"Compromisso de fidelidade"** → *3/6/12 meses com 15/25/35%, nunca 36 meses, nunca pré-selecionado* (§A.3.7); **"Cobrar por restauração"** → *nunca* |

---

## A.11 Recomendações finais do lote 2

| Decisão | Trade-off | **Recomendação** |
|---|---|---|
| Modelo de cobrança | Puro por hora é honesto mas imprevisível; puro mensal é previsível mas nega o botão de pausar | **Híbrido com ênfase invertida:** horário sobre saldo pré-pago é o padrão; compromisso é opt-in curto (3/6/12 m, 15/25/35%) |
| Prazo máximo de compromisso | 36 m gera caixa e trava churn × congela preço por 3 anos numa operação de 3 servidores | **Máximo 12 meses.** Passivo de serviço plurianual é risco existencial para time de 1–3 pessoas |
| Default do compromisso no funil | Pré-selecionar 36 m maximiza receita × é *dark pattern* e gera Procon | **Default = sem compromisso**, colapsado, opt-in explícito |
| Planos fechados × sliders | Fechado quebra o requisito nº 9; granular quebra o binpacking em 3 nós | **Degraus fechados na vitrine, preço unitário no motor, sliders só no admin** (§A.4.3) |
| Disco | Derivar do degrau é simples × cliente com muito arquivo e pouca RAM fica sem opção | **Disco é o único eixo granular exposto ao cliente**, como add-on por GB |
| Pausar durante compromisso | Estender o prazo é generoso × cria passivo mais longo | **Estende** (bloco é de horas), com **teto de validade de 1,5× o prazo** |
| Saldo residual em cancelamento | Reter é receita × devolver é confiança e é o que o CDC pede | **Crédito integral** (destacado) **ou dinheiro com recomposição do desconto** (disponível), sempre com a conta aberta na tela |
| Meio de pagamento no MVP | Cartão dá recorrência automática × Pix é o que o cliente usa (15/15 no histórico real) | **Pix primeiro e em destaque**; cartão em v1; **Pix Automático** em v2 |
| Restauração de backup | R$ 25 por restore é receita fácil × é extorsão em momento de crise | **Sempre grátis**, e dizer isso na página de preços |
| Suporte | Construir dá controle × consome semanas e nunca fica bom | **Integrar (Crisp/Chatwoot Cloud) no MVP**, self-hosted só acima de ~200 conversas/mês. Nunca construir |
| Indicação | Espelhar a 1ª recarga é simples × é arbitragem pura (recarrego 20, ganho 20) | **Bilateral, atrelado a consumo (R$ 50 consumidos → R$ 25 para cada), carência 30 d, teto R$ 250/ano**, antifraude junto no v1 |
| Notificações | Tudo-ou-nada por evento é simples × não serve para agência nem para dev | **Caixa de entrada no MVP** + matriz evento × canal em v1; CPU/RAM **ligados por padrão** |
| Auditabilidade do saldo | Agregar consumo por mês é barato × cliente não consegue conferir a conta | **Razão append-only com saldo após cada lançamento**, inclusive o débito horário. Inegociável num modelo por hora |
