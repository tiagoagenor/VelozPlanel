# 12 — Multi-região (Brasil + EUA) e Gestão de Domínios

> **Especialista de Multi-região & Domínios · Ciclo 3.**
> Missão definida pelo **ADENDO 4** do `00-BRIEFING.md`, §J (multi-região) e §K (domínios).
> Este documento é a primeira vez que multi-região é **projetada**, e não apenas *ganchada*.
> Até aqui existiam três ganchos isolados: `nodes.region` em `03` §4.2, `price_tables.region` em
> `07` P15, e a observação de UX de que o Hostoo mostra bandeira de região em `01`.
>
> **Postura.** O ADENDO 3 §I é explícito: o momento é de **validação com poucos clientes**, não de
> escala. Este documento não vai propor uma malha global. Vai propor o **menor desenho de duas regiões
> que é correto do ponto de vista legal, operacional e contábil**, e vai dizer com todas as letras
> onde ele custa mais do que rende.
>
> **Convenção de marcação:** `[EST]` = estimativa própria, não é preço público. `[VERIFICAR]` = fato
> que precisa de confirmação antes de virar compromisso contratual.

---

## 0. Sumário executivo — as 14 decisões que este documento fecha

| # | Decisão | Onde |
|---|---|---|
| **D1** | **Região é uma entidade de primeira classe**, com tabela própria (`core.regions`), não uma string livre em `nodes`. Ela carrega jurisdição, moeda de custo, tabela de preço, destino de backup e fuso de exibição. | §1 |
| **D2** | **`environments.region` é coluna própria, NOT NULL e imutável**, separada de `node_id`. Nó é implementação; região é promessa comercial e jurídica. | §1.4 |
| **D3** | **Trocar de região não é migração — é recriação com novo consentimento.** Fluxo `environment.region_move` = backup → provisionar no destino → restore → cutover → destruir. Janela declarada: **20–60 min**, não 60–180 s. | §1.6 |
| **D4** | **Sim, brasileiro pode ser hospedado nos EUA** — mas só sob **cláusulas-padrão contratuais da ANPD (Res. CD/ANPD 19/2024)** + **escolha explícita, informada e registrada** do cliente. Sem consentimento gravado com timestamp e texto versionado, a região `us-*` não é oferecida. | §2 |
| **D5** | **Control plane fica no Brasil.** Definitivo. Não é empate. | §3 |
| **D6** | **A regra "painel cai, sites ficam no ar" vale entre continentes** — e para isso o ACME DNS-01 **não pode depender do PowerDNS brasileiro**. Delegação de `_acme-challenge` para uma zona anycast é requisito, não otimização. | §3.5 |
| **D7** | **Cobrança sempre em BRL**, inclusive para a região `us-east1`. Preço da região americana **fixado em BRL com câmbio administrado** (revisão trimestral com gatilho de ±8%), não indexado ao dólar do dia. | §4 |
| **D8** | **A economia do nó dos EUA repassa ~30% e embolsa ~70%** — e mesmo assim **não salva a frota**: o resultado com 2 nós BR + 1 nó US continua negativo. O nó dos EUA muda o custo por GB, não o problema. | §4.4 |
| **D9** | **Backup de nó dos EUA fica nos EUA** (B2 `us-west-004`), com a cópia 3 no Brasil **apenas para ambientes de região `br-*`**. Ambiente `us-*` não ganha cópia no Brasil por padrão. | §5 |
| **D10** | **Escolha de região é uma tela de decisão, não um dropdown.** Default `br-se1`, com bloqueio duro: público-alvo Brasil + região EUA = confirmação dupla. | §6 |
| **D11** | **Sem anycast próprio.** `ns1`/`ns2` = PowerDNS em BR e US (um em cada continente), com **Cloudflare como NS terciário/secundário quando o volume justificar**. ASN + /24 + BGP é custo e complexidade que a frota não paga. | §8 |
| **D12** | **`mod-dns` fecha o escopo aqui**: 12 tipos de registro, importação de zona, templates, DNSSEC **desligado por padrão e opt-in por domínio**, integração ACME DNS-01 obrigatória. | §9 |
| **D13** | **Registro de domínio NÃO entra no produto.** Nem no MVP, nem na v1. Entra como `mod-registrar` **futuro e condicionado a um gatilho numérico explícito** (§10.6). | §10 |
| **D14** | **Subdomínio grátis `*.veloz.app` com wildcard TLS único** — é o que impede estourar o limite do Let's Encrypt e é o caminho de entrada de todo cliente sem domínio. Promoção para domínio próprio é **zero-downtime por construção**. | §11 |

---

## 1. Modelo de região

### 1.1 O que é uma região — a definição que o sistema usa

Uma região **não** é um datacenter, nem um provedor, nem uma cidade. No VelozPanel, região é o
**menor agrupamento que amarra simultaneamente três coisas que precisam variar juntas**:

| Eixo | O que a região determina | Por que não pode ser atributo de nó |
|---|---|---|
| **Jurídico** | Sob que lei o dado em repouso está; se há transferência internacional; que anexo do DPA se aplica | O cliente consente com um **país**, não com um número de série de VPS. Se fosse atributo de nó, um `migrate` de rotina do super admin trocaria a jurisdição do dado sem consentimento — que é exatamente o incidente que a LGPD pune |
| **Econômico** | Que `price_tables` vale, qual é o custo por GB de RAM, qual é o destino de backup e o preço de egress | `07` P15 já decidiu que preço é versionado **por região**. Se preço variasse por nó, o cliente pagaria diferente por trocar de máquina — inaceitável |
| **De latência** | Que população de usuário final é servida bem (RTT ao público-alvo) | Todos os nós de uma região têm, por definição, o mesmo perfil de latência ao público. Se dois nós têm perfis diferentes, são **duas regiões** |

**Regra de decisão para criar uma região nova:** *"se eu mover um ambiente do nó A para o nó B sem
avisar o cliente, alguma dessas três coisas muda?"* Se sim, A e B estão em **regiões diferentes**.
Se não, estão na mesma região, e o `migrate` de `06` §8.2 continua sendo uma operação interna
silenciosa — que é o que faz aquele procedimento ser aceitável.

### 1.2 Nomenclatura

Gramática fechada, validada por `CHECK` no banco:

```
^[a-z]{2}-[a-z]{2,4}[0-9]$
 país     macro-área  índice
 ISO 3166-1 alpha-2
```

| Slug | Nome de exibição | País | Fuso de exibição | Status dia 1 |
|---|---|---|---|---|
| `br-se1` | Brasil · Sudeste | BR | `America/Sao_Paulo` | **ativa** (os 2 nós de produção do ADENDO 3) |
| `us-east1` | Estados Unidos · Leste | US | `America/New_York` | **planejada** (nó novo do ADENDO 4) |
| `br-lab1` | Brasil · Laboratório | BR | `America/Sao_Paulo` | **interna** — o nó de teste do ADENDO 3, `sellable = false` |

Três consequências de nomenclatura que evitam retrabalho:
1. **O país vem primeiro e é ISO-3166.** É o que permite `WHERE region_country <> tenant_country`
   detectar transferência internacional numa query, sem tabela de-para.
2. **O índice numérico existe desde o primeiro slug.** `br-se1` já prevê `br-se2` (segundo provedor
   na mesma jurisdição e mesmo perfil de latência) sem renomear nada.
3. **O nó de teste ganha região própria (`br-lab1`), não um flag.** Isso resolve de graça o problema
   de `07` §3.10: o nó de homologação nunca aparece no scheduler, nunca aparece no funil, e a
   capacidade vendável é `SUM(...) WHERE sellable`, sem exceção codificada em lugar nenhum.

### 1.3 Atributo de região × atributo de nó

| Atributo | Região | Nó | Observação |
|---|:---:|:---:|---|
| Código do país / jurisdição | ✅ | ❌ | |
| Texto legal e anexo do DPA aplicável | ✅ | ❌ | versionado; §2.5 |
| `price_table` vigente | ✅ | ❌ | já era assim em `07` P15 |
| Moeda de **custo** (o que pagamos ao provedor) | ✅ | ❌ | BRL em `br-*`, USD em `us-*` |
| Moeda de **cobrança** (o que o cliente paga) | ❌ | ❌ | é do **tenant**, e é sempre BRL — §4 |
| Destino de backup padrão | ✅ | ❌ | §5 |
| Fuso horário de exibição e de janela de manutenção | ✅ | ❌ | §7 |
| Nameservers autoritativos anunciados | ✅ | ❌ | §8 |
| Endereço IP público, CPU, RAM, disco | ❌ | ✅ | |
| Provedor / parceiro | ❌ | ✅ | "um nó por provedor" (ADENDO 1 §B) continua valendo **dentro** da região |
| Capabilities instaladas (`runtime.php`, ...) | ❌ | ✅ | mas a UI só oferece o que existe em **todos** os nós vendáveis da região — §1.5 |
| `oversubscribe_cpu`, `allocatable_*` | ❌ | ✅ | |
| Status operacional (`online`, `draining`, ...) | ❌ | ✅ | região tem status **comercial**, não operacional |
| Latência típica ao público-alvo | ✅ | ❌ | número publicado na tela de escolha |

### 1.4 Mudanças no modelo de dados de `03` §4.2

**DDL — migration `0031_regions.sql`:**

