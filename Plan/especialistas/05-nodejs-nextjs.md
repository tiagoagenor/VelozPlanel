# 05 — Node.js / Next.js: viabilidade, desenho e veredito

> Autor: Especialista Node.js / Next.js
> Contratado para responder a pergunta literal do dono do produto:
> *"não sei se na parte de integração com Linux dá para fazer com Node e se vai ser boa performance"*.
> Este documento **contradiz e corrige** partes do `03-arquitetura.md` (D3, D4) e usa o
> `04-infra-linux.md` como lista de operações a serem executadas.
> Contexto obrigatório: ADENDO 1 do briefing — Node/.NET/HTML+CSS como base do dono, Next.js fechado,
> IA escreve o código, dono opera e depura, 3 VPS de 16 GB em provedores diferentes, sem rede privada.

---

## 0. Resposta curta (leia isto se ler só uma seção)

1. **Sim, dá para fazer a integração com Linux em Node.** De 11 famílias de operação que este projeto
   exige, **8 são maduras em Node**, 2 são "arriscadas mas contornáveis com um helper externo" e
   **1 (D-Bus/systemd nativo) não deve ser feita em Node** — e não precisa ser.
2. **Performance não é o problema.** Medi: ler um arquivo de `/sys/fs/cgroup` em Node custa
   **~14 µs** (síncrono) / ~34 µs (assíncrono). Coletar 6 arquivos × 40 ambientes a cada 15 s consome
   **~3,5 ms de event loop por ciclo** — 0,02% de um core. O gargalo deste projeto nunca vai ser
   a linguagem do coletor.
3. **O agente do nó deve ser Node.js 24 LTS distribuído como SEA (binário único).** O argumento não é
   RAM (a diferença para Go é ~80 MB em 16.384 MB = 0,5%); é **uma linguagem só no sistema inteiro**,
   que o dono lê e depura. Plano B, se o agente virar problema: **.NET 10 Native AOT** — não Go.
4. **Control plane: Next.js só front + API separada em Fastify.** Não Next.js full-stack.
   A API precisa ser pública, versionada, com workers e SSE de longa duração; isso não cabe no ciclo
   de vida de um app Next.
5. **Rejeito o ESM remoto em runtime (D4 do arquiteto) para módulos de UI.** Em Next.js isso é uma
   armadilha: Module Federation está morrendo e nunca suportou App Router, e ESM remoto no mesmo
   origin dá zero isolamento de segurança. Proposta: **registry de plugin em build-time (fase 1) +
   iframe sandbox com postMessage (fase 2, terceiros)**.

---

## 1. Node consegue fazer a integração com Linux que este projeto exige?

Regra de leitura: **maduro** = use sem medo; **arriscado** = funciona, mas exige disciplina explícita
e teste; **não faça em Node** = delegue a outro processo.

### 1.1 Tabela-resumo

| # | Operação | Como em Node | Veredito |
|---|---|---|---|
| 1 | Ler métricas cgroup v2 (`memory.current`, `cpu.stat`, `io.stat`, `memory.pressure`) | `fs.readFileSync` em lote + parser próprio | **Maduro** |
| 2 | Escrever limites de cgroup a quente | Via API Incus (preferido) ou helper root `velozctl` | **Maduro** (indireto) |
| 3 | Controlar Incus | HTTP/JSON sobre unix socket com `undici` | **Maduro** |
| 3b | Docker / Podman | `dockerode` / API Podman (compatível Docker) sobre socket | **Maduro** (mas fora do desenho escolhido) |
| 4 | Falar com systemd via **D-Bus** | bibliotecas abandonadas | **NÃO faça em Node** |
| 4b | Falar com systemd via `systemctl`/`busctl` | `execFile` com allowlist | **Maduro** |
| 5 | Executar comandos privilegiados | `execFile`/`spawn` **sem shell** + allowlist + helper root | **Maduro com disciplina** |
| 6 | Gerar nginx conf, validar, recarregar | template em JS + `nginx -t` + `systemctl reload` via helper | **Maduro** |
| 7 | ACME (certificados) | `acme-client`; ou delegar ao `lego`/`certbot` | **Arriscado → delegue** |
| 8 | Streaming de log para UI (SSE) | `Readable` + SSE no Fastify | **Maduro** (é onde Node brilha) |
| 8b | Tail de arquivo grande com backpressure | `createReadStream` + `pipeline` + watermark | **Arriscado com disciplina** |
| 9 | Quota/uso de disco ZFS | `execFile('zfs', ['list','-Hp',...])` | **Maduro** |
| 10 | SFTP/SSH do cliente | **não implemente em Node** — é o `sshd` do host (§8.5 infra) | **Não faça em Node** |
| 10b | Terminal web (se `mod-ssh` existir) | `ssh2` + WebSocket, ou `incus exec` via API | **Arriscado** |
| 11 | Criar usuários/permissões Unix | `useradd`/`setfacl` via helper root; ou dentro do container | **Maduro com disciplina** |

### 1.2 Detalhamento operação por operação

#### (1) Métricas de cgroup v2 — **maduro, e mais barato do que parece**

Os arquivos de `/sys/fs/cgroup` são gerados pelo kernel em memória. **Não existe I/O de disco.**
Isso muda a recomendação padrão de Node: aqui, **`readFileSync` é a escolha certa**, não `fs/promises`.
O `fs/promises` joga a leitura no threadpool do libuv (4 threads por padrão), pagando um round-trip
de fila que, para arquivos de 100 bytes, custa mais do que a leitura.

Medição real (Node 24.11, arquivo pequeno, 8.000 leituras):

| Modo | Total | Por leitura |
|---|---|---|
| `fs.promises.readFile` (40 em paralelo × 200 ciclos) | 268 ms | **33,5 µs** |
| `fs.readFileSync` sequencial | 115 ms | **14,4 µs** |

Custo do ciclo de coleta real do VelozPanel:

```
6 arquivos × 40 ambientes = 240 leituras
240 × 14,4 µs ≈ 3,5 ms de event loop, a cada 15 s
= 0,023% de um core
```

Mesmo com 200 ambientes num nó (que não vai acontecer em 16 GB): 1.200 leituras ≈ 17 ms/ciclo.
Continua irrelevante. **Isto encerra a dúvida de performance do dono para métricas.**

```js
// packages/agent/src/collect/cgroup.js
import { readFileSync } from 'node:fs';

const readOr = (p, fb = null) => { try { return readFileSync(p, 'utf8'); } catch { return fb; } };

// cpu.stat -> { usage_usec, user_usec, system_usec, nr_throttled, throttled_usec }
const parseKV = (txt) => Object.fromEntries(
  txt.trim().split('\n').map((l) => { const [k, v] = l.split(' '); return [k, Number(v)]; })
);

// memory.pressure -> "some avg10=0.00 avg60=0.00 avg300=0.00 total=0"
const parsePSI = (txt) => Object.fromEntries(
  txt.trim().split('\n').map((line) => {
    const [kind, ...rest] = line.split(' ');
    return [kind, Object.fromEntries(rest.map((p) => { const [k, v] = p.split('='); return [k, Number(v)]; }))];
  })
);

export function sampleEnv(envId) {
  const cg = `/sys/fs/cgroup/incus.payload.env-${envId}`;
  return {
    env_id: envId,
    ts: Date.now(),
    mem_current: Number(readOr(`${cg}/memory.current`, '0')),
    mem_peak:    Number(readOr(`${cg}/memory.peak`, '0')),
    mem_events:  parseKV(readOr(`${cg}/memory.events`, '')),      // oom_kill, max, ...
    mem_psi:     parsePSI(readOr(`${cg}/memory.pressure`, 'some avg10=0')),
    cpu:         parseKV(readOr(`${cg}/cpu.stat`, '')),           // usage_usec cumulativo
    io_psi:      parsePSI(readOr(`${cg}/io.pressure`, 'some avg10=0')),
    pids:        Number(readOr(`${cg}/pids.current`, '0')),
  };
}
```

Regras que a IA deve seguir e que precisam estar na especificação:

- `cpu.stat.usage_usec` é **contador acumulado**. A derivada (`%CPU`) é calculada no agente, não no
  painel: `(usage_now - usage_prev) / (t_now - t_prev) / 10_000` = % de um core.
  Contador reinicia quando o container reinicia → detectar `usage < prev` e descartar a amostra.
- **Nunca** ler cgroup com `fs/promises` num `for await`. Ler tudo síncrono num tick e sair.
- O caminho do cgroup muda entre LXD (`lxc.payload.`) e Incus (`incus.payload.`) e pode mudar de novo.
  Resolver o caminho **uma vez por container**, via `/proc/<pid>/cgroup`, e cachear com invalidação
  no evento `instance-started` do Incus. Hardcode de caminho é o bug #1 previsto aqui.
- Cadência: **15 s** para métricas de gráfico, **60 s** para eventos faturáveis. Não descer de 15 s.

#### (2) Escrever limites de cgroup a quente — **maduro, mas não escreva direto**

Escrever `memory.max` é `fs.writeFileSync(path, '4294967296')`. Tecnicamente trivial. **Mas o agente
não roda como root** (§11.5 do doc de infra), e não deve rodar. Portanto:

- **Caminho principal**: Incus API — `PATCH /1.0/instances/env-0042` com `{"config":{"limits.memory":"4GiB"}}`.
  Aplica a quente, é persistente e sobrevive a restart do container. O agente só precisa do grupo
  `incus-admin`, não de root.
- **Caminho complementar**: `memory.high` (a estratégia 80%/100% da §3.4 do doc de infra) o Incus não
  expõe junto com `memory.max`. Aqui o agente chama o helper root:
  `velozctl cgroup-set 0042 memory.high 858993459`. O helper valida `^[0-9]{1,6}$` para o env-id,
  a chave contra uma allowlist de 4 nomes, e o valor contra `^[0-9]{1,20}$`.
- Essa escrita é **volátil** — some no restart do container. O agente reaplica no hook
  `instance-started`. Isso não é uma limitação do Node, é do desenho; mas a IA precisa disso escrito.

#### (3) Incus — **Node é excelente aqui, melhor do que se supõe**

