import { randomBytes } from "node:crypto";

/**
 * Especificação de runtime por engine de serviço: variáveis do Docker (credenciais),
 * probe de readiness (rodado por exec no container) e os dados de conexão que o
 * cliente vê. Nenhuma porta é publicada — o host da conexão é o IP interno da bridge.
 */

export function genSecret(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Serviços com PAINEL WEB embutido no próprio container: a porta HTTP desse painel.
 * Ex.: a imagem `rabbitmq:3-management` serve a UI de management na 15672. Essa é a
 * porta que publicamos no host (via WireGuard) para reverse-proxear no subdomínio do
 * painel — NÃO a porta de dados do serviço (AMQP 5672, que fica só na bridge interna).
 */
export const SERVICE_UI_PORTS: Record<string, number> = {
  rabbitmq: 15672,
};

/** Porta do painel web embutido do tipo de serviço, ou null se não tem painel. */
export function serviceUiPort(typeId: string): number | null {
  return SERVICE_UI_PORTS[typeId] ?? null;
}

/**
 * Ferramentas de UI que rodam como SIDECAR (container próprio) apontando para o banco:
 * phpMyAdmin (mysql/mariadb), Adminer (postgres). Diferente do painel embutido do
 * RabbitMQ — aqui sobe um container separado no enable e remove no disable.
 * Login por FORMULÁRIO (não injeta usuário/senha): o cliente entra com as credenciais
 * do banco (que o painel mostra); o servidor já vem pré-preenchido.
 */
export interface ToolSpec {
  kind: "phpmyadmin" | "adminer"; // env_tools.kind
  image: string; // imagem do sidecar (versão travada)
  port: number; // porta HTTP interna da ferramenta (publicada no host)
  label: string; // nome exibido
  /** Env do container da ferramenta, dado o alvo (IP interno do banco + porta + URL pública). */
  env: (t: { ip: string; port: number; publicUrl: string }) => { key: string; value: string }[];
}

export const SERVICE_TOOLS: Record<string, ToolSpec> = {
  mysql: {
    kind: "phpmyadmin",
    image: "phpmyadmin:5",
    port: 80,
    label: "phpMyAdmin",
    env: (t) => [
      { key: "PMA_HOST", value: t.ip },
      { key: "PMA_PORT", value: String(t.port) },
      { key: "PMA_ABSOLUTE_URI", value: t.publicUrl }, // atrás do proxy do CP
      // sem PMA_USER/PMA_PASSWORD ⇒ phpMyAdmin mostra o formulário de login (seguro).
    ],
  },
  mariadb: {
    kind: "phpmyadmin",
    image: "phpmyadmin:5",
    port: 80,
    label: "phpMyAdmin",
    env: (t) => [
      { key: "PMA_HOST", value: t.ip },
      { key: "PMA_PORT", value: String(t.port) },
      { key: "PMA_ABSOLUTE_URI", value: t.publicUrl },
    ],
  },
  postgres: {
    kind: "adminer",
    image: "adminer:4",
    port: 8080,
    label: "Adminer",
    env: (t) => [
      { key: "ADMINER_DEFAULT_SERVER", value: t.ip }, // pré-preenche o servidor no login
      // Adminer sempre mostra o formulário (System=PostgreSQL, usuário/senha/base).
    ],
  },
};

/** Ferramenta de UI (sidecar) do tipo de serviço, ou null se não tem. */
export function serviceTool(typeId: string): ToolSpec | null {
  return SERVICE_TOOLS[typeId] ?? null;
}

export interface ServiceCreds {
  rootPassword: string;
  user: string;
  password: string;
  database: string;
}

export function makeCreds(): ServiceCreds {
  return { rootPassword: genSecret(), user: "vp_user", password: genSecret(), database: "app" };
}

export interface ServiceRuntime {
  env: { key: string; value: string }[];
  readiness: string | null;
  /** Pares chave→valor gravados em service_credentials (cifrados). */
  store: Record<string, string>;
}

/** Monta env do container + readiness + credenciais a guardar, por engine. */
export function serviceRuntime(engine: string, creds: ServiceCreds): ServiceRuntime {
  switch (engine) {
    case "redis":
      // Interno e isolado por rede; sem senha na v1 (acesso só pela bridge do dono).
      return {
        env: [],
        readiness: "redis-cli ping | grep -q PONG",
        store: {},
      };
    case "mysql":
      return {
        env: [
          { key: "MYSQL_ROOT_PASSWORD", value: creds.rootPassword },
          { key: "MYSQL_DATABASE", value: creds.database },
          { key: "MYSQL_USER", value: creds.user },
          { key: "MYSQL_PASSWORD", value: creds.password },
        ],
        readiness: 'mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" 2>/dev/null | grep -qi alive',
        store: { root_password: creds.rootPassword, user: creds.user, password: creds.password, database: creds.database },
      };
    case "mariadb":
      return {
        env: [
          { key: "MARIADB_ROOT_PASSWORD", value: creds.rootPassword },
          { key: "MARIADB_DATABASE", value: creds.database },
          { key: "MARIADB_USER", value: creds.user },
          { key: "MARIADB_PASSWORD", value: creds.password },
        ],
        readiness:
          '(mariadb-admin ping -uroot -p"$MARIADB_ROOT_PASSWORD" 2>/dev/null || mysqladmin ping -uroot -p"$MARIADB_ROOT_PASSWORD" 2>/dev/null) | grep -qi alive',
        store: { root_password: creds.rootPassword, user: creds.user, password: creds.password, database: creds.database },
      };
    case "postgres":
      return {
        env: [
          { key: "POSTGRES_PASSWORD", value: creds.rootPassword },
          { key: "POSTGRES_USER", value: creds.user },
          { key: "POSTGRES_DB", value: creds.database },
        ],
        readiness: 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q',
        store: { root_password: creds.rootPassword, user: creds.user, password: creds.password, database: creds.database },
      };
    case "rabbitmq":
      return {
        env: [
          { key: "RABBITMQ_DEFAULT_USER", value: creds.user },
          { key: "RABBITMQ_DEFAULT_PASS", value: creds.password },
        ],
        readiness: "rabbitmq-diagnostics -q ping",
        store: { user: creds.user, password: creds.password },
      };
    case "mongodb":
      // vp_user vira o usuário root (db admin); a imagem sobe com --auth. O db `app`
      // é criado preguiçosamente na 1ª escrita. `ping` não exige auth → readiness sem creds.
      return {
        env: [
          { key: "MONGO_INITDB_ROOT_USERNAME", value: creds.user },
          { key: "MONGO_INITDB_ROOT_PASSWORD", value: creds.password },
          { key: "MONGO_INITDB_DATABASE", value: creds.database },
        ],
        readiness: 'mongosh --quiet --eval "db.adminCommand(\'ping\').ok" 2>/dev/null | grep -q 1',
        store: { user: creds.user, password: creds.password, database: creds.database },
      };
    default:
      return { env: [], readiness: null, store: {} };
  }
}

/**
 * Env do container do APP de uma stack (n8n/wordpress) apontando para o banco-filho.
 * `childEngine` = engine do filho (postgres p/ n8n, mariadb p/ wordpress).
 * Para postgres o password do POSTGRES_USER é o rootPassword; para mariadb é o password.
 */
export function stackAppEnv(
  appEngine: string,
  childEngine: string,
  childCreds: ServiceCreds,
  childIp: string,
): { key: string; value: string }[] {
  if (appEngine === "n8n") {
    return [
      { key: "DB_TYPE", value: "postgresdb" },
      { key: "DB_POSTGRESDB_HOST", value: childIp },
      { key: "DB_POSTGRESDB_PORT", value: "5432" },
      { key: "DB_POSTGRESDB_DATABASE", value: childCreds.database },
      { key: "DB_POSTGRESDB_USER", value: childCreds.user },
      { key: "DB_POSTGRESDB_PASSWORD", value: childCreds.rootPassword },
      { key: "N8N_SECURE_COOKIE", value: "false" }, // acessado por http interno/proxy
      { key: "N8N_PORT", value: "5678" },
    ];
  }
  if (appEngine === "wordpress") {
    const pw = childEngine === "postgres" ? childCreds.rootPassword : childCreds.password;
    return [
      { key: "WORDPRESS_DB_HOST", value: `${childIp}:3306` },
      { key: "WORDPRESS_DB_USER", value: childCreds.user },
      { key: "WORDPRESS_DB_PASSWORD", value: pw },
      { key: "WORDPRESS_DB_NAME", value: childCreds.database },
    ];
  }
  return [];
}

/** Dados de conexão exibidos ao cliente (host = IP interno; nunca porta pública). */
export function connectionInfo(
  engine: string,
  host: string,
  port: number,
  creds: { user: string; password: string; database: string },
): Record<string, string> {
  switch (engine) {
    case "redis":
      return { host, port: String(port), url: `redis://${host}:${port}` };
    case "mysql":
    case "mariadb":
      return {
        host,
        port: String(port),
        database: creds.database,
        user: creds.user,
        password: creds.password,
        url: `mysql://${creds.user}:${creds.password}@${host}:${port}/${creds.database}`,
      };
    case "postgres":
      return {
        host,
        port: String(port),
        database: creds.database,
        user: creds.user,
        password: creds.password,
        url: `postgres://${creds.user}:${creds.password}@${host}:${port}/${creds.database}`,
      };
    case "rabbitmq":
      return {
        host,
        port: String(port),
        user: creds.user,
        password: creds.password,
        url: `amqp://${creds.user}:${creds.password}@${host}:${port}`,
      };
    case "mongodb":
      return {
        host,
        port: String(port),
        database: creds.database,
        user: creds.user,
        password: creds.password,
        url: `mongodb://${creds.user}:${creds.password}@${host}:${port}/${creds.database}?authSource=admin`,
      };
    default:
      return { host, port: String(port) };
  }
}
