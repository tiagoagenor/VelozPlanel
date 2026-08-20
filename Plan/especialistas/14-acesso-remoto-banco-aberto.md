# 14 — Acesso remoto ao banco em "modo aberto" (0.0.0.0/0) — desenho seguro (ADENDO 7)

> **Escopo.** Executa o ADENDO 7 do briefing (item P). O dono decidiu **adicionar** a opção que o doc 09
> §1.6 D7 proibia: permitir acesso remoto ao banco a partir de `0.0.0.0/0` / `%` / "qualquer IP",
> controlado por uma chave do **super admin**. Este documento **não recusa** a decisão — ela está tomada —
> mas a **blinda** com o máximo de mitigação, e fixa a única forma segura de entregá-la.
> **Não substitui** o doc 09; **acrescenta** a ele o "Nível 4 (aberto)" da escada de acesso e altera
> pontos pontuais (listados no fim, em "O que isto muda no doc 09"). O padrão de fábrica continua sendo o
> D7 do doc 09 (allowlist /32 temporária). O modo aberto é uma **exceção consciente, auditada, reversível,
> nunca no banco compartilhado**.
> **Premissas herdadas (não reabrir):** banco compartilhado por nó (doc 09 D1/D2), bind em `10.60.0.1`,
> nftables integral do nó (doc 04 §8), CrowdSec já presente (doc 04 §6), tier dedicado já existe e é pago
> (doc 09 §2, doc 07 P16), VelozPanel é **operador** LGPD do dado hospedado e **controlador** do cadastro
> (doc 02 §13).

---

## 0. Resumo das decisões (leia isto se ler só uma seção)

| # | Decisão | Alternativa recusada | Motivo em uma linha |
|---|---|---|---|
| A1 | **Chave global do super admin, OFF de fábrica.** Sem ela ligada, "modo aberto" não existe em nenhum lugar do sistema | ligar por padrão / por nó automaticamente | é o disjuntor mestre; um clique errado não deve abrir 22 bancos |
| A2 | **Modo aberto ⇒ banco dedicado, obrigatório e sem exceção.** Jamais na instância compartilhada | abrir a instância compartilhada com mitigação | abrir a porta expõe a **instância inteira** (os 21 vizinhos) a brute-force e a CVE pré-auth — inaceitável |
| A3 | **Granularidade recomendada: cliente SOLICITA → super admin APROVA caso a caso, por ambiente.** Não "admin libera e cliente escolhe sozinho" | cliente liga sozinho após liberação global | o raio de explosão exige revisão humana por pedido; é barato (poucos clientes) e é o que a lei espera |
| A4 | **Nunca expor o daemon direto. Gateway de banco (ProxySQL / PgBouncer) na frente**, com o daemon seguindo em `bind 10.60.x`. A porta pública é um listener do gateway, não do MariaDB/PG | DNAT direto para o daemon | esconde o banner de versão, dá choke point auditável e absorve o pré-auth |
| A5 | **TLS obrigatório e não-desligável**, com **certificado de cliente (mTLS) exigido no modo aberto** | só `sslmode=require` | senha sozinha exposta na internet é um segredo compartilhável; o certificado é um segundo fator de conexão |
| A6 | **Conta de acesso remoto separada da conta da aplicação** (`e0099_r`), senha forte gerada (32 bytes CSPRNG), rotacionável, destruída na revogação | reusar a conta da app | revogar o acesso remoto nunca pode derrubar o site |
| A7 | **Brute-force protection dedicada na porta do banco**: CrowdSec com cenário próprio de auth de banco + ban progressivo + nftables rate-limit por origem + tarpit | fail2ban genérico só | 3306/5432 na internet recebe varredura contínua; sem isso o modo aberto é um honeypot involuntário |
| A8 | **Expiração obrigatória de 90 dias com re-confirmação** (não é permanente). Pausa **revoga** (mantém regra do doc 09). Migração de nó **não** carrega o acesso aberto | "aberto = permanente" | acesso perpétuo esquecido é o vetor de vazamento nº 1; forçar re-decisão anual mata o esquecimento |
| A9 | **Aceite jurídico do cliente + confirmação "digite CONFIRMO" do super admin + trilha de auditoria completa** (quem, quando, aceite, IP, validade) | ligar sem registro | transfere responsabilidade ao cliente por escrito e cumpre Marco Civil art. 15 / LGPD |
| A10 | **Alertas obrigatórios**: e-mail ao cliente e ao admin na ativação; alerta de pico de tentativas de conexão; relatório mensal de "bancos abertos ativos" no super admin | silêncio | um banco aberto que ninguém lembra é o pior estado possível |

**Veredito de uma linha:** entregar exatamente o que o dono pediu — "permitir qualquer IP" — **só** como
`0.0.0.0/0` apontando para um **banco dedicado do cliente, atrás de um gateway, com mTLS, conta separada,
brute-force protection, aceite assinado e expiração**. Assim o "aberto" é real para o cliente e **nunca**
toca o banco do vizinho.

---

## 1. Modelo de habilitação em camadas

### 1.1 As três camadas (e por que três, não uma)

