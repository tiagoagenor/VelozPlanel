import { z } from "zod";

/**
 * Contratos do Jamees Studio (console de banco embutido). Tipos do fio
 * API↔painel; a lógica de execução (classificar/montar/parsear) mora no pacote
 * central `@velozplanel/db-console`.
 */

// NB: já existe um `studioEngine`/`DbEngine` (= só "mysql") em index.ts para a feature
// legada de bancos gerenciados. Aqui usamos nome próprio para não colidir.
export const studioEngine = z.enum(["mysql", "mariadb", "postgres", "mongodb", "redis"]);
export type StudioEngine = z.infer<typeof studioEngine>;

/** Engines relacionais (SQL) — Mongo é tratado à parte. */
export function isSqlEngine(e: StudioEngine): e is "mysql" | "mariadb" | "postgres" {
  return e === "mysql" || e === "mariadb" || e === "postgres";
}

/** Valor de célula: null, texto, ou binário (hex) quando não é UTF-8 válido. */
export const dbCell = z.union([z.null(), z.string(), z.object({ b: z.literal(true), hex: z.string() })]);
export type DbCell = z.infer<typeof dbCell>;

export const dbRowsResult = z.object({
  kind: z.literal("rows"),
  columns: z.array(z.string()),
  rows: z.array(z.array(dbCell)),
  truncated: z.boolean(),
  tookMs: z.number().int().nonnegative().optional(),
});

export const dbCommandResult = z.object({
  kind: z.literal("command"),
  command: z.string(), // ex.: "INSERT", "UPDATE", "CREATE TABLE"
  affectedRows: z.number().int().nullable(),
  tookMs: z.number().int().nonnegative().optional(),
});

export const dbMongoResult = z.object({
  kind: z.literal("mongo"),
  op: z.string(),
  ejson: z.string(), // Extended JSON canônico (o painel parseia)
  truncated: z.boolean(),
  tookMs: z.number().int().nonnegative().optional(),
});

/** Valor de resposta do Redis: recursivo (nil, texto, número, bool, binário, array). */
export type RedisValue = null | string | number | boolean | { b: true; hex: string } | RedisValue[];
export const redisValue: z.ZodType<RedisValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.object({ b: z.literal(true), hex: z.string() }),
    z.array(redisValue),
  ]),
);

export const dbRedisResult = z.object({
  kind: z.literal("redis"),
  replyType: z.enum(["string", "integer", "status", "nil", "error", "array"]),
  value: redisValue,
  truncated: z.boolean(),
  tookMs: z.number().int().nonnegative().optional(),
});

export const dbResult = z.discriminatedUnion("kind", [dbRowsResult, dbCommandResult, dbMongoResult, dbRedisResult]);
export type DbResult = z.infer<typeof dbResult>;
export type DbRowsResult = z.infer<typeof dbRowsResult>;
export type DbCommandResult = z.infer<typeof dbCommandResult>;
export type DbMongoResult = z.infer<typeof dbMongoResult>;
export type DbRedisResult = z.infer<typeof dbRedisResult>;

/** Operações Mongo permitidas (whitelist fechada). */
export const dbMongoOp = z.enum([
  "find",
  "aggregate",
  "count",
  "distinct",
  "listCollections",
  "listIndexes",
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "createCollection",
  "createIndex",
]);
export type DbMongoOp = z.infer<typeof dbMongoOp>;

/** Entrada de execução SQL (mysql/mariadb/postgres). */
export const dbRunSqlInput = z.object({
  sql: z.string().trim().min(1).max(200_000),
  write: z.boolean().optional().default(false),
  database: z
    .string()
    .regex(/^[A-Za-z0-9_$-]{1,64}$/)
    .optional(),
});
export type DbRunSqlInput = z.infer<typeof dbRunSqlInput>;

/** Entrada de execução Mongo (operação estruturada, nunca eval livre). */
export const dbRunMongoInput = z.object({
  op: dbMongoOp,
  collection: z
    .string()
    .regex(/^[A-Za-z0-9_.$-]{1,120}$/)
    .optional(),
  args: z.record(z.string(), z.unknown()).optional(), // filter/projection/sort/limit/pipeline/doc/update/keys/options
  write: z.boolean().optional().default(false),
  database: z
    .string()
    .regex(/^[A-Za-z0-9_$-]{1,64}$/)
    .optional(),
});
export type DbRunMongoInput = z.infer<typeof dbRunMongoInput>;

/** Entrada de execução Redis (comando já tokenizado; DB numérico 0-15). */
export const dbRunRedisInput = z.object({
  command: z.array(z.string().max(512_000)).min(1).max(64),
  db: z.number().int().min(0).max(15).optional().default(0),
  write: z.boolean().optional().default(false),
});
export type DbRunRedisInput = z.infer<typeof dbRunRedisInput>;

/** Configuração do Studio por ambiente (liga/desliga + senha opcional). */
export const dbStudioConfig = z.object({
  enabled: z.boolean(),
  hasPassword: z.boolean(),
  engine: studioEngine.nullable(),
  database: z.string().nullable(),
  unlocked: z.boolean(), // sessão já passou pela senha (ou não há senha)
});
export type DbStudioConfig = z.infer<typeof dbStudioConfig>;

export const setStudioPasswordInput = z.object({
  password: z.string().min(4).max(200).nullable(), // null = remover a senha
});
export type SetStudioPasswordInput = z.infer<typeof setStudioPasswordInput>;

export const unlockStudioInput = z.object({ password: z.string().min(1).max(200) });
export type UnlockStudioInput = z.infer<typeof unlockStudioInput>;
