/**
 * Classifica RRsets protegidos, para a UI mostrar cadeados e a API barrar edições
 * perigosas.
 *
 *  - `system`: registros que fazem a PRÓPRIA zona funcionar (SOA no ápice, NS no
 *    ápice, e o A/AAAA de glue dos nameservers ns1/ns2). Bloqueados de vez.
 *  - `panel`: registros que apontam para a infra do painel (env
 *    `PANEL_PROTECTED_TARGETS`, CSV de FQDNs/IPs). Editáveis só com atrito.
 */
import type { DnsProtectedReason } from "@velozplanel/contracts";
import { NS_HOSTS, fqdnOf } from "./dns-pdns";

const PANEL_TARGETS = (process.env.PANEL_PROTECTED_TARGETS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export interface Protection {
  protected: boolean;
  protectedReason: DnsProtectedReason;
  protectedMsg: string | null;
}

const NONE: Protection = { protected: false, protectedReason: null, protectedMsg: null };

/** Decide a proteção de um RRset (name relativo à zona, type, conteúdos). */
export function classifyRRset(
  zone: string,
  name: string,
  type: string,
  records: string[],
): Protection {
  const apex = name === "@" || name === "" || name.replace(/\.$/, "").toLowerCase() === zone.replace(/\.$/, "").toLowerCase();
  const fqdn = fqdnOf(zone, name).replace(/\.$/, "");
  const nsGlue = NS_HOSTS.has(fqdn);

  // SOA/NS do ápice = coração da zona.
  if (apex && (type === "SOA" || type === "NS")) {
    return {
      protected: true,
      protectedReason: "system",
      protectedMsg: "Registro estrutural da zona (SOA/NS). Gerenciado pelo servidor — não editável.",
    };
  }
  // Glue dos nameservers.
  if (nsGlue && (type === "A" || type === "AAAA")) {
    return {
      protected: true,
      protectedReason: "system",
      protectedMsg: "Endereço dos nameservers (glue). Necessário para a delegação — não editável.",
    };
  }
  // SOA fora do ápice não existe; qualquer SOA é system por segurança.
  if (type === "SOA") {
    return { protected: true, protectedReason: "system", protectedMsg: "Registro SOA — gerenciado pelo servidor." };
  }
  // Aponta para a infra do painel.
  if (PANEL_TARGETS.length) {
    const hit = records.some((c) => {
      const v = c.trim().toLowerCase().replace(/\.$/, "");
      const host = v.includes(" ") ? v.split(/\s+/).pop()!.replace(/\.$/, "") : v;
      return PANEL_TARGETS.includes(v) || PANEL_TARGETS.includes(host);
    });
    if (hit) {
      return {
        protected: true,
        protectedReason: "panel",
        protectedMsg: "Aponta para a infraestrutura do painel. Alterar pode derrubar o acesso — edite com cuidado.",
      };
    }
  }
  return NONE;
}
