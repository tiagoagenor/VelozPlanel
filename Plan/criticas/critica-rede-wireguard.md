# Crítica dedicada — Rede Privada WireGuard (doc 13)

> Papel: Crítico / Red Team de Redes & Segurança.
> Alvo: `especialistas/13-rede-wireguard.md` (todas as decisões W1–W10, §1–§10).
> Método: ataque por achado. Nada de resumo nem elogio — só onde fura, onde a afirmação não se sustenta,
> e onde o especialista foi otimista.
> Cruzamentos: `00-BRIEFING` ADENDOS 3/4/5/6; `04` §8; `06` §2/§8; `09` §1; `12` §3; `ciclo-1-critica`
> Conflito 4; `ciclo-2-critica`.
> Formato por achado: **Severidade → Evidência → Por que é problema → Veredito/Correção.**

---

## Ataque 1 — A regra "painel cai, sites no ar" sobrevive?

### Achado 1.A — Nó público direto: a regra sobrevive. Confirmado.
**Severidade: Baixo (validação positiva).**
**Evidência:** `13` §1.2 item 1 e §7 (tabela). Nó público serve visitante pela borda em disco (`03` §1.6,
`04` §6); a `wg0` não entra no caminho de request.
**Por que analisei:** era a afirmação mais fácil de o especialista inflar.
**Veredito:** **Refuto a suspeita — aqui ele está certo.** Com o hub fora, o nó público continua servindo
porque não toca a WG para nada. Nenhuma ressalva.

### Achado 1.B — Opção A com o hub fora: sobrevive, MAS só o que já estava provisionado.
**Severidade: Médio.**
**Evidência:** `13` §1.2 item 2 e §7 afirmam "Opção A não depende do hub" porque a aresta
`nó público ↔ nó local` é direta (spoke↔spoke). Config estática em disco nos dois lados (`13` §1.5 b/c),
ambos com `PersistentKeepalive=25`.
**Por que é problema:** a prova está **incompleta**. A aresta direta de fato não faz hairpin no hub e
sobrevive a re-handshake sem o hub (o nó local disca o nó público em endpoint fixo `203.0.113.10` — isso
funciona sem o hub). Mas o **plano de controle da própria malha é o hub**: alocar `/32`, registrar peer,
emitir os dois jobs de vhost (`13` §3.6), criar a aresta `wg.add_optionA`. Com o hub fora **você não
consegue criar um novo ambiente Opção A nem refazer a aresta de um nó novo** — só os pares já em disco
continuam. O especialista vende "Opção A não depende do hub" como se fosse absoluto; é verdadeiro para
*servir o que já existe*, falso para *provisionar/reparar*.
**Veredito/Correção:** **Aprovado com ressalva.** Reescrever §1.2/§7 para: "a Opção A **já provisionada**
sobrevive à queda do hub; **criar ou reparar** uma aresta Opção A exige o hub, como qualquer operação de
gerência." E ser duro no texto do dono: um site em Opção A depende de 3 coisas (§7) e continua
**estritamente menos disponível** — ver Ataque 3.

---

## Ataque 2 — TLS termina no nó público, HTTP claro pela WG (W5). Aceitável?

### Achado 2.A — O especialista ignorou a terceira opção (TLS passthrough) e escolheu a pior para o modelo de ameaça que ele mesmo cita.
**Severidade: Alto.**
**Evidência:** `13` §3.3 e W5 apresentam a decisão como **binária**: "terminar no nó público (barato)"
vs "re-cifrar com `proxy_ssl` na perna WG (dobra CPU, cert no nó local, zero ganho)". Conclui pela
terminação na borda pública porque "quem está na WG já é peer autenticado por chave".
**Por que é problema:** há uma **terceira opção que o doc não considerou — TLS *passthrough* (proxy L4 /
stream, roteando por SNI)** — e é justamente ela que resolve a ameaça que o próprio briefing nomeia
("provedor do nó público bisbilhota"). Análise por ameaça:
- **Provedor do nó público curioso/hostil.** Com o TLS terminando na borda pública, o **texto claro e a
  chave privada do certificado vivem no nó público**. O provedor dele (ou quem tiver a VM/RAM/disco)
  lê tudo — **independentemente** de a WG cifrar o fio depois. Re-cifrar até o nó local **não ajuda**
  (o claro já apareceu no nó público). Só o **passthrough** (o nó público nunca decifra; o TLS termina
  no nó local, cert e chave em casa) protege contra esse provedor. O especialista **descartou essa
  ameaça** com a frase "peer autenticado por chave" — que responde a *outra* pergunta (quem entra na WG),
  não a "quem lê o claro no nó público".