```sql
SET search_path = core;

-- ─── A entidade que faltava ───────────────────────────────────────────────────
CREATE TABLE regions (
  slug              text PRIMARY KEY
                    CHECK (slug ~ '^[a-z]{2}-[a-z]{2,4}[0-9]$'),
  display_name      text NOT NULL,                    -- 'Brasil · Sudeste'
  country_code      char(2) NOT NULL,                 -- ISO 3166-1 alpha-2, MAIÚSCULO
  jurisdiction      text NOT NULL,                    -- 'BR' | 'US' — lei aplicável ao dado em repouso
  display_timezone  text NOT NULL,                    -- IANA: 'America/Sao_Paulo'
  cost_currency     char(3) NOT NULL,                 -- moeda em que PAGAMOS a infra
  -- Comercial
  sellable          boolean NOT NULL DEFAULT false,   -- aparece no funil de criação
  accepting_new     boolean NOT NULL DEFAULT true,    -- pode receber ambiente novo (kill switch)
  sort_order        int NOT NULL DEFAULT 0,
  -- Legal (§2). NULL em região doméstica.
  transfer_notice_key text,                           -- chave do texto versionado exibido na escolha
  dpa_annex_key       text,                           -- anexo de cláusulas-padrão aplicável
  requires_explicit_consent boolean NOT NULL DEFAULT false,
  -- Operação (§3, §5, §7)
  rtt_ms_to_br      int,                              -- RTT p50 publicado até São Paulo
  rtt_ms_to_us      int,
  heartbeat_degraded_s   int NOT NULL DEFAULT 45,     -- §3.3: regiões distantes afrouxam
  heartbeat_unreachable_s int NOT NULL DEFAULT 180,
  backup_primary_bucket   text NOT NULL,              -- §5
  backup_secondary_bucket text,                       -- NULL = sem cópia 3
  maintenance_window      text NOT NULL DEFAULT '03:00-05:00',  -- LOCAL da região
  -- Nameservers autoritativos anunciados para domínios desta região (§8)
  nameservers       text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO regions (slug, display_name, country_code, jurisdiction, display_timezone,
                     cost_currency, sellable, sort_order, rtt_ms_to_br, rtt_ms_to_us,
                     backup_primary_bucket, backup_secondary_bucket, nameservers)
VALUES
 ('br-se1','Brasil · Sudeste','BR','BR','America/Sao_Paulo','BRL', true, 10, 12, 130,
  'b2:veloz-prod-br','magalu:veloz-br-cold', '{ns1.velozpanel.com.br,ns2.velozpanel.com.br}'),
 ('br-lab1','Brasil · Laboratório','BR','BR','America/Sao_Paulo','BRL', false, 99, 12, 130,
  'b2:veloz-lab', NULL, '{}');

-- us-east1 entra por migration própria só quando o nó existir E o texto legal estiver publicado.

-- ─── nodes: a string livre vira FK ────────────────────────────────────────────
ALTER TABLE nodes
  ALTER COLUMN region SET DEFAULT 'br-se1',
  ADD CONSTRAINT nodes_region_fk FOREIGN KEY (region) REFERENCES regions(slug);
-- e o índice que o scheduler passa a usar em toda alocação:
CREATE INDEX nodes_region_sched ON nodes (region, status)
  WHERE scheduling_enabled AND status = 'online';

-- ─── environments: região é coluna PRÓPRIA, não derivada do nó ────────────────
ALTER TABLE environments
  ADD COLUMN region text NOT NULL DEFAULT 'br-se1' REFERENCES regions(slug),
  ADD COLUMN region_consent_id uuid,          -- FK adiante; NULL só se região doméstica
  ADD COLUMN region_locked_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX environments_region ON environments (region, state);

-- INVARIANTE CENTRAL: o nó em que o ambiente roda tem que estar na região contratada.
-- Isso é o que torna impossível um `migrate` acidental cruzar fronteira.
CREATE OR REPLACE FUNCTION assert_env_node_same_region() RETURNS trigger AS $$
DECLARE node_region text;
BEGIN
  IF NEW.node_id IS NULL THEN RETURN NEW; END IF;
  SELECT region INTO node_region FROM core.nodes WHERE id = NEW.node_id;
  IF node_region IS DISTINCT FROM NEW.region THEN
    RAISE EXCEPTION 'cross-region placement blocked: env region=% node region=% (use environment.region_move)',
      NEW.region, node_region USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER environments_region_guard
  BEFORE INSERT OR UPDATE OF node_id, region ON environments
  FOR EACH ROW EXECUTE FUNCTION assert_env_node_same_region();

-- E a região do ambiente é IMUTÁVEL fora do job autorizado (§1.6):
CREATE OR REPLACE FUNCTION assert_region_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.region IS DISTINCT FROM NEW.region
     AND current_setting('vp.allow_region_move', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'environments.region is immutable; use job environment.region_move'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER environments_region_immutable
  BEFORE UPDATE ON environments FOR EACH ROW EXECUTE FUNCTION assert_region_immutable();

-- ─── tenants: país do titular e moeda de cobrança ─────────────────────────────
ALTER TABLE tenants
  ADD COLUMN country_code char(2) NOT NULL DEFAULT 'BR',
  ADD COLUMN home_region  text NOT NULL DEFAULT 'br-se1' REFERENCES regions(slug);
-- tenants.currency já existe em `03` §4.2 com DEFAULT 'BRL'. Vira CHECK explícito (§4.1):
ALTER TABLE tenants ADD CONSTRAINT tenants_currency_brl CHECK (currency = 'BRL');

-- ─── Consentimento de transferência internacional (§2) — append-only ──────────
CREATE TABLE region_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id        uuid NOT NULL REFERENCES users(id),      -- QUEM clicou
  region         text NOT NULL REFERENCES regions(slug),
  environment_id uuid,                                     -- NULL = consentimento na criação
  notice_key     text NOT NULL,                            -- 'transfer.us.v3'
  notice_version int  NOT NULL,
  notice_text_sha256 text NOT NULL,                        -- hash do texto EXATO exibido
  legal_basis    text NOT NULL
                 CHECK (legal_basis IN ('clausulas_padrao','consentimento_especifico',
                                        'execucao_contrato','adequacao')),
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  actor_ip       inet NOT NULL,
  user_agent     text,
  revoked_at     timestamptz                               -- revogação = gatilho de region_move
);
CREATE INDEX ON region_consents (tenant_id, region);
ALTER TABLE environments
  ADD CONSTRAINT environments_consent_fk
  FOREIGN KEY (region_consent_id) REFERENCES region_consents(id);

-- Guarda de negócio: região que exige consentimento não aceita ambiente sem consentimento.
ALTER TABLE environments ADD CONSTRAINT environments_consent_required CHECK (
  region_consent_id IS NOT NULL OR region IN (SELECT slug FROM regions WHERE NOT requires_explicit_consent)
);
-- (na prática implementado como trigger, porque CHECK não aceita subquery — ver nota abaixo)
```

> **Nota de implementação:** o último `CHECK` acima é ilustrativo — PostgreSQL não permite subquery em
> `CHECK`. A guarda real é um trigger `BEFORE INSERT OR UPDATE` idêntico ao `environments_region_guard`.
> Está escrito assim de propósito para deixar a **regra de negócio** explícita no DDL.

**Mudanças em `07` (billing) — migration `0032_regions_billing.sql`:**

```sql
SET search_path = billing;

ALTER TABLE price_tables      ADD CONSTRAINT price_tables_region_fk
  FOREIGN KEY (region) REFERENCES core.regions(slug);
ALTER TABLE plan_presets      ADD CONSTRAINT plan_presets_region_fk
  FOREIGN KEY (region) REFERENCES core.regions(slug);
ALTER TABLE environment_pricing ADD CONSTRAINT environment_pricing_region_fk
  FOREIGN KEY (region) REFERENCES core.regions(slug);

-- usage_rollups e usage_events passam a carregar região: sem isso, não existe
-- "quanto custou a região us-east1 este mês" nem rateio de câmbio (§4.3).
ALTER TABLE usage_rollups ADD COLUMN region text REFERENCES core.regions(slug);
ALTER TABLE usage_events  ADD COLUMN region text;   -- desnormalizado de propósito: append-only e quente
UPDATE usage_rollups SET region = 'br-se1' WHERE region IS NULL;
ALTER TABLE usage_rollups ALTER COLUMN region SET NOT NULL;
CREATE INDEX usage_rollups_region_month ON usage_rollups (region, period_start);

-- Câmbio administrado (§4.2) — append-only, é o que audita o preço da região us-*.
CREATE TABLE fx_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base          char(3) NOT NULL,      -- 'USD'
  quote         char(3) NOT NULL,      -- 'BRL'
  rate          numeric(18,8) NOT NULL CHECK (rate > 0),
  source        text NOT NULL,         -- 'ptax' | 'manual'
  effective_from timestamptz NOT NULL,
  effective_to   timestamptz,
  published_by  uuid REFERENCES core.users(id),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fx_rates_current ON fx_rates (base, quote) WHERE effective_to IS NULL;

-- Custo real da frota por região — o outro lado da conta de §4.4.
CREATE TABLE region_costs (
  region        text NOT NULL REFERENCES core.regions(slug),
  period_month  date NOT NULL,
  currency      char(3) NOT NULL,
  infra_cents   bigint NOT NULL,       -- na MOEDA DE CUSTO da região
  fx_rate_used  numeric(18,8),         -- NULL se currency = BRL
  infra_cents_brl bigint NOT NULL,     -- convertido; é o que entra no DRE
  note          text,
  PRIMARY KEY (region, period_month)
);
```

**Mudanças em `09` (backup) e `03` (backups):**

```sql
ALTER TABLE core.backups
  ADD COLUMN stored_region text REFERENCES core.regions(slug),   -- ONDE o objeto está
  ADD COLUMN stored_jurisdiction char(2);                        -- desnormalizado p/ relatório LGPD
ALTER TABLE core.backup_policies
  ADD COLUMN allow_cross_border boolean NOT NULL DEFAULT false;  -- §5.4
```

### 1.5 Efeito no scheduler e no catálogo

Três regras novas, todas simples e todas necessárias:

1. **`node.allocate` recebe `region` como filtro obrigatório**, antes de qualquer heurística de
   capacidade. Não existe "tenta na outra região se não couber" — se a região está cheia, o funil
   diz "esgotado nesta região" e **oferece a outra explicitamente**, com o texto legal, como uma
   escolha nova. Silenciosamente empurrar para o outro continente é o pior bug possível deste sistema.
2. **Uma capability só aparece no funil da região se estiver em 100% dos nós vendáveis da região.**
   Senão o cliente compra PostgreSQL, cai no nó que não tem, e o job falha. Query:
   `NOT EXISTS (SELECT 1 FROM nodes n WHERE n.region = $1 AND n.scheduling_enabled
   AND NOT EXISTS (SELECT 1 FROM node_capabilities c WHERE c.node_id = n.id AND c.capability = $2))`.
3. **`plan_presets` é por região.** Um preset `veloz-pro` de `br-se1` e um de `us-east1` são **duas
   linhas**, com preços diferentes (§4.3) e possivelmente disponibilidade diferente. O slug público
   é o mesmo; a chave é `(slug, region)`.

### 1.6 Região é imutável — e como se muda de região mesmo assim

**Região é imutável para o ambiente.** A coluna é protegida por trigger e só o job
`environment.region_move` (que roda com `SET LOCAL vp.allow_region_move = 'on'`) pode alterá-la.

**Por que não pode ser um `migrate` como o de `06` §8.2:**

| Motivo | Detalhe |
|---|---|
| **Jurídico** | Atravessar fronteira é fato gerador de consentimento novo (§2). O `migrate` de `06` §8.2 é uma operação **interna e silenciosa** do super admin — e tem que continuar sendo, dentro da região. Deixar esse mesmo botão cruzar continente é transformar uma operação de rotina em um incidente de conformidade |
| **Contábil** | A `price_table` muda. `usage_rollups` do mês teria duas tarifas para o mesmo ambiente. Precisa de **corte contábil explícito**, com fatura fechada até o cutover |
| **Físico** | O procedimento de `06` §8.2 assume 80–300 Mbit/s entre provedores brasileiros. Sobre 130–180 ms de RTT, **`rsync` de fluxo único desaba** |

**A física, com número.** Pela fórmula de Mathis, a vazão de um único fluxo TCP é
`≈ MSS × 8 / (RTT × √p)`. Com MSS 1460 B e RTT 150 ms:

| Perda de pacote `p` | Vazão por fluxo TCP | 5 GB levam |
|---:|---:|---:|
| 0,001% (link limpo) | ~246 Mbit/s (limitado pela janela) | ~3 min |
| 0,01% | ~78 Mbit/s | ~9 min |
| **0,1% (realista entre provedores diferentes, transcontinental)** | **~2,5 Mbit/s** | **~4,4 h** |
| 1% | ~0,8 Mbit/s | inviável |

Além disso, para saturar 200 Mbit/s a 150 ms é preciso janela de `200e6 × 0,15 / 8 = 3,75 MB` — acima
do `net.ipv4.tcp_rmem` padrão do Debian (6 MB de teto, mas com *autotuning* que raramente chega lá sob
perda). **Conclusão operacional: `rsync -e ssh` de fluxo único não é ferramenta transcontinental.**

**O procedimento real — `environment.region_move`:**

```text
D-7   super admin (ou cliente) solicita. UI apresenta:
      • novo texto de transferência internacional (§2.6) → grava region_consents
      • nova tarifa (tabela lado a lado, R$/mês antes × depois)
      • janela declarada: 20–60 min de indisponibilidade para 5 GB
      • aviso de latência ao público-alvo (§6)
D-1   velozctl dns ttl --env NNNN --set 60         (lead time obrigatório, igual a 06 §8.2)
      backup completo + backup.verify              (nunca mover sem restore provado)
D-0   1. provisionar ambiente-sombra na região destino (mesmo plano, mesmo runtime, imagem por digest)
      2. restic restore DO BUCKET DA REGIÃO DE ORIGEM para o nó destino
         → transferência é bucket→nó, MULTI-FLUXO (restic usa N conexões), não rsync ponto a ponto
      3. certificado emitido no destino por DNS-01 ANTES do corte (06 §8.2 nota 2)
      4. ═══ JANELA ═══
         pause origem → dump final do banco → upload ao bucket → restore no destino
         → start no destino → curl --resolve de validação real
      5. borda da origem vira proxy HTTPS para o destino (cobertura de DNS, 06 §8.2)
      6. DNS reaponta; corte contábil: fecha usage_rollups da região antiga
D+1   remove a cobertura, destrói o ambiente na origem --require-verified-backup
D+30  purga do repositório restic antigo (retenção legal cumprida)
```

| Item | Número |
|---|---|
| Janela de indisponibilidade real (5 GB + 300 MB de banco) | **20–60 min** [EST] |
| Downtime percebido pelo visitante | **0 s** (cobertura da borda) |
| Lead time obrigatório | **7 dias** (consentimento + TTL + backup verificado) |
| Custo de banda | egress do bucket de origem + ingress no destino — **cobrado no preço da operação** |
| Preço ao cliente | **R$ 0,00 na fase de validação**, com teto de 1 movimento por ambiente por trimestre |
| Reversível? | Sim, mesmo procedimento no sentido inverso, novo consentimento |

**Decisão:** `environment.region_move` é operação de **super admin apenas** no MVP (o cliente
**solicita** por chamado, não executa). Motivo: são 7 dias de lead time, corte contábil e coleta de
consentimento — não é botão de autoatendimento enquanto não houver 20 execuções bem-sucedidas.

