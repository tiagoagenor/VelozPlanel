import { z } from "zod";

/**
 * Contratos compartilhados do VelozPlanel (fonte única de verdade).
 * API valida entrada/saída com estes schemas; painel e agente reusam os tipos.
 * Dinheiro sempre em centavos (bigint-safe: usamos number inteiro de centavos no núcleo).
 */

/* ─────────────── Jamees Studio (console de banco) ─────────────── */
export * from "./dbConsole";

/* ─────────────── Runtimes (linguagem + versão) ─────────────── */

export const runtimeKind = z.enum(["php", "node", "python", "static", "dotnet"]);
export type RuntimeKind = z.infer<typeof runtimeKind>;

/** Versões oferecidas no núcleo (ordem crescente, como na faixa do Hostoo).
 *  `static` não tem versão real — usa um pseudovalor "1" nunca exibido na UI.
 *  `.NET`: sequência real pula o 4.x (= .NET Framework). 3.0/3.1 são EOL (imagem
 *  no repo antigo `dotnet/core`); 11.0 ainda é pré-GA — podem falhar no pull. */
export const RUNTIME_VERSIONS: Record<RuntimeKind, string[]> = {
  php: ["5.6", "7.0", "7.2", "7.3", "7.4", "8.0", "8.1", "8.2", "8.3", "8.4", "8.5"],
  node: ["18", "20", "22", "24", "25", "26"],
  python: ["3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14"],
  static: ["1"],
  dotnet: ["3.0", "3.1", "5.0", "6.0", "7.0", "8.0", "9.0", "10.0", "11.0"],
};

/** Versão recomendada por linguagem (destaque/def. na criação). */
export const RECOMMENDED_VERSION: Record<RuntimeKind, string> = {
  php: "8.3",
  node: "24",
  python: "3.12",
  static: "1",
  dotnet: "8.0",
};

/** Runtimes SEM versão (a UI esconde o seletor e o sufixo de versão). */
export const RUNTIME_VERSIONLESS = new Set<RuntimeKind>(["static"]);
export function runtimeHasVersions(kind: RuntimeKind): boolean {
  return !RUNTIME_VERSIONLESS.has(kind);
}

/** Rótulo amigável por runtime. */
export const RUNTIME_LABEL: Record<RuntimeKind, string> = {
  php: "PHP",
  node: "Node.js",
  python: "Python",
  static: "Site estático",
  dotnet: ".NET",
};

export const runtimeSpec = z.object({
  kind: runtimeKind,
  version: z.string().min(1),
});
export type RuntimeSpec = z.infer<typeof runtimeSpec>;

/* ─────────────── Planos ─────────────── */

// Plano agora é dinâmico (dados no banco) — o id é uma chave livre (slug).
export const planId = z.string().min(1);
export type PlanId = string;

export interface PlanSpec {
  id: PlanId;
  label: string;
  vcpu: number; // cota de CPU (1.0 = 1 vCPU)
  memMb: number; // teto de memória
  diskGb: number;
  priceMonthCents: number; // preço mensal ativo, em centavos
  maxEnvironments: number; // máx. de ambientes (máquinas) por cliente neste plano
}

/** Plano como vem/vai para a API (mesmos campos do PlanSpec + ativo). */
export const plan = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  vcpu: z.number().min(0.25).max(16),
  memMb: z.number().int().min(128).max(32768),
  diskGb: z.number().int().min(1).max(2000),
  priceMonthCents: z.number().int().min(0),
  maxEnvironments: z.number().int().min(1).max(1000),
  active: z.boolean(),
});
export type Plan = z.infer<typeof plan>;

export const createPlanInput = z.object({
  id: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9-]*$/, "use um slug: minúsculas, números e hífen, começando com letra"),
  label: z.string().min(2).max(40),
  vcpu: z.number().min(0.25).max(16),
  memMb: z.number().int().min(128).max(32768),
  diskGb: z.number().int().min(1).max(2000),
  priceMonthCents: z.number().int().min(0),
  maxEnvironments: z.number().int().min(1).max(1000).default(5),
  active: z.boolean().default(true),
});
export type CreatePlanInput = z.infer<typeof createPlanInput>;

export const updatePlanInput = z.object({
  label: z.string().min(2).max(40).optional(),
  vcpu: z.number().min(0.25).max(16).optional(),
  memMb: z.number().int().min(128).max(32768).optional(),
  diskGb: z.number().int().min(1).max(2000).optional(),
  priceMonthCents: z.number().int().min(0).optional(),
  maxEnvironments: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanInput>;

/* ─────────────── Tipos de ambiente (catálogo + preço por tipo) ─────────────── */

export const envCategory = z.enum(["app", "service", "stack"]);
export type EnvCategory = z.infer<typeof envCategory>;

/** Ferramenta de UI de um serviço (ligada por proxy autenticado; nunca porta pública). */
export const envToolKind = z.enum(["phpmyadmin", "adminer", "redisinsight", "rabbitmq_mgmt"]);
export type EnvToolKind = z.infer<typeof envToolKind>;

/**
 * Tipo de ambiente como vem/vai para a API.
 * Modelo B: o PLANO é dono do preço de compute; o tipo carrega apenas um
 * ADICIONAL opcional (`priceMonthCents`, default 0) e o REQUISITO MÍNIMO de
 * recursos (`minVcpu`/`minMemMb`) que restringe quais planos o tipo aceita.
 */
export const envType = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: envCategory,
  image: z.string().nullable(),
  internalPort: z.number().int().nullable(),
  dataPath: z.string().nullable(),
  needsDb: z.boolean(),
  childType: z.string().nullable(),
  defaultTool: envToolKind.nullable(),
  allowsPublicDomain: z.boolean(),
  priceMonthCents: z.number().int().min(0), // ADICIONAL do tipo (R$/mês), default 0
  minVcpu: z.number().min(0), // vCPU mínimo p/ rodar este tipo (0 = sem mínimo)
  minMemMb: z.number().int().min(0), // RAM mínima (MB) p/ rodar este tipo
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type EnvType = z.infer<typeof envType>;

/** Um plano atende ao requisito mínimo de recursos de um tipo? */
export function planMeetsType(
  plan: { vcpu: number; memMb: number },
  type: { minVcpu: number; minMemMb: number },
): boolean {
  return plan.vcpu >= type.minVcpu && plan.memMb >= type.minMemMb;
}

// Super admin cria um tipo novo (raro; o catálogo já vem semeado).
export const createEnvTypeInput = z.object({
  id: z.string().min(2).max(32).regex(/^[a-z][a-z0-9-]*$/, "use um slug: minúsculas, números e hífen"),
  label: z.string().min(2).max(40),
  category: envCategory,
  image: z.string().max(200).nullable().default(null),
  internalPort: z.number().int().min(1).max(65535).nullable().default(null),
  dataPath: z.string().max(200).nullable().default(null),
  needsDb: z.boolean().default(false),
  childType: z.string().max(32).nullable().default(null),
  defaultTool: envToolKind.nullable().default(null),
  allowsPublicDomain: z.boolean().default(false),
  priceMonthCents: z.number().int().min(0).default(0), // adicional, default 0
  minVcpu: z.number().min(0).max(16).default(0),
  minMemMb: z.number().int().min(0).max(32768).default(0),
  active: z.boolean().default(true),
});
export type CreateEnvTypeInput = z.infer<typeof createEnvTypeInput>;

// O que o super admin edita no dia a dia: adicional, mínimos, rótulo, status.
export const updateEnvTypeInput = z.object({
  label: z.string().min(2).max(40).optional(),
  priceMonthCents: z.number().int().min(0).optional(), // adicional
  minVcpu: z.number().min(0).max(16).optional(),
  minMemMb: z.number().int().min(0).max(32768).optional(),
  defaultTool: envToolKind.nullable().optional(),
  allowsPublicDomain: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type UpdateEnvTypeInput = z.infer<typeof updateEnvTypeInput>;

export const PLANS: Record<PlanId, PlanSpec> = {
  start: { id: "start", label: "Start", vcpu: 1, memMb: 512, diskGb: 10, priceMonthCents: 3050, maxEnvironments: 2 },
  light: { id: "light", label: "Light", vcpu: 1.5, memMb: 1024, diskGb: 20, priceMonthCents: 4900, maxEnvironments: 5 },
  plus: { id: "plus", label: "Plus", vcpu: 2, memMb: 2048, diskGb: 40, priceMonthCents: 9800, maxEnvironments: 10 },
  pro: { id: "pro", label: "Pro", vcpu: 3, memMb: 4096, diskGb: 80, priceMonthCents: 17200, maxEnvironments: 25 },
};

/**
 * Tarifa horária ATIVA (mês contábil = 720 h). Modelo B:
 * preço do plano (compute) + adicional do tipo (default 0).
 */
export function hourlyActiveCents(plan: PlanSpec, adderMonthCents = 0): number {
  return (plan.priceMonthCents + adderMonthCents) / 720;
}
/** Pausado cobra só disco. Taxa configurável (R$/GB/mês); default R$ 0,25. */
export function hourlyPausedCents(plan: PlanSpec, diskRateCents = 25): number {
  return (plan.diskGb * diskRateCents) / 720;
}

/* ─────────────── Estados do ambiente ─────────────── */

export const envState = z.enum([
  "provisioning",
  "running",
  "paused",
  "error",
  "deleting",
]);
export type EnvState = z.infer<typeof envState>;

/* ─────────────── Ambiente ─────────────── */

export const environment = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  ownerId: z.string().uuid(),
  nodeId: z.string().uuid().nullable(),
  plan: planId,
  runtime: runtimeSpec,
  state: envState,
  containerId: z.string().nullable(),
  httpPort: z.number().int().nullable(), // porta publicada no host de dev
  domain: z.string().nullable(), // domínio próprio configurado pelo cliente
  autoSubdomain: z.string().nullable(), // endereço temporário <sub>.jamees.top
  subdomainChangesLeft: z.number().int(), // quantas vezes o cliente ainda pode trocar o subdomínio (0 = travado até o admin liberar)
  runtimeVersionFull: z.string().nullable(), // versão real resolvida no container (ex.: 24.19.0)
  startupScript: z.string().nullable(), // comandos rodados 1x na criação do container
  nodeStartFile: z.string().nullable(), // arquivo que inicia o app Node/Python (server.js/app.py); null = default
  pythonCmd: z.string().nullable(), // comando avançado de start (Python/Django); null = python3 app.py
  dotnetCmd: z.string().nullable(), // comando avançado de start (.NET); null = auto (dotnet App.dll da publicação)
  phpNodeVersion: z.string().nullable(), // versão Node escolhida (envs PHP via nvm); null = default da base
  phpNodeVersionFull: z.string().nullable(), // versão Node real resolvida no container (ex.: 22.12.0)
  accessUrl: z.string().nullable(), // URL pública p/ abrir o site (domínio https, ou IP do nó:porta)
  type: z.string().nullable(), // slug do tipo (env_types); null = app legado
  category: envCategory.nullable(), // app | service | stack
  connection: z.record(z.string(), z.string()).nullable(), // dados de conexão do serviço (host interno/porta/credenciais)
  region: z.string().nullable(), // região do nó onde o ambiente roda
  internalIp: z.string().nullable(), // IP interno na rede do dono (serviços/stacks); null p/ app legado
  errorMessage: z.string().nullable(), // mensagem de falha do job (provision/delete); null se ok
  createdAt: z.string().datetime(),
});
export type Environment = z.infer<typeof environment>;

/** Definir/limpar o domínio do ambiente. `null` remove. */
export const setDomainInput = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, "informe um domínio válido, ex.: meusite.com.br")
    .nullable(),
});
export type SetDomainInput = z.infer<typeof setDomainInput>;

