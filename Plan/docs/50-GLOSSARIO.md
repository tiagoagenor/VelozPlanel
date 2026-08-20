# Glossário

> Todo termo técnico usado no projeto, explicado em uma frase.
> Ordem alfabética. Se você encontrar uma palavra em qualquer documento e ela não estiver aqui,
> isso é um defeito da documentação — anote e acrescente.

---

## A

**Agente (`veloz-agent`)** — o programinha instalado em cada servidor que pergunta ao control plane se
há tarefa e a executa; é o único que mexe no servidor.

**ACME** — o protocolo automático de pedir certificado HTTPS a uma autoridade como a Let's Encrypt.

**Ambiente** — o que o cliente compra: um espaço isolado com memória, CPU, disco, uma linguagem numa
versão e um ou mais domínios; na prática, um container.

**AppArmor** — mecanismo do Linux que restringe o que um programa pode acessar, mesmo rodando como
root; camada extra de segurança dentro dos containers.

**AUP (Política de Uso Aceitável)** — o documento que diz o que o cliente não pode hospedar; sem ele
você não tem respaldo para desligar quem ataca os outros.

**Auditoria** — o registro de quem fez o quê e quando no painel; não pode ser apagado por quem fez.

## B

**Backup incremental** — backup que grava só o que mudou desde o anterior, economizando espaço e tempo.

**Bigint de centavos** — a decisão de guardar dinheiro como número inteiro de centavos (5000 = R$ 50,00)
em vez de decimal, para eliminar erro de arredondamento.

**Binlog** — o registro de todas as alterações do MySQL/MariaDB; útil para réplica e recuperação,
perigoso porque cresce e enche o disco.

**Borda** — a camada que recebe a visita da internet antes de chegar no site do cliente (o nginx do
nó); é onde ficam HTTPS, limite de requisições e cache.

**Bucket** — a "pasta" no armazenamento externo onde ficam os backups.

## C

**Canário** — a prática de aplicar uma mudança em um servidor só, observar, e só então aplicar nos
demais.

**Capability (capacidade)** — um contrato do tipo "quem souber fazer X, se registre aqui"; é o que
permite ao núcleo pedir uma cobrança sem saber que existe Asaas.

**cgroup v2** — o mecanismo do Linux que limita quanta memória, CPU e disco um container pode usar; é
o que faz o plano do cliente valer de verdade.

**Circuit breaker** — proteção que, depois de várias falhas seguidas de um componente, para de chamá-lo
por um tempo em vez de insistir e travar tudo.

**Container** — um pacote isolado onde o programa do cliente roda achando que tem um servidor só para
ele; não é uma máquina virtual, é mais leve.

**Control plane (cérebro)** — a VPS separada que roda o painel, a API, o banco e a fila de tarefas; não
hospeda cliente nenhum.

**Cosign** — ferramenta que assina digitalmente um pacote, para provar que ele veio de quem diz ter
vindo e não foi alterado.

**Cota (quota)** — o limite de disco de cada ambiente, aplicado pelo sistema de arquivos para que um
cliente não encha o servidor.

**CSP (Content Security Policy)** — regra do navegador que define de onde a página pode carregar código;
é o que impede um script injetado de funcionar.

## D

**Data plane** — o conjunto dos nós que efetivamente hospedam os sites; o oposto do control plane.

**Degradado** — estado de um módulo que está instalado mas com a verificação de saúde falhando.

**Dependency-cruiser** — ferramenta que analisa quais arquivos importam quais, usada aqui para provar
que o núcleo não importa nenhum módulo.

**Desired state (estado desejado)** — o que o control plane diz que deveria estar em cada nó; o agente
compara com a realidade e corrige a diferença.

**DKIM** — assinatura digital nos e-mails de um domínio, que ajuda o destinatário a confiar que o
e-mail é legítimo.

**Docker** — a tecnologia de container escolhida para isolar os ambientes dos clientes.

**Drenado** — estado de um servidor que continua servindo quem já está nele, mas não recebe cliente
novo; todo nó nasce assim.

**Dump** — uma cópia do conteúdo de um banco de dados num arquivo, para backup ou restauração.

## E

**EOL (end of life)** — quando uma versão de linguagem para de receber correção de segurança e não
deveria mais ser oferecida a cliente novo.