---

## 3. Onde fica o control plane

### 3.1 A decisão

> ## **Control plane no BRASIL. Não é empate, e não se reavalia.**

Cinco razões, em ordem de peso:

1. **O dado mais sensível da empresa é brasileiro e fica sob controle brasileiro.** O CP guarda
   `tenants.tax_id` (CPF/CNPJ), `users.password_hash`, `totp_secret_enc`, tokens de API, chaves de PSP
   e ponteiros de chave privada de certificado (`03` §1.2). Deste conjunto, o VelozPanel é
   **controlador**, não operador (`02` §13.1). Manter esse banco no Brasil **elimina inteiramente** a
   análise de transferência internacional do ativo mais crítico. Colocar o CP nos EUA seria criar um
   problema de LGPD para toda a base de clientes a fim de otimizar a latência de nenhum deles.
2. **A latência que um humano sente todo dia é a do painel.** O cliente é brasileiro; o operador
   (o dono) é brasileiro. Um CP nos EUA custaria +130 ms em cada clique de painel de **100%** dos
   usuários, para economizar latência de gerência de **um** nó.
3. **O PSP é brasileiro.** Pix/Asaas manda webhook para o CP. Endpoint brasileiro, latência baixa,
   nenhuma discussão de bloqueio geográfico ou de transferência de dado de pagamento.
4. **Custo assimétrico do erro.** CP no BR e nó nos EUA = gerência do nó americano fica 130 ms mais
   lenta (irrelevante, §3.2). CP nos EUA e clientes no BR = painel lento para todo mundo + base de
   CPF no exterior. As duas pontas do erro não têm o mesmo tamanho.
5. **Terceiro lugar (Europa) é recusado.** Adicionaria latência para os dois lados, uma terceira
   jurisdição, exposição a GDPR sem nenhum cliente europeu, e um DPA a mais. Não há benefício.

Concretamente: **VPS de control plane 2 vCPU / 4 GB no Brasil, R$ 80/mês** (inalterado em relação a
`03` §1.2 e `07` §3.10.3).

### 3.2 O que sofre com 110–180 ms e o que não sofre

O princípio que salva este desenho já está escrito em `03` §1.6 e **agora vira requisito
intercontinental, não conselho**:

> **Nenhuma feature pode exigir chamada síncrona ao control plane no caminho de request do usuário
> final.** Se um módulo precisar disso, a decisão é **materializada em config no nó**, nunca
> consultada online.

| Funcionalidade | Sofre? | Efeito medido / raciocínio |
|---|:---:|---|
| **Sites servidos pelo nó dos EUA** | **não** | O CP não está no caminho. Borda, TLS, PHP/Node, banco e cron são todos locais ao nó |
| **Renovação ACME** | **não** — *desde que* §3.5 seja implementado | Quem fala com a Let's Encrypt é o nó. O que atravessa continente é a escrita do TXT de desafio, e é justamente isso que §3.5 resolve |
| **Heartbeat** | **não**, com ajuste | Limiares de `03` §1.5 são 45 s / 180 s — **250× a RTT**. Mas jitter e reroteamento transcontinental produzem estol de 2–5 s. Ver §3.3 |
| **Coleta de métricas** (`11` §2) | **não** | Coleta a cada 60 s, agente empurra em lote pelo outbox. O que importa é banda, não RTT. ~2 KB/min/ambiente comprimido → **< 100 MB/mês por nó** [EST] |
| **Eventos de uso / metering** (`07` §2) | **não** | Mesmo pipeline; eventos faturáveis têm prioridade no outbox e sobrevivem a 72 h de partição (`03` §1.6) |
| **Agendamento / scheduler** | **não** | Decide no CP, publica no NATS, o nó executa. Zero interatividade |
| **Jobs** (`03` §5) | **pouco** | Cada passo com ACK paga 1 RTT. Um job de 12 passos paga +2,2 s sobre um `environment.create` de ~15 min: **+0,24%**. Irrelevante |
| **Log ao vivo por SSE** (`03` §5.3) | **pouco** | A linha de log chega ao navegador +150 ms atrasada. Para saída de build rolando na tela, é imperceptível. **Mas:** exige que o agente **não** faça flush linha a linha — flush por linha em 150 ms de RTT vira 6,7 linhas/s de teto. Regra: **flush por lote de 16 linhas ou 200 ms, o que vier primeiro** |
| **Terminal web / SSH pelo painel** (`01`) | **sim, perceptível** | 150 ms de eco é o pior caso de UX deste documento. Digitação fica "borrachuda". É usável (foi assim que se usou telnet por 30 anos), mas precisa de mitigação — §3.4 |
| **Gerenciador de arquivos** (`01` §3.3) | **sim, se mal feito** | Listar diretório = 1 RTT = ok. Editor que salva a cada tecla = inaceitável. **Spec: salvamento explícito, operações em lote, nunca autosave por keystroke** |
| **Timeouts de RPC herdados de LAN** | **sim — é o bug que vai acontecer** | Qualquer timeout de 1 s ou 2 s vai piscar. **Regra: timeout mínimo de RPC = `max(5 s, 20 × RTT_p95 da região)`.** Para `us-east1`: **5 s** de piso, jobs longos com deadline próprio |
| **Locks de ambiente** (`03` §5.5) | **não** | `lock_expires_at` é medido em minutos |

### 3.3 O ajuste de heartbeat — e um bug real encontrado em `11`

Limiares por região (coluna `regions.heartbeat_*`, §1.4):

| Região | `degraded` | `unreachable` | Justificativa |
|---|---:|---:|---|
| `br-se1` | 45 s | 180 s | inalterado (`03` §1.5) |
| `us-east1` | **90 s** | **240 s** | rota transcontinental reconverge em dezenas de segundos; alarme a 45 s vira ruído, e alerta que toca à toa deixa de ser lido |

> ### 🐛 Achado — `11` §1 item 4 quebra com nó remoto
>
> `11` §1.4 diz: *"o CP **rejeita** amostra com `|ts − now| > 60 s`"*. Combinado com o outbox de
> store-and-forward de `03` §1.6 (dimensionado para **72 h**), isso significa que **toda amostra
> represada durante uma partição de link é descartada ao voltar** — inclusive evento faturável, se a
> mesma regra for aplicada ao pipeline de metering. É um bug latente hoje (partição BR↔BR é rara e
> curta) e vira um bug **certo** com um nó do outro lado do oceano.
>
> **Correção obrigatória:** separar `event_time` (carimbado pelo agente) de `received_at` (carimbado
> pelo CP). A validação passa a ser:
> - `event_time > received_at + 60 s` → **rejeita** (relógio do nó adiantado: dado inconfiável);
> - `event_time < received_at − 72 h` → **rejeita** (fora da janela do outbox: é replay);
> - entre os dois → **aceita**, grava as duas colunas, e alerta se o atraso passar de 10 min.
>
> O alerta `drift_relogio` de `11` §7 continua sendo `abs(clock_drift) > 2 s` — **medido por NTP no
> nó**, não pela diferença de carimbos, porque a diferença de carimbos passa a ser latência de
> entrega, não deriva de relógio. São duas métricas distintas e hoje estão confundidas.

### 3.4 Terminal web e o SSH — a única UX que a latência realmente machuca

Três mitigações, nesta ordem:

1. **Local echo otimista** no emulador de terminal (xterm.js) quando o `pty` está em modo canônico —
   o caractere aparece na hora e é reconciliado quando o eco real chega. Ganha ~100% da percepção em
   digitação de comando; não ajuda em `vim`/`htop`.
2. **Predição de digitação estilo Mosh não vale a complexidade** para uma frota de 22 ambientes.
   **Descartado.**
3. **Dizer a verdade na tela.** Na região `us-east1`, o terminal web abre com um chip
   `⚡ ~150 ms — servidor nos EUA` e um link "por que está lento?". Cliente que sabe por que está
   lento abre 1/5 dos chamados de cliente que não sabe.

**Nada aqui quebra funcionalidade.** A resposta honesta à pergunta *"existe caso em que a latência
quebra alguma funcionalidade?"* é: **não existe funcionalidade quebrada — existe uma degradada
(terminal) e existem três armadilhas de implementação** (flush do SSE linha a linha, autosave por
keystroke no editor, e timeouts de RPC calibrados para LAN). As três estão especificadas acima e
devem virar itens de checklist.

### 3.5 O que acontece se o link entre continentes cair por horas

**A regra "painel cai, sites ficam no ar" vale entre continentes.** Isto é requisito, e a lista abaixo
é o que precisa ser verdade para ele valer:

| Componente | Comportamento durante partição BR↔US | Já garantido? |
|---|---|---|
| Sites no nó `us-east1` | **continuam servindo, sem degradação** | ✅ `03` §1.6 |
| TLS dos sites | válido; renovação continua **se** §3.5.1 for feito | ⚠️ **lacuna** |
| Banco, cron, filas, deploy já configurado | continuam | ✅ |
| DNS autoritativo dos domínios | continua respondendo (**se** houver NS no lado americano — §8) | ⚠️ **lacuna** |
| Métricas e eventos de uso | acumulam no outbox local (72 h), com prioridade para faturável | ✅ `03` §1.6 |
| Alerta de que a partição existe | **precisa de caminho independente do CP** | ⚠️ **lacuna** |
| Login no painel, criar/pausar/resize, faturamento | **param** para a região `us-east1` | ✅ (aceito) |

Ou seja: a regra já vale para **tráfego**, e tem **três lacunas** que só aparecem quando existe um
segundo continente.

#### 3.5.1 Lacuna 1 (a mais grave): ACME DNS-01 dependia do PowerDNS brasileiro

`06` §8.2 e `06` §638 fecharam **DNS-01 com `lego`** como o método de emissão — decisão correta, e por
motivos que continuam valendo (funciona com ambiente pausado, funciona antes do DNS apontar para o nó,
serve wildcard). Mas DNS-01 exige **escrever um TXT `_acme-challenge` na zona autoritativa**. Se a
zona é servida por PowerDNS no Brasil e o link caiu, **o nó dos EUA não consegue renovar certificado**.
Com certificados de vida curta (`02` §11.1 registra a redução para ~45 dias e o trabalho da LE em
torno disso), a janela de tolerância encolhe.

**Correção — delegação de desafio (padrão `acme-dns`):**

```
_acme-challenge.cliente.com.   CNAME   a1b2c3d4-....acme-cd.veloz.app.
                                        └── zona DEDICADA, servida em ANYCAST por terceiro
```

- A zona `acme-cd.veloz.app` **não é servida pelo nosso PowerDNS**. É delegada a um DNS anycast
  gerenciado (Cloudflare no plano gratuito serve bem este papel — é só uma zona com TXTs efêmeros).
- Cada nó tem um **token de API com escopo apenas dessa zona**. Comprometer o nó dos EUA não dá acesso
  à zona de nenhum cliente.
- O caminho de renovação passa a ser **nó → internet → provedor anycast → Let's Encrypt**. Não toca o
  Brasil, não toca o control plane. Sobrevive à queda do CP **e** à partição transcontinental.
- Bônus que paga a complexidade sozinho: é o mesmo mecanismo que permite emitir certificado para
  domínio de cliente cujo DNS está na Cloudflare/GoDaddy/Registro.br **sem pedir credencial ao
  cliente** — ele só cria **um CNAME, uma vez, para sempre** (§12.4).

**Este é o item de maior alavancagem do documento inteiro.** Uma linha de CNAME resolve, ao mesmo
tempo: renovação sob partição, renovação sob CP fora do ar, wildcard, emissão antes do cutover de
migração, e o caso "cliente usa DNS de terceiro".

#### 3.5.2 Lacuna 2: DNS autoritativo precisa responder de dentro de cada continente

Tratada em §8. Resumo: **um PowerDNS por continente**, `ns1` no BR e `ns2` nos EUA, ambos escrevendo
na mesma zona por replicação — de modo que a queda do link **não** derruba a resolução dos domínios
de nenhuma região.

#### 3.5.3 Lacuna 3: o alerta não pode viajar pelo link que caiu

`03` §1.6 já prevê o watchdog do agente após 15 min sem CP. Falta fechar o **caminho de saída**:

- O nó `us-east1` roda `mod-alerts` com um remetente **local à região** (provedor de e-mail
  transacional acessível de lá) e um webhook direto (Telegram/ntfy) — **nunca** via o CP.
