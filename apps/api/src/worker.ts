import postgres from "postgres";
import type { FastifyBaseLogger } from "fastify";
import { hostname } from "node:os";
import { DATABASE_URL } from "./db/client";
import type { JobRow } from "./db/schema";
import { runProvisionJob, runDeleteJob, PermanentJobError } from "./provisioner";
import { db } from "./db/client";
import { eq } from "drizzle-orm";
import { environments } from "./db/schema";

/**
 * Worker da fila de jobs (provisionar/remover ambiente). Roda como loop no
 * processo da API (mesmo modelo do billing). Escala horizontal de graça: cada
 * réplica roda o worker; SKIP LOCKED + advisory lock por env evitam colisão.
 * Self-hosted: usa só o Postgres do control-plane (na WireGuard).
 */

const CONCURRENCY = Number(process.env.VP_WORKER_CONCURRENCY ?? 2);
const POLL_MS = 2000;
const WORKER_ID = `${hostname()}:${process.pid}`;

export function startProvisionWorker(log: FastifyBaseLogger): () => void {
  // Pool DEDICADO — conexões reservadas (lock de sessão) não podem esfomear o pool HTTP.
  const wsql = postgres(DATABASE_URL, { max: CONCURRENCY + 2 });
  let inFlight = 0;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      // Reaper: re-enfileira jobs "running" cujo heartbeat expirou (worker morto).
      await wsql`
        update jobs set status='queued', locked_by=null, locked_at=null,
          last_error = coalesce(last_error,'') || ' [reaped]', updated_at=now()
        where status='running' and heartbeat_at < now() - interval '90 seconds'
      `;
      // Poda jobs terminados antigos.
      await wsql`delete from jobs where status in ('done','canceled') and finished_at < now() - interval '7 days'`;

      while (inFlight < CONCURRENCY) {
        // postgres-js cru devolve colunas snake_case — mapeamos para JobRow (camelCase).
        const claimed = await wsql<Array<Record<string, unknown>>>`
          with next as (
            select id from jobs
             where status='queued' and run_after <= now()
             order by run_after, created_at
             for update skip locked
             limit 1
          )
          update jobs j set status='running', locked_by=${WORKER_ID}, locked_at=now(),
            heartbeat_at=now(), attempts=attempts+1, updated_at=now()
          from next where j.id = next.id
          returning j.*
        `;
        const raw = claimed[0];
        if (!raw) break;
        const job = mapJob(raw);
        inFlight++;
        void runJob(wsql, job, log).finally(() => { inFlight--; });
      }
    } catch (err) {
      log.error({ err }, "worker tick falhou");
    }
  }

  const handle = setInterval(() => void tick(), POLL_MS);
  handle.unref?.();

  return () => {
    stopped = true;
    clearInterval(handle);
    void wsql.end({ timeout: 5 });
  };
}

/** Executa um job com lock de sessão por env (na MESMA conexão reservada). */
async function runJob(wsql: postgres.Sql, job: JobRow, log: FastifyBaseLogger): Promise<void> {
  const conn = await wsql.reserve();
  let hb: NodeJS.Timeout | null = null;
  try {
    // Serializa por env (lock de sessão): garante ≤1 job por ambiente no cluster.
    const got = await conn<{ ok: boolean }[]>`select pg_try_advisory_lock(hashtextextended(${job.envId}, 0)) as ok`;
    if (!got[0]?.ok) {
      // Outro worker está com esse env — devolve para daqui a pouco.
      await conn`update jobs set status='queued', run_after=now()+interval '5 seconds', locked_by=null, updated_at=now() where id=${job.id}`;
      return;
    }
    // Heartbeat: mantém o job vivo (reaper não mata) durante operações longas.
    hb = setInterval(() => { void heartbeat(conn, job.id); }, 20_000);

    if (job.kind === "provision_env") await runProvisionJob(job);
    else if (job.kind === "delete_env") await runDeleteJob(job);
    else throw new PermanentJobError(`kind desconhecido: ${job.kind}`);

    await conn`update jobs set status='done', finished_at=now(), updated_at=now(), last_error=null where id=${job.id}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentJobError;
    const exhausted = job.attempts >= job.maxAttempts;
    if (permanent || exhausted) {
      await conn`update jobs set status='failed', finished_at=now(), last_error=${msg.slice(0, 800)}, updated_at=now() where id=${job.id}`;
      // Espelha a falha no ambiente (provision → error; delete preso → error).
      await db.update(environments).set({ state: "error", errorMessage: msg.slice(0, 500) }).where(eq(environments.id, job.envId)).catch(() => {});
      log.warn({ jobId: job.id, envId: job.envId, kind: job.kind, msg }, "job falhou (terminal)");
    } else {
      // Retry com backoff exponencial + jitter.
      await conn`
        update jobs set status='queued', locked_by=null, locked_at=null,
          run_after = now() + least(interval '300 seconds', power(2, attempts) * interval '5 seconds') + random() * interval '2 seconds',
          last_error=${msg.slice(0, 800)}, updated_at=now()
        where id=${job.id}
      `;
      log.info({ jobId: job.id, attempt: job.attempts, msg }, "job re-enfileirado (retry)");
    }
  } finally {
    if (hb) clearInterval(hb);
    await conn`select pg_advisory_unlock(hashtextextended(${job.envId}, 0))`.catch(() => {});
    conn.release();
  }
}

async function heartbeat(conn: postgres.ReservedSql, jobId: string): Promise<void> {
  await conn`update jobs set heartbeat_at=now() where id=${jobId}`.catch(() => {});
}

/** Mapeia a linha crua (snake_case do postgres-js) para JobRow (camelCase). */
function mapJob(r: Record<string, unknown>): JobRow {
  return {
    id: r.id as string,
    kind: r.kind as string,
    envId: r.env_id as string,
    payload: r.payload as JobRow["payload"],
    status: r.status as string,
    attempts: r.attempts as number,
    maxAttempts: r.max_attempts as number,
    runAfter: r.run_after as Date,
    lockedBy: (r.locked_by as string) ?? null,
    lockedAt: (r.locked_at as Date) ?? null,
    heartbeatAt: (r.heartbeat_at as Date) ?? null,
    lastError: (r.last_error as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    finishedAt: (r.finished_at as Date) ?? null,
  };
}
