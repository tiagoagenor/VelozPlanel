/**
 * @velozplanel/db-console — motor central do Jamees Studio.
 * Lógica ÚNICA de protocolo de banco (classificar/montar/parsear), reusada pela
 * API (classifica/valida) e pelo agente (executa via docker exec). Ponto de
 * troca para um transporte futuro (db-gateway sidecar) sem mexer no resto.
 */
export { DbConsoleError, classifySql, classifyMongo, assertSingleStatement, firstVerb } from "./classify";
export type { SqlClassification } from "./classify";
export { buildSqlExec, buildMongoExec } from "./build";
export type { ExecPlan } from "./build";
export { parseExec } from "./parse";
export type { ExecOutput } from "./parse";
export { MONGO_WRAPPER_JS } from "./mongoWrapper";

import type { StudioEngine } from "@velozplanel/contracts";

/** Env var da senha no container, por engine (setada no provision — services.ts). */
export const ENGINE_PW_ENV: Record<StudioEngine, string> = {
  mysql: "MYSQL_ROOT_PASSWORD",
  mariadb: "MARIADB_ROOT_PASSWORD",
  postgres: "POSTGRES_PASSWORD",
  mongodb: "MONGO_INITDB_ROOT_PASSWORD",
};
