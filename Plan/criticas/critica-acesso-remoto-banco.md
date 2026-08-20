# Crítica / Red Team — Acesso remoto ao banco "aberto" (0.0.0.0/0)

> **Escopo.** Ataca o **como** da proposta do doc 14 (não o **se** — a decisão de existir é do dono,
> ADENDO 7). Alvo: `especialistas/14-acesso-remoto-banco-aberto.md`. Referências cruzadas: doc 09 §1.4/§1.6/§2,
> doc 07 §2/§9, doc 06 §10.2/§10.5, doc 04 §8, doc 13 (WireGuard), ADENDO 3 e 6.
> Postura: o doc 14 é **bom** — dos melhores do ciclo. As salvaguardas são reais e a decisão A2 (forçar
> dedicado) está correta. O que segue são os pontos onde a blindagem **fura**, onde o especialista foi
> **otimista**, e onde a implementação, escrita ao pé da letra, **não faz o que promete**.

---

### Achado 1 — O gateway ProxySQL/PgBouncer QUEBRA o CrowdSec: o daemon só vê o IP do gateway, não do atacante

**Severidade:** Alta (a defesa contra brute-force proposta não funciona como está)

**Evidência:** doc 14 §2.5 (parser CrowdSec) cruzado com §4.1 (topologia). O parser
`veloz-db-auth.yaml` filtra `evt.Parsed.program == 'mysqld' || == 'postgres'` e extrai `source_ip` do
grok `Access denied for user '...'@'%{IP:source_ip}'`. Mas a §4.1 põe o gateway **na frente**: o daemon
fica em `bind 10.60.1.99` e **só recebe conexão do ProxySQL/PgBouncer** (10.60.1.x). Logo o `@'IP'` que
o `mariadbd` loga é **sempre o IP do gateway**, nunca o do atacante.

**Por que é problema:** o CrowdSec vai (a) nunca banir o atacante real (o IP dele não aparece no log do
daemon) e (b) na melhor hipótese banir o **próprio gateway** após 5 falhas — auto-DoS que fecha o banco
para o cliente legítimo. A salvaguarda A7 — vendida como "não-desligável" e central — está **desligada de
fato** pela própria topologia A4. As duas decisões-estrela do doc se anulam mutuamente e ninguém percebeu.
Pior: com ProxySQL usando um **pool** para o backend, muitas falhas de senha do cliente nem chegam a
gerar "Access denied" no daemon (o proxy rejeita antes, ou reusa conexão autenticada).

**Veredito/Correção:** a detecção de brute-force **tem que parsear o log do GATEWAY**, não o do daemon —
é o gateway que vê o IP público. Exige: (1) ProxySQL/PgBouncer configurado para logar cada falha de auth
**com o IP de origem real**; (2) parser CrowdSec novo apontado para esse log; (3) validar que ProxySQL
**loga** falha de auth de frontend com IP (ProxySQL historicamente loga pouco disso — precisa PoC). Se o
gateway não conseguir logar IP+falha de forma parseável, a única defesa L7 real cai e sobra só o nftables
rate-limit da §2.6 (que é por-IP e cego a distribuído — ver Achado 4).

---

### Achado 2 — mTLS end-to-end com gateway no meio: a cadeia de certificado não fecha (ProxySQL)

**Severidade:** Alta (a salvaguarda A5 pode ser teatro no caminho MariaDB)

**Evidência:** doc 14 §2.1 exige `ALTER USER 'e0099_r'@'%' REQUIRE X509 AND SUBJECT '/CN=env-0099-remote'`
no **daemon**; §4.4 põe o ProxySQL terminando TLS no frontend (`ssl_p2s_cert/ca`) e reabrindo conexão ao
backend `10.60.1.99:3306`. TLS é **terminado e reoriginado** no proxy.

