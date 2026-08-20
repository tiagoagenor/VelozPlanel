# Instalar do zero — até o primeiro cliente hospedado

> **Tempo total:** de 3 a 5 horas na primeira vez, das quais boa parte é espera.
> **Pré-requisito de leitura:** [10-COMO-FUNCIONA.md](10-COMO-FUNCIONA.md).
> **Aviso:** este é o procedimento do sistema **quando ele estiver construído**. Hoje ele é
> especificação. Cada comando aqui precisa ser executado por você ao menos uma vez antes de valer.

## Índice das etapas

| Etapa | O que é | Tempo |
|---|---|---|
| 0 | Antes de gastar dinheiro: aprovar os servidores | 30 min |
| 1 | Domínios e DNS da plataforma | 20 min |
| 2 | Control plane (o cérebro) | 40 min |
| 3 | Primeiro acesso e configuração básica | 20 min |
| 4 | Primeiro nó | 40 min |
| 5 | Módulos obrigatórios | 30 min |
| 6 | Meio de pagamento | 20 min |
| 7 | Planos e preços | 20 min |
| 8 | Testes que valem por tudo | 60 min |
| 9 | Primeiro cliente | 20 min |
| 10 | Antes de dormir tranquilo | 30 min |

---

## Etapa 0 — Antes de gastar dinheiro (30 min)

**Regra número um deste projeto: nenhum servidor entra na plataforma sem passar no diagnóstico.**

Se a VPS for baseada em container (OpenVZ, LXC, Virtuozzo) em vez de virtualização real (KVM), **a
arquitetura inteira não funciona nela** — não dá para isolar cliente, nem limitar memória a quente,
nem rodar container. Isso não se descobre lendo o anúncio do provedor; descobre-se rodando o script.

**0.1** Peça ao provedor, por escrito, antes de pagar:

- virtualização **KVM** (não OpenVZ, não LXC, não "container VPS");
- **Debian 13** limpo;
- mínimo **8 GB de RAM** e **100 GB NVMe** (o ideal são os 16 GB que você já tem);
- **IPv4 dedicado**;
- **cota de banda mensal por escrito** — e o que acontece ao estourar (corta? cobra? quanto?).

**0.2** Suba a VPS de teste (a maioria dos provedores dá 24 h ou reembolso) e rode o diagnóstico:

```bash
scp Plan/scripts/veloz-node-doctor.sh root@<IP>:/tmp/
ssh root@<IP> 'bash /tmp/veloz-node-doctor.sh'
```

**0.3** Leia o resultado:

| Saída | Significa | Ação |
|---|---|---|
| `APTO` (exit 0) | serve | Contrate |
| `APTO COM RESSALVAS` (exit 2) | serve, com avisos | Leia cada `[ATENÇÃO]` e decida |
| `INAPTO` (exit 1) | **não serve** | **Não contrate.** Peça reembolso e troque de provedor |

Faça isso nas **duas VPS que você já tem** também, hoje, antes de qualquer outra coisa. É uma hora de
trabalho e é o único item que pode invalidar todos os outros.

---

## Etapa 1 — Domínios e DNS da plataforma (20 min)

Você precisa de um domínio próprio (exemplo: `velozpanel.com.br`) e destes nomes:

| Nome | Aponta para | Para quê |
|---|---|---|
| `painel.velozpanel.com.br` | IP do control plane | Onde o **cliente** entra |
| `admin.velozpanel.com.br` | IP do control plane | Onde **você** entra |
| `node-01.velozpanel.com.br` | IP do nó 1 | Facilita diagnóstico e o certificado do nó |
| `node-02.velozpanel.com.br` | IP do nó 2 | idem |
| `node-03.velozpanel.com.br` | IP do nó 3 | idem |
| `ns1` / `ns2` | — | > ⚠️ PENDENTE Ciclo 3 — só quando/se o DNS autoritativo entrar |

