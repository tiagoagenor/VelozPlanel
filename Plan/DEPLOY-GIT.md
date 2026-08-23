# VelozPanel — Módulo de Deploy (Git/SSH) — DOCUMENTO DE PLANO

*Para aprovação do dono antes do desenvolvimento. As decisões de arquitetura já foram validadas contra o código-fonte.*

---

## 1) Resumo

Vamos construir um módulo de **deploy contínuo por Git** dentro de cada ambiente do painel. O cliente conecta seu repositório (GitHub, público ou privado), o painel gera uma **deploy key só-leitura**, e a publicação passa a ser feita com um clique — clonando o código, instalando dependências, buildando e reiniciando o app. Suporta também um modo **Manual/Local** para quem sobe arquivos por SFTP sem Git. Tem execução **sob demanda** ("Fazer deploy agora") e **automática** por intervalo (mínimo 5 min), com histórico, log redigido e rollback para a última versão que funcionou. A entrega é fatiada em 3 PRs independentes; este documento pede o "OK" em 5 decisões de infraestrutura.

---

## 2) Fluxo do usuário (passo a passo)

### Tela inicial — duas portas auto-explicativas
- **"Conectar um repositório Git"** — *GitHub, público ou privado (recomendado)*.
- **"Não uso Git / subo meu código de outro jeito"** — *Subo por SFTP/Arquivos* → modo **Local** (sem git, sem automático, steps rodam contra o que já está no ambiente).

Um **stepper** acompanha todo o processo: **1 Conectar · 2 Adicionar chave · 3 Primeiro deploy · 4 Automático (opcional)**.

### Fluxo simples (repositório público)
1. Cola a URL + branch.
2. O painel **sonda** o repositório e detecta que é público — nenhuma chave necessária.
3. Detecta o tipo de projeto (PHP/Node) e monta os passos automaticamente.
4. Clica em **"Fazer deploy agora"** → acompanha o progresso passo a passo → site no ar.

### Fluxo com deploy key (repositório privado)
1. Cola a URL + branch → a sondagem detecta "privado" (Permission denied).
2. O painel **gera o par de chaves** e mostra a **chave pública** com botão "Copiar".
3. Tela de apoio visual: uma **ilustração anotada** da página "Add deploy key" do GitHub, com 3 marcações — *Title* (sugere "VelozPanel"), *Key* (onde colar), *Allow write access* (**deixar desmarcado** — o deploy só precisa ler). Um **link abre o GitHub em nova aba** já na página certa.
4. O cliente cola a chave no GitHub. **Ao voltar, já vê "Conectado ✓"** — o painel testa a conexão sozinho em segundo plano. Existe também o botão "Já colei → Testar conexão" para o impaciente.
5. Detecção de passos → **primeiro deploy** → site no ar.

### Definir os passos (steps)
- **Simples:** um checklist com rótulos humanos ("Instalar dependências", "Buildar", "Reiniciar") já pré-marcado pela detecção. Permite adicionar **um comando extra** sem sair do modo simples.
- **Avançado:** lista reordenável, ligar/desligar cada passo, comandos livres e pasta de trabalho (`cwd`). Trocar de modo **nunca apaga** nada.

### Ligar o deploy automático
- Toggle liberado **só depois** de conexão verificada + 1 deploy manual verde.
- Escolhe o intervalo (presets: 5/10/15/30/60 min…, mínimo 5).
- Copy honesta: *"Não é instantâneo — verificamos a cada X min. Precisa agora? Use Fazer deploy agora."* O card mostra "próxima verificação em ~N min" e "última verificação: há 3 min — sem novidades".

---

## 3) Modelo de dados

Tabelas em `schema.ts` + `CREATE/ALTER … IF NOT EXISTS` no `push-and-seed.ts`, com `ON DELETE CASCADE` no `env_id`.

