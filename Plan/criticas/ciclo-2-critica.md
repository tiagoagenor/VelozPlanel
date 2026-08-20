# Crítica do Ciclo 2 — Red Team Técnico

> Autor: Crítico / Red Team Técnico
> Documentos atacados: `06-multitenancy-runtime.md`, `07-billing-metering.md`, `08-modulos-instalacao.md`,
> `09-banco-backup.md`, `10-acessibilidade-qualidade.md`, `11-observabilidade.md`,
> `docs/CHECKLIST-DESENVOLVIMENTO.md`, contra `00-BRIEFING.md` (ADENDOS 1, 2, 3 **e 4**) e
> `criticas/ciclo-1-critica.md`.
> Data: 20/08/2026

## Aviso de leitura

O Ciclo 2 é **tecnicamente muito superior** ao Ciclo 1. O `06` §10 (isolamento), o `07` §2 (metering,
idempotência, razão append-only, carry sub-centavo), o `09` §5.6 (object lock e as duas identidades) e o
`11` §7.2 (as seis regras anti-fadiga) estão acima do que se vê em produtos comerciais deste segmento.
Nada nesta crítica contesta a qualidade da engenharia.

O que esta crítica contesta é **coerência entre os seis documentos e aderência aos ADENDOS**. Os seis
especialistas escreveram em paralelo e três deles nunca receberam o ADENDO 3. O resultado é um plano em
que:

| | |
|---|---|
| Frota | `06` diz **2 nós** · `07` §3.10 diz **2 nós** · `08`, `09` e `11` dizem **3 nós** |
| Densidade | `06` diz **7/nó** · `07` diz **11/nó** · `09` diz **22/nó** · `11` diz **20, 25 e 60/3** |
| CLI do nó | `06` e `09` usam `velozctl` **dentro** do nó (103 ocorrências) · `08` proíbe isso |
| Agente | `08` diz `veloz-agent` · `11` diz `vp-agent` (e usa `veloz-agent` na unit) |
| Fonte da verdade da fatura | `06` diz **estado observado** · `07` diz **máquina de estados do CP** · `11` diz **o agente fecha a hora** |
| Nó `offline` para de faturar em | `11` diz **90 s** · `06` diz **180 s** · `07` diz **300 s** · `05` diz **45 s** |
| Tamanho do control plane | `07` diz **4 GB** · `08` e `09` dizem **8 GB** · `09` tuna o PG do CP para **8 GB** |

Com IA construtora, **isto não é ruído de redação — é código divergente**. Uma IA que lê `07` implementa
`usage_samples` + rollup no CP; a mesma IA lendo `11` implementa `usage_events` fechados pelo agente.
As duas coisas serão construídas, e nenhuma das duas será a fatura.

Contagem: **6 bloqueadores**, 17 altos, 14 médios, 6 baixos, **31 contradições cruzadas**.

---

# 0. Veredito em uma página

| Pergunta | Veredito |
|---|---|
| **Densidade: 7 ou 11?** | **7 por nó. A frota de produção tem 14 ambientes, não 22.** O `06` está certo no número e no argumento; o `07` está certo em exigir que o argumento seja aritmético, e ele não era. Ver §1. |
| **Quanto de reserva operacional?** | **1,0 GB por nó, não 2,0.** Os quatro usos que o `06` §1.6 soma são **mutuamente exclusivos pela política de incidente do próprio `06` §8.3.1**, e um deles (build) não deveria estar em nó de produção. Ver Achado 1.3. |
| **Qual overcommit é seguro em 16 GB?** | **1,0× sobre o VENDIDO** (running + pausado), não sobre o running. O 1,3× do `07` é uma aposta em ≥27% de pausados permanentes, sem dado e sem mecanismo que a garanta. Ver Achado 1.4. |
| **O que acontece quando um `start` é recusado?** | O `07` §3.10.2 diz que a fila tenta outro nó. **Isso é impossível na arquitetura do `06`**: o volume está no disco do nó A e mover 2,5 GB entre provedores leva 3–7 min. A fila é uma recusa com UX pior. Ver Achado 1.5. |
| **Impacto no ponto de equilíbrio de 17 ativos?** | **O ponto de equilíbrio (17) passa a estar ACIMA do teto físico (14).** Deixa de ser 94% do teto e vira **121% — inatingível.** Receita máxima cai de R$ 1.144 para **R$ 918/mês**. Ver §1.7. |
| **Reabrir a decisão de runtime (Docker × Podman)?** | **Não agora — mas não fechar como está.** Vira um bake-off medido de meio dia no nó de teste (T11), com gatilho numérico. Ver §2. |
| **`rootflags=pquota`** | **Sim, é critério de escolha de provedor** — e a ordem de preferência do `06` §2.5 está errada: falta a opção que resolve de verdade (**volume de bloco adicional**) e o custo do loopback está subestimado por uma ordem de grandeza. Ver §3. |
| **Piloto de 1 nó?** | **Sim, e é a primeira entrega certa** — cabem 9 ambientes de 1 GB. Mas ele **esconde 4 diferenças de arquitetura**, três das quais viram reescrita se não forem escritas agora. Ver §6. |
| **Executável por IA?** | **Não como está.** 31 contradições, 3 fontes-da-verdade concorrentes para dinheiro e 4 timeouts diferentes para o mesmo evento. Ver §8. |

