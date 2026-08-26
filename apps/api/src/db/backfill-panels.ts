/**
 * Backfill do painel admin de serviço (rabbitmq): liga o painel dos ambientes que
 * já existiam antes da feature "exposto por padrão na criação". Para cada serviço
 * com painel embutido (serviceUiPort), garante a porta publicada e escreve o vhost
 * em jamees.com, marcando env_tools(enabled=true).
 * Rodar 1×: `pnpm --filter @velozplanel/api exec tsx src/db/backfill-panels.ts`
 */
import { db } from "./client";
import { environments } from "./schema";
import { serviceUiPort } from "../services";
import { ensureServiceUiPublished } from "../provisioner";
import { enablePanel, loadPanelRow } from "../service-panel";

async function main(): Promise<void> {
  const rows = await db.select().from(environments);
  let done = 0;
  for (const env of rows) {
    if (!serviceUiPort(env.typeId ?? "")) continue; // só serviços com painel
    if (env.state !== "running" && env.state !== "paused") continue;
    const existing = await loadPanelRow(env.id);
    if (existing?.enabled) {
      console.log(`[backfill-panels] ${env.name} (${env.id}) já ligado — pulando`);
      continue;
    }
    try {
      let e = env;
      if (!e.httpPort) {
        console.log(`[backfill-panels] ${env.name}: publicando porta do painel…`);
        e = await ensureServiceUiPublished(env.id);
      }
      const sub = await enablePanel(e);
      if (sub) {
        console.log(`[backfill-panels] ${env.name} (${env.id}) → https://${sub}.jamees.com`);
        done++;
      } else {
        console.log(`[backfill-panels] ${env.name}: não foi possível ligar (rota/porta)`);
      }
    } catch (err) {
      console.log(`[backfill-panels] ${env.name}: erro — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`[backfill-panels] pronto. Painéis ligados: ${done}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