**`deploy_configs`** (PK `env_id`) — a configuração do ambiente:
| Coluna | Tipo / default | Nota |
|---|---|---|
| `connection_mode` | text `'none'` | `ssh` \| `public` \| `local` |
| `is_private` | bool null | |
| `provider` | text `'github'` | `github`\|`gitlab`\|`bitbucket`\|`generic` |
| `repo_url` | text null | null válido em `local` |
| `branch` | text `'main'` | |
| `mode` | text `'simple'` | densidade da UI |
| `public_key` / `fingerprint` | text null | só a pública; a privada mora no volume |
| `connection_verified_at` | timestamptz null | último `ls-remote` SSH OK |
| `needs_reconnect` | bool false | |
| `host_key_state` | text `'ok'` | |
| `auto_enabled` | bool false | |
| `interval_minutes` | int `5` | mínimo 5 |
| `auto_engine` | text `'agent'` | reservado, UI não expõe |
| `next_check_at` / `last_remote_sha` / `last_check_at` | | agendamento automático |
| `last_good_sha` | text null | exibição; âncora real = tag `veloz/last-good` |
| `last_run_id` / `last_run_status` / `last_run_at` | | denormalização de status |

**`deploy_steps`** (fonte única, ordenada):
`id` · `env_id` · `ord` (`UNIQUE(env_id, ord)`) · `enabled` · `kind` (`git_sync`\|`composer_install`\|`npm_ci`\|`npm_build`\|`php_migrate`\|`node_restart`\|`shell`) · `command` (livre só em `shell`) · `label` · `cwd` (validado, sem `..`) · `mutates_data`.

**`deploy_runs`** (histórico):
`id` · `env_id` · `trigger` (`manual`\|`auto`) · `status` (`running`\|`success`\|`failed`\|`interrupted`) · `exit_code` · `failed_step_kind` · `commit_sha/message/author` · `steps_snapshot` (jsonb) · `log` (redigido, ~64 KB) · `log_full_in_container` · `heartbeat_at` · `started_at` · `finished_at`. Índice `(env_id, started_at DESC)`.

Contratos correspondentes em `packages/contracts`.

---

## 4) API + Agente + Painel

### API — `apps/api/src/routes/deploy.ts` (protegido por `loadEnvironmentForUser`)
`GET /deploy` · `PUT /connection` · `POST /probe` · `POST /key/generate` · `POST /key/test` · `POST /steps/detect` · `PUT /steps` · `POST /run` (409 se já rodando) · `POST /rollback` · `GET /runs` · `GET /runs/:id` · `GET /runs/:id/log?tail=` · `PUT /auto`.
Admin: `POST /recreate-for-deploy`.

### Agente — `apps/agent/src/deploy.ts` (operações via `docker exec`)
`provisionDeployKey`, `ensureDeployKey`, `probeRepo`, `testGit`, `checkRemote`, `detectStack`, `materializeDeployScript`, **`runBuildContainer`** (build em container efêmero irmão), **`runDeploy`** (setsid+flock), `readDeployLog`, `hasRollbackPoint`, `rollback`, `removeDeployScript`, `deployStatus`, `rehostKnownHosts`, `reconcileOrphans`. Toda operação git usa `timeout` do coreutils. Wrappers em `apps/api/src/agent.ts`.

> **Nota técnica travada:** a keygen reusa `ssh2.generateKeyPairSync("ed25519")` (padrão já existente no código, `ssh.ts:357`/`64`) — não inventamos `ssh-keygen`. O binário `ssh` (via `openssh-client`) continua obrigatório porque o **git** precisa dele.

### Painel — `apps/painel/.../env/[id]/deploy/page.tsx` (+ nav no `layout.tsx`)
Hero de duas portas + stepper; SVG anotado do GitHub; auto-poll de retorno; diagnóstico-primeiro na falha; fingerprint em "detalhes técnicos"; histórico com rollback em linguagem leiga; banners cross-módulo em Arquivos/SFTP avisando que arquivos versionados são sobrescritos (uploads e `.env` **não**).

---

## 5) Execução sob demanda vs. Automática

### Sob demanda — monta o script na hora
1. **Lock** (`flock`) — se já há deploy rodando → **409** com copy amigável.
2. Monta o script dos passos ligados: `#!/usr/bin/env bash` + `set -o pipefail` (**sem** `set -e`), marcadores `::vp:step:<kind>:start|exit:$rc` por passo, `VP_EXIT=$?` no fim. Nunca `set -x`.
3. `git_sync` faz **staging + swap atômico** (ver §7) contra o workdir fixo (`/var/www` PHP, `/app` Node). Sem mudança de commit → pula sem virar run.
4. Executado **destacado** (`setsid`+`flock` no fd 9), com heartbeat. A API retorna na hora; o painel faz poll do log com progresso por passo.
5. **Fecho do run:** redige o log, grava `exit_code`/`commit_*`; e **só se tudo saiu verde** avança a tag `veloz/last-good` e o `last_good_sha`.