**ErrorBoundary** — proteção do React que impede que um componente quebrado derrube a página inteira.

**ESM remoto** — carregar código JavaScript de outro servidor em tempo de execução; **rejeitado neste
projeto** por não dar isolamento de segurança nenhum.

## F

**Fila de emissão** — a decisão de pedir certificados HTTPS um de cada vez, centralizado, para não
estourar o limite da autoridade certificadora.

**Forward-only (migração)** — a regra de que uma alteração de banco de dados não é desfeita depois de
consolidada; corrige-se com uma alteração nova.

## H

**Healthcheck** — a verificação periódica de que um componente está funcionando de verdade, e não só
"ligado".

**Heartbeat** — o sinal periódico do agente dizendo "estou vivo"; sua ausência é o que dispara o
alerta de nó offline.

**Host API** — o conjunto de funções que o núcleo oferece a um módulo (emitir tarefa, ler segredo,
registrar pagamento); é a única porta do módulo para o resto do sistema.

**Hot-resize** — mudar memória ou CPU de um ambiente **sem reiniciá-lo**; é o requisito 9 do briefing.

## I

**Idempotente** — operação que dá o mesmo resultado se executada uma ou dez vezes; requisito
obrigatório de todo script de módulo.

**Iframe sandbox** — uma janela isolada dentro da página, em outro domínio, sem acesso à sessão do
usuário; será usada para módulos de terceiros.

**Incus / LXD** — tecnologia alternativa de container, **avaliada e descartada** neste projeto por
consumir memória demais em VPS de 16 GB.

## J

**Job (tarefa)** — a unidade de trabalho do sistema: tudo que acontece vira uma tarefa numerada, com
log, tentativas e responsável.

**Journald** — o sistema de log do Linux moderno; se não for limitado, enche o disco.

## K

**KVM** — virtualização real, em que a VPS tem seu próprio kernel; **requisito inegociável** — VPS
baseada em container (OpenVZ, LXC) não serve para este projeto.

## L

**LGPD** — a lei brasileira de proteção de dados pessoais; define obrigações sobre o que você guarda
de clientes e o que fazer em caso de vazamento.

**Long-poll** — técnica em que o agente faz uma pergunta e o servidor segura a resposta por até 30
segundos; dá latência de milissegundos sem o nó precisar aceitar conexão de fora.

## M

**mTLS** — autenticação em que os dois lados apresentam certificado, não só o servidor; é como o nó e
o control plane se reconhecem.

**Manifesto (`module.yaml`)** — o arquivo que descreve tudo sobre um módulo: o que faz, do que
depende, o que configura, quais telas e permissões traz.

**MariaDB** — o motor de banco de dados usado no lugar do MySQL por consumir bem menos memória;
o rótulo na tela do cliente continua sendo "MySQL", porque é compatível.

**Migração (de banco)** — um arquivo SQL numerado que altera a estrutura do banco; sobem em ordem e
ficam registradas.

**Module Federation** — tecnologia de carregar partes de front-end de outros servidores;
**rejeitada** aqui por estar sendo descontinuada e não funcionar com o Next.js moderno.

**Módulo** — uma capacidade que dá para ligar e desligar (banco, backup, SSL, Pix, PHP); o oposto de
núcleo.

## N

**nginx** — o servidor web que fica na frente de tudo, recebe a visita e encaminha para o ambiente
certo.

**Nó** — cada servidor VPS que hospeda ambientes de clientes.

**Núcleo (core)** — a parte do sistema que não é módulo e não se desliga: login, permissões, clientes,
servidores, ambientes, tarefas, cobrança, auditoria.

## O

**Object lock (imutabilidade)** — proteção do armazenamento que impede apagar um arquivo antes de um
prazo, **inclusive por quem tem a senha**; é a defesa contra ransomware.

**OCI** — o padrão de imagens de container que o Docker usa; "imagem OCI" é o molde do ambiente.

**OOM (out of memory)** — quando o sistema mata um processo por falta de memória; aparece nos gráficos
como memória no teto com quedas bruscas.

**OpenVZ / Virtuozzo** — virtualização baseada em container usada por VPS baratas; **incompatível com
este projeto**, e o diagnóstico existe para detectá-la antes da compra.

## P

**Parcial** — estado de um módulo instalado com sucesso em alguns servidores e pendente em outros.

