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
// Zona usada pelos PAINÉIS de serviço (ex.: RabbitMQ management): subdomínio
// aleatório sob jamees.top — mesma zona dos ambientes (wildcard *.jamees.top no
// PowerDNS + cert automático). Os nomes não colidem: a geração checa tanto
// environments.auto_subdomain quanto env_tools.subdomain.
export const TOOL_ZONE = "jamees.top";

export function subFqdn(sub: string, zone: string = SUB_ZONE): string {
  return `${sub}.${zone}`;
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
export async function putSite(sub: string, upstream: string, zone: string = SUB_ZONE): Promise<void> {
  const host = subFqdn(sub, zone);
  if (!safeHost(host) || !safeUpstream(upstream)) return;
  // `header -Via/-Server/-X-Powered-By`: remove a assinatura da stack da resposta
  // final (Via: 1.1 Caddy do proxy, Server nas páginas de erro e o que o app do
  // cliente setar) — dificulta fingerprint de atacante.
  const block = `${host} {\n\tencode gzip zstd\n\theader -Via\n\theader -Server\n\theader -X-Powered-By\n\treverse_proxy ${upstream}\n}\n`;
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${host}.caddy`), block, { mode: 0o644 });
}

/** Remove o vhost do subdomínio (libera o nome e para de renovar o cert). */
export async function removeSite(sub: string, zone: string = SUB_ZONE): Promise<void> {
  const host = subFqdn(sub, zone);
  if (!safeHost(host)) return;
  await fs.rm(path.join(DIR, `${host}.caddy`), { force: true }).catch(() => {});
}
