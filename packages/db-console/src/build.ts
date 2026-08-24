import type { StudioEngine, DbRunMongoInput } from "@velozplanel/contracts";
import { classifySql, classifyMongo, DbConsoleError } from "./classify";
import { MONGO_WRAPPER_JS } from "./mongoWrapper";

const DEFAULT_DB = "app";

/** Plano de execução para o agente rodar via `docker exec`. */
export interface ExecPlan {
  engine: StudioEngine;
  /** Cmd do docker exec: ["sh","-c", script]. */
  cmd: string[];
  /** Env do exec (NUNCA contém a senha — ela é referenciada por nome, vinda da env do container). */
  env: string[];
  /** Como parsear o stdout. */
  outputKind: "sql-tsv" | "pg-csv" | "mongo-ejson";
  isWrite: boolean;
  timeoutMs: number;
}

/** Config de cada engine relacional a partir das env vars que o container já tem. */
const SQL_ENGINE: Record<
  "mysql" | "mariadb" | "postgres",
  { bin: string; pwEnv: string; kind: "mysql" | "pg" }
> = {
  mysql: { bin: "mysql", pwEnv: "MYSQL_ROOT_PASSWORD", kind: "mysql" },
  mariadb: { bin: "mariadb", pwEnv: "MARIADB_ROOT_PASSWORD", kind: "mysql" },
  postgres: { bin: "psql", pwEnv: "POSTGRES_PASSWORD", kind: "pg" },
};

/** Monta o plano para um statement SQL já classificado. */
export function buildSqlExec(
  engine: "mysql" | "mariadb" | "postgres",
  input: { sql: string; write?: boolean; database?: string },
): ExecPlan {
  const cls = classifySql(engine, input.sql);
  const write = input.write === true;
  if (cls.isWrite && !write) {
    throw new DbConsoleError("escrita_requer_modo_escrita", "esta operação altera dados — habilite o modo escrita");
  }
  const db = input.database ?? DEFAULT_DB;
  const cfg = SQL_ENGINE[engine];
  const readOnly = !cls.isWrite;

  if (cfg.kind === "mysql") {
    // Timeout: mysql usa max_execution_time (ms, só SELECT); mariadb usa max_statement_time (s, todos).
    const setTimeout =
      engine === "mariadb" ? "SET SESSION max_statement_time=25; " : "SET SESSION max_execution_time=25000; ";
    const wrapped = readOnly
      ? `${setTimeout}START TRANSACTION READ ONLY; ${cls.sql}; COMMIT`
      : `${cls.sql}; SELECT ROW_COUNT() AS affected_rows`;
    const script =
      `export MYSQL_PWD="$${cfg.pwEnv}"; ` +
      `exec ${cfg.bin} -uroot --batch --database "$VP_DB" -e "$VP_SQL"`;
    return {
      engine,
      cmd: ["sh", "-c", script],
      env: [`VP_DB=${db}`, `VP_SQL=${wrapped}`],
      outputKind: "sql-tsv",
      isWrite: cls.isWrite,
      timeoutMs: 35_000,
    };
  }

  // postgres — read-only COMPLETO via PGOPTIONS (transação implícita read-only).
  const pgoptions = readOnly
    ? "-c default_transaction_read_only=on -c statement_timeout=25000"
    : "-c statement_timeout=25000";
  const script =
    `export PGPASSWORD="$POSTGRES_PASSWORD"; export PGOPTIONS="$VP_PGOPTIONS"; ` +
    `exec psql -U "$POSTGRES_USER" -d "$VP_DB" --csv -P null='\\N' -v ON_ERROR_STOP=1 -c "$VP_SQL"`;
  return {
    engine,
    cmd: ["sh", "-c", script],
    env: [`VP_DB=${db}`, `VP_SQL=${cls.sql}`, `VP_PGOPTIONS=${pgoptions}`],
    outputKind: "pg-csv",
    isWrite: cls.isWrite,
    timeoutMs: 35_000,
  };
}

/** Monta o plano para uma operação Mongo (whitelist + wrapper estático, args como dados). */
export function buildMongoExec(input: DbRunMongoInput): ExecPlan {
  const cls = classifyMongo(input.op, input.args);
  const write = input.write === true;
  if (cls.isWrite && !write) {
    throw new DbConsoleError("escrita_requer_modo_escrita", "esta operação altera dados — habilite o modo escrita");
  }
  const db = input.database ?? DEFAULT_DB;
  // args vão como DADOS (Extended JSON) numa env var lida por EJSON.parse no wrapper.
  const argsEjson = JSON.stringify({
    op: input.op,
    collection: input.collection,
    write,
    ...(input.args ?? {}),
  });
  const uri =
    'mongodb://$MONGO_INITDB_ROOT_USERNAME:$MONGO_INITDB_ROOT_PASSWORD@127.0.0.1:27017/$VP_DB?authSource=admin';
  const script = `exec mongosh "${uri}" --quiet --eval "$VP_WRAP"`;
  return {
    engine: "mongodb",
    cmd: ["sh", "-c", script],
    env: [`VP_DB=${db}`, `VP_ARGS=${argsEjson}`, `VP_WRAP=${MONGO_WRAPPER_JS}`],
    outputKind: "mongo-ejson",
    isWrite: cls.isWrite,
    timeoutMs: 35_000,
  };
}
