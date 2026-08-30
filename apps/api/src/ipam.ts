import { sql } from "./db/client";

/**
 * IPAM do control plane: cada (dono, nó) recebe um /24 (bridge veloz-u<slot>); cada
 * container (app/banco/ferramenta) recebe um IP fixo dentro dele. A alocação roda sob
 * advisory lock por nó (rápido, solto antes de qualquer chamada ao agente), com o
 * livro-razão em owner_networks + env_addresses. Sem colisão por construção.
 *
 * Obs.: enquanto não há roteamento entre nós, o mesmo /24 pode repetir em nós
 * diferentes sem problema (isolados fisicamente). O 2º octeto fixo (201) evita
 * conflito com WG (10.77/10.100) e docker0 (172.17).
 */

export interface Allocation {
  subnet: string; // ex.: 10.201.3.0/24
  gateway: string; // ex.: 10.201.3.1
  bridgeName: string; // veloz-u3
  ip: string; // IP fixo do container
}

/** Aloca (ou reusa) a rede do dono no nó e um IP livre para um container. */
export async function allocateAddress(
  nodeId: string,
  ownerId: string,
  envId: string,
  role: string,
): Promise<Allocation> {
  return sql.begin(async (tx) => {
    // serializa a alocação de IPAM deste nó (ms) — solto no COMMIT.
    await tx`select pg_advisory_xact_lock(hashtext(${"ipam:" + nodeId}))`;

    let net = (
      await tx`select * from owner_networks where node_id = ${nodeId} and owner_id = ${ownerId} limit 1`
    )[0];

    // Idempotente: se já há um IP para (env, papel), reusa (retry não duplica).
    const already = (
      await tx<{ ip: string }[]>`select ip from env_addresses where env_id = ${envId} and role = ${role} limit 1`
    )[0];
    if (already && net) {
      return { subnet: net!.subnet, gateway: net!.gateway, bridgeName: net!.bridge_name, ip: already.ip };
    }

    if (!net) {
      const nextRows = await tx`select coalesce(max(slot), -1) + 1 as next from owner_networks where node_id = ${nodeId}`;
      const slot: number = nextRows[0]!.next;
      if (slot > 255) throw new Error("no_owner_subnet: nó sem /24 livre para novos donos");
      const subnet = `10.201.${slot}.0/24`;
      const gateway = `10.201.${slot}.1`;
      const bridgeName = `veloz-u${slot}`;
      net = (
        await tx`
          insert into owner_networks (node_id, owner_id, slot, subnet, gateway, bridge_name)
          values (${nodeId}, ${ownerId}, ${slot}, ${subnet}, ${gateway}, ${bridgeName})
          returning *
        `
      )[0];
    }

    const base = `10.201.${net!.slot}.`;
    const used = await tx<{ ip: string }[]>`select ip from env_addresses where node_id = ${nodeId}`;
    const usedSet = new Set(used.map((r) => r.ip));
    let ip: string | null = null;
    for (let h = 10; h <= 254; h++) {
      const cand = base + h;
      if (!usedSet.has(cand)) { ip = cand; break; }
    }
    if (!ip) throw new Error("subnet_full: /24 do dono cheio neste nó");

    const ins = await tx<{ ip: string }[]>`
      insert into env_addresses (node_id, env_id, role, ip) values (${nodeId}, ${envId}, ${role}, ${ip})
      on conflict (env_id, role) do nothing returning ip
    `;
    // Corrida: outro processo alocou o mesmo (env, role) — reusa o dele.
    const finalIp = ins[0]?.ip ?? (await tx<{ ip: string }[]>`select ip from env_addresses where env_id = ${envId} and role = ${role} limit 1`)[0]!.ip;

    return { subnet: net!.subnet, gateway: net!.gateway, bridgeName: net!.bridge_name, ip: finalIp };
  });
}

export interface VpsAllocation {
  netName: string; // nome da libvirt network (ex.: vps-net-3)
  subnet: string; // ex.: 192.168.100.24/29
  gateway: string; // ex.: 192.168.100.25
  ip: string; // IP fixo da VM
}

/**
 * Aloca (ou reusa) a rede /29 do dono no nó (faixa 192.168.100.0/22, separada do /24
 * Docker) e um IP livre para a VM. Idempotente por (env, role="vps"). slot 0..127 =
 * bloco /29; até 5 VMs por dono por bloco (base+2..base+6).
 */