Também decida agora **qual nome o cliente vai apontar o site dele para**: normalmente um registro `A`
para o IP do nó onde o ambiente está. Anote — isso aparece na tela de domínio do cliente.

---

## Etapa 2 — Control plane (40 min)

**2.1** Contrate a VPS do cérebro. Ela **não hospeda cliente**: 4 vCPU, 8 GB RAM, 80 GB, Debian 13.
Rode o diagnóstico nela também (etapa 0).

**2.2** Prepare:

```bash
ssh root@<IP-CP>
apt update && apt full-upgrade -y
hostnamectl set-hostname cp-01
# sua chave SSH em /root/.ssh/authorized_keys, e senha desabilitada:
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
reboot
```

**2.3** Instale:

```bash
curl -fsSL https://github.com/<org>/velozpanel/releases/latest/download/install-cp.sh -o install-cp.sh
# CONFIRA o hash publicado na página do release antes de executar:
sha256sum install-cp.sh
sudo bash install-cp.sh --domain=velozpanel.com.br --admin-host=admin --panel-host=painel
```

O que ele instala: PostgreSQL 17, nginx, Node, VictoriaMetrics (métricas), a API, o painel, os
serviços do systemd, o firewall e os certificados HTTPS do painel.

**2.4** Inicialize:

```bash
sudo velozctl cp init
```

Ele pede: e-mail e senha do primeiro super admin (2FA é **obrigatório** — tenha o app de
autenticação na mão), e gera três segredos:

```
Chave da CA interna .......... /root/veloz-ca.key
Chave do cofre ............... /root/veloz-vault.key
Credencial de backup do CP ... /root/veloz-cp-backup.json
```

**2.5** ⚠️ **Faça isto agora, não depois.** Copie os três arquivos para **fora do servidor** (seu
gerenciador de senhas, e uma cópia num pendrive guardado fisicamente). Depois apague-os do servidor:

```bash
sudo shred -u /root/veloz-ca.key /root/veloz-vault.key /root/veloz-cp-backup.json
```

> **Se estes três segredos se perderem junto com o servidor, não há recuperação possível.**
> Nem por você, nem por ninguém. Não existe "esqueci minha senha" aqui.

**2.6** Configure o backup do próprio cérebro (isso é o que salva a empresa):

```bash
sudo velozctl cp backup configure \
  --endpoint=<endpoint-do-bucket> --bucket=veloz-cp-backup \
  --object-lock-days=30
sudo velozctl cp backup test        # grava e lê de volta. Precisa dizer OK
```

---

## Etapa 3 — Primeiro acesso (20 min)

**3.1** Abra `https://admin.velozpanel.com.br`, entre com o super admin, confirme o 2FA.

**3.2** `Admin → Configurações`, preencha:

- nome comercial, CNPJ, endereço, e-mail de suporte (vai nos e-mails automáticos);
- fuso horário: `America/Sao_Paulo`;
- moeda: BRL;
- e-mail de saída (remetente das notificações) e teste de envio;
- os canais de alerta para **você** (e-mail e/ou Telegram) — é por onde chegam os avisos de nó
  offline e disco cheio.

**3.3** `Admin → Segurança`: restrinja o acesso ao painel de admin ao seu IP, se ele for fixo. Se não
for, deixe aberto — o 2FA continua valendo. Não invente uma terceira opção.

---

## Etapa 4 — Primeiro nó (40 min)

**4.1** Prepare o servidor (o mesmo da etapa 2.2, com `hostnamectl set-hostname node-01`).

**4.2** No painel: `Admin → Nós → Adicionar nó`. Preencha nome (`node-01`), provedor, região,
**cota de banda mensal** e **custo mensal** — esses dois campos alimentam os alertas e o cálculo de
margem depois.

**4.3** O painel mostra um comando com um token de uso único, válido por 60 minutos. Copie e rode
**no servidor**:

```bash
curl -fsSL https://admin.velozpanel.com.br/install/node.sh | sudo bash -s -- \
  --token=vpe_<token> --cp=https://admin.velozpanel.com.br --name=node-01
```

O que acontece, em ordem: roda o diagnóstico (**se reprovar, aborta e não instala nada**), cria o
usuário de serviço, baixa o agente e confere o hash, gera a chave privada **no próprio servidor**,
troca o token por um certificado, sobe o serviço, e o nó aparece **online** no painel.

**4.4** Confirme no painel: o nó aparece com bolinha verde, versão do agente, RAM e disco livres, e
latência até o cérebro.

**Se não aparecer**, veja o runbook *"Nó não responde"* em [40-OPERACAO-DIARIA.md](40-OPERACAO-DIARIA.md).

> **Repare:** o nó nasce **drenado** — ele não recebe cliente ainda. Isso é proposital, e sai só na
> etapa 8.

---

## Etapa 4.5 — Rede privada WireGuard (opcional, 20 min)

Este passo é **opcional para nós com IP público** (deixa a gerência mais segura) e **obrigatório
para um servidor sem IP público** (ex.: máquina em casa) que você queira usar como nó.

**Quando pular:** se você só tem VPS com IP público e quer o caminho mais curto, pule — pode ligar a
rede depois sem refazer nada.

**4.5.1** No painel: `Admin → Módulos → Catálogo → mod-rede-wireguard → Instalar`. Escolha os nós.
Para cada nó, informe o **papel**:
- `público` — VPS com IP público (o padrão).
- `local` — servidor sem IP público, atrás de NAT (casa/escritório).

**4.5.2** O módulo, sozinho: instala o WireGuard, gera a chave **no nó** (a privada nunca sai de lá),
registra o nó no hub (o control plane), sobe a interface `wg0` e confirma o handshake.

**4.5.3** Confirme em `Admin → Rede`: o nó aparece com **handshake verde** e uma latência até o hub.
A partir daí, a conversa entre o painel e o nó passa a ir **por dentro da rede privada**.

**4.5.4 — Só para nó `local` (sem IP público):** escolha qual nó **público** vai ficar na frente dele
(o "fronte" da Opção A). Os sites daquele servidor local passam a ser servidos assim:
`visitante → nó público → rede WireGuard → servidor local`. Leia o aviso de banda antes: **todo o
tráfego do site sobe pela sua internet de casa** — use só para sites de baixo tráfego, dev ou teste.

> **MTU:** se o servidor local usa internet residencial (PPPoE), deixe a MTU em **1380** (o painel já
> sugere). Datacenter pode ficar em 1420.

Detalhes de topologia, segurança e Opção A: `especialistas/13-rede-wireguard.md`.

---

## Etapa 5 — Módulos obrigatórios (30 min)

`Admin → Módulos → Catálogo`. Instale **nesta ordem** (a ordem importa: uns dependem dos outros):

| # | Módulo | O que configurar |
|---|---|---|
| 1 | `mod-storage-s3` | Endpoint, bucket, chave de acesso, **object lock ligado** |
| 2 | `mod-node-base` | Nada — só escolher os nós. Instala Docker, nginx, quotas, firewall |
| 3 | `mod-metrics` | Nada. É o que faz os gráficos existirem |
| 4 | `mod-ssl` | E-mail para a Let's Encrypt. **Use o ambiente de teste (staging) primeiro** |
| 5 | `mod-backup` | Frequência (1 h), retenção (7 diários / 4 semanais / 3 mensais), destino |
| 6 | `mod-db-mysql` | Buffer pool: 256 MB num nó de 16 GB. Dump automático: a cada 60 min |
| 7 | `mod-runtime-php` | Versão padrão 8.3, extensões padrão |
| 8 | `mod-runtime-node` | Versão padrão 22 |
| 9 | `mod-ftp-sftp` | Nada |
| 10 | `mod-logs` | Retenção do log (7 dias é suficiente) |