/** Define/limpa os comandos de inicialização do ambiente (rodam 1x na criação). */
export const setStartupScriptInput = z.object({
  startupScript: z.string().max(20000).nullable(),
});
export type SetStartupScriptInput = z.infer<typeof setStartupScriptInput>;

/** Define o arquivo que inicia o app Node (ex.: server.js). Aplica ao reiniciar. */
export const setNodeStartFileInput = z.object({
  nodeStartFile: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_.\/-]+$/, "use um caminho de arquivo simples, ex.: server.js ou dist/main.js")
    .nullable(),
});
export type SetNodeStartFileInput = z.infer<typeof setNodeStartFileInput>;

/** Define/limpa o comando avançado de start do Python (Django/gunicorn). "" limpa. */
export const setPythonCmdInput = z.object({
  cmd: z.string().max(500).nullable(),
  apply: z.boolean().optional().default(true), // false = só salva (aplica no próximo deploy)
});
export type SetPythonCmdInput = z.infer<typeof setPythonCmdInput>;

/** Define/limpa o comando avançado de start do .NET (ex.: dotnet App.dll). "" limpa. */
export const setDotnetCmdInput = z.object({
  cmd: z.string().max(500).nullable(),
  apply: z.boolean().optional().default(true), // false = só salva (aplica no próximo deploy)
});
export type SetDotnetCmdInput = z.infer<typeof setDotnetCmdInput>;

/** Define a versão do Node (via nvm) de um ambiente PHP. Aplica ao vivo. */
export const setPhpNodeVersionInput = z.object({
  phpNodeVersion: z.enum(RUNTIME_VERSIONS.node as [string, ...string[]]),
});
export type SetPhpNodeVersionInput = z.infer<typeof setPhpNodeVersionInput>;

/** Leitura ao vivo da versão Node atual no container (reflete troca no terminal). */
export const phpNodeCurrent = z.object({
  current: z.string().nullable(), // ex.: "22.12.0"; null se nvm indisponível
});
export type PhpNodeCurrent = z.infer<typeof phpNodeCurrent>;

/* ─────────────── Configuração PHP (php.ini) por ambiente ─────────────── */

/**
 * Diretivas do php.ini expostas no painel. Fonte ÚNICA: a UI monta os controles
 * (sliders de MB/segundos + toggles) a partir de PHP_INI_FIELDS e o agente
 * serializa/valida pelos MESMOS limites. Valores de MB e segundos são inteiros.
 * Persistência é por ARQUIVO no host (bind mount), sem banco — sobrevive ao
 * recreate do container.
 */
export const phpIniConfig = z.object({
  memory_limit: z.number().int().min(16).max(1024), // MB
  upload_max_filesize: z.number().int().min(1).max(512), // MB
  post_max_size: z.number().int().min(1).max(512), // MB
  max_execution_time: z.number().int().min(0).max(600), // segundos (0 = ilimitado)
  max_input_time: z.number().int().min(0).max(600), // segundos
  // OPcache (acelerador): grava opcache.enable + opcache.enable_cli juntos — o
  // servidor roda com `php -S` (SAPI cli), então enable_cli=1 é o que de fato
  // liga o cache. Sobrescreve o tuning da imagem base (que vem enable_cli=0).
  opcache: z.boolean(),
  display_errors: z.boolean(),
  file_uploads: z.boolean(),
  allow_url_fopen: z.boolean(),
});
export type PhpIniConfig = z.infer<typeof phpIniConfig>;

/** Padrões (o botão "Restaurar padrões" grava exatamente estes valores). */
export const DEFAULT_PHP_INI: PhpIniConfig = {
  memory_limit: 128,
  upload_max_filesize: 2,
  post_max_size: 8,
  max_execution_time: 30,
  max_input_time: 60,
  opcache: false, // reflete o estado efetivo atual (php -S com enable_cli=0)
  display_errors: false,
  file_uploads: true,
  allow_url_fopen: true,
};

export type PhpIniFieldKind = "mb" | "seconds" | "bool";
export interface PhpIniField {
  key: keyof PhpIniConfig;
  label: string;
  kind: PhpIniFieldKind;
  help: string;
  min?: number; // só mb/seconds
  max?: number; // só mb/seconds
  step?: number; // só mb/seconds
}

