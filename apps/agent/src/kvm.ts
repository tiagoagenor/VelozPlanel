/**
 * Driver KVM/libvirt do Agente VelozPlanel — produto **VPS** (VM completa, cliente root).
 *
 * Espelha a forma do `docker.ts` (provision/destroy/start/stop/status), mas via libvirt
 * em vez de Docker. NÃO importa nem toca no `docker.ts`: caminho 100% separado.
 *
 * Isolamento e rede seguem o mesmo contrato do Docker: o CONTROL PLANE aloca a rede do
 * dono (`network: {name, subnet, gateway}`) e o IP fixo (`ip`), e o agente só materializa.
 * Uma libvirt network NAT por dono (idempotente), IP estático via cloud-init (sem DHCP).
 *
 * Segurança embutida:
 *   - cloud-init injeta SOMENTE chave pública (sem senha/segredo no XML ou no seed ISO);
 *   - seed ISO criado com permissão 0600;
 *   - CPU `host-model` (não passthrough); sem PCI/USB passthrough;
 *   - `destroy` COMPLETO: apaga overlay + NVRAM + seed ISO + perfil AppArmor (reaper),
 *     evitando o lixo de VMs antigas encontrado no host.
 *
 * Tudo é shell-out com `execFile` (array de args, sem shell) — sem injeção. Requer os
 * binários do host (virsh/virt-install/qemu-img/cloud-localds) e `/dev/kvm`. Só é
 * testável de verdade no nó após a FASE 0 (ver deploy/vps/README.md).
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// ── Configuração do nó (paths dedicados, fora do root do sistema) ──
const POOL_DIR = process.env.VPS_POOL_DIR ?? "/var/lib/veloz-vps/disks"; // overlays qcow2
const SEED_DIR = process.env.VPS_SEED_DIR ?? "/var/lib/veloz-vps/seed"; // ISOs cloud-init
const BASE_DIR = process.env.VPS_BASE_DIR ?? "/var/lib/veloz-vps/base"; // imagens-base cloud
const AA_DIR = process.env.VPS_APPARMOR_DIR ?? "/etc/apparmor.d/libvirt"; // perfis do libvirt
const SSHPIPER_DIR = process.env.VPS_SSHPIPER_DIR ?? "/var/lib/veloz-vps/sshpiper"; // workingdir do sshpiper
const SSH_KEYSCAN_TIMEOUT_S = Number(process.env.VPS_KEYSCAN_TIMEOUT ?? 5);

/** Mapa slug de imagem -> arquivo qcow2 base + os-variant do virt-install. */
const IMAGES: Record<string, { file: string; osVariant: string }> = {
  "ubuntu-24.04": { file: "ubuntu-24.04.qcow2", osVariant: "ubuntu24.04" },
  "ubuntu-22.04": { file: "ubuntu-22.04.qcow2", osVariant: "ubuntu22.04" },
  "debian-12": { file: "debian-12.qcow2", osVariant: "debian12" },
};

export interface VpsLimits {
  vcpu: number; // 1.0 = 1 vCPU (arredondado p/ cima; KVM não fraciona)
  memMb: number;
  diskGb: number;
}

export interface VpsNetwork {
  name: string; // nome da libvirt network do dono (ex.: vps-net-<owner8>)
  subnet: string; // CIDR /29 do dono (ex.: 192.168.100.8/29)
  gateway: string; // gateway da rede (ex.: 192.168.100.9)
}

export interface VpsProvisionArgs {
  envId: string;
  name: string; // nome amigável (vira hostname)
  image: string; // slug em IMAGES
  limits: VpsLimits;
  network: VpsNetwork;
  ip: string; // IP fixo da VM na rede do dono (ex.: 192.168.100.10)
  ownerId: string;
  sshPublicKeys: string[]; // chaves autorizadas do cliente (só pública)
  sshUser?: string; // usuário na VM (default "vps"); tem sudo NOPASSWD
}