**Bloqueadores para começar a codar:** B1 (frota/densidade divergente entre 6 docs), B2 (fonte da verdade
do faturamento em tripla contradição), B3 (`velozctl` × `veloz-nodectl`), B4 (o `node-doctor` ainda testa
ZFS e não testa `pquota` nem `userns-remap` — declarado pendente pelo `08` §6.2), B5 (backup do control
plane sem object lock e com a chave dentro do próprio bucket), B6 (ADENDO 4 invalida a decisão do `07`
§3.1 de não hospedar fora do Brasil e quebra 4 timeouts).

---

# 1. CONFLITO PRINCIPAL — Densidade: 7 × 11 ambientes por nó

## 1.1 A soma cabe? Conferindo os 13,0 GB do `06` contra o que TODOS pediram

### Achado 1.1 — A soma de RAM fecha (erro de 2%), mas duas linhas estão erradas e um processo inteiro ficou fora

**Severidade: Médio** (a conta sobrevive; a disciplina que a sustenta, não)

**Evidência.** `06` §1.1 declara reserva fixa de **2.898 MB** e "RAM disponível para ambientes =
16.384 − 3.118 = 13.266 MB ≈ 13,0 GB". `09` §1.4 declara reserva de **2,53 GB** e "13,47 GB → 11,4 GB a
85% ⇒ **22 ambientes de 512 MB**". `11` §1.1 pede **40 MB adicionais por nó** e §1.2 mede **~22 MB**,
declarando que cabem *dentro* do `MemoryMax=128M` do agente.

**Soma honesta, item a item, pegando o pior número declarado por cada dono:**

| Componente | MB | Dono | Observação |
|---|---:|---|---|
| Kernel + systemd + journald + sshd + chrony + nftables | 500 | `09` (pior que os 450 do `06`) | |
| `dockerd` + `containerd` ociosos | 150 | `06` | ausente da tabela do `09` |
| `veloz-agent` (Node SEA, `MemoryMax=128M`) — **já inclui os 22 MB de observabilidade** | 128 | `06` + `11` §1.2 | |
| `vector` (parse de log da borda) | **60 ou 0** | `06` × `11` | **contradição — ver Achado 4.3** |
| nginx de borda | 60 | `06` (o `09` diz 50) | |
| **SFTPGo** (`06` D10, §6.1: "1 processo por nó" no host) | **~40** | **ninguém** | **NÃO ESTÁ EM NENHUMA TABELA** |
| `veloz-db-warden` (`09` §1.8, timer a cada **10 s**, 2 conexões admin) | ~10 | **ninguém** | idem |
| **MariaDB 11.8** — pico | **490** | `09` §1.4 (o `06` reserva 450, o `09` reserva 480) | |
| **PostgreSQL 17** — regime | **433** | `09` §1.4 (ambos reservam **350**) | **o `09` calcula 433 e reserva 350, admitindo que "a conta não fecha"** |
| Transitórios (restic, zstd, age, lego, mysqldump) | 250 | `06` | |
| Margem de segurança (page cache, reclaim, picos correlacionados) | 1.000 | `06` = `09` | |
| **Reserva fixa honesta** | **3.121** | | contra os **2.898** declarados |
| Shims (`containerd-shim`, 10 MB × N ativos) | 10 × N | `06` | |

**Por que é um problema.** O erro absoluto é de **+223 MB (7,7%)** — a conta do `06` sobrevive. Mas:

1. **O SFTPGo é um processo residente inventado no `06` D10 e nunca orçado por ninguém.** O `06` §6.1 diz
   "SFTPGo no host, 1 processo por nó" e o `06` §6.3 item 5 declara "+8 MB de RAM (o SFTPGo já está no ar;
   é só habilitar o listener)" — ou seja, o próprio documento assume que o SFTPGo já foi contabilizado.
   **Ele não foi.** Um SFTPGo ocioso em Go fica em 30–50 MB.
2. **O `09` calculou o PostgreSQL em 433 MB de regime e reservou 350 MB**, escrevendo explicitamente
   *"Aqui a conta **não fecha** nos 350 MB da crítica em pico"* — e reservou 350 mesmo assim. As três
   defesas que ele apresenta (`autovacuum_max_workers=2`, `MemoryHigh=350M`, `MemoryMax=450M`) fazem o PG
   sofrer *reclaim* e não estourar o nó, o que está certo — mas o custo do reclaim é **exatamente a
   margem de 1.000 MB de page cache**, que já está alocada para outra coisa.
