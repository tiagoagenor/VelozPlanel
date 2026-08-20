import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Conexão única com o Postgres do control plane.
 * `sql` é o driver bruto (usado para DDL no push-and-seed); `db` é o Drizzle tipado.
 */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://veloz:veloz_dev@localhost:5433/velozpanel";

export const sql = postgres(DATABASE_URL);

export const db = drizzle(sql, { schema });