### Automática — cron + arquivo materializado
- `materializeDeployScript` grava **`/veloz/deploy.sh`** no volume do container; o gate `[ -f /veloz/deploy.sh ]` significa literalmente "se não estiver montado, não roda". **Re-materializa ao salvar os passos**, com feedback.
- Um scheduler (ver Decisão nº 2) faz um **tick a cada ~60s**, seleciona os ambientes vencidos (`next_check_at`), e para cada um faz um `git ls-remote` de uma ref só. SHA diferente → dispara o **mesmo runner** rodando `bash /veloz/deploy.sh`.
- Intervalo mínimo **5 min**, com **jitter** para a frota não sincronizar no mesmo minuto, e um teto de concorrência (pool de ~10, nunca o loop sequencial do coletor de métricas).

---

## 6) Abstração de provedor

`apps/api/src/deploy-providers.ts` define, por provedor: `sshHost` (ex.: `ssh.github.com:443`), `knownHostsEd25519`, `buildSshUrl`, `newDeployKeyUrl`, `mapGitError` (com dica de admin e detecção de host-key trocada), `testCommand`, `labels`.
**Só `github` ativo agora**; GitLab/Bitbucket ficam com o `switch` lançando "provedor ainda não suportado" — a estrutura já está pronta para ligá-los sem reescrever o núcleo. O `known_hosts` é atualizável sem rebuild.

---

## 7) Segurança

- **Deploy key só-leitura:** a UI instrui explicitamente a deixar *"Allow write access"* desmarcado, com o porquê. O deploy nunca escreve no repositório do cliente.
- **Chave privada:** gerada no control-plane e entregue ao container via `exec` sobre WireGuard (`no-store`, redigida no log), pousando em `/veloz/ssh/id_ed25519` com `chmod 600` e pasta `0700`. É o **mesmo padrão** que o SFTP/SSH já usa hoje — não é regressão.
- **Defesa contra injeção (travada de versões anteriores):** `--end-of-options` / `--` em todo git, `protocol.ext.allow=never`, aspas simples, regex ancorado nas duas bordas, `zod.safeParse` na borda do agente. O `shell` do usuário **nunca** é interpolado no script pai — vai por arquivo/env e roda em subshell isolado, para que um `exit`/aspa não vaze para o orquestrador nem para o `flock`.
- **Nada destrutivo antes de confirmar (bug C2 corrigido):** o `git_sync` clona para um **staging** (`/veloz/checkout-new`), valida que veio conteúdo, e **só então** troca o conteúdo servido com `rsync --delete` preservando `.env` e uploads (untracked). Se o clone falhar, o site **não é tocado** — o primeiro deploy que falha não quebra nada.
- **Rollback honesto (bug C1 corrigido):** a tag `veloz/last-good` só avança no **fecho verde do run inteiro** (depois de build/migrate passarem), nunca dentro do `git_sync`. Assim o rollback nunca aponta para um commit quebrado. O rollback verifica se o ponto existe **no container**, não só no banco.
- **Cron isolado:** sem `crond` instalado; o gate `[ -f /veloz/deploy.sh ]` isola quem roda. O build roda em **container efêmero irmão** com RAM própria — não compete pelo cgroup de 512 MB do site (evita 502 durante o build).
- **Segredos / `.env`:** o `.env` é preservado no swap e sinalizado como "requer `.env` presente" para migrate/build; `deploy_env` cifrado fica como follow-up explícito.
- **`git ls-remote`/`git` pendurados:** `GIT_TERMINAL_PROMPT=0`, `BatchMode=yes`, `timeout` do coreutils no processo — nunca travam o agente.

---

## 8) O que fica para DEPOIS (fora do MVP)

- **Webhook para deploy instantâneo** (enum já reservado; hoje é polling por intervalo).
- **GitLab / Bitbucket** ativos (abstração pronta, provedores desligados).
- **`deploy_env` cifrado** gerido pelo painel (hoje o `.env` é responsabilidade do cliente, via Arquivos/SFTP).
- **Rollback do Node com atomicidade garantida** (no MVP é best-effort declarado).
- **Rollback multi-passo / múltiplos pontos de restauração** (MVP guarda só o "last-good").
- **Quota de volume universal** caso a infra não suporte de imediato (ver Decisão nº 5).

