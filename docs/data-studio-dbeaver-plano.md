# Plano técnico — Data Studio nativo (estilo DBeaver)

Plano de arquitetura e desenvolvimento para transformar o **Data Studio (jstudio)** atual — um executor de SQL — num **IDE de banco no navegador** (estilo DBeaver / TablePlus / Beekeeper): navegador de schema, grade **editável** (editar célula e salvar sem escrever SQL), **criar tabela/trigger/índice** por interface. Escopo: **mysql, mariadb, postgres** (mongo/redis mantêm os consoles atuais).

> Complementa o [brief de design](data-studio-redesign-brief.md) (que trata da UX/visual). Este documento é o **como construir**.

---

## 1. Descoberta-chave (o que baixa o risco)

**O backend já faz o trabalho pesado.** O executor de SQL do Studio (`/studio/exec` → `agent.dbExec` → `runDbConsole` → `parseExec`) roda **qualquer** comando (SELECT/INSERT/UPDATE/**DDL**) e devolve `{ columns, rows }` binário-safe, com:
- **Modo escrita** protegido (`write:boolean`) + transação **READ ONLY** imposta pelo engine (dupla barreira);
- timeout (25s statement / 35s exec / 40s HTTP), **lock por ambiente** (1 query concorrente), cap de 12 MiB, **auditoria** só de metadados;
- gate de segurança (dono/admin, Studio ligado, senha opcional, ambiente running).

**Consequência:** o "DBeaver nativo" é **~90% frontend**. Não precisa mexer em infra, isolamento nem no motor de execução. O que falta é: (a) um pouco de **introspecção de schema**, (b) **toda a UI nova** (navegador, grade editável, forms de DDL), (c) **geração de SQL** a partir da grade/forms.

Arquivos-âncora do que já existe: `apps/api/src/routes/db-console.ts` (rotas + gate), `apps/api/src/agent.ts:420` (`dbExec`), `apps/agent/src/docker.ts:1200-1297` (`execDb`/`runDbConsole`), `packages/db-console/src/{build,parse,classify}.ts` (motor por engine, reusável em api+agente), `packages/contracts/src/dbConsole.ts` (shapes), `apps/painel/src/app/(app)/env/[id]/studio/page.tsx` (UI atual).

---

## 2. Arquitetura proposta

```
painel (React)
  ├─ Navegador de schema (árvore)         ─┐
  ├─ Abas: Dados (grade) / Estrutura / SQL ├─▶ api  ─▶ agente ─▶ docker exec (mysql/psql)
  └─ Modais: Nova tabela / trigger / índice─┘         (motor já existe: packages/db-console)
```

Três decisões de arquitetura:

1. **Introspecção via endpoints dedicados** (não parsear SQL na tela):
   - `GET /environments/:id/studio/schema` → `{ tables: [{name, type: "table"|"view", rows?}], }`.
   - `GET /environments/:id/studio/table/:name` → `{ columns, primaryKey, indexes, foreignKeys, triggers, createSql }`.
   - A SQL por engine (mysql/maria/postgres) vive num **módulo novo em `packages/db-console`** (`introspect.ts`), reusando o executor. Um lugar só para as diferenças de engine. O frontend recebe **metadados prontos**, tipados.

2. **Grade:** `@tanstack/react-table` (headless — só a lógica de tabela) + células/estilo próprios em **Tailwind** (a cara do Jamees). Robusta e editável, sem impor visual de terceiro. Virtualização com `@tanstack/react-virtual` quando precisar (resultados grandes).

3. **Editor SQL (aba SQL):** **CodeMirror 6** (leve, modular) com linguagem SQL (highlight, números de linha, autocomplete de tabelas/colunas). Fase de polimento — o textarea atual segura até lá.

O restante (gate, lock, auditoria, modo escrita, `DbResult`) é **reusado sem alteração**.

---

## 3. Backend — o que existe e o que criar

### Reusa como está
- Executor genérico `studioExec` — serve para introspecção, dados paginados, UPDATE/INSERT/DELETE e DDL. Basta montar o SQL (server-side) e mandar com `write` correto.
- `DbResult` (`{ kind:"rows", columns, rows, truncated }` e `{ kind:"command", affectedRows }`).
- Todo o gate/segurança de `db-console.ts`.

### Criar
1. **Módulo de introspecção** `packages/db-console/src/introspect.ts` — funções por engine que **retornam SQL** (executado pelo mesmo motor) e **parsers** para metadados. Exemplos:

   **Listar tabelas/views**
   - postgres: `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name`
   - mysql/maria: `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`

   **Colunas**
   - `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, ordinal_position FROM information_schema.columns WHERE table_schema = <schema> AND table_name = <t> ORDER BY ordinal_position`

   **Primary key** (para gerar `UPDATE ... WHERE`)
   - postgres: via `pg_index`/`pg_attribute` (ou `information_schema.table_constraints` + `key_column_usage` com `constraint_type='PRIMARY KEY'`).
   - mysql/maria: `information_schema.statistics WHERE index_name='PRIMARY'` (ou `SHOW KEYS ... WHERE Key_name='PRIMARY'`).

   **Índices / FKs / Triggers**
   - índices: pg `pg_indexes` · mysql `SHOW INDEX FROM <t>`.
   - FKs: `information_schema.referential_constraints` + `key_column_usage`.
   - triggers: `information_schema.triggers WHERE event_object_table = <t>`.

   **DDL da tabela**: mysql `SHOW CREATE TABLE <t>`; postgres não tem nativo — reconstruir a partir dos metadados (ou `pg_get_...` functions).

   > Todos os identificadores (schema/tabela) são **fixos por introspecção** (não vêm crus do usuário) e vão como **literais** nas queries de metadados — sem injeção.

2. **Rotas novas** em `db-console.ts` (mesmo gate do exec):
   - `GET .../studio/schema` e `GET .../studio/table/:name` (introspecção).
   - Opcional `POST .../studio/table/:name/rows` (dados paginados + `COUNT(*)`), mas dá pra fazer com o exec genérico direto.

3. **Contratos novos** em `packages/contracts/src/dbConsole.ts`:
   ```ts
   dbColumn   = { name, type, nullable:boolean, default:string|null, isPrimaryKey:boolean, maxLength?:number }
   dbIndex    = { name, columns:string[], unique:boolean }
   dbForeignKey = { name, columns:string[], refTable, refColumns:string[] }
   dbTrigger  = { name, timing:"BEFORE"|"AFTER", event:"INSERT"|"UPDATE"|"DELETE", statement:string }
   dbSchema   = { tables: { name, type:"table"|"view" }[] }
   dbTableMeta= { name, columns:dbColumn[], primaryKey:string[], indexes:dbIndex[], foreignKeys:dbForeignKey[], triggers:dbTrigger[], createSql?:string }
   ```

4. **Geração de SQL (server-side, por engine)** — helpers em `db-console` que montam, com quoting correto por engine (`` `x` `` no mysql, `"x"` no postgres) e valores parametrizados/escapados:
   - `UPDATE <t> SET <col>=<val> WHERE <pk>=<val>` (a partir da célula editada + PK).
   - `INSERT INTO <t> (...) VALUES (...)`.
   - `DELETE FROM <t> WHERE <pk>=<val>`.
   - `CREATE TABLE` / `CREATE TRIGGER` / `CREATE INDEX` / `ALTER TABLE` a partir dos forms.
   - Enviados com `write:true` (o modo escrita + confirmação já existem).

---

## 4. Frontend — componentes a construir

- **SchemaTree** — navegador (árvore banco → tabelas/views → colunas/índices/triggers/FKs), com busca, ícones (lucide), ações de contexto (abrir dados, estrutura, nova tabela, dropar).
- **TableTabs** — sistema de abas (uma por tabela/consulta aberta), com abas internas **Dados / Estrutura / SQL**.
- **DataGrid** (o coração) — `@tanstack/react-table`:
  - editar célula inline (editor por tipo: texto/número/data/boolean/**NULL**);
  - **dirty tracking** (destaque + barra "Salvar (N) / Descartar") → gera `UPDATE ... WHERE pk`;
  - inserir/excluir linha (confirmação);
  - paginação (LIMIT/OFFSET + `COUNT(*)`), ordenação, redimensionar/reordenar/fixar coluna;
  - indicadores PK/NULL/FK/tipo; valores binários/longos com "ver mais".
- **StructurePanel** — colunas/índices/triggers com editar/adicionar/remover.
- **CreateTableModal / CreateTriggerModal / CreateIndexModal** — forms que geram DDL por engine (com preview do SQL).
- **SqlEditor** (fase 4) — CodeMirror + toggle modo escrita + histórico.
- **Estados** — desligado / parado / bloqueado / carregando / vazio / erro / truncado / alterações pendentes.

Reusar `@/components/ui/*` (card, button, dialog, badge, input, toast), tokens do design system (ver brief §7), react-query para dados.

---

## 5. Fluxos-chave

**Editar célula e salvar (o "sem ir no código")**
1. Abre a tabela → `GET /studio/table/:name` traz colunas + **PK**.
2. Grade carrega dados (`SELECT * ... LIMIT/OFFSET`).
3. Usuário edita células → viram "dirty".
4. "Salvar" → para cada linha alterada, monta `UPDATE <t> SET <cols> WHERE <pk>=<val>` (server-side, quoting por engine) e executa com `write:true`. Sem PK → aviso ("tabela sem PK, edição por linha inteira ou bloqueada").
5. Sucesso → limpa dirty; erro → mantém e mostra a mensagem do engine.

**Criar tabela**
1. Modal com linhas de coluna (nome/tipo/tamanho/nulável/default/auto-inc/PK) + índices/FKs.
2. Gera `CREATE TABLE` por engine (preview) → executa com `write:true`.
3. Atualiza o navegador.

---

## 6. Fases (cada uma entregável)

1. **Navegador + grade (leitura):** introspecção (schema/colunas/PK) + `SchemaTree` + `DataGrid` paginada/ordenável. Já é um "mini-DBeaver" navegável.
2. **Grade editável:** editar célula/inserir/excluir + salvar (UPDATE/INSERT/DELETE por PK). ← **o coração do pedido**.
3. **Criar:** modais Nova tabela / trigger / índice + `StructurePanel` (alter table).
4. **Polimento AAAA:** CodeMirror, navegação por teclado na grade, micro-interações, virtualização, erros claros.

---

## 7. Segurança (reusa o que já existe — nada novo)

- Mesmo gate do exec: dono/admin, Studio ligado, senha opcional, ambiente running.
- **Modo escrita** obrigatório para UPDATE/INSERT/DELETE/DDL (a grade liga automaticamente ao salvar, com confirmação clara).
- Read-only imposto pela transação do engine no path de leitura.
- Lock por ambiente (1 query concorrente) + timeouts + cap de bytes.
- Identificadores de schema vêm da **introspecção** (não do input cru); valores escapados por engine. SQL vai por env var (sem injeção de shell). Auditoria só de metadados.

---

## 8. Diferenças por engine (o que multiplica o trabalho)

| Tema | mysql/mariadb | postgres |
|---|---|---|
| Quoting de identificador | `` `nome` `` | `"nome"` |
| Metadados | `information_schema` + `SHOW ...` | `information_schema` + `pg_catalog` |
| DDL da tabela | `SHOW CREATE TABLE` | reconstruir dos metadados / `pg_get_*` |
| Tipos | `INT/VARCHAR/DATETIME/...` | `integer/varchar/timestamptz/...` |
| Auto-increment | `AUTO_INCREMENT` | `SERIAL`/`GENERATED ... AS IDENTITY` |
| Schema atual | `DATABASE()` | `current_schema()` |

O módulo `introspect.ts`/geração de DDL encapsula isso por engine (uma função por operação, `switch` por engine).

---

## 9. Complexidade e riscos

- **Complexidade geral: ALTA (~7–8/10)** para a versão polida (AAAA) — é essencialmente um phpMyAdmin/Adminer com a cara do Jamees. Mas **faseável** e **quase toda frontend** (backend praticamente pronto).
- **Riscos principais:**
  - Geração de `UPDATE ... WHERE` **depende de PK**; tabelas sem PK precisam de estratégia (bloquear edição de célula, ou WHERE por linha inteira — arriscado). Definir no design.
  - Diferenças de engine no DDL (tipos, auto-inc) — testar bem com os 3.
  - Tipos "difíceis" na grade (JSON, blob, datas com timezone, enums) — editores específicos.
  - Performance com resultados grandes — paginação + virtualização.
  - Manter o modelo de segurança (não abrir brecha ao gerar SQL a partir de input).
- **Baixo risco:** infra, isolamento e execução (já resolvidos e testados).

---

## 10. Dependências novas (frontend)

- `@tanstack/react-table` (headless grid) — provável `@tanstack/react-virtual` na fase de performance.
- `codemirror` 6 (`@codemirror/lang-sql`, `@codemirror/state`, `@codemirror/view`) — fase 4.
- Nenhuma dependência de backend nova (o executor e o `db-console` já dão conta).

---

## 11. Resumo executivo

- Backend: **pronto** (executor genérico) + **pequeno** módulo de introspecção e geração de DDL por engine em `packages/db-console`, e 2 rotas de metadados.
- Frontend: **o grosso** — navegador de schema, grade editável (@tanstack/react-table), forms de DDL, editor SQL (CodeMirror).
- Segurança: **reusa** o gate/lock/auditoria/modo-escrita existentes.
- Entrega **por fases**; a Fase 2 já resolve "editar e salvar sem código".
- Só **mysql/mariadb/postgres**; mongo/redis ficam com os consoles atuais.