**PSI (pressure stall information)** — métrica do Linux que mede o quanto os processos estão esperando
por CPU, memória ou disco; melhor indicador de "está apertado" que a porcentagem de uso.

**PSP (prestador de serviço de pagamento)** — a empresa que processa o pagamento (Asaas, Stripe,
Mercado Pago); no VelozPanel cada um é um módulo.

**Purgar** — apagar definitivamente os dados de um módulo ou ambiente; irreversível, exige digitar o
nome para confirmar.

## R

**RBAC** — controle de acesso por papel: o que cada tipo de usuário (dono, admin, desenvolvedor,
leitor) pode fazer.

**Restic** — a ferramenta de backup escolhida: incremental, com deduplicação e criptografia.

**RLS (Row Level Security)** — recurso do PostgreSQL que impede uma consulta de enxergar linhas de
outro cliente, mesmo se o código tiver bug; é a rede de segurança do isolamento.

**Rollback (desfazer)** — voltar ao estado anterior a uma instalação ou atualização; disponível por
24 horas.

**Rollout** — a estratégia de como uma mudança chega aos servidores: canário primeiro, ou todos de
uma vez.

**Runbook** — um procedimento passo a passo para uma situação específica, escrito antes de a situação
acontecer.

**Runtime** — a linguagem e a versão em que o site do cliente roda (PHP 8.3, Node 22, Python 3.13).

**RTO** — o tempo que você promete levar para voltar ao ar depois de um desastre; aqui, 60 minutos, e
precisa ser medido em ensaio.

**RPO** — quanto de dado você aceita perder num desastre; aqui, uma hora (a frequência do backup).

## S

**SEA (Single Executable Application)** — a técnica de empacotar um programa Node.js num único arquivo
executável; é como o agente é distribuído.

**Segredo** — senha, chave de API ou token; fica no cofre cifrado, nunca no banco de configuração e
nunca em log.

**Semver** — o padrão de versão `maior.menor.correção`, em que mudar o número maior significa quebra
de compatibilidade.

**Sidecar** — um processo separado que acompanha o principal; no plano, é como módulos de terceiros
rodarão na fase 2.

**Slot** — um lugar nomeado do painel onde um módulo pode encaixar uma tela (menu do ambiente, card da
visão geral, aba do servidor).

**Suspenso** — estado do ambiente que foi parado por falta de pagamento ou por decisão do admin; os
dados continuam lá.

**SFTP** — transferência de arquivos por conexão criptografada; substitui o FTP simples, que manda
senha em texto claro e **não é oferecido**.

## T

**Tenant** — cada cliente da plataforma, com seus usuários, ambientes e saldo; é a fronteira de
isolamento mais importante do sistema.

**Token de uso único** — a senha temporária que o painel gera para matricular um servidor novo; vale
60 minutos e só funciona uma vez.

## U

**userns-remap** — configuração do Docker em que o root de dentro do container não é o root do
servidor; é o que impede uma fuga de container virar controle da máquina.

## V

**VictoriaMetrics** — o banco de métricas que guarda os números dos gráficos; escolhido por consumir
pouca memória.

**VPS** — servidor virtual alugado de um provedor; aqui, três, cada uma num provedor diferente.

**`velozctl`** — a ferramenta de linha de comando que fala com o painel; faz tudo o que o painel faz,
inclusive quando o painel está fora do ar.

**`veloz-node-doctor.sh`** — o script que diz se um servidor serve para o VelozPanel; **rodar antes de
contratar** é regra, não sugestão.

**`veloz-nodectl`** — o ajudante instalado no servidor que executa as poucas ações que exigem root, a
partir de uma lista fechada; existe para o agente não precisar rodar como root.

## W

**WAF** — firewall de aplicação: filtra requisições maliciosas antes de chegarem ao site; fora do
MVP.

**Webhook** — uma chamada que um sistema externo faz ao seu, para avisar de um evento (ex.: "o
pagamento foi confirmado"); precisa ter a assinatura validada, sempre.

## X

**XFS com prjquota** — o sistema de arquivos e o recurso que aplicam a cota de disco por ambiente; é o
que impede um cliente de encher o servidor inteiro.

## Z

**ZFS** — sistema de arquivos avançado, **avaliado e descartado** neste projeto porque seu cache
consome memória demais numa VPS de 16 GB.
