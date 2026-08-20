# UX-REFERENCIAS — Padrões reais de painel para o VelozPanel

> Documento de referência para o **especialista de UX** implementar. Não contém código; contém
> decisões visuais e de navegação destiladas de painéis reais de hospedagem/SaaS.
> Base: ADENDO 9 (branco + roxo), ADENDO 10 + U.2 (sidebar esquerda, sem `<select>`, ícones SVG
> profissionais, sem "cara de IA"), doc 10 (AA piso, AAA onde viável), doc 05 (bundle, uPlot/Recharts).
>
> **Fontes primárias:** 36 screenshots do Hostoo em `Plan/hostoo/*.png` (analisadas 6 telas-chave abaixo).
> **Fontes web:** Hostinger hPanel, Ploi/RunCloud, Vercel/Linear/Stripe patterns, Lucide, WAI-ARIA.
> Links completos no fim de cada seção.

---

## 0. O que aprendi olhando o Hostoo (leitura direta das telas)

O Hostoo é **branco + roxo**, mas com uma decisão que precisamos **copiar e corrigir ao mesmo tempo**:

| Elemento no Hostoo | O que fazem | Decisão para o VelozPanel |
|---|---|---|
| **Navegação principal** | Sidebar esquerda é só a **lista de ambientes** (busca + "Hospedagens" + itens). A navegação de features fica em **abas horizontais dentro do card** (Resumo/Domínio/Arquivos…). | **Mudar.** O dono pediu sidebar esquerda como **navegação de produto** (ADENDO 10). Ver §2. A lista de ambientes vira conteúdo, não a sidebar. |
| **Topbar** | Branca, full-width: logo → toggle misterioso → "Indique e ganhe" → **saldo R$ 147,96 + botão "+"** → nome + avatar. | Manter a ideia: topbar enxuta com **saldo/créditos**, conta e avatar. Ver §1. |
| **Seletor de versão PHP** | **Grupo de botões segmentados** (5.6 … 8.4) numa cápsula com borda; ativo roxo preenchido, resto texto roxo. **É exatamente o padrão que o dono quer** no lugar de `<select>`. | **Copiar.** Ver §4 (segmented control acessível). |
| **Cor de CTA** | Botão de ação primária é **VERDE** (Continuar, Alterar plano, Adicionar banco). **Roxo é usado para títulos, links, estado ativo e acentos** — não para o botão principal. | **Adotar essa divisão de papéis**, mas ver §3.4: recomendo **roxo como primário** e verde só para "sucesso/criar", para não diluir a marca. |
| **Cards** | Branco sobre cinza-claro, cantos arredondados (~14px), **barra de acento vertical** curtinha ao lado do título (roxo, às vezes amarelo). Padding generoso. | Manter cards brancos + acento. O acento vertical é um bom detalhe "de produto". Ver §3 e §5. |
| **Badges de estado** | Pílulas verdes claras: `ATIVO`, `🔒 HTTPS`, `PHP 8.3`. Texto + (às vezes) ícone. | Manter, mas **ícone SVG Lucide** em vez de emoji, e sempre cor **+** ícone **+** texto (AA). Ver §5.2. |
| **Ações do ambiente** | Fileira de **botões circulares cinza** com ícone de linha: pause, upload, editar, migrar (shuffle), lixeira. | Copiar o padrão de "toolbar de ícones", com `aria-label` em cada um. Ver §5.7. |
| **Métricas no topo** | CPU/RAM/Disco como **barras de progresso horizontais** com % à direita, cores distintas (CPU rosa/vermelho, RAM azul, disco amarelo). | Copiar para o cabeçalho do ambiente; gráficos maiores ficam abaixo (uPlot). Ver §5.8. |
| **Sliders + toggles** | Config PHP (`post_max_size`…) usa **slider com valor** + **toggles roxos** para booleanos. | Bom padrão anti-`<select>` para valores numéricos. |
| **Funil de criação** | **Stepper 1–5** com círculos ligados por linha (ativo roxo, futuro cinza), RAM por **slider com marcas**, região por **cards-rádio** com bandeira. Resumo fixo à direita + CTA. | Copiar a estrutura. Ver §7 (tela de ouro 3). |
| **Quick access** | Fileira de **círculos ilustrados** grandes (Migração, WordPress…) no rodapé. | Opcional. Tende a "encher" a tela; usar com parcimônia (risco de "cara de template"). |

**Veredito de marca:** o Hostoo às vezes parece "cheio" (muitos círculos coloridos, pílula misteriosa no
topo, quick-access redundante com a sidebar). O VelozPanel deve ser **mais sóbrio**: menos ornamento,
mais hierarquia. Estilo-alvo = **Hostoo depurado com a disciplina do Hostinger/Linear**.