```
┌─ CAMADA 0 ─ Chave global do super admin ──────────────────────────────────────┐
│  feature_flags.db_open_mode_system = OFF   (de fábrica)                        │
│  "Permitir que o modo aberto exista no sistema". Enquanto OFF, os fluxos de    │
│  pedido/aprovação abaixo ficam INVISÍVEIS no painel do cliente e recusados na  │
│  API. É o disjuntor mestre — um único ponto que apaga o recurso inteiro.       │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 │ (só continua se ON)
┌─ CAMADA 1 ─ Elegibilidade do ambiente ────────────────────────────────────────┐
│  O ambiente PRECISA estar (ou passar a estar) no TIER DEDICADO (doc 09 §2).    │
│  Instância compartilhada NUNCA é elegível — a API recusa antes de criar o      │
│  pedido. Se o ambiente é compartilhado, o fluxo vira "upgrade para dedicado    │
│  + abrir" num passo só (§3.4).                                                 │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 │
┌─ CAMADA 2 ─ Pedido do cliente + Aprovação do super admin (caso a caso) ───────┐
│  O cliente SOLICITA (com aceite jurídico). O super admin APROVA ou RECUSA cada │
│  pedido, individualmente, por ambiente. Aprovação não é global nem por plano.  │
│  Ao aprovar, o admin escolhe a validade (30/60/90 d) e vê o texto de risco.    │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Por que não é uma chave só.** Uma chave global que já abre tudo é o erro do Hostoo em escala maior. Uma
chave por nó tenta "abrir só neste servidor", mas o servidor é compartilhado — abrir o nó abre 22 clientes.
Uma chave por plano transforma "modo aberto" em característica vendável de catálogo, o que empurra clientes
que não entendem de rede para a configuração mais perigosa. A única granularidade que casa com o raio de
explosão real é **por ambiente, sob dupla chave (global + aprovação humana)**.

### 1.2 Granularidade — a recomendação, sem "depende"

**Recomendação fechada: o cliente SOLICITA e o super admin APROVA caso a caso, por ambiente.** Nunca "o
admin libera e o cliente passa a poder escolher `0.0.0.0/0` sozinho depois".

Justificativa:

1. **O custo de revisão é baixo.** A fase é de validação com 4–5 sistemas (ADENDO 3 §I). O número de
   pedidos de "abrir para o mundo" será de unidades por mês, não milhares. Revisar cada um por humano é
   trivial e é exatamente onde a atenção deve estar.
2. **O erro é caro e irreversível.** Um vazamento de base de terceiro por porta aberta é incidente de LGPD,
   passivo jurídico e dano reputacional. A assimetria custo-de-revisar × custo-de-errar exige gate humano.
3. **A lei espera decisão consciente.** Transferir responsabilidade ao cliente (LGPD/AUP) só é defensável se
   houve um ato deliberado e informado de ambas as partes — o pedido do cliente e a aprovação do operador.
   Um toggle que o cliente liga sozinho no meio de outras opções não é "consciente" o bastante.
4. **"Admin libera, cliente escolhe" concentra o risco no pior momento.** O admin libera pensando num caso,
   o cliente reusa a liberação em três ambientes meses depois, e ninguém revisou os outros dois. O gate por
   pedido elimina esse acúmulo silencioso.

### 1.3 Máquina de estados do pedido/aprovação

```
                         (cliente clica "Solicitar acesso aberto")
                                        │
                                        ▼
        ┌───────────────┐  aceite não   ┌──────────────┐
        │  none         │──assinado────►│  (bloqueado) │
        │ (sem pedido)  │               └──────────────┘
        └──────┬────────┘
               │ cliente assina aceite + (se compartilhado) confirma upgrade p/ dedicado
               ▼
        ┌───────────────┐   admin recusa (com motivo)     ┌───────────────┐
        │  requested    │────────────────────────────────►│  rejected     │──┐
        │ (aguardando   │                                  │ (motivo, log) │  │ cliente pode
        │  aprovação)   │◄─────── cliente reenvia ─────────┴───────────────┘  │ solicitar de novo
        └──────┬────────┘                                                     │
               │ admin aprova (escolhe validade 30/60/90d + "digite CONFIRMO")│
               ▼                                                              │
        ┌───────────────┐  provisionamento falha  ┌───────────────┐          │
        │  approved     │────────────────────────►│  failed       │──────────┘
        │ (job disparado)│                         │ (rollback,log)│
        └──────┬────────┘                          └───────────────┘
               │ job db.open.enable OK (gateway + conta _r + mTLS + nft set)
               ▼
        ┌───────────────┐
        │  active       │◄───────── re-confirmação a cada 90d (renova expires_at) ──┐
        │ (porta aberta)│                                                           │
        └──┬─────┬──────┘                                                           │
           │     │                                                                  │
   cliente/│     │ expira sem re-confirmar (job db.open.expire)                     │
   admin   │     │  ── ou ── ambiente pausado  ── ou ── admin revoga  ── ou ──      │
   revoga  │     │  migração de nó                                                  │
           ▼     ▼                                                                  │
        ┌───────────────┐   cliente re-solicita (novo aceite)                       │
        │  revoked      │───────────────────────────────────────────────────────────┘
        │ (conta _r     │
        │  destruída,   │
        │  porta fechada)│
        └───────────────┘
```

Regras de transição não-óbvias, que precisam estar no código:

- `requested → approved` **exige** que o ambiente já esteja no tier dedicado. Se estava compartilhado, o
  aceite do cliente incluiu a autorização do upgrade e o job faz **primeiro** a migração (doc 09 §2.2),
  **depois** a abertura. Nunca abre e migra na ordem inversa.
- `active` **não é permanente**: tem `expires_at`. O job diário `db.open.expire` move para `revoked` o que
  venceu e não foi re-confirmado, exatamente como o /32 do doc 09 §1.6.
- Pausa do ambiente move `active → revoked` (mantém a regra do doc 09 §1.7). Ao iniciar, **não** volta
  sozinho — o cliente re-solicita.
- Migração de nó (doc 06) **não** carrega o estado `active`. O acesso aberto é derrubado na migração e o
  cliente é avisado que precisa re-solicitar no novo nó (a origem de IP e o gateway mudaram).

### 1.4 DDL — tabela de estado do pedido

```sql
-- Control plane (Postgres 17). Acompanha o padrão do doc 03/07.
CREATE TYPE db_open_state AS ENUM
  ('none','requested','rejected','approved','failed','active','revoked');