/** Metadados para a UI (rótulo, faixa, passo, unidade). Ordem = ordem de exibição. */
export const PHP_INI_FIELDS: readonly PhpIniField[] = [
  { key: "memory_limit", label: "Limite de memória", kind: "mb", min: 16, max: 1024, step: 16, help: "Memória máxima que um script PHP pode usar (memory_limit)." },
  { key: "upload_max_filesize", label: "Tamanho máx. por arquivo enviado", kind: "mb", min: 1, max: 512, step: 1, help: "Maior arquivo aceito em um upload (upload_max_filesize)." },
  { key: "post_max_size", label: "Tamanho máx. do POST", kind: "mb", min: 1, max: 512, step: 1, help: "Maior corpo de requisição POST (post_max_size). Convém ser ≥ o tamanho de upload." },
  { key: "max_execution_time", label: "Tempo máx. de execução", kind: "seconds", min: 0, max: 600, step: 5, help: "Segundos que um script pode rodar antes de ser interrompido (max_execution_time). 0 = ilimitado." },
  { key: "max_input_time", label: "Tempo máx. de leitura da requisição", kind: "seconds", min: 0, max: 600, step: 5, help: "Segundos para receber os dados da requisição (max_input_time)." },
  { key: "opcache", label: "OPcache (acelerador)", kind: "bool", help: "Cache de bytecode do PHP — acelera bastante a execução. Liga opcache.enable + enable_cli (o php -S roda em modo CLI). Em desenvolvimento, revalida arquivos a cada ~2s." },
  { key: "display_errors", label: "Exibir erros na página", kind: "bool", help: "Mostra erros do PHP direto no navegador (display_errors). Ligue apenas para depurar." },
  { key: "file_uploads", label: "Permitir uploads", kind: "bool", help: "Habilita o envio de arquivos via HTTP (file_uploads)." },
  { key: "allow_url_fopen", label: "Permitir abrir URLs remotas", kind: "bool", help: "Permite que fopen/file_get_contents acessem URLs remotas (allow_url_fopen)." },
];

/* ─────────────── Deploy (Git) ─────────────── */

export const deployConnectionMode = z.enum(["none", "public", "ssh", "http", "local"]);
export type DeployConnectionMode = z.infer<typeof deployConnectionMode>;

export const deployProvider = z.enum(["github", "gitlab", "bitbucket", "generic"]);
export type DeployProvider = z.infer<typeof deployProvider>;

export const deployStepKind = z.enum([
  "git_sync",
  "composer_install",
  "npm_ci",
  "npm_build",
  "laravel_fix_index",
  "php_migrate",
  "artisan_migrate",
  "artisan_clear",
  "artisan_optimize",
  "artisan_storage_link",
  "node_restart",
  "pip_install",
  "python_restart",
  "static_reload",
  "dotnet_publish",
  "dotnet_restart",
  "shell",
]);
export type DeployStepKind = z.infer<typeof deployStepKind>;

export const deployRunStatus = z.enum(["running", "success", "failed", "interrupted"]);
export type DeployRunStatus = z.infer<typeof deployRunStatus>;

export const deployRunTrigger = z.enum(["manual", "auto"]);
export type DeployRunTrigger = z.infer<typeof deployRunTrigger>;

export const deployStrategy = z.enum(["place", "recreate"]);
export type DeployStrategy = z.infer<typeof deployStrategy>;

export const deployFramework = z.enum(["none", "nextjs", "laravel", "python", "django", "spa", "static", "dotnet"]);
export type DeployFramework = z.infer<typeof deployFramework>;

export const deployRunModel = z.enum(["standalone", "next_start"]);
export type DeployRunModel = z.infer<typeof deployRunModel>;

export const deployMode = z.enum(["simple", "advanced"]);
export type DeployMode = z.infer<typeof deployMode>;

// URL de repositório: aceita git@host:owner/repo(.git) ou https://host/owner/repo(.git).
// Só caracteres seguros (sem metacaracteres de shell) — validação de borda.
const REPO_URL_RE = /^[A-Za-z0-9@:._/-]+$/;
const GIT_REF_RE = /^[A-Za-z0-9._/-]+$/; // branch/ref

export const deployStep = z.object({
  id: z.string().uuid(),
  ord: z.number().int(),
  enabled: z.boolean(),
  kind: deployStepKind,
  command: z.string().nullable(), // livre só em kind="shell"
  label: z.string(),
  cwd: z.string().nullable(),
  mutatesData: z.boolean(),
});
export type DeployStep = z.infer<typeof deployStep>;

export const deployConfig = z.object({
  envId: z.string().uuid(),
  connectionMode: deployConnectionMode,
  provider: deployProvider,
  repoUrl: z.string().nullable(),
  branch: z.string(),
  isPrivate: z.boolean().nullable(),
  mode: deployMode,
  subdir: z.string().nullable(), // pasta do projeto no repo (monorepo)
  historyLimit: z.number().int(), // quantos deploys manter (0 = nunca apagar)
  publicKey: z.string().nullable(), // só a PÚBLICA (a privada nunca sai do nó)
  fingerprint: z.string().nullable(),
  httpUsername: z.string().nullable(), // usuário do HTTPS (a senha/token nunca volta)
  hasHttpCredentials: z.boolean(),
  connectionVerifiedAt: z.string().datetime().nullable(),
  needsReconnect: z.boolean(),
  autoEnabled: z.boolean(),
  intervalMinutes: z.number().int(),
  lastCheckAt: z.string().datetime().nullable(), // última vez que o auto-deploy checou o repo
  lastRemoteSha: z.string().nullable(), // último commit visto na branch (dedup do auto-deploy)
  deployStrategy: deployStrategy,
  framework: deployFramework,
  runModel: deployRunModel,
  lastRunStatus: deployRunStatus.nullable(),
  lastRunAt: z.string().datetime().nullable(),
  steps: z.array(deployStep),
  gatewayActive: z.boolean(),
  message: z.string().nullable(),
});
export type DeployConfig = z.infer<typeof deployConfig>;

/** Define a conexão do repositório (modo, provedor, URL, branch, densidade da UI). */
export const setDeployConnectionInput = z.object({
  connectionMode: deployConnectionMode,
  provider: deployProvider.default("github"),
  repoUrl: z.string().max(400).regex(REPO_URL_RE, "URL de repositório inválida").nullable(),
  // branch é OPCIONAL — o sistema detecta a padrão do repo (o usuário não digita).
  branch: z.string().min(1).max(200).regex(GIT_REF_RE, "branch inválida").optional(),
  mode: deployMode.default("simple"),
  framework: deployFramework.optional(), // preset escolhido no wizard (ex.: nextjs)
});
export type SetDeployConnectionInput = z.infer<typeof setDeployConnectionInput>;

/** Sondagem do repositório (público x privado x inalcançável) sem gravar nada. */
export const deployProbeInput = z.object({
  repoUrl: z.string().min(1).max(400).regex(REPO_URL_RE, "URL de repositório inválida"),
});
export type DeployProbeInput = z.infer<typeof deployProbeInput>;

export const deployProbeResult = z.object({
  reachable: z.boolean(),
  isPrivate: z.boolean().nullable(),
  provider: deployProvider,
  message: z.string(),
  defaultBranch: z.string().nullable(), // branch padrão detectada (o usuário não digita)
});
export type DeployProbeResult = z.infer<typeof deployProbeResult>;

/** Resposta da geração da deploy key: só a PÚBLICA (para colar no GitHub). */
export const generatedDeployKey = z.object({
  publicKey: z.string(),
  fingerprint: z.string(),
});
export type GeneratedDeployKey = z.infer<typeof generatedDeployKey>;

/** Importa uma chave PRIVADA fornecida pelo usuário (guardada só no nó). */
export const importDeployKeyInput = z.object({
  privateKey: z.string().min(1).max(20000),
});
export type ImportDeployKeyInput = z.infer<typeof importDeployKeyInput>;

/** Credenciais HTTPS (usuário + senha/token) para repositório privado por HTTP. */
export const setDeployHttpCredentialsInput = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
});
export type SetDeployHttpCredentialsInput = z.infer<typeof setDeployHttpCredentialsInput>;