- E o inverso: o **monitoramento externo** (`07` §3.10.3 já orça "monitoramento externo") faz
  *blackbox* de fora, de **duas origens** (uma no BR, uma nos EUA). Só assim se distingue
  "o nó dos EUA caiu" de "o link Brasil→EUA caiu". Sem duas origens, o diagnóstico é chute.

**Custo dessa redundância:** o *tier* gratuito de um monitor externo com múltiplas localidades
cobre 22 ambientes com folga. Orçar **R$ 0** na fase de validação, com teto de R$ 40/mês [EST].

### 3.6 SLO declarado para a região remota

| Métrica | `br-se1` | `us-east1` |
|---|---|---|
| Disponibilidade do **site** | idem | **idêntica** — não depende do link |
| Disponibilidade das **operações de painel** | 99,5% | **99,0%** (link transcontinental entra no cálculo) |
| RTO de operações de painel durante partição | — | **= duração da partição**. Declarado. Não há mitigação e não vamos fingir que há |
| Perda de dado de faturamento em partição < 72 h | 0 | **0** (outbox prioriza faturável) |
| Perda de telemetria em partição > 72 h | — | *downsampling*, sem perda de faturável |

---

## 2. LGPD e residência de dados — a seção que decide se `us-east1` existe

> Esta é a seção que torna a região americana **legalmente possível ou impossível**. Todas as outras
> tratam de custo e latência; esta trata do único risco que pode gerar sanção da ANPD e do único que o
> cliente não perdoa. Ela vem antes de moeda, de backup e de latência de propósito.

### 2.1 O fato jurídico: hospedar brasileiro nos EUA é transferência internacional

Quando o dado pessoal de um titular brasileiro sai do território nacional e passa a ser tratado (aqui:
armazenado e processado) num servidor nos Estados Unidos, ocorre **transferência internacional de
dados** no sentido dos **arts. 33 a 36 da LGPD (Lei 13.709/2018)**. Isso é verdade mesmo que:

- o VelozPanel seja **operador** e não controlador daquele conteúdo (o controlador é o cliente que
  hospeda o site — `02` §13.1). O operador que decide *onde* o dado fica é corresponsável pela licitude
  da transferência;
- o dado seja "só um site" — se o site coleta e-mail de formulário, cadastro, pedido, comentário, ele
  contém dado pessoal de terceiros (os visitantes do cliente), e são **esses** titulares que a LGPD
  protege, não apenas o titular da conta.

**Os EUA não constam da lista de países com nível adequado de proteção reconhecido pela ANPD** (a ANPD
ainda não publicou decisão de adequação para os EUA até a data deste documento — `[VERIFICAR]` no
momento de ativar `us-east1`). Portanto a transferência **não** se apoia no art. 33, I (adequação). Ela
precisa de outra base do art. 33.

### 2.2 A base legal escolhida — e por que não é "só consentimento"

O art. 33 lista as hipóteses. Para este produto, a combinação correta é **duas camadas**:

| Camada | Base | Fundamento |
|---|---|---|
| **Instrumento de transferência** | **Cláusulas-padrão contratuais da ANPD** (art. 33, II, "d"), no modelo aprovado pela **Resolução CD/ANPD nº 19/2024** | É o mecanismo que a própria ANPD desenhou para transferência a país sem adequação. É contratual, é reutilizável, e **não depende de o titular final consentir** — o que é essencial, porque o VelozPanel não tem contato com os visitantes do site do cliente |
| **Ato do cliente na plataforma** | **Consentimento específico e destacado do cliente** (art. 33, VIII) + **execução de contrato** com o cliente (art. 33, IX) | É o que registra que **aquele cliente** escolheu os EUA de forma consciente. Não substitui as cláusulas-padrão; é a prova de que a escolha foi informada |

> **Por que não basta consentimento.** Consentimento do cliente-titular não cobre os dados dos
> **visitantes** do site dele (terceiros com quem o VelozPanel não fala). As **cláusulas-padrão** são o
> que dá licitude à transferência do conjunto todo; o consentimento do cliente é o que dá licitude à
> **decisão de colocá-lo nos EUA** e prova que ela foi informada. As duas camadas são cumulativas. Por
> isso `region_consents.legal_basis` admite `clausulas_padrao` **e** `consentimento_especifico`, e o
> registro guarda as duas (§1.4).

**Consequência de produto:** o cliente que hospeda site com dado de terceiros nos EUA vira, ele mesmo,
controlador que fez uma transferência internacional. O contrato precisa **repassar essa obrigação a
ele** e deixá-la explícita na tela — não é papel do VelozPanel assumir a responsabilidade do
controlador, e sim informá-lo com todas as letras (art. 9º, dever de transparência).

### 2.3 O que precisa estar no contrato (Termos de Uso / DPA)

Cláusulas mínimas para `us-east1` existir, todas em um **anexo de transferência** referenciado por
`regions.dpa_annex_key`:

1. **Identificação da transferência:** que dados vão para os EUA, para qual finalidade (hospedagem
   escolhida pelo cliente), e que a base é art. 33, II "d" (cláusulas-padrão) + art. 33, VIII/IX.
2. **Incorporação das cláusulas-padrão da Res. CD/ANPD 19/2024** por referência, com as obrigações do
   operador (medidas de segurança, sub-operadores, cooperação com a ANPD, devolução/eliminação ao fim).
3. **Repasse de responsabilidade de controlador ao cliente** quanto aos dados de visitantes que ele
   coletar, incluindo o dever dele de informar seus próprios titulares.
4. **Direito de reversão:** o cliente pode a qualquer tempo solicitar o retorno ao Brasil
   (`environment.region_move`, §1.6), sem multa, na fase de validação.
5. **Sub-operador nomeado:** o provedor de VPS americano é sub-operador; identificá-lo e vincular às
   mesmas cláusulas.
6. **Retenção e eliminação:** ao encerrar, dado e backups nos EUA são eliminados no prazo de retenção
   legal (§5), com prova.

### 2.4 O que precisa estar na tela — e a exigência de escolha consciente

A LGPD não exige um formulário específico, mas exige que a escolha seja **informada, específica e
destacada** (não pré-marcada, não enterrada no ToS genérico). Traduzido em regras de UI, todas
verificáveis:

- A opção `us-east1` **nunca vem pré-selecionada**. Default é sempre `br-se1` (D10).
- Escolher `us-east1` **abre um passo dedicado** com o aviso do §2.6, um checkbox **não-marcado** de
  aceite, e o botão de continuar **desabilitado** até o checkbox e um scroll até o fim do texto.
- O aviso mostra a **jurisdição** (EUA), a **consequência** (transferência internacional), o **direito**
  (reverter sem custo) e o **impacto técnico** (latência ao público BR, §6).
- Ao confirmar, grava-se **uma linha em `region_consents`** (§1.4) com: `user_id` de quem clicou,
  `region`, `notice_key`+`notice_version`, `notice_text_sha256` (hash do texto **exato** exibido, para
  provar depois o que a pessoa leu), `legal_basis`, `accepted_at`, `actor_ip`, `user_agent`.
- Sem essa linha, `environments_consent_required` (§1.4) **impede** a criação do ambiente. A regra é do
  banco, não da UI — não há caminho de código que crie ambiente em `us-*` sem consentimento gravado.

### 2.5 Os dois casos simétricos

**Cliente americano hospedado no Brasil.** Simétrico, mas mais simples do ponto de vista brasileiro:
não há transferência *do Brasil para fora*; o dado entra e fica no Brasil. Do ponto de vista dos EUA
não há lei federal geral equivalente à LGPD; leis estaduais (CCPA/CPRA na Califórnia) tratam de direitos
do consumidor, não de residência obrigatória. **Decisão:** cliente `country_code = 'US'` pode escolher
`br-se1` livremente; a tela mostra o aviso simétrico ("seus dados ficarão no Brasil, sob LGPD") mas
**sem bloqueio duro** — é informação, não uma transferência de saída que o Brasil regula.

**Cliente cujo público é europeu (GDPR).** É o caso mais delicado e o mais fácil de errar. Se o site do
cliente atende titulares na UE, o **GDPR** se aplica ao cliente (controlador), independentemente de onde
o servidor está. Hospedar no Brasil **ou** nos EUA são, ambos, transferências para fora do EEA sob o
GDPR (arts. 44–49), e nenhum dos dois é país com decisão de adequação da Comissão Europeia
(`[VERIFICAR]`: o Brasil não tem adequação; os EUA têm o *Data Privacy Framework* apenas para empresas
certificadas). **Decisão de escopo:** o VelozPanel **não** oferece região na UE e **não** assume o papel
de garantir conformidade GDPR do cliente. A tela informa: *"Se o seu público está na União Europeia, o
GDPR se aplica a você como controlador e nenhuma região atual (Brasil ou EUA) tem decisão de adequação
da UE — consulte seu jurídico."* Isso é dever de transparência, não consultoria. `mod-region-eu` fica
como possibilidade futura, sem compromisso, e **fora** deste ciclo.

### 2.6 O texto pronto do aviso de escolha de região (`transfer.us.v1`)

> Texto exibido no passo dedicado quando o cliente seleciona **Estados Unidos · Leste (`us-east1`)**.
> É este texto — palavra por palavra — cujo SHA-256 é gravado em `region_consents.notice_text_sha256`.
> Qualquer alteração incrementa `notice_version` e gera um `notice_key` novo.

```
Você está escolhendo hospedar seus dados nos ESTADOS UNIDOS.

O que isso significa
• Seus arquivos, bancos de dados e backups ficarão armazenados em servidores
  localizados nos Estados Unidos, sob a jurisdição legal daquele país.
• Isso é uma TRANSFERÊNCIA INTERNACIONAL DE DADOS nos termos da Lei Geral de
  Proteção de Dados (LGPD, arts. 33 a 36). Ela é feita com base nas cláusulas-
  padrão contratuais aprovadas pela ANPD (Resolução CD/ANPD nº 19/2024), que
  fazem parte do seu contrato.
• Se o seu site coleta dados de outras pessoas (cadastros, formulários, pedidos),
  VOCÊ é o responsável por esses dados perante a LGPD e deve informar essas
  pessoas de que a hospedagem é nos Estados Unidos.

O que você deve considerar
• Latência: visitantes no Brasil terão o site cerca de 120 a 180 ms mais lento
  do que na região Brasil. Se o seu público é brasileiro, a região Brasil é a
  recomendada. A região Estados Unidos é indicada para quem atende público na
  América do Norte.
• Você pode voltar para a região Brasil quando quiser, sem custo, solicitando a
  mudança pelo painel (há uma janela de indisponibilidade planejada).

Seus direitos
• Esta escolha é sua e pode ser revertida. Você não é obrigado a hospedar nos
  Estados Unidos para usar o VelozPanel — a região Brasil é o padrão.

Ao marcar a caixa abaixo, você declara que leu e compreendeu este aviso e
consente, de forma específica e informada, com a hospedagem dos seus dados nos
Estados Unidos.

[ ] Li e concordo em hospedar meus dados nos Estados Unidos.
```

### 2.7 Campos que o modelo de dados guarda (consolidação)

Já criados em §1.4; aqui a leitura por **finalidade de prova**, que é o que uma auditoria da ANPD pede:

| Pergunta da auditoria | Coluna que responde |
|---|---|
| Quem consentiu? | `region_consents.user_id`, `actor_ip`, `user_agent` |
| Quando? | `region_consents.accepted_at` |
| Com qual texto exatamente? | `notice_key` + `notice_version` + `notice_text_sha256` (o hash prova que o texto não foi alterado depois) |
| Sob qual base legal? | `region_consents.legal_basis` (`clausulas_padrao` + `consentimento_especifico`) |
| Para qual ambiente / região? | `environment_id` (NULL se na criação) + `region` |
| O ambiente respeita o consentimento? | `environments.region_consent_id` FK + trigger `environments_consent_required` (§1.4) |
| Foi revogado? | `region_consents.revoked_at` (revogação dispara `region_move` de volta ao BR) |
| Onde os backups fisicamente estão? | `backups.stored_jurisdiction` (§1.4, desnormalizado p/ relatório) |

**Relatório LGPD de uma linha** (o que se entrega numa solicitação do titular ou da ANPD):