CREATE TABLE db_open_access (
  id                bigserial PRIMARY KEY,
  environment_id    uuid NOT NULL REFERENCES environments(id),
  engine            text NOT NULL CHECK (engine IN ('mariadb','postgres')),
  state             db_open_state NOT NULL DEFAULT 'none',

  -- pedido
  requested_by      uuid,                       -- user do cliente
  requested_at      timestamptz,
  accept_version    text,                       -- versão do texto de aceite assinado (§5a)
  accept_hash       text,                       -- sha256 do texto exato exibido, para prova
  accept_ip         inet,                       -- IP de onde o cliente assinou (Marco Civil)

  -- aprovação
  approved_by       uuid,                       -- superadmin
  approved_at       timestamptz,
  reject_reason     text,

  -- vigência
  validity_days     int  CHECK (validity_days IN (30,60,90)),
  activated_at      timestamptz,
  expires_at        timestamptz,                -- NUNCA NULL em 'active'
  revoked_at        timestamptz,
  revoke_reason     text CHECK (revoke_reason IN
                      ('client','admin','expired','paused','migrated','abuse')),

  -- infra provisionada (preenchido pelo job)
  gateway_port      int,                        -- porta pública do gateway (§4)
  remote_role       text,                       -- 'e0099_r'
  client_cert_cn    text,                        -- CN do cert de cliente emitido (mTLS)
  dedicated_db_id   uuid REFERENCES dedicated_dbs(id),  -- exige tier dedicado (A2)

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- no máximo UM registro não-terminal por ambiente
CREATE UNIQUE INDEX ON db_open_access (environment_id)
  WHERE state IN ('requested','approved','active');

-- invariante A2: só ativa se houver banco dedicado amarrado
ALTER TABLE db_open_access ADD CONSTRAINT open_requires_dedicated
  CHECK (state <> 'active' OR dedicated_db_id IS NOT NULL);
```

---

## 2. Salvaguardas obrigatórias que permanecem MESMO no modo aberto

Esta é a parte central. Cada salvaguarda abaixo é **não-desligável** — nem pelo cliente, nem por
configuração do próprio modo aberto. Elas são o que separa "abrir uma porta com trava" de "abrir a porta e
sair de férias".

### 2.1 TLS obrigatório + certificado de cliente (mTLS)

**O que é.** Toda conexão do modo aberto é cifrada em trânsito **e** exige que o cliente apresente um
certificado X.509 emitido pelo VelozPanel para aquele ambiente. Senha em claro pela internet nunca acontece;
e mesmo a senha vazando, sem o certificado a conexão é recusada no handshake, antes do banco.

**MariaDB 11.8** (no container dedicado do cliente):

```ini
# /etc/veloz/dbded/0099-open.cnf  (aplicado quando o modo aberto é ativado)
[mariadbd]
require_secure_transport        = ON            # recusa qualquer conexão não-TLS, globalmente
ssl_cert                        = /etc/mysql/tls/server-cert.pem
ssl_key                         = /etc/mysql/tls/server-key.pem
ssl_ca                          = /etc/mysql/tls/veloz-db-ca.pem   # CA que assina os certs de cliente
tls_version                     = TLSv1.3
```

```sql
-- a conta remota exige certificado de cliente (não só SSL): mTLS de verdade
ALTER USER 'e0099_r'@'%'
  REQUIRE X509
  AND SUBJECT '/CN=env-0099-remote/O=VelozPanel';
-- REQUIRE X509 (não REQUIRE SSL): sem cert válido assinado pela ssl_ca, recusa
```

**PostgreSQL 17** (no container dedicado):

```conf
# postgresql.conf do container dedicado, no modo aberto
ssl                       = on
ssl_min_protocol_version  = 'TLSv1.3'
ssl_cert_file             = 'server.crt'
ssl_key_file              = 'server.key'
ssl_ca_file               = 'veloz-db-ca.crt'
```

```conf
# pg_hba.conf — hostssl + clientcert obrigatório. A ORDEM importa: específico antes do reject.
# acesso remoto aberto: exige TLS E certificado de cliente cujo CN == usuário
hostssl e0099_app  e0099_r  0.0.0.0/0  scram-sha-256  clientcert=verify-full
hostssl e0099_app  e0099_r  ::/0       scram-sha-256  clientcert=verify-full
# fecho de negação (doc 09 §1.5)
host    all        all      0.0.0.0/0  reject
host    all        all      ::/0       reject
```

**Por que não pode ser desligada.** `require_secure_transport=OFF` / `hostssl→host` transformaria a abertura
numa transmissão de senha e dados de clientes em claro pela internet pública — captável por qualquer ponto
de trânsito. O `clientcert=verify-full` / `REQUIRE X509` é o segundo fator: reduz a superfície de "qualquer
um com a senha" para "quem tem a senha **e** o certificado que só o painel entrega". É a diferença entre
brute-force viável e brute-force inútil. Implementação: o flag `require_secure_transport`/`clientcert` é
gerado por template e **não é exposto** na UI do cliente — não existe caixinha para desmarcar.

### 2.2 Conta de acesso remoto separada da aplicação

**O que é.** O modo aberto nunca reusa a conta que a aplicação usa (`e0099`). Cria-se uma segunda conta,
`e0099_r`, com os **mesmos grants restritos** (só o database do cliente), senha de 32 bytes CSPRNG gerada
pelo painel, **rotacionável** por botão e **destruída** na revogação/expiração/pausa.

```sql
-- MariaDB: conta remota separada, senha gerada, host '%' SÓ para esta conta _r
CREATE USER 'e0099_r'@'%' IDENTIFIED BY '<32 bytes base62 CSPRNG>'
  REQUIRE X509
  WITH MAX_USER_CONNECTIONS 10 MAX_QUERIES_PER_HOUR 200000 MAX_STATEMENT_TIME 30;
GRANT ALL PRIVILEGES ON `e0099\_%`.* TO 'e0099_r'@'%';   -- '_' ESCAPADO (doc 09 §1.5)
-- NENHUM GRANT global. Sem PROCESS, sem FILE, sem SUPER, sem SHOW DATABASES amplo.

-- rotação (botão "girar senha remota"):
ALTER USER 'e0099_r'@'%' IDENTIFIED BY '<nova senha>';

-- revogação (pausa/expiração/revoke):
DROP USER 'e0099_r'@'%';
```

```sql
-- PostgreSQL: role remota separada, LOGIN, sem herança perigosa
CREATE ROLE e0099_r LOGIN PASSWORD '<32 bytes>' CONNECTION LIMIT 10
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT CONNECT, TEMPORARY ON DATABASE e0099_app TO e0099_r;
\c e0099_app
GRANT USAGE ON SCHEMA public TO e0099_r;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO e0099_r;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE TO e0099_r;
ALTER ROLE e0099_r SET statement_timeout = '30s';
-- revogação: DROP OWNED / DROP ROLE e0099_r; (após pg_terminate_backend dos backends dela)
```

**Por que não pode ser desligada.** Se o acesso remoto usasse a conta da aplicação, três coisas quebram:
(a) revogar o acesso remoto derruba o site (a app perde a conta); (b) a senha da app, que vive no `.env` e
em backups, passa a valer para conexão externa — amplia o vazamento; (c) impossível auditar "quem entrou de
fora" vs "a própria app". A conta `_r` separada é o que torna a revogação segura e a auditoria possível.

### 2.3 Grant restrito só ao database do cliente — e a prova de que o vizinho não aparece

**O que é.** A conta `_r` só enxerga o database do próprio ambiente. Abrir o **IP** não pode abrir o
**banco do vizinho**. No modelo dedicado (A2) isto é trivial e é justamente o argumento central: **no
container dedicado, o vizinho não existe** — a instância inteira é do cliente. Ainda assim, provamos o
isolamento porque a defesa em profundidade vale mesmo quando só há um inquilino.

Auditoria do risco de enumeração (`information_schema` / `pg_catalog`):

| Vetor de enumeração | Modo aberto na instância COMPARTILHADA (recusado, A2) | Modo aberto no DEDICADO (o que entregamos) |
|---|---|---|
| `SHOW DATABASES` / `\l` | listaria só o grant, mas a instância **tem** bases de outros ⇒ superfície existe | a instância só tem os databases do próprio cliente; nada a vazar |
| `information_schema.tables` global | no MariaDB, mostra apenas objetos sobre os quais a conta tem privilégio — mas o risco de bug de privilégio é real numa instância multi-tenant | escopo = só o cliente; irrelevante |
| `pg_stat_activity` / `pg_stat_statements` | veria PIDs e (com sorte) queries de vizinhos se algum grant vazar | só o próprio tráfego |
| CVE pré-auth do daemon | compromete a **instância inteira** = 22 clientes | compromete só o container do cliente |
| Brute-force na porta | ataca a instância de 22 | ataca só o cliente que pediu |

A conclusão desta tabela **é** a justificativa de A2: as três primeiras linhas só são seguras "por
disciplina de grant" no compartilhado, e disciplina de grant gerada por código é exatamente o que o doc 09
D13 já disse que não se deve confiar sozinho. No dedicado, o isolamento é estrutural, não por disciplina.

### 2.4 Limite de conexões + timeout de query (anti-DoS)

**O que é.** A porta aberta é um alvo de esgotamento de recursos. Limitamos conexões por conta e matamos
query longa, para que o modo aberto não vire vetor de negação de serviço contra o próprio cliente.

- **MariaDB:** `MAX_USER_CONNECTIONS 10` na conta `_r` (§2.2) + `MAX_STATEMENT_TIME 30` + o watchdog
  `veloz-db-warden` do doc 09 §1.8 continua rodando no container dedicado (o `SET SESSION
  max_statement_time=0` do cliente não escapa do warden).
- **PostgreSQL:** `CONNECTION LIMIT 10` na role `_r` + `statement_timeout=30s` + `idle_in_transaction_session_timeout`
  + o warden do doc 09 §1.8.
- **No gateway (§4):** limite adicional de conexões simultâneas por IP de origem (ProxySQL
  `mysql-max_connections` por regra; PgBouncer `max_client_conn` + `max_db_connections`), para que um único
  IP não segure todas as 10.

**Por que não pode ser desligada.** Sem teto de conexão, um atacante (ou um cliente descuidado com um app em
loop na internet) abre milhares de sockets e o daemon esgota RAM/backends. No modelo dedicado o dano fica
contido ao próprio cliente, mas ainda derruba o site dele — e a conta `_r` com 10 conexões é folga
suficiente para uso legítimo de DBeaver/TablePlus (que abrem 1–3).

### 2.5 Proteção de força-bruta na porta exposta — CrowdSec + tarpit + ban progressivo

**O que é.** A porta do banco na internet recebe varredura e brute-force contínuos. Precisamos de detecção
específica de falha de autenticação de banco (não só de HTTP), com ban progressivo e tarpit.

O daemon loga cada falha de auth. Um **parser** e um **cenário** CrowdSec transformam isso em decisão de ban
via o bouncer nftables que já existe no nó (doc 04 §6).

Parser (extrai IP e resultado das falhas de auth do MariaDB/PG):

```yaml
# /etc/crowdsec/parsers/s01-parse/veloz-db-auth.yaml
onsuccess: next_stage
filter: "evt.Parsed.program == 'mysqld' || evt.Parsed.program == 'postgres'"
name: velozpanel/db-auth
nodes:
  - grok:
      # MariaDB: "Access denied for user 'e0099_r'@'203.0.113.9' (using password: YES)"
      pattern: "Access denied for user '%{DATA:db_user}'@'%{IP:source_ip}'"
      apply_on: message
      statics:
        - meta: log_type
          value: db_auth_fail
        - target: evt.Meta.source_ip
          expression: evt.Parsed.source_ip
  - grok:
      # PostgreSQL: "FATAL: password authentication failed for user "e0099_r"" + "host=203.0.113.9"
      pattern: "password authentication failed for user \"%{DATA:db_user}\""
      apply_on: message
      statics:
        - meta: log_type
          value: db_auth_fail
```

Cenário (ban progressivo: mais falhas ⇒ ban mais longo):

```yaml
# /etc/crowdsec/scenarios/veloz-db-bruteforce.yaml
type: leaky
name: velozpanel/db-bruteforce
description: "Brute-force na porta de banco exposta (modo aberto)"
filter: "evt.Meta.log_type == 'db_auth_fail'"
groupby: evt.Meta.source_ip
capacity: 5             # 5 falhas
leakspeed: 10m          # em janela de ~10 min
blackhole: 1m
labels:
  service: database
  remediation: true
---
# escalada progressiva via profile de decisão
# /etc/crowdsec/profiles.yaml (trecho)
name: db_progressive_ban
filters:
  - Alert.Remediation == true && Alert.GetScenario() == "velozpanel/db-bruteforce"
decisions:
  - type: ban
    duration: 1h        # 1º acerto: 1h
duration_expr: "Sprintf('%dh', 1 * (1 + int(Alert.GetEventsCount()/5)))"  # cresce com a reincidência
on_success: break
```

**Tarpit (atraso deliberado) no gateway.** Além do ban, o ProxySQL/PgBouncer é configurado para **atrasar**
a resposta a falhas de auth (não responder instantaneamente), o que degrada a taxa de tentativa do atacante
antes mesmo de o CrowdSec banir. No ProxySQL: `mysql-connect_timeout_server_max` e regra de erro com delay;
no PgBouncer via `server_login_retry` alto no lado do proxy. É barato e some com a maioria dos scanners
automáticos, que desistem de alvos lentos.

**Por que não pode ser desligada.** Sem isto, `3306`/`5432` na internet com uma senha é questão de tempo até
alguém acertar por dicionário — e o mTLS (§2.1) é a defesa forte, mas defesa em profundidade manda também
encarecer a tentativa. O ban progressivo pune o reincidente sem punir o cliente legítimo que errou a senha
uma vez.

### 2.6 Rate limit / throttling por origem no nftables

**O que é.** No próprio firewall do nó, limitamos a taxa de **novas conexões** por IP à porta do gateway,
como primeira barreira L4, antes de o pacote chegar ao gateway ou ao CrowdSec.

```nft
# acréscimo ao /etc/nftables.conf do nó (doc 04 §8.2), chain input
# porta do gateway de banco aberto (uma por ambiente exposto; ex.: 13099)
define DBGW_PORTS = { 13099 }        # gerado pelo agente conforme os ambientes ativos

table inet filter {
    set db_ban4 { type ipv4_addr; flags timeout; }   # alimentado pelo CrowdSec bouncer

    chain input {
        # ... regras existentes ...
        ip saddr @db_ban4 drop

        # rate limit de NOVAS conexões por origem na porta do gateway de banco
        ct state new tcp dport $DBGW_PORTS \
            meter db_conn_rate { ip saddr limit rate 10/minute burst 5 packets } \
            accept
        ct state new tcp dport $DBGW_PORTS \
            log prefix "veloz-db-open-throttle " drop   # excedeu: dropa e loga

        ct state established,related tcp dport $DBGW_PORTS accept
    }
}
```

**Por que não pode ser desligada.** É a camada mais barata (kernel, antes de qualquer processo) e a que
sobrevive mesmo se o CrowdSec ou o gateway caírem. `10 conexões novas/minuto por IP` é folga enorme para uso
humano (um DBeaver abre pool de 1–3) e teto duro para varredura. O `burst 5` cobre reconexão legítima.

---

## 3. Blast radius do banco compartilhado — análise honesta e o veredito

### 3.1 O que abrir a porta significa para os OUTROS clientes do nó

O banco é **compartilhado por nó** (doc 09 D1/D2): um `mariadbd` e um `postgresql` servem os ~22 ambientes
do nó, cada um com seu database. Abrir `3306`/`5432` na internet para atender **um** cliente expõe **o
processo inteiro** — que é o mesmo processo dos outros 21. Consequências concretas:

1. **Brute-force coletivo.** A porta aberta recebe tentativas contra *qualquer* usuário. Um dicionário que
   acerte a senha de qualquer conta compromete não só quem pediu abertura, mas potencialmente o vetor de
   entrada para a instância.
2. **CVE pré-autenticação.** MariaDB e PostgreSQL têm histórico de vulnerabilidades exploráveis **antes** do
   login (parsing de pacote de handshake, negociação TLS, etc.). Com a porta fechada (bind `10.60.0.1`),
   essas CVEs são inalcançáveis da internet. Abrir a porta para um cliente as expõe **para todos** — porque
   é o mesmo daemon. Um 0-day pré-auth vira comprometimento de 22 bases de uma vez.
3. **Amplificação de DoS.** Esgotar conexões/CPU do daemon compartilhado pela porta pública derruba os 21
   vizinhos que nunca pediram nada.
4. **Enumeração.** Mesmo com grant restrito, uma instância multi-tenant exposta é um alvo muito mais rico
   para quem procura falha de escalonamento de privilégio entre contas.

Em resumo: **abrir a porta de um banco compartilhado transfere o risco de um cliente para todos os
vizinhos, sem o consentimento deles.** Isso é eticamente e juridicamente indefensável — os 21 não assinaram
nada.

### 3.2 Custo/benefício: abrir no compartilhado vs forçar dedicado

| Critério | Abrir no COMPARTILHADO (com mitigação) | Modo aberto ⇒ DEDICADO (recomendado) |
|---|---|---|
| Raio de explosão de CVE pré-auth | **22 clientes** | 1 cliente (o próprio) |
| Consentimento dos vizinhos | inexistente (não foram perguntados) | irrelevante (não há vizinhos) |
| Brute-force / DoS | atinge a instância de todos | contido no container do cliente |
| Isolamento de enumeração | "por disciplina de grant" (frágil, doc 09 D13) | estrutural (instância própria) |
| Custo para o cliente | R$ 0 (mas socializa o risco) | +R$ 49/mês (DB-S) — paga pelo próprio risco |
| Custo operacional para nós | altíssimo (um incidente = 22 clientes, LGPD ×22) | contido; incidente afeta 1 |
| Receita | nenhuma | +R$ 49–159/mês por cliente que quer abrir |
| Complexidade de mitigar | tentar blindar processo compartilhado exposto (impossível de garantir) | blindagem padrão de instância dedicada |

**Veredito: SIM — modo aberto FORÇA banco dedicado. Sem exceção (A2).** O "aberto" **nunca** acontece na
instância compartilhada. O motivo não é comercial (embora a receita ajude): é que não existe forma honesta
de mitigar a exposição da instância compartilhada sem o consentimento dos 21 vizinhos, e esse consentimento
não é obtenível. Forçar o dedicado transforma "socializar o risco" em "o cliente que quer o risco paga por
ele e o contém no próprio quintal".

### 3.3 Por que isto também é a decisão mais barata de operar

Um operador (o Tiago) não consegue vigiar uma instância compartilhada exposta 24×7. No modelo dedicado, um
incidente é **1 cliente, 1 container, 1 restore**. No compartilhado, é **22 clientes, LGPD ×22, e a
reputação inteira**. Para um time de 1 pessoa, A2 é a diferença entre um susto e o fim do negócio.

### 3.4 Como o painel conduz o "abrir ⇒ dedicado" (e como cobra)

O fluxo é um passo só, honesto sobre o custo (princípio do doc 01 §5.1.3: custo sempre visível antes de
confirmar):

```
Cliente clica "Solicitar acesso aberto (qualquer IP)" num ambiente COMPARTILHADO
   │
   ▼
Painel mostra:
  "Acesso de qualquer IP exige um banco dedicado (instância isolada só sua).
   Isso protege você e os outros clientes do servidor.
   • Banco dedicado DB-S: R$ 49,00/mês (R$ 0,0681/h)   [ver o que inclui]
   • Migração sem perder dados, ~20–90s de indisponibilidade de escrita, agendável
   Total do ambiente passa de R$ 35,00 para R$ 84,00/mês."
   [ ] Li e aceito o Termo de Acesso Aberto (§5a)   [ Solicitar ]
   │
   ▼
state: requested  → (admin aprova) → job:
   1. db.dedicated.provision + db.dedicated.migrate   (doc 09 §2.2)
   2. db.open.enable  (gateway + conta _r + mTLS + nft set + pg_hba/GRANT)
   3. billing: abre janela do meter db.dedicated.hour (doc 07)
```

Cobrança: reusa o meter `db.dedicated.hour` que já existe (doc 09 §2.4, doc 07 P16). **Não há meter novo de
"modo aberto"** — o modo aberto não custa compute adicional; o que custa é o dedicado, e esse já é cobrado.
O add-on de IP dedicado (R$ 25/mês, doc 07) **é recomendado** junto quando o cliente quer um IP estável de
origem, mas não é obrigatório. Regra de estado: como todo dedicado, **pausar o ambiente para o container e
para de cobrar `db.dedicated.hour`** (doc 09 §2.4) — e, por A8, a pausa também revoga o acesso aberto.

---

## 4. Endurecimento da exposição — o gateway de banco

Mesmo no dedicado, **não se expõe o daemon direto**. Recomendação fechada (A4): um **gateway de banco** por
ambiente exposto, que aceita a conexão pública, aplica política e repassa para o daemon — que **continua
bindado na bridge privada** (`10.60.1.x`), nunca em `0.0.0.0`.

### 4.1 Topologia

```
Internet
   │  TCP porta pública ÚNICA por ambiente (ex.: 13099), NÃO 3306/5432
   ▼
eth0 do nó ──[nftables: rate-limit + db_ban4 (§2.6, §2.5)]──►
   ▼
Gateway de banco (sidecar no nó, escuta em 0.0.0.0:13099)
   • ProxySQL 2.x   (MariaDB)   ou   PgBouncer/pgcat (PostgreSQL)
   • termina/repassa TLS, valida cert de cliente, tarpit, limite por origem
   • esconde o banner de versão do daemon (reduz fingerprinting de CVE)
   ▼  10.60.1.99:3306/5432 (rede privada do nó)
Container dedicado do cliente (mariadb:11.8 / postgres:17)
   • bind 10.60.1.99  — JAMAIS acessível direto da internet
```

### 4.2 Por que gateway e não DNAT direto

| Aspecto | DNAT direto p/ daemon | Gateway (ProxySQL/PgBouncer) |
|---|---|---|
| Banner de versão exposto | sim (fingerprint de CVE trivial) | gateway responde; versão do daemon oculta |
| Choke point auditável | não | sim (log central de conexões) |
| Absorve pré-auth malformado | não (chega no daemon) | parcial (o proxy filtra handshake) |
| Limite por origem / tarpit | só nftables | granular no proxy |
| Trocar daemon sem mexer no cliente | não | sim (o cliente conecta no gateway estável) |
| Custo de RAM | 0 | ProxySQL ~30–50 MB / PgBouncer ~5–10 MB por ambiente exposto |

O custo de RAM é real mas pequeno e **cai sobre o cliente que paga o dedicado** — cabe no orçamento do tier.

### 4.3 Porta: mudar de 3306/5432?

**Sim, usar porta alta única por ambiente (ex.: `13000 + env_id`), não 3306/5432.** É *security through
obscurity* e não conta como defesa real — mas **remove o alvo dos scanners de massa**, que varrem 3306/5432
o dia todo e ignoram portas altas aleatórias. Custa nada e reduz o ruído de log e a taxa de brute-force em
ordens de grandeza. O painel entrega o comando de conexão pronto com a porta certa (o cliente não precisa
decorar). A porta é registrada em `db_open_access.gateway_port`.

### 4.4 Config do gateway (essencial)

ProxySQL (MariaDB) — só a conta `_r`, backend privado, TLS obrigatório para o frontend:

```
# proxysql.cnf (por ambiente exposto)
mysql_variables=
{
    interfaces="0.0.0.0:13099"
    have_ssl=true
    ssl_p2s_cert="/etc/proxysql/tls/gw-cert.pem"
    ssl_p2s_key="/etc/proxysql/tls/gw-key.pem"
    ssl_p2s_ca="/etc/proxysql/tls/veloz-db-ca.pem"   # valida cert de cliente
    connect_timeout_server_max=5000
    max_connections=20                                # teto global do gateway p/ este ambiente
}
mysql_servers=( { address="10.60.1.99" port=3306 hostgroup=0 max_connections=10 } )
mysql_users=(  { username="e0099_r" default_hostgroup=0 max_connections=10 } )
```

PgBouncer (PostgreSQL) — `auth_query` passthrough, TLS client cert exigido:

```ini
# pgbouncer.ini (por ambiente exposto)
[databases]
e0099_app = host=10.60.1.99 port=5432 dbname=e0099_app

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 13099
client_tls_sslmode      = verify-full
client_tls_ca_file      = /etc/pgbouncer/tls/veloz-db-ca.crt
client_tls_cert_file    = /etc/pgbouncer/tls/gw.crt
client_tls_key_file     = /etc/pgbouncer/tls/gw.key
server_tls_sslmode      = require
pool_mode   = session          # session: não quebra LISTEN/NOTIFY, advisory locks, temp tables (doc 09 §1.3)
max_client_conn = 20
default_pool_size = 10
```

> Nota: no PG, `pool_mode=session` é obrigatório aqui pelo mesmo motivo do doc 09 §1.3 — o cliente conecta
> com uma ferramenta real e usa recursos de sessão. `transaction` mode quebraria silenciosamente.

---

## 5. Responsabilidade, LGPD e AUP

### 5.0 De quem é a responsabilidade se vazar

Enquadramento (doc 02 §13): VelozPanel é **operador** dos dados que o cliente hospeda e **controlador** do
cadastro do cliente. No modo aberto:

- O cliente **decidiu** expor o banco (finalidade e meio da exposição são dele) e **assinou** o termo.
  Quanto à decisão de abrir, o cliente age como **controlador** dos próprios dados hospedados.
- VelozPanel mantém a obrigação de **entregar as salvaguardas técnicas** (§2): TLS, mTLS, conta separada,
  brute-force protection, gateway, dedicado. Se um vazamento decorre de **falha dessas salvaguardas**, a
  responsabilidade é do operador. Se decorre de **senha fraca do cliente, cert compartilhado por ele, ou
  app dele com SQL injection**, a responsabilidade é do cliente, e o termo documenta isso.
- A fronteira é: **VelozPanel responde pela porta; o cliente responde por quem ele deixa entrar.**

Marco Civil (art. 15): registros de acesso à aplicação por **6 meses** — os logs de conexão do gateway
(IP de origem, timestamp com fuso, ambiente) são guardados comprimidos, em bucket separado, retenção 6 meses
(mínimo legal; 12 se houver parecer jurídico), acesso auditado. LGPD: a ativação do modo aberto e o aceite
ficam no `audit_logs` (append-only, 24 meses) como prova de consentimento informado.

### 5a. Texto de aceite que o CLIENTE assina (ao solicitar)

> **Termo de Acesso Remoto Aberto ao Banco de Dados (v1)**
>
> Você está solicitando liberar o acesso ao seu banco de dados **a partir de qualquer endereço IP da
> internet** (`0.0.0.0/0`). Leia antes de confirmar:
>
> 1. **O que muda.** Seu banco passará a ser um **banco dedicado isolado** (incluído nesta solicitação, com
>    custo adicional exibido acima). A porta ficará acessível pela internet, protegida por criptografia
>    obrigatória (TLS), **certificado de cliente** (que só nós emitimos para você), conta de acesso
>    separada, limites de conexão e proteção contra tentativas de invasão.
> 2. **O risco que é seu.** Expor um banco à internet aumenta a chance de acesso indevido. **Você é
>    responsável** por: manter a senha e o certificado em segredo, não compartilhá-los, usar senhas fortes,
>    e proteger sua própria aplicação (ex.: contra SQL injection). Se o vazamento ocorrer por descuido seu
>    com essas credenciais ou por vulnerabilidade da sua aplicação, a responsabilidade é sua.
> 3. **O que continua sendo nosso.** Manter as proteções técnicas acima funcionando. Se você as recusa ou
>    tenta desligá-las, o acesso é revogado.
> 4. **Alternativa mais segura.** Para a maioria dos casos, **túnel SSH** ou **liberar apenas seu IP fixo**
>    resolve com o mesmo conforto e sem expor a porta. Recomendamos fortemente essas opções.
> 5. **Vigência.** Esta liberação **expira em até 90 dias** e precisa ser reconfirmada. Ela é **revogada
>    automaticamente** se você pausar o ambiente. Você pode revogá-la a qualquer momento.
> 6. **Registro.** Esta autorização, com data, seu IP e seu usuário, fica registrada para fins de segurança
>    e cumprimento da lei (Marco Civil da Internet, art. 15; LGPD).
>
> ☐ **Li, entendi os riscos e autorizo a liberação do acesso de qualquer IP ao meu banco de dados dedicado.**
> *(o aceite grava versão, hash do texto, IP e horário)*

### 5b. Texto que o SUPER ADMIN vê (ao ligar a chave global)

> **⚠️ Ativar "Modo aberto de banco" no sistema**
>
> Você está prestes a **habilitar a existência** do modo aberto (`0.0.0.0/0`) no VelozPanel. Isto **não abre
> nenhum banco agora** — apenas passa a permitir que clientes *solicitem* e que você *aprove* aberturas,
> caso a caso.
>
> O que o sistema garante mesmo assim, e você não pode desligar:
> - Modo aberto **só em banco dedicado**. Nunca no banco compartilhado. Seus outros clientes do mesmo
>   servidor **não** ficam expostos.
> - TLS + certificado de cliente obrigatórios, conta separada, gateway na frente do banco, limites e
>   proteção contra força-bruta.
> - Toda abertura passa por **sua aprovação individual**, com aceite assinado pelo cliente, e **expira em
>   até 90 dias**.
>
> O que você aceita ao ligar isto: expor bancos dedicados de clientes que pedirem é um risco real de
> segurança e de LGPD. A responsabilidade pela decisão de abrir é do cliente (por termo assinado); a
> responsabilidade de manter as proteções técnicas é sua. Esta ação fica registrada na auditoria.
>
> Para confirmar, digite **CONFIRMO** e clique em Ativar.
> `[ ____________ ]`  [ Ativar modo aberto no sistema ]  [ Cancelar ]

### 5c. O que a auditoria registra

Todo evento de ciclo de vida gera linha em `audit_logs` (schema do doc 03 §… `audit_logs`). Ações:

| `action` | `actor_kind` | `before`/`after` | Campos-chave |
|---|---|---|---|
| `db.open.system.enable` / `.disable` | `superadmin` | flag antes/depois | `actor_ip`, `ts`, texto "CONFIRMO" digitado |
| `db.open.request` | `user` | `state: none→requested` | `accept_version`, `accept_hash`, `accept_ip`, `requested_by` |
| `db.open.approve` | `superadmin` | `state: requested→approved` | `approved_by`, `validity_days`, `expires_at` |
| `db.open.reject` | `superadmin` | `state: requested→rejected` | `reject_reason` |
| `db.open.activate` | `system` | `state: approved→active` | `gateway_port`, `remote_role`, `client_cert_cn`, `dedicated_db_id` |
| `db.open.revoke` | `user`/`superadmin`/`system` | `state: active→revoked` | `revoke_reason` (client/admin/expired/paused/migrated/abuse) |
| `db.open.rotate_secret` | `user` | — | quando o cliente gira a senha remota |

Além do `audit_logs` (retenção 24 meses), os **logs de conexão do gateway** (IP origem, timestamp+fuso,
ambiente, sucesso/falha) vão para o bucket de logs com retenção de **6 meses** (Marco Civil art. 15).

---

## 6. Interação com o resto do sistema

| Tema | Regra (fechada) | Motivo |
|---|---|---|
| **Pausa do ambiente** | Ativo → **revoked** na pausa. A conta `_r` é destruída, o gateway para, a porta fecha. **Não** volta sozinho no start; o cliente re-solicita | Mantém a regra do doc 09 §1.7; ambiente pausado não deve manter porta aberta ociosa na internet |
| **Expiração** | O modo aberto **não é permanente**: `expires_at` obrigatório, máx **90 dias**. Job `db.open.expire` revoga o vencido e notifica. Re-confirmação renova por mais 90 d | O /32 do doc 09 expira em 30 d; o aberto é mais arriscado, então também expira — 90 d equilibra fricção × risco |
| **Alerta na ativação** | E-mail + notificação in-app ao **cliente** ("seu banco foi aberto para a internet") e ao **super admin** ("abertura X ativada"). Evento `db.open.activated` na central de notificações (doc 01 §4.15) | O cliente precisa saber que sua porta está aberta; o admin precisa da visão de frota |
| **Alerta de ataque** | Pico de tentativas de conexão/falha de auth (via CrowdSec/gateway) dispara alerta ao admin e, se sustentado, ao cliente. Ban automático já ocorre (§2.5); o alerta é para visibilidade | "Nunca só diagnosticar" (doc 01 §5.1.1): o alerta vem com "revogar acesso agora" de um clique |
| **Migração de nó** | O acesso aberto **não acompanha**. Migração revoga (revoke_reason=`migrated`); no novo nó o cliente re-solicita (IP de origem, gateway e cert mudam) | Carregar automaticamente reabriria uma porta num contexto de rede diferente sem nova revisão humana |
| **Suspensão por inadimplência** | Container dedicado para; acesso aberto revogado; dado preservado | Igual ao dedicado (doc 09 §2.4) |
| **Quota / warden / limites** | Todos continuam valendo no container dedicado (doc 09 §1.8/§1.9); o modo aberto não afrouxa nenhum | Abrir a porta não é desculpa para tirar as outras proteções |
| **Relatório de frota** | Tela do super admin lista **todos os bancos abertos ativos**, com ambiente, cliente, `expires_at`, IPs que conectaram, contagem de bans | Um banco aberto esquecido é o pior estado; o relatório mensal força a revisão |

---

## 7. UI completa

### 7.1 Super admin — chave global (`/admin/seguranca/banco-aberto`)

- Toggle mestre **"Modo aberto de banco (0.0.0.0/0)"**, OFF de fábrica, com o selo `Desligado — recomendado`.
- Ao tentar ligar: modal com o texto 5b e o campo **"digite CONFIRMO"** (o botão Ativar só habilita com a
  palavra exata). Ação auditada.
- Abaixo do toggle, quando ON: **fila de pedidos** (`requested`) para aprovar/recusar, e a lista de
  **abertos ativos** (ambiente, cliente, engine, porta do gateway, `expires_at`, nº de bans nas últimas 24h,
  botão **Revogar agora**).
- Ao aprovar um pedido: seletor de validade (30/60/90 d, default 90), o texto de risco resumido, e
  novamente confirmação. Ao recusar: campo de motivo (vai para o cliente).

### 7.2 Cliente — na tela de Banco de dados (doc 01 §1.13)

A escada do doc 09 §1.6 ganha o degrau 4, **só visível se a chave global estiver ON e o ambiente for/puder
ser dedicado**:

```
Acesso ao banco
  ● Adminer no painel (recomendado)                    [Abrir]
  ○ Túnel SSH (recomendado p/ IP que muda)             [Copiar comando]
  ○ Liberar meu IP atual / IPs específicos (/32)       [Gerenciar]
  ○ Acesso de qualquer IP (0.0.0.0/0)  — avançado, pago, requer aprovação
        └─ "Expõe seu banco à internet. Exige banco dedicado (R$ 49/mês),
            criptografia e certificado. Para a maioria, o túnel SSH resolve."
            [Solicitar acesso aberto]   → abre o Termo (§5a)
```

- Enquanto `requested`: banner "Solicitação em análise pelo suporte".
- Enquanto `active`: card com **host, porta do gateway, usuário `_r`, botão baixar certificado de cliente,
  botão girar senha, `expira em DD/MM`, botão Revogar agora**, e o comando de conexão pronto (mysql/psql com
  `--ssl-cert`/`sslcert`).
- A tela **diz a verdade na hora da escolha** (princípio doc 01 §5.1.2): a opção mais perigosa é a menos
  destacada, vem com o custo e com a recomendação da alternativa segura ao lado — nunca é o default, nunca é
  um toggle solto como no Hostoo.

### 7.3 Auditoria e alertas

- Auditoria: cada transição aparece na tela `/admin/auditoria` (doc 01 §4.11) filtrável por ação
  `db.open.*`, com ator, IP, ambiente, resultado.
- Alertas: eventos `db.open.activated`, `db.open.expiring` (D-7), `db.open.bruteforce_spike` na central de
  notificações do cliente e no painel de abuso/segurança do super admin (doc 01 §4.12), cada um com botão de
  ação (revogar / renovar).

---

## Decisões fechadas

- **D-A1. Chave global do super admin, OFF de fábrica**, com "digite CONFIRMO". É o disjuntor mestre; sem
  ela ON, o recurso não existe em nenhuma tela nem na API.
- **D-A2. Modo aberto ⇒ banco dedicado, obrigatório e sem exceção.** O `0.0.0.0/0` **nunca** ocorre na
  instância compartilhada. Ambiente compartilhado que pede abertura é migrado para dedicado (doc 09 §2.2)
  no mesmo fluxo.
- **D-A3. Granularidade: cliente SOLICITA → super admin APROVA caso a caso, por ambiente.** Não existe "o
  admin libera e o cliente escolhe sozinho". Máquina de estados: `none→requested→approved→active→revoked`
  (+ `rejected`/`failed`).
- **D-A4. Gateway de banco (ProxySQL/PgBouncer) na frente; o daemon segue em bind privado `10.60.1.x`.**
  Porta pública alta única por ambiente (`13000+env_id`), nunca 3306/5432. Nada de DNAT direto ao daemon.
- **D-A5. Salvaguardas inegociáveis, não-desligáveis:** (1) TLS + **certificado de cliente (mTLS)**;
  (2) conta `_r` separada da app, senha 32 B CSPRNG, rotacionável, destruída na revogação; (3) grant só ao
  database do cliente; (4) limite de conexões + `statement_timeout`/`MAX_STATEMENT_TIME` + warden;
  (5) CrowdSec com cenário de auth de banco + ban progressivo + tarpit; (6) nftables rate-limit por origem.
- **D-A6. Expiração obrigatória de 90 dias com re-confirmação; pausa revoga; migração de nó não carrega.**
- **D-A7. Aceite jurídico do cliente + confirmação "CONFIRMO" do admin + auditoria completa** (quem, quando,
  aceite com hash e IP, validade). Logs de conexão do gateway retidos 6 meses (Marco Civil art. 15).
- **D-A8. Padrão de fábrica da chave: global OFF; quando ON, só via tier dedicado; sempre com mTLS +
  brute-force protection + aceite + expiração.** É a forma mais segura de entregar exatamente o que o dono
  pediu.

## Risco residual que o dono aceita ao ligar

Mesmo com tudo acima aplicado, sobra risco — e é honesto nomeá-lo:

1. **A porta está na internet.** Nenhuma mitigação torna uma porta de banco pública tão segura quanto uma
   fechada. Um 0-day pré-auth no MariaDB/PG **do container do cliente** ainda o compromete (mas só ele, não
   os 22 — é o que A2 compra).
2. **Credencial nas mãos do cliente.** Se o cliente vaza a senha **e** o certificado (commit no GitHub,
   `.env` público, notebook roubado), o mTLS não salva. A responsabilidade é dele por termo, mas o dado
   vazou — e o dado pode ser de terceiros (os usuários do cliente), o que respinga reputação.
3. **O gateway e o CrowdSec são software e podem ter bug/estar fora do ar.** As camadas são defesa em
   profundidade justamente porque cada uma pode falhar; o nftables rate-limit é a rede de baixo.
4. **Passivo LGPD sempre presente.** VelozPanel é operador; um vazamento, mesmo com culpa do cliente, gera
   trabalho de resposta a incidente, comunicação à ANPD se aplicável, e desgaste. O termo reduz o passivo
   jurídico, não o operacional.
5. **Superfície de suporte e vigilância.** Cada banco aberto é algo a monitorar. Para um operador só, isso
   é custo cognitivo permanente — mitigado pelo relatório de "abertos ativos" e pela expiração de 90 d, mas
   não zerado.

O dono aceita explicitamente 1–5 ao ligar a chave global. A recomendação do especialista de segurança é
**manter a chave OFF** e resolver 90% dos casos reais com túnel SSH / allowlist /32 (doc 09 §1.6); ligar o
modo aberto só para o cliente específico que justifica, e sempre pela via dedicada blindada acima.

## O que isto muda no doc 09

1. **§1.6 — a escada de acesso ganha o "Nível 4 (aberto)".** O antigo `∅  0.0.0.0/0 / % → "não existe no
   produto"` passa a: **"Nível 4 — só via banco dedicado, sob chave global do super admin OFF por padrão,
   pedido+aprovação, mTLS, gateway, expiração 90 d"**. O texto "a UI recusa `%`/`0.0.0.0/0`" continua
   valendo **no banco compartilhado**; deixa de ser absoluto no produto inteiro.
2. **D7 (tabela §0) — reescrever.** De "a UI **recusa** `%` e `0.0.0.0/0`" para "no compartilhado, recusa;
   `0.0.0.0/0` só existe no tier dedicado sob o modelo do doc 14 (chave global + aprovação + mTLS +
   gateway + expiração)".
3. **§1.5 pg_hba / GRANT** — acrescentar as linhas `hostssl ... 0.0.0.0/0 ... clientcert=verify-full` e a
   conta `_r` com `REQUIRE X509`, **apenas** em containers dedicados, geradas pelo job `db.open.enable`.
4. **§2 (tier dedicado)** — acrescentar que "acesso aberto" é um dos **gatilhos** que levam ao dedicado, e
   que ao ativá-lo o container recebe a config `*-open.cnf` (require_secure_transport ON, TLSv1.3, mTLS).
   Reusa o meter `db.dedicated.hour`; **nenhum meter novo**.
5. **§1.7 (pausa)** — a linha "acesso remoto liberado → revogado na pausa" passa a cobrir também o Nível 4
   (a conta `_r` destruída, gateway parado, porta fechada).
6. **Novos jobs do agente:** `db.open.enable`, `db.open.disable`, `db.open.expire`, `db.open.rotate_secret`
   — a documentar junto aos jobs de banco existentes.
