# Brief de design — Data Studio (novo, estilo DBeaver)

Documento para pedir um **novo design** do Data Studio. Descreve como a tela é **hoje**, o **alvo** (um IDE de banco no navegador) e as **restrições** de marca/estilo. Depois do design, desenvolvemos.

---

## 1. Contexto

O **Data Studio** é o console de banco embutido do painel Jamees. Vive **dentro de um ambiente de serviço de banco** (na aba "Data Studio" de `/env/[id]/studio`). Cada ambiente É o banco do cliente, isolado. Engines: **mysql, mariadb, postgres** (foco deste redesign), além de **mongodb** e **redis** (que mantêm consoles próprios).

Objetivo do redesign: transformar o executor de SQL atual num **IDE de banco visual** (estilo DBeaver / TablePlus / Beekeeper Studio) onde o cliente **navega o schema, edita dados na grade e salva, e cria tabela/trigger/índice sem escrever SQL** — com acabamento "AAAA".

Importante: **o backend já executa qualquer SQL** (SELECT/UPDATE/DDL) com resultado em colunas+linhas, modo escrita protegido, timeout e auditoria. Ou seja, o redesign é quase todo **frontend** — o designer tem liberdade total de UX sem restrição técnica de backend.

---

## 2. Como a tela é HOJE (ponto de partida)

### Estados antes do console
1. **Desligado** — o Studio vem desligado; card central com um toggle "Ativar Data Studio".
2. **Ambiente parado** — se o banco está pausado, aviso "ambiente parado, inicie para usar".
3. **Bloqueado por senha** (opcional) — se o dono definiu uma senha extra, tela pedindo a senha para desbloquear (sessão de 30 min).
4. **Console** — a tela principal (abaixo).

### Console SQL (mysql/mariadb/postgres) — hoje
Layout simples de 2 partes:
- **Sidebar "Tabelas"** (esquerda): lista **só os nomes** das tabelas. Clicar preenche `SELECT * FROM <tabela> LIMIT 100` no editor. Sem colunas, tipos, índices, triggers, views.
- **Área principal**:
  - Um **`<textarea>` cru** para digitar SQL — **sem** syntax highlight, **sem** autocomplete, **sem** números de linha. Atalho `Ctrl/Cmd+Enter` executa.
  - Um toggle **"Modo escrita"** (desligado por padrão; ligar abre um dialog de confirmação, pois habilita UPDATE/DELETE/DDL).
  - Botão **"Executar"**.
  - **Resultado**: uma **`<table>` HTML simples**, cabeçalho fixo, células truncadas em ~200 caracteres. **Não é editável**, **sem paginação**, **sem ordenação**, **sem redimensionar coluna**. Mostra "Resultado truncado" ao passar do limite (12 MiB).

### Consoles Mongo e Redis (hoje) — não são o foco, mas existem
- **Mongo**: editor de operação (find/insert/… numa whitelist) + resultado em JSON.
- **Redis**: abas "Chaves" (navegar keys), "Comando" (redis-cli) e "Pub/Sub" (ao vivo).