3. **A regra do Ciclo 1 ("cada componente novo diz quantos ambientes custa") foi cumprida pelo `06` e
   ignorada pelo `09` e pelo `11`.** O `09` acrescenta `veloz-db-warden`, `veloz-db-dump`,
   `veloz-immutability-test` e `veloz-restore-drill` sem uma linha de orçamento.

**Veredito/Correção.**
- Reserva fixa corrigida: **3.060 MB** (3.121 − 60 do `vector`, que sai pelo Achado 4.3, + 0). Arredondar
  para **3,1 GB**. RAM disponível para ambientes = **13.324 MB ≈ 13,0 GB** — **o número do `06` está
  certo por coincidência de compensação**, e precisa ser reescrito com as linhas certas.
- **O `09` §1.4 deve reservar 433 MB para o PG**, não 350, e declarar que os 660 MB de pico transiente
  saem da margem.
- **Acrescentar `SFTPGo (40 MB)` e `veloz-db-warden (10 MB)` à tabela do `06` §1.1.**
- **Regra de processo para o Ciclo 3:** nenhum especialista pode introduzir um processo residente no nó
  sem acrescentar a linha correspondente à tabela do `06` §1.1, **no mesmo commit**. O `06` §1.1 é a
  tabela única; as tabelas do `09` §1.4 e do `11` §1.1 passam a ser *entradas* nela, não tabelas rivais.

---

### Achado 1.2 — O DISCO não fecha, e ninguém somou. A folga cai de 128 GB para 75 GB

**Severidade: Alto** (é o achado numérico mais grave do Ciclo 2)

**Evidência.**
- `06` §1.3 orça o disco de 200 GB: SO 8 · imagens OCI 4 · **dados MariaDB+PG 15** · logs 5 ·
  **staging de backup 10** · reserva de 85% 30 → **"Disponível para volumes de ambiente: 128,0 GB"** →
  "128 / 2,5 = **51 volumes** por nó".
- `09` §1.9 exige **`/var/lib/veloz-db` como LV/partição XFS própria com `prjquota`, "25% do disco
  (50 GB numa VPS de 200 GB)"**.
- `09` §5.1 exige **`/var/backups/veloz` como partição XFS própria, 20 GB** (cópia 1 local, 48 h).
- `11` §1.1 fixa teto de **8 GB de log por nó**, e `11` §8.2 calcula que a necessidade real chega a
  **13,5 GB** e "excede o teto de 8 GB por nó".
- `09` §5.11 alerta: *"o `restic cache` pode crescer sem limite"* e classifica **"disco cheio no nó" como
  a causa nº 1 de falha de backup**.
- `09` RB-02 restaura *ao lado* (`<db>_restore_<data>`) e mantém `<db>_old` por 7 dias → **3 cópias da
  base** simultâneas.
- `06` §8.3.1 restaura em `/srv/env/0042.restore-<ts>/` ao lado do vivo → **2× o tamanho do ambiente**.

**Soma honesta:**

| Item | `06` §1.3 | Honesto | Dono |
|---|---:|---:|---|
| SO + `/var` + journald + pacotes | 8 | 8 | `06` |
| Imagens OCI (dedup overlay2) | 4 | 4 | `06` |
| **Dados MariaDB + PostgreSQL** | **15** | **50** | **`09` §1.9** |
| **Logs de acesso** | **5** | **8** | **`11` §1.1** |
| **Backup local (cópia 1, 48 h)** | **10** | **20** | **`09` §5.1** |
| Cache do restic + staging de restore | 0 | 5 | `09` §5.11 |
| Reserva intocável (XFS nunca > 85%) | 30 | 30 | `06` |
| **Disponível para volumes** | **128** | **75** | |
| **Volumes de 2,5 GB por nó** | **51** | **30** | |

**Por que é um problema.**

1. **A camada 2 do plano de resgate do `06` §8.1.1 depende de folga de disco que não existe.** O texto diz
   *"há ~35 volumes de folga por nó, §1.3"*. Com 75 GB e 7 ativos consumindo 17,5 GB, a folga real é de
   **23 volumes**, não 35. O cenário do `06` §8.3.1 (recolocar ~20 pausados do nó morto) **cabe por pouco
   e só se o nó sobrevivente tiver poucos pausados próprios**. A segunda das três camadas de redundância
   da frota de 2 nós é bem mais apertada do que o documento afirma.
2. **O guarda-corpo de 80% muda de significado.** O `06` §1.4 escreve *"8 clientes enchendo a cota lotam o
   nó (`128 / 10 = 12,8`)"*. Com 75 GB reais, **3 clientes Light (20 GB de cota cada) batem o bloqueio de
   80%**. Um catálogo com Light a 20 GB e Plus a 40 GB não cabe em 75 GB com 7 ambientes vendidos: a soma
   provisionada do mix é 7 × 27 GB = **189 GB contra 75 GB reais = 2,5× de overcommit de disco já no
   primeiro dia**, e não os "4:1 folgados" que o `06` descreve.