```sql
SELECT e.id AS ambiente, e.region, r.jurisdiction,
       rc.accepted_at, rc.legal_basis, rc.notice_key||'.v'||rc.notice_version AS termo,
       (SELECT array_agg(DISTINCT b.stored_jurisdiction)
          FROM core.backups b WHERE b.environment_id = e.id) AS backups_em
  FROM core.environments e
  JOIN core.regions r ON r.slug = e.region
  LEFT JOIN core.region_consents rc ON rc.id = e.region_consent_id
 WHERE e.tenant_id = $1;
```

---

## 4. Moeda e preço por região

### 4.1 A decisão de moeda: sempre BRL (D7)

O cliente **paga sempre em BRL**, inclusive na região `us-east1`. `tenants.currency` tem `CHECK
(currency = 'BRL')` (§1.4). Motivos, em ordem:

1. **O cliente é brasileiro e o PSP é brasileiro.** Pix e boleto são BRL por natureza. Cobrar USD exigiria
   gateway internacional, cartão internacional, IOF, e conciliação em duas moedas — para um público que
   não pediu isso.
2. **A moeda de *custo* (`regions.cost_currency`) já é separada da moeda de *cobrança*** (§1.3). O sistema
   já sabe que paga a infra de `us-east1` em USD e cobra o cliente em BRL. Não há terceira moeda.
3. **Duas moedas de cobrança dobrariam o razão** (`07`): duas contas a receber, dois fechamentos, dois
   pontos de arredondamento. Para 12 clientes, é complexidade sem retorno.

### 4.2 O risco cambial e como ele é administrado (não indexado)

O risco é real e assimétrico: **custo em USD, receita em BRL**. Se o BRL desvaloriza, o custo do nó
americano sobe em reais e a receita não acompanha. Duas formas erradas de tratar e a escolhida:

| Abordagem | Problema | Veredito |
|---|---|---|
| **Indexar o preço ao dólar do dia** (preço "flutua") | Cliente brasileiro odeia preço que muda todo mês; fatura imprevisível; quebra o `grandfathering` de preço do `07` P15 | ❌ |
| **Absorver 100% do câmbio** (preço fixo eterno em BRL) | Uma alta forte do dólar transforma um nó já marginal em prejuízo direto, sem gatilho de correção | ❌ |
| **Câmbio administrado com gatilho** (preço fixo em BRL, revisão trimestral, correção só se o desvio passar de ±8%) | Previsível para o cliente, protegido para o operador, auditável | ✅ **D7** |

**Mecânica.** A tabela `fx_rates` (§1.4) guarda a cotação USD→BRL vigente (fonte PTAX ou manual). O preço
de `us-east1` é **fixado em BRL** por `price_tables` (region = `us-east1`), calculado a partir do custo
USD × `fx_rate` × margem no momento da publicação. A cada trimestre:

```
desvio = (ptax_hoje − fx_rate_usado_na_tabela) / fx_rate_usado_na_tabela
se |desvio| > 8%  → publica-se nova price_table para us-east1 (nova versão, effective_from),
                     com aviso de 30 dias e grandfathering dos ativos até o ciclo seguinte
senão             → mantém
```

Isso reaproveita **inteiro** o versionamento de preço do `07` P15: nova cotação = nova `price_table` da
região, com histórico preservado e `environment_pricing` fixando a tarifa de cada ativo (grandfathering).
Nenhuma tabela nova além de `fx_rates`, já criada.

### 4.3 Como a tabela de preço versionada por região acomoda isso

`price_tables` já tem `region` como dimensão desde o dia 1 (`07` P15). Consequência prática:

- `br-se1` e `us-east1` são **duas linhas** de `price_tables`, cada uma com seu conjunto de tarifas
  unitárias (`price_table_meters`) e seus `plan_presets` (§1.5, regra 3 — chave `(slug, region)`).
- O preço de `us-east1` **pode** ser menor que o de `br-se1` (custo por GB menor, §4.4) — mas essa é uma
  **decisão comercial por região**, não um efeito automático do câmbio.
- `usage_rollups.region` e `region_costs` (§1.4) fecham o outro lado: dá para responder "quanto a região
  `us-east1` faturou e custou este mês, em BRL, com qual câmbio" sem cálculo manual.

**Recomendação de política única:** na fase de validação, o preço de `us-east1` é **igual ao de
`br-se1` em BRL** (mesma tabela de números), não mais barato. Racional: (a) o objetivo do nó americano
**não** é ser o barato — é atender quem precisa de jurisdição/latência americana (§6); (b) manter o mesmo
preço embolsa a economia de custo como margem (D8), que é exatamente o que a frota deficitária precisa;
(c) preço menor nos EUA atrairia cliente BR pela etiqueta e o serviria mal (§6). **Um preço, duas
regiões, mesma etiqueta em BRL.**

### 4.4 A economia refeita com um nó grande nos EUA — e por que ela não salva a frota (D8)

**Ponto de partida (Crítica 2 §1.5–1.6):** a frota **BR** de produção tem **14 ambientes, não 22**, e
**não tem ponto de equilíbrio** — o melhor caso possível é prejuízo de caixa de R$ 131/mês (R$ 371 com o
tempo do dono). O ADENDO 4 pergunta se um nó americano, mais barato por GB, muda isso. A resposta honesta
tem duas partes: **muda o custo por GB, não muda o problema.**

**A hipótese generosa.** Um nó grande nos EUA — 32 GB de RAM, vCPU dedicada — por volta de **US$ 48/mês**
`[EST]`. A R$ 5,40/USD, **≈ R$ 260/mês**. Com a mesma reserva operacional do `06` (10,5 GB vendáveis por
16 GB físicos ⇒ ~21 GB vendáveis em 32 GB) e densidade de 7 por 16 GB, o nó comporta **~14 ambientes
sozinho**.

| Métrica | Nó BR (16 GB) | **Nó US (32 GB)** |
|---|---:|---:|
| Custo mensal | ~R$ 250 | **~R$ 260** `[EST]` |
| RAM física | 16 GB | 32 GB |
| Vendável (após reserva `06`) | ~10,5 GB | ~21 GB |
| Ambientes (7 / 16 GB) | 7 | **~14** |
| **Custo por ambiente vendável** | **R$ 35,7** | **R$ 18,6** `[EST]` |
| Custo por GB vendável | R$ 23,8 | **R$ 12,4** |

O nó americano é **~48% mais barato por ambiente**. Se a conta fosse só de capacidade, ele resolveria.

**Por que não resolve — a restrição é demanda, não capacidade.** A frota BR já não tem clientes
suficientes para os 14 slots que tem (Crítica 2: o problema é o custo fixo por ambiente com **poucos
clientes**, não falta de máquina). Adicionar 14 slots americanos só ajuda se existirem 14 clientes que
**legitimamente querem os EUA** (§6: público na América do Norte, ou exigência de jurisdição própria).
Esse segmento, num produto de revenda brasileiro na fase de validação, é **pequeno** — otimisticamente
2 a 4 clientes `[EST]`. Encher o nó americano com clientes BR seria servi-los mal (120–180 ms, §6) e
criar carga de LGPD (§2) para economizar custo que a etiqueta única (§4.3) já embolsa sem precisar do nó.

**A economia repassa ~30%, embolsa ~70% (D8) — e o resultado continua negativo:**

| Cenário | Ambientes vendidos | Receita bruta/mês | Custo infra/mês | Resultado de caixa |
|---|---:|---:|---:|---:|
| 2 nós BR (Crítica 2, melhor caso) | 14 BR | R$ 918 | R$ 865 (fixo enxuto) | **− R$ 131** |
| **2 nós BR + 1 nó US, US semi-vazio (real)** | 14 BR + **3 US** | R$ 918 + **R$ 197** | R$ 865 + **R$ 260** | **− R$ 10** `[EST]` |
| 2 nós BR + 1 nó US, US cheio (hipótese que não existe) | 14 BR + 14 US | R$ 918 + R$ 918 | R$ 865 + R$ 260 | + R$ 711 |

> **Leitura.** O nó americano **cheio** salvaria a conta — mas o cenário "cheio" pressupõe 14 clientes
> que querem os EUA, que **não existem** nesta fase. No cenário **real** (o nó atende os 2–4 clientes que
> de fato precisam dos EUA e fica majoritariamente ocioso), ele **quase empata sozinho** (−R$ 10), o que
> é notável para uma capacidade que existe por razão de produto, não de margem — mas **não puxa a frota
> BR para o azul**. O prejuízo estrutural de R$ 131/mês da frota BR continua lá, intocado, porque a
> alavanca dele é **número de clientes**, não custo por GB (Crítica 2 §1.6, as três alavancas gratuitas:
> catálogo Start+Light, cortar helpdesk pago, corrigir contabilidade — nenhuma delas é "nó mais barato").

**Conclusão de §4:** o nó dos EUA é uma decisão de **produto** (atender um segmento), não uma decisão de
**resgate financeiro**. Ele deve ser provisionado **quando houver demanda paga que o justifique** — o
mesmo espírito do gatilho de capacidade do `07` §3.10.9 reescrito pela Crítica 2 (12 ativos por 14 dias).
Não se provisiona um nó americano para "baixar o custo médio"; provisiona-se quando **≥ 3 clientes com
consentimento `us-east1` gravado** estiverem em fila `[EST, gatilho §Decisões fechadas]`.

---

## 5. Backup por região

### 5.1 O princípio de residência aplicado ao backup

O backup de um dado é **o mesmo dado**. Se o ambiente está em `us-east1` porque o cliente consentiu com
os EUA (§2), mandar o backup para o Brasil seria uma transferência **de volta** não consentida, e mandar
o backup de um ambiente `br-se1` para os EUA seria a transferência internacional que o cliente BR **não**
autorizou. **Regra dura:** o backup segue a jurisdição do ambiente. `backups.stored_jurisdiction` (§1.4)
existe para provar isso em auditoria.

### 5.2 Destino por região — herda a estratégia 3-2-1-1-0 do `09`, com fronteira

O `09` §5.1 fixou 3-2-1-1-0: cópia 1 local no nó, cópia 2 em Backblaze B2 (Object Lock), cópia 3 em
Magalu Cloud (BR, compliance 90 d). Multi-região **respeita a fronteira**:

| Cópia | Ambiente `br-se1` | Ambiente `us-east1` | Jurisdição |
|---|---|---|---|
| **1 — local** | `/var/backups/veloz` no nó BR | `/var/backups/veloz` no nó US | segue o nó |
| **2 — off-site quente** | **B2 `sa-east` / `us-west-004`**, bucket `veloz-prod-br` | **B2 `us-west-004`**, bucket `veloz-prod-us` | **fica no mesmo continente do nó** |
| **3 — off-site frio (independência de provedor)** | **Magalu Cold (BR)** `veloz-br-cold` | **NÃO existe por padrão** — sem cópia 3 no BR (seria transferência de volta não consentida) | `br-*` no BR; `us-*` só EUA |

Ou seja, **D9**: o backup do nó americano **fica nos EUA** (B2 `us-west-004`), e o ambiente `us-*` **não
ganha** a cópia 3 no Brasil que o ambiente `br-*` ganha. `backup_policies.allow_cross_border` (§1.4)
existe justamente para o caso raro e explícito em que o cliente `us-east1` **pede** uma cópia adicional no
Brasil — aí grava-se novo consentimento (é transferência) e liga-se o flag. Default: `false`.

### 5.3 Egress transcontinental — o custo que o desenho evita

O erro caro seria fazer o nó dos EUA subir backup para um bucket no Brasil (ou vice-versa): egress
transcontinental cobrado, atravessando o oceano toda hora. O desenho de §5.2 **elimina** esse custo por
construção — cada nó fala com o bucket B2 do **seu** continente. Números:

| Fluxo | Volume/mês `[EST]` | Custo egress |
|---|---:|---|
| Nó US → B2 `us-west-004` (mesmo país, e B2 dá egress grátis até 3× o armazenado — `09` D15) | ~5–15 GB | **≈ R$ 0** |
| Nó US → bucket BR (o que **não** fazemos) | ~5–15 GB | egress inter-região + travessia; ~US$ 0,01–0,09/GB conforme provedor |
| Restore B2 `us-west-004` → nó US | sob demanda | **≈ R$ 0** (egress grátis B2 dentro da franquia) |

### 5.4 Tempo de restore de um nó dos EUA