Cada instalação segue o assistente de 4 passos e mostra o progresso ao vivo. Se algum falhar, o
sistema desfaz sozinho e mostra o erro — leia a mensagem e o runbook do módulo antes de tentar de novo.

**5.1** Quando o `mod-ssl` estiver funcionando com o CA de teste, troque para produção:

```
Admin → Módulos → mod-ssl → Configuração → Ambiente ACME: production
```

Fazer isso na ordem inversa é o erro mais caro desta etapa: a Let's Encrypt limita emissões, e se
você estourar o limite testando, fica **dias** sem conseguir emitir certificado para ninguém.

---

## Etapa 6 — Meio de pagamento (20 min)

**6.1** Crie a conta no PSP (Asaas, por exemplo) e pegue a chave de API do **sandbox**.

**6.2** `Admin → Módulos → mod-pagamento-asaas → Instalar`:
- Ambiente: `sandbox`
- Chave de API: cole (vai para o cofre, não fica no banco)
- Métodos: Pix ligado, boleto ligado, cartão desligado no começo
- Recarga mínima: R$ 20,00

**6.3** Configure o webhook **no painel do PSP**, apontando para a URL que o painel mostra na aba
*Visão geral* do módulo (algo como
`https://admin.velozpanel.com.br/api/v1/modules/pagamento-asaas/webhooks/webhook`). Cole também o
token do webhook nos segredos do módulo.

**6.4** Teste ponta a ponta, ainda em sandbox:

```
Admin → Módulos → mod-pagamento-asaas → Testar cobrança (R$ 1,00)
```

Precisa acontecer, nesta ordem: cobrança criada → QR Code do Pix aparece → você paga no sandbox →
webhook chega → **saldo creditado no extrato**. Se o saldo não creditar, **pare aqui**. Cobrança que
não credita é o pior bug possível.

**6.5** Só depois do teste passar, troque para `production` e refaça o teste com R$ 1,00 real.

---

## Etapa 7 — Planos e preços (20 min)

`Admin → Planos → Novo plano`. Comece com **três**, não com dez:

| Plano | RAM | vCPU | Disco | Sugestão de preço |
|---|---|---|---|---|
| Básico | 512 MB | 1 | 15 GB | > ⚠️ PENDENTE — depende do modelo econômico (item 2 da ordem de marcha do Ciclo 2) |
| Médio | 1 GB | 1 | 30 GB | > ⚠️ PENDENTE |
| Avançado | 2 GB | 2 | 60 GB | > ⚠️ PENDENTE |

O sistema converte o preço mensal em tarifa por minuto automaticamente e mostra "por hora" na tela.

Configure também: recarga mínima, avisos de saldo baixo (em 3 dias, 1 dia e zero), e o prazo entre
suspensão e remoção (sugestão: **suspende em 0, remove em 30 dias, com backup guardado por 60**).

---

## Etapa 8 — Os testes que valem por tudo (60 min)

**Nenhum cliente pagante antes destes três.** Não são opcionais e não são rápidos de fazer depois.

**8.1 Teste de fumaça do nó:**

```bash
velozctl node check node-01 --strict     # diagnóstico + saúde de cada módulo + relógio
velozctl node smoke node-01              # cria ambiente de teste, sobe, HTTP 200, apaga
```

**8.2 Teste de restauração** (o mais importante de todos):

1. Crie um ambiente de teste, instale um WordPress, escreva um post reconhecível.
2. Espere o backup rodar (ou force: `Ambiente → Backup → Fazer backup agora`).
3. **Apague o ambiente inteiro.**
4. Restaure a partir do backup, **cronometrando**.
5. O post precisa estar lá.

Anote o tempo. **Esse número é o que você pode prometer ao cliente**, e nada mais.

**8.3 Teste de isolamento entre clientes:**

