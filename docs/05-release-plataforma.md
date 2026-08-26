# 05 — Release da plataforma (deploy do velozPanel em si)

Como publicar uma mudança de código da **plataforma** (api / painel / agente) em produção. Diferente do [deploy do cliente](03-deploy.md) (git → app). Para instalar do zero, ver `deploy/README.md`.

## Servidores (ver `[[velozpanel-prod-deploy]]`)

| Host | Papel | Notas |
|---|---|---|
| `187.127.49.205` | **Control-plane**: Postgres + MariaDB + API + Painel + Caddy + PowerDNS, via docker-compose em `/opt/velozplanel/control-plane`. Hub WireGuard. | Serve `jamees.com` (painel) e `*.jamees.top` (ambientes). |
| `184.107.115.183` | **Nó de hospedagem** (6 vCPU) e **host de build** das imagens, em `/opt/velozplanel-src` (sincronizado por **rsync**, não é um git clone). | |
| `192.168.2.111` | Nó de hospedagem local (atrás de NAT). | |

Imagens: `velozplanel/{api,painel,agent}:prod` — buildadas no 184 e transferidas via `docker save | ssh docker load`.

> ⚠️ **Schema:** não há migrations. O schema é aplicado por `push-and-seed.ts` (idempotente: `CREATE TABLE IF NOT EXISTS` + `ALTER … ADD COLUMN IF NOT EXISTS`). Se a sua mudança tocou o schema (`apps/api/src/db/schema.ts`), **adicione o `ALTER` correspondente em `push-and-seed.ts`** e rode o `db:push` no deploy.

---

## Fluxo (mudança só na API — o mais comum)

Do seu Mac (você tem SSH por chave para 184 e 187, e o 184 alcança o 187):

```bash
# 1. Commitar (num branch, se estiver na main)
git checkout -b feat/minha-mudanca && git add -A && git commit -m "..."

# 2. Sincronizar o fonte para o build host (184) — SEM --delete
rsync -az --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='dist' --exclude='*.tar' --exclude='.turbo' \
  ./ root@184.107.115.183:/opt/velozplanel-src/

# 3. Buildar a imagem no 184 e transferir para o 187
ssh root@184.107.115.183 '
  cd /opt/velozplanel-src &&
  docker build -f apps/api/Dockerfile -t velozplanel/api:prod . &&
  docker save velozplanel/api:prod | ssh root@187.127.49.205 "docker load"
'

# 4. (SÓ se mudou o schema) aplicar o db:push com a imagem nova, ANTES de recriar
ssh root@187.127.49.205 '
  cd /opt/velozplanel/control-plane &&
  docker compose -f docker-compose.prod.yml --env-file .env run --rm --no-deps -T api \
    pnpm exec tsx src/db/push-and-seed.ts
'

# 5. Recriar a api (breve indisponibilidade de ~segundos)
ssh root@187.127.49.205 '
  cd /opt/velozplanel/control-plane &&
  docker compose -f docker-compose.prod.yml --env-file .env up -d --no-deps --force-recreate api
'
```

**Mudou também o painel ou os contracts** (contracts entram no bundle de api e painel): buildar e transferir `velozplanel/painel:prod` também (`docker build -f apps/painel/Dockerfile --build-arg NEXT_PUBLIC_API_URL=/api/v1 -t velozplanel/painel:prod .`) e recriar `api painel` no passo 5.

**Mudou o agente:** buildar `velozplanel/agent:prod`, transferir para **cada nó**, e recriar o agente lá (`deploy/node/docker-compose.node.yml`), ou via `docker run` conforme `[[velozpanel-prod-deploy]]`.

---

## Verificação pós-deploy

```bash
# containers saudáveis
ssh root@187.127.49.205 'cd /opt/velozplanel/control-plane && \
  docker compose -f docker-compose.prod.yml ps api painel'
# api respondendo (401/404 = ok; 502 = api caiu)
curl -sk -o /dev/null -w "%{http_code}\n" https://jamees.com/api/v1/session
# painel
curl -skI https://jamees.com/ | head -1
```

O `--force-recreate` causa **~segundos de indisponibilidade** (o container reinicia). Se um cliente estiver usando o painel, ele vê alguns 502 transitórios até a api voltar (`healthy`).

---

## Scripts de migração/backfill (rodar 1×)

Rodam com a imagem nova via `docker compose run --rm --no-deps -T api pnpm exec tsx src/db/<script>.ts`:

- `db/push-and-seed.ts` — schema + seed do admin (idempotente).
- `db/backfill-subdomains.ts` — wildcard `*.jamees.top` no PowerDNS + subdomínio p/ envs web sem um.
- `db/backfill-panels.ts` — liga/reescreve o vhost dos painéis de serviço (rabbitmq) — reconciliador (respeita painel desligado pelo dono).

---

## Rollback

As imagens antigas continuam no 187 até serem sobrescritas. Para voltar: recriar apontando para a tag/imagem anterior (se preservada), ou rebuildar do commit anterior e repetir o fluxo. `db:push` é **aditivo** (ADD COLUMN IF NOT EXISTS) — colunas novas não quebram a imagem antiga, então normalmente basta reverter a imagem.

---

## Pegadinhas

- **rsync sem `--delete`** (o `/opt/velozplanel-src` do 184 não é git; `--delete` poderia apagar artefatos locais deles).
- **rsync do macOS** é antigo — não usar `--info=stats1` (use `--stats`).
- **NÃO** montar o `caddy_managed` errado: a api escreve os vhosts em `CP_INGRESS_DIR=/caddy-managed` e o Caddy lê o mesmo volume em `/etc/caddy/managed` (esse wiring existe em prod mas **não** está no compose committado — não “consertar” removendo).
- O `.env` de produção fica **só no 187** (`/opt/velozplanel/control-plane/.env`) — nunca versionar.

Ver também: `deploy/README.md` (instalação do zero) e `[[velozpanel-prod-deploy]]` (detalhes de rede/WireGuard/SSH gateway).