- **Chave WG do fronte vaza.** WireGuard usa Noise IK com chaves efêmeras e **PFS**: com a chave estática
  do fronte, um atacante **passivo** que gravou tráfego **não** decifra sessões passadas. Um atacante
  **ativo e on-path** pode se passar pelo fronte e fazer MITM da perna DC↔casa. Baixa probabilidade, mas
  note: **o plano de dados do visitante tem uma única camada (a WG)** — o mTLS "defesa em profundidade"
  de `13` §2 protege **só o control plane**, não o tráfego do visitante. Comprometeu a WG do fronte =
  claro do visitante exposto, sem segunda camada.
- **Custo real do passthrough:** quase zero de CPU (não decifra), e **tira o certificado do nó público**.
  Preço: o fronte vira cano L4 burro — perde WAF, `proxy_cache` na borda (Ataque 3 fica pior), e injeção
  de XFF; o ACME DNS-01 passa a rodar no **nó local**. É um trade-off real, não um almoço grátis.
**Veredito/Correção:** **Reprovado como recomendação absoluta.** A escolha de W5 é defensável **apenas sob
uma premissa que o doc nunca declara: "você confia no provedor do nó público".** Correção obrigatória:
1. Declarar essa premissa explicitamente em W5.
2. Oferecer **`serving_mode='wg-passthrough'`** (TLS termina no nó local, SNI-routing no fronte) para o
   caso "não confio no fronte / o dado é sensível e mora em casa de propósito" — que é metade da
   motivação de anexar um servidor local. Não é o `proxy_ssl` que ele já rejeitou; é mais barato que ele.
3. Registrar que o **plano de dados do visitante não tem defesa em profundidade** (só WG), ao contrário
   do control plane.

---

## Ataque 3 — Banda e disponibilidade da Opção A. A conta.

### Achado 3.A — A conta de banda do especialista está certa, mas branda; a de "visitantes simultâneos" é devastadora.
**Severidade: Alto.**
**Evidência:** `13` §3.5 tabela: 1,5 MB/página → ~2 req/s @25 Mbps up; 5 MB → <1 req/s.
**Conta refeita (WordPress típico, ~2 MB/página com imagens):**
- Upload 25 Mbps = 3,125 MB/s. Página 2 MB → **~1,5 página/s sustentada** (−5% de encap WG → ~1,4).
- "Simultâneos" é o número que dói: para uma página de 2 MB carregar em ~2 s, aquele visitante consome
  **8 Mbps** durante 2 s. 25 Mbps de upload servem **~3 carregamentos simultâneos** antes de enfileirar.
  Ou seja: **~3 páginas concorrentes / ~1,5 página-view/s**. Isso é um blog pessoal, não uma loja.
- Mitigação real (`proxy_cache` na borda, `04` §6.4) só ajuda o **estático cacheável**; HTML de WordPress
  logado/dinâmico não cacheia e sobe inteiro pelo upload. E o passthrough (Ataque 2) **elimina** essa
  mitigação (a borda não vê o claro para cachear) — os dois remédios brigam.
- Residencial BR é assimétrico (300/30, 400/50) e sem SLA; CGNAT e jitter pioram (Ataque 6).

**Disponibilidade composta (cadeia de 3):**
| Elo | Disponibilidade realista |
|---|---|
| Nó público (VPS) | ~99,9% |
| Aresta WG (reconexão em troca de IP, §1.4) | ~99,5% |
| Link residencial (sem SLA, quedas/energia/PPPoE/IP) | **~99,0%** (otimista) |
| **Composta (produto)** | **~98,4%** → **~11,5 h/mês fora** |