3. O `09` está pedindo **35% do disco (70 GB de 200)** antes de qualquer cliente, e nenhum documento
   registrou isso.

**Veredito/Correção — arbitragem numérica:**

| Item | Arbitrado | Justificativa |
|---|---:|---|
| `/var/lib/veloz-db` | **30 GB** | 15 GB de dado real (`06`) + 4 GB de teto de binlog (`09` §1.2 `max_binlog_total_size=4G`) + 8 GB de tmpdir/temp_tablespaces/restore-ao-lado + folga. Os 50 GB do `09` são dimensionados para **22** ambientes; com **7** a conta é outra |
| Logs de acesso | **8 GB** | `11` vence: o `06` orçou 5 GB com 14 dias, e o `11` §8.2 impõe **30 d no nó + 180 d totais** por Marco Civil. Vem com a **cota de 2 GB comprimidos por ambiente** do `11` §8.2, que é o que impede um cliente de encher o disco |
| Backup local | **12 GB** | 48 h de dump horário de 7 ambientes + staging de 1 restore. Os 20 GB do `09` são para 22 ambientes |
| Cache do restic | **5 GB**, com `restic cache --cleanup --max-age 30` no timer | `09` §5.11 identifica o risco e não orça |
| **Disponível para volumes** | **103 GB** | |
| **Volumes por nó** | **41** | contra os 51 do `06` |

> **Regra que precisa entrar no Ciclo 3:** o `06` §1.3 vira a **tabela única de disco**, como o §1.1 é a
> tabela única de RAM. O `09` §1.9 e o `11` §1.1 passam a ser entradas nela.
> E o `06` §1.4 precisa refazer a política de overcommit de disco contra 103 GB, não 128.

---

## 1.2 Quanto de reserva operacional é realmente necessário

### Achado 1.3 — Os 2 GB de reserva foram somados, não dimensionados. Os quatro usos são mutuamente exclusivos pela política do próprio documento

**Severidade: Alto**

**Evidência.** `06` §1.6 reserva **2.000 MB por nó** e justifica com quatro usos:
(1) blue/green da troca de versão, (2) *boost* de build de 1 GB, (3) resize de emergência, (4) resgate de
1 ambiente crítico do nó morto.

Confronto com o próprio `06` §8.3.1, "O que é degradado ou recusado, explicitamente, enquanto durar":

| Uso da reserva | Estado durante um incidente de nó, segundo `06` §8.3.1 |
|---|---|
| (1) Blue/green de troca de versão | **suspenso** — *"`fleet roll` de imagem base e builds de `packages.toml`: competem por RAM, CPU e banda com o restore"* |
| (2) Boost de build | **suspenso** — mesma linha |
| (3) Resize de emergência | **recusado** — *"Upgrade de RAM/vCPU: consumiria a reserva de resgate"* |
| (4) Resgate | **é o incidente** |

**Por que é um problema.** O documento reserva a **soma** de quatro usos que ele mesmo declara
**mutuamente exclusivos**. O dimensionamento correto de uma reserva compartilhada por usos exclusivos é o
**máximo**, não a soma. E dois dos quatro usos não deveriam consumir reserva de nó de produção:

- **Blue/green não custa um plano inteiro.** O `06` §5.1 passo 1 faz `MemoryMax=$((CURMAX*125/100))` —
  **+25% do plano do ambiente**, não +100%. Para um Pro (4 GB) são **+1 GB**; para o mix de 1,35 GB são
  **+345 MB**. O `06` §5.1 já manda serializar em "no máximo 2 simultâneas por nó". Serializando em **1**,
  o pior caso é **1 GB** e o custo é que trocas de versão fazem fila — irrelevante com 7 ambientes.
- **O boost de build de 1 GB não deveria existir em nó de produção.** O `06` §8.2 já é categórico:
  *"**Nunca `docker build` no destino.** A imagem derivada vai por `docker save`/`load`"*. E o `06` §8.4
  já faz do nó de teste o portão obrigatório de toda imagem. **Construir a imagem derivada de
  `packages.toml` no nó de teste e distribuí-la por `save`/`load` devolve 1 GB por nó de produção** e, de
  quebra, garante que os dois nós de produção rodam bytes idênticos — que é o argumento inteiro do modelo
  OCI (Achado 1.2 do Ciclo 1).
- **O resgate não é uma reserva, é o nó de teste.** O `07` §3.10.10 já argumenta isso com todas as letras:
  *"O nó de teste deixa de ser custo perdido: ele é a apólice de seguro... **capacidade quente de
  substituição**"*. Manter 2 GB parados em **cada** nó de produção **além** de um terceiro nó inteiro pago
  é comprar o mesmo seguro duas vezes. E o próprio `06` §8.3.1 admite que a reserva de 2 GB só resgata
  *"1 Plus, ou 2 Light, ou 4 Start"* de 7 — entre 14% e 57% de um nó.