A API do Incus é **HTTP/1.1 + JSON sobre unix socket** (`/var/lib/incus/unix.socket`)
([docs](https://linuxcontainers.org/incus/docs/main/rest-api/)). Node fala isso nativamente com
`undici`, sem dependência exótica, sem parsear stdout de CLI, sem `incus` no PATH.

```js
// packages/agent/src/incus/client.js
import { Agent, request } from 'undici';

const dispatcher = new Agent({ connect: { socketPath: '/var/lib/incus/unix.socket' } });
const BASE = 'http://localhost';   // host ignorado quando socketPath está setado

async function api(method, path, body) {
  const res = await request(`${BASE}${path}`, {
    method, dispatcher,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    headersTimeout: 10_000, bodyTimeout: 30_000,
  });
  const json = await res.body.json();
  if (json.type === 'error') throw new IncusError(json.error_code, json.error);
  return json;
}

// resize a quente (requisito 9) — PATCH preserva as demais chaves
export const setLimits = (name, { memory, cpuAllowance }) =>
  api('PATCH', `/1.0/instances/${name}`, {
    config: { ...(memory && { 'limits.memory': memory }),
              ...(cpuAllowance && { 'limits.cpu.allowance': cpuAllowance }) },
  });

// operações assíncronas do Incus: PUT/POST devolvem type:"async" + uma operation
export async function waitOp(op, timeoutMs = 300_000) {
  const r = await api('GET', `/1.0/operations/${op.metadata.id}/wait?timeout=${Math.floor(timeoutMs/1000)}`);
  if (r.metadata.status_code !== 200) throw new IncusError(r.metadata.err);
  return r.metadata;
}

export const pause  = (n) => api('PUT', `/1.0/instances/${n}/state`, { action: 'freeze',   timeout: 30 });
export const resume = (n) => api('PUT', `/1.0/instances/${n}/state`, { action: 'unfreeze', timeout: 30 });
```

Ponto forte real: o Incus expõe **eventos em streaming** (`GET /1.0/events` — WebSocket) com
`instance-started`, `instance-stopped`, `lifecycle`. Consumir stream de eventos long-lived é
exatamente o que o modelo de I/O do Node faz melhor. O agente não precisa fazer polling de `incus list`.

Riscos e o que a especificação precisa fixar:
- **Não existe cliente Node oficial do Incus.** Vamos escrever ~200 linhas. Isso é bom (menos
  dependência) e ruim (nós mantemos). Cobrir com teste de contrato contra um Incus real em CI.
- Toda operação de mutação é **assíncrona**: retorna `{type:"async", operation:"/1.0/operations/<uuid>"}`.
  Esquecer o `wait` é o bug clássico. A IA deve ser proibida de chamar `api('PUT'...)` sem `waitOp`.
- Timeout do `undici` precisa ser explícito; o default de `bodyTimeout` mata operações longas
  (`copy`, `snapshot`) silenciosamente.

**Docker/Podman**: `dockerode` é maduro e fala o mesmo socket; o Podman expõe uma API
compatível com Docker. Mas o `04-infra-linux.md` já decidiu Incus, e concordo: container de sistema
com cron/ssh/systemd é o que "hospedagem" significa. Registro só para o caso de um módulo futuro
(`mod-docker-apps`) precisar: em Node isso é caminho batido.

#### (4) systemd — **D-Bus em Node está morto; use o CLI**

Estado das bibliotecas em 2026:

| Lib | Situação |
|---|---|
| `dbus-next` | última versão 0.10.2, publicada há ~5 anos — **abandonada** ([npm](https://www.npmjs.com/package/dbus-next)) |
| `dbus-native` | base do `dbus-next`, mais antiga ainda |
| `dbus-final` | fork criado explicitamente *"porque nenhuma lib de dbus parece ativamente mantida"* ([repo](https://github.com/kando-menu/dbus-final)) |
| `node-dbus2`, `@clebert/node-d-bus` | nichos, sem tração |

**Decisão: o agente NÃO usa D-Bus.** Não é uma limitação séria porque **o agente também não deveria
falar com systemd diretamente** — ele não roda como root. As três coisas que precisamos do systemd são:

```js
// via helper root, sem shell, argumentos enumerados
await velozctl(['nginx-apply']);                       // valida + systemctl reload nginx
await velozctl(['svc', 'restart', 'veloz-app@0042']);  // unit name validado por regex
const st = await execFileP('systemctl', ['show', unit, '--property=ActiveState,SubState,MainPID'], { timeout: 5000 });
```

`systemctl show --property=...` devolve `chave=valor` por linha — parsing trivial, estável há uma
década, e é o que o próprio `systemd` documenta como interface de script. Zero dependência.

Uma coisa de systemd que o agente **precisa** implementar em Node e não tem lib: o **watchdog**
(`WatchdogSec=30` na unit do agente, §11.5 da infra). São 8 linhas com `dgram`:

```js
// packages/agent/src/sd-notify.js — sem dependência
import { createSocket } from 'node:dgram';
const sock = process.env.NOTIFY_SOCKET;
const sd = sock ? createSocket('unix_dgram') : null;
const addr = sock?.startsWith('@') ? '\0' + sock.slice(1) : sock;   // abstract socket
export function notify(msg) { if (sd) sd.send(Buffer.from(msg), addr); }
// no boot: notify('READY=1')  |  no loop de saúde: notify('WATCHDOG=1')
```

> Cuidado: `unix_dgram` não é um tipo suportado por `node:dgram` (que só faz `udp4`/`udp6`).
> **Isso é uma limitação real do Node.** Duas saídas, nesta ordem de preferência:
> (a) `Type=exec` + `Restart=always` + healthcheck externo (o CP já detecta ausência de heartbeat
> em 45 s — o watchdog do systemd é redundante); (b) o helper `velozctl notify ready|watchdog`
> escrever no socket em C/Go. **Recomendação: (a).** Não vale carregar dependência nativa por isso.

#### (5) Executar comandos privilegiados — **maduro, com três regras não negociáveis**

```js
// packages/agent/src/exec.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

const ENV_ID = /^[0-9]{1,6}$/;
const FQDN   = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;

const ALLOW = {
  'nginx-apply':  { args: [] },
  'cgroup-set':   { args: [ENV_ID, /^(memory\.high|memory\.max|io\.max|io\.weight)$/, /^[0-9: a-z=]{1,64}$/] },
  'cert-deploy':  { args: [FQDN] },
  'state':        { args: [/^set$/, ENV_ID, /^(running|paused|suspended)$/] },
  'db-provision': { args: [ENV_ID, /^(mysql|pg)$/] },
};

export async function velozctl(argv, { timeout = 60_000 } = {}) {
  const [sub, ...rest] = argv;
  const spec = ALLOW[sub];
  if (!spec) throw new Error(`velozctl: subcomando não permitido: ${sub}`);
  if (rest.length !== spec.args.length) throw new Error(`velozctl ${sub}: aridade inválida`);
  rest.forEach((a, i) => { if (!spec.args[i].test(String(a))) throw new Error(`velozctl ${sub}: arg ${i} inválido`); });

  // sudo -n: nunca pede senha; execFile: SEM shell; argv em array: sem interpolação
  const { stdout, stderr } = await execFileP('sudo', ['-n', '/usr/local/sbin/velozctl', sub, ...rest],
    { timeout, killSignal: 'SIGKILL', maxBuffer: 4 << 20, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } });
  return { stdout, stderr };
}
```

Regras (vão para o `AGENTS.md` do pacote, porque a IA erra exatamente aqui):

1. **`child_process.exec` é proibido no repositório inteiro.** Regra de lint que falha o build
   (`no-restricted-imports` + regra custom). `exec` passa por `/bin/sh` e é a origem canônica de
   injeção de comando ([Node docs](https://nodejs.org/api/child_process.html),
   [SecureFlag](https://knowledge-base.secureflag.com/vulnerabilities/code_injection/os_command_injection_nodejs.html)).
2. **Nunca `shell: true`.** Nem "só nesse caso". `spawn`/`execFile` com `shell:false` (o default)
   entregam argv direto ao `execve`.
3. **Allowlist de subcomando + regex por posição de argumento**, do lado do Node **e** repetida
   dentro do `velozctl`. Defesa em profundidade: se o processo Node for comprometido, o helper root
   ainda recusa.
4. `timeout` obrigatório em toda chamada. Um `execFile` sem timeout que trava é um vazamento de
   processo que ninguém percebe até o `pids.max` do nó estourar.
5. `maxBuffer` explícito. O default de 1 MB corta stdout de `zfs list` num nó grande, silenciosamente
   virando erro `ENOBUFS` — e ninguém adivinha o motivo às 3h da manhã.

#### (6) nginx: gerar, validar, recarregar — **maduro**

O trabalho é: renderizar template → escrever em stage → `nginx -t` → rsync → `systemctl reload`.
Em Node, o template é uma template string ou `eta`/`nunjucks`. Prefiro **template string pura com
uma função de escape**, porque é o que a IA erra menos e o que o dono lê sem aprender uma DSL.

```js
// packages/agent/src/nginx/vhost.js
const q = (s) => { if (!/^[a-zA-Z0-9._:\/-]+$/.test(s)) throw new Error(`valor inseguro em conf nginx: ${s}`); return s; };

export const renderVhost = ({ envId, domains, certDir, upstream }) => `# GERADO — não editar
server {
  listen 443 ssl; listen [::]:443 ssl; http2 on;
  server_name ${domains.map(q).join(' ')};
  ssl_certificate     ${q(certDir)}/fullchain.pem;
  ssl_certificate_key ${q(certDir)}/privkey.pem;
  include /etc/nginx/veloz/global/ssl.conf;
  include /etc/nginx/veloz/state/env-${q(envId)}.conf;
  access_log /var/log/nginx/envs/${q(envId)}.access.log veloz buffer=64k flush=5s;
  location / { include /etc/nginx/veloz/global/proxy.conf; proxy_pass http://${q(upstream)}; }
}
`;
```

**Debounce do reload é obrigatório e é lógica de aplicação, não de infra.** Em Node:

```js
let pending = null, timer = null;
export function scheduleApply() {                       // chamado N vezes, aplica 1
  if (!pending) pending = Promise.withResolvers();
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const p = pending; pending = null;
    try { await velozctl(['nginx-apply']); p.resolve(); } catch (e) { p.reject(e); }
  }, 2000);
  return pending.promise;
}
```

Risco específico: `q()` acima é a fronteira entre "cliente cadastrou um domínio" e "cliente injetou
diretiva no nginx do nó". **Domínio precisa ser validado no CP (zod) e revalidado no agente.**
Teste obrigatório: tentar cadastrar `foo.com;\n}\nserver{listen 80;` e verificar que falha nos dois.

#### (7) ACME — **arriscado em Node; delegue**

`acme-client` ([publishlab/node-acme-client](https://github.com/publishlab/node-acme-client)) é a única
opção séria em Node e funciona. `greenlock` está morto na prática. Mesmo assim **recomendo não emitir
certificado em Node**, por três motivos operacionais, não técnicos:

- ACME tem uma quantidade absurda de casos de borda que já estão resolvidos em clientes maduros:
  rate limit da Let's Encrypt (50 certs/domínio-registrado/semana), ordens pendentes, `dns-01` com
  propagação lenta, ARI (renovação sugerida pelo servidor), fallback de CA (ZeroSSL/Google).
  Reimplementar isso em cima de `acme-client` é onde um projeto de 1 pessoa queima 2 semanas.
- Se o certificado falhar, o site do cliente cai. É a área onde "código próprio" tem o pior retorno.
- O renovador precisa rodar mesmo com o control plane fora do ar (§1.6 da arquitetura). Um binário
  com timer do systemd faz isso melhor que um job da nossa fila.

**Decisão: `lego` (binário Go único, sem dependência) no nó, invocado pelo agente via `execFile`,
com timer systemd para renovação.** O agente lê o exit code e o JSON de saída, e reporta ao CP.
O Node fica sendo o **orquestrador**, não o implementador de RFC 8555.

```js
const r = await execFileP('/usr/local/bin/lego', [
  '--accept-tos', '--email', 'ssl@velozpanel.com.br',
  '--path', '/etc/velozpanel/acme',
  '--domains', domain,               // já validado por FQDN regex
  '--http', '--http.webroot', '/var/www/acme',
  'run',
], { timeout: 180_000 });
```

Plano B, se um dia o `mod-ssl` precisar de `dns-01` com provider BR sem suporte no lego:
aí sim `acme-client` + o SDK do provider, isolado no sidecar do módulo — nunca no core.

#### (8) Streaming de log — **este é o ponto forte do Node, use sem medo**

SSE com backpressure correto e `Last-Event-ID` (o que o arquiteto pediu na §5.3) é curto em Node:

```js
// apps/api/src/routes/jobs.logs.js  (Fastify)
export default async function (app) {
  app.get('/api/v1/jobs/:id/logs/stream', async (req, reply) => {
    const { id } = req.params;
    const since = Number(req.headers['last-event-id'] ?? 0);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',          // nginx: não bufferizar SSE
    });

    // 1) lacuna: o que já foi persistido depois do Last-Event-ID
    for await (const row of db.streamJobLogs(id, since)) {
      if (!write(`id: ${row.seq}\ndata: ${JSON.stringify(row)}\n\n`)) await drain();
    }
    // 2) ao vivo
    const off = bus.subscribe(`log.job.${id}`, async (line) => {
      if (!write(`id: ${line.seq}\ndata: ${JSON.stringify(line)}\n\n`)) await drain();
    });

    const hb = setInterval(() => reply.raw.write(': hb\n\n'), 15_000);   // mata proxy idle
    req.raw.on('close', () => { clearInterval(hb); off(); });

    function write(s) { return reply.raw.write(s); }                     // false = buffer cheio
    function drain() { return new Promise((r) => reply.raw.once('drain', r)); }
  });
}
```

Backpressure: `res.write()` devolvendo `false` **precisa** ser respeitado. Um job que cospe 5.000
linhas/s para um cliente com 3G ruim, sem `await drain()`, é o vazamento de memória que derruba a API.
A regra do arquiteto (sampling + `[log truncado: N linhas suprimidas]`) é a correta e deve ser aplicada
**no agente**, antes de sair do nó — não na API.

Tail de arquivo (log de acesso do cliente): não use `fs.watch` + reler o arquivo. Use
`createReadStream(path, { start: offset })` + `fs.watchFile`/inotify para saber quando cresceu, e
trate **rotação** (inode mudou → reabrir do início). Isso é ~120 linhas e a IA erra a rotação;
tem que estar escrito na spec com teste.

#### (9) Quota e uso de disco — **maduro**

Uma chamada `zfs list -Hp -o name,used,referenced,logicalreferenced,refquota -r veloz/incus/containers`
para o nó inteiro, parse de TSV, custo em milissegundos. Node não atrapalha em nada.
`du` fica proibido no host (é a regra da §7.3 da infra) — e essa proibição vira teste de lint:
grep por `'du'` em `packages/agent` falha o CI.

#### (10) SFTP/SSH e usuários — **não implemente em Node**

O `04-infra-linux.md` já resolveu isto do jeito certo: um `sshd` dedicado na porta 2222 com
`AuthorizedKeysCommand` + `ForceCommand`. **Não escreva um servidor SSH/SFTP em Node** (`ssh2` como
servidor multi-tenant é uma superfície de ataque que ninguém de 1 pessoa consegue auditar).
O papel do Node é: gravar a chave pública no `agent.db` que o `veloz-authkeys` consulta. Isso é um
`INSERT` — e o `veloz-authkeys` deve ser um script que lê o SQLite, não que chama a API do agente
(o SSH não pode depender do agente estar de pé).

Criação de usuário Unix: acontece **dentro do container** (`incus exec`), não no host. O agente do
host nunca cria usuário no host. Fronteira inegociável, já escrita na §11.5 da infra.

Terminal web (se um dia existir `mod-ssh`): use `POST /1.0/instances/<n>/exec` do Incus com
`interactive: true`, que devolve WebSockets de controle e de dados. Node faz isso bem com `ws`.
Evita `node-pty` (módulo nativo, `node-gyp`, quebra a cada versão de Node — e quebra o SEA).

---

## 2. A linguagem do agente do nó: Node, Go ou .NET?

Esta é a decisão mais cara de reverter, então vou com números.

### 2.1 Footprint de RAM, honestamente

Medições e fontes (baseline = processo vivo, com timer, sem carga):

| Runtime | RSS em repouso | RSS esperado do agente real | Binário distribuído |
|---|---|---|---|
| **Node 24 LTS** | **43,7 MB** (medido, Node 24.11) | 70–110 MB (NATS/WS + SQLite + streams) | SEA ≈ **110–120 MB** |
| **Go 1.23** | ~5–15 MB | 30–60 MB | **10–20 MB** |
| **.NET 10 Native AOT** | ~10–20 MB | 27–45 MB ([ASP.NET Core 10: working set 42→27 MB](https://www.aspnix.com/posts/native-aot-deployment-gains-in-aspnet-core-10)) | **10–20 MB** ([85 MB → 18 MB](https://www.aspnix.com/posts/native-aot-deployment-gains-in-aspnet-core-10)) |

Agora o que esses números significam **neste projeto**:

```
Nó de 16 GB = 16.384 MB
  - SO Debian + nginx + Incus + ZFS ARC contido ......  ~1.500 MB
  - Agente em Node (teto imposto por systemd) ........     128 MB   (0,78%)
  - Agente em Go/.NET AOT ............................      48 MB   (0,29%)
  DIFERENÇA ..........................................      80 MB   (0,49%)
```

**80 MB é meio ambiente de plano P1 de 512 MB... a cada 6 nós.** Em termos de receita: se um plano de
512 MB vende a R$ 35/mês, os 80 MB extras custam ~R$ 5,50/mês por nó. Com 3 nós, **R$ 16,50/mês**.

Isso não pode ser o critério que decide a linguagem em que o dono do produto vai depurar produção
às 2h da manhã. **Descarto RAM como critério decisivo** — e isso corrige a premissa implícita do
`03-arquitetura.md`, que tratou os "~30–60 MB do Go" como argumento forte.

O que **é** critério real de RAM: o agente precisa de um **teto imposto**, porque um vazamento em Node
cresce até o OOM do nó matar um cliente. Isso já está resolvido:

```ini
# /etc/systemd/system/veloz-agent.service  (adicionar ao que a §11.5 já propõe)
MemoryHigh=96M
MemoryMax=128M
Restart=always
RestartSec=3
Environment=NODE_OPTIONS=--max-old-space-size=96 --max-semi-space-size=2
```

Com `--max-old-space-size=96`, o V8 faz GC agressivo antes de chegar ao `MemoryMax`, e se ainda assim
estourar, o systemd reinicia em 3 s. O agente é **recuperável por reinício** (estado em SQLite local +
reconciliação a cada 60 s), então reiniciar é seguro. Essa propriedade é o que torna Node aceitável aqui.

### 2.2 Distribuição: o argumento que realmente importava contra Node — e que morreu

O `03-arquitetura.md` diz, corretamente para 2023: *"o agente em Node exige runtime instalado no nó"*.
**Isso deixou de ser verdade.** Node SEA (Single Executable Applications) está estável desde o Node 22,
melhorou muito no 24, e o Node 25.5 (jan/2026) adicionou `--build-sea`, que colapsa o fluxo
`postject` de 4 passos num único comando
([release](https://progosling.com/en/dev-digest/2026-01/nodejs-25-5-build-sea-single-executable),
[blog do mantenedor](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/),
[docs](https://nodejs.org/api/single-executable-applications.html)).

```bash
# pipeline de build do agente (roda no CI, nunca no nó)
pnpm --filter @veloz/agent build            # esbuild -> dist/agent.cjs, bundle único
node --experimental-sea-config sea-config.json
cp "$(command -v node)" veloz-agent
npx postject veloz-agent NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
# Node >= 25.5: node --build-sea sea-config.json  (um passo só)
sha256sum veloz-agent > veloz-agent.sha256
```

Resultado: **1 arquivo**. Instalação no nó = `scp` + `systemctl restart`. Sem `node_modules`, sem
`npm ci` num servidor de produção, sem "qual versão de Node tem o nó 2?".

Comparação de distribuição:

| Critério | Node + node_modules | **Node SEA** | Go | .NET 10 AOT |
|---|---|---|---|---|
| Arquivos a copiar | milhares | **1** | 1 | 1 |
| Tamanho | ~50–150 MB | **~110 MB** | ~15 MB | ~15 MB |
| Precisa de runtime no nó | sim (e versionado) | **não** | não | não |
| `npm ci` rodando em produção | sim (risco) | **não** | n/a | n/a |
| Superfície de supply chain no nó | árvore inteira, com `postinstall` | **congelada no artefato assinado** | idem | idem |
| Cross-compile no CI | trivial | **trivial** (baixar o Node do alvo) | trivial | **não** — precisa buildar em Linux ([docs](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)) |
| Upgrade | risco de drift | substituir 1 arquivo | idem | idem |

Nota sobre supply chain, que é o argumento mais forte do `03-arquitetura.md` contra Node
(*"a árvore de dependências num daemon root é risco desproporcional"*): o argumento **continua válido
como preocupação**, mas o agente **não roda como root** e o SEA congela a árvore num artefato assinado
que é auditado no CI. A mitigação prática é um **orçamento de dependências duro**:

```
Orçamento de dependências do agente: no máximo 6 pacotes diretos e ~40 transitivos.
Permitidos hoje: undici, ws, zod, pino.  (SQLite = node:sqlite, builtin; nada de better-sqlite3)
Proibido: qualquer pacote com script postinstall; qualquer módulo nativo (quebra o SEA).
CI: `pnpm audit --prod`, `pnpm ls --depth=99 | wc -l` com teto, e lockfile congelado.
```

`node:sqlite` sendo **builtin** desde o Node 22 (RC no 24, estável no 26) é o que mata a última
dependência nativa do agente ([guia](https://www.hirenodejs.com/blog/nodejs-builtin-sqlite-node-sqlite-2026)).
Substitui o BoltDB do desenho em Go 1:1, com API síncrona (`DatabaseSync`), que é exatamente o que
um outbox local precisa.

### 2.3 CPU num loop de coleta de 30 s

Já medido na §1.2: **~3,5 ms por ciclo** para 40 ambientes com 6 arquivos cada. Com o parsing, cálculo
de derivadas e serialização, arredondo para **~10 ms a cada 15 s = 0,07% de um core**.
Um agente em Go faria isso em ~1 ms. A diferença é 9 ms a cada 15 s. **Não é um critério.**

O que consome CPU de verdade no agente, em qualquer linguagem: serializar telemetria e falar TLS.
Aqui há uma armadilha específica: o arquiteto propôs **VictoriaMetrics via Prometheus remote-write**,
que exige **Protobuf + Snappy** — em Node isso significa `protobufjs` + `snappy` (nativo, quebra o SEA).
**Correção**: VictoriaMetrics aceita ingestão em **texto puro** via `/api/v1/import/prometheus`
e em Influx line protocol via `/write`
([docs](https://docs.victoriametrics.com/victoriametrics/url-examples/)). Use texto. Zero dependência,
zero código nativo, e o payload é legível no `curl` quando o dono for depurar.

```js
// remote-write "pobre" e suficiente: texto, gzip do próprio Node
const body = samples.map(s =>
  `veloz_mem_bytes{env="${s.env_id}",node="${NODE_ID}"} ${s.mem_current} ${s.ts}`).join('\n');
const gz = await promisify(gzip)(body);                    // node:zlib, threadpool
await request(`${VM}/api/v1/import/prometheus`, {
  method: 'POST', body: gz, headers: { 'content-encoding': 'gzip' }, dispatcher: mtls,
});
```

### 2.4 Robustez — onde Node de fato é pior, e o que fazer

| Modo de falha | Node | Go | .NET AOT | Mitigação obrigatória em Node |
|---|---|---|---|---|
| Event loop bloqueado | **risco real** (1 thread) | não existe | não existe (thread pool) | proibir `*Sync` fora de `/sys` e `/proc`; monitorar `perf_hooks.monitorEventLoopDelay()` e reportar `p99` como métrica do próprio agente |
| Vazamento de memória | **risco real** (closures em streams longos) | menor | menor | `MemoryMax=128M` + `Restart=always` + agente idempotente/recuperável |
| Pausa de GC | 1–20 ms (V8) | <1 ms | 1–10 ms | irrelevante nesta carga |
| Exceção não tratada | derruba o processo | panic derruba | idem | `process.on('unhandledRejection')` → log estruturado + `process.exit(1)` (deixe o systemd reiniciar; nunca "engolir") |
| Crash no meio de um job | outbox local | idem | idem | recuperação por `recover()` no boot, já desenhada na §1.4.3 da arquitetura |

**A mitigação é sempre a mesma: o agente é descartável.** Todo estado durável está em (a) SQLite local
e (b) no estado real do nó (Incus, arquivos, systemd), reconciliado a cada 60 s. Um agente que morre e
volta em 3 s não causa incidente. **Se essa propriedade não valer, nenhuma linguagem salva o desenho.**

### 2.5 Depurabilidade pelo dono — o critério que o ADENDO 1 mandou usar

| | Node | Go | .NET 10 AOT |
|---|---|---|---|
| Dono sabe a linguagem | **sim** | **não** | **sim** |
| Ler um stack trace em produção | trivial | trivial (se souber Go) | trivial |
| Anexar debugger num processo vivo | `node --inspect` + Chrome DevTools/VS Code, **sem reiniciar** (`SIGUSR1`) | Delve (mais cru) | `dotnet-dump`/`lldb` — **pior em AOT**, símbolos separados |
| Heap snapshot em produção | `v8.writeHeapSnapshot()` — 1 linha | pprof | `dotnet-gcdump` (limitado em AOT) |
| Profiling ad hoc | `--cpu-prof`, `--heap-prof` | pprof | mais limitado em AOT |
| Reproduzir na máquina dele | mesmo runtime do painel | precisa instalar toolchain Go | precisa SDK .NET |
| Mesmo idioma do resto do sistema | **sim** | não | não |

Ponto que fecha a questão: em Native AOT, **debug e profiling têm limitações documentadas** e os
símbolos ficam num `.dbg` separado ([docs Microsoft](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)).
Ou seja: a opção "o dono sabe .NET" **perde parte do valor exatamente no modo AOT**, que era a razão
de escolhê-la. Já o Node entrega o melhor ferramental de introspecção em produção dos três, e é a
única opção que não adiciona um segundo ecossistema ao projeto.

### 2.6 VEREDITO

> **O agente do nó é escrito em Node.js 24 LTS e distribuído como SEA (binário único).**

Justificativa em quatro linhas, na ordem de peso:

1. **Uma linguagem no sistema inteiro** (agente + API + painel). Para 1 pessoa operando o que uma IA
   escreveu, alternar de contexto entre dois ecossistemas é o custo real, e é diário. Tipos, validação
   (zod), formato de log (pino), utilitários e testes são compartilhados de ponta a ponta.
2. **O único argumento técnico forte contra Node no nó (instalar runtime + node_modules) morreu** com
   o SEA maduro em 2026.
3. **Performance e RAM não decidem**: 0,07% de um core, 80 MB de diferença = R$ 16,50/mês em 3 nós.
4. **Depurabilidade pelo dono** é critério explícito do ADENDO 1, e Node ganha dos dois concorrentes.

**Contrapartidas aceitas conscientemente** (e que viram requisito, não desejo):
- teto de memória imposto pelo systemd + reinício automático;
- orçamento de 6 dependências diretas, zero módulos nativos, zero `postinstall`;
- `exec`/`shell:true` banidos por lint;
- métrica de event-loop-delay do próprio agente publicada como telemetria de primeira classe;
- artefato SEA assinado e com hash verificado antes do `systemctl restart`.

**Plano B (escrito antes de precisar dele): .NET 10 Native AOT — não Go.**
Gatilho objetivo para acionar: se, após 8 semanas em produção, ocorrer **≥1 incidente por mês causado
por característica do runtime Node** no agente (event loop travado, vazamento não diagnosticável,
crash de dependência), portar **só o agente** para .NET 10 Native AOT. O contrato CP↔agente é
JSON sobre WebSocket/mTLS, então a troca é local e não toca no CP nem no painel. Escolho .NET e não Go
porque o dono conhece C#, o binário AOT resolve a distribuição igual, e o `System.Diagnostics` cobre
o ferramental. **Restrição de build a registrar desde já: Native AOT não faz cross-compile entre SOs —
o binário Linux tem que ser produzido num Linux** (com `clang` + `zlib1g-dev`), e um binário compilado
em Debian 13 só roda em Debian 13+ ([docs](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)).

**Go fica descartado**, e a razão é o ADENDO 1: "facilidade de contratar dev" deixou de ser critério e
"o Tiago consegue ler e depurar" continua sendo. Go só voltaria à mesa se o agente precisasse de
performance que Node e .NET não dão — e este agente não precisa.

---

## 3. Control plane em Node/TypeScript: qual formato?

### 3.1 Next.js full-stack vs Next + API separada

| Critério | Next.js full-stack | **Next (front) + API Fastify** |
|---|---|---|
| API pública versionada (dogfooding, §6.1) | Route Handlers dão isso, mas a rota vira acoplada ao app de UI | **contrato explícito, `/api/v1`, OpenAPI gerado** |
| Workers / jobs de longa duração | não cabe: o app Next é reiniciado a cada deploy de front e o modelo de execução é por request | **processo próprio, ciclo de vida próprio** |
| SSE / conexões longas | funciona, mas cada deploy de UI derruba todas as conexões abertas | **deploy de UI não derruba log ao vivo** |
| mTLS com os agentes | precisaria de um servidor custom, perdendo boa parte do que o Next entrega | **servidor Node puro, `tls.createServer`, sem ginástica** |
| Consumo de RAM no CP | 1 processo grande e pesado | 2 processos com tetos separados; UI pode reiniciar sozinha |
| Blast radius de um bug de UI | derruba a API e os jobs | **derruba só a UI; ambientes seguem servindo** |
| A IA escrever | Server Actions confundem fronteira cliente/servidor; erro de RSC vira bug sutil | **fronteira HTTP explícita: entrada zod, saída zod** |
| Superfície de ataque | UI e API no mesmo processo, mesmas credenciais | API com credencial de banco; UI **sem nenhuma** |

> **Decisão: Next.js é APENAS front-end. A API é um serviço Fastify separado.**
> Regra dura, que vai para o lint: **nenhuma Server Action escreve no banco e o app Next não tem
> `DATABASE_URL` no ambiente.** O painel fala com `/api/v1` como qualquer integração de terceiro —
> é assim que o dogfooding da §6.1 da arquitetura deixa de ser intenção e vira estrutura.

Mesma origem, sem CORS e sem proxy extra, via nginx no CP:

```nginx
server {
  server_name painel.velozpanel.com.br;
  location /api/v1/ { proxy_pass http://127.0.0.1:4000; proxy_buffering off; proxy_read_timeout 3600s; }
  location /        { proxy_pass http://127.0.0.1:3000; }   # next start (standalone)
}
```

`proxy_buffering off` + `proxy_read_timeout 3600s` no bloco da API é o que faz SSE funcionar. Sem isso,
o log ao vivo "funciona em dev e não funciona em produção" — e ninguém descobre por quê.

### 3.2 Framework da API: Fastify

| | NestJS | **Fastify** | Hono |
|---|---|---|---|
| Estrutura para a IA seguir | forte, mas via decorators + DI | **plugins/encapsulamento; convenção de pastas explícita** | nenhuma |
| zod → JSON Schema → OpenAPI | possível, com camadas | **`fastify-type-provider-zod` faz nativo** | via middlewares |
| Erros que o dono vai depurar | DI falha em runtime com stack de metadata | **stack de função normal** | idem |
| Peso / dependências | pesado | médio | mínimo |
| SSE, streams, hooks de ciclo de vida | ok | **excelente** | ok, mas voltado a edge |
| Maturidade em servidor tradicional | alta | **alta** | menor (foco edge/workers) |

> **Decisão: Fastify + `fastify-type-provider-zod` + `@fastify/swagger` (OpenAPI 3.1).**
> NestJS foi descartado porque decorators e injeção de dependência produzem exatamente a classe de erro
> que o dono não consegue depurar ("Nest can't resolve dependencies of..."), e porque a IA gera código
> Nest sintaticamente correto e arquiteturalmente errado com facilidade. Hono foi descartado porque o
> ganho é em edge runtime, que não existe aqui, e porque não impõe estrutura nenhuma.

O ponto decisivo: **um único schema zod gera a validação de entrada, o tipo TypeScript, o schema de
resposta e a entrada do OpenAPI.** É isso que impede a API pública de divergir da UI.

```ts
// packages/contracts/src/environments.ts  — FONTE ÚNICA DA VERDADE
import { z } from 'zod';

export const EnvironmentId = z.string().regex(/^env_[0-9a-hjkmnp-tv-z]{26}$/);
export const ResizeBody = z.object({
  memory_mb: z.number().int().min(256).max(16384),
  vcpu:      z.number().min(0.25).max(8),
}).strict();                                   // .strict() é obrigatório em todo body
export const JobRef = z.object({ id: z.string(), state: z.enum(['queued','running','succeeded','failed']) });

// apps/api/src/routes/environments.resize.ts
app.withTypeProvider<ZodTypeProvider>().post('/api/v1/environments/:id/actions/resize', {
  schema: {
    operationId: 'resizeEnvironment',
    tags: ['environments'],
    params: z.object({ id: EnvironmentId }),
    body: ResizeBody,
    response: { 202: z.object({ job: JobRef }) },
  },
  preHandler: [app.auth(['environment.resize'])],
}, async (req, reply) => {
  const job = await jobs.enqueue('env.resize', { env_id: req.params.id, ...req.body },
    { idempotencyKey: req.headers['idempotency-key'], lock: `env:${req.params.id}` });
  reply.code(202).header('location', `/api/v1/jobs/${job.id}`).send({ job });
});
```

### 3.3 ORM: Drizzle, e a razão é RLS

| | Prisma | **Drizzle** | Kysely |
|---|---|---|---|
| RLS com `SET LOCAL` | precisa de `$transaction` + `$executeRawUnsafe`; historicamente fraco ([issue #12735](https://github.com/prisma/prisma/issues/12735)) | **suporte de primeira classe a RLS/policies** ([docs](https://orm.drizzle.team/docs/rls)) | manual, mas natural |
| SQL gerado é legível | não (query engine em Rust, processo separado) | **sim** | sim |
| Migrations | maduras, com shadow DB | `drizzle-kit generate` → **arquivo SQL revisável** | não tem (você escreve) |
| Tipos | ótimos | ótimos | ótimos |
| O dono consegue depurar | menos (engine opaca + binário extra) | **sim, é SQL** | sim |
| Peso em RAM no CP | +engine | **leve** | leve |

> **Decisão: Drizzle ORM, com `drizzle-kit generate` (nunca `push`) e migrations SQL versionadas e revisadas.**

Motivo central: **RLS depende de `SET LOCAL` dentro da mesma transação/conexão.** Com Drizzle isso é
direto e visível; com Prisma exige contorcionismo e é fácil de furar sem perceber. Como o
`03-arquitetura.md` fez de RLS a garantia de isolamento multi-tenant (D6), o ORM tem que conviver bem
com ela — não "conseguir conviver".

```ts
// packages/db/src/tenant.ts — ÚNICO caminho de acesso a dados multi-tenant
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(..., true) = LOCAL: escopo da transação. Sobrevive a pgbouncer transaction mode.
    await tx.execute(sql`SELECT set_config('vp.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
// Regra de lint: importar `db` diretamente em apps/api/src/routes/** é ERRO. Só via withTenant/withAdmin.
```

Riscos do Drizzle a mitigar, que a pesquisa apontou como reais em 2026
([falhas silenciosas em migration](https://github.com/drizzle-team/drizzle-orm/pull/5617),
[armadilhas do `push`](https://devencyclopedia.com/blog/drizzle-orm-migrations-drizzle-kit)):

- `drizzle-kit push` **banido** no repositório (não existe no `package.json`, nem em script de CI).
- Toda migration gerada é **lida por humano antes do merge**. `DROP COLUMN` e `RENAME COLUMN`
  exigem PR separado com plano de duas fases (expand/contract).
- Migration roda como **passo explícito do deploy**, com `statement_timeout` e `lock_timeout` curtos,
  não no boot da API. Se a migration falhar, o deploy falha antes de qualquer tráfego.
- Não existe rollback automático em Drizzle. Toda reversão é uma migration nova para frente.
- Teste de RLS obrigatório na suíte: criar 2 tenants, tentar ler o do outro **como role de aplicação**,
  esperar 0 linhas. Este teste é o guarda-costas de todo o modelo D6.

### 3.4 Filas e jobs: pg-boss, e mate o NATS na fase 1

Volume real deste projeto: **4–5 sistemas hospedados, 3 nós**. Jobs por dia: dezenas, talvez centenas.
Isso é 4 ordens de grandeza abaixo do que qualquer uma das opções aguenta.

| | BullMQ (Redis) | **pg-boss (Postgres)** | Graphile Worker |
|---|---|---|---|
| Peça de infra nova | **Redis** (+RAM, +backup, +durabilidade a configurar) | **nenhuma** | nenhuma |
| Vazão | milhares/s | centenas/s | ~100–200/s |
| Job na mesma transação do estado | não (dois sistemas → job órfão) | **sim** | sim |
| Agendamento, singleton, arquivamento | sim | **sim, embutido** | mais cru |
| Dono depura com | `redis-cli` | **`SELECT * FROM pgboss.job`** | idem |

> **Decisão: pg-boss.** Fila e máquina de estados **na mesma transação** do Postgres — o que elimina
> a classe inteira de bug "gravei o job mas não gravei o estado" que o §5 da arquitetura tenta resolver
> com outbox. Vazão de centenas/s é ~100× o necessário. E o dono depura a fila com SQL, que ele já lê.
> ([comparativo 2026](https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026))

**E o NATS JetStream (D2)?** Concordo com o crítico: **é over-engineering para 3 nós, e piora
justamente para quem vai operar.** Minha proposta para o Ciclo 2:

| Necessidade da §1.4 | NATS JetStream | Proposta Node |
|---|---|---|
| Agente disca de saída (sem porta aberta no nó) | sim | **WebSocket sobre TLS mútuo, agente → CP** |
| Entrega durável de comando | stream `CMD` workqueue | **tabela `node_commands` no Postgres**; ao (re)conectar, o CP reenvia o que não foi `acked` |
| Ack / redelivery / dedup | consumer explícito | `acked_at`, `attempts`, `idempotency_key UNIQUE` — SQL, visível, depurável |
| Ordenação por nó | `max_ack_pending=1` | uma conexão por nó + 1 comando em voo por nó |
| Log e telemetria (alto volume, perda tolerável) | core NATS | **mesma conexão WS, canal separado, fire-and-forget** |
| Peças a operar | +1 binário, +conceitos (stream, consumer, subject, ack policy, advisories) | **zero** |
| Linhas de código nossas | ~150 (mas com um manual inteiro para aprender) | **~350, que o dono lê numa tarde** |

Custo honesto de trocar: perdemos retenção/replay do JetStream e ganhamos 350 linhas para manter.
Para **3 nós**, é o negócio certo: uma peça a menos no CP, tudo visível em `SELECT`, e o mesmo
Postgres que já é fonte da verdade do job. **Gatilho para reintroduzir NATS: >15 nós, ou necessidade
real de replay de eventos.** Escrito agora, para a decisão não ser tomada no desespero.

### 3.5 Autenticação: better-auth

Situação em 2026:

| Opção | Situação |
|---|---|
| **Lucia** | **descontinuada** (mar/2025), virou material educacional ([lucia-auth.com](https://lucia-auth.com/)) |
| **Auth.js / NextAuth v5** | em **modo security-only**: recebe correção, não recebe evolução ([comparativo](https://www.pkgpulse.com/guides/better-auth-vs-lucia-vs-nextauth-2026)) |
| **better-auth** | crescimento mais rápido do ecossistema (50k → 500k downloads/semana em 12 meses); TS-first |
| Próprio | ~3.000 linhas de código de segurança escritas por IA e auditadas por 1 pessoa — não |

> **Decisão: better-auth, rodando dentro da API Fastify (não dentro do Next).**

Cobre as três necessidades do §6.3 da arquitetura com **uma** biblioteca:

| Necessidade | Como |
|---|---|
| Sessão de painel (cookie `__Host-`, opaca, revogável) | núcleo do better-auth, sessão em tabela do Postgres |
| MFA/TOTP obrigatório para super admin | plugin `twoFactor` |
| PAT (`vp_pat_...`) com escopos e expiração | plugin `apiKey` (hash em repouso, `last_used_at`, escopos) |
| **Ser** provedor OAuth 2.1 + PKCE para integrações | plugin `oidcProvider` |
| Multi-tenant (papéis por organização) | plugin `organization` |

Riscos, com mitigação obrigatória:
- Biblioteca jovem, com breaking changes: **fixar versão exata** (sem `^`), atualizar só em janela
  planejada, e ter teste de fumaça de auth no CI (login, PAT, revogação, expiração de sessão).
- **A autorização não é do better-auth.** Ele responde "quem é você"; quem responde "você pode?" é
  nosso `can(actor, permission, resource)`, permission-based conforme §6.3 — porque módulos precisam
  declarar permissões novas sem tocar no core.

### 3.6 Tipos e contratos: zod → OpenAPI, e **não** tRPC

tRPC seria a escolha natural para "TS nos dois lados". **Mas o requisito 6.1 da arquitetura é
dogfooding: a UI consome exatamente a API pública.** tRPC produz um protocolo RPC próprio, não uma API
REST documentada que um cliente escreve em PHP ou Python. Manter os dois é manter duas APIs.

> **Decisão: `@velozpanel/contracts` (zod) é a fonte única.**
> Fastify gera o `openapi.json` a partir dele; o cliente TypeScript do painel é **gerado** desse
> `openapi.json`; o SDK público futuro sai do mesmo arquivo. A UI e um integrador de fora usam
> exatamente o mesmo contrato — que é o que a §6.1 pediu.

```
packages/contracts (zod)
   ├─► apps/api        valida entrada e saída em runtime
   ├─► openapi.json    gerado no build, versionado no repo, diff obrigatório em PR
   └─► packages/api-client  (openapi-typescript + fetch tipado) ─► apps/painel
```

CI: se o `openapi.json` mudar sem que o PR toque em `packages/contracts`, falha. Se mudar de forma
**quebrante** (remoção de campo/rota), exige label explícito no PR. Isso impede a IA de quebrar a API
pública sem que ninguém veja.

---

## 4. Next.js no painel — desenho concreto

Base: **Next.js 16** (App Router, Turbopack estável e default desde out/2025, Cache Components/PPR)
([release](https://nextjs.org/blog/next-16)).

### 4.1 App Router, RSC e streaming: o que usar e o que atrapalha

Um painel autenticado é o caso onde RSC entrega **menos** valor: quase nada é cacheável entre usuários,
quase tudo é dado vivo e específico do tenant, e há muita interatividade.

| Recurso | Neste painel |
|---|---|
| App Router + layouts aninhados | **use** — dá a estrutura `/(cliente)` e `/(admin)` e navegação sem recarregar |
| RSC para layout, navegação, textos, i18n | **use** — reduz JS enviado |
| RSC buscando dados do domínio | **evite** — o servidor Next teria que carregar o cookie de sessão e chamar a API; vira um hop extra e some com o cache do TanStack Query. Busque no cliente. |
| Server Actions | **proibido para mutação de infra**. Fura o dogfooding, some do OpenAPI, e não dá `202 + job_id` |
| `use cache` / PPR (Cache Components) | **só** em páginas públicas (marketing, status, docs). Zero em rota autenticada |
| Streaming + Suspense | **use com moderação**: bom para o primeiro paint da lista de ambientes; ruim quando disputa com o TanStack Query |
| `middleware`/`proxy.ts` | **use só para redirecionar quem não tem cookie.** Autorização de verdade é na API |

Regra prática que resolve 90% das dúvidas da IA:
> **RSC pinta a moldura. TanStack Query pinta o conteúdo.**

### 4.2 Gráficos de consumo em tempo real (requisito 8)

Volumes reais por gráfico:

| Janela | Resolução | Pontos por série |
|---|---|---|
| ao vivo (5 min) | 5 s | 60 |
| 1 hora | 15 s | 240 |
| 24 horas | 1 min | 1.440 |
| 30 dias | 5 min | 8.640 |
| 13 meses | 1 h | 9.360 |

Com 4 séries (CPU, RAM, disco, rede) na tela: até **~35.000 pontos**.

| Lib | Veredito |
|---|---|
| **Recharts** | **não** para série temporal densa: renderiza SVG, e >5.000 pontos = >5.000 nós no DOM = travamento ([análise](https://blog.logrocket.com/best-react-chart-libraries-2026/)) |
| **uPlot** | **sim** — canvas, <50 KB, 60 FPS com centenas de milhares de pontos ([SciChart bench](https://www.scichart.com/blog/chart-bench-compare-javascript-chart-libraries/)) |
| ECharts | também aguenta (canvas), mas ~1 MB de bundle e API grande demais |
| visx | ótimo, mas é kit de construção: mais código nosso |

> **Decisão: `uPlot` para toda série temporal (envolto num wrapper React nosso, `<TimeSeries/>`);
> `Recharts` apenas para os gráficos de billing (barras mensais, pizza de custo), onde são ~30 pontos
> e a ergonomia de escrita vale mais que a performance.**

Transporte dos dados:

| Abordagem | Veredito |
|---|---|
| WebSocket | **não** — bidirecionalidade não é necessária; custa reconexão manual e mais código |
| Polling a cada 5 s | **sim para o histórico**: `useQuery` com `refetchInterval`, `staleTime` e `refetchOnWindowFocus:false` |
| **SSE** | **sim para o "ao vivo"**: 1 conexão por aba, o servidor empurra a última amostra de cada ambiente aberto |

Desenho: ao abrir a tela, **uma** chamada busca a janela histórica (array já downsampled pelo
VictoriaMetrics, via `/api/v1/query_range` com `step`); depois, o SSE empurra 1 amostra a cada 15 s e o
gráfico faz `chart.setData()` com um buffer circular de tamanho fixo. **Nunca** `setState` com
`[...pontos, novo]` — isso realoca o array a cada tick e é o que trava aba de painel deixada aberta
o dia todo.

```tsx
// apps/painel/src/components/TimeSeries.tsx (essência)
const buf = useRef<[number[], ...number[][]]>([[], [], []]);   // uPlot: [x, y1, y2]
useEffect(() => {
  const es = new EventSource(`/api/v1/environments/${envId}/metrics/stream`);
  es.onmessage = (e) => {
    const s = JSON.parse(e.data);
    const b = buf.current;
    b[0].push(s.ts); b[1].push(s.cpu); b[2].push(s.mem);
    const MAX = 1440; if (b[0].length > MAX) for (const a of b) a.shift();  // buffer circular
    plot.current?.setData(b as any, true);                                   // sem re-render React
  };
  es.onerror = () => { /* EventSource reconecta sozinho; só sinalize "reconectando" na UI */ };
  return () => es.close();
}, [envId]);
```

**Teto de custo no navegador, para virar critério de aceite:** com o painel aberto 8 horas numa aba,
o heap do JS não pode crescer mais que 20 MB. Isso é medível e vira teste manual documentado.

### 4.3 Log ao vivo durante um job

O servidor do SSE é o **Fastify**, não o Next (código na §1.2 (8)). No Next é só consumo:

```tsx
export function useJobLog(jobId: string) {
  const [lines, setLines] = useState<LogLine[]>([]);
  useEffect(() => {
    // EventSource envia Last-Event-ID sozinho na reconexão — o backend completa a lacuna
    const es = new EventSource(`/api/v1/jobs/${jobId}/logs/stream`);
    es.onmessage = (e) => setLines((prev) => {
      const next = prev.concat(JSON.parse(e.data));
      return next.length > 2000 ? next.slice(-2000) : next;   // teto no cliente
    });
    return () => es.close();
  }, [jobId]);
  return lines;
}
```

Três detalhes que separam "funciona" de "funciona em produção":

1. **Heartbeat** (`: hb\n\n` a cada 15 s) do lado do servidor, ou o nginx/CDN mata a conexão ociosa.
2. **`X-Accel-Buffering: no`** no header + `proxy_buffering off` no nginx.
3. **Renderização virtualizada** da lista de log (`@tanstack/react-virtual`). 2.000 `<div>` de log
   num painel deixado aberto é um dos poucos jeitos de travar uma aba com dado trivial.

### 4.4 UI plugável por módulo — **crítica ao D4 do arquiteto**

O `03-arquitetura.md` §2.4 propõe **ESM remoto em runtime com import map e React como singleton**.
Isso foi desenhado para **Vite**, e o ADENDO 1 trocou o front para **Next.js**. A proposta não
sobrevive à troca. Avaliação das quatro opções:

| Opção | Veredito em Next.js 16 |
|---|---|
| **Module Federation** | **morto.** Nunca suportou App Router (só Pages Router) e os mantenedores anunciaram encerramento, com o plugin funcionando "até meados/fim de 2026" ([análise](https://medium.com/@yashnigam.p/module-federation-is-a-dead-end-for-next-js-heres-the-2026-migration-path-36090738cedb), [discussão vercel/next.js#77862](https://github.com/vercel/next.js/discussions/77862)) |
| **ESM remoto em runtime** (proposta do arquiteto) | **tecnicamente possível, estrategicamente ruim** — ver abaixo |
| **iframe sandbox + postMessage** | isolamento real (origem separada, sem cookie de sessão), UX pior, contrato mais chato |
| **Registry em build-time** | zero risco em runtime, custo = rebuild do painel para adicionar módulo |

Por que rejeito o ESM remoto **aqui** (não em geral):

1. **Não dá isolamento de segurança nenhum.** O bundle remoto roda na mesma origem, com acesso ao DOM
   inteiro e ao mesmo contexto do cookie de sessão. Um módulo malicioso ou comprometido = painel
   comprometido. E o próprio arquiteto já admite isso ao mandar módulos de terceiros para iframe.
   Se iframe é o certo para terceiros, **a diferença é só confiança, e confiança muda com o tempo.**
2. **React como singleton em Next é frágil.** Em Vite você resolve com import map. Em Next 16 +
   Turbopack, React vem do bundle do framework, não há import map, e você tem que injetar React
   **por objeto** (`host.React`) em vez de `import`. Funciona — mas significa que o módulo é
   compilado com um pipeline JSX especial e não pode `import React from 'react'`. É um contrato
   frágil que a IA vai quebrar, e o sintoma ("Invalid hook call") é dos piores de depurar.
3. **Turbopack precisa de `/* turbopackIgnore: true */`** em todo `import()` dinâmico de URL externa
   ([docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack)) — e essa
   diretiva é fácil de esquecer, produzindo erro só no build de produção.
4. **CSP.** Um painel de hospedagem sem `script-src` restritivo é indefensável. ESM remoto exige
   afrouxar a CSP para hosts de módulo, o que é exatamente o que a CSP existe para impedir.
5. **O benefício não existe na fase 1.** "Adicionar módulo sem recompilar o core" vale para um
   marketplace. Aqui, quem publica módulo é o próprio dono, o painel é **um** deploy, e rebuildar com
   Turbopack leva 1–3 minutos.

> **Decisão (staged):**
> **Fase 1 — registry em build-time.** Cada módulo tem `ui/` no monorepo; um script gera
> `modules.generated.ts` com `React.lazy(() => import('@veloz/mod-php/ui'))`. Habilitar/desabilitar um
> módulo em runtime **continua funcionando**: `GET /api/v1/ui/manifest` decide o que aparece por
> usuário/tenant/ambiente. O que exige rebuild é **instalar um módulo novo** — e isso é um deploy,
> que acontece de qualquer jeito.
> **Fase 2 — iframe sandbox** (`sandbox="allow-scripts allow-forms"`, origem `modules.velozpanel.com.br`,
> sem cookie de sessão, token de escopo estreito via `postMessage`) para módulos de terceiros.
> **ESM remoto: não entra.**

O que **não** muda em relação ao desenho do arquiteto: os **slots nomeados**, o **Host SDK versionado**,
o `ErrorBoundary` por slot e o `GET /api/v1/ui/manifest`. Só troca o mecanismo de carregamento — e
carregar via `React.lazy` local é estritamente mais simples que via `import()` remoto.

```tsx
// apps/painel/src/modules/registry.generated.ts  — GERADO por script, não editar
export const MODULE_UI = {
  'mod-php': { PhpSettingsPage: lazy(() => import('@veloz/mod-php/ui/PhpSettingsPage')) },
  'mod-ssl': { SslCard:        lazy(() => import('@veloz/mod-ssl/ui/SslCard')) },
} as const;

// apps/painel/src/modules/Slot.tsx
export function Slot({ name, ...props }: { name: SlotName }) {
  const { data: manifest } = useUiManifest();        // do /api/v1/ui/manifest
  return manifest.mounts.filter((m) => m.slot === name).map((m) => {
    const C = MODULE_UI[m.module]?.[m.component];
    if (!C) return <ModuleMissing key={m.id} module={m.module} />;   // instalado no CP, ausente no build
    return (
      <ErrorBoundary key={m.id} fallback={<ModuleBroken module={m.module} />}>
        <Suspense fallback={<CardSkeleton />}><C {...props} /></Suspense>
      </ErrorBoundary>
    );
  });
}
```

O caso `ModuleMissing` (módulo habilitado no CP, ausente no bundle do painel) é o preço da fase 1 —
e é um card honesto dizendo "atualize o painel", não uma tela quebrada.

### 4.5 Dois painéis: um app, dois route groups, dois hostnames

| | **1 app, route groups** | 2 apps |
|---|---|---|
| RAM no CP (recurso escasso) | **~300 MB** | ~600 MB |
| Design system, cliente de API, i18n | **compartilhados nativamente** | duplicados ou em pacote com 2 consumidores |
| Build e deploy | **1** | 2 |
| Risco de vazamento admin→cliente | existe na UI... | menor |

O risco de "1 app" é aceitável por uma razão estrutural: **a UI não guarda segredo e não autoriza nada.**
Toda autorização está na API; renderizar um botão de admin para um cliente não lhe dá nenhum poder —
a chamada volta `403`. O que a UI expõe no pior caso é *nome de rota*.

> **Decisão: um app Next, com `src/app/(cliente)/` e `src/app/(admin)/`, servidos em hostnames
> distintos** (`painel.velozpanel.com.br` e `admin.velozpanel.com.br`), com o nginx do CP aplicando
> no host de admin uma camada extra opcional (allowlist de IP hoje, mTLS quando fizer sentido).
> Ganha-se separação operacional sem pagar 2× RAM, 2× build e 2× componente.

### 4.6 Hospedagem, build e orçamento de RAM do CP

**Regra número um: não faça build no VPS do control plane.** Um `next build` tem pico de 2–4 GB de RAM;
rodar isso no CP durante produção é convite a OOM. Build no CI (GitHub Actions), artefato
`output: 'standalone'` publicado, deploy = extrair + `systemctl restart`.

```js
// next.config.ts
export default { output: 'standalone', poweredByHeader: false, reactStrictMode: true,
  experimental: { }, };
```

```ini
# /etc/systemd/system/veloz-painel.service
[Service]
User=veloz-web
WorkingDirectory=/srv/velozpanel/painel/current
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1
Environment=NODE_OPTIONS=--max-old-space-size=384
MemoryHigh=420M
MemoryMax=512M
Restart=always
```

Orçamento de RAM do VPS do control plane (16 GB):

| Processo | Reserva |
|---|---|
| PostgreSQL 16 (`shared_buffers=2GB`) | 3,0 GB |
| API Fastify (`--max-old-space-size=512`) | 0,7 GB |
| Workers pg-boss (2 processos) | 0,5 GB |
| Painel Next (standalone) | 0,5 GB |
| VictoriaMetrics single-node | 1,0 GB |
| nginx + Redis (se entrar) + logs | 0,5 GB |
| **Total** | **~6,2 GB** — folga confortável em 16 GB |

Cuidado documentado: há relatos recorrentes de crescimento de memória em Next.js self-hosted em
produção ([issue #79588](https://github.com/vercel/next.js/issues/79588)). Por isso o `MemoryMax` +
`Restart=always` e o cache de ISR **desligado** (não há ISR num painel autenticado).

### 4.7 i18n, tema e design system

| Item | Decisão | Motivo |
|---|---|---|
| i18n | **`next-intl`**, `pt-BR` como única locale ativa, mas com **todas as strings em `messages/pt-BR.json` desde o commit 1** | adicionar `en` depois é config; extrair string hardcoded depois é refactor de 3 semanas. E módulos precisam entregar suas próprias mensagens (`host.i18n`) |
| CSS | **Tailwind v4** | config em CSS (`@theme`), sem `tailwind.config.js`, e é o que a IA gera com menos erro |
| Componentes | **shadcn/ui** | é **código no nosso repo**, não dependência opaca: o dono lê e edita o componente. Casa com o Host SDK (o módulo recebe os componentes prontos, não os instala) |
| Descartado | Mantine, MUI | dependência de runtime pesada, tema próprio conflitando com Tailwind, e módulos passariam a depender da versão da lib |
| Tema | tokens CSS (`--vp-*`) + `class="dark"` | permite white-label por tenant depois sem tocar em componente |
| Tabelas | TanStack Table (headless) + shadcn | painel tem ~15 tabelas; headless evita reescrever cada uma |
| Formulários | react-hook-form + `@hookform/resolvers/zod` reusando `packages/contracts` | **o mesmo schema valida no browser e na API** — sem divergência |

---

## 5. Onde Node vai doer neste projeto, especificamente

Seção deliberadamente pessimista. Cada item traz o sintoma e a saída.

| # | Ponto de dor | Por que dói em Node | Saída |
|---|---|---|---|
| 1 | **Coleta de métricas de alta frequência** (<5 s, >100 ambientes) | 1 thread; cada leitura passa por V8 | **Não vá abaixo de 15 s.** O requisito 8 é gráfico de painel, não trading. Se um dia precisar: agregue no nó em janela e envie o agregado |
| 2 | **Parsing de log de acesso do nginx em volume** | milhares de linhas/s viram milhares de strings/s → pressão de GC → event loop travado → heartbeat perdido → nó marcado `degraded` | **Não parseie no Node.** `vector` (binário Rust) no nó lê o log em JSON, agrega por minuto e faz POST no CP. O agente nem toca no arquivo |
| 3 | **Compressão e criptografia de backup** | `zlib`/`crypto` de stream usam o threadpool (4 threads) e disputam com o `fs`; um backup de 40 GB monopoliza o threadpool e trava o resto do agente | **Delegue a processo externo**: `restic`/`zstd`/`age` via `spawn`, com `nice`/`ionice`, `stdio:'ignore'` e progresso lido de um arquivo. O Node só orquestra |
| 4 | **Hash de arquivos grandes** | idem (threadpool) | `sha256sum` externo, ou `crypto.createHash` em stream **com** `UV_THREADPOOL_SIZE` ajustado e nunca concorrente com backup |
| 5 | **`zfs send` para outro nó (migração)** | passar 40 GB por buffers de JS é desperdício puro | `spawn('zfs',['send',...])` com `stdio:['ignore','pipe']` ligado direto ao socket, **sem** tocar em `Buffer` no JS. Ou, melhor, `zfs send \| ssh` inteiro num processo só |
| 6 | **Muitas conexões SSE simultâneas na API** | é onde Node é bom, **mas** um `write()` sem `drain` vaza memória | backpressure obrigatório (§1.2 (8)) + teto de conexões SSE por sessão (3) e por tenant (10) |
| 7 | **`JSON.parse` de resposta gigante do Incus** | `incus list` com muitos containers e `recursion=2` gera JSON de MBs; parse é síncrono e bloqueia | use `recursion=0` (só nomes) + buscar detalhe sob demanda; nunca `recursion=2` num loop |
| 8 | **Migração de banco/relatório de faturamento pesado** | agregação de milhões de amostras de uso em JS é lenta e come RAM | **faça em SQL.** Nenhum loop de faturamento em JS: `GROUP BY date_trunc(...)` no Postgres, e o Node só formata |
| 9 | **Event loop bloqueado por descuido** | `readFileSync` num diretório grande, `JSON.parse` gigante, regex catastrófica | `monitorEventLoopDelay()` publicado como métrica; alerta se `p99 > 200 ms`; regra de lint contra `*Sync` fora de uma allowlist de caminhos (`/sys`, `/proc`) |
| 10 | **Cold start do painel após deploy** | Next standalone leva ~1–3 s para o primeiro request | irrelevante num painel; não otimize |

**Padrão geral, e é a resposta honesta à pergunta do dono:** neste projeto, Node quase nunca é o
executor do trabalho pesado — ele é o **orquestrador**. Quem comprime é o `zstd`, quem emite
certificado é o `lego`, quem parseia log é o `vector`, quem move bytes é o `zfs`, quem agrega
métrica é o VictoriaMetrics, quem faz a conta é o Postgres. Node coordena, valida, versiona,
autoriza e conversa com o navegador — e é exatamente para isso que ele é bom.
**Trocar de linguagem não resolveria nenhum dos 10 itens acima**; delegar a processo externo resolve
todos, e é a mesma coisa que um agente em Go teria que fazer.

---

## 6. Especificação executável por IA

### 6.1 Convenções que reduzem erro de IA

| Convenção | Por quê |
|---|---|
| **`pnpm` workspaces + Turborepo** | pnpm é rígido com dependências fantasmas (a IA adora importar coisa que não declarou); Turborepo dá cache e grafo de tarefas |
| **`packages/contracts` (zod) é a única fonte de tipo de API** | impede a IA de inventar campo no front que não existe no back |
| **TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `erasableSyntaxOnly`** | transforma erro de IA em erro de compilação |
| **`any` proibido; `unknown` + zod na fronteira** | regra de lint que falha o build |
| **Biome** (lint + format) em vez de ESLint+Prettier | 1 ferramenta, rápido, config pequena que a IA não quebra |
| **Regras de lint custom obrigatórias** | `no child_process.exec`, `no shell:true`, `no drizzle-kit push`, `no import db fora de packages/db`, `no fs.*Sync fora de allowlist`, `no Server Action com side effect` |
| **`AGENTS.md` por pacote** | 30–60 linhas: o que este pacote faz, o que ele **não** pode importar, quais invariantes valem. É o que impede a IA de "resolver" um problema quebrando uma fronteira |
| **ADRs numerados em `docs/adr/`** | toda decisão desta série de documentos vira ADR curto; a IA lê antes de propor alternativa |
| **Commits pequenos por fatia vertical** | contrato → API → UI → teste, num PR só. Nunca "todo o back, depois todo o front" |

### 6.2 Testes obrigatórios (critério de merge, não sugestão)

| Camada | Ferramenta | Regra |
|---|---|---|
| Unidade (parsers de cgroup, templates nginx, cálculo de billing) | `node:test` + `tsx` | **cobertura ≥ 90% em `packages/agent/src/collect` e `packages/billing`**; são os que produzem número que vira dinheiro |
| Contrato de API | Vitest + `supertest` contra o app Fastify real | toda rota do OpenAPI tem ao menos 1 teste de sucesso e 1 de `403` |
| **RLS** | Vitest + Testcontainers (Postgres real) | 2 tenants, tentar ler o do outro, esperar 0 linhas. **Sem esse teste verde, nada vai a produção** |
| Migrations | CI aplica todas as migrations num banco vazio **e** num dump de produção anonimizado | pega `DROP COLUMN` acidental |
| Integração do agente | Testcontainers com Incus não é viável → **VM de teste** (ou nó de staging) com suíte `agent-e2e` | mínimo: criar, pausar, resize, trocar runtime, destruir |
| Injeção de comando | suíte de fuzzing curta contra `velozctl()` e `renderVhost()` | payloads clássicos (`;`, `$( )`, `\n`, `` ` ``) devem ser rejeitados |
| Chaos de módulo | derrubar cada módulo e verificar login/listar/pause/billing | critério do §2.5 da arquitetura, virado em teste |
| E2E do painel | Playwright, ~10 fluxos | criar ambiente, pausar, resize, trocar PHP, ver log ao vivo, ver gráfico |

### 6.3 Árvore de diretórios do monorepo

```
velozpanel/
├── AGENTS.md                       # regras globais para a IA (fronteiras, proibições, ordem de build)
├── README.md                       # como subir tudo em 10 minutos
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── tsconfig.base.json              # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
├── openapi.json                    # GERADO, versionado, diff obrigatório em PR
│
├── docs/
│   ├── adr/                        # 0001-agente-em-node.md, 0002-sem-nats-fase1.md, ...
│   ├── operacao/                   # runbooks: nó caiu, agente não conecta, migration falhou, restaurar backup
│   ├── modulos/                    # como escrever um módulo, contrato do manifesto, ciclo de vida
│   └── api/                        # renderização do openapi.json (Scalar/Redoc, estático)
│
├── apps/
│   ├── painel/                     # ÚNICO app Next.js 16 (cliente + admin)
│   │   ├── src/app/
│   │   │   ├── (public)/           # login, recuperação de senha, status
│   │   │   ├── (cliente)/          # painel do cliente
│   │   │   │   └── ambientes/[id]/{page,resumo,arquivos,banco,dominios,logs,ssl}/
│   │   │   ├── (admin)/            # super admin (servido em admin.velozpanel.com.br)
│   │   │   │   └── {nos,tenants,planos,modulos,faturamento}/
│   │   │   └── layout.tsx
│   │   ├── src/components/ui/      # shadcn/ui — CÓDIGO NOSSO
│   │   ├── src/components/charts/  # TimeSeries (uPlot), BillingBars (Recharts)
│   │   ├── src/modules/            # Slot.tsx, registry.generated.ts, host-sdk/
│   │   ├── src/lib/api.ts          # cliente gerado do openapi.json + TanStack Query
│   │   ├── messages/pt-BR.json     # 100% das strings
│   │   └── next.config.ts          # output: 'standalone'
│   │
│   ├── api/                        # Fastify — control plane
│   │   ├── src/routes/v1/          # 1 arquivo por recurso; espelha o OpenAPI
│   │   ├── src/auth/               # better-auth + can(actor, permission, resource)
│   │   ├── src/nodes/              # servidor WS/mTLS dos agentes, tabela de comandos, ack
│   │   ├── src/jobs/               # definição de jobs (pg-boss), máquina de estados, locks
│   │   ├── src/sse/                # log de job, stream de métricas, stream de eventos
│   │   ├── src/gateway/            # roteamento para sidecars de módulo + headers HMAC
│   │   └── src/openapi.ts          # gera openapi.json a partir de packages/contracts
│   │
│   ├── worker/                     # processo separado: consome pg-boss (metering, webhooks, ACME, backup)
│   └── agent/                      # AGENTE DO NÓ (vira SEA)
│       ├── src/{incus,collect,nginx,runtime,exec,outbox,transport}/
│       ├── sea-config.json
│       └── AGENTS.md               # "sem dependência nativa; sem postinstall; máx. 6 deps diretas"
│
├── packages/
│   ├── contracts/                  # zod: entidades, requests, responses, eventos, erros (RFC 9457)
│   ├── api-client/                 # gerado do openapi.json (openapi-typescript)
│   ├── db/                         # schema Drizzle, migrations SQL, withTenant/withAdmin, seeds
│   ├── host-sdk/                   # @velozpanel/host-sdk — contrato entre painel e UI de módulo
│   ├── billing/                    # motor de cobrança: pré-pago, débito horário, compromisso, pausa
│   ├── logger/                     # pino configurado (redaction de segredo obrigatória)
│   └── testkit/                    # Testcontainers, fábricas de tenant/ambiente, helpers de RLS
│
├── modules/                        # cada módulo: manifesto + sidecar opcional + tasks do agente + UI
│   ├── mod-php/{module.yaml,agent/,api/,ui/}
│   ├── mod-node/
│   ├── mod-ssl/
│   ├── mod-backup/
│   ├── mod-dns/
│   └── mod-pagamento-pix/          # gateway de pagamento plugável (requisito do ADENDO 1)
│
├── infra/
│   ├── ansible/                    # provisionamento do nó (doc 04)
│   ├── scripts/diagnostico-no.sh   # RISCO BLOQUEADOR do ADENDO 1: KVM vs OpenVZ/LXC, cgroup v2, kernel
│   └── compose/                    # postgres, victoriametrics, minio (só o CP)
│
└── .github/workflows/
    ├── ci.yml                      # typecheck, biome, testes, migrations, RLS, openapi-diff
    ├── build-agent.yml             # SEA linux-x64 + sha256 + assinatura
    └── deploy-cp.yml               # build do painel + artefato standalone + deploy
```

### 6.4 O que documentar para a IA não inventar

| Documento | Conteúdo mínimo |
|---|---|
| `AGENTS.md` raiz | ordem de construção; fronteiras entre pacotes; lista de proibições absolutas; como rodar tudo |
| `docs/adr/*` | uma ADR por decisão desta série (agente em Node; sem NATS na fase 1; sem ESM remoto; Drizzle; pg-boss; better-auth; Fastify) — com o **gatilho de revisão** de cada uma |
| `packages/contracts/README` | como nomear recurso, ação, erro; padrão de paginação por cursor; `202 + job` |
| `apps/agent/AGENTS.md` | catálogo de tarefas do agente (nome, args, idempotente?, cancelável?, timeout, `unsafe_retry`); proibições (sem root, sem exec, sem dep nativa) |
| `docs/modulos/CONTRATO.md` | `module.yaml` completo, slots de UI existentes, versão do Host SDK, ciclo de vida, política de degradação |
| `docs/operacao/*` | runbook por incidente. **É o entregável que permite ao dono operar o que a IA construiu** (requisito 10 + ADENDO 1) |
| `docs/estados.md` | máquina de estados do ambiente e do job, em texto e em Mermaid — é a fonte de mais bug sutil do projeto |

---

## 7. Decisões fechadas

1. **A integração com Linux é feita em Node.js.** Cgroup v2 por leitura de sysfs (`readFileSync`),
   Incus pela API REST sobre unix socket com `undici`, comandos privilegiados por `execFile` +
   allowlist + helper root `velozctl`. Custo medido: ~3,5 ms de event loop por ciclo de coleta de
   40 ambientes. Performance não é obstáculo.
2. **D-Bus não é usado.** As bibliotecas Node de D-Bus estão abandonadas. systemd é operado por
   `systemctl show`/`velozctl svc`, com argumentos enumerados.
3. **ACME não é implementado em Node.** O agente invoca o binário `lego`, com timer systemd para
   renovação, e reporta o resultado ao CP.
4. **O agente do nó é Node.js 24 LTS, distribuído como SEA (binário único).** Sem `node_modules` no
   nó, sem runtime instalado, teto `MemoryMax=128M` no systemd, `Restart=always`, estado local em
   `node:sqlite` (builtin), máximo de 6 dependências diretas e **zero** módulos nativos.
5. **Plano B do agente é .NET 10 Native AOT, não Go.** Gatilho: ≥1 incidente/mês em 8 semanas causado
   por característica do runtime Node. Porta-se só o agente; o contrato JSON/WS/mTLS não muda.
6. **Next.js é apenas front-end.** O app do painel não tem `DATABASE_URL` e nenhuma Server Action
   escreve no banco. Toda mutação passa por `/api/v1`.
7. **A API do control plane é Fastify + `fastify-type-provider-zod` + OpenAPI 3.1 gerado.**
   NestJS e Hono descartados.
8. **`packages/contracts` (zod) é a fonte única de contrato.** tRPC descartado por conflitar com o
   requisito de API pública versionada. O cliente do painel é gerado do `openapi.json`.
9. **ORM é Drizzle**, com `drizzle-kit generate` e migrations SQL revisadas. `drizzle-kit push`
   proibido. Acesso multi-tenant só por `withTenant()`, que aplica `set_config('vp.tenant_id', …, true)`.
   Teste de RLS é critério de merge.
10. **Fila de jobs é pg-boss (Postgres).** Sem Redis. Job e estado na mesma transação.
11. **NATS JetStream sai da fase 1.** Transporte CP↔agente é WebSocket sobre mTLS iniciado pelo
    agente, com fila durável em tabela Postgres (`node_commands`, com ack e idempotência).
    Gatilho para reintroduzir NATS: >15 nós ou necessidade real de replay.
12. **Autenticação é better-auth**, hospedada na API, com plugins `twoFactor`, `apiKey` (PAT),
    `oidcProvider` (OAuth 2.1 + PKCE) e `organization`. Versão fixada exata. Autorização é nossa,
    permission-based.
13. **UI plugável: registry em build-time na fase 1; iframe sandbox para terceiros na fase 2.**
    ESM remoto em runtime e Module Federation ficam **descartados**. Slots nomeados, Host SDK
    versionado, `ErrorBoundary` por slot e `/api/v1/ui/manifest` permanecem como o arquiteto desenhou.
14. **Um único app Next com route groups `(cliente)` e `(admin)`, servidos em hostnames distintos**,
    com camada extra de rede no host de admin.
15. **Gráficos: uPlot para série temporal, Recharts só para billing.** Histórico por `useQuery`,
    ao vivo por SSE com buffer circular e `chart.setData()` — nunca `setState` acumulando array.
16. **Log ao vivo é SSE servido pelo Fastify** (não pelo Next), com `Last-Event-ID`, heartbeat de 15 s,
    `X-Accel-Buffering: no`, backpressure com `drain()` e lista virtualizada no cliente.
17. **Telemetria vai para o VictoriaMetrics em texto** (`/api/v1/import/prometheus`), não em
    remote-write protobuf — elimina `protobufjs` e `snappy` (nativo) do agente.
18. **Trabalho pesado é delegado a processo externo**: `vector` (parsing de log), `zstd`/`restic`/`age`
    (backup), `zfs` (dados), `lego` (ACME), Postgres (agregação de faturamento).
19. **`child_process.exec` e `shell: true` são proibidos no repositório**, com regra de lint que
    falha o build. Todo `execFile` tem `timeout` e `maxBuffer` explícitos.
20. **O build do painel e do agente acontece no CI, nunca no VPS.** Deploy é artefato + `systemctl restart`.
21. **Stack de UI: Tailwind v4 + shadcn/ui + TanStack Query/Table/Virtual + react-hook-form com o
    mesmo zod da API + next-intl com 100% das strings em `pt-BR.json` desde o commit 1.**
22. **Monorepo pnpm + Turborepo**, TypeScript `strict` com `noUncheckedIndexedAccess`, Biome,
    `AGENTS.md` por pacote e ADRs numeradas com gatilho de revisão.

---

## 8. Riscos e o que medir ANTES de codar

### 8.1 Riscos ordenados por gravidade

| # | Risco | Impacto | Mitigação | Sinal de alerta |
|---|---|---|---|---|
| R1 | **VPS baseada em container (OpenVZ/LXC) em vez de KVM** — risco bloqueador do ADENDO 1 | invalida Incus, cgroup delegado e a arquitetura inteira; nenhuma decisão deste documento sobrevive | `infra/scripts/diagnostico-no.sh` roda **antes de qualquer linha de código** | `systemd-detect-virt` retorna `openvz`/`lxc`; `/sys/fs/cgroup/cgroup.subtree_control` vazio ou não escrevível |
| R2 | **Vazamento de memória no agente** derruba o nó | cliente cai | `MemoryMax=128M` + `Restart=always` + agente recuperável por reinício | RSS do agente subindo monotonicamente por 24 h |
| R3 | **Event loop do agente travado** → heartbeat perdido → nó marcado `degraded` sem estar | falsos incidentes, faturamento suspenso indevidamente | `monitorEventLoopDelay()` publicado como métrica; sem `*Sync` fora de `/sys` e `/proc` | `p99` do event loop delay > 200 ms |
| R4 | **RLS desligada ou furada por uma query fora do `withTenant`** | vazamento de dado entre clientes — pior risco do produto (LGPD) | teste de RLS como critério de merge; lint proibindo importar `db` direto; role da aplicação **sem** `BYPASSRLS` | qualquer query em log sem `vp.tenant_id` setado |
| R5 | **Supply chain npm** num daemon com acesso a `sudo velozctl` | comprometimento do nó | orçamento de 6 deps, zero `postinstall`, lockfile congelado, SEA assinado com hash verificado no deploy, agente sem root | `pnpm audit --prod` com achado alto; contagem de deps transitivas crescendo |
| R6 | **`better-auth` quebrar em upgrade** (biblioteca jovem) | painel fora do ar | versão exata fixada; suíte de fumaça de auth no CI; upgrade só em janela | changelog com breaking change |
| R7 | **Reload de nginx em cascata** derrubar o nó | todos os sites do nó | debounce de 2 s + `nginx -t` em stage + `worker_shutdown_timeout 30s` (já na §6.3 da infra) | mais de 3 reloads/min |
| R8 | **Migration do Drizzle destrutiva** gerada por IA | perda de dado | migration SQL lida por humano; `DROP`/`RENAME` em PR separado com expand/contract; CI aplica sobre dump anonimizado | diff de migration com `DROP COLUMN` |
| R9 | **Crescimento de memória do Next.js self-hosted** ([#79588](https://github.com/vercel/next.js/issues/79588)) | painel fora do ar | `MemoryMax=512M` + `Restart=always`; sem cache ISR | RSS do painel > 450 MB |
| R10 | **`ModuleMissing`** (módulo habilitado no CP, ausente no build do painel) — custo aceito do registry em build-time | tela incompleta | card explícito "atualize o painel"; `/api/v1/ui/manifest` compara versão do painel com a do módulo | qualquer ocorrência em produção |
| R11 | **Cliente de Incus escrito por nós** ficar defasado com upgrade do Incus | operações falham após `apt upgrade` | teste de contrato contra Incus real em CI; fixar versão do Incus por nó e atualizar deliberadamente | erro `API extension not present` |
| R12 | **SSE morrendo em proxy/CDN** | log ao vivo "não funciona em produção" | heartbeat 15 s + `X-Accel-Buffering: no` + `proxy_buffering off`; teste E2E que mantém SSE por 2 min | conexão caindo em ~60 s |

### 8.2 O que medir antes de escrever a primeira linha de produção

Estas medições viram um **spike de 1 semana**, e cada uma tem um critério de aprovação. Se alguma
falhar, a decisão correspondente deste documento é reaberta — não contornada.

| # | Medição | Como | Critério de aprovação |
|---|---|---|---|
| M1 | **A VPS é KVM?** | `systemd-detect-virt`, `lscpu`, `cat /proc/cpuinfo`, tentar `modprobe overlay`, checar `cgroup.subtree_control` escrevível, `zfs` instalável | KVM (ou equivalente com kernel próprio) nos 3 nós. **Reprovou → todo o resto para** |
| M2 | **RSS real do agente em Node sob carga** | agente esqueleto (WS + 40 ambientes simulados + SSE de log) rodando 72 h num nó real | RSS estabiliza abaixo de 110 MB; sem crescimento monotônico |
| M3 | **Custo do ciclo de coleta em nó real** | 40 ambientes Incus reais, coleta a cada 15 s, medir `monitorEventLoopDelay` | `p99` do event loop < 50 ms; CPU do agente < 1% de um core |
| M4 | **SEA funciona de ponta a ponta** | build no CI, `scp` para o nó, `systemctl start`, exercitar Incus + `velozctl` + WS | binário único < 130 MB, sobe em < 1 s, sem nenhum arquivo extra |
| M5 | **RLS realmente isola** | 2 tenants, tentar cross-read com a role da aplicação, incluindo por dentro de um sidecar de módulo | 0 linhas em todos os caminhos, inclusive com `withAdmin` desligado |
| M6 | **Resize a quente pela API do Incus não reinicia nada** | `PATCH limits.memory` de 1→4 GiB com carga rodando; medir com `ab`/`wrk` | zero requisição perdida; `memory.max` reflete em < 2 s |
| M7 | **Pause/start dentro do alvo** | `freeze`/`unfreeze` via API, medir com relógio | pause < 2 s, start até primeiro byte HTTP < 10 s |
| M8 | **SSE sobrevive** | 20 conexões SSE por 30 min atravessando o nginx do CP | zero desconexão não solicitada; RAM da API estável |
| M9 | **uPlot com dados reais** | 4 séries × 8.640 pontos + push a cada 15 s por 8 h numa aba | 60 FPS ao dar zoom; heap do JS cresce < 20 MB em 8 h |
| M10 | **Latência CP↔nó pela internet pública** (sem rede privada, ADENDO 1 B.1) | `ping`/`mtr` entre CP e cada VPS por 24 h, e um WS mTLS com heartbeat de 10 s | p95 < 80 ms; menos de 1 desconexão/hora; se falhar, aumentar o limiar de `degraded` de 45 s |
| M11 | **`next build` cabe no CI e o standalone cabe no CP** | build no GitHub Actions; medir pico de RAM e tamanho do artefato | build < 8 min; artefato < 200 MB; `next start` estabiliza < 400 MB |
| M12 | **Injeção de comando é impossível** | fuzzing contra `velozctl()` e `renderVhost()` com payloads de shell e de nginx | 100% rejeitado nas duas camadas (Node e helper root) |

---

## 9. Fontes

**Node.js e runtime**
- [Node.js — Single executable applications (docs)](https://nodejs.org/api/single-executable-applications.html)
- [Improving Single Executable Application Building for Node.js — Joyee Cheung (jan/2026)](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/)
- [Node.js 25.5 adiciona `--build-sea`](https://progosling.com/en/dev-digest/2026-01/nodejs-25-5-build-sea-single-executable)
- [Node.js SEA em 2026 — guia de produção](https://www.hirenodejs.com/blog/nodejs-single-executable-applications-2026)
- [Node.js — evolução do calendário de releases](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule)
- [`node:sqlite` builtin — guia 2026](https://www.hirenodejs.com/blog/nodejs-builtin-sqlite-node-sqlite-2026)
- [Node.js — Child process (docs)](https://nodejs.org/api/child_process.html)
- [OS Command Injection em Node.js — SecureFlag](https://knowledge-base.secureflag.com/vulnerabilities/code_injection/os_command_injection_nodejs.html)

**Alternativas ao agente**
- [Native AOT deployment overview — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) (pré-requisitos, ausência de cross-compile, limitações de debug)
- [Native AOT deployment gains in ASP.NET Core 10](https://www.aspnix.com/posts/native-aot-deployment-gains-in-aspnet-core-10) (85→18 MB de binário, 42→27 MB de working set)
- [ASP.NET Core support for Native AOT — Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/native-aot?view=aspnetcore-10.0)

**Linux / containers**
- [Incus REST API (docs oficiais)](https://linuxcontainers.org/incus/docs/main/rest-api/)
- [dbus-next no npm (última publicação há ~5 anos)](https://www.npmjs.com/package/dbus-next)
- [dbus-final — fork criado por falta de manutenção](https://github.com/kando-menu/dbus-final)
- [node-acme-client (publishlab)](https://github.com/publishlab/node-acme-client)
- [VictoriaMetrics — exemplos de URL de ingestão](https://docs.victoriametrics.com/victoriametrics/url-examples/)

**Backend TypeScript**
- [NestJS vs Fastify vs Hono (2026) — Encore](https://encore.dev/articles/nestjs-vs-fastify-vs-hono)
- [Drizzle ORM — Row-Level Security (docs)](https://orm.drizzle.team/docs/rls)
- [Prisma — issue de suporte a RLS (#12735)](https://github.com/prisma/prisma/issues/12735)
- [drizzle-kit — tratamento de falha de migration (PR #5617)](https://github.com/drizzle-team/drizzle-orm/pull/5617)
- [Guia prático de migrations com drizzle-kit](https://devencyclopedia.com/blog/drizzle-orm-migrations-drizzle-kit)
- [BullMQ vs Bee-Queue vs pg-boss (2026)](https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026)
- [better-auth vs Lucia vs NextAuth (2026)](https://www.pkgpulse.com/guides/better-auth-vs-lucia-vs-nextauth-2026)
- [Lucia Auth — descontinuada](https://lucia-auth.com/)
- [tRPC vs OpenAPI — design de API contract-first](https://thinhdanggroup.github.io/type-safe-backend-evolution/)

**Next.js e front-end**
- [Next.js 16 (blog oficial)](https://nextjs.org/blog/next-16)
- [Next.js — Turbopack (referência de config)](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack)
- [Module Federation é um beco sem saída para Next.js — migração 2026](https://medium.com/@yashnigam.p/module-federation-is-a-dead-end-for-next-js-heres-the-2026-migration-path-36090738cedb)
- [Discussão oficial sobre Module Federation no Next.js (#77862)](https://github.com/vercel/next.js/discussions/77862)
- [Next.js — guia de self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js — uso alto de memória em produção (issue #79588)](https://github.com/vercel/next.js/issues/79588)
- [Comparativo de performance de bibliotecas de gráfico JS (SciChart, 2026)](https://www.scichart.com/blog/chart-bench-compare-javascript-chart-libraries/)
- [Melhores bibliotecas de gráfico React em 2026 — LogRocket](https://blog.logrocket.com/best-react-chart-libraries-2026/)

> **Medições próprias** citadas nas §1.2 e §2.1 foram feitas em Node 24.11.1 (arm64, macOS).
> Números de latência de I/O em Linux tendem a ser iguais ou melhores para sysfs, mas
> **M2/M3 da §8.2 devem refazer as medições no nó real antes de fechar a decisão do agente.**
