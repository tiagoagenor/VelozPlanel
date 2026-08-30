/**
 * Ingress por domínio: escreve/remove blocos de site do Caddy (nativo do nó) em
 * um diretório vigiado por um systemd path unit, que recarrega o Caddy sozinho.
 * Só faz sentido em nós públicos que tenham Caddy (o diretório é montado no
 * container do agente). Em nós sem Caddy, `available()` é false.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const SITES_DIR = process.env.CADDY_SITES_DIR ?? "/etc/caddy/managed";
/** Porta EXCLUSIVA da borda HTTP das VPS (nunca 80). Domínio roteia por aqui -> VM:web. */
const VPS_HTTP_PORT = Number(process.env.VPS_HTTP_PORT ?? 8080);

function safeDomain(domain: string): string {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!/^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/.test(d)) {
    throw new Error(`domínio inválido: ${domain}`);
  }
  return d;
}

function safeUpstream(upstream: string, expectHost?: string): string {
  const u = upstream.trim();
  // host:port (IP/hostname + porta)
  const m = /^([a-z0-9.\-_]+):(\d{1,5})$/i.exec(u);
  if (!m) throw new Error(`upstream inválido: ${upstream}`);
  // Anti-SSRF/pivô: quando o chamador conhece o IP do destino (ex.: VPS), exige que o
  // host do upstream seja EXATAMENTE ele — impede apontar um vhost para mysql/mongo/
  // docker0/mesh por bug ou caminho futuro.
  if (expectHost && m[1] !== expectHost) {
    throw new Error(`upstream host ${m[1]} != esperado ${expectHost}`);
  }
  return u;
}

export interface SiteOptions {
  /** Exige que o host do upstream seja exatamente este (IP da VPS do tenant). Anti-SSRF. */
  expectUpstreamHost?: string;
  /**
   * Vhost de VPS: o guest pode ainda não ter servidor na porta web. Adiciona health
   * check ativo + página 502 amigável, e força os cabeçalhos X-Forwarded-* com os
   * valores reais (descartando o que o cliente tentou injetar).
   */
  vps?: boolean;
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
export async function putSite(domain: string, upstream: string, opts: SiteOptions = {}): Promise<void> {
  const d = safeDomain(domain);
  const up = safeUpstream(upstream, opts.expectUpstreamHost);
  // `header -Via/-Server/-X-Powered-By`: remove a assinatura da stack da resposta
  // final (Via: 1.1 Caddy do proxy, Server nas páginas de erro e o que o app do
  // cliente setar) — dificulta fingerprint de atacante.
  //
  // Vhost de VPS (`opts.vps`): o guest é uma VM cheia com root — pode não ter web na
  // porta ainda, e um cliente pode tentar forjar X-Forwarded-*. Adicionamos:
  //   - health check ativo -> derruba o upstream e cai no 502 amigável se não responder;
  //   - X-Forwarded-For/Proto/Host forçados com o valor REAL (descarta o do cliente).
  let proxyBody = "";
  let errorsBlock = "";
  if (opts.vps) {
    proxyBody =
      ` {\n` +
      `\t\theader_up X-Forwarded-For {remote_host}\n` +
      `\t\theader_up X-Forwarded-Proto {scheme}\n` +
      `\t\theader_up X-Forwarded-Host {host}\n` +
      `\t\thealth_uri /\n` +
      `\t\thealth_interval 15s\n` +
      `\t\thealth_timeout 5s\n` +
      `\t}`;
    errorsBlock =
      `\thandle_errors {\n` +
      `\t\trespond "Seu VPS ainda nao respondeu na porta web. Verifique o servico dentro da VM." 502\n` +
      `\t}\n`;
  }
  // VPS: serve o domínio numa PORTA EXCLUSIVA (não 80). O endereço do site inclui a
  // porta, então o Caddy escuta nela (HTTP simples no piloto — sem depender da 80/443,
  // que a casa/ISP pode bloquear e o apache já ocupa a 80).
  const siteAddr = opts.vps ? `http://${d}:${VPS_HTTP_PORT}` : d;
  const block =
    `# gerenciado pelo VelozPanel\n${siteAddr} {\n` +
    `\tencode gzip zstd\n` +
    `\theader -Via\n\theader -Server\n\theader -X-Powered-By\n` +
    `\treverse_proxy ${up}${proxyBody}\n` +
    errorsBlock +
    `}\n`;
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