/** Salva a lista ordenada de passos (fonte única no banco). */
export const setDeployStepsInput = z.object({
  mode: deployMode,
  subdir: z
    .string()
    .max(300)
    .regex(/^[A-Za-z0-9._/-]*$/, "pasta inválida")
    .refine((v) => !v.split("/").includes(".."), "pasta não pode conter '..'")
    .nullable()
    .optional(),
  steps: z
    .array(
      z.object({
        enabled: z.boolean(),
        kind: deployStepKind,
        command: z.string().max(4000).nullable(),
        label: z.string().min(1).max(120),
        cwd: z
          .string()
          .max(300)
          .regex(/^[A-Za-z0-9._/-]*$/, "pasta inválida")
          .refine((v) => !v.split("/").includes(".."), "pasta não pode conter '..'")
          .nullable(),
        mutatesData: z.boolean().optional(),
      }),
    )
    .max(50),
});
export type SetDeployStepsInput = z.infer<typeof setDeployStepsInput>;

/** Liga/desliga o deploy automático e define o intervalo (mín. 5 min). */
export const setDeployAutoInput = z.object({
  autoEnabled: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(1440), // mín. 1 min para não fazer polling agressivo demais
});
export type SetDeployAutoInput = z.infer<typeof setDeployAutoInput>;

export const deployBranchesResult = z.object({
  ok: z.boolean(),
  branches: z.array(z.string()),
  current: z.string(),
  message: z.string(),
});
export type DeployBranchesResult = z.infer<typeof deployBranchesResult>;

export const setDeployHistoryInput = z.object({
  historyLimit: z.number().int().min(0).max(500), // 0 = nunca apagar
});
export type SetDeployHistoryInput = z.infer<typeof setDeployHistoryInput>;

export const setDeployBranchInput = z.object({
  branch: z.string().min(1).max(200).regex(GIT_REF_RE, "branch inválida"),
});
export type SetDeployBranchInput = z.infer<typeof setDeployBranchInput>;

export const deployRun = z.object({
  id: z.string().uuid(),
  trigger: deployRunTrigger,
  status: deployRunStatus,
  exitCode: z.number().int().nullable(),
  failedStepKind: deployStepKind.nullable(),
  commitSha: z.string().nullable(),
  commitMessage: z.string().nullable(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type DeployRun = z.infer<typeof deployRun>;

/* ─────────────── Variáveis de ambiente (gerenciadas) ─────────────── */

export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Chaves proibidas — quebrariam o container ou injetariam código. */
export const RESERVED_ENV_KEYS = [
  "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "NVM_DIR", "HOME", "PWD", "SHELL",
  "IFS", "ENV", "BASH_ENV", "PS4",
];

/** Var como sai no GET — valor MASCARADO (revelar só via endpoint dedicado). */
export const envVar = z.object({
  key: z.string(),
  buildTime: z.boolean(),
  hasValue: z.boolean(),
  valueMasked: z.string(),
  hidden: z.boolean(), // escondida = valor NUNCA sai do servidor (só se vê no container)
});
export type EnvVar = z.infer<typeof envVar>;

export const setEnvVarsInput = z.object({
  vars: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .max(256)
          .regex(ENV_KEY_RE, "chave inválida (use letras, números e _; começa com letra ou _)")
          .refine(
            (k) => !RESERVED_ENV_KEYS.includes(k) && !k.startsWith("VP_"),
            "chave reservada pelo sistema",
          ),
        value: z.string().max(32768).optional(), // omitido = mantém o valor atual (não altera o segredo)
        buildTime: z.boolean().default(true),
        hidden: z.boolean().default(false), // esconder o valor de vez (não revelável no painel)
      }),
    )
    .max(100),
});
export type SetEnvVarsInput = z.infer<typeof setEnvVarsInput>;

export const envVarsConfig = z.object({
  vars: z.array(envVar),
  applied: z.boolean(), // aplicado ao vivo? (false = precisa recriar)
  message: z.string().nullable(),
});
export type EnvVarsConfig = z.infer<typeof envVarsConfig>;

/** Trocar a versão/linguagem do runtime (recria o container). */

/** Trocar a versão/linguagem do runtime (recria o container). */

/** Trocar a versão/linguagem do runtime (recria o container). */
export const changeRuntimeInput = runtimeSpec;
export type ChangeRuntimeInput = RuntimeSpec;

/** Gera um slug técnico (minúsculo, sem acento/espaço) a partir de um texto livre. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // não-alfanumérico vira hífen
    .replace(/-{2,}/g, "-") // colapsa hífens repetidos
    .replace(/^-+|-+$/g, "") // tira hífen das pontas
    .slice(0, 30)
    .replace(/-+$/g, ""); // tira hífen que sobrou no corte
}

export const createEnvironmentInput = z.object({
  // Nome livre (o cliente digita o que quiser); o slug técnico é derivado.
  name: z.string().trim().min(2, "dê um nome com ao menos 2 caracteres").max(40, "no máximo 40 caracteres"),
  plan: planId,
  // App (php/node): runtime é obrigatório. Serviço (redis/mysql/…): informe `type`.
  runtime: runtimeSpec.optional(),
  type: z.string().optional(), // slug em env_types; ausente/undefined = app (usa runtime)
  region: z.string().max(60).optional(), // região escolhida; ausente = auto
  nodeId: z.string().uuid().optional(), // nó específico (avançado); ausente = auto pela região
  template: deployFramework.default("none"), // "nextjs" pré-configura o deploy
});
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentInput>;

/* ─────────────── Nó ─────────────── */

export const nodeStatus = z.enum(["online", "degraded", "offline"]);
export type NodeStatus = z.infer<typeof nodeStatus>;

export const node = z.object({
  id: z.string().uuid(),
  name: z.string(),
  region: z.string(),
  status: nodeStatus,
  vcpuTotal: z.number(),
  memMbTotal: z.number(),
  envCount: z.number().int(),
  publicHost: z.string().nullable(), // IP/host público do nó (SSH, DNS). Configurado pelo super admin.
  httpHost: z.string().nullable(), // host onde as portas HTTP do site são alcançáveis (Abrir site). Fallback: publicHost. Nó local NAT = IP da LAN.
  alertMessage: z.string().nullable(), // aviso do super admin sobre a máquina (mostrado na criação)
  agentUrl: z.string().nullable(), // endpoint do Agente do nó (ex.: http://10.77.0.2:4100 via WireGuard)
  lastSeenAt: z.string().datetime().nullable(),
});
export type Node = z.infer<typeof node>;

/** Super admin edita o host público e o endpoint do Agente do nó. */
export const updateNodeInput = z.object({
  publicHost: z
    .string()
    .max(253)
    .regex(
      /^([a-z0-9-]+\.)*[a-z0-9-]+$|^(\d{1,3}\.){3}\d{1,3}$/i,
      "informe um IP ou hostname válido, ex.: 200.9.22.2 ou node1.velozplanel.com",
    )
    .nullable()
    .optional(),
  httpHost: z
    .string()
    .max(253)
    .regex(
      /^([a-z0-9-]+\.)*[a-z0-9-]+$|^(\d{1,3}\.){3}\d{1,3}$/i,
      "informe um IP ou hostname válido, ex.: 192.168.2.111",
    )
    .nullable()
    .optional(),
  agentUrl: z
    .string()
    .url("informe uma URL válida, ex.: http://10.77.0.2:4100")
    .nullable()
    .optional(),
  alertMessage: z.string().max(500).nullable().optional(),
  region: z.string().trim().min(1).max(64).optional(), // nome da região (rótulo/chave)
});
export type UpdateNodeInput = z.infer<typeof updateNodeInput>;

/** Região disponível para criar ambiente (com aviso opcional da máquina). */
export const regionOption = z.object({
  region: z.string(),
  alert: z.string().nullable(), // aviso do super admin (ex.: "instável")
  online: z.boolean(), // há nó online com Agente nessa região
  isDefault: z.boolean(), // região pré-selecionada no wizard (definida pelo super admin)
});
export type RegionOption = z.infer<typeof regionOption>;

/** Super admin define a região pré-selecionada no wizard de criar ambiente. */
export const setDefaultRegionInput = z.object({ region: z.string().min(1).max(64) });
export type SetDefaultRegionInput = z.infer<typeof setDefaultRegionInput>;