**Veredito/Correção.**

> **Reserva operacional = 1,0 GB por nó**, com um **token único por nó** (semáforo de 1 vaga) que
> serializa blue/green e resize de emergência. Build de imagem derivada **sai dos nós de produção** e vira
> job do nó de teste com distribuição por `docker save`/`load`. Resgate **é o nó de teste promovido**,
> não RAM parada.

| | `06` §1.6 | Arbitrado |
|---|---:|---:|
| `veloz-env.slice MemoryMax` | 11.500 MB | 11.500 MB |
| Reserva operacional | 2.000 MB | **1.000 MB** |
| **Vendável por nó** | **9.500 MB** | **10.500 MB** |
| Start (512 MB) por nó | 18 | **20** |
| Light (1 GB) por nó | 9 | **10** |
| Plus (2 GB) por nó | 4 | **5** |
| Pro (4 GB) por nó | 2 | **2** |
| **Mix de 1.382 MB por nó** | **6,9 → 7** | **7,6 → 7** |

**Honestidade obrigatória:** a economia de 1 GB **não muda o número do mix** (7 nos dois casos, porque
8 × 1.382 = 11.056 > 10.500). Ela muda os planos individuais. Portanto: **a reserva de 2 GB não é o que
derruba a frota para 14.** Quem derruba é a soma dos planos do mix. Isto precisa estar escrito, porque a
tentação óbvia de quem lê o `07` é culpar a reserva — e cortar a reserva inteira devolveria 8, não 11.

---

## 1.3 Qual overcommit é seguro num nó de 16 GB

### Achado 1.4 — O 1,3× do `07` não é overcommit de RAM: é uma aposta em 27% de pausados permanentes, sem dado e sem mecanismo

**Severidade: Bloqueador** (é o núcleo do conflito)

**Evidência.**
- `07` §3.3: *"**Razão de commit = 1,30×** (política inicial, conservadora): provisionado ≤ 11,5 GB ×
  1,30 = 14,95 GB por nó → **11 ambientes por nó**"*, com a sanidade cruzada *"**Se todos os 11 ligarem ao
  mesmo tempo:** 14,95 GB contra 11,5 GB alocáveis → **falta 3,45 GB**"*.
- `07` §3.10.2: *"Fração ativa máxima sustentável = 23,0 ÷ 29,9 = **77%**"*.
- `06` §1.4 refuta a fórmula estatística com três motivos concretos (WP-Cron às :00 com correlação ≈ 1;
  `√N` não protege com N=25; eventos externos correlacionam) e recomenda **1,0× até B1/T9 medido**.

**A aritmética, dita sem eufemismo.** Vender 11 ambientes do mix de 1,382 GB é vender
**15.202 MB de `MemoryMax`** contra um teto duro de **11.500 MB**. A diferença é **3.702 MB**. Traduzido:

> **Para que os 11 clientes do `07` possam usar o que compraram, pelo menos 3 deles têm de estar pausados
> a qualquer instante, para sempre.** Não "em média". **A qualquer instante.**

Isso não é uma razão de commit — é uma **premissa de comportamento de cliente**. E o `07` §3.10.8 fixa a
política comercial da fase 1 em **"máximo 12 clientes / 15 ambientes"**. Com 12 clientes, a premissa é:
*3 dos seus 12 primeiros clientes estarão sempre com o site desligado*. Não há dado que sustente isso, e o
`07` §3.8 admite que a fração ativa é justamente **o número a monitorar semanalmente** — ou seja, é
desconhecido.

**Por que é um problema.** Três camadas, em ordem de gravidade:

1. **Não existe mecanismo que force a premissa.** Nada no plano impede 11 clientes de ligarem os
   ambientes na mesma manhã. O único instrumento é o *admission control*, que é a recusa (Achado 1.5).
2. **O `07` §3.3 propõe uma "governança da razão de commit"** — subir para 1,50× se a fração ativa cair
   abaixo de 45%. Isso é uma **realimentação positiva**: quanto mais clientes pausam, mais você vende, e
   mais alta fica a probabilidade de uma correlação (uma campanha, uma segunda-feira, um Black Friday)
   colocar todo mundo de pé ao mesmo tempo. É o mesmo mecanismo que quebra banco em corrida bancária, e
   com N=11 não há lei dos grandes números para amortecer.
3. **A fórmula do `06` §1.4 está certa e o `06` foi honesto sobre onde ela falha.** μ + 2,33σ para N=29 dá
   8,3 GB contra 11,5 — cabe. Mas `σ = 0,25·P·√N` assume independência, e o `06` lista três violações
   concretas. **Nenhuma delas foi refutada pelo `07`.**

**Veredito/Correção.**