export async function allocateVpsAddress(
  nodeId: string,
  ownerId: string,
  envId: string,
): Promise<VpsAllocation> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"vps-ipam:" + nodeId}))`;

    let net = (
      await tx`select * from vps_networks where node_id = ${nodeId} and owner_id = ${ownerId} limit 1`
    )[0];

    const already = (
      await tx<{ ip: string }[]>`select ip from env_addresses where env_id = ${envId} and role = ${"vps"} limit 1`
    )[0];
    if (already && net) {
      return { netName: net!.net_name, subnet: net!.subnet, gateway: net!.gateway, ip: already.ip };
    }

    if (!net) {
      const nextRows = await tx`select coalesce(max(slot), -1) + 1 as next from vps_networks where node_id = ${nodeId}`;
      const slot: number = nextRows[0]!.next;
      if (slot > 127) throw new Error("no_vps_subnet: nó sem /29 livre para novos donos de VPS");
      const off = slot * 8; // deslocamento dentro de 192.168.100.0/22
      const third = 100 + Math.floor(off / 256);
      const fourth = off % 256;
      const subnet = `192.168.${third}.${fourth}/29`;
      const gateway = `192.168.${third}.${fourth + 1}`;
      const netName = `vps-net-${slot}`;
      net = (
        await tx`
          insert into vps_networks (node_id, owner_id, slot, subnet, gateway, net_name)
          values (${nodeId}, ${ownerId}, ${slot}, ${subnet}, ${gateway}, ${netName})
          returning *
        `
      )[0];
    }

    // Base da /29 a partir do gateway (gateway = base+1).
    const gwParts = net!.gateway.split(".");
    const baseFourth = Number(gwParts[3]) - 1;
    const prefix3 = `${gwParts[0]}.${gwParts[1]}.${gwParts[2]}.`;
    const used = await tx<{ ip: string }[]>`select ip from env_addresses where node_id = ${nodeId}`;
    const usedSet = new Set(used.map((r) => r.ip));
    let ip: string | null = null;
    for (let h = baseFourth + 2; h <= baseFourth + 6; h++) {
      const cand = prefix3 + h;
      if (!usedSet.has(cand)) { ip = cand; break; }
    }
    if (!ip) throw new Error("vps_subnet_full: /29 do dono cheio neste nó");

    const ins = await tx<{ ip: string }[]>`
      insert into env_addresses (node_id, env_id, role, ip) values (${nodeId}, ${envId}, ${"vps"}, ${ip})
      on conflict (env_id, role) do nothing returning ip
    `;
    const finalIp = ins[0]?.ip ?? (await tx<{ ip: string }[]>`select ip from env_addresses where env_id = ${envId} and role = ${"vps"} limit 1`)[0]!.ip;

    return { netName: net!.net_name, subnet: net!.subnet, gateway: net!.gateway, ip: finalIp };
  });
}

/** Rede (bridge/subnet/gateway) do dono num nó — para recriar o container na mesma bridge. */
export async function ownerNetworkFor(
  nodeId: string,
  ownerId: string,
): Promise<{ bridgeName: string; subnet: string; gateway: string } | null> {
  const rows = await sql<{ bridge_name: string; subnet: string; gateway: string }[]>`
    select bridge_name, subnet, gateway from owner_networks where node_id = ${nodeId} and owner_id = ${ownerId} limit 1
  `;
  const n = rows[0];
  return n ? { bridgeName: n.bridge_name, subnet: n.subnet, gateway: n.gateway } : null;
}

/** Libera todos os IPs de um ambiente (no delete). Não remove a bridge (pode ter irmãos). */
export async function releaseAddresses(envId: string): Promise<void> {
  await sql`delete from env_addresses where env_id = ${envId}`;
}

/** IPs atuais de um ambiente (para montar dados de conexão / limpeza). */
export async function addressesOf(envId: string): Promise<Array<{ role: string; ip: string }>> {
  const rows = await sql<{ role: string; ip: string }[]>`select role, ip from env_addresses where env_id = ${envId}`;
  return rows.map((r) => ({ role: r.role, ip: r.ip }));
}
