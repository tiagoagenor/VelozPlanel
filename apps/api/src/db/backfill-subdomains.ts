/**
 * Bootstrap + backfill do subdomínio temporário jamees.top:
 *  1. Cria o wildcard `*.jamees.top A <CP>` no PowerDNS (idempotente).
 *  2. Atribui um subdomínio aleatório a cada ambiente WEB que ainda não tem.
 *  3. Escreve o vhost do Caddy do CP para os que estão running/paused.
 * Rodar 1×: `pnpm --filter @velozplanel/api exec tsx src/db/backfill-subdomains.ts`
 */
import { isNotNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { environments, nodes } from "./schema";
import { generateSubdomain } from "../subdomain";
import * as cpIngress from "../cp-ingress";
import * as pdns from "../dns-pdns";

const CP_IP = process.env.CP_PUBLIC_IP ?? "187.127.49.205";
const ZONE = "jamees.top";

async function main(): Promise<void> {
  // 1. Wildcard *.jamees.top → control plane.
  try {
    await pdns.replaceRRsets(ZONE, [
      { name: `*.${ZONE}.`, type: "A", ttl: 300, records: [{ content: CP_IP, disabled: false }] },
    ]);
    console.log(`[backfill-subs] wildcard *.${ZONE} A ${CP_IP} ok`);
  } catch (e) {
    console.error("[backfill-subs] falha ao criar wildcard:", e instanceof Error ? e.message : e);
  }

  // 2+3. Ambientes web (têm http_port), exceto filhos de stack (DB).
  const rows = await db.select().from(environments).where(isNotNull(environments.httpPort));
  let assigned = 0, wrote = 0;
  for (const env of rows) {
    if (env.parentEnvId) continue;
    let sub = env.autoSubdomain;
    if (!sub) {
      sub = await generateSubdomain();
      await db.update(environments).set({ autoSubdomain: sub }).where(eq(environments.id, env.id));
      assigned++;
    }
    if ((env.state === "running" || env.state === "paused") && env.nodeId && env.httpPort) {
      const [n] = await db.select({ agentUrl: nodes.agentUrl }).from(nodes).where(eq(nodes.id, env.nodeId)).limit(1);
      const ip = cpIngress.wgIpFromAgentUrl(n?.agentUrl);
      if (ip) { await cpIngress.putSite(sub, `${ip}:${env.httpPort}`); wrote++; }
    }
  }
  console.log(`[backfill-subs] subdomínios atribuídos=${assigned} · vhosts escritos=${wrote}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