### Aparência atual
Tema **claro**, componentes próprios do painel (cards, botões, inputs), Tailwind, ícones **lucide**, marca **roxa (#634ca8)**. É **funcional mas cru** — parece um "executor de query", não um IDE.

### Por que redesenhar (limitações de hoje)
- Editor é um textarea, não um editor de código.
- Grade é read-only: sem editar célula, sem paginação, sem ordenação, sem PK/tipos.
- Navegador de schema é mínimo (só nomes de tabela).
- Não dá para **criar tabela/trigger/índice** nem **editar dados** pela interface.

---

## 3. O ALVO (o que o novo design deve entregar)

Um **IDE de banco no navegador**, denso porém limpo, com o visual Jamees. Referências: DBeaver, TablePlus, Beekeeper Studio, phpMyAdmin (funcional), Adminer.

### Layout sugerido (3 regiões)
1. **Navegador de schema** (coluna esquerda, colapsável):
   - Árvore: **Banco → Tabelas / Views** → expandir para **Colunas, Índices, Triggers, Chaves estrangeiras**.
   - Ícones por tipo (tabela, view, coluna PK, índice, trigger), **busca/filtro**, contadores.
   - Ações de contexto (clique direito / menu): abrir dados, ver estrutura, nova tabela, novo trigger, dropar (com confirmação).
2. **Área central com abas** (uma aba por tabela ou consulta aberta, estilo editor):
   - **Aba "Dados"**: a **grade editável** (ver abaixo).
   - **Aba "Estrutura"**: colunas (nome, tipo, nulável, default, PK/FK), índices, triggers — com botões de editar/adicionar/remover.
   - **Aba "SQL"**: editor de SQL (com highlight/autocomplete) + resultado.
3. **Rodapé/painel de status**: mensagens (linhas afetadas, tempo, erros), barra de ações (Salvar alterações, Descartar), indicador de "N alterações pendentes".

### Grade de dados (o coração — o "editar e salvar sem código")
- **Editar célula** clicando (inline), com editor apropriado por tipo: texto, número, data/hora, boolean, **NULL** (um toggle/atalho), enum/select quando aplicável.
- **Dirty tracking**: células/linhas alteradas ficam destacadas; barra "Salvar (N)" / "Descartar". Salvar gera os `UPDATE ... WHERE <pk>` (o design não precisa se preocupar com o SQL, mas deve mostrar as alterações pendentes de forma clara e permitir revisar/confirmar).
- **Inserir linha** (linha vazia no topo/rodapé ou modal) e **excluir linha** (com confirmação).
- **Paginação** real (páginas ou scroll infinito) + **total de linhas**; **ordenação** por coluna; **redimensionar** e reordenar colunas; **fixar** colunas.
- Indicadores visuais: **PK** (chave), **NULL** (estilo distinto), **FK** (link para a tabela referenciada), tipos, valores binários/longos (com "ver mais").
- Estados: carregando, vazio ("tabela sem linhas"), erro, resultado truncado.

### Ações de criação (DDL por interface)
- **Nova tabela**: form com linhas de coluna (nome, tipo, tamanho, nulável, default, auto-increment, PK), definição de índices e FKs. Preview do DDL opcional.
- **Novo trigger**: form (nome, evento BEFORE/AFTER INSERT/UPDATE/DELETE, corpo).
- **Novo índice / alterar tabela** (adicionar/remover coluna).

### Editor SQL (aba SQL)
- Editor com **syntax highlight**, **autocomplete** de tabelas/colunas, números de linha, e o toggle "Modo escrita" + confirmação.
- Histórico de execuções (opcional).

### Todos os estados a desenhar
Desligado · Ambiente parado · Bloqueado por senha · Console vazio (nenhuma aba) · Navegador carregando · Grade carregando/vazia/erro/truncada · Alterações pendentes · Modal criar tabela/trigger · Confirmações destrutivas.

---

## 4. Restrições de design (obrigatórias)

- **Marca Jamees**: roxo primário **#634ca8** (variações lilás/escuro já existem no design system). Manter a identidade do painel.
- **Tema CLARO apenas** (o painel não tem dark mode aqui).
- **Tipografia**: **Inter** para a UI; **JetBrains Mono** (mono) para dados/SQL/valores. Números tabulares.
- **Densidade de IDE**: muita informação, mas legível e organizada — linhas compactas, espaçamento consistente, hierarquia clara. É uma ferramenta profissional, não uma landing page.
- **Reusar a linguagem visual do painel** (cards, bordas suaves, cantos arredondados, sombras leves), porém com densidade de "pro tool".
- **Responsivo** desktop-first: em telas menores, o navegador de schema colapsa; a grade tem scroll horizontal próprio.
- **Acessibilidade**: navegação por teclado (setas na grade, Enter para editar, Esc para cancelar), foco visível, contraste adequado.
- **Ações destrutivas** (drop, delete, salvar escrita) sempre com confirmação clara.

---

## 5. Fases de desenvolvimento (para o designer priorizar)

1. **Navegador de schema + grade (leitura)** — árvore + grade paginada/ordenável. ← desenhar primeiro
2. **Grade editável** — editar célula, inserir/excluir, salvar alterações. ← o coração
3. **Criar** — modais de nova tabela / trigger / índice.
4. **Polimento** — editor SQL (CodeMirror), teclado, micro-interações, performance.

> Escopo do redesign: **mysql, mariadb, postgres**. Mongo e Redis ficam como estão (consoles atuais) por enquanto.

---

## 6. Referências visuais sugeridas
DBeaver (navegador + grade + abas), TablePlus (grade editável limpa), Beekeeper Studio (leveza + tema claro), Supabase Table Editor (grade editável moderna, boa para inspiração de UX), phpMyAdmin/Adminer (cobertura funcional de DDL).

---

## 7. Design System REAL (extraído do código — use estes tokens)

> Estes são os tokens e componentes que o painel Jamees **já usa**. O novo design DEVE usá-los, para ficar na marca e o dev reproduzir 1:1. Fonte: `apps/painel/src/app/globals.css` e `apps/painel/src/components/ui/*`.

### Cores — tema claro (padrão)
| Papel | Hex | Token |
|---|---|---|
| Fundo da página | `#f4f4f7` | `--vp-bg` |
| Superfície / card | `#fdfdfe` | `--vp-surface` |
| Borda | `#e4e4ea` | `--vp-border` |
| Borda sutil | `#eeedf2` | `--vp-border-subtle` |
| Texto (tinta) | `#26262e` | `--vp-text` |
| Texto secundário | `#5f5f6b` | `--vp-text-2` |
| Texto terciário | `#86868f` | `--vp-text-3` |
| **Roxo primário / link** | `#634ca8` | `--vp-brand` / `--vp-link` |
| **Roxo forte / hover** | `#4a3880` | `--vp-brand-strong` |
| Foco (anel) | `#7460b5` | `--vp-focus` |
| Texto sobre roxo | `#fdfdfe` | `--vp-on-solid` |
| Sucesso | `#146b45` | Aviso `#6f5210` · Perigo `#8a2b2b` · Info `#634ca8` · Neutro `#5f5f6b` |
| Superfície escura (logs/topbar) | `#26262e` | `--vp-ink-surface` |
| Gráfico CPU / Memória | `#d9536f` / `#3f9fb8` | (referência) |

**Pílulas de estado** (fundo suave + texto na cor, **sem borda**, cantos totais): brand `#eae7f4`/`#4a3880` · sucesso `#dff0e7`/`#146b45` · aviso `#f6eed6`/`#6f5210` · perigo `#f7e2e2`/`#8a2b2b` · neutro `#f0f0f3`/`#5f5f6b`. Estado de ambiente = **cor + ícone + texto** sempre.

> Dark mode existe como **opção** (`[data-theme="dark"]`), mas o padrão é **claro** — desenhe para o claro.

### Tipografia
- **UI:** Inter (`--font-inter`) — `system-ui` como fallback.
- **Dados / SQL / valores:** monospace (recomendo **JetBrains Mono**; use `ui-monospace` de fallback). Números **tabulares**.

### Raios, sombras, foco
- Raios: **card `16px`** (`rounded-xl`), `14px` (`--radius-lg`), **botão `10px`**, pílulas `9999px`.
- Sombras: card **`0 1px 2px rgba(38,38,46,.05)`** (bem plano); popover **`0 10px 28px rgba(38,38,46,.18)`**.
- **Foco visível:** anel **3px** `#7460b5` + halo 1px, offset 2px (obrigatório — WCAG).
- Respeitar `prefers-reduced-motion`.

### Componentes existentes (reusar)
- **Botões** (`button.tsx`): `primary` (roxo preenchido, texto branco, **um por tela**) · `outline` (transparente, borda cinza, texto secundário; hover vira roxo) · `danger` (vermelho, sempre com confirmação) · `ghost` (só texto roxo, ações inline). Tamanhos: `sm` (h-36px), `md` (h-44px). Raio 10px.
- **Card** (`card.tsx`): `rounded-xl border-border-subtle bg-surface p-5` + sombra plana. **CardTitle** tem uma **barra de acento roxa** de 4px à esquerda (`.vp-accent-bar`).
- Também existem: `badge` (pílula), `input`, `dialog` (modal), `toast`, `segmented` (segmented control). Ícones: **lucide-react**.
- **Layout do ambiente:** rail escuro à esquerda (**80px**), submenu branco do ambiente (**246px**) — o Data Studio abre dentro dessa área de conteúdo. O novo navegador de schema é uma **terceira coluna** dentro do conteúdo (não confundir com o submenu de seções).

### Como pedir ao designer (dica)
Cole este brief inteiro + os hexes acima. Peça explicitamente: "tema claro, marca roxa #634ca8, Inter + mono, densidade de IDE, reusando cards/botões/pílulas do design system acima". Se possível, anexe **screenshots** (a tela atual + DBeaver/TablePlus) — texto sozinho não reproduz pixels.