> **A razão de commit é 1,0× sobre o VENDIDO (running + pausado), não sobre o running.**
> `Σ MemoryMax de TODOS os ambientes provisionados no nó ≤ 10.500 MB`. Ambiente pausado conta **cheio**.
>
> Isso é o que "postura A garantida" do `06` §1.6 significa de verdade, e o `06` deveria tê-lo escrito
> assim: **não é "overcommit 1,0×", é "sem overcommit sobre o vendido"** — a diferença é exatamente o
> conflito com o `07`, que aplica o 1,0× ao *running*.

**Condições sob as quais eu autorizo passar de 1,0×** (para o Ciclo 3 registrar como gatilho, não como
opção de hoje):
1. **60 dias de dado real de fração ativa**, com o P99 diário medido — não a média. A média é irrelevante;
   o que quebra o nó é o pico simultâneo.
2. **WP-Cron desarmado com jitter determinístico** em 100% dos ambientes WordPress (`06` §1.4 já
   especifica: `jitter = (env_id * 37) % 300`). Sem isso, a correlação é 1 e nenhum overcommit é seguro.
3. **`memory.pressure avg300 < 10%` no `veloz-env.slice`** sustentado por 14 dias.
4. **O `start` recusado tem de ser impossível**, não improvável — ver Achado 1.5.
5. Teto absoluto, mesmo depois de tudo isso: **1,15×**. Não 1,30×, não 1,50×. Com N ≤ 20 num nó de 16 GB,
   a margem de erro de 15% é 1,6 GB — já é mais do que a reserva operacional inteira.

---

## 1.4 O que acontece de fato quando um `start` é recusado

### Achado 1.5 — O plano de contingência do `07` para o `start` recusado não existe na arquitetura do `06`

**Severidade: Bloqueador**

**Evidência.**
- `07` §3.3: *"Por isso existe **admission control**: acima de 85% de RAM ativa no nó, o `start` entra em
  fila ('retomando em instantes') **e o scheduler tenta outro nó**. Isso precisa ser um SLO medido...
  **meta: < 0,5% dos `start` enfileirados por mais de 60 s**"*.
- `06` §8.1 **Passo 3**: *"**sem rebalanceamento automático na fase 1.** O ambiente fica no nó onde nasceu
  até alguém mandar migrar."*
- `06` §8.2: migrar um ambiente de 5 GB entre provedores = **3,3 min de transferência pura a 200 Mbps**,
  60–180 s de corte, e o procedimento exige **TTL de DNS baixado 24 h antes**.
- `06` §1.4: *"bloquear criação/start quando a regra for violada → **HTTP 409** com o número"*.
- `06` §1.6: *"**um cliente pode receber 'não foi possível iniciar seu ambiente'** — o pior erro possível
  num produto cujo argumento de venda é o botão de pausar"*.

**Por que é um problema.**

1. **"O scheduler tenta outro nó" é fisicamente impossível.** O volume do ambiente está no XFS do nó A,
   com projeto de quota registrado, o database está no MariaDB do nó A, o vhost está na borda do nó A e o
   registro A do DNS aponta para o IP do nó A. Iniciar no nó B **é uma migração**, com 3–7 minutos de
   transferência e um TTL de DNS que precisava ter sido baixado ontem. **O `07` especificou um fallback
   que a arquitetura do `06` não oferece, e o SLO de "< 0,5% enfileirados por mais de 60 s" é
   inalcançável por construção.**
2. **Duas respostas contraditórias estão especificadas para o mesmo evento**: `06` diz **409 com o número**
   (recusa explícita), `07` diz **fila com "retomando em instantes"** (promessa implícita). Com IA
   construtora, as duas serão implementadas, em camadas diferentes, e o cliente verá um spinner que
   termina em erro.
3. **A fila sem prazo é pior que a recusa.** Nada obriga um vizinho a pausar. A fila só drena se alguém
   pausar espontaneamente — evento que pode não ocorrer por dias. Uma fila cuja condição de saída depende
   de um terceiro não é fila, é uma recusa com spinner.
4. **A falha é correlacionada com o momento de valor do cliente.** As pessoas religam um ambiente pausado
   porque *alguém vai olhar agora*: uma demo, uma reunião, um deploy, um cliente do cliente. A recusa cai
   exatamente aí.
5. **Há uma aresta comercial e jurídica.** O cliente pausado **paga a tarifa de disco** (`07` P5, Start
   R$ 2,50/mês) exatamente pela promessa de retomar. Recusar o `start` enquanto se cobra pelo direito de
   retomar é vender algo que não se entrega. Com 12 clientes e sem SLA (`07` §3.10.10), isso não vira
   processo — vira churn e um post público, que a base de 11 clientes do `07` §3.10.10 já mostra custar
   **8× mais que o medidor congelado numa queda de 24 h**.

**Veredito/Correção.**