Mesmo com casa a 99,5%: composta ~98,9% → ~8 h/mês. Um nó público direto sozinho: ~99,9% → ~43 min/mês.
**A Opção A é ~10–20× menos disponível que servir direto.**
**Veredito/Correção:** **A Opção A NÃO deve ser oferecida a cliente pagante.** Serve para os sistemas do
próprio dono (dev/staging/projeto pessoal/homelab) — exatamente o caso do ADENDO 6. A UI deve **proibir**
`wg-proxy` para ambientes de cliente pagante (ou exigir aceite explícito de "sem SLA, sua internet de
casa é o teto") e o catálogo não pode listar isso como plano. Ver Veredito final.

---

## Ataque 4 — O container fica MESMO fora da WG? Auditoria das três barreiras.

### Achado 4.A — Barreira 1 ("faixa 10/8 já bloqueada no egress") é ILUSÓRIA para o caminho da WG.
**Severidade: Médio.**
**Evidência:** `13` §4.1 barreira 1 e W2 vendem a escolha de `10.77.0.0/16` como "defesa em profundidade
de graça" porque a regra de `04` §8.2 `iif $LAN oif $WAN ip daddr {10.0.0.0/8,...} drop` "já derruba".
A regra real (`04` §8.2, linha confirmada) é **`iif $LAN oif $WAN`** — escopada em `oif $WAN` (eth0).
**Por que é problema:** quando a `wg0` está de pé, um pacote de container para `10.77.x` roteia **`oif
wg0`, não `oif $WAN`** — logo **não casa** com a regra de egress e a barreira 1 **não dispara**. Ela só
protege o caso degenerado (WG caída, o pacote vaza para a WAN). Quem realmente contém o caminho vivo é a
**política `drop` default do forward** (`04` §8.2 `policy drop`) + a **barreira 3 explícita** (`iif $LAN
oif $WG drop`). O especialista atribui a contenção a uma regra que, no caminho que importa, é inerte —
e usou essa atribuição falsa para justificar a **própria escolha de faixa (W2)**.
**Veredito/Correção:** **A contenção continua de pé** (default-drop + barreira 3), mas a **justificativa
está errada**. Corrigir §4.1/W2: barreira 1 protege apenas o caso "WG caída, tráfego vaza para WAN"; a
proteção do caminho `container→wg0` é default-drop + barreira 3. Não vender como "de graça".

### Achado 4.B — As barreiras assumem nftables artesanal (Incus/`04`); o runtime escolhido é Docker (`06`), que reescreve o FORWARD.
**Severidade: Alto.**
**Evidência:** `13` §4.1/§4.2 escrevem `iif $LAN oif $WG drop` no `chain forward` do ruleset de `04`
(bridge `vlz0`, mundo Incus). Mas `06` §2.1/§10 padronizou **Docker** (`docker run`, `docker exec`,
`docker stop`) — e `04` é Incus (`incus network create vlz0`). Os dois docs **já se contradizem no
runtime**, e o `13` herda a ambiguidade.
**Por que é problema:** o Docker **gerencia suas próprias regras** (iptables/nftables) e insere cadeias
`DOCKER`/`DOCKER-USER` com prioridade que pode **contornar** um `iif $LAN oif $WG drop` colocado no
`forward` manual, dependendo da ordem de hooks e de `bridge-nf-call`. A barreira 3 — que passou a ser a
que **de fato** contém o container (Achado 4.A) — pode ser **silenciosamente ignorada** se as regras não
estiverem na **`DOCKER-USER`** (o único ponto que o Docker respeita para filtragem de usuário). O
especialista não menciona Docker, DOCKER-USER, nem a colisão de gerência de firewall — escreveu para o
mundo Incus de `04`.
**Veredito/Correção:** **Bloqueador de implementação enquanto o runtime não estiver decidido.** Se o
runtime é Docker (`06`), **todas** as barreiras de forward do `13` §4 precisam ir para `DOCKER-USER`, com
teste de regressão que prove `container→wg0` = drop **com o Docker no ar**. Reconciliar `04` (Incus) vs
`06` (Docker) é pré-requisito — a segmentação da WG depende de qual é.

### Achado 4.C — Caminho de fuga procurado: RCE no container (inclusive tier de banco dedicado e Opção A) — NÃO encontrei fuga, mas a regra de input do hub está errada.
**Severidade: Médio.**
**Evidência/varredura:** testei os alvos a partir de um container com RCE no nó local em Opção A:
- `→ 10.77.2.1` (wg0 do próprio host): input hook, cai em `iif $LAN drop` (`04` §8.2). Contido.
- `→ 10.77.1.1`/`10.77.0.1` (fronte/hub, via forward): default-drop + barreira 3. Contido.
- **Tier "banco dedicado"** (`04` §8.4, container extra de MySQL/PG): é outro container em `10.60.x`,
  contido pela **mesma** fronteira `vlz0↔wg0` — o tier de banco **não abre caminho novo** para a WG.
- Bind do listener Opção A: `13` §3.2 usa `listen 10.77.2.1:8071` (nunca `0.0.0.0`) — disciplina correta;
  mesmo um bind errado em `0.0.0.0:8071` seria barrado do container por `iif $LAN drop` (8071 não está na
  allowlist de input).
Resultado: **não achei a fuga do container** — a contenção segura (via default-drop + barreira 3 +
input-drop), *desde que* o Achado 4.B (Docker/DOCKER-USER) seja resolvido.
**MAS** encontrei outro furo em `13` §4.2: a regra `iif $WG ip saddr $WG_HUB tcp dport 443 accept`,
declarada como "ADIÇÃO ao nftables de **CADA NÓ**". No **hub**, `WG_HUB=10.77.0.1` é o **próprio**
endereço; o tráfego que chega ao hub vem com `saddr` = spoke (`10.77.1.1`…), **nunca** `10.77.0.1`. Logo,
aplicada literalmente ao hub, essa regra **derruba todo o control plane** (o hub cairia em `iif $WG drop`
sem nunca aceitar o 443 dos spokes). A regra é escrita da ótica do spoke, mas o texto manda aplicá-la em
"cada nó".
**Veredito/Correção:** **Aprovado com correção.** (1) Fechar o Achado 4.B. (2) Corrigir §4.2: separar o
ruleset por papel — no **hub**, `iif $WG tcp dport 443 accept` (de qualquer spoke, mTLS filtra o resto);
no **spoke**, o listener 443 na wg0 nem existe (o agente disca de saída), então a regra do spoke é
desnecessária. Um ruleset "de cada nó" único está factualmente errado.

---

## Ataque 5 — Latência BR↔EUA dentro da WG.

### Achado 5.A — WG não muda a latência transcontinental; a decisão de NÃO usar WG para backup/migração está certa — exceto que o nó local não tem alternativa a SSH-direto.
**Severidade: Médio.**
**Evidência:** `13` W7 e §5.2: migração continua **SSH direto pela internet** (`06` §8.2), backup vai
**direto** ao object storage (`09` §5) — a WG carrega só control plane + Opção A. `12` §3 fixa RTT BR↔EUA
110–180 ms.
**Por que é problema:** a WG em si adiciona latência desprezível (cripto ChaCha20 é µs); o custo é a
fragmentação/perda no caminho transcontinental (MTU, §1.4). Concordo em **não** fazer hairpin de
backup/migração pela WG cross-region — seria desperdício. **PORÉM** há uma contradição não vista: `06`
§8.2 assume que a migração é **SSH direto pela internet**, o que exige **IP público de entrada no
destino/origem**. O **nó local atrás de NAT não tem isso** — você não faz `ssh n-local` de fora. Então,
para migrar um ambiente **de/para o nó local**, ou o nó local **inicia** a sessão SSH de saída, ou a
transferência vai **pela WG** — exatamente o que W7 diz que não acontece. O especialista fechou W7 sem
tratar o único nó que a WG existe para servir.
**Veredito/Correção:** **Aprovado com correção.** W7 vale para nós públicos. Para o **nó local**,
documentar que migração/evacuação usa **SSH iniciado pelo nó local** (saída) ou a perna WG — e que
evacuar um nó local (`06` §8.3) exige destino que também aceite `wg-proxy` (ou o ambiente vira `direct`
ao ganhar IP público, como o próprio `13` já anota para `06`).

### Achado 5.B — Heartbeat/usage por dentro da WG transcontinental: não congela cobrança, mas reduz a diversidade de caminho e pode flapar contra o fallback de 5 min.
**Severidade: Médio.**
**Evidência:** `13` §5.3 roteia heartbeat/usage/métricas pela WG (para `10.77.0.1`). `13` §2 promete
**fallback mTLS público após >5 min** de handshake WG falho. `12` §3.3 já eleva limiares us-east1 para
90 s/240 s e §3.3 corrige o bug do outbox (amostra represada descartada).
**Por que é problema:** (1) **Cobrança não congela** — eventos faturáveis acumulam no outbox de 72 h com
prioridade (`12` §3.5.3, `03` §1.6). Um falso "unreachable" gera **ruído de alerta**, não perda de
faturamento — *desde que* a correção do bug de `12` §3.3 (separar `event_time`/`received_at`) esteja
aplicada; se não estiver, o represamento vira descarte, e agora com uma camada WG a mais de estol.
(2) O **fallback não adiciona disponibilidade real** na partição transcontinental: WG e mTLS-público
atravessam o **mesmo link físico** BR↔EUA — partição derruba os dois. O fallback só salva do caso "bug
de WG", não do caso "link caiu". (3) O piso de 5 min do fallback interage mal com jitter transcontinental
(reconvergência de 2–5 s, `12` §3.3): handshakes WG intermitentes podem ficar no limbo antes do fallback.
**Veredito/Correção:** **Aprovado com correção.** (1) Tornar o bug de `12` §3.3 **pré-requisito** de rotear
usage/heartbeat pela WG (senão a WG piora o descarte). (2) Escrever em §2 que o fallback mTLS **não** é
diversidade de caminho cross-region (mesmo fio) — só cobre falha de WG local. (3) Cross-region, manter
os limiares de `12` §3.3 e **não** deixar o estol de WG resetar o outbox.

---

## Ataque 6 — NAT traversal e IP residencial mutável.

### Achado 6.A — "DDNS dispensado" está correto; "keepalive=25 basta para residencial" é otimista contra CGNAT.
**Severidade: Médio.**
**Evidência:** `13` §1.4/W9: nó local sempre inicia; `PersistentKeepalive=25`; roaming reendereça sozinho;
"DDNS não é necessário". `13` §10.2 Runbook 11 cobre "IP mudou" (reconecta ~25 s; restart se >2 min) e
"handshake nunca acontece (UDP/51820 bloqueado)".
**Por que é problema:**
- **DDNS dispensado: correto.** Nada disca *para dentro* do nó local — ele é sempre quem inicia; nenhum
  peer usa o nome dele como `Endpoint`. Validado, sem ressalva.
- **keepalive=25 é otimista para o Brasil residencial.** Boa parte das conexões está atrás de **CGNAT**
  (carrier-grade NAT), cujo timeout UDP e reciclagem de porta podem ser **mais agressivos que 25 s** e,
  pior, o IP:porta público é **compartilhado e pode mudar sem o cliente mudar de "IP"**. keepalive=25
  pode ser lento demais; **15 s** é a margem segura para residencial/CGNAT. O doc trata NAT residencial
  como "expira 30–120 s" — verdade para NAT doméstico simples, otimista para CGNAT.
- **IP muda no meio de um handshake:** um handshake é 1-RTT com retry a cada ~5 s; se o IP troca
  exatamente durante as duas mensagens, falha e refaz — **desprezível**. O problema real não é o
  handshake, é a **queda sustentada** (re-auth PPPoE noturno, energia): durante ela o site em Opção A
  fica **fora**, e na volta são ~25–60 s + re-handshake.
**Veredito/Correção:** **Aprovado com correção.** Default de keepalive para papel `local` = **15 s** (não
25); manter 25 para datacenter. Documentar CGNAT como caso esperado no BR.

### Achado 6.B — "Nó local some por 4 h": o doc cobre o diagnóstico, não a política (sites fora + cobrança + comunicação).
**Severidade: Médio.**
**Evidência:** `13` §7 e Runbook 11 cobrem "túnel caído" e "link de casa caiu" no nível de **diagnóstico**
(`wg show`, `ping 10.77.0.1`, MTU). Não há política para **4 h de ausência**.
**Por que é problema:** com o nó local fora 4 h, **todos os ambientes Opção A dele ficam fora 4 h** (o dado
mora lá; não há o que servir — 502/503 branded). Para cliente pagante, 4 h é outage inaceitável (reforça
Ataque 3). E o doc **não diz o que a cobrança faz**: o ambiente segue "running" no CP? Marcar "unreachable"
suspende/credita algo? Como o cliente é avisado? O metering de banda mostra zero, mas a cobrança do plano
(RAM reservada) continua — provavelmente correto (é a internet **do cliente/dono** que caiu), mas o doc é
**silencioso**. Runbook 11 diagnostica; não define SLA/comunicação/crédito.
**Veredito/Correção:** **Aprovado com correção.** Como a recomendação final é **Opção A só para o dono**,
a política pode ser simples: "Opção A = best-effort, sem SLA, sem crédito; queda do link de casa = site
fora até voltar; cobrança do plano segue". Escrever isso explicitamente e adicionar ao Runbook 11 o item
"nó local offline por horas: o que o visitante vê, o que a cobrança faz".

---

## Ataque 7 — Complexidade vs porte. Over-engineering?

### Achado 7.A — O núcleo é bem-dimensionado; a ambição (WG como transporte padrão de todo nó público + zona DNS interna + capability + canary) é over-engineering para 2–4 nós em fase de validação.
**Severidade: Alto.**
**Evidência:** frota real (ADENDO 3): **2 VPS de produção + 1 de teste + 1 local**, CP no BR (`12` §3).
O `13` entrega: hub-and-spoke + arestas seletivas + `10.77.0.0/16` com 5 sub-blocos + zona
`*.wg.veloz.internal` (PowerDNS view) + `network.overlay` capability + módulo com 8 hooks + 3 tabelas +
DDL + canary de 10 min + fallback mTLS + rotação de chave — para ≤4 nós.
**Por que é problema:** o pedido do dono (ADENDO 6) é literalmente *"máquina na mesma rede"* + anexar **um**
servidor local sem IP público via Opção A. O mínimo que atende:
- **UMA** `wg0`, hub = CP. O nó local peia com o hub (gerência) e com **um** nó público (aresta Opção A).
  São **2–3 peers no total.**
- **Para 2 nós públicos que já têm IP público, a WG não resolve problema nenhum** — eles já são
  alcançáveis por mTLS pela internet. Tornar a WG o **transporte preferencial** deles (W4) **adiciona**
  uma dependência ("gerência depende da WG", que o próprio §2 admite como "piora") por **zero ganho
  funcional** nesta fase. É o exemplo clássico de complexidade que a crítica do Ciclo 1 (Conflito 4,
  "over-engineering absurdo para 3 VPS") mandou cortar.
**O que cortar para a fase piloto:**
1. **WG só onde é obrigatória: o nó local.** Nós públicos ficam em **mTLS pela internet** até a frota
   passar de ~5 nós. Isso elimina W4 (transporte preferencial WG em nó público) e o fallback como peça
   crítica agora.
2. **Cortar a zona DNS interna PowerDNS view** — ficar no `/etc/hosts` versionado (o doc já oferece como
   fase 1; promover isso a **a** solução).
3. **Adiar `network.overlay` capability** e a UI de rede completa enquanto houver **1** fronte.
4. **Adiar `cf-tunnel`** (o doc já diz "fora da fase 1" — manter).
5. Manter: `/32` por peer, keepalive, MSS clamp, as barreiras de container (corrigidas nos Ataques 4).
**Veredito/Correção:** **Reprovado como escopo de fase 1.** O **núcleo** (WG para o nó local: 1 peer hub +
1 aresta fronte) está certo e é enxuto. A **ambição** (WG default em todo nó público, DNS interno,
capability, canary para 4 nós) é over-engineering coerente com o vício que o Ciclo 1 já apontou. Cortar
para "WG só onde é mandatória".

---

## Ataque 8 — Contradições com os documentos existentes.

### Achado 8.A — NATS: o resquício é bem maior do que o especialista sinalizou — o doc 13 inteiro repousa sobre uma mudança que NÃO foi aplicada ao doc 03.
**Severidade: Bloqueador (de coerência do corpus).**
**Evidência:** `13` §2 e "O que isto muda" mandam "trocar NATS por Postgres/long-poll" em `03` §1.4 e `12`
§3.2. Mas `03` **continua inteiro em NATS**: D2 (decisão de transporte = **NATS JetStream**), §1.4
("Comunicação CP↔nós: NATS JetStream (decisão única)"), §5.1 (outbox p/ NATS), R1, R12, diagramas
mermaid (`NATS <-.-> N2`), e a stack Go (`nats.go`). `12` §3.2 ("publica no NATS"). O `ciclo-1-critica`
Conflito 4 (Achados 4.1–4.4 + Ação #9) **mandou cortar NATS** e reescrever `03` §1.4/§5.1 para
Postgres+long-poll — **e essa reescrita nunca foi feita** nos docs.
**Por que é problema:** todo o §2 do `13` ("o agente disca `https://10.77.0.1/agent/v1/...` long-poll,
mTLS por cima, endpoint binda na wg0") **só é válido se o NATS realmente sumiu**. Se alguém implementar
`03` como está escrito (JetStream no CP), "bindar o NATS na wg0" é **outro desenho** e o §2 do `13` fica
no ar. O especialista rebaixou um **bloqueador de corpus** a um footnote ("resquício, trocar").
**Veredito/Correção:** **Bloqueador.** Não é culpa do `13` (ele aponta o resquício), mas o `13` **depende
de uma mudança não aterrissada**. Antes de aprovar o `13`, executar a Ação #9 do Ciclo 1: reescrever `03`
§1.4/§5.1 e `12` §3.2 para Postgres+long-poll+WebSocket, arquivando o desenho NATS. Sem isso, `13` §2 é
incoerente com a arquitetura oficial.

### Achado 8.B — Faixas de IP: 10.77 e 10.60 coexistem, mas o container-net está inconsistente entre docs (e o doc 13 herda isso).
**Severidade: Baixo.**
**Evidência:** WG = `10.77.0.0/16` (`13` §1.3); container-net = `10.60.0.1/16` em `04` §8.1 (um **/16**),
mas `09` §1 comenta "rede **10.60.0.0/24** é interna ao nó" e usa `10.60.1.99` (`09` linha 796 — fora de
um /24, dentro de um /16), sob o nome **`veloz-br0`** (`09`) vs **`vlz0`** (`04`) vs **Docker** (`06`).
**Por que é problema:** `10.77.0.0/16` e `10.60.0.0/16` **não se sobrepõem** — coexistem sem colisão, e a
resposta à pergunta do briefing é **sim, convivem**. Não colide com defaults do Docker (`172.17/16`,
`192.168`) nem com residencial (`192.168`, `10.0.0.x`). A afirmação de W2 ("não colide com 10.60") está
**correta quanto à faixa**. O ruído é **pré-existente e não é da WG**: /16 vs /24 e três nomes de bridge
espalhados por `04`/`06`/`09`. Mas o `13` cita `vlz0` e `10.60.0.71` assumindo o mundo `04`/Incus (ver 4.B).
**Veredito/Correção:** **Aprovado.** Registrar que a colisão de faixas **não existe**; sinalizar aos donos
dos docs `04`/`06`/`09` a inconsistência /16-vs-/24 e o nome da bridge (fora do escopo do `13`, mas o `13`
não deve herdar `vlz0` sem reconciliar — ver 4.B).

### Achado 8.C — Egress SMTP: "nada muda" é verdade para o bypass, mas o caminho de e-mail do container no nó local não foi validado.
**Severidade: Médio.**
**Evidência:** `13` §4.4 diz "egress SMTP (`04` §8.3): nada muda; a WG não vira bypass". `04` §8.3: msmtp
no container → `smtp-relay.velozpanel.internal:587`; `04` §8.2 **bloqueia 25/465/587 no egress
`container→WAN`** e a chain de **input** só libera `$LAN` para 53/9797/3306/5432 — **não 587**.
**Por que é problema:** o "a WG não é bypass do bloqueio de spam" está **certo** (container não entra na
wg0, §4.1). Mas fica uma **pergunta que o `13` deveria ter fechado para o nó local**: como um site em
Opção A **manda e-mail**? O relay central é alcançável do container por qual porta? 587→WAN está
bloqueado; 587→host(`10.60.0.1`) não está na allowlist de input; e o container não está na WG. Ou o relay
roda local ao nó com uma exceção nftables, ou o e-mail do nó local **não sai**. É gap herdado de `04`,
mas **mais agudo no nó local** (não há caminho alternativo).
**Veredito/Correção:** **Aprovado com ressalva.** O `13` deveria anotar como o e-mail do site em Opção A
alcança o relay (regra de input `iif $LAN ... :587 accept` para um relay host-local, ou destino liberado)
— senão sites em Opção A não enviam e-mail. Encaminhar a `04` a validação do caminho msmtp→relay.

### Achado 8.D — Banco por /32 e "WireGuard do cliente": o especialista acertou a distinção — validação positiva.
**Severidade: Baixo (validação positiva).**
**Evidência:** `13` §5.1/W8 e `09` §1.6 nível 3 ("WireGuard do cliente" add-on). O `13` insiste que a
`wg-cliente` (add-on de acesso do cliente ao próprio `10.60.0.1`) é **interface separada**, jamais a `wg0`
de mesh; conta amarrada ao IP do container por /32 (`09` pg_hba `10.60.0.42/32`).
**Veredito:** **Correto e importante.** Confundir os dois WireGuards seria o pior erro possível (dar a um
cliente rota para a malha). O `13` fecha isso bem. Sem ressalva — só **exigir nomes distintos no código**
(`wg0` mesh vs `wg-cliente`) como o doc já pede.

---

## Ataque 9 — Segurança operacional.

### Achado 9.A — Onde ficam as chaves privadas: o doc se contradiz — "nunca sai do nó" vs. `WG_PRIVATE_KEY` como secret gerenciado do CP.
**Severidade: Alto.**
**Evidência:** `13` §1.5 e §6.1: chave gerada **no nó**, `0600`, "a chave privada nunca sai do nó". Mas o
manifesto do módulo (`13` §9.1) declara `secrets: [{key: WG_PRIVATE_KEY, ... rotatable: true,
generateIfMissing: true}]` com `hostApi.scopes: [secrets.read, secrets.write]`.
**Por que é problema:** se `WG_PRIVATE_KEY` é um **secret gerenciado** (lido/escrito pela host API,
`generateIfMissing`), então a privada **está no cofre do CP** — o oposto de "nunca sai do nó". As duas
afirmações não podem ser verdade juntas. A implicação é séria: o CP já é **ponto único** (`03` R1, `12`
§3); se ele guarda **todas** as privadas WG, comprometer o CP = comprometer as **identidades da malha
inteira**. O valor de gerar no nó é justamente que o CP só vê **chaves públicas** (como `wg_peers.
wg_public_key` já registra).
**Veredito/Correção:** **Reprovado como está.** Decidir e escrever **uma** verdade: a privada WG é
**on-node only**, nunca sincronizada ao CP; o CP guarda **só a pública**. Remover `WG_PRIVATE_KEY` do
conjunto de secrets gerenciados **ou** marcá-lo explicitamente como secret **node-local não replicado**.
Isso reduz o blast radius de um CP comprometido.

### Achado 9.B — Quem adiciona peer + peer malicioso: blast radius baixo (o especialista acertou), mas falta 2FA/aprovação para a aresta Opção A (o único caminho lateral).
**Severidade: Médio.**
**Evidência:** `13` §4.2 (um peer só alcança o hub /32; hub só aceita tcp/443; sem rota para outros /32).
Registro via `/agent/register` (`permission: internal.agent`); tarefas `wg.add_optionA`/`register`/
`rotate` com `requiredPermission: admin.nodes.manage`.
**Por que é problema:** um peer **adicionado por engano/comprometimento** alcança pouco: só o hub, e o
**mTLS** ainda barra quem não tiver cert válido (defesa em profundidade real aqui). O especialista está
**certo** que "um nó comprometido não varre a rede" — *desde que* `/32` e o nftables do hub segurem
(corrigido no Achado 4.C). **MAS** a **aresta Opção A é o único caminho lateral spoke↔spoke** e criá-la
dá a um nó público um túnel direto para um nó local (e vice-versa). Ela é gate por `admin.nodes.manage`
(humano — bom), mas **sem 2FA/re-auth**. O briefing pergunta explicitamente por "2FA/aprovação para mexer
na rede" — o doc não prevê.
**Veredito/Correção:** **Aprovado com correção.** Exigir **re-autenticação/2FA** para `wg.add_optionA` e
para adicionar/remover peer (as duas operações que mexem na topologia). Registro automático via
`/agent/register` deve exigir **token de enrollment de uso único** + aprovação humana antes de o peer
virar `up` (não só idempotência por `node_id`).

### Achado 9.C — Revogação NÃO é atômica para um nó que participa de aresta Opção A.
**Severidade: Alto.**
**Evidência:** `13` §4.3 mostra revogação = `wg set wg0 peer <pubkey> remove` **no hub** + `wg-quick save`
+ limpar `wg_peers`/cert mTLS. `13` §10.2 diz "não edite o wg0.conf à mão; use `velozctl node forget`".
**Por que é problema:** um nó local em Opção A tem sua pubkey **também** no `wg0.conf do nó público
fronte** (`13` §1.5b, aresta direta). Remover o peer **só no hub** **não** remove a aresta direta —
o nó revogado **continua com um túnel vivo para o fronte** (e vice-versa) até um **segundo** job tocar o
fronte. Se o fronte estiver offline/`deferred` (o próprio módulo tem `onNodeOffline: defer,
deferTimeoutHours: 72`), a revogação fica **pendente por até 72 h** com o túnel lateral aberto. O
especialista chama isso de "mesma operação atômica no CP" — **não é atômica**: é um fan-out distribuído
que pode falhar parcialmente.
**Veredito/Correção:** **Reprovado como "atômico".** Revogação deve **fan-out para todos os peers que
guardam a pubkey revogada** (hub **e** cada fronte de aresta Opção A), confirmar cada remoção, e enquanto
algum não confirmar marcar **"revogação pendente"** + alertar. Tempo de propagação real = tempo até o
**último** peer (potencialmente 72 h se um fronte está deferido) — precisa estar no runbook e na UI, não
escondido atrás de "atômico".

---

## Veredito final

**Status: PRECISA REFAZER PARTES + APROVADO COM CORREÇÕES.** O desenho de rede é competente e honesto em
vários pontos (isolamento do container em geral segura; NAT traversal sem DDNS está certo; a distinção
`wg0` mesh vs `wg-cliente` está certa; não fazer hairpin de backup/migração pela WG está certo; a
tabela de failure modes é majoritariamente correta). Mas há **bloqueadores** e **otimismos** que impedem
aprovação como está.

**Bloqueadores (resolver antes de aprovar):**
1. **8.A — NATS não aterrissado.** Todo o §2 do `13` depende da troca NATS→Postgres/long-poll que o
   Ciclo 1 (Conflito 4, Ação #9) mandou fazer e que **nunca foi aplicada** a `03`/`12`. Executar a Ação #9
   primeiro. Sem isso o `13` §2 é incoerente com a arquitetura oficial.
2. **4.B — Barreiras de container sob Docker.** As barreiras de `13` §4 são escritas para o nftables
   artesanal de `04` (Incus); o runtime de `06` é Docker, que reescreve o FORWARD. As barreiras precisam
   ir para `DOCKER-USER` com teste de regressão, **e** `04` (Incus) vs `06` (Docker) precisa ser
   reconciliado. Enquanto isso não fecha, a contenção do container é não-comprovada.

**Correções obrigatórias (aprovar condicionado a):**
- **2.A** oferecer `wg-passthrough` (TLS termina no nó local) e declarar a premissa "confio no provedor
  do fronte"; registrar que o plano de dados do visitante não tem defesa em profundidade.
- **4.A** corrigir a justificativa da barreira 1 (ilusória no caminho wg0). **4.C** corrigir a regra de
  input do hub (`saddr $WG_HUB` quebra o control plane no hub).
- **7.A** cortar escopo: WG **só onde é mandatória (o nó local)**; nós públicos ficam em mTLS/internet
  até >~5 nós; cortar DNS interno PowerDNS, capability e canary da fase 1.
- **9.A** chave privada WG **on-node only**, CP guarda só a pública. **9.B** 2FA/re-auth + enrollment de
  uso único para mexer na topologia. **9.C** revogação com fan-out confirmado a todos os peers (não é
  atômica).
- **5.A** documentar migração/evacuação do **nó local** (SSH de saída ou WG; W7 não cobre NAT).
  **5.B** tornar o fix de `12` §3.3 pré-requisito de rotear usage/heartbeat pela WG; dizer que o fallback
  não é diversidade de caminho cross-region. **6.A** keepalive **15 s** para residencial/CGNAT.
  **6.B/8.C** política de "nó local offline por horas" (sites/cobrança) e caminho de e-mail do site Opção A.
- **1.B** reescrever a prova: Opção A já provisionada sobrevive à queda do hub; **criar/reparar** exige o hub.

**Recomendação sobre oferecer a Opção A a cliente pagante: NÃO.** A conta (Ataque 3) é dura e não é
opinião: WordPress ~2 MB/página satura ~3 carregamentos simultâneos / ~1,5 página-view/s no upload
residencial típico, e a **disponibilidade composta da cadeia de 3 é ~98–99% (~8–11 h/mês fora)**, ~10–20×
pior que um nó público direto. A Opção A é **um recurso legítimo para os sistemas do próprio dono**
(dev/staging/homelab/projeto pessoal — exatamente o caso do ADENDO 6), e deve ser **bloqueada na UI para
ambientes de cliente pagante** (ou liberada só sob aceite explícito de "sem SLA, sua internet de casa é o
teto", nunca listada como plano de catálogo). Oferecer isso como hospedagem paga seria vender um outage
mensal previsível.