/** Segurança do acesso SSH/SFTP (super admin). idleTimeoutSeconds: 0 = desativado. */
export const sshSecuritySettings = z.object({ idleTimeoutSeconds: z.number().int().min(0).max(86400) });
export type SshSecuritySettings = z.infer<typeof sshSecuritySettings>;
export const setSshSecurityInput = z.object({ idleTimeoutSeconds: z.number().int().min(0).max(86400) });
export type SetSshSecurityInput = z.infer<typeof setSshSecurityInput>;

/* ─────────────── Métricas ─────────────── */

export const metricSample = z.object({
  ts: z.number(), // epoch ms
  cpuPct: z.number(), // 0..100 (relativo à cota do ambiente)
  memBytes: z.number(),
  memLimitBytes: z.number(),
});
export type MetricSample = z.infer<typeof metricSample>;

export const metricSeries = z.object({
  envId: z.string().uuid(),
  samples: z.array(metricSample),
});
export type MetricSeries = z.infer<typeof metricSeries>;

/** Uso de disco do ambiente. Medido ao vivo quando ligado; senão, último valor salvo. */
export const diskUsage = z.object({
  diskBytes: z.number().int().nonnegative(),
  measuredAt: z.string().datetime().nullable(), // quando o valor foi medido (null = nunca)
  live: z.boolean(), // true = medido agora (ligado); false = valor salvo (pausado/desligado)
});
export type DiskUsage = z.infer<typeof diskUsage>;

/* ─────────────── Auth ─────────────── */

export const userRole = z.enum(["admin", "client"]);
export type UserRole = z.infer<typeof userRole>;

export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

export const sessionUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: userRole,
});
export type SessionUser = z.infer<typeof sessionUser>;

/* ─────────────── Arquivos (gerenciador de arquivos do ambiente) ─────────────── */

export const fileEntry = z.object({
  name: z.string(),
  type: z.enum(["file", "dir"]),
  size: z.number(), // bytes (0 para dir)
  mtime: z.number(), // epoch ms
  mode: z.string(), // permissões octais, ex.: "644"
});
export type FileEntry = z.infer<typeof fileEntry>;

export const fileList = z.object({
  path: z.string(), // caminho absoluto dentro do ambiente (ex.: /app/www)
  root: z.string(), // raiz servida (var/www ou /app)
  entries: z.array(fileEntry),
});
export type FileList = z.infer<typeof fileList>;

export const fileContent = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(), // true se o arquivo foi cortado por tamanho
});
export type FileContent = z.infer<typeof fileContent>;

export const writeFileInput = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type WriteFileInput = z.infer<typeof writeFileInput>;

export const mkPathInput = z.object({
  path: z.string().min(1),
});
export type MkPathInput = z.infer<typeof mkPathInput>;

/** Upload de arquivo (binário) para uma pasta: conteúdo em base64. */
export const uploadFileInput = z.object({
  dir: z.string().min(1), // pasta de destino (absoluta, confinada à raiz)
  filename: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, "nome de arquivo inválido (sem barras)"),
  contentBase64: z.string(), // conteúdo do arquivo em base64
});
export type UploadFileInput = z.infer<typeof uploadFileInput>;

/** Renomear/mover dentro do mesmo diretório (só o nome final). */
export const renameFileInput = z.object({
  path: z.string().min(1), // caminho atual (absoluto)
  newName: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, "nome inválido (sem barras)"),
});
export type RenameFileInput = z.infer<typeof renameFileInput>;

/** Alterar permissões (chmod), modo octal de 3 ou 4 dígitos. */
export const chmodInput = z.object({
  path: z.string().min(1),
  mode: z.string().regex(/^[0-7]{3,4}$/, "modo octal inválido, ex.: 644 ou 755"),
});
export type ChmodInput = z.infer<typeof chmodInput>;

/* ─────────────── Bancos de dados do cliente ─────────────── */

export const dbEngine = z.enum(["mysql"]); // núcleo: MariaDB (MySQL-compatível). PG depois.
export type DbEngine = z.infer<typeof dbEngine>;

export const database = z.object({
  id: z.string().uuid(),
  envId: z.string().uuid(),
  engine: dbEngine,
  name: z.string(), // nome do database
  dbUser: z.string(),
  host: z.string(),
  port: z.number().int(),
  createdAt: z.string().datetime(),
});
export type Database = z.infer<typeof database>;

/** Criação retorna a senha UMA vez (não é armazenada em claro). */
export const databaseWithSecret = database.extend({
  password: z.string(),
});
export type DatabaseWithSecret = z.infer<typeof databaseWithSecret>;

export const createDatabaseInput = z.object({
  name: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9_]*$/, "comece com letra; use letras minúsculas, números e _"),
});
export type CreateDatabaseInput = z.infer<typeof createDatabaseInput>;

/* ─────────────── SSL / HTTPS ─────────────── */

export const sslCertStatus = z.enum([
  "none", // sem domínio ou sem certificado
  "pending", // emissão solicitada (fase futura, precisa de domínio público + borda)
  "active", // certificado ativo (self-signed no núcleo)
  "error",
]);
export type SslCertStatus = z.infer<typeof sslCertStatus>;

export const sslStatus = z.object({
  envId: z.string().uuid(),
  domain: z.string().nullable(),
  forceHttps: z.boolean(),
  certStatus: sslCertStatus,
  issuer: z.string().nullable(), // ex.: "self-signed (dev)" | "Let's Encrypt"
  notAfter: z.string().datetime().nullable(),
  message: z.string().nullable(), // nota honesta sobre limitação/estado
});
export type SslStatus = z.infer<typeof sslStatus>;

export const forceHttpsInput = z.object({ forceHttps: z.boolean() });
export type ForceHttpsInput = z.infer<typeof forceHttpsInput>;

/* ─────────────── Painel admin de serviço (ex.: RabbitMQ management) ─────────────── */

// Alguns serviços têm um painel web embutido (RabbitMQ management na 15672). O dono
// pode LIGAR/DESLIGAR a exposição desse painel num subdomínio ALEATÓRIO sob jamees.top.
export const adminPanelStatus = z.object({
  envId: z.string().uuid(),
  supported: z.boolean(), // true para serviços com painel (rabbitmq/mysql/mariadb/postgres)
  enabled: z.boolean(),
  tool: z.string().nullable(), // nome da ferramenta: "phpMyAdmin" | "Adminer" | "RabbitMQ Management"
  url: z.string().nullable(), // https://<aleatório>.jamees.top quando ligado
  user: z.string().nullable(), // usuário de login do painel (ex.: vp_user)
  password: z.string().nullable(), // senha de login (o painel mascara)
  database: z.string().nullable(), // banco inicial do serviço (ex.: "app"); dá pra criar outros
  message: z.string().nullable(), // nota honesta sobre estado/limitação
});
export type AdminPanelStatus = z.infer<typeof adminPanelStatus>;

export const setAdminPanelInput = z.object({ enabled: z.boolean() });
export type SetAdminPanelInput = z.infer<typeof setAdminPanelInput>;

/* ─────────────── SSH / SFTP (acesso ao ambiente) ─────────────── */

export const sshKey = z.object({
  id: z.string().uuid(),
  label: z.string(),
  fingerprint: z.string(), // SHA256:...
  publicKey: z.string(),
  createdAt: z.string().datetime(),
});
export type SshKey = z.infer<typeof sshKey>;

export const addSshKeyInput = z.object({
  label: z.string().min(1).max(60),
  publicKey: z.string().min(1), // linha completa: "ssh-ed25519 AAAA... comentário"
});
export type AddSshKeyInput = z.infer<typeof addSshKeyInput>;

/** Gera um par de chaves ed25519 no servidor (vinculado ao ambiente). */
export const generateSshKeyInput = z.object({
  label: z.string().min(1).max(60),
});
export type GenerateSshKeyInput = z.infer<typeof generateSshKeyInput>;

/**
 * Resposta ÚNICA da geração: metadados da chave (pública) + a chave PRIVADA.
 * A privada NÃO é armazenada no servidor — só aparece nesta resposta, uma vez,
 * para o cliente baixar. Se perder, gera outra e apaga a antiga.
 */
