/**
 * Ingress por domínio: escreve/remove blocos de site do Caddy (nativo do nó) em
 * um diretório vigiado por um systemd path unit, que recarrega o Caddy sozinho.
 * Só faz sentido em nós públicos que tenham Caddy (o diretório é montado no
 * container do agente). Em nós sem Caddy, `available()` é false.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const SITES_DIR = process.env.CADDY_SITES_DIR ?? "/etc/caddy/managed";

function safeDomain(domain: string): string {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!/^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/.test(d)) {
    throw new Error(`domínio inválido: ${domain}`);
  }
  return d;
}

function safeUpstream(upstream: string): string {
  const u = upstream.trim();
  // host:port (IP/hostname + porta)
  if (!/^[a-z0-9.\-_]+:\d{1,5}$/i.test(u)) throw new Error(`upstream inválido: ${upstream}`);
  return u;
}

/** O diretório de sites está disponível (nó com Caddy gerenciável)? */
export async function available(): Promise<boolean> {
  try {
    await fs.access(SITES_DIR);
    return true;
  } catch {
    return false;
  }
}

/** Publica (ou atualiza) o vhost do domínio apontando para o upstream. */
export async function putSite(domain: string, upstream: string): Promise<void> {
  const d = safeDomain(domain);
  const up = safeUpstream(upstream);
  // `header -Via/-Server/-X-Powered-By`: remove a assinatura da stack da resposta
  // final (Via: 1.1 Caddy do proxy, Server nas páginas de erro e o que o app do
  // cliente setar) — dificulta fingerprint de atacante.
  const block = `# gerenciado pelo VelozPanel\n${d} {\n\tencode gzip zstd\n\theader -Via\n\theader -Server\n\theader -X-Powered-By\n\treverse_proxy ${up}\n}\n`;
  await fs.mkdir(SITES_DIR, { recursive: true });
  const file = path.join(SITES_DIR, `${d}.caddy`);
  await fs.writeFile(file, block, { mode: 0o644 });
  // Garante leitura pelo usuário do Caddy mesmo se o umask apertar.
  await fs.chmod(file, 0o644).catch(() => {});
}

/** Remove o vhost do domínio. */
export async function removeSite(domain: string): Promise<void> {
  const d = safeDomain(domain);
  await fs.rm(path.join(SITES_DIR, `${d}.caddy`), { force: true });
}