**Por que é problema:** com `REQUIRE X509` no daemon, quem precisa apresentar o certificado de cliente ao
`mariadbd` é **o ProxySQL**, não o cliente — o proxy terminou o TLS do cliente e abriu uma conexão nova. O
`SUBJECT '/CN=env-0099-remote'` que o daemon valida será o **CN do cert do gateway**, não o do cliente.
Resultado: ou (a) o backend valida o cert do **proxy** (o mTLS "de verdade" acontece só no trecho
cliente→proxy, e o daemon confia cegamente no proxy — a promessa "sem cert, o banco recusa" vira "sem
cert, o *proxy* recusa"), ou (b) o daemon exige X509 e o proxy não consegue satisfazer com identidade do
cliente e a conexão **nunca funciona**. Além disso, o ProxySQL 2.x tem suporte **limitado e historicamente
instável a verificação de certificado de cliente no frontend** — `have_ssl` termina TLS, mas
`clientcert=verify-full` equivalente (validar CN contra usuário, checar CA) não é o forte dele. O doc trata
"ProxySQL faz mTLS" como fato; é uma **suposição não verificada**.

**Veredito/Correção:** decidir e escrever a fronteira de confiança explicitamente: o mTLS forte é
**cliente→gateway**; o trecho gateway→daemon é confiança de rede privada (`server_tls_sslmode=require`
sem client-cert do cliente final). Então o daemon **não** deve usar `REQUIRE X509` com SUBJECT do cliente
(vai brigar com o proxy) — usa `REQUIRE SSL` e o gateway é o guardião do cert. **E** é preciso um PoC de
que ProxySQL valida cert de cliente de verdade (CA + revogação). Se não validar, trocar ProxySQL por algo
que valide (ver Achado 3), senão A5 é uma etiqueta sem função no caminho MariaDB. No PG, PgBouncer com
`client_tls_sslmode=verify-full` faz isso melhor — a assimetria entre os dois engines precisa estar no doc.

---

### Achado 3 — mTLS obrigatório é inusável para o cliente médio; vira suporte caro ou desistência

**Severidade:** Média-Alta (o recurso pago pode ter taxa de fracasso alta e virar custo)

**Evidência:** doc 14 §2.1/§7.2 — toda conexão do modo aberto **exige cert de cliente X.509** ("botão
baixar certificado de cliente"). A alternativa `só sslmode=require` foi **recusada** (A5).

**Por que é problema:** o público que pede "acessar de qualquer lugar" é majoritariamente WordPress/dev
júnior (a mesma premissa que justifica o Adminer embutido e o botão "liberar meu IP atual" do doc 09).
Configurar `--ssl-cert/--ssl-key/--ssl-ca` no DBeaver/TablePlus/pgAdmin/Workbench é possível mas **frágil**:
caminho de arquivo, formato PEM vs PKCS#12, permissão do key, ordem CA, mensagens de erro TLS
incompreensíveis. A taxa realista de "abre ticket ou desiste" é **alta** — estimo maioria dos não-técnicos
e boa parte dos júniores. O especialista **superestimou a usabilidade**: o mesmo doc que recusa `%` porque
"o cliente não entende de rede" agora exige que esse cliente monte uma cadeia mTLS. Contradição de
persona. O recurso pago (R$49+) que gera fila de ticket de TLS é **prejuízo** para um operador de 1 pessoa.

**Veredito/Correção:** manter mTLS como **exigência técnica** (é a defesa forte), mas (1) entregar o
certificado empacotado como **PKCS#12 (.p12) com senha**, mais um **.dbeaver/.session pré-configurado** e
um passo-a-passo com screenshots por ferramenta — não só "baixe o cert"; (2) medir a taxa real de ticket
nos primeiros clientes e, se for alta, **este é o argumento decisivo** para empurrar o cliente ao SSH
tunnel/WireGuard (Achado 9), que não têm cert e resolvem o mesmo "de qualquer lugar". O mTLS bem-feito é
seguro; o mTLS mal-entregue vira o gargalo de suporte que mata o recurso.

---

### Achado 4 — Brute-force distribuído fura o modelo, e "tarpit no protocolo de banco" é otimista

**Severidade:** Média (defesa em profundidade real, mas com furos que o doc não nomeia)

**Evidência:** doc 14 §2.5 (CrowdSec `capacity: 5 / leakspeed: 10m`, `groupby: source_ip`) + §2.6
(nftables `limit rate 10/minute` por `ip saddr`) + "tarpit no ProxySQL/PgBouncer".

**Por que é problema:** (1) **Ban por IP não segura distribuído.** Mil IPs (botnet/proxies residenciais),
uma tentativa cada, ficam **abaixo** de todos os limiares (`capacity 5`, `10/min por IP`) e nunca são
banidos. O modelo só pega o atacante ingênuo de um IP só. (2) **Existe cenário CrowdSec confiável de auth
de banco em 2026?** Não há coleção oficial madura para MySQL/Postgres auth — o doc **escreve o parser do
zero** (bom), mas depende de o daemon logar a falha, e por padrão o **MariaDB não loga "Access denied"
com IP** sem `log_warnings>=2`/config específica, e ainda com o furo do Achado 1 (IP errado). (3)
**Tarpit "no protocolo de banco" é meio fantasia:** atrasar a resposta de erro no ProxySQL/PgBouncer não é
um recurso pronto (`server_login_retry` é para o *backend*, não para punir o *cliente*); o que existe de
verdade é o **ban** e o **rate-limit L4** — o "tarpit" descrito precisaria de código próprio no proxy e
provavelmente não existe. É otimismo redacional.

**Veredito/Correção:** rebaixar a linguagem: a defesa real contra brute-force **é o mTLS** (§2.1) — sem
cert, nenhuma senha adianta, distribuído ou não. CrowdSec+nftables são **anti-ruído** (cortam scanner
bobo e single-IP), não anti-adversário-sério. Remover a promessa de "tarpit" ou marcá-la como "a
implementar, se viável". E aceitar por escrito: **contra brute-force distribuído, a única defesa é o
certificado de cliente** — o que reforça que mTLS não pode falhar (Achado 2).

---

### Achado 5 — Blast radius: o "dedicado" é um container no MESMO nó, e a exposição à internet reabre o risco nº 1 do doc 06 — para os 21 vizinhos

**Severidade:** Alta (contradiz a premissa central A2 de que "dedicado = raio 1 cliente")

**Evidência:** doc 14 §Risco residual item 1 ("um 0-day pré-auth compromete **só** o container do cliente,
não os 22 — é o que A2 compra") vs. doc 06 §10.5 item 1 ("kernel compartilhado… é o **risco nº 1 e não
some**") e §10.2 (o `userns-remap` do Docker é **faixa única**: uid 0 de um container = uid 0 de outro =
host 165536). Cruzar com doc 09 §2.2: o container dedicado sobe via **`podman run … mariadb:11.8` sem
`--user` e sem `--userns=auto`**, dentro de `veloz-dbded.slice`, **no mesmo nó** dos 21 ambientes.

**Por que é problema:** o doc 14 confunde **dois raios de explosão diferentes**:
- **Raio de GRANT/daemon** (enumeração, brute-force de conta, CVE que compromete só o processo do banco):
  aí A2 está certo — no dedicado só há o database do cliente, o vizinho não existe. Ganho real.
- **Raio de CONTAINER/kernel** (0-day pré-auth → RCE dentro do container → escape de kernel → host):
  aqui A2 **não compra nada**. Expor a porta do banco à internet cria uma **superfície de RCE nova,
  alcançável do mundo inteiro**, num container que roda no host compartilhado. Um escape (io_uring,
  netfilter, overlayfs — o "risco nº 1" do doc 06) a partir desse container atinge **os 21 vizinhos** —
  exatamente o que A2 jurou evitar. Antes, essa superfície estava atrás de `bind 10.60.0.1` (inalcançável
  da internet); o modo aberto a **publica**.
- **Pior:** a §2.2 do doc 09 sobe o dedicado com **podman rootful, sem mapeamento de uid** e imagem
  oficial `mariadb` que **inicia como root**. Isso é **menos** isolado que o Docker userns-remap
  cuidadosamente descrito no doc 06. Um RCE nesse container pode ser **root no host direto** (rootful) ou,
  se herdar o userns do daemon, compartilhar o uid 165536 com os outros containers. A promessa "só o
  container do cliente" depende de uma configuração de container que **o doc 09/14 não especifica** e que
  hoje está escrita de forma insegura.

**Veredito/Correção:** (1) reescrever o Risco residual item 1: "o dedicado contém o raio no nível de
**grant/daemon**; no nível de **container/kernel**, um 0-day pré-auth exposto à internet é uma superfície
de escape que ameaça o host e os 21 vizinhos — é o risco nº 1 do doc 06, agora **publicado na internet**".
(2) Endurecer o container do dedicado **exposto**: rodar em **podman rootless** ou com `--userns=auto`
(faixa própria), `--user` não-root, `--cap-drop=ALL`, `--security-opt no-new-privileges`, seccomp/apparmor,
`--read-only` no rootfs — o mesmo rigor do `docker run` do doc 06 §10.3, que hoje **não** está aplicado ao
container de banco. (3) Considerar seriamente que um banco **exposto à internet** deveria ir para um **nó
de banco separado** (o doc 09 §2 já cogita "nó com folga" / VPS de banco acima de DB-L) — é a única forma
honesta de tirar a superfície pública de cima dos vizinhos. Enquanto o dedicado-exposto for container no
nó de produção, A2 protege menos do que promete.

---

### Achado 6 — Porta alta única (13000+env_id): benefício real mínimo, e o esquema é previsível, não obscuro

**Severidade:** Baixa

**Evidência:** doc 14 §4.3 / D-A4 — "`13000 + env_id`, não 3306/5432… remove o alvo dos scanners de massa".

**Por que é problema:** o benefício é **real mas pequeno e honestamente admitido** (corta scanner de massa
que só varre 3306/5432). Dois poréns: (a) `13000+env_id` é **determinístico** — quem descobre um ambiente
descobre o padrão e enumera a frota inteira; não é nem "obscuro". (b) complica o cliente (conecta numa
porta esquisita), mitigado pelo "comando pronto" do painel. Um scan de portas acha em minutos, como o
próprio doc diz.

**Veredito/Correção:** manter (custa nada, reduz ruído de log real), mas **randomizar a porta** por
ambiente (sortear no range alto e gravar em `gateway_port`) em vez de `13000+env_id` — se é para não
ajudar o atacante, que não seja um mapa. Não contar isso como segurança em documento nenhum (o doc já
não conta — correto).

---

### Achado 7 — Expiração de 90 dias: para tooling humano, ok; para app/integração de produção, é outage silencioso

**Severidade:** Média

**Evidência:** doc 14 A8/§6 — `expires_at` máx 90d, `db.open.expire` **revoga** (DROP do `_r`, gateway
para, porta fecha), re-confirmação renova. Comparar com a queixa conhecida do /32 que muda (doc 09 §1.6).

**Por que é problema:** 90d com alerta D-7 e renovação de 1 clique é **equilíbrio razoável para acesso de
ferramenta humana** (DBeaver de vez em quando). Mas o modo aberto **convida** o uso que o /32 não convida:
um SaaS de BI/ETL, um cron externo, uma integração que conecta no banco **de qualquer IP, o tempo todo**.
Para esse uso, a revogação automática aos 90 dias **derruba produção** — e pior que o /32, porque não é
"meu IP mudou", é "o pipeline parou às 3h da manhã do 91º dia". O `DROP USER` no meio de conexões vivas
(há `pg_terminate_backend` no doc 09 §2.2 para migração, mas a §2.5 de revogação aqui não detalha drenagem)
pode cortar transações em andamento.

**Veredito/Correção:** 90d está certo **como teto**, mas: (1) deixar explícito no Termo (§5a) e na UI que
"o modo aberto é para **acesso pontual com ferramenta**, não para conectar uma aplicação/integração 24×7 —
para isso, use IP dedicado + allowlist ou WireGuard"; (2) escalonar alertas (D-14, D-7, D-1) e permitir
renovação **antecipada** sem esperar vencer; (3) na revogação, **drenar** conexões (avisar, esperar,
`pg_terminate_backend`/`KILL`) em vez de DROP a seco. Sem isso, o recurso mais arriscado é também o que
mais quebra sem aviso.

---

### Achado 8 — Blindagem jurídica: melhor que a média, mas um DPO reprovaria por 4 buracos

**Severidade:** Média-Alta (passivo real, não hipotético)

**Evidência:** doc 14 §5.0/§5a/§5c — VelozPanel operador; termo transfere risco ao cliente; auditoria com
`accept_hash/accept_ip/accept_version`; logs de conexão 6 meses (Marco Civil art. 15); `audit_logs` 24 meses.

**Por que é problema:** a captura de consentimento (hash + IP + versão + timestamp) é **boa** e a divisão
"VelozPanel responde pela porta, cliente por quem entra" é defensável. Mas um DPO/advogado aponta:
1. **Notificação à ANPD (LGPD art. 48) não desaparece com o termo.** Como **operador**, num vazamento
   VelozPanel tem dever de **comunicar o controlador** e cooperar na notificação à ANPD/titulares. O termo
   aloca *culpa civil*, não *dever regulatório*. O doc §Risco residual 4 admite isso ("passivo LGPD sempre
   presente") — mas não há **cláusula de resposta a incidente / notificação** no termo nem runbook.
2. **Dado de terceiros.** O banco do cliente contém dados dos **usuários finais** dele (que não assinaram
   nada). O cliente pode ser controlador, mas **habilitar** a exposição pode enquadrar VelozPanel como
   corresponsável se a salvaguarda falhar. O termo não menciona que o cliente precisa de **base legal
   própria** para expor dado de terceiros.
3. **"Digite CONFIRMO" e checkbox não são assinatura qualificada.** É prova razoável (hash+IP), mas para
   um caso sério vale reforçar com **e-mail de confirmação com link** (duplo consentimento) — barato.
4. **Retenção assimétrica não justificada:** logs de conexão 6 meses (mínimo Marco Civil) vs. `audit_logs`
   24 meses — ok, mas num incidente os **6 meses de log de conexão podem ser curtos** para forense (ataque
   descoberto tarde). Considerar 12 meses para os logs de conexão do modo aberto (o próprio doc admite "12
   se houver parecer jurídico" — para modo aberto, **peça o parecer**).

**Veredito/Correção:** adicionar ao termo e ao runbook: cláusula de **notificação de incidente** (quem
avisa quem, em quanto tempo), menção à **base legal do cliente** para dados de terceiros, **duplo
consentimento** por e-mail, e **retenção de 12 meses** dos logs de conexão do modo aberto. O termo reduz
o passivo **jurídico-civil**; não zera o **regulatório** nem o **operacional** — e isso precisa estar
escrito para o dono não se surpreender.

---

### Achado 9 — A recomendação "manter OFF, resolver com túnel/allowlist" é HONESTA — e há caminho que entrega "de qualquer lugar" SEM abrir a porta

**Severidade:** Estratégica (define se vale construir o recurso)

**Evidência:** doc 14 §Risco residual (fim) — "a recomendação do especialista é **manter OFF** e resolver
90% com túnel SSH / allowlist /32; ligar só para o caso que justifica". Cruzar com doc 09 §1.6 (escada:
Adminer, SSH tunnel, /32, WireGuard) e ADENDO 6 (WireGuard já é **opção oficial** do produto).

**Por que é problema (na verdade, por que está certo):** a recomendação **não** é o especialista se
protegendo — é a postura de segurança correta, e alinhada ao ADENDO 3 §I do dono ("otimizar para aprender
com poucos clientes e não perder dado, não maximizar receita"). O ponto que o dono precisa ver com clareza:
o desejo real do cliente é **"acessar de qualquer lugar"**, e **três** opções já existentes entregam isso
**sem abrir porta nenhuma**:

| Opção | "De qualquer lugar"? | Abre porta pública? | Cert do cliente? | Já existe? |
|---|---|---|---|---|
| **Túnel SSH** (doc 09 §1.6 nível 1) | **sim** (qualquer rede) | não | não (usa chave SSH) | sim |
| **WireGuard do cliente** (ADENDO 6, doc 13) | **sim** (peer conecta de qualquer lugar) | não | não (chave WG) | **sim, oficial** |
| **Adminer/web + 2FA** (doc 09 §1.6 nível 0) | **sim** (qualquer browser) | não | não | sim |
| Cloudflare Access / Tunnel (não planejado) | sim | não (outbound) | não | não |
| **Modo aberto (doc 14)** | sim | **sim** | **sim** | a construir |

O SSH tunnel e o **WireGuard** já resolvem "de qualquer lugar" com conforto igual e **risco estruturalmente
menor** (porta fechada, o problema todo do doc 14 desaparece). O DBeaver/TablePlus têm SSH tunnel nativo;
o WireGuard é um app. O **único** caso que sobra para o modo aberto é: um **SaaS/serviço gerenciado de
terceiro** que precisa conectar direto no banco, **de IPs desconhecidos/rotativos**, e que **não pode**
rodar túnel nem WG (raro). E mesmo aí, allowlistar as **faixas publicadas** do SaaS (/32 em lote) é melhor
que `0.0.0.0/0`.

**Veredito/Correção:** o recurso **deveria existir apenas como a porta blindada do doc 14, OFF por padrão,
para esse caso residual** — e o funil do cliente (doc 14 §7.2) deve empurrar **WireGuard** com a mesma
força que empurra SSH tunnel (hoje o §7.2 lista SSH mas **não** lista WireGuard na escada visível ao
cliente do modo aberto — corrigir, já que ADENDO 6 tornou WG oficial). Construir o modo aberto **completo
agora**, na fase de validação com 4–5 sistemas, é investir semanas de engenharia (gateway por ambiente,
CrowdSec de banco, mTLS, jobs, UI, termo) num recurso que a maioria dos clientes **não deveria usar**. O
custo/benefício não fecha para o momento.

---

## Veredito final

**Aprovar com correções — e adiar a construção.** O doc 14 é tecnicamente sólido e a decisão-âncora
(A2: modo aberto **força dedicado**, nunca no compartilhado) está **correta** e bem argumentada. Mas a
blindagem tem **dois furos que se anulam** (o gateway cega o CrowdSec — Achado 1; e o mTLS não fecha
end-to-end com ProxySQL — Achado 2), uma **contradição de raio de explosão** (o "dedicado" é container no
mesmo nó, e expor à internet reabre o risco de escape de kernel para os 21 vizinhos, hoje provisionado de
forma **menos** isolada que o doc 06 exige — Achado 5), e uma **superestimativa de usabilidade** do mTLS
para o público-alvo (Achado 3).

**Correções obrigatórias antes de qualquer implementação:**
1. Parsear falha de auth **no log do gateway** (IP real), não no daemon (Achado 1).
2. Definir a fronteira mTLS como **cliente→gateway** e provar que o gateway valida cert de cliente de
   verdade; ajustar o `REQUIRE X509`/SUBJECT do daemon para não brigar com o proxy (Achado 2).
3. Endurecer o container do dedicado **exposto** (userns próprio, não-root, cap-drop, seccomp) e reescrever
   o Risco residual item 1 admitindo o raio host/kernel; avaliar **nó de banco separado** para bancos
   públicos (Achado 5).
4. Entregar o cert como `.p12` + guia por ferramenta; medir taxa de ticket (Achado 3).
5. Rebaixar a linguagem de "tarpit" e assumir que **mTLS é a única defesa contra brute-force distribuído**
   (Achado 4).
6. Termo com cláusula de notificação de incidente + base legal do cliente + duplo consentimento + 12 meses
   de log (Achado 8).
7. Drenar conexões na revogação e alertar que modo aberto **não** é para app/integração 24×7 (Achado 7).

**Recomendação estratégica ao dono:** **um túnel SSH e o WireGuard (ADENDO 6, já oficial) entregam
"acessar de qualquer lugar" com conforto igual e risco muito menor — a porta fica fechada e todo o
problema do doc 14 evapora.** O "modo aberto" só é necessário para o caso residual do SaaS de terceiro que
não consegue tunelar; para esse caso, allowlist das faixas do SaaS ainda é melhor que `0.0.0.0/0`. **Manter
a chave global OFF, tratar o doc 14 como especificação de contingência (corrigida) e NÃO construí-lo na
fase de validação.** Colocar WireGuard na frente do cliente é a resposta certa ao "talvez o cliente queira
isso". Se e quando um cliente concreto justificar a porta aberta, aí sim ligar — com as 7 correções acima.

**"Aberto força dedicado" aguenta a conta de RAM?** **Sim, mas com ressalva não-orçada.** Cada DB-S custa
512 MB = **1 dos ~11 ambientes vendáveis por nó** (doc 07 mix realista; doc 09 §2.3 "cada 512 MB = 1
ambiente de 22"), e é **pago com +40% de margem** (R$49 cobre o R$35 deslocado). O **gate humano de
aprovação** (A3) é o que impede o modelo de densidade quebrar: com aprovação caso-a-caso e volume de
"unidades por mês" na fase de validação, não há avalanche de dedicados. **Não vira gargalo** nesta fase
(poucos pedidos); **viraria** só em escala, que não é o problema de agora. **A ressalva:** o **gateway
ProxySQL/PgBouncer por ambiente exposto (~30–50 MB cada) NÃO está no orçamento de RAM do doc 09 §1.4**, e
cai sobre o mesmo nó cuja margem de page cache já é "apertada" (1 GB) — 4 abertos = ~200 MB extra
invisíveis na conta. E DB-M/DB-L deslocam **2 e 4** slots. Conclusão: o modelo aguenta **porque o dinheiro
compensa o slot e o humano controla o volume** — não porque haja RAM sobrando. Em um nó já perto do teto,
poucos dedicados-abertos comem a capacidade de venda de forma real; na fase de validação (poucos clientes,
prejuízo aceito), isso é tolerável.