export const generatedSshKey = z.object({
  key: sshKey,
  privateKey: z.string(), // formato OpenSSH (id_ed25519)
});
export type GeneratedSshKey = z.infer<typeof generatedSshKey>;

export const sshAuthMode = z.enum(["key", "password", "both"]);
export type SshAuthMode = z.infer<typeof sshAuthMode>;

/** Acesso: de qualquer IP ou só de uma lista (echo da decisão do cliente). */
export const sshAccessScope = z.enum(["any", "allowlist"]);
export type SshAccessScope = z.infer<typeof sshAccessScope>;

export const sshConfig = z.object({
  envId: z.string().uuid(),
  enabled: z.boolean(),
  username: z.string(),
  host: z.string(),
  port: z.number().int(),
  authMode: sshAuthMode,
  accessScope: sshAccessScope,
  allowlist: z.array(z.string()), // IPs/CIDRs quando accessScope = allowlist
  keys: z.array(sshKey),
  gatewayActive: z.boolean(), // false no núcleo (gateway SSH ativa na fase de infra)
  message: z.string().nullable(),
});
export type SshConfig = z.infer<typeof sshConfig>;

export const updateSshConfigInput = z.object({
  enabled: z.boolean(),
  authMode: sshAuthMode,
  accessScope: sshAccessScope,
  allowlist: z
    .array(
      z
        .string()
        .regex(
          /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/,
          "informe um IP ou CIDR válido, ex.: 189.40.1.2 ou 189.40.0.0/16",
        ),
    )
    .max(50),
});
export type UpdateSshConfigInput = z.infer<typeof updateSshConfigInput>;

/* ─────────────── SFTP (transferência de arquivos, só senha) ─────────────── */
// Módulo SEPARADO do SSH: o SSH é shell só por chave (porta 2222); o SFTP é
// transferência de arquivos só por senha (porta 2223). A senha é gerada pelo
// painel (sempre aleatória) e só o hash fica no servidor.

export const sftpConfig = z.object({
  envId: z.string().uuid(),
  enabled: z.boolean(),
  username: z.string(),
  host: z.string(),
  port: z.number().int(),
  hasPassword: z.boolean(), // já existe senha definida para este ambiente?
  passwordSetAt: z.string().datetime().nullable(),
  gatewayActive: z.boolean(),
  message: z.string().nullable(),
});
export type SftpConfig = z.infer<typeof sftpConfig>;

export const setSftpEnabledInput = z.object({ enabled: z.boolean() });
export type SetSftpEnabledInput = z.infer<typeof setSftpEnabledInput>;

/**
 * Resposta ÚNICA da geração/reset da senha SFTP: a senha em texto aparece só
 * aqui, uma vez (o servidor guarda apenas o hash). Depois disso, só reset.
 */
export const generatedSftpPassword = z.object({
  password: z.string(),
  passwordSetAt: z.string().datetime(),
});
export type GeneratedSftpPassword = z.infer<typeof generatedSftpPassword>;

/* ═══════════════ SUPER ADMIN ═══════════════ */

/* ── Usuários / clientes ── */
export const accountStatus = z.enum(["active", "suspended"]);
export type AccountStatus = z.infer<typeof accountStatus>;

export const adminUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: userRole,
  status: accountStatus,
  envCount: z.number().int(),
  balanceCents: z.number().int(), // saldo total gastável (dinheiro + bônus) = soma do razão
  bonusCents: z.number().int(), // parte do saldo que veio de bônus/cortesia
  createdAt: z.string().datetime(),
});
export type AdminUser = z.infer<typeof adminUser>;

/* ── Créditos / saldo ── */
export const creditTransaction = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  amountCents: z.number().int(), // positivo = crédito, negativo = débito/estorno
  kind: z.string(), // "admin_credit" | "admin_debit" | ...
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type CreditTransaction = z.infer<typeof creditTransaction>;

/** Admin adiciona (ou remove, se negativo) saldo de um cliente. `kind` distingue
 *  dinheiro (top-up/pagamento) de bônus (cortesia). Débito (valor negativo) ignora o kind. */
export const addCreditInput = z.object({
  amountCents: z.number().int().refine((v) => v !== 0, "informe um valor diferente de zero"),
  kind: z.enum(["money", "bonus"]).default("money"),
  reason: z.string().max(200).nullable().optional(),
});
export type AddCreditInput = z.infer<typeof addCreditInput>;

/** Saldo do próprio usuário (painel do cliente). */
export const balance = z.object({
  balanceCents: z.number().int(), // saldo total gastável = dinheiro + bônus
  moneyCents: z.number().int(), // parte do saldo que é dinheiro (não-bônus)
  bonusCents: z.number().int(), // parte do saldo concedida como bônus/cortesia
  monthlyBurnCents: z.number().int(), // gasto mensal estimado (soma dos ambientes ATIVOS pelo preço do plano)
  estimateMonths: z.number().nullable(), // meses que o saldo dura no ritmo atual; null = sem máquina ativa (não gasta)
  transactions: z.array(creditTransaction),
});
export type Balance = z.infer<typeof balance>;

export const createUserInput = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: userRole,
});
export type CreateUserInput = z.infer<typeof createUserInput>;

export const updateUserInput = z.object({
  name: z.string().min(2).max(80).optional(),
  role: userRole.optional(),
  status: accountStatus.optional(),
  password: z.string().min(6).max(100).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInput>;

/* ── Ambientes da frota (visão admin) ── */
export const adminEnvironment = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ownerId: z.string().uuid(),
  ownerEmail: z.string(),
  nodeId: z.string().uuid().nullable(),
  nodeName: z.string().nullable(),
  plan: planId,
  runtime: runtimeSpec,
  state: envState,
  createdAt: z.string().datetime(),
  subdomainChangesLeft: z.number().int(), // trocas de subdomínio ainda disponíveis
});
export type AdminEnvironment = z.infer<typeof adminEnvironment>;

/** Admin libera N trocas adicionais de subdomínio para um ambiente. */
export const grantSubdomainChangesInput = z.object({
  count: z.number().int().min(1).max(20),
});
export type GrantSubdomainChangesInput = z.infer<typeof grantSubdomainChangesInput>;

/** Alterar vCPU/RAM a quente (requisito nº 9) — motivo obrigatório, vai para auditoria. */
export const resourceChangeInput = z.object({
  vcpu: z.number().min(0.25).max(8),
  memMb: z.number().int().min(256).max(16384),
  reason: z.string().min(3).max(200),
});
export type ResourceChangeInput = z.infer<typeof resourceChangeInput>;