1. Crie dois ambientes, de dois clientes diferentes.
2. Entre por SFTP no do cliente A e tente ler arquivo do cliente B — precisa falhar.
3. Conecte no banco do cliente A e tente ler o banco do cliente B — precisa falhar.
4. Faça o cliente A consumir toda a memória dele — o site do cliente B precisa continuar de pé.
5. Logado como cliente A, mude o número do ambiente na URL para o do cliente B — precisa dar erro
   de permissão, **não** mostrar a tela do outro.

**8.4 Teste de mudança a quente** (é o requisito 9 do seu briefing):
Com o ambiente sob carga, mude a memória de 1 GB para 2 GB pelo painel. Precisa valer **sem
reiniciar** o site.

**8.5** Só agora: `Admin → Nós → node-01 → Aceitar novos ambientes`.

**8.6** Repita as etapas 4, 5 e 8 para `node-02` e `node-03`.

---

## Etapa 9 — Primeiro cliente (20 min)

**9.1** `Admin → Clientes → Novo`, ou deixe ele se cadastrar sozinho pelo painel público.

**9.2** Peça para ele (ou faça junto, na primeira vez):
1. recarregar o saldo (R$ 20 já mostram o fluxo inteiro);
2. criar o ambiente escolhendo plano e linguagem;
3. apontar o domínio — o painel mostra exatamente qual registro criar e verifica quando propagar;
4. subir os arquivos por SFTP ou pelo Git;
5. conferir o HTTPS: precisa ser cadeado verde, sem aviso.

**9.3** Confira **você mesmo**, no dia seguinte: o extrato dele bate com o que ele usou? Se não
bater, é agora que se descobre — não daqui a seis meses com trinta clientes.

---

## Etapa 10 — Antes de dormir tranquilo (30 min)

Checklist final. Se algum item estiver `não`, você ainda não terminou.

- [ ] As três chaves da etapa 2.5 estão **fora do servidor**, em dois lugares
- [ ] Backup do banco do control plane rodando, e **restaurado ao menos uma vez** em teste
- [ ] Backup de ambiente restaurado com sucesso, com o tempo anotado
- [ ] Object lock ativo no bucket (teste: tente apagar um backup — precisa falhar)
- [ ] Alertas chegando no seu celular: teste desligando um nó de propósito
- [ ] Todos os nós passaram no `node check --strict`
- [ ] Teste de isolamento entre clientes passou nos 5 itens
- [ ] Meio de pagamento testado em produção com R$ 1,00 real
- [ ] Termos de Uso, Política de Privacidade e Política de Uso Aceitável **publicados**
      (sem a AUP você não tem respaldo para desligar quem atacar os outros)
- [ ] Você leu o [40-OPERACAO-DIARIA.md](40-OPERACAO-DIARIA.md) inteiro uma vez, sem pressa
- [ ] Você executou, sozinho, ao menos os runbooks 3 (disco cheio) e 5 (restaurar backup)

---

## Reconstruir tudo depois de um desastre

Se você perder o control plane e tiver os três segredos guardados:

```bash
# 1. VPS nova, mesma etapa 2.2 e 2.3
sudo bash install-cp.sh --domain=velozpanel.com.br --restore
# 2. Restaurar o banco a partir do bucket (pede a credencial de backup)
sudo velozctl cp restore --from=<data> --backup-key=/caminho/veloz-cp-backup.json
# 3. Restaurar a chave da CA e a do cofre nos caminhos que o comando indicar
# 4. Reaplicar os módulos a partir do arquivo declarativo:
velozctl apply -f veloz.modules.yaml --dry-run
velozctl apply -f veloz.modules.yaml
# 5. Os nós reconectam sozinhos: o certificado deles continua válido
```

**Tempo alvo: 60 minutos.** Teste este procedimento uma vez por trimestre, com cronômetro. Um
procedimento de recuperação nunca testado é um procedimento que não existe.