> **O `start` de um ambiente vendido NUNCA pode ser recusado nem enfileirado. É invariante do produto.**
> A única forma de garantir isso é `Σ MemoryMax de todos os ambientes provisionados no nó ≤ vendável`
> (Achado 1.4). Tudo o mais é uma promessa condicionada a estatística.
>
> **Corolário:** o 409 do `06` §1.4 muda de alvo. Ele passa a valer para **criação** e para **upgrade de
> plano** — operações em que o cliente está diante de um formulário, esperando uma resposta, e onde
> "não há capacidade neste nó, criando no outro" é uma resposta legítima e barata. Nunca para o `start`.

**O que precisa ser escrito no Ciclo 3, e não está em lugar nenhum:**

| Evento | Resposta especificada hoje | Resposta arbitrada |
|---|---|---|
| `start` de ambiente vendido | 409 (`06`) × fila (`07`) | **sempre 202. Impossível faltar capacidade, por invariante de venda** |
| Criação de ambiente novo, nó cheio | 409 (`06`) | **409 no nó, e o escalonador cria no outro nó** (aqui o fallback do `07` funciona, porque não há dado para mover) |
| Upgrade de plano que não cabe | não especificado | **409 com o número de folga + botão "migrar para o outro nó" com a janela estimada** |
| Frota inteira cheia | não especificado | **fila de espera comercial, com o cliente sabendo que está numa fila**, e o gatilho do `07` §3.10.9 disparado |

---

## 1.5 VEREDITO DO CONFLITO PRINCIPAL

> ## A frota de produção tem **14 ambientes**, não 22.
>
> **7 por nó no mix de 1.382 MB, postura garantida, sem overcommit sobre o vendido.**
>
> O `06` tem razão no número **e no argumento**, mas por um caminho parcialmente errado: a reserva de
> 2 GB foi somada em vez de dimensionada (Achado 1.3) e não é ela que derruba a frota — é a soma dos
> planos do mix. O `07` tem razão em exigir aritmética, e a aritmética dele **é internamente correta e
> operacionalmente falsa**, porque o fallback do admission control (mudar de nó) não existe nesta
> arquitetura (Achado 1.5).
>
> **A `06` §1.6 vence. A `07` §3.3 e §3.10.2 são revogadas.**

**Ressalva importante que nenhum dos dois documentos faz: 14 é um número de MIX, não de física.**
O mix de 1.382 MB foi **inventado** no `07` §3.3 ("Mix de planos assumido"), e ele embute 10% de Pro
(4 GB). Contra 10.500 MB vendáveis por nó:

| Mix vendido | Por nó | **Frota** |
|---|---:|---:|
| Só Start (512 MB) | 20 | **40** |
| Só Light (1 GB) | 10 | **20** |
| 50% Start + 50% Light | 13 | **26** |
| **Mix do `07` (30/40/20/10)** | **7** | **14** |

> **Recomendação comercial que decorre da arbitragem:** na fase 1, **restringir o catálogo vendável a
> Start e Light, com no máximo 1 Plus por nó e zero Pro.** Um único Pro consome **38% do vendável de um
> nó inteiro** — 2 dos 7 slots do mix. Isso não é uma restrição de produto (o `07` §3.10.8 já manda
> recusar quem não cabe em 4 GB); é a diferença entre 14 e 26 ambientes com a mesma infraestrutura.
>
> **Planejar para 14. Vender para 20–26.**

---

## 1.6 A economia refeita com 14 — e o impacto no ponto de equilíbrio de 17

### Achado 1.6 — Com 14 ambientes, o ponto de equilíbrio de 17 ativos passa a estar ACIMA do teto físico. Não é apertado: é inatingível

**Severidade: Bloqueador (de expectativa)**

**Evidência.** `07` §3.10.4:
> *"Ponto de equilíbrio de caixa = 1.027 ÷ 63,99 = 16,05 → **17 ambientes ativos**. Teto físico de
> ambientes ativos simultâneos = 17,04. **O ponto de equilíbrio fica em 94% do teto físico da frota.**"*

O teto de 17 do `07` vem de **23,0 GB ÷ 1,35 GB**, onde 23,0 GB = 11,5 × 2 — **o teto bruto, sem a
reserva operacional do `06` §1.6**. O `07` nunca aplicou a reserva. Com a arbitragem (10.500 MB vendáveis
por nó, 21.000 MB na frota, balanceamento apertado do `06` §8.1.1 limitando a 7+7):

**A conta refeita:**