---

## 9) DECISÕES ABERTAS PARA O DONO

> Cinco pontos com trade-off real. Cada um traz a recomendação do time.

**1. Fatia 1 — acoplar volume persistente + base nova com `openssh-client` no mesmo PR?**
Adicionar o binário `ssh` às imagens-base **obriga rebuild**, que força **recriar todo ambiente** — e recriar sem volume apaga o site. Por isso os dois entram juntos, com onda de recriação **em lote, container parado, fail-closed** (se a cópia falhar, aborta e não remove o antigo) + botão admin *"Recriar para habilitar deploy"*.
→ **Recomendação:** aprovar o acoplamento. O motivo é o **rebuild**, não a chave (o modo manual até funcionaria sem volume) — mas o rebuild é inevitável e o volume é a rede de segurança dele.

**2. Gatilho do deploy automático — scheduler no agente (por nó) vs. central na API?**
Central: se WireGuard/API cair, **a frota inteira** para de deployar, em silêncio. No agente: cada nó agenda a si mesmo, sobrevive à queda do link (só o registro no Postgres atrasa); se o agente do nó cair, só aquele nó pausa. O `crond` dentro do container fica cortado nos dois casos.
→ **Recomendação: scheduler no agente, por nó.** Honra melhor a intenção original ("cron dentro do container" nasceu do desejo de resiliência local) sem instalar `crond`. Enum `auto_engine` reservado para trocar sem migração.

**3. `RestartPolicy: unless-stopped` no container do app?**
Hoje é `"no"`: qualquer OOM/crash derruba o site e ele não volta. `unless-stopped` reergue o container após crash. Verificado seguro: a suspensão por inadimplência usa `docker stop`, que `unless-stopped` respeita — tenant suspenso **não** ressuscita.
→ **Recomendação: aprovar.** Ganho de disponibilidade sem furar a cobrança.

**4. Build em container efêmero irmão (com RAM própria)?**
O plano de runtime é 512 MB; um `npm run build` estoura isso e o OOM-killer do cgroup mataria o processo que serve tráfego (site pisca 502). O build rodaria num container `--rm` separado, mesmo volume montado, com mais memória.
→ **Recomendação: aprovar.** Isola o cgroup e resolve "build não roda em 512 MB" de uma vez.

**5. Mecanismo de quota por volume?**
Sem teto, um tenant com repo grande + `node_modules` + auto a cada 5 min pode encher `/var/lib/docker` e derrubar **todos** os containers do nó. Opções: **xfs project quota** (`--storage-opt size=`), **volume em loopback** de tamanho fixo, ou **liberar F1 com o teto documentado como limitação conhecida** + alarme de disco por nó (estendendo o `metrics-collector`), com quota como follow-up.
→ **Recomendação:** confirmar se os nós têm overlay2 + xfs com `prjquota`. Se sim, project quota. Se não, seguir com **alarme de disco por nó** agora e quota como follow-up bloqueante de escala.

---

*Bugs que enganavam (C1 tag prematura / C2 apagar antes do fetch) já têm correção travada no desenho. Mecânica de execução (lock, timeout, marcadores por passo) foi endossada pela crítica técnica e vai a código como está.*

---

## 10) DECISÕES TRAVADAS (aprovadas pelo dono) + AJUSTE DE ARQUITETURA

**D1 — Automático:** scheduler **no agente, por nó** (sobrevive à queda do WireGuard/API; `auto_engine` reservado). ✅

**D2 — Deploy NÃO recria o container do app.** (Ajuste sobre o plano: o dono quer só "fazer o build e colocar os arquivos lá dentro".)
- O **build roda num container efêmero IRMÃO** (`--rm`, RAM própria), usando a imagem base do runtime do ambiente (php base já tem composer+git+node via nvm; node base tem git+node). O `openssh-client` fica **nesse container de build**, não no container do app → **nenhuma imagem base do app precisa de rebuild, nenhum ambiente é recriado**.
- Passos: o build container clona/pull (deploy key), roda `composer install` / `npm ci` / build no **workspace** (volume por env), produzindo a árvore final.
- **Colocar os arquivos:** o agente faz `rsync --delete` da árvore buildada para o workdir do app (`/var` no PHP, `/app` no Node — workdir REAL confirmado pelos críticos), **preservando `.env` e uploads** (untracked). O container do app só **recebe** arquivos, nunca é recriado.
- **RestartPolicy `unless-stopped`** aplicado **ao vivo** com `docker update` (sem recriar). A suspensão por inadimplência (`docker stop`) continua respeitada. ✅