O que muda em relação ao `09` §4.5 (RTO 30 min do CP) **não é a distância ao bucket** — é local, §5.2 —
mas a distância ao **operador** e ao **control plane** brasileiros. O restore roda **no nó**, puxando do
bucket **local**, multi-fluxo (restic usa N conexões). O que atravessa o oceano é só o **comando** e o
**relatório**, não os bytes.

| Métrica | `br-se1` | `us-east1` | Por quê |
|---|---:|---:|---|
| RTO ambiente (5 GB) | ~10–20 min (`09`) | **~12–22 min** `[EST]` | +2 min de coordenação CP↔nó, bytes são locais |
| RTO nó inteiro (VPS nova) | ≤ 30 min | **≤ 35 min** `[EST]` | idem |
| Egress do restore | R$ 0 | **R$ 0** | bucket no mesmo continente |
| Teste de restore semanal (`09` D19) | nó BR diferente | **em nó US** ou VPS efêmera US | a prova tem de ser na jurisdição, senão o dado cruzaria fronteira só para testar |

**Recomendação com número:** ativar `us-east1` **exige** um segundo nó US (ou uma VPS efêmera US para o
teste de restore semanal), porque a prova de restore do `09` D19 não pode restaurar dado americano num nó
brasileiro. Custo do alvo de teste: **≈ R$ 0** se for VPS *on-demand* ligada 1 h/semana `[EST ~US$ 0,50/mês]`.

---

## 6. Latência ao usuário final

### 6.1 O fato físico e o que o CDN não resolve

Um nó nos EUA serve o público **brasileiro** a **~120–180 ms de RTT de origin** (pesquisa,
`_pesquisa-dns-acme-anycast.md`). E o ponto que o cliente sempre entende errado: **CDN não conserta app
dinâmica.** Para PHP/MySQL, WordPress logado, checkout, painel admin — cada request vai à origin. O CDN
melhora TLS/TCP terminando num PoP brasileiro e serve estático cacheável, mas o HTML dinâmico ainda
percorre o oceano. **Para público BR, origin em São Paulo é a decisão de maior impacto de performance que
existe** — nenhuma outra otimização chega perto.

### 6.2 Como o painel orienta a escolha (D10 — tela de decisão, não dropdown)

- Default `br-se1`, sempre. `us-east1` só aparece com o texto do §2.6.
- A tela mostra a **latência publicada** (`regions.rtt_ms_to_br` / `rtt_ms_to_us`) como número, não como
  bandeira decorativa: "Brasil · Sudeste — ~12 ms para visitantes no Brasil" vs "Estados Unidos · Leste —
  ~130 ms para visitantes no Brasil".
- **Bloqueio duro:** cliente `country_code = 'BR'` que seleciona `us-east1` recebe **dupla confirmação**
  ("Seu público é no Brasil? A região Brasil é ~130 ms mais rápida para eles.") além do consentimento LGPD.
- A pergunta que dá o default certo é **"onde está o seu público?"**, não "onde está você" — e é isso que
  a tela pergunta.

### 6.3 O cliente que escolheu errado

**Detecção automática.** Depois que o ambiente está no ar, o `mod-metrics` (`11`) já coleta origem
geográfica aproximada dos acessos (por país, sem PII de IP — `11` respeita isso). Se um ambiente `us-east1`
tem **>80% de visitantes no Brasil por 14 dias**, o painel mostra um aviso proativo:
*"Detectamos que a maior parte dos seus visitantes está no Brasil. A região Brasil deixaria seu site
~130 ms mais rápido para eles. Quer mudar? (sem custo)"* → botão que abre `environment.region_move` (§1.6).

**Correção.** É exatamente o `region_move` — recriação com novo consentimento, 20–60 min de janela, 0 s
percebido pelo visitante. O cliente que escolheu errado não fica preso: a saída existe, é gratuita na fase
de validação e não perde dado.

### 6.4 Para quem o nó dos EUA é a escolha CERTA

O nó americano não é o "pior nó" — é o **certo** para segmentos específicos, que a tela deve nomear:

| Segmento | Por que `us-east1` é melhor |
|---|---|
| Público na **América do Norte** (diáspora BR nos EUA, dropshipping/e-commerce vendendo p/ EUA, SaaS mirando EUA) | RTT ~15–40 ms ao público real; o BR seria o lento aqui |
| Cliente que **integra com serviços US** de baixa latência (APIs, gateways, filas hospedadas nos EUA) | evita o oceano em cada chamada de backend |
| Cliente que **precisa de jurisdição US** por exigência própria (contrato B2B americano, processador de pagamento US) | requisito de conformidade **dele**, não performance |
| Cliente cujo **público é global e concentrado no hemisfério norte** | US-East é um meio-termo melhor que São Paulo para EUA+Europa |

Para esses, `regions.rtt_ms_to_us` (~15–40 ms) é o número que a tela destaca. A régua é sempre **onde está
o público**, e o painel a aplica dos dois lados.

---

## 7. Fusos horários

Um só princípio evita a maior parte dos bugs de fuso: **armazenar tudo em UTC (`timestamptz`), decidir a
exibição na borda, e nomear explicitamente o fuso de cada operação agendada.** Aplicado aos cinco pontos
onde fuso importa:

| Onde | Regra | Fonte da verdade |
|---|---|---|
| **Janela de manutenção** | `regions.maintenance_window` é **hora LOCAL da região** (`03:00–05:00` em `America/New_York` para `us-east1`). Manutenção nunca acontece no horário de pico local do público daquela região | `regions.maintenance_window` + `regions.display_timezone` |
| **Agendamento de backup** | disparo interno em **UTC** (cron do sistema), mas a **exibição** ("último backup às 03:12") é convertida para o fuso do recurso. O horário do dump é escolhido para cair na madrugada **local da região**, não na do Brasil | job em UTC, label na tz da região |
| **Cron do cliente** | o cliente define em **fuso escolhido por ele** (`tenants`/preferência de usuário; default = `regions.display_timezone` do ambiente). O container roda com `TZ` = esse fuso, para que `0 3 * * *` signifique "3h da manhã do horário que o cliente vê". Guardar a expressão + o fuso, nunca a expressão só | container `TZ` + expressão cron |
| **Exibição de horário no painel** | sempre no fuso do **usuário logado** (preferência), com *fallback* para o fuso da região do recurso. Nunca UTC cru na tela, nunca "horário do servidor" | preferência do usuário |
| **Drift de relógio** | medido por **NTP no nó** (`chrony`), alerta `drift_relogio` se `abs(offset) > 2 s` (`11` §7). Isto é **independente** da diferença de carimbos de entrega (§3.3): drift = relógio errado; latência de entrega = link lento. As duas não se confundem mais depois da correção do §3.3 | `chrony` no nó, não diferença CP↔nó |

**Regra de implementação (armadilha real):** cron de container que roda em UTC quando o cliente pensa em
horário de Brasília gera o clássico "meu backup rodou às 3h da tarde". O container **tem** que carregar o
`TZ` do cliente, e a expressão cron **tem** que ser guardada junto com o fuso em que foi escrita. Guardar
só `0 3 * * *` sem o fuso é um bug latente que só aparece quando o primeiro cliente muda de fuso ou quando
o primeiro ambiente vai para `us-east1`.

---

## 8. DNS do painel em duas regiões

### 8.1 A decisão: PowerDNS próprio (2 nós) + Hurricane Electric anycast grátis (D11)

**Sem anycast próprio.** O caminho de operador pequeno correto (pesquisa) é:

```
ns1.velozpanel.com.br   → PowerDNS 5.1.3 no nó BR   (master SQL, a verdade)
ns2.velozpanel.com.br   → PowerDNS 5.1.3 no nó US   (slave, replicação native)
ns2.he.net .. ns5.he.net → Hurricane Electric, ANYCAST GLOBAL, GRÁTIS (slave via AXFR)
```

- **PowerDNS master no BR** com backend SQL (PostgreSQL/MySQL) é a fonte da verdade; o segundo PowerDNS no
  US replica por **native replication** (a mais simples — o `09`/`03` já tem Postgres). Isso satisfaz a
  Lacuna 2 do §3.5.2: **um autoritativo por continente**, e a queda do link BR↔US **não** derruba a
  resolução de nenhum lado.
- **Hurricane Electric (dns.he.net) como secundário anycast, custo zero.** HE dá `ns2–ns5` anycast global,
  puxa a zona do nosso PowerDNS por **AXFR** (com **TSIG**), suporta as zonas que quisermos. É o que
  entrega ~90% do valor de um anycast próprio a **R$ 0**.

### 8.2 Por que não anycast próprio — a conta (pesquisa)

| Opção | Custo inicial | Custo mensal | Veredito p/ frota de 14–20 ambientes |
|---|---:|---:|---|
| **ASN próprio + /24 + BGP** (LACNIC US$500 único; /24 alugado ~US$90–128/mês; Vultr aceita BGP) | ~US$ 500 | **~US$ 90–128** | ❌ Só compensa acima de **milhares de zonas**. É o item mais caro que o ADENDO 3 §I mandaria não comprar |
| **Cloudflare Secondary DNS** | — | — | ❌ Só no plano **Enterprise** |
| **PowerDNS próprio (2 nós, já existem) + HE.net grátis** | R$ 0 | **R$ 0** | ✅ **D11.** Anycast de verdade (HE) sem ASN, sem /24, sem BGP |

A economia é de **~US$ 90–128/mês + US$ 500 de entrada** contra **R$ 0** — para um resultado
(resolução anycast global, redundância transcontinental) que, na escala da frota, é indistinguível. Se o
volume um dia justificar, Cloudflare free como NS terciário é o próximo degrau (D11), ainda antes de
qualquer ASN.

### 8.3 O que isso exige operacionalmente

- **TSIG** para o AXFR do HE.net (chave dedicada, só de transferência, escopo de leitura da zona).
- **`ALSO-NOTIFY`** do PowerDNS master apontando para o IP de transferência do HE, para propagação rápida.
- Os NS anunciados na delegação de cada zona de cliente = `ns1`/`ns2` **nossos** + os `ns*.he.net`. A
  coluna `regions.nameservers` (§1.4) guarda o conjunto por região.
- **DNSSEC** (§9.4): se ligado, o PowerDNS master assina; HE serve as zonas já assinadas via AXFR sem
  precisar das chaves — o que mantém a chave privada **só** no nosso master.

---

# Parte 2 — Domínios

## 9. `mod-dns` — o gerenciador de DNS

> `mod-dns` fecha seu escopo **aqui** (D12). É `dns.provider` (contrato §13) no modo `authoritative`,
> implementado sobre **PowerDNS 5.1.3**.

### 9.1 Tipos de registro suportados (12)

`A, AAAA, CNAME, MX, TXT, NS, CAA, SRV, PTR, ALIAS, SOA (gerenciado), DNSKEY/DS (via DNSSEC opt-in)`.
`ALIAS` (CNAME-flattening do PowerDNS) resolve o caso "apex apontando para um CNAME" que o cliente sempre
tenta e o DNS puro proíbe. `CAA` é escrito automaticamente para `letsencrypt.org` quando o ambiente usa
nosso ACME, evitando que um CAA do cliente bloqueie a própria emissão.

### 9.2 A API: PATCH em rrsets (PowerDNS)

O PowerDNS Authoritative expõe HTTP API com `X-API-Key`, base `/api/v1`, e **manipula registros por PATCH
em rrsets** (não registro a registro). `mod-dns` traduz o modelo declarativo do contrato (`applyRecords`,
estado desejado) para o PATCH de rrset:

```
PATCH /api/v1/servers/localhost/zones/cliente.com.
{
  "rrsets": [{
    "name": "www.cliente.com.", "type": "A", "ttl": 300, "changetype": "REPLACE",
    "records": [{ "content": "203.0.113.10", "disabled": false }]
  }]
}
```

- **`changetype: REPLACE`** para criar/alterar um rrset inteiro; **`DELETE`** para remover. É idempotente
  por natureza — o cliente do contrato manda o estado desejado, o `mod-dns` calcula o diff e emite os
  PATCH mínimos.
- A **verdade** é o backend SQL do master (§8); a API só escreve nele. Replicação native leva ao slave
  US e o AXFR leva ao HE.

### 9.3 DNS-01 via acme-dns (delegação de desafio)

Reafirma e detalha o §3.5.1. `mod-dns` **não** escreve o TXT `_acme-challenge` na zona do cliente para
emissão — usa **delegação `acme-dns`**:

```
_acme-challenge.cliente.com.  CNAME  <uuid>.acme-cd.veloz.app.
```