/* ── Auditoria ── */
export const auditEntry = z.object({
  id: z.string().uuid(),
  ts: z.string().datetime(),
  actorEmail: z.string(),
  actorRole: z.string(),
  action: z.string(),
  target: z.string().nullable(),
  detail: z.string().nullable(),
  ip: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntry>;

/* ── Rede / WireGuard (config honesta; mesh real é infra-fase) ── */
export const wgPeerStatus = z.enum(["configured", "handshake_ok", "offline"]);
export type WgPeerStatus = z.infer<typeof wgPeerStatus>;

export const wgPeer = z.object({
  id: z.string().uuid(),
  nodeId: z.string().uuid().nullable(),
  name: z.string(),
  privateIp: z.string(), // 10.77.x.x
  endpoint: z.string().nullable(),
  publicKey: z.string().nullable(),
  status: wgPeerStatus,
  createdAt: z.string().datetime(),
});
export type WgPeer = z.infer<typeof wgPeer>;

export const addWgPeerInput = z.object({
  name: z.string().min(2).max(60),
  nodeId: z.string().uuid().nullable().optional(),
  privateIp: z
    .string()
    .regex(/^(\d{1,3}\.){3}\d{1,3}$/, "informe um IP privado, ex.: 10.77.0.2"),
  endpoint: z.string().max(120).nullable().optional(),
  publicKey: z.string().max(120).nullable().optional(),
});
export type AddWgPeerInput = z.infer<typeof addWgPeerInput>;

/* ── Planos (admin) ── */
export const planAdmin = z.object({
  id: planId,
  label: z.string(),
  vcpu: z.number(),
  memMb: z.number(),
  diskGb: z.number(),
  priceMonthCents: z.number().int(),
  hourlyActiveCents: z.number(),
  hourlyPausedCents: z.number(),
});
export type PlanAdmin = z.infer<typeof planAdmin>;

/* ── Dashboard da operação ── */
export const adminOverview = z.object({
  nodes: z.object({ total: z.number().int(), online: z.number().int() }),
  environments: z.object({
    total: z.number().int(),
    running: z.number().int(),
    paused: z.number().int(),
    error: z.number().int(),
  }),
  users: z.object({ total: z.number().int(), clients: z.number().int() }),
  databases: z.number().int(),
  monthlyRevenueCents: z.number().int(), // estimado a partir dos ambientes ativos
});
export type AdminOverview = z.infer<typeof adminOverview>;

/* ── Faturamento / cobrança por hora (cron configurável) ── */
export const billingSettings = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(1440), // de quanto em quanto tempo o cron roda
  freeMinutes: z.number().int().min(0).max(1440), // cortesia: < X min de vida não cobra no acerto ao deletar
  suspendOnZero: z.boolean(), // pausar ambiente do cliente quando o saldo zerar
  domainPriceMonthCents: z.number().int().min(0), // taxa de gerência por domínio/mês
  // Taxas por recurso (calculadora dos planos). rateDiskGb também cobra o pausado.
  rateVcpuMonthCents: z.number().int().min(0),
  rateRamGbMonthCents: z.number().int().min(0),
  rateDiskGbMonthCents: z.number().int().min(0),
  lastRunAt: z.string().datetime().nullable(), // quando a última execução TERMINOU (não o cursor do agendador)
  nextRunAt: z.string().datetime().nullable(),
  running: z.boolean(), // se o job está executando agora
  chargedTodayCents: z.number().int(), // total debitado hoje (estimativa)
  // Resumo da última execução concluída (para o card "Última execução").
  lastInstances: z.number().int().nullable(), // instâncias cobráveis na última rodada
  lastSuspended: z.number().int().nullable(), // ambientes suspensos na última rodada
  lastChargedCents: z.number().int().nullable(), // cobrado na última rodada
  lastOk: z.boolean().nullable(), // true = ok, false = falhou, null = nunca rodou
});
export type BillingSettings = z.infer<typeof billingSettings>;

/** Uma hora do rollup de execuções de cobrança (histórico da tela). */
export const billingRunHour = z.object({
  hour: z.string().datetime(),
  runs: z.number().int(),
  chargedCents: z.number().int(),
  chargeEvents: z.number().int(),
  suspended: z.number().int(),
  instances: z.number().int(),
  errors: z.number().int(),
  firstRunAt: z.string().datetime(),
  lastRunAt: z.string().datetime(),
});
export type BillingRunHour = z.infer<typeof billingRunHour>;

export const updateBillingSettingsInput = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(1).max(1440).optional(),
  freeMinutes: z.number().int().min(0).max(1440).optional(),
  suspendOnZero: z.boolean().optional(),
  domainPriceMonthCents: z.number().int().min(0).optional(),
  rateVcpuMonthCents: z.number().int().min(0).optional(),
  rateRamGbMonthCents: z.number().int().min(0).optional(),
  rateDiskGbMonthCents: z.number().int().min(0).optional(),
});
export type UpdateBillingSettingsInput = z.infer<typeof updateBillingSettingsInput>;

/** Logs de um container (snapshot das últimas linhas). */
export const containerLogs = z.object({ log: z.string() });
export type ContainerLogs = z.infer<typeof containerLogs>;

/* ── Subdomínio temporário (jamees.top) + reservados ── */
// Formato do subdomínio: começa/termina alfanumérico, 3–30 chars, sem "--".
export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const setSubdomainInput = z.object({
  subdomain: z
    .string()
    .transform((s) => s.trim().toLowerCase().replace(/\.jamees\.top\.?$/, ""))
    .refine((s) => SUBDOMAIN_RE.test(s) && !s.includes("--"), "Use 3 a 30 letras, números ou hífen — começando e terminando com letra/número, sem “--”."),
});
export type SetSubdomainInput = z.infer<typeof setSubdomainInput>;

export const reservedSubdomain = z.object({
  name: z.string(),
  reason: z.string().nullable(),
  locked: z.boolean(),
  createdAt: z.string(),
});
export type ReservedSubdomain = z.infer<typeof reservedSubdomain>;

export const createReservedSubdomainInput = z.object({
  name: z.string().transform((s) => s.trim().toLowerCase()).refine((s) => SUBDOMAIN_RE.test(s) && !s.includes("--"), "Nome de subdomínio inválido."),
  reason: z.string().max(120).optional(),
});
export type CreateReservedSubdomainInput = z.infer<typeof createReservedSubdomainInput>;

/* ── Catálogo de módulos ── */
export const moduleInfo = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  scope: z.enum(["environment", "node", "platform"]),
  status: z.enum(["builtin", "active", "planned"]),
});
export type ModuleInfo = z.infer<typeof moduleInfo>;

/* ─────────────── DNS / Gerenciador de domínios (admin global) ─────────────── */

/** Estados de uma zona, derivados na API a partir da verificação de delegação. */
export const dnsZoneStatus = z.enum([
  "pending", // criada, ainda não delegada no registrar
  "pending_verification", // já resolvia na internet — exige confirmar delegação p/ nós antes de liberar o editor
  "active", // 2/2 nameservers respondendo + delegada
  "active_no_redundancy", // delegada, só o primário responde
  "error", // SERVFAIL nos NS
  "unknown", // timeout do resolver (transitório)
]);
export type DnsZoneStatus = z.infer<typeof dnsZoneStatus>;

/** Tipos de registro suportados na R1. SOA/NS aparecem (só leitura/estruturais). */
export const dnsRecordType = z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA", "SRV", "SOA"]);
export type DnsRecordType = z.infer<typeof dnsRecordType>;

/** Por que um conjunto de registros é protegido de edição/remoção. */
export const dnsProtectedReason = z.enum(["system", "panel"]).nullable();
export type DnsProtectedReason = z.infer<typeof dnsProtectedReason>;

/** Uma zona (domínio) como a lista do painel a enxerga. */
export const dnsZone = z.object({
  name: z.string(), // ex.: geestao.top (sem ponto final)
  status: dnsZoneStatus,
  serial: z.number().int().nullable(),
  checkedAt: z.string().nullable(),
  checkMsg: z.string().nullable(),
  recordCount: z.number().int(), // RRsets do painel (exclui os "system")
  environmentId: z.string().nullable(),
  ownerId: z.string().nullable(), // dono da zona (cliente) — null = zona do painel/admin
  ownerEmail: z.string().nullable(), // conveniência p/ a lista admin
  deletable: z.boolean(),
  undeletableReason: z.string().nullable(),
});
export type DnsZone = z.infer<typeof dnsZone>;

/** Um conjunto de registros (RRset) agrupado por (nome, tipo). */
export const dnsRRset = z.object({
  name: z.string(), // rótulo relativo à zona ("@" no ápice, "www", …)
  fqdn: z.string(), // nome canônico completo (ex.: www.geestao.top.)
  type: dnsRecordType,
  ttl: z.number().int(),
  records: z.array(z.string()), // conteúdos crus (ex.: "187.127.49.205"; MX "10 mail.x.")
  protected: z.boolean(),
  protectedReason: dnsProtectedReason,
  protectedMsg: z.string().nullable(),
});
export type DnsRRset = z.infer<typeof dnsRRset>;

/** Um nameserver deste servidor (host + IP para glue/delegação). */
export const dnsNameserver = z.object({ host: z.string(), ip: z.string() });
export type DnsNameserver = z.infer<typeof dnsNameserver>;

/** Nameservers deste servidor DNS (alimenta o card de delegação). */
export const dnsServerInfo = z.object({
  nameservers: z.array(dnsNameserver),
});
export type DnsServerInfo = z.infer<typeof dnsServerInfo>;

/** Criar zona — só o nome; SOA/NS/glue nascem automaticamente. */
export const createZoneInput = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(253)
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
      "informe um domínio válido (ex.: exemplo.com ou lab.exemplo.com)",
    ),
});
export type CreateZoneInput = z.infer<typeof createZoneInput>;