**D3 — Workspace/cache por ambiente:** named volume `veloz-deploy-<envId>` montado **só** nos containers de build (nunca no app). Guarda: checkout git, `node_modules`/cache, deploy key privada (`id_ed25519` 0600), e o **script materializado** do modo automático. Como o app não é recriado, os arquivos deployados vivem na camada de escrita do app (persistem entre restarts; um recreate por troca de runtime seria repovoado por um novo deploy — limitação declarada, aceitável).

**D4 — Runtime:** `unless-stopped` + build isolado em container irmão — **ambos aprovados**. ✅

**D5 — Quota:** nós são **ext4** (sem xfs prjquota). → **Alarme de disco por nó** agora (estende `metrics-collector`) + **teto no volume de build por env via loopback** (mkfs em arquivo de tamanho fixo) como a quota real do que enche disco (node_modules/checkout). Quota fina fica como follow-up.

**Cron/materialização (requisito do dono preservado):** o gate "se o arquivo não estiver montado, não roda" continua — o agente materializa o script/plano do deploy no volume `veloz-deploy-<envId>`; o scheduler-por-nó só dispara se estiver materializado.

### Fatiamento em PRs (revisado, sem recriação)
- **PR1 — Fundação:** contracts + tabelas (`deploy_configs`, `deploy_steps`, `deploy_runs`) + rota `deploy.ts` (GET/PUT connection, probe, key/generate, key/test, steps detect/save) + esqueleto do agente (`deploy.ts`) + tela do painel (conectar repo, gerar/colar deploy key, "testar conexão", editar steps). Sem execução ainda.
- **PR2 — Execução:** build em container irmão + `rsync` para o app + `deploy_runs` (log redigido, status por passo, lock), rollback (tag `veloz/last-good`), `RestartPolicy unless-stopped` via `docker update`. Botão "Fazer deploy agora" + histórico.
- **PR3 — Automático:** scheduler por nó + materialização do script + intervalo (mín. 5 min, jitter) + alarme de disco por nó + volume de build com teto (loopback).

---

## 11) VARIÁVEIS DE AMBIENTE (gerenciadas no painel — reais, não arquivo)

Pedido do dono: variáveis de ambiente **de verdade** (não um `.env` editado à mão), guardadas no painel; **aplicar com o container vivo**; e **no recreate**, pegar as guardadas e aplicar na criação. Desenho validado por especialista + red-team.

**Persistência:** tabela `env_vars` (`env_id`, `key`, `value_encrypted`, `build_time`, `UNIQUE(env_id,key)`). Valor **cifrado em repouso** com AES-256-GCM (`apps/api/src/crypto.ts`), chave `VP_ENV_SECRET` no env da API (fora do host do banco; fail-closed em produção; prefixo `v1:` para rotação). Modelo de ameaça honesto: protege dump/replica/backup do banco, **não** protege um processo de API comprometido (ele precisa da chave) — mesma postura do `VP_JWT_SECRET`.

**(3) No RECREATE → `Env` real do Docker:** `provision()` recebe as vars e as põe no array `Env` do `createContainer` (o Docker **não** faz parsing de shell → injeção impossível por construção). As duas chamadas de provision em `environments.ts` (criar + trocar runtime) buscam e decifram as vars.

**(2) Com o container VIVO → arquivo + restart do PROCESSO (sem recriar):** o agente escreve `/veloz/env` no formato **`KEY=base64(valor)`** (nunca `source`/`set -a` — isso executaria um valor malicioso). O **start command** (`cmdFor`) passa a **ler** esse arquivo com um loader seguro (`export "$k=$(printf %s "$v"|base64 -d)"`) **antes** de subir o app. "Aplicar" = o agente escreve o arquivo + **mata o processo do app** (`/.vp-app-pid`) → o supervisor relê e reinicia o app com as vars como env **real**.
- Isso exige transformar o **PHP** também num supervisor-loop (hoje é `exec php -S`; vira `while :; do <load-env>; php -S ... & wait; done`) — igual ao Node — para poder reiniciar o processo sem derrubar o container/rotacionar a porta.
- **Limitação honesta (surfar na UI, nunca fingir sucesso):** requisições já em andamento mantêm o env antigo até o restart (blip ~1s); e **containers criados ANTES desta mudança** não leem `/veloz/env` → o agente responde `applied:false, reason:"recreate_required"` (marcador `/.veloz-env-capable`) e o painel mostra "salvo — recrie o ambiente (trocar versão) para aplicar".