- A zona `acme-cd.veloz.app` é servida por anycast de terceiro (Cloudflare free ou HE), **fora** do nosso
  PowerDNS. Cada nó tem um token com escopo **só** dessa zona.
- Isso serve, com o mesmo mecanismo: renovação sob partição BR↔US (§3.5.1), wildcard (§11), emissão antes
  do cutover de `region_move` (§1.6), e o caso "cliente usa DNS de terceiro" (§12.4) — em que ele cria
  **um CNAME, uma vez**, e nunca mais nos dá credencial.
- Cliente ACME: **lego com ARI** (renovação isenta de rate limit — pesquisa), perfil **`tlsserver` (45d)**.

### 9.4 DNSSEC — desligado por padrão, opt-in por domínio (D12)

DNSSEC assinado pelo PowerDNS master (`pdnsutil secure-zone`), **`enabled = false` por padrão**. Motivo:
DNSSEC mal-operado (rollover de chave errado, DS desatualizado no registro) **derruba o domínio inteiro** —
é a forma mais fácil de tirar o site de um cliente do ar sem ninguém ter mexido no site. Opt-in por domínio,
com aviso de que o cliente precisa publicar o registro **DS** no seu registrar. HE serve a zona já assinada
via AXFR; a chave privada **nunca** sai do master (§8.3).

### 9.5 Importação de zona e templates (D12)

- **Importação:** AXFR ou upload de zonefile BIND ao migrar cliente que já tinha DNS em outro provedor.
  `mod-dns` faz *dry-run* mostrando o diff antes de assumir a autoridade.
- **Templates:** presets de rrset ("Google Workspace" = MX+SPF+DKIM+DMARC; "apontar para este ambiente" =
  A/AAAA do nó + `www`), para o cliente não montar DNS na mão.

---

## 10. Registro de domínio — fora do produto, com gatilho de reabertura (D13)

### 10.1 A decisão

**Registro de domínio NÃO entra no produto.** Nem no MVP, nem na v1. Vira `mod-registrar` **futuro e
condicionado a um gatilho numérico** (§10.6). O painel **conduz** o cliente sem domínio por outros dois
caminhos que já resolvem 100% dos casos sem virar registrador: subdomínio grátis (§11) e apontamento
manual de domínio que o cliente registrou em outro lugar (§12).

### 10.2 Por que não — margem fina

Revenda de domínio é um dos piores negócios de margem que existem para operador pequeno:

| Item | Realidade `[EST/VERIFICAR]` |
|---|---|
| Custo de wholesale de um `.com` (revenda OpenSRS/Enom/Namecheap reseller) | ~US$ 8,5–10,5/ano |
| Preço de varejo praticado no mercado BR | ~R$ 40–60/ano |
| Margem bruta por domínio/ano | ~R$ 15–35 — **antes** de suporte, chargeback, IOF, câmbio |
| Renovação (onde estaria o lucro recorrente) | preços de atacado sobem, e o churn de domínio é alto |

**Uma frota que não tem ponto de equilíbrio (Crítica 2) não se salva vendendo domínio a R$ 20 de margem
por ano.** O retorno não paga o suporte que ele gera.

### 10.3 Por que não — suporte alto

Domínio é a origem nº 1 de ticket em qualquer host: transferência travada, EPP code, WHOIS/RDAP, expiração,
redemption period, contestação de titularidade, e-mail de verificação da ICANN não recebido. Cada um desses
é um chamado longo e emocional (o cliente acha que "perdeu o site"). Para um operador de **um dono**
(ADENDO 3), assumir a fila de suporte de registrar é assumir o item de maior custo humano do setor.

### 10.4 Por que não — `.com.br` não tem API EPP para não-registrador

O **Registro.br não expõe API pública para não-registradores** (exige credenciamento como registradora,
`02` §325 / ADENDO 4 §K). Ou seja: mesmo que se venda gTLD por revenda, o **`.com.br` — o TLD que o público
brasileiro mais quer** — ficaria **de fora ou manual**. Vender "registro de domínio" sem `.com.br` é vender
metade do que o cliente pede, e a metade errada.

### 10.5 Por que não — custo de virar registrador de verdade

Virar registradora `.com.br` (para ter o EPP) exige credenciamento no Registro.br, caução/garantias,
compromissos de SLA e volume, e infraestrutura EPP própria. É um **negócio diferente**, não um módulo. Está
categoricamente fora da escala do ADENDO 3.

### 10.6 O gatilho numérico de reabertura

`mod-registrar` (revenda de **gTLD** via OpenSRS/Enom, `.com.br` continuando manual/instrucional) volta à
mesa **somente** quando **todas** forem verdade `[EST]`:

```
(a) ≥ 40 clientes pagantes ativos                    (há base para diluir o suporte)
E   (b) ≥ 25% deles pediram "registrar domínio aqui"  (demanda comprovada, não suposta)
E   (c) a frota fechou ≥ 2 trimestres no azul de caixa (há gente para atender o ticket)
E   (d) existe atendimento além do dono               (o suporte de domínio não cabe em 1 pessoa)
```

Enquanto (a)–(d) não coexistirem, o painel **encaminha** o registro para fora (link para registrar
confiável) e foca no que agrega sem virar registrador: gerenciar o DNS (§9) e apontar o domínio (§12).

### 10.7 Comparação das APIs de revenda (para quando §10.6 disparar)

| Revenda | gTLD | `.com.br` | Nota `[VERIFICAR preços na ativação]` |
|---|---|---|---|
| **OpenSRS (Tucows)** | ✅ amplo | ❌ | API madura, boa para reseller; sem `.com.br` |
| **Enom** | ✅ | ❌ | similar; histórico de UX de API datada |
| **Namecheap Reseller** | ✅ | ❌ | preço agressivo, API ok |
| **Porkbun** | ✅ | ❌ | preços baixos, API moderna, sem programa de reseller robusto |
| **Registro.br (direto)** | ❌ | ✅ (só como **registradora credenciada**) | única via para `.com.br`, e é o negócio-diferente do §10.5 |

**Recomendação para o dia do gatilho:** OpenSRS para gTLD + `.com.br` permanecendo **instrucional**
(o painel guia o cliente a registrar no Registro.br e depois apontar por §12). Nunca virar registradora
`.com.br` sem um caso de negócio próprio.

---

## 11. Cliente sem domínio — subdomínio grátis `*.veloz.app` (D14)

### 11.1 O caminho de entrada de todo cliente sem domínio

Todo ambiente nasce com um **subdomínio grátis** `cliente.veloz.app`, funcional em segundos, com HTTPS
válido. É o que permite o cliente ver o site no ar **antes** de ter (ou de apontar) domínio próprio — e é
o caminho de entrada de 100% dos clientes sem domínio.

### 11.2 Wildcard DNS + wildcard TLS — e o limite do Let's Encrypt

A implementação ingênua — **um certificado por subdomínio** — estoura o rate limit do Let's Encrypt:
**50 certificados / domínio registrado / 7 dias** (pesquisa). Com dezenas de ambientes, `veloz.app` bateria
o teto. Duas saídas, uma errada e uma certa:

| Saída | Avaliação |
|---|---|
| **Colocar `veloz.app` na Public Suffix List (PSL)** para cada subdomínio contar como domínio próprio | ❌ **Proibido.** As guidelines do PSL **vedam** usar a lista para furar rate limit (pesquisa). Além de demorado e irreversível |
| **Um único certificado wildcard `*.veloz.app`** (via DNS-01) **+ override de rate limit para `veloz.app`** pedido à Let's Encrypt | ✅ **D14.** Um cert cobre todos os subdomínios; o override cobre o crescimento |

**Portanto:** **um** certificado wildcard `*.veloz.app` (emitido por DNS-01 com acme-dns, §9.3), renovado
por ARI (isento de limite), cobrindo **todos** os subdomínios de clientes. E, em paralelo, **pedir à Let's
Encrypt o override de rate limit para `veloz.app`** (mecanismo oficial, pesquisa) para folga de emissões
pontuais. **Nunca PSL.**

### 11.3 A montagem

```
*.veloz.app.        A/AAAA   → borda que roteia por Host header para o nó/ambiente certo
                    (wildcard DNS no nosso PowerDNS)
TLS                 → 1 cert wildcard *.veloz.app (DNS-01), servido pela borda (SNI)
roteamento          → mapa Host→ambiente no nó; subdomínio novo = 1 linha, 0 emissão de cert
```

Criar um subdomínio novo é **uma linha de roteamento** — **nenhuma** emissão de certificado, porque o
wildcard já cobre. Isso é o que torna o subdomínio grátis realmente barato e imune ao rate limit.

### 11.4 Promoção para domínio próprio — zero-downtime por construção

Quando o cliente traz o domínio próprio, a promoção é **aditiva**, nunca uma troca:

```
D+0  cliente aponta cliente.com para o ambiente (§12); mod-dns/borda passam a aceitar o Host novo
D+0  emite cert para cliente.com por DNS-01 (acme-dns) ANTES de qualquer corte
D+0  ambiente responde nos DOIS nomes: cliente.veloz.app (segue válido) E cliente.com
     → nenhum downtime: o subdomínio nunca é desligado no corte
D+n  subdomínio veloz.app permanece como fallback/staging enquanto o cliente quiser
```

Como o subdomínio **continua** funcionando e o domínio novo **soma**, não há instante em que o site esteja
fora. **Zero-downtime é uma propriedade do desenho**, não um procedimento cuidadoso.

---

## 12. Verificação e apontamento de domínio

### 12.1 O fluxo manual que substitui a (inexistente) API do Registro.br

Como não há API para não-registrador (§10.4), o apontamento é **guiado e verificado**, não automatizado no
registrador. Dois modos, o cliente escolhe:

| Modo | O cliente faz | Nós fazemos |
|---|---|---|
| **A — Delegar DNS a nós** (recomendado) | troca os **nameservers** no registrador dele para `ns1/ns2.velozpanel.com.br` + HE (§8) | passamos a ser autoritativos; montamos A/AAAA/`www`/MX por template (§9.5); emitimos TLS por DNS-01 |
| **B — Manter DNS dele, só apontar** | cria **A/AAAA** (e `www`) para o IP do ambiente **e** o CNAME `_acme-challenge` do acme-dns (§9.3) | detectamos a propagação e emitimos TLS sem pedir credencial |

### 12.2 Detecção automática de propagação

O contrato `dns.provider.verify()` (§13) faz consulta DNS pública real (resolver externo, não o cache
local) e diz se propagou:

```
loop de verificação (a cada 30 s, até 30 min):
  resolve A/AAAA de cliente.com em >=3 resolvers públicos (1.1.1.1, 8.8.8.8, 9.9.9.9)
  se todos == IP esperado  → propagou → dispara emissão TLS → marca ambiente "domínio ativo"
  se _acme-challenge CNAME presente → emite por DNS-01 já (não espera o A propagar)
  senão                    → segue no estado "aguardando propagação", mostra o que falta
```

### 12.3 A tela

Estados explícitos, sem "gira-gira" infinito:

```
[ Apontar meu domínio ]  cliente.com

  Modo A · Delegar DNS a nós  (recomendado)
    Troque os nameservers no seu registrador para:
      ns1.velozpanel.com.br
      ns2.velozpanel.com.br
      ns2.he.net  ns3.he.net
    Status: ⏳ aguardando propagação (checado há 12 s)  →  ✅ delegado

  Modo B · Manter meu DNS
    Crie estes registros no seu provedor de DNS:
      A     @      203.0.113.10        ⏳ não encontrado ainda
      A     www    203.0.113.10        ✅ encontrado
      CNAME _acme-challenge  <uuid>.acme-cd.veloz.app   ✅ encontrado → TLS emitido

  [ Verificar agora ]     (o sistema também verifica sozinho a cada 30 s)
```

- Cada registro tem status **individual** (✅/⏳/❌) — o cliente vê exatamente o que falta, não um erro
  genérico.
- O `_acme-challenge` presente **libera o TLS imediatamente**, mesmo antes do A propagar — o site já nasce
  com HTTPS válido quando o apontamento completar.

### 12.4 O CNAME que se cria uma vez, para sempre

O `_acme-challenge → <uuid>.acme-cd.veloz.app` (§9.3) é criado **uma única vez** e nunca mais muda. Depois
dele, toda renovação (a cada ~45 dias, ARI) acontece **sem** o cliente tocar em nada e **sem** ele nos dar
credencial do DNS dele. É o mecanismo que faz o Modo B ser tão bom quanto o Modo A para TLS.