Telas lidas: `...oliveirafacil-com...` (resumo), `...-php...` (segmented + sliders), `...-database...`
(tabela + toggle + radio), `...-files...` (toolbar + tabs internas), `...-ssl...` (tabs + banner de estado),
`...-create...02_55_10` e `...02_56_08` (funil stepper).

---

## 1. Anatomia de layout recomendada

Layout de 3 zonas: **sidebar fixa à esquerda + topbar fina + área de conteúdo**. Este é o consenso dos
painéis modernos (Hostinger hPanel, Linear, Vercel, Stripe): "sidebar 240–280px, topbar enxuta, grid
de 12 colunas de conteúdo" ([925studios 2026](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)).

### 1.1 Sidebar esquerda (navegação de produto)
- **Largura:** `256px` expandida (padrão de mercado: Linear/Stripe/Vercel usam 240–256px). Colapsada `72px` (só ícones + tooltip).
- **Fundo:** branco puro `#FFFFFF` **ou** um cinza-lavanda muito sutil (`#FAFAFC`) para separar do conteúdo (`#F4F4F7`). Borda direita `1px` `#ECECF1`. **Não** usar roxo cheio de fundo (vira "cara de dashboard IA").
- **Topo:** logo VelozPanel (altura ~32px) + nome. Clique → dashboard/lista de ambientes.
- **Itens:** `ícone SVG (20px) + label`. Altura do item `40px`, padding horizontal `12px`, radius `8px`, gap ícone-label `12px`.
  - **Estado normal:** texto `#3F3F51`, ícone `#6B6B80` (stroke).
  - **Hover:** fundo `#F3F0FF` (roxo-lavanda 50), sem mudar a cor do texto.
  - **Ativo:** fundo `#EDE7FF` (roxo 100) + texto e ícone **roxo** `#6D28D9` + **barra vertical de 3px** roxa colada na borda esquerda do item (o "acento" que o Hostoo usa nos cards, aqui na nav). `aria-current="page"`.
- **Agrupamento:** seções com **rótulo em caixa-alta pequena** (`11px`, `letter-spacing .04em`, cor `#9A9AAE`): ex. "PRINCIPAL", "ADMIN". Sem linha divisória pesada.
- **Colapsável:** sim, botão no rodapé da sidebar. Persistir preferência (localStorage). No mobile vira **drawer** (off-canvas) com overlay; sidebar `hidden` < 1024px, abre por botão de menu na topbar.
- **Rodapé da sidebar:** avatar + nome do usuário + chevron → menu de conta (perfil, sair). Alternativa ao canto da topbar; escolher **um** dos dois, não os dois.

### 1.2 Topbar (fina, ~`56–64px`)
Papel: contexto global + conta. **Não** repetir a navegação. Da esquerda p/ direita:
- **Esquerda:** (mobile) botão hambúrguer; (desktop) breadcrumb ou título da página atual.
- **Centro/direita:**
  - **Busca global** (opcional no MVP; Hostinger e Hostoo têm). Se entrar, `⌘K`/`Ctrl+K`.
  - **Saldo/créditos** — padrão forte do Hostoo: `💰 R$ 147,96` com ícone Lucide `wallet`/`coins` + botão `+` (recarregar). Ótimo porque o modelo é pré-pago (briefing §40). Manter.
  - **Avatar + nome** → dropdown de conta (Perfil, Notificações, Sair). Badge de notificações (Lucide `bell`).
- Fundo branco, borda inferior `1px #ECECF1`. Sem sombra forte (sombra pesada = "cara de IA").

### 1.3 Área de conteúdo
- **Fundo:** cinza-claro `#F4F4F7` (contraste sutil com os cards brancos).
- **Largura máxima do conteúdo:** `1200–1280px` centralizado, com padding lateral `24–32px`. Não deixar cards esticarem infinitamente em telas 4K (linha de leitura vira ruim).
- **Grid:** 12 colunas, `gap 24px`. Dashboard usa strip de KPIs (4–6 cards) + grid flexível abaixo — padrão consolidado ([925studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026), [artofstyleframe](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/)).
- **Respiro:** título da página `28–32px` no topo, com subtítulo opcional; `32px` até o primeiro card.

