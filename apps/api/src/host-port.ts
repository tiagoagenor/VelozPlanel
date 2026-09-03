import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { environments } from "./db/schema";

/**
 * Alocador de porta de host ESTÁVEL por ambiente.
 *
 * Motivo: containers publicados com HostPort "" ganham porta EFÊMERA que o Docker
 * REALOCA a cada reboot do nó — deixando o vhost do Caddy do CP (reverse_proxy
 * ip:porta) apontando para uma porta morta → 502 em todos os ambientes do nó.
 * Com uma porta FIXA no PortBindings, o Docker religa exatamente a mesma porta no
 * reboot e o vhost continua válido, sem downtime.
 *
 * A faixa [MIN,MAX] é DISJUNTA do range efêmero do Docker (32768–60999), então uma
 * porta recém-alocada nunca colide com um container legado (ainda) sem porta fixa.
 * A porta escolhida é persistida em `environments.http_port` (mesma coluna que já
 * guardava a porta viva — agora ela é estável).
 */
const MIN = Number(process.env.VP_HOST_PORT_MIN ?? 20000);
const MAX = Number(process.env.VP_HOST_PORT_MAX ?? 29999);

/** Uma porta já está na faixa fixa gerenciada? */
export function isFixedPort(port: number | null | undefined): boolean {
  return !!port && port >= MIN && port <= MAX;
}

/**
 * Devolve a porta de host estável do ambiente. Idempotente: se ele JÁ tem uma porta
 * fixa na faixa (recreate/retry), reusa a mesma — o container volta na mesma porta e
 * o vhost não precisa mudar. Senão escolhe a menor livre da faixa não usada por OUTRO
 * ambiente no MESMO nó. Em corrida rara a porta pode acabar ocupada no nó: o agente
 * cai no fallback efêmero e o reconciliador de vhost conserta o Caddy no próximo ciclo.
 */
export async function allocateHostPort(
  nodeId: string,
  envId: string,
  currentPort: number | null,
): Promise<number> {
  if (isFixedPort(currentPort)) return currentPort as number;
  const rows = await db
    .select({ id: environments.id, httpPort: environments.httpPort })
    .from(environments)
    .where(eq(environments.nodeId, nodeId));
  const used = new Set<number>();
  for (const r of rows) {
    if (r.id !== envId && r.httpPort && r.httpPort >= MIN && r.httpPort <= MAX) used.add(r.httpPort);
  }
  for (let p = MIN; p <= MAX; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error(`sem portas de host livres na faixa ${MIN}-${MAX} no nó`);
}