---

## 13. Contrato de capability `dns.provider`

> Estende o `dns.provider v1` já definido em `08` §3.5 — **não** o substitui. O core continua sem conhecer
> a implementação: fala com a interface, resolve o provider por configuração (`08` §3.2, `resolve()`), e
> nunca importa `@veloz/mod-*`. O que segue acrescenta o que a multi-região e o acme-dns exigem.

```ts
// packages/contracts/src/capabilities/dns.ts  (v1 — acréscimos à base do doc 08)

export type DnsRecordType =
  | "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS" | "CAA" | "SRV" | "PTR" | "ALIAS";

export interface DnsRecord {
  readonly type: DnsRecordType;
  readonly name: string;            // "@" | "www" | "_acme-challenge"
  readonly value: string;
  readonly ttl: number;
  readonly priority?: number;       // MX/SRV
}

export interface DnsProviderDescription {
  /** authoritative = gerenciamos a zona (PowerDNS); delegated = acme-dns/CNAME; instructional = só orientamos. */
  readonly mode: "authoritative" | "delegated" | "instructional";
  readonly supportsWildcard: boolean;
  readonly supportsAcmeDns01: boolean;    // decide se dá para emitir wildcard TLS
  readonly supportsDnssec: boolean;       // NOVO — PowerDNS true, Cloudflare true, instructional false
  readonly recordTypes: readonly DnsRecordType[];
  readonly propagationEstimateSeconds: number;
}

/** Delegação de desafio ACME (acme-dns). Independe do provider da zona do cliente (§9.3). */
export interface AcmeChallengeDelegation {
  /** CNAME que o cliente cria UMA vez: _acme-challenge.<dominio> -> fullchallengeDomain. */
  readonly fullChallengeDomain: string;   // "<uuid>.acme-cd.veloz.app"
  /** Publica/atualiza o TXT do desafio na zona DELEGADA (nunca na zona do cliente). */
  publishChallenge(args: { token: string; keyAuthorization: string }): Promise<void>;
  cleanupChallenge(args: { token: string }): Promise<void>;
}

export interface DnsProvider {
  describe(): DnsProviderDescription;

  listRecords(args: { zone: string }): Promise<readonly DnsRecord[]>;

  /** Estado desejado, idempotente e declarativo — o provider calcula o diff (PATCH rrset no PowerDNS). */
  applyRecords(args: { zone: string; records: readonly DnsRecord[] }): Promise<{
    applied: readonly DnsRecord[];
    pending: readonly DnsRecord[];        // o que o cliente ainda precisa criar (modo instructional)
  }>;

  /** Consulta DNS pública REAL (resolver externo), para saber se propagou — alimenta §12.2. */
  verify(args: { zone: string; expected: readonly DnsRecord[] }): Promise<{
    ok: boolean;
    mismatches: readonly { record: DnsRecord; observed: readonly string[] }[];
    checkedAt: string;
  }>;

  /** NOVO — presente só quando describe().supportsAcmeDns01. É o que emite wildcard e sobrevive à partição (§3.5.1). */
  acmeDelegation?(args: { zone: string }): Promise<AcmeChallengeDelegation>;

  /** NOVO — DNSSEC opt-in por domínio (§9.4). Ausente se !supportsDnssec. */
  dnssec?: {
    enable(args: { zone: string }): Promise<{ dsRecords: readonly DnsRecord[] }>;  // cliente publica o DS no registrar
    disable(args: { zone: string }): Promise<void>;
    status(args: { zone: string }): Promise<{ enabled: boolean; dsRecords: readonly DnsRecord[] }>;
  };
}
```

**Três implementações previstas, mesma interface:**

| Provider | `mode` | `supportsAcmeDns01` | `supportsDnssec` | Uso |
|---|---|---|---|---|
| **`mod-dns` (PowerDNS próprio)** | `authoritative` | ✅ (via acme-dns) | ✅ | zona gerenciada por nós (§9), Modo A do §12 |
| **`mod-dns-cloudflare`** (futuro) | `authoritative`/`delegated` | ✅ | ✅ | cliente que quer a rede da Cloudflare; e a zona `acme-cd.veloz.app` |
| **`mod-dns-instructional`** | `instructional` | ✅ (só o CNAME acme-dns) | ❌ | Modo B do §12 — DNS fica no provedor do cliente, nós só orientamos e verificamos |

**Contrato não-tipado (verificado em teste, como em `08` §3.3):** `applyRecords` é idempotente; `verify`
usa resolver **externo** (nunca o cache local do próprio PowerDNS, senão sempre diria "ok"); `acmeDelegation`
publica TXT **apenas** na zona delegada e **nunca** na zona do cliente; a chave privada de DNSSEC nunca
cruza a fronteira do `enable()` (fica no master, §8.3).

---

## Decisões fechadas

Consolidação das D1–D14 do §0, agora fundamentadas, com os gatilhos numéricos que faltavam:

| # | Decisão | Fundamento |
|---|---|---|
| **D1** | Região é entidade de primeira classe (`core.regions`) — jurisdição, moeda de custo, backup, fuso, NS. | §1 |
| **D2** | `environments.region` própria, NOT NULL, imutável, separada de `node_id`. | §1.4 |
| **D3** | Trocar de região = recriação com novo consentimento (`environment.region_move`), 20–60 min, super admin. | §1.6 |
| **D4** | Brasileiro pode ir aos EUA **só** sob cláusulas-padrão ANPD (Res. 19/2024) **+** consentimento específico gravado (texto versionado + hash + IP + timestamp). Sem a linha em `region_consents`, o banco recusa. | §2 |
| **D5** | Control plane no Brasil. Definitivo. | §3.1 |
| **D6** | ACME DNS-01 delegado a zona anycast (`acme-dns`), independente do PowerDNS BR e do CP. | §3.5.1, §9.3 |
| **D7** | Cobrança sempre em BRL; preço de `us-east1` fixado em BRL com **câmbio administrado** (revisão trimestral, gatilho ±8%), nunca indexado ao dólar do dia. | §4.1–4.2 |
| **D8** | O nó dos EUA muda o custo por GB (~48% menor), **não** o problema: a frota BR não tem ponto de equilíbrio porque a restrição é **demanda**, não capacidade. Provisionar `us-east1` **só** com **≥ 3 clientes com consentimento `us-east1` gravado em fila**. | §4.4 |
| **D9** | Backup de nó US fica nos EUA (B2 `us-west-004`); ambiente `us-*` **não** ganha cópia 3 no BR (seria transferência de volta). `allow_cross_border` default `false`. | §5 |
| **D10** | Escolha de região é tela de decisão. Default `br-se1`. Público BR + região US = dupla confirmação + consentimento. Aviso proativo de "escolheu errado" com >80% de tráfego BR por 14 dias. | §2.4, §6 |
| **D11** | Sem anycast próprio. PowerDNS BR (`ns1`) + PowerDNS US (`ns2`) + **Hurricane Electric anycast grátis** (`ns*.he.net`, AXFR/TSIG). Economia de ~US$ 90–128/mês + US$ 500 de entrada contra R$ 0. | §8 |
| **D12** | `mod-dns` sobre PowerDNS 5.1.3: 12 tipos de registro, PATCH em rrsets, importação, templates, DNSSEC **opt-in por domínio** (desligado por padrão), ACME DNS-01 obrigatório. | §9 |
| **D13** | Registro de domínio fora do produto → `mod-registrar` futuro. Gatilho: **(a) ≥ 40 clientes pagantes E (b) ≥ 25% pediram E (c) ≥ 2 trimestres no azul E (d) atendimento além do dono.** `.com.br` continua instrucional. | §10 |
| **D14** | Subdomínio grátis `*.veloz.app` com **um** cert wildcard (DNS-01) + **override de rate limit** da LE para `veloz.app` (**nunca PSL**). Promoção para domínio próprio é zero-downtime por construção. | §11 |

---

## O que isto muda nos documentos existentes

Lista arquivo por arquivo do que o Ciclo 3 obriga a alterar.

### `03-arquitetura.md`
- **Substituir** a coluna `region text DEFAULT 'br-sp'` de `nodes` pela FK para `core.regions` e criar a
  tabela `regions` (migration `0031_regions.sql`, §1.4). O slug muda de `br-sp` para `br-se1` (gramática §1.2).
- **Adicionar** `environments.region` (própria, imutável, com os dois triggers), `region_consent_id`,
  `region_locked_at`, e a tabela append-only `region_consents` (§1.4).
- **Adicionar** `tenants.country_code` e `tenants.home_region`; transformar `tenants.currency` DEFAULT em
  `CHECK (currency = 'BRL')`.
- **Adicionar** `backups.stored_region` e `stored_jurisdiction`; `backup_policies.allow_cross_border`.
- **Elevar** a regra "nenhuma chamada síncrona ao CP no caminho de request" (§1.6) de conselho a **requisito
  intercontinental** (§3.2), com os três itens de checklist (flush do SSE por lote, sem autosave por
  keystroke, timeout de RPC ≥ max(5 s, 20×RTT_p95)).

### `06-multitenancy-runtime.md`
- **Distinguir** `migrate` (intra-região, silencioso, §8.2 atual — continua válido) de
  `environment.region_move` (inter-região, com consentimento, 20–60 min, §1.6). O botão do `migrate`
  **não pode** cruzar fronteira: o trigger `assert_env_node_same_region` (§1.4) o impede no banco.
- **Registrar** que o ACME DNS-01 já escolhido (§638) passa a usar **delegação acme-dns** (§9.3), não
  escrita direta na zona — requisito para sobreviver à partição transcontinental.
- **Confirmar** que a densidade permanece a arbitrada pela Crítica 2 (7/nó, 14 na frota BR); o nó US grande
  (§4.4) é capacidade **de produto**, não muda a densidade por GB.

### `07-billing-metering.md`
- **Aplicar** as FKs de região a `price_tables`, `plan_presets`, `environment_pricing` e **adicionar**
  `region` a `usage_rollups`/`usage_events` (migration `0032`, §1.4). `plan_presets` passa a ter chave
  `(slug, region)` (§1.5).
- **Criar** `fx_rates` (câmbio administrado, §4.2) e `region_costs` (custo real por região em BRL, §4.4).
- **Corrigir** o entendimento de capacidade: a Crítica 2 §1.6 já reescreveu o gatilho de nó novo (12 ativos
  por 14 dias); §4.4 **acrescenta** o gatilho do nó **US** (≥ 3 consentimentos `us-east1` em fila), que é
  de **demanda**, não de ocupação. Preço de `us-east1` = mesmo BRL de `br-se1` na validação (§4.3).
- **Reafirmar** que o nó US **não** é alavanca de equilíbrio (D8) — as três alavancas gratuitas da Crítica 2
  continuam sendo as únicas que fecham a conta.

### `09-banco-backup.md`
- **Estender** a estratégia 3-2-1-1-0 (§5.1) com a **fronteira de jurisdição** (§5.2): cópia 2 no B2 do
  **mesmo continente** do nó; ambiente `us-*` **sem** cópia 3 no BR por padrão.
- **Adicionar** que o teste de restore semanal (D19) de ambiente `us-*` roda **em nó/VPS US**, nunca em nó
  BR (senão o dado cruzaria a fronteira só para o teste) — §5.4.
- **Registrar** que o RTO sobe ~2 min para `us-east1` (coordenação CP↔nó), mas o egress permanece R$ 0
  (bucket local) — §5.3–5.4.

### `11-observabilidade.md`
- **Corrigir o bug do §1.4** (achado do §3.3): separar `event_time` (agente) de `received_at` (CP);
  a validação de janela passa a `received_at − 72 h < event_time < received_at + 60 s`, **nunca**
  descartando amostra represada por partição (inclui evento faturável).
- **Separar** duas métricas hoje confundidas: `drift_relogio` = `abs(offset NTP no nó) > 2 s`;
  latência de entrega = diferença de carimbos (não é drift).
- **Afrouxar** os limiares de heartbeat por região (`us-east1`: 90 s degraded / 240 s unreachable, §3.3).
- **Adicionar** o monitoramento externo *blackbox* de **duas origens** (BR e US) para distinguir "nó US
  caiu" de "link BR↔US caiu" (§3.5.3), e o consumo geográfico de acessos que alimenta o aviso de "região
  errada" (§6.3).
