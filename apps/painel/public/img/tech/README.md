# Ícones de tecnologia (app-icons)

Ícones das linguagens/serviços mostrados na tela **Criar ambiente** e nos cards
de ambiente (`EnvTechIcon` / `TechIconById` em
`apps/painel/src/components/TechIcon.tsx`).

## Especificação do estilo

- **Formato:** PNG **512×512**, RGBA, fundo **transparente** fora do tile.
- **Tile:** quadrado de cantos bem arredondados (raio ~110px), preenchido com a
  **cor sólida da marca `#634ca8`** (roxo, chapado — sem gradiente forte).
- **Glifo:** **branco `#ffffff`**, limpo, minimalista, centralizado, ocupando
  ~55–60% do tile. Plano e nítido, legível a 34px. Sem texto, sem sombra pesada.
- Referência: copie o estilo de `node.png` e `php.png` (já no padrão certo).

## Como o ícone é escolhido em runtime

O arquivo tem que se chamar **`<id>.png`**, onde `<id>` é:

- o **runtimeKind** do ambiente de código (`node`, `php`, `python`, `static`), ou
- o **id do env_type** para serviços (`redis`, `mysql`, `mariadb`, `postgres`,
  `rabbitmq`, `n8n`, `wordpress`).

Além do PNG, **registre a chave** no mapa `TITLES` de
`apps/painel/src/components/TechIcon.tsx` (ex.: `python: "Python"`). Se a chave
não estiver em `TITLES`, o componente cai no **fallback** (tile roxo genérico) —
funciona, mas não é o ícone real.

## Como gerar um ícone novo (agy + nano-banana)

Usamos o CLI do **Antigravity** (`agy`), que gera imagem com o **nano banana 2**
(modelo de imagem do Gemini). Rode a partir da raiz do repositório:

```bash
agy --dangerously-skip-permissions --print-timeout 18m -p "$(cat scripts/icon-prompt.txt)"
```

> Nunca encerre os processos do **Antigravity IDE** — só o CLI `agy`.

### Processo (loop de 4 + escolha do especialista)

1. Peça ao `agy` para gerar **4 variações** de cada ícone e salvar TODAS em
   `apps/painel/public/img/tech/_candidates/` (ex.: `python-1.png … python-4.png`).
2. **Revise as 4** (abra as imagens) e escolha a mais limpa/legível em tamanho
   pequeno — o "especialista" (uma pessoa ou um subagente) decide.
3. Copie a escolhida para o nome final:
   ```bash
   cp apps/painel/public/img/tech/_candidates/python-3.png \
      apps/painel/public/img/tech/python.png
   ```
4. Adicione a chave em `TITLES` (`TechIcon.tsx`) se ainda não existir.
5. Apague a pasta `_candidates/` (ou deixe fora do commit).

### Modelo de prompt (`scripts/icon-prompt.txt`)

Cole e ajuste os itens 1) e 2) para a tecnologia desejada:

```
Você vai gerar ícones "app-icon" para um painel de hospedagem (marca Jamees).

ESTILO OBRIGATÓRIO — idêntico ao conjunto que já existe. ABRA e olhe
apps/painel/public/img/tech/node.png e php.png para copiar o estilo.
- PNG 512x512, RGBA, fundo TRANSPARENTE fora do tile.
- Tile quadrado de cantos bem arredondados (raio ~110px) preenchido com a cor
  sólida roxa da marca #634ca8 (chapado).
- Glifo BRANCO (#ffffff) limpo, minimalista, centralizado, ~55-60% do tile,
  legível a 34px. Sem texto, sem sombra pesada.

TAREFA — com geração de imagem (nano banana / Gemini image), gere 4 variações de
CADA ícone abaixo (salve TODAS em apps/painel/public/img/tech/_candidates/ como
<nome>-1.png ... <nome>-4.png):
1) "python": glifo branco do símbolo do Python (as duas cobras entrelaçadas).
2) "static": glifo branco de site estático / HTML (</> , globo, ou navegador).

Não altere mais nada no repositório. Ao terminar, liste os arquivos criados.
```
