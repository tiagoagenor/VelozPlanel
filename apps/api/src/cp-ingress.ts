/**
 * Ingress do CONTROL PLANE: escreve/remove vhosts do Caddy do CP que roteiam
 * <sub>.jamees.top → container do ambiente no nó, via WireGuard. O Caddy do CP
 * dá `import /etc/caddy/managed/*.caddy` e recarrega ao ver mudança no diretório
 * (volume `caddy_managed` compartilhado com o container da API em CP_INGRESS_DIR).
 * TLS por-sub é HTTP-01 automático do Caddy.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DIR = process.env.CP_INGRESS_DIR ?? "/caddy-managed";
export const SUB_ZONE = "jamees.top";

export function subFqdn(sub: string): string {
  return `${sub}.${SUB_ZONE}`;
}

function safeHost(h: string): boolean {
  return /^[a-z0-9](?:[a-z0-9.-]{1,62}[a-z0-9])$/.test(h) && !h.includes("..");
}
function safeUpstream(u: string): boolean {
  return /^[0-9a-fA-F:.\[\]]{3,45}:\d{1,5}$/.test(u);
}

/** IP WireGuard do nó a partir do agent_url (ex.: http://10.100.0.4:4100 → 10.100.0.4). */
export function wgIpFromAgentUrl(agentUrl: string | null | undefined): string | null {
  if (!agentUrl) return null;
  const m = /^https?:\/\/([^:/]+)(?::\d+)?/.exec(agentUrl);
  return m?.[1] ?? null;
}

/** Publica/atualiza o vhost do subdomínio apontando para o upstream (IP:porta na WG). */
export async function putSite(sub: string, upstream: string): Promise<void> {
  const host = subFqdn(sub);
  if (!safeHost(host) || !safeUpstream(upstream)) return;
  const block = `${host} {\n\tencode gzip zstd\n\treverse_proxy ${upstream}\n}\n`;
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${host}.caddy`), block, { mode: 0o644 });
}

/** Remove o vhost do subdomínio (libera o nome e para de renovar o cert). */
export async function removeSite(sub: string): Promise<void> {
  const host = subFqdn(sub);
  if (!safeHost(host)) return;
  await fs.rm(path.join(DIR, `${host}.caddy`), { force: true }).catch(() => {});
}