/** Resultado da criação: alerta anti-takeover se o domínio já resolve hoje. */
export const createZoneResult = z.object({
  zone: dnsZone,
  alreadyResolves: z.boolean(),
  resolvesTo: z.array(z.string()),
});
export type CreateZoneResult = z.infer<typeof createZoneResult>;

/** Upsert de um RRset (substitui o conjunto inteiro). */
export const upsertRRsetInput = z.object({
  name: z.string().trim().max(253), // "@" ou rótulo/subnome
  type: dnsRecordType,
  ttl: z.number().int().min(60).max(604800).default(300),
  records: z.array(z.string().trim().min(1)).min(1).max(50),
});
export type UpsertRRsetInput = z.infer<typeof upsertRRsetInput>;

export const deleteRRsetInput = z.object({
  name: z.string().trim().max(253),
  type: dnsRecordType,
});
export type DeleteRRsetInput = z.infer<typeof deleteRRsetInput>;

/** Verificação de delegação — booleanos crus + serial + diagnóstico (nunca 500). */
export const verifyResult = z.object({
  status: dnsZoneStatus,
  delegatedAtParent: z.boolean(),
  primaryAnswering: z.boolean(),
  secondaryAnswering: z.boolean(),
  serial: z.number().int().nullable(),
  checkedAt: z.string(),
  error: z.enum(["timeout", "servfail"]).nullable(),
  // Diagnóstico do apontamento (quando há um host esperado do ambiente vinculado):
  resolvedTo: z.array(z.string()).default([]), // o que os NS respondem hoje para o nome
  expected: z.string().nullable().default(null), // host esperado (do ambiente), se houver
  match: z.boolean().default(false), // resolvedTo contém o expected?
});
export type VerifyResult = z.infer<typeof verifyResult>;

/** Descoberta: registros atuais no mundo (para importar antes de delegar). */
export const discoverResult = z.object({
  partial: z.boolean(), // algum NS atual deu timeout
  rrsets: z.array(
    z.object({
      name: z.string(),
      type: dnsRecordType,
      ttl: z.number().int(),
      records: z.array(z.string()),
    }),
  ),
});
export type DiscoverResult = z.infer<typeof discoverResult>;

/* ── Apontar domínio → ambiente + preview "como está ficando" ── */

/** Escada de 3 degraus (o teto da Fase 1 é "dns_pronto"; "publicado" é Fase 2). */
export const servingStatus = z.enum([
  "sem_apontamento", // nenhum registro aponta para ambiente
  "aguardando_propagacao", // apontado; verify ainda não confirma
  "dns_pronto", // verify confirma A == host do ambiente [teto Fase 1]
  "publicado", // vhost/HTTPS no ar [Fase 2]
]);
export type ServingStatus = z.infer<typeof servingStatus>;

/** Entrada do "apontar para ambiente" (caminho fácil). */
export const pointInput = z.object({
  label: z.string().trim().max(63).default("@"), // "@" (raiz) ou subnome (ex.: "loja")
  environmentId: z.string().uuid(),
  includeWww: z.boolean().default(true), // só aplica quando label = "@"
});
export type PointInput = z.infer<typeof pointInput>;

/** Um apontamento domínio(label)→ambiente com seu estado de serviço. */
export const dnsPoint = z.object({
  zone: z.string().default(""), // preenchido quando fora do contexto de uma zona
  label: z.string(),
  fqdn: z.string(),
  environmentId: z.string(),
  environmentName: z.string(),
  envState: z.string(),
  servingStatus,
  managed: z.boolean(), // o A ainda bate com o host atual do ambiente?
  resolvedTo: z.string().nullable(),
});
export type DnsPoint = z.infer<typeof dnsPoint>;

/** Preview "como está ficando a configuração" (derivado no backend). */
export const dnsZoneEffective = z.object({
  zone: z.string(),
  points: z.array(dnsPoint),
  mail: z.array(z.object({ via: z.string(), prio: z.number().int() })),
  ssl: z.array(z.object({ ca: z.string() })),
  verifications: z.array(z.object({ kind: z.string(), label: z.string() })),
  warnings: z.array(z.object({ label: z.string(), msg: z.string() })),
});
export type DnsZoneEffective = z.infer<typeof dnsZoneEffective>;

export const pointResult = z.object({ effective: dnsZoneEffective });
export type PointResult = z.infer<typeof pointResult>;

/** Descrições amigáveis por tipo de registro (fonte única admin+cliente). */
export const DNS_TYPE_INFO: Record<
  DnsRecordType,
  { label: string; description: string; hasPriority: boolean; placeholder: string }
> = {
  A: { label: "A", description: "Conecta seu domínio ou subdomínio a um site usando um endereço IPv4.", hasPriority: false, placeholder: "203.0.113.10" },
  AAAA: { label: "AAAA", description: "Conecta seu domínio a um site usando um endereço IPv6.", hasPriority: false, placeholder: "2001:db8::1" },
  CNAME: { label: "CNAME", description: "Aponta um subdomínio ou alias para outro domínio. Na raiz (@) não pode ser usado — use um registro A.", hasPriority: false, placeholder: "destino.exemplo.com" },
  MX: { label: "MX", description: "Controla para onde os e-mails do seu domínio são entregues.", hasPriority: true, placeholder: "10 mail.meusite.com.br" },
  TXT: { label: "TXT", description: "Guarda informações em texto, como verificações e configurações de e-mail.", hasPriority: false, placeholder: "v=spf1 include:_spf.google.com ~all" },
  NS: { label: "NS", description: "Delega um subdomínio para outros servidores de nomes.", hasPriority: false, placeholder: "ns1.exemplo.com" },
  CAA: { label: "CAA", description: "Define quais autoridades podem emitir certificados SSL para o domínio.", hasPriority: false, placeholder: '0 issue "letsencrypt.org"' },
  SRV: { label: "SRV", description: "Informa o endereço e a porta de um serviço específico (ex.: chat, VoIP).", hasPriority: true, placeholder: "10 5 443 servico.exemplo.com" },
  SOA: { label: "SOA", description: "Registro estrutural da zona (gerenciado pelo servidor).", hasPriority: false, placeholder: "" },
};

/** Presets que pré-preenchem a linha de adição (nunca salvam sozinhos). */
export const DNS_PRESETS: Array<{ id: string; label: string; type: DnsRecordType; recordLabel: string; template: string; help: string }> = [
  { id: "google-site", label: "Verificação do Google", type: "TXT", recordLabel: "@", template: "google-site-verification=", help: "Cole só o código que o Google te deu, depois do sinal de igual." },
  { id: "spf-basic", label: "E-mail: SPF básico", type: "TXT", recordLabel: "@", template: "v=spf1 include:_spf.google.com ~all", help: "SPF para envio de e-mail pelo Google Workspace." },
  { id: "mx-basic", label: "E-mail: MX", type: "MX", recordLabel: "@", template: "10 mail.meusite.com.br", help: "Troque pelo servidor de e-mail do seu provedor." },
];

/** Opções amigáveis de TTL (rótulo → segundos). */
export const DNS_TTL_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: "Automático (5 min)", seconds: 300 },
  { label: "30 minutos", seconds: 1800 },
  { label: "1 hora", seconds: 3600 },
  { label: "12 horas", seconds: 43200 },
  { label: "1 dia", seconds: 86400 },
];

/* ─────────────── Teste de velocidade (super admin) ─────────────── */

export const speedtestSource = z.enum(["cron", "manual"]);
export type SpeedtestSource = z.infer<typeof speedtestSource>;

/** Uma execução do teste de banda de internet de um nó. */
export const speedtestResult = z.object({
  id: z.string(),
  nodeId: z.string().nullable(),
  nodeName: z.string(),
  downloadMbps: z.number(),
  uploadMbps: z.number(),
  pingMs: z.number().nullable(),
  ok: z.boolean(),
  error: z.string().nullable(),
  source: speedtestSource,
  createdAt: z.string(),
});
export type SpeedtestResult = z.infer<typeof speedtestResult>;

/* ─────────────── Erro padronizado da API ─────────────── */

export const apiError = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiError>;
