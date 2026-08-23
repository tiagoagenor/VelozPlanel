# Deploy — VelozPlanel (produção)

Runbook do zero até o smoke test. Arquitetura: **hub (187)** roda o plano de
controle via docker-compose; **dois nós** rodam o agente Docker; tudo se fala
por **WireGuard** (`10.77.0.0/24`).

```
deploy/
├── control-plane/         # roda no 187 (hub)
│   ├── docker-compose.prod.yml
│   ├── Caddyfile
│   └── .env.example       → copie para .env e preencha os segredos
├── node/
│   └── docker-compose.node.yml   # roda em cada nó
├── wireguard/             # templates de túnel + README de chaves
└── README.md              # este arquivo
```

Imagens: `velozplanel/api:prod`, `velozplanel/painel:prod`, `velozplanel/agent:prod`.
Buildadas num nó de 6 vCPU e transferidas via `docker save | ssh … docker load`.
Os Dockerfiles produzem imagens **auto-contidas** (não dependem de `build:` em
runtime); o `build:` no compose fica só como fallback.

---

## Ordem de execução

### 1. WireGuard (malha primeiro)

Siga `deploy/wireguard/README.md`: gere chaves em cada host, preencha os
`wg0.conf` a partir dos `.example`, `wg-quick up wg0` no hub e nos dois nós.
Valide com `sudo wg show` e `ping 10.77.0.1/2/3`.

> **Segredos gerados aqui:** as private/public keys do WireGuard (uma por host).

### 2. Nós / agente

Em **cada nó** (Docker já instalado):

```bash
# carregue a imagem transferida do builder (ver passo 3)
docker load < velozplanel-agent-prod.tar

cd deploy/node
# node-local → 10.77.0.2 · node-remoto → 10.77.0.3
AGENT_BIND_IP=10.77.0.2 docker compose -f docker-compose.node.yml up -d
docker compose -f docker-compose.node.yml ps      # healthy?
```

O agente publica `4100` só no IP WG e monta o `docker.sock`. Teste do hub:
`curl http://10.77.0.2:4100/health` → `{"ok":true}`.

### 3. Build das imagens (no nó de 6 vCPU) e transferência

A partir da **raiz do monorepo**:

```bash
docker build -f apps/api/Dockerfile    -t velozplanel/api:prod .
docker build -f apps/agent/Dockerfile  -t velozplanel/agent:prod .
docker build -f apps/painel/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=/api/v1 -t velozplanel/painel:prod .

# transfira cada imagem para o destino:
docker save velozplanel/api:prod    | ssh hub  'docker load'
docker save velozplanel/painel:prod | ssh hub  'docker load'
docker save velozplanel/agent:prod  | ssh node 'docker load'   # cada nó
```

> Alternativa (fallback): rodar `docker compose ... build` direto no destino —
> mais lento e pesado para o 187 (1 vCPU), por isso preferimos build remoto.

### 4. Subir o plano de controle (187)

```bash
cd deploy/control-plane
cp .env.example .env
# gere e cole os segredos:  openssl rand -base64 36
#   POSTGRES_PASSWORD, MARIADB_ROOT_PASSWORD, VP_JWT_SECRET,
#   VP_SEED_ADMIN_EMAIL / VP_SEED_ADMIN_PASSWORD
# ajuste HUB_WG_IP, AGENT_URL, VP_PANEL_ORIGINS e SITE_ADDRESS.
nano .env

docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps        # postgres/mariadb healthy
```

> **Segredos gerados aqui:** todas as senhas/segredos do `.env` (nunca versione).
> O `.env` fica só no 187. Caddy sobe com `tls internal` (self-signed) enquanto
> não há domínio — o navegador vai acusar cert não confiável (esperado).

### 5. Schema + seed do admin

Cria o schema (idempotente) e o primeiro super admin (usa `VP_SEED_ADMIN_*`):

```bash
docker compose -f docker-compose.prod.yml exec api pnpm exec tsx src/db/push-and-seed.ts
```

Reinicie a API se ela subiu antes do schema existir:
`docker compose -f docker-compose.prod.yml restart api`.

### 6. Registrar os nós

No painel (logado como super admin) cadastre os dois nós apontando para
`http://10.77.0.2:4100` e `http://10.77.0.3:4100`.

> **Pendência conhecida:** a API usa hoje um `AGENT_URL` único (env). Enquanto
> não houver seleção por nó, `AGENT_URL` no `.env` decide qual agente atende os
> provisionamentos. Confirmar com o outro engenheiro antes do go-live.

### 7. Smoke test

```bash
# painel responde (self-signed → -k)
curl -kI https://SEU_IP_OU_DOMINIO/
# API atrás do proxy
curl -k  https://SEU_IP_OU_DOMINIO/api/v1/...   # rota autenticada → 401 sem cookie
# :80 redireciona para 443
curl -sI http://SEU_IP_OU_DOMINIO/ | grep -i location
```

Depois, no navegador: login com o admin semeado → criar um ambiente de teste
(exercita a cadeia API → agente → Docker no nó) → criar um banco (exercita o
MariaDB via WG).

---

## Migrar para domínio + Let's Encrypt (depois)

1. `SITE_ADDRESS=meudominio.com` no `.env`;
2. remova/comente `tls internal` no `Caddyfile`;
3. aponte o DNS para o 187, libere 80/443 no firewall;
4. `docker compose -f docker-compose.prod.yml up -d caddy` — o Caddy emite o
   cert ACME automaticamente.