**(4) BUILD-time:** vars com `build_time=true` (ex.: `VITE_*`, `NEXT_PUBLIC_*`) vão como `Env` real no **container de build irmão**. (Aviso na UI: `NEXT_PUBLIC_*`/`VITE_*` entram no bundle → são efetivamente públicas.)

**Segurança (red-team):** denylist de chaves reservadas (`PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `NVM_DIR`, `HOME`, `VP_*`…) — o usuário não pode quebrar o container nem injetar via `LD_PRELOAD`; validação regex `^[A-Za-z_][A-Za-z0-9_]*$` nas duas bordas; `redact` no logger para `vars/value`; **GET mascara** os valores, revelar só via `POST …/reveal` (`no-store` + auditado), igual à senha SFTP; caps (valor ≤ 32KB, ≤ 100 vars) para não estourar `ARG_MAX`/disco.

**Precedência vs `.env` do repo:** são planos diferentes — as vars do painel são **env do processo** (o `.env` do repo, preservado no `git_sync`, continua sendo arquivo do cliente). Quando a mesma chave existe nos dois, a **var do painel vence em runtime** (o `dotenv` não sobrescreve env já existente). O painel **não** materializa `.env` (evita clobber do `.env` que o deploy preserva).

**Superfície:** contracts (`setEnvVarsInput`, `envVar`, `RESERVED_ENV_KEYS`), `apps/api/src/crypto.ts`, `apps/api/src/routes/env-vars.ts` (GET mascarado, PUT, `/reveal`, `/apply`), `agent.ts` (`applyEnvVars`), `agent/src/server.ts` (`/env-vars`), `agent/src/docker.ts` (`cmdFor` + `writeEnvFileAndRestart`), painel `env/[id]/variaveis/page.tsx` (linhas chave/valor, toggle build-time, olho p/ revelar, "colar .env").

**Entra no fatiamento:** dados + tela de variáveis no **PR1**; o loader no `cmdFor` (PHP vira supervisor) + `Env` no provision + apply-live + build-time no **PR2** (junto da execução do deploy).

---

## 12) ESTRATÉGIA DE DEPLOY: "recriar container" vs "só colocar arquivos"

Pedido do dono: no deploy **manual** poder escolher **recriar o container** ou **fazer o deploy sem recriar**. São duas estratégias, escolhíveis (padrão na config + override por execução, ex.: botão "Fazer deploy" e "Fazer deploy + recriar").

`deploy_configs.deploy_strategy` text default `'place'` (`place` | `recreate`), e o `POST /run` aceita um override `strategy?`.

- **`place` (padrão, rápido, sem recriar):** build no container irmão → `rsync --delete` dos arquivos pro workdir do container **vivo** (preservando `.env`/uploads) → reinicia o **processo do app**. Sem trocar porta/domínio. As **env vars** aplicam pelo caminho "vivo" (arquivo `/veloz/env` + restart do processo).
- **`recreate` (limpo, aplica tudo):** build no container irmão → **recria o container** do app a partir da base (com as **env vars como `Env` real do Docker**, base/estado limpos) → coloca os arquivos buildados (do volume de build) no container novo. Usa o mesmo caminho de recriação que a troca de runtime já tem.
  - **Consequência honesta:** recriar troca a **porta efêmera** → a API atualiza o `httpPort` (já faz isso na troca de runtime) e, se houver **domínio**, precisa **reapontar** o proxy do nó (automação de binding de domínio ainda é pendência conhecida — hoje manual). Downtime maior que o `place`.
  - Quando faz sentido: primeira publicação, mudança grande de env var/base, ou quando o cliente quer estado 100% limpo.

**UI:** no card de deploy, ação primária "Fazer deploy" (=`place`) + uma secundária/menu "Fazer deploy recriando o container" (=`recreate`), com aviso do downtime/porta. A escolha padrão fica salva em `deploy_strategy`.

---

## 13) ATALHO "DEPLOY NEXT.JS" (muito simples)

Pedido do dono: um jeito **muito simples** de fazer deploy de Next.js. É um **preset** sobre o módulo de deploy (build no container irmão → place → restart) — **sem novo subsistema, sem reescrever o supervisor**.

**Modelo de execução — STANDALONE primeiro (recomendado):** o Next com `output: "standalone"` gera `.next/standalone/server.js`, um `node server.js` puro que lê `PORT`/`HOSTNAME` do env → **encaixa exatamente no supervisor Node atual** (`nodeStartFile = "server.js"`), zero mudança. Sem `node_modules` no container do app (payload do `rsync` fica pequeno).
- **Forçar standalone sem editar o `next.config` do usuário:** var de **build** `NEXT_PRIVATE_STANDALONE=true`. Depois do build, **verificar** que `server.js` existe; se não, cair para `next start` (fallback avançado) — nunca fingir que deu certo.
- **Binding obrigatório (runtime):** `PORT=80`, `HOSTNAME=0.0.0.0`, `NODE_ENV=production` (o standalone default é `3000`/`localhost` → inalcançável pela porta publicada). Vars travadas do preset.

**Steps do preset (usam os kinds já existentes):** `git_sync` → `npm_ci` ("Instalar dependências") → `npm_build` (`next build`, com `NEXT_PRIVATE_STANDALONE=true`) → **place** (montagem standalone: copiar `.next/static` e `public/` pra junto do `server.js`, depois `rsync` pro `/app`) → `node_restart` (grava `/.vp-node-start=server.js`, mata o node → supervisor sobe `node server.js`).

**Detecção** (`detectStack`, no container de build): `next` no package.json / `next.config.*` / `scripts.build`=`next build`. Produz `{ framework:"nextjs", runModel, serverEntry (path real, monorepo-aware), router, subdir }`.

**Env split:** build precisa de `NEXT_PRIVATE_STANDALONE`, `NODE_ENV=production` e todo `NEXT_PUBLIC_*` (entram no bundle → o detector marca `build_time=true` automático e a UI avisa que são **públicas**). Runtime: `PORT=80`, `HOSTNAME=0.0.0.0`, `NODE_ENV=production` + segredos server‑only via `/veloz/env` (§11).

**Node:** `node:18-slim` (18.20) já cobre Next 14/15; template default **Node 20/24**. Build e runtime **mesmo major** (standalone empacota deps compiladas). O container de build já usa a base do runtime do ambiente (§10 D2) → casa.

**UX "muito simples" (menos cliques):** um **template "Next.js" na criação do ambiente** — `createEnvironmentInput.template = 'nextjs'` fixa o Node, semeia o preset (framework, runModel, os 5 steps, `nodeStartFile='server.js'`) e as env vars (`PORT`/`HOSTNAME`/`NODE_ENV` runtime + `NEXT_PRIVATE_STANDALONE` build). Aí o usuário só faz: **colar a URL do repo → "Fazer deploy agora"**. Total até o 1º deploy: escolher template + nome → colar repo → Deploy. Em ambiente já criado: botão **"Configurar como Next.js"** (roda `detectStack` e grava o mesmo preset). Avançado continua livre (trocar pra `next_start`, editar steps).

**Dados a adicionar:** contracts `deployFramework=('none'|'nextjs')`, `deployRunModel=('standalone'|'next_start')`, `framework`+`runModel` em `deployConfig`, `template` em `createEnvironmentInput`; `deploy_configs.framework`/`run_model` (schema+push). Agente: branch nextjs no `detectStack` + montagem standalone no place.

**Riscos travados:** (1) standalone sem `.next/static`+`public/` → CSS/imagens quebradas (a montagem no place resolve; verificar não‑vazio); (2) porta não em `0.0.0.0:80` → site "verde" mas fora do ar (vars travadas); (3) não assumir `next.config` — forçar por env + verificar `server.js`; (4) Node major build≠runtime → crash no boot; (6) `NEXT_PUBLIC_*` público; (7) build OOM → ≥2GB no container de build; (9) monorepo/subdir → `serverEntry`/`cwd` reais.