Fontes: [Hostinger — usar o painel](https://www.hostinger.com/support/6627955-how-to-use-the-hosting-dashboard-in-hostinger/), [Hostinger hPanel overview](https://www.hostinger.com/support/1583483-comprehensive-guide-to-hpanel-at-hostinger/), [Ploi](https://ploi.io/), [Dashboard patterns 2026](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/).

---

## 2. Estrutura de navegação do VelozPanel

Sidebar com seções. **Itens de hoje** ativos; **itens futuros** visíveis mas marcados "Em breve"
(mostrar o roadmap dá sensação de produto sério, desde que não pareçam quebrados).

```
PRINCIPAL
  ▸ Ambientes            layout-dashboard   (ativo — lista de ambientes do cliente)
  ▸ Domínios             globe              (Em breve)
  ▸ Bancos de dados      database           (Em breve)
  ▸ Financeiro           credit-card        (Em breve)
  ▸ Suporte              life-buoy          (Em breve)

ADMIN            (só aparece para super admin)
  ▸ Visão geral          gauge              (ativo)
  ▸ Nós                  server             (ativo)
```

### 2.1 Como sinalizar "Em breve" sem parecer quebrado
- Item **visível**, ícone e label normais, mas com **badge pill cinza** "Em breve" à direita do label (`10px`, `#6B6B80` sobre `#EEEEF2`).
- Item com `aria-disabled="true"`, `tabindex="-1"` **não** navegável; cursor `default`; opacidade do ícone/label ~`0.6`.
- **Hover** mostra tooltip: "Disponível em breve". **Não** dar 404 nem tela vazia.
- Alternativa melhor (recomendada): o item **é clicável** e leva a uma **tela de "Em breve"** honesta — título, ícone grande esmaecido, 1 parágrafo do que virá, e um "Avise-me" opcional. Isso é mais WCAG-friendly (sem item desabilitado confuso) e passa profissionalismo. Ver §5.9 (empty/coming-soon state).
- **Nunca** usar emoji 🚧/⏳. Usar Lucide `clock`/`sparkles` sutil ou nada.

### 2.2 Regras
- **Ordem = frequência de uso.** Ambientes primeiro (é o coração). Admin sempre no fim, separado.
- Seção ADMIN só renderiza se `user.role === 'admin'` (não mostrar desabilitado a cliente).
- O **contexto de ambiente** (Resumo/Arquivos/Config…) do Hostoo vira **navegação secundária dentro da página de detalhe do ambiente** (abas horizontais), não itens da sidebar. Ver §7 (tela de ouro 2).

---

## 3. Sistema visual

### 3.1 Escala de espaçamento (base 4px)
`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Regra anti-"IA": **não** usar o mesmo espaçamento em tudo.
Ritmo recomendado: gap entre cards `24`, padding interno de card `24–32`, gap label↔valor `8`,
gap ícone↔texto `12`, seção↔seção dentro do card `32`.

### 3.2 Raio de borda
- Cards / painéis: `14px` (o Hostoo usa ~14–16; dá o ar "amigável" de hospedagem).
- Botões / inputs: `8px`.
- Badges / pills / segmented: `9999px` (cápsula) para pills; `8px` para o container do segmented.
- Avatar / ícones circulares: `9999px`.
- **Consistência:** escolher no máximo 2 raios visíveis por tela. Misturar 4/6/12/16 aleatório = "cara de IA".

### 3.3 Sombras (leves — sombra pesada denuncia template)
- Card em repouso: `0 1px 2px rgba(16,16,40,.04), 0 1px 3px rgba(16,16,40,.06)` (quase só uma borda).
- Card hover/elevado: `0 4px 12px rgba(16,16,40,.08)`.
- Dropdown/menu: `0 8px 24px rgba(16,16,40,.12)`.
- Preferir **borda `1px #ECECF1`** a sombra para delimitar. Linear/Stripe fazem isso.

### 3.4 Tipografia
- **Família:** **Inter** (ou o par do sistema: `-apple-system, "Segoe UI", Roboto`). Inter é neutra, "de produto", e evita o ar genérico do Poppins/Montserrat arredondado que o Hostoo usa (o arredondado excessivo contribui pra "cara de site-fácil"). Carregar via `next/font` (self-host, sem FOUT).
- **Pesos:** 400 (corpo), 500 (labels/valores), 600 (títulos de card), 700 (título de página). Nada de 800/900.
- **Escala:** página `28/32` (700) · seção `20/28` (600) · título de card `16/24` (600) · corpo `14/20` (400) · label/meta `13/18` (500) · caption/rótulo-seção `11/16` (500, caixa-alta).
- **Cor de texto:** títulos `#1A1A2E`, corpo `#3F3F51`, mudo/descrição `#6B6B80`. Contraste AA garantido sobre branco.
- **Não** usar roxo em blocos longos de texto (o Hostoo coloca títulos de card em roxo — ok para título curto, ruim para parágrafo).

### 3.5 Paleta (branco + roxo)
| Papel | Token | Hex | Uso |
|---|---|---|---|
| Roxo primário | `--brand-600` | `#6D28D9` | botão primário, estado ativo, links, foco |
| Roxo forte | `--brand-700` | `#5B21B6` | hover do primário |
| Roxo 100 | `--brand-100` | `#EDE7FF` | fundo de item ativo, chips |
| Roxo 50 | `--brand-50` | `#F5F3FF` | hover sutil, fundos de destaque |
| Cinza fundo | `--bg` | `#F4F4F7` | fundo da área de conteúdo |
| Branco | `--surface` | `#FFFFFF` | cards, sidebar, topbar |
| Borda | `--border` | `#ECECF1` | divisórias, contorno de card |
| Sucesso | `--success` | `#16A34A` | badge ATIVO, confirmações |
| Aviso | `--warning` | `#D97706` | pausado/atenção |
| Perigo | `--danger` | `#DC2626` | excluir, erro |
| Info/RAM | `--info` | `#2563EB` | série RAM, dicas |

**Uso do roxo — quando primário, quando sutil:**
- **Primário (cheio):** UM botão de ação principal por tela; item de nav ativo; barra de acento; foco.
- **Sutil (100/50):** fundos de hover, chips, realces de card. A tela deve ser **majoritariamente branca/cinza**; o roxo é pontual. Tela toda roxa = "cara de IA".
- **Proibir gradiente roxo→rosa** genérico (o clichê nº 1 de "feito por IA"). Se usar gradiente, só em 1 elemento de marca (logo/hero), sutil e monocromático.

> **Sobre CTA verde (Hostoo):** o Hostoo usa verde no botão principal. Recomendo **roxo como primário**
> e reservar **verde só para "criar/sucesso"** (ex.: botão "+ Criar ambiente", confirmação de recarga),
> para a marca não se dissolver. Trade-off assumido: menos parecido com Hostoo, mais identidade própria.

### 3.6 Estados (obrigatório em todo elemento interativo)
- **Hover:** mudança de fundo/borda sutil (`+4–6%` de tom), nunca só cursor.
- **Active/pressed:** escurece 1 passo + `transform: translateY(1px)` opcional.
- **Focus:** **anel visível** `0 0 0 3px rgba(109,40,217,.35)` + borda roxa. **Nunca remover outline sem substituir** (WCAG 2.4.7). Usar `:focus-visible`.
- **Disabled:** opacidade `.5`, `cursor: not-allowed`, sem hover.
- **Loading:** skeleton (não spinner solo em página inteira). Padrão 2026 ([925studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)).
- **Transições:** `150–200ms ease`. Nada de bounce/spring exagerado.

---

## 4. Segmented control / grupo de botões (substituto do `<select>`)

O padrão-âncora do dono. O Hostoo faz certo na tela de PHP: cápsula com borda, opções lado a lado,
ativo roxo preenchido. Vamos replicar **com acessibilidade de radiogroup**.

### 4.1 Quando usar
- **2–~10 opções mutuamente exclusivas e curtas:** versão de runtime (PHP 8.3, Node 22), plano, região, período de compromisso, runtime (PHP/Node/…), intervalo de gráfico (5min/1h/24h/30d).
- Muitas opções (>10) ou texto longo → cair para lista de **cards-rádio** (como a escolha de região do Hostoo) ou combobox com busca (mas isso é exceção; o dono quer botões).

### 4.2 Anatomia
- Container: `inline-flex`, borda `1px #ECECF1`, radius `8px`, padding `4px`, fundo branco.
- Cada opção: `role="radio"`, padding `8px 16px`, radius `6px`, peso `500`.
  - **Não selecionado:** texto roxo `#6D28D9` (ou neutro `#3F3F51`), fundo transparente.
  - **Selecionado:** fundo `#6D28D9`, texto branco, `aria-checked="true"`.
  - **Hover (não sel.):** fundo `#F5F3FF`.
- Para versão de linguagem, mostrar sub-rótulo "recomendada"/"LTS"/"fim de vida" como micro-badge sob a opção quando fizer sentido (detalhe de produto real).

### 4.3 Acessibilidade (WAI-ARIA radiogroup) — obrigatório
- Wrapper `role="radiogroup"` com `aria-label` (ex.: "Versão do PHP") ou `aria-labelledby` apontando pro título.
- **Um único tab-stop** no grupo (tab entra, tab sai). Navegação **por setas** ←/→ (e ↑/↓): move foco **e** seleciona a opção, com wrap (última→primeira). Espaço/Enter confirmam onde estiver.
- Foco entra na opção **selecionada**; se nenhuma, na primeira.
- `:focus-visible` com o anel roxo do §3.6.
- Estado nunca só por cor: selecionado tem fundo preenchido **e** `aria-checked` **e** contraste de texto ≥ 4.5:1.
- **Disabled** por opção (ex.: versão indisponível no nó): `aria-disabled`, pulada pela navegação por setas.

Fontes: [WAI-ARIA radiogroup (MDN)](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/radiogroup_role), [radio role (MDN)](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/radio_role), [Primer RadioGroup a11y](https://primer.style/product/components/radio-group/accessibility/).

---

## 5. Componentes-chave (o padrão certo)

### 5.1 Card de ambiente (na lista)
- Card branco, radius `14`, borda `1px`, padding `20–24`, hover eleva (sombra §3.3) e mostra cursor.
- **Topo:** ícone de runtime (chip circular com logo PHP/Node) + **nome/domínio** (16/600, roxo ou tinta) + badge de estado (§5.2). Menu `⋮` (Lucide `more-vertical`) no canto → ações.
- **Meta em linha:** plano · região (bandeira + texto) · runtime+versão · nó. Cada um com ícone Lucide 14px mudo.
- **Mini-métricas:** 3 barras finas CPU/RAM/Disco **ou** sparkline uPlot pequeno. Opcional na lista.
- **Rodapé:** botões de ação rápidos (Pausar/Iniciar, Abrir site `external-link`). O primário depende do estado (ver §5.7).
- **Hierarquia (anti-IA):** os cards **não** são todos idênticos — o ambiente selecionado/ativo tem acento; um pausado fica dessaturado. Evitar "grid de cards clones".

### 5.2 Badge de estado (com ícone SVG, não emoji)
Sempre **cor + ícone Lucide + texto** (WCAG: não depender de cor):
| Estado | Cor | Ícone Lucide | Texto |
|---|---|---|---|
| Ativo/rodando | verde `#16A34A` sobre `#EAF7EE` | `check-circle` (ou `circle` preenchido) | Ativo |
| Pausado | âmbar `#D97706` sobre `#FEF3E2` | `pause` / `pause-circle` | Pausado |
| Provisionando | roxo `#6D28D9` sobre `#F5F3FF` | `loader` (spin) | Criando… |
| Erro/parado | vermelho `#DC2626` sobre `#FDECEC` | `alert-triangle` | Erro |
| HTTPS ok | verde | `lock` | HTTPS |
| Runtime | neutro `#3F3F51` sobre `#F1F1F5` | `code` / logo | PHP 8.3 |
Pill radius `9999px`, `12–13px`, ícone `14px`, padding `4px 10px`, gap `6px`.

### 5.3 Grupo de botões segmentados
Ver §4. Usar em: plano, runtime, versão, região, período de compromisso, intervalo de gráfico.

### 5.4 Botões
- **Primário:** fundo `#6D28D9`, texto branco, radius `8`, padding `10px 18px`, peso `600`. Hover `#5B21B6`. Foco anel. Um por tela.
- **Criar/sucesso (verde, opcional):** `#16A34A` — só para "+ Criar ambiente" e confirmações positivas.
- **Secundário:** fundo branco, borda `1px #D9D9E3`, texto `#3F3F51`. Hover fundo `#F7F7FA`.
- **Fantasma/terciário:** sem borda, texto roxo; para ações inline (links de ação).
- **Perigo:** texto/borda vermelho no repouso; preenchido vermelho só no botão de confirmação final do modal de exclusão. **Exclusão sempre exige confirmação** (digitar nome ou modal com dupla ação).
- **Ícone-only:** botão circular/quadrado `36–40px`, `aria-label` obrigatório, tooltip no hover.
- Tamanho de alvo ≥ `44px` de área tocável no mobile (WCAG 2.5.8).

### 5.5 Formulário de criação sem `<select>`
- **Toda escolha finita** vira segmented (§4) ou cards-rádio. **Valores numéricos** (RAM, vCPU, limites) → **slider com marcas + valor** (padrão Hostoo PHP/RAM) ou stepper `- 2 GB +`.
- **Texto livre** (nome do ambiente, domínio) → input normal com validação inline e ajuda abaixo.
- **Booleanos** → **toggle** (switch) roxo, com label clicável.
- **Resumo lateral fixo** com preço recalculando ao vivo + CTA (ver §7 tela 3).
- Um passo por vez (stepper) quando há ≥4 decisões; senão, tudo numa página com seções.

### 5.6 Tabela (ex.: Nós, no admin; Bancos de dados)
- Cabeçalho `#F7F7FA`, texto `13/600` mudo, `sticky` no scroll. Linhas `48px`, borda inferior `1px #ECECF1`, hover `#FAFAFC`.
- Alinhamento: texto à esquerda, números/uso à direita. Estado em badge (§5.2), não texto cru.
- Ações por linha: menu `⋮` ou botões-ícone à direita. Coluna de ações com largura fixa.
- **Densidade real:** dados plausíveis (IP, região, RAM usada/total, uptime), não "Lorem". Isso mata a "cara de IA".
- Vazio → empty state (§5.9). Muitas linhas → paginação/`load more`, e busca no topo (como o Hostoo faz na lista de bancos).
- Responsivo: abaixo de `768px` a tabela vira **lista de cards** (uma linha = um card com pares label/valor).

### 5.7 Toolbar de ações do ambiente (detalhe)
Fileira de botões-ícone circulares (padrão Hostoo): **Pausar/Iniciar** (toggle contextual — mostra `play` se pausado, `pause` se ativo), **Deploy/Upload** (`upload`), **Editar** (`pencil`), **Migrar de nó** (`shuffle` — admin), **Excluir** (`trash-2`, vermelho). Cada um: `aria-label`, tooltip, confirmação nas destrutivas. O **botão primário contextual** (Iniciar quando pausado) pode ser destacado como botão pleno, não só ícone.

### 5.8 Métricas / gráficos
- **Cabeçalho:** CPU/RAM/Disco como **barras horizontais** com % (cores §3.5: CPU roxo/rosa, RAM azul, disco âmbar). Rápido de ler, "é OK?" (padrão single-status).
- **Gráficos de série temporal:** **uPlot** (decisão doc 05 §—: canvas, <50KB, aguenta ~35k pontos). Recharts **só** para billing (barras mensais, pizza de custo, ~30 pontos). Wrapper React `<TimeSeries/>`.
- Cada gráfico: título, seletor de intervalo **segmentado** (5min/1h/24h/30d — §4), legenda com cor+label, eixo com unidade. Tooltip on-hover. Faixa de "limite do plano" sombreada (o Hostoo faz).
- **Acessibilidade de gráfico:** `role="img"` + `aria-label` com o resumo ("CPU média 15% na última hora"); oferecer tabela de dados alternativa ou `<figcaption>`. Cor nunca é o único canal.

### 5.9 Empty states e "Em breve"
- **Lista vazia (sem ambientes):** ilustração/ícone Lucide grande esmaecido (`server`/`box`), título ("Você ainda não tem ambientes"), 1 linha de ajuda, **CTA primário "Criar ambiente"**. Nada de tela branca.
- **Feature futura (Domínios/Bancos/Financeiro/Suporte):** tela "Em breve" honesta — ícone da feature, título, parágrafo do que virá, badge "Em breve", opcional "Avise-me". Ver §2.1.
- **Erro/carregando:** skeletons durante load; estado de erro com ícone `alert-triangle`, mensagem clara e botão "Tentar de novo".

---

## 6. Conjunto de ícones — **Lucide** (recomendado)

### 6.1 Por que Lucide
- **Licença MIT** — uso comercial livre, sem atribuição ([Lucide guide](https://lucide.dev/guide/)).
- **Estilo linha/stroke uniforme** (1.5–2px, cantos suaves) — lê como "produto real", não como clipart. Neutro, alinhado a Vercel/Linear. Não tem o exagero arredondado que puxa pra "cara de IA".
- **1.500+ ícones**, cobre tudo que o painel precisa. Fork bem mantido do Feather.
- **Tree-shaking real:** importar `import { Server } from 'lucide-react'` inclui **só** aquele ícone no bundle; o resto é eliminado ([Lucide React](https://lucide.dev/guide/packages/lucide-react)).

Alternativas: **Phosphor** (mais variantes de peso, um pouco mais "fofo"), **Tabler** (bom, estilo parecido). Ambas MIT. **Ficar em uma só** — misturar famílias = inconsistência visível.

### 6.2 Como incluir sem "importar a lib inteira" (regra do doc 05, bundle)
Duas formas, ambas OK:
1. **`lucide-react` com import nomeado por ícone** — `import { Server, Database } from 'lucide-react'`. Com tree-shaking (Next.js + ESM) só os usados entram no bundle. **Evitar** `import * as Icons` (quebra o tree-shaking). Configurar `optimizePackageImports: ['lucide-react']` no `next.config` para garantir.
2. **Ícone SVG individual como componente próprio** (máximo controle, zero dependência): copiar o SVG do ícone de [lucide.dev](https://lucide.dev), colar num componente `.tsx`, trocar `stroke="currentColor"` (herda a cor do texto) e expor `size`/`className`. Recomendado para o punhado de ícones muito usados (nav, estados) — casa com a filosofia modular do projeto.
- Padrão comum: `stroke-width: 2`, `size: 20` (nav) / `16` (inline/meta) / `14` (badge). `color: currentColor` sempre — o ícone herda a cor do contexto (estado ativo roxo, badge verde, etc.).

### 6.3 Ícones exatos (mapa nome-Lucide → uso)
| Uso | Lucide |
|---|---|
| Ambientes / dashboard | `layout-dashboard` |
| Nó / servidor | `server` |
| Ambiente / container | `box` |
| Banco de dados | `database` |
| Domínios / DNS | `globe` |
| Financeiro / créditos | `credit-card`, `wallet`, `coins` |
| Suporte | `life-buoy` |
| Visão geral (admin) | `gauge` |
| Iniciar / Pausar | `play` / `pause` (`play-circle`/`pause-circle`) |
| Deploy / upload | `upload`, `rocket` |
| Editar | `pencil` |
| Migrar de nó | `shuffle`, `move` |
| Excluir | `trash-2` |
| Abrir site (externo) | `external-link` |
| Sucesso / ativo | `check-circle` |
| Aviso / erro | `alert-triangle` |
| Provisionando / loading | `loader`, `loader-2` (spin) |
| HTTPS / seguro | `lock` |
| Runtime / código | `code`, `terminal` |
| Arquivos | `folder`, `file` |
| Busca | `search` |
| Conta / usuário | `user`, `circle-user` |
| Notificações | `bell` |
| Menu de linha / ações | `more-vertical` |
| Menu mobile | `menu` |
| Adicionar | `plus` |
| Configurações | `settings` |
| CPU / RAM / Disco / Rede | `cpu`, `memory-stick`, `hard-drive`, `activity` |
| Região BR/US | bandeira via emoji-flag **de dado**, não como ícone de UI (ou SVG de bandeira dedicado) |

---

## 7. Três "telas de ouro" (para o implementador seguir)

### Tela 1 — Dashboard / Lista de ambientes (cliente)
- **Sidebar** (§1.1) com "Ambientes" ativo. **Topbar** com saldo + avatar.
- **Cabeçalho da página:** título "Ambientes" (28/700) + subtítulo curto. À direita, **botão primário "+ Criar ambiente"** (roxo, ou verde se adotar CTA verde).
- **Strip de KPIs (4 cards):** Ambientes ativos · Em pausa · Saldo/consumo do mês · Nó com mais carga (admin vê frota). Cada KPI: rótulo mudo, número grande (28/700), delta/spark opcional. **Cores/ícones distintos por card** (não clones).
- **Lista/grid de ambientes:** cards §5.1, 1–3 por linha (responsivo). Ordenáveis; busca no topo (como Hostoo). Estado por badge §5.2.
- **Vazio:** empty state §5.9 com CTA.
- **Anti-IA:** dados realistas (domínios, IPs, uso 13%/0%/1% como nas telas), hierarquia entre ativo e pausado, um único CTA primário.

### Tela 2 — Detalhe do ambiente
- **Cabeçalho do ambiente (card):** ícone de runtime + domínio + **toolbar de ícones** (§5.7) + **badges** (Ativo, HTTPS, PHP 8.3). À direita, **3 barras CPU/RAM/Disco** com %.
- **Navegação secundária (abas horizontais dentro da página):** `Resumo · Domínio · Arquivos · Banco de dados · Métricas · Configurações`. Indicador roxo sublinhado no ativo (padrão Hostoo). `role="tablist"`, setas navegam, `aria-selected`.
- **Sub-abas** onde fizer sentido (Configurações → Runtime/HTTPS/SSH/Cron/Logs), estilo "folder tab" segmentado.
- **Resumo:** cards "Dados do ambiente" (plano, preço/hora, região, criado em), "Endereços" (principal, alternativo, nó, IP), "Gráficos de consumo" (uPlot, com intervalo segmentado §5.8). Barra de acento roxa nos títulos.
- **Runtime (a tela-âncora do dono):** título "Versão do PHP/Node", parágrafo curto, **segmented control** de versões (§4) com a atual preenchida; abaixo, limites via **sliders** e booleanos via **toggles**; rodapé com "Restaurar padrões" (secundário) + "Salvar" (primário). Salvamento com feedback (toast + estado da barra).
- **Ações de estado:** Pausar/Iniciar com confirmação e feedback ("Ambiente pausado — cobrança suspensa").

### Tela 3 — Criar ambiente (funil sem `<select>`)
- **Stepper 1–5** no topo (Produto → Plano → Recursos → Checkout → Configuração): círculos ligados por linha, ativo roxo preenchido, concluído roxo com check, futuro cinza. `aria-current` no passo atual.
- **Passo Produto/Runtime:** cards-rádio ou segmented (PHP / Node / …). Cada card com ícone + 1 linha de benefício.
- **Passo Plano:** **slider de RAM com marcas** (512 MB … 4 GB — catálogo do ADENDO 3H) + specs derivadas (RAM/vCPU/disco) + **região por cards-rádio** (Brasil / EUA, com bandeira e trade-off de latência, como o Hostoo).
- **Passo Recursos:** add-ons como **cards com checkbox** (Backup diário, etc.), preço à direita.
- **Resumo fixo à direita** (sticky): plano, região, **preço recalculando ao vivo** (mensal + por hora, coerente com o modelo pré-pago do briefing), CTA "Continuar" (primário) fixo.
- **Checkout:** saldo atual vs custo, opção de compromisso pré-pago (segmented: 1m/6m/12m/24m/36m com % OFF — briefing §43). **Nunca** pedir dados de cartão dentro deste fluxo pela IA (regra de segurança); o pagamento é módulo à parte.
- **Anti-IA:** copy objetiva em PT-BR, sem "🚀 Turbine seu projeto!"; microcópia de ajuda real; validação inline.

---

## 8. Checklist "Como NÃO parecer feito por IA"

Baseado nas referências (Hostoo depurado + disciplina Linear/Vercel/Stripe):
- [ ] **Sem gradiente roxo→rosa/azul genérico.** Fundos são branco/cinza; roxo é pontual e chapado. Se houver gradiente, 1 elemento só, monocromático e sutil.
- [ ] **Sem emojis como ícone de UI** (✓ ⏸ ⚠ 🗑 🚀). Só Lucide SVG. Emoji só como *dado* (bandeira de país).
- [ ] **Cards com hierarquia**, não um grid de clones idênticos. Tamanhos/ênfases variam por importância; item ativo tem acento; pausado é dessaturado.
- [ ] **Espaçamento com ritmo** (§3.1), não o mesmo `16px` em tudo. Respiro maior entre grupos, menor dentro do grupo.
- [ ] **Um único CTA primário por tela.** Não encher a tela de botões coloridos concorrendo.
- [ ] **Dados realistas** (domínios, IPs, `200.9.22.2`, uso `13%`, `9 MB`, versões `8.0.46`), nunca "Lorem ipsum" ou "Exemplo 1/2/3".
- [ ] **Sombras leves / bordas 1px**, não sombras difusas fortes nem `box-shadow` roxo brilhante.
- [ ] **Cantos consistentes** (2 raios por tela no máximo). Nada de misturar 4/8/16 aleatório.
- [ ] **Tipografia sóbria** (Inter, pesos 400–700), sem fontes display arredondadas nem 3 famílias.
- [ ] **Microcópia de produto**, PT-BR direto, sem exclamação de marketing IA ("Turbine!", "Incrível!").
- [ ] **Estados completos** (hover/active/focus/disabled/loading/empty/erro) — produto real trata todos; template de IA só trata o "feliz".
- [ ] **Ícones alinhados a um só sistema** (Lucide), mesmo peso de traço, mesmo tamanho por contexto.
- [ ] **Alinhamento em grid**: números à direita, labels à esquerda, baseline coerente. Desalinho sutil denuncia geração automática.
- [ ] **Detalhes de produto real:** breadcrumb, `⌘K`, tooltips, confirmação de exclusão, "última atualização há X", badge de versão LTS/EOL no runtime.

Fontes: [Vercel design tokens](https://oh-my-design.kr/design-systems/vercel), [SaaS dashboard patterns 2026](https://www.925studios.co/blog/saas-dashboard-design-examples-2026), [Dashboard patterns](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/).

---

## 9. Índice de fontes
- Hostoo (referência visual primária): `Plan/hostoo/*.png` — 36 telas.
- Hostinger hPanel: [usar o painel](https://www.hostinger.com/support/6627955-how-to-use-the-hosting-dashboard-in-hostinger/) · [overview do hPanel](https://www.hostinger.com/support/1583483-comprehensive-guide-to-hpanel-at-hostinger/) · [guia hPanel 2026](https://arwriterai.com/en/blog/hpanel-hostinger-control-panel-guide-2026/)
- Ploi: [ploi.io](https://ploi.io/) · RunCloud: [review 2026](https://makerstack.co/reviews/runcloud-review/) · [Ploi vs RunCloud](https://toolradar.com/compare/ploi-vs-runcloud)
- Padrões de dashboard SaaS: [925studios 2026](https://www.925studios.co/blog/saas-dashboard-design-examples-2026) · [artofstyleframe](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/) · [Vercel tokens](https://oh-my-design.kr/design-systems/vercel)
- Lucide: [guide](https://lucide.dev/guide/) · [React/tree-shaking](https://lucide.dev/guide/packages/lucide-react) · [pacote de ícones](https://lucide.dev/guide/packages/icons)
- Segmented / radiogroup a11y: [MDN radiogroup](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/radiogroup_role) · [MDN radio](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/radio_role) · [Primer RadioGroup](https://primer.style/product/components/radio-group/accessibility/)
</content>
</invoke>
