# Gerenciador de DNS autoritativo (PowerDNS) — VelozPanel

Gerenciador de domínios/DNS **global do admin** (fora de ambiente), em `/admin/dominios`.
DNS autoritativo self-hosted, desenhado para **mover o servidor DNS** sem mexer no painel.

## Arquitetura

- **Motor:** PowerDNS Authoritative 4.9 (`powerdns/pdns-auth-49`), backend **gpgsql** no
  Postgres do control-plane, **database dedicado `pdns`**. Container `pdns` no
  control-plane (187). Autoritativo apenas (sem recursão → sem open-resolver).
- **Estado:** as zonas/registros vivem no database `pdns` (movível com
  `pg_dump -Fc pdns`). A única tabela nossa é `dns_zones_meta` (status de
  delegação + vínculo opcional com ambiente), no banco de controle.
- **Gerência:** a API do painel fala **só pela HTTP API do pdns** (`http://pdns:8081`,
  `X-API-Key`), nunca no SQL. Toda escrita faz **read-after-write** (relê e confirma;
  502 se divergir). Porta 8081 **nunca** publicada (só rede compose + WireGuard).
- **Público:** só 53/udp+tcp, publicado nos IPs **público (187)** e **WireGuard
  (10.100.0.1)** — não em `0.0.0.0` (o `systemd-resolved` ocupa `127.0.0.53:53`).
- **Redundância:** `ns1` = 187 (primário) · `ns2` = 184 (secundário via AXFR+NOTIFY
  pela WireGuard). O secundário é `deploy/node/docker-compose.dns-secondary.yml`
  (backend gsqlite3, autoprimary — nasce burro e puxa as zonas sozinho).

## Movibilidade

O painel/API/Postgres ficam no 187. Para mover o **servidor DNS**:
1. `pg_dump -Fc pdns` no 187 → restaura num Postgres do novo servidor.
2. Sobe o container `pdns` no novo servidor apontando para esse Postgres.
3. Atualiza `DNS_NS1_IP` (e o glue) para o IP do novo servidor + repropaga no registrador.
O secundário (184) mantém a resolução no ar durante a janela.

## Peças no código

- **Contratos** (`packages/contracts`): `dnsZone`, `dnsRRset`, `dnsServerInfo`,
  `createZoneInput`, `upsertRRsetInput`, `deleteRRsetInput`, `verifyResult`,
  `discoverResult`, enum `dnsRecordType` (inclui SOA/NS para leitura).
- **API**: `dns-pdns.ts` (cliente HTTP + canonicalização), `dns-resolver.ts`
  (verify/discover via node:dns), `dns-protect.ts` (cadeados system/panel),
  `routes/dns.ts` (9 rotas `/admin/dns/*`, `requireAdmin`+`recordAudit`),
  `dns-verifier.ts` (job periódico, molde do metrics-collector).
- **DB**: `dns_zones_meta` (schema.ts + push-and-seed.ts) + `bootstrapPdns()`
  (cria database/role/schema gpgsql oficial + grants; pulado sem `PDNS_DB_PASSWORD`).
- **Painel**: nav "Domínios" (AdminShell), `admin/dominios/page.tsx` (lista + card de
  nameservers + adicionar, com aviso anti-takeover), `admin/dominios/[zona]/page.tsx`
  (delegação + verificar + CRUD de registros por RRset + importar registros atuais).

## Deploy (control-plane, 187)

1. `.env`: `PDNS_DB_PASSWORD`, `PDNS_API_KEY`, `DNS_NS*`, `DNS_BIND_PUBLIC`,
   `DNS_SECONDARY_WG` (ver `.env.example`).
2. `./gen-pdns-conf.sh` (gera `pdns.conf` a partir do `.env` — a imagem ignora
   variáveis `PDNS_*`, só lê arquivo montado).
3. `docker compose up -d --force-recreate api painel` → `docker exec … db:push`
   (cria `dns_zones_meta` + bootstrap do database `pdns`) → `docker compose up -d pdns`.

## Passos do DONO no registrador (por domínio)

Recomendado estrear num **subdomínio** (`lab.geestao.top`) — não toca o ápice que serve o painel.
1. Cadastrar os hosts/glue: `ns1.geestao.top → 187.127.49.205`, `ns2.geestao.top → 184.107.115.183`.
2. Apontar os nameservers do domínio para `ns1.geestao.top` e `ns2.geestao.top`.
3. TTL baixo (300s) durante o teste; propagação pode levar até 24–48h.
4. No painel, "Verificar agora" → status vira "Ativo" (2/2 NS).

## Estado atual (validado em prod)

- pdns no ar no 187 (gpgsql, API 8081, primary). `lab.geestao.top` criado como exemplo.
- `dig @187.127.49.205 lab.geestao.top A` → 187.127.49.205 (interno, WG e **externo** OK).
- Falta o dono: subir o secundário no 184 e delegar os NS no registrador.