| | `07` §3.10 (22 vendidos / 17 ativos) | **Arbitrado (14)** | Δ |
|---|---:|---:|---:|
| Ambientes vendidos (teto) | 22 | **14** | **−36%** |
| Ambientes ativos simultâneos (teto) | 17 | **14** | −18% |
| Fração ativa máxima sustentável | 77% | **100%** | — |
| Receita bruta máxima da frota | R$ 1.144/mês | **R$ 918/mês** | **−20%** |
| Receita líquida (−1,7% PSP, −R$ 0,45 backup) | R$ 1.115 | **R$ 896** | −20% |
| Custo fixo | R$ 1.027 | R$ 1.027 | 0% |
| **MARGEM BRUTA MÁXIMA** | **+ R$ 88/mês** | **− R$ 131/mês** | **−R$ 219** |
| Com o tempo do dono (14 clientes ≈ 3 h × R$ 80) | − R$ 162 | **− R$ 371/mês** | −R$ 209 |
| Custo fixo por ambiente vendável | R$ 46,68 | **R$ 73,36** | **+57%** |
| **Ponto de equilíbrio de caixa** | **17 ativos** (94% do teto) | **17 ativos** (**121% do teto**) | |

> ## Com todas as letras
>
> **A frota de produção não tem ponto de equilíbrio. Não "não tem folga" — não tem ponto de equilíbrio.**
>
> O `07` §3.10.4 já havia dito que, contando o tempo do dono, o equilíbrio (20 ativos) ficava acima do
> teto (17). **Com a densidade arbitrada, o equilíbrio de CAIXA — sem contar uma hora do trabalho de
> ninguém — fica acima do teto físico.** Faltam **3 ambientes que não existem**, equivalentes a
> **R$ 192/mês que não podem ser faturados a nenhum preço, com nenhuma ocupação, com nenhum esforço de
> vendas.**
>
> **O melhor cenário possível desta infraestrutura — 14 ambientes vendidos, todos ligados 24×7, preço de
> tabela cheio, zero desconto, zero inadimplência — é um prejuízo de caixa de R$ 131/mês, ou R$ 371/mês
> com o trabalho do dono precificado. R$ 4.452 por ano no melhor caso possível.**

**Três consequências que precisam entrar no plano hoje:**

1. **O gatilho mais importante do plano financeiro está quebrado.** `07` §3.10.9 condição (a): *"contratar
   um nó de 64 GB quando **15 ambientes ativos simultâneos** (88% do teto de 17) por 14 dias corridos"*.
   **Com teto de 14, a condição de 15 nunca ocorre.** O gatilho que o próprio `07` §3.10.11 chama de
   *"a decisão mais importante do plano financeiro"* está condicionado a um evento impossível.
   → **Reescrever para: 12 ambientes ativos (86% de 14) por 14 dias corridos**, mantendo as condições
   (b), (c) e (d). E baixar (c) de R$ 900 para **R$ 750/mês** (82% da receita máxima de R$ 918).
2. **A política de "máximo 12 clientes / 15 ambientes" do `07` §3.10.8 estoura o teto.** 15 ambientes
   provisionados **não cabem em 14**. → Corrigir para **máximo 12 clientes / 12 ambientes**, deixando
   2 slots (14%) de folga — que é o que permite absorver um erro de dimensionamento e um cliente que
   cresce, exatamente como o `07` argumentou.
3. **Preço não resolve, e o `07` §3.10.7 já provou isso.** Para 14 ambientes empatarem no caixa, o preço
   teria de subir **1,215×** (Light de R$ 49,00 → R$ 59,55; Start de R$ 30,50 → R$ 37,06), colocando o
   Light **33% acima do Hostoo**. A decisão do `07` §3.10.7 de **não subir preço** continua correta, e
   agora com mais força.

**As três alavancas que existem de verdade, em ordem de retorno:**

| Alavanca | Economia/ganho | Efeito no equilíbrio | Veredito |
|---|---:|---|---|
| **Vender só Start + Light na fase 1** (Achado 1.5, ressalva) | +6 a +12 ambientes | teto vai de 14 para **20–26**; equilíbrio de 17 volta a ser atingível **com folga** | **FAZER. É gratuito e é uma decisão comercial, não de infra** |
| **Cortar o helpdesk pago** (Crisp/Chatwoot Cloud, R$ 130/mês, `07` §3.10.3) | −R$ 130/mês | equilíbrio cai de 17 para **15 ativos** | **FAZER.** Com 12 clientes, e-mail + a tela de tickets do próprio painel bastam. R$ 130/mês para 12 clientes é R$ 10,83 por cliente por mês num produto de R$ 30,50 |
| **Corrigir a linha de observabilidade** (R$ 32/mês, Achado 4.7) | −R$ 32/mês | equilíbrio cai mais 0,5 | **FAZER.** É erro contábil, não economia: não é desembolso |
| Cortar o nó de teste | −R$ 250/mês | equilíbrio cai para **13 ativos** | **NÃO FAZER.** Ver Achado 9.3 — é a única rede de segurança de uma frota de 2 nós, e o §6 desta crítica o transforma no ambiente do piloto |

**Com as três alavancas gratuitas** (catálogo Start+Light, sem helpdesk pago, contabilidade corrigida):
custo fixo **R$ 865/mês**, teto **20–26 ambientes**, equilíbrio **14 ativos = 54–70% do teto**.
**Isso é um laboratório com uma unidade econômica defensável.** É a única versão desta frota que fecha.
