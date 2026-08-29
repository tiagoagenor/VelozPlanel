# jamees — CLI de operações

CLI em Node/TypeScript (zero-dep, só builtins) para as operações recorrentes de
infra do VelozPanel/Jamees. Roda **no Mac do operador**, sobre a WireGuard, e
imprime **um objeto JSON enxuto por comando** — para gastar poucos tokens quando
o assistente opera a infra. Args pequenos entram, JSON resumido sai, saída grande
fica atrás de um `logId`, e **toda operação destrutiva exige `--yes`**.

## Instalar / atualizar

```bash
pnpm --filter @velozplanel/cli build
# link opcional para usar como `jamees` global:
ln -sf "$PWD/apps/cli/dist/index.js" /usr/local/bin/jamees   # (ou ~/.local/bin)
```

Sem link, rode `node apps/cli/dist/index.js <cmd>`.

## Config (uma vez)

```bash
jamees config init      # semeia ~/.jamees/config (chmod 600) lendo do prod
jamees config doctor    # valida ssh/WG, role RO, rotas internas
```

Segredos: reusa o `VP_INTERNAL_TOKEN` que já existe no prod (nada novo, nada
versionado). Fica só no Mac, em `~/.jamees/config` (0600).

## Comandos

- **deploy** `api|painel|site` `[--yes] [--schema] [--no-health] [--rollback]`, `deploy agent --node <n|all>`, `deploy schema [--check]`, `deploy status`
- **dns** `zones` · `get <zona> [--name --type]` · `upsert <zona> --name --type --ttl --content …` · `del` · `set-ns` · `verify`
- **nodes** `ls` · `health` · `update-agent --node` · `push-image` · `stats --env`
- **db** `query --db <velozpanel|pdns> --sql "SELECT…"` (somente-leitura, role dedicado) · `tables`
- **containers** `ps` · `logs <svc>` · `restart` · `recreate` · `env-set`
- **caddy** `get [--site]` · `set --site --block <arq|->` · `reload`
- **env** `resolve` · `logs` · `ssh-enable/ssh-disable` · `service ls` · `vars-set`* · `move-domain`*
- **panel** `set-domain <host>`
- **status**, **billing status**, **logs** `pull|tail --id <logId>`

`*` `vars-set`/`service add`/`move-domain` encaminham ao painel (merge cifrado /
IPAM / TLS são fluxos do painel) — o CLI reporta honestamente `needsRoute`.

## Convenções de saída

- sucesso: `{ "ok": true, … }` · falha: `{ "ok": false, error, tail:[~40 linhas], hint? }`
- destrutivo sem `--yes`: `{ "ok": false, "needsConfirm": true, "plan": {…} }` (exit 3)
- saída grande: `{ …, "logId": "…", "more": true }` → `jamees logs pull --id <logId>`
- exit: 0 ok · 1 falha · 2 uso · 3 confirmação exigida