export interface VpsProvisionResult {
  vmName: string; // domínio libvirt (ex.: vps-<envId8>)
  ip: string; // IP fixo atribuído
  sshTarget: string; // "<ip>:22" (destino do sshpiper)
  guestHostKey: string | null; // host key ed25519 do guest p/ pinning (null se não capturada ainda)
}

/** Nome do domínio libvirt determinístico a partir do envId. */
function vmNameFor(envId: string): string {
  return `vps-${envId.replace(/-/g, "").slice(0, 12)}`;
}

/** Nome do bridge do libvirt a partir do nome da rede (limite ~15 chars no kernel). */
function bridgeFor(network: VpsNetwork): string {
  const digits = network.name.replace(/[^a-z0-9]/gi, "").slice(-8);
  return `vpsbr${digits}`.slice(0, 15);
}

/** O nó tem KVM/libvirt utilizável? Usado pra decidir se este agente serve VPS. */
export async function available(): Promise<boolean> {
  try {
    await fs.access("/dev/kvm");
    await run("virsh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** Existe um domínio libvirt com este nome? */
async function domainExists(vmName: string): Promise<boolean> {
  try {
    await run("virsh", ["dominfo", vmName]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Garante (idempotente) a libvirt network NAT do dono: bridge própria, faixa /29,
 * SEM `<dhcp>` (IP é estático via cloud-init). Isola L2 por dono; a política de
 * bloqueio dono↔dono/host vive na tabela nft `vp_kvm` (FASE 0), não aqui.
 */
export async function ensureNetwork(net: VpsNetwork): Promise<void> {
  try {
    await run("virsh", ["net-info", net.name]);
    // Já existe — garante ativa e autostart.
    await run("virsh", ["net-start", net.name]).catch(() => {});
    await run("virsh", ["net-autostart", net.name]).catch(() => {});
    return;
  } catch {
    /* não existe: define abaixo */
  }
  const bridge = bridgeFor(net);
  const prefix = net.subnet.split("/")[1] ?? "29";
  const xml =
    `<network>\n` +
    `  <name>${net.name}</name>\n` +
    `  <forward mode='nat'/>\n` +
    `  <bridge name='${bridge}' stp='on' delay='0'/>\n` +
    `  <ip address='${net.gateway}' prefix='${prefix}'/>\n` +
    `</network>\n`;
  const xmlPath = path.join(SEED_DIR, `${net.name}.net.xml`);
  await fs.mkdir(SEED_DIR, { recursive: true });
  await fs.writeFile(xmlPath, xml, { mode: 0o600 });
  await run("virsh", ["net-define", xmlPath]);
  await run("virsh", ["net-start", net.name]);
  await run("virsh", ["net-autostart", net.name]);
}

/**
 * Diretório do sshpiper para esta VM. O gateway (sshpiper) roda no nó com este dir como
 * workingdir; a chave PRIVADA por-VM fica AQUI (no nó), nunca no control plane — o raio
 * de dano é 1 VM por chave. Login no gateway = `vmName` (mapeado p/ `vps@<ip>:22`).
 */
function sshpiperUserDir(vmName: string): string {
  return path.join(SSHPIPER_DIR, vmName);
}

/** Gera (idempotente) a chave ed25519 por-VM do gateway e devolve a PÚBLICA (linha OpenSSH). */
async function ensureGatewayKey(vmName: string): Promise<string> {
  const dir = sshpiperUserDir(vmName);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const key = path.join(dir, "id_ed25519");
  try {
    return (await fs.readFile(`${key}.pub`, "utf8")).trim();
  } catch {
    /* gera abaixo */
  }
  await run("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", `veloz-gw-${vmName}`, "-f", key, "-q"]);
  await fs.chmod(key, 0o600).catch(() => {});
  return (await fs.readFile(`${key}.pub`, "utf8")).trim();
}

/**
 * Escreve o mapeamento do sshpiper (workingdir driver): quem pode entrar (authorized_keys
 * = chaves do cliente) e para onde vai (`sshpiper_upstream` = vps@<ip>:22). A chave privada
 * de upstream (id_ed25519) já está no dir. `known_hosts` pina a host key do guest quando conhecida.
 */
async function writeSshpiperMapping(
  vmName: string,
  vmIp: string,
  vmUser: string,
  clientKeys: string[],
  guestHostKey: string | null,
): Promise<void> {
  const dir = sshpiperUserDir(vmName);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(dir, "sshpiper_upstream"), `${vmUser}@${vmIp}:22\n`, { mode: 0o600 });
  await fs.writeFile(path.join(dir, "authorized_keys"), clientKeys.map((k) => k.trim()).join("\n") + "\n", { mode: 0o600 });
  if (guestHostKey) {
    // Formato known_hosts: `<ip> <hostkey>` (a linha do ssh-keyscan já vem como `<ip> ssh-ed25519 ...`).
    await fs.writeFile(path.join(dir, "known_hosts"), `${guestHostKey}\n`, { mode: 0o600 });
  }
}

async function removeSshpiperMapping(vmName: string): Promise<void> {
  await fs.rm(sshpiperUserDir(vmName), { recursive: true, force: true }).catch(() => {});
}

/** Monta o seed ISO (NoCloud) com user-data/meta-data/network-config. Só chave pública. */
async function buildSeedIso(args: VpsProvisionArgs, vmName: string, allKeys: string[]): Promise<string> {
  const user = args.sshUser ?? "vps";
  const keys = allKeys.map((k) => `      - ${k.trim()}`).join("\n");
  // Usuário com sudo NOPASSWD = "root livre"; sem senha; login por senha desligado.
  const userData =
    `#cloud-config\n` +
    `hostname: ${args.name.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || vmName}\n` +
    `ssh_pwauth: false\n` +
    `disable_root: true\n` +
    `users:\n` +
    `  - name: ${user}\n` +
    `    sudo: 'ALL=(ALL) NOPASSWD:ALL'\n` +
    `    shell: /bin/bash\n` +
    `    lock_passwd: true\n` +
    `    ssh_authorized_keys:\n${keys}\n`;
  const metaData = `instance-id: ${vmName}\nlocal-hostname: ${vmName}\n`;
  // netplan v2: IP estático; casa qualquer interface "en*" (virtio nomeia enpXsY/ensZ).
  const netCfg =
    `version: 2\n` +
    `ethernets:\n` +
    `  primary:\n` +
    `    match:\n` +
    `      name: "en*"\n` +
    `    addresses: [ ${args.ip}/${args.network.subnet.split("/")[1] ?? "29"} ]\n` +
    `    routes:\n` +
    `      - to: default\n` +
    `        via: ${args.network.gateway}\n` +
    `    nameservers:\n` +
    `      addresses: [ 1.1.1.1, 8.8.8.8 ]\n`;

  await fs.mkdir(SEED_DIR, { recursive: true });
  const base = path.join(SEED_DIR, vmName);
  const udPath = `${base}.user-data`;
  const mdPath = `${base}.meta-data`;
  const ncPath = `${base}.network-config`;
  const isoPath = `${base}.seed.iso`;
  await fs.writeFile(udPath, userData, { mode: 0o600 });
  await fs.writeFile(mdPath, metaData, { mode: 0o600 });
  await fs.writeFile(ncPath, netCfg, { mode: 0o600 });
  // cloud-localds (cloud-image-utils) monta o ISO cidata com network-config.
  await run("cloud-localds", ["--network-config", ncPath, isoPath, udPath, mdPath]);
  await fs.chmod(isoPath, 0o600).catch(() => {});
  // Os fontes de texto já cumpriram seu papel; o ISO é o que a VM lê. Mantemos o ISO
  // (0600) enquanto a VM existir e o removemos no destroy.
  await Promise.all([fs.rm(udPath, { force: true }), fs.rm(mdPath, { force: true }), fs.rm(ncPath, { force: true })]);
  return isoPath;
}

/** Melhor-esforço: captura a host key ed25519 do guest após subir (p/ pinning no sshpiper). */
async function readGuestHostKey(ip: string): Promise<string | null> {
  try {
    const { stdout } = await run("ssh-keyscan", ["-T", String(SSH_KEYSCAN_TIMEOUT_S), "-t", "ed25519", ip]);
    const line = stdout.split("\n").find((l) => l.includes("ssh-ed25519"));
    return line ? line.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Provisiona uma VPS: garante a rede do dono, cria o overlay qcow2 (backing na imagem-base,
 * virtual size = plano), monta o seed ISO só-chave e importa a VM com virt-install.
 */
export async function provision(args: VpsProvisionArgs): Promise<VpsProvisionResult> {
  const img = IMAGES[args.image];
  if (!img) throw new Error(`imagem desconhecida: ${args.image}`);
  const vmName = vmNameFor(args.envId);
  const vmUser = args.sshUser ?? "vps";
  if (await domainExists(vmName)) {
    // Idempotência: se já existe, revalida o mapeamento do sshpiper e devolve os dados.
    const hostKey = await readGuestHostKey(args.ip);
    await writeSshpiperMapping(vmName, args.ip, vmUser, args.sshPublicKeys, hostKey).catch(() => {});
    return { vmName, ip: args.ip, sshTarget: `${args.ip}:22`, guestHostKey: hostKey };
  }

  await ensureNetwork(args.network);
  await fs.mkdir(POOL_DIR, { recursive: true });

  // Chave por-VM do gateway: entra no authorized_keys da VM (junto das do cliente) para
  // o sshpiper conseguir alcançar a VM. A privada fica só no nó (sshpiper workingdir).
  const gatewayPubKey = await ensureGatewayKey(vmName);
  const allKeys = [...args.sshPublicKeys, gatewayPubKey];

  const basePath = path.join(BASE_DIR, img.file);
  await fs.access(basePath).catch(() => {
    throw new Error(`imagem-base ausente no nó: ${basePath} (baixe a cloud image antes)`);
  });

  // Overlay qcow2 com backing na base; virtual size = diskGb do plano.
  const diskPath = path.join(POOL_DIR, `${vmName}.qcow2`);
  await run("qemu-img", [
    "create", "-f", "qcow2",
    "-F", "qcow2", "-b", basePath,
    diskPath, `${args.limits.diskGb}G`,
  ]);
  await fs.chmod(diskPath, 0o600).catch(() => {});

  const seedIso = await buildSeedIso(args, vmName, allKeys);
  const vcpus = Math.max(1, Math.ceil(args.limits.vcpu));

  await run("virt-install", [
    "--name", vmName,
    "--memory", String(args.limits.memMb),
    "--vcpus", String(vcpus),
    "--cpu", "host-model", // não passthrough: permite patch/mitigação uniforme
    "--os-variant", img.osVariant,
    "--import",
    "--disk", `path=${diskPath},format=qcow2,bus=virtio,discard=unmap`,
    "--disk", `path=${seedIso},device=cdrom`,
    "--network", `network=${args.network.name},model=virtio`,
    "--graphics", "vnc,listen=127.0.0.1", // console só local; acesso via mesh/admin
    "--noautoconsole",
    "--autostart",
  ]);

  // A VM está subindo; a host key só existe após o boot — melhor-esforço (o sshpiper
  // pode capturar/pinar depois se vier null aqui).
  const guestHostKey = await readGuestHostKey(args.ip);
  await writeSshpiperMapping(vmName, args.ip, vmUser, args.sshPublicKeys, guestHostKey);
  return { vmName, ip: args.ip, sshTarget: `${args.ip}:22`, guestHostKey };
}

// ── Ciclo de vida ──
export async function start(vmName: string): Promise<void> {
  if (await domainExists(vmName)) await run("virsh", ["start", vmName]).catch(() => {});
}
export async function stop(vmName: string): Promise<void> {
  // shutdown gracioso; quem quer forçar usa destroy() do libvirt (poweroff).
  if (await domainExists(vmName)) await run("virsh", ["shutdown", vmName]).catch(() => {});
}
export async function reboot(vmName: string): Promise<void> {
  if (await domainExists(vmName)) await run("virsh", ["reboot", vmName]).catch(() => {});
}
/** Suspensão para takedown de abuso: congela a VM na hora, preservando estado/logs. */
export async function suspend(vmName: string): Promise<void> {
  if (await domainExists(vmName)) await run("virsh", ["suspend", vmName]).catch(() => {});
}
export async function resume(vmName: string): Promise<void> {
  if (await domainExists(vmName)) await run("virsh", ["resume", vmName]).catch(() => {});
}

export type VpsState = "running" | "paused" | "shutoff" | "unknown" | "absent";

/** Estado atual do domínio (mapeado do virsh domstate). */
export async function status(vmName: string): Promise<VpsState> {
  if (!(await domainExists(vmName))) return "absent";
  try {
    const { stdout } = await run("virsh", ["domstate", vmName]);
    const s = stdout.trim();
    if (s.startsWith("running")) return "running";
    if (s.startsWith("paused")) return "paused";
    if (s.startsWith("shut off")) return "shutoff";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Destrói a VPS por COMPLETO — corrige o vazamento que deixou perfis AppArmor órfãos:
 * força poweroff, remove o domínio + NVRAM + todo o storage, e faz o reaper do seed ISO
 * e do perfil AppArmor. Idempotente.
 */
export async function destroy(vmName: string): Promise<void> {
  if (await domainExists(vmName)) {
    await run("virsh", ["destroy", vmName]).catch(() => {}); // poweroff forçado (ok se já off)
    // undefine remove NVRAM e TODO o storage gerenciado (overlay).
    await run("virsh", ["undefine", vmName, "--nvram", "--remove-all-storage"]).catch(async () => {
      // fallback p/ libvirt sem --remove-all-storage: undefine simples + rm manual.
      await run("virsh", ["undefine", vmName, "--nvram"]).catch(() => {});
    });
  }
  // Garante remoção do overlay e do seed ISO mesmo se o undefine não os levou.
  await fs.rm(path.join(POOL_DIR, `${vmName}.qcow2`), { force: true }).catch(() => {});
  await fs.rm(path.join(SEED_DIR, `${vmName}.seed.iso`), { force: true }).catch(() => {});
  // Remove o mapeamento + chave por-VM do sshpiper (revoga o acesso).
  await removeSshpiperMapping(vmName).catch(() => {});
  // Reaper do perfil AppArmor libvirt-<uuid>: só é possível casar por conteúdo; aqui
  // removemos qualquer perfil cujo `.files` referencie os discos deste vmName.
  await reapAppArmorFor(vmName).catch(() => {});
}

/** Remove perfis AppArmor do libvirt que referenciam os arquivos desta VM (órfãos). */
async function reapAppArmorFor(vmName: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(AA_DIR);
  } catch {
    return; // sem acesso ao dir (ex.: dev/mac) — nada a fazer
  }
  const needle = `${vmName}.qcow2`;
  for (const name of entries) {
    if (!name.startsWith("libvirt-")) continue;
    const filesPath = path.join(AA_DIR, `${name}.files`);
    try {
      const content = await fs.readFile(filesPath, "utf8");
      if (content.includes(needle)) {
        await fs.rm(path.join(AA_DIR, name), { force: true }).catch(() => {});
        await fs.rm(filesPath, { force: true }).catch(() => {});
      }
    } catch {
      /* perfil sem .files ou ilegível — ignora */
    }
  }
}
