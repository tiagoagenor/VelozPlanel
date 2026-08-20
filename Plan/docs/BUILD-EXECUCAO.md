# VelozPlanel — Checklist de Execução da Construção

> Documento **vivo**. É o mapa para não me perder durante a construção. Cada item só é marcado `[x]`
> depois de **validado sem erro**. Legenda: `[ ]` pendente · `[~]` em andamento · `[x]` feito e validado ·
> `[!]` bloqueado (precisa do dono).
>
> Regra de ouro (pedido do dono): **validar cada etapa antes de dizer "ok"; se houver erro, resolver;
> só chamar o dono para testar quando tudo estiver verde.** Nada vai para produção sem passar no teste local.

Última atualização: 2026-08-20.

---

## Ambiente confirmado (2026-08-20)
- Host KVM: `server-local@192.168.2.111` — Ubuntu 22.04.5, bare metal, VT-x, /dev/kvm ✅, cgroup v2,
  libvirt+qemu+virsh+virt-install instalados. `cloud-localds` ausente. **sudo pede senha.**
- Mac local: git + ssh. GitHub SSH ✅ (`tiagoagenor`). Repo: `git@github.com:tiagoagenor/VelozPlanel.git`.
- SO alvo do projeto: **Ubuntu** (host 22.04; VMs de nó 24.04 LTS).

---

## FASE F — Fundação
- [~] F1. Repositório git local + `.gitignore` (exclui screenshots com dado de terceiro) + README
- [ ] F2. Primeiro commit e push para `github.com/tiagoagenor/VelozPlanel` (main)
- [ ] F3. Esqueleto do monorepo (pnpm workspaces): `apps/`, `packages/`, `infra/`, tooling (lint/tsconfig)
- [ ] F4. CI mínimo (typecheck + lint) — validar que roda

## FASE V — Ambiente KVM de desenvolvimento (no server-local)
- [~] V1. Validar aptidão KVM do host (feito: bare metal, VT-x, /dev/kvm, cgroup v2) ✅
- [ ] V2. Definir modo libvirt sem sudo (`qemu:///session`) OU pedir ao dono para habilitar libvirt de sistema
- [ ] V3. Baixar imagem cloud Ubuntu 24.04 (noble) no servidor
- [ ] V4. Criar seed cloud-init sem `cloud-localds` (via `genisoimage`/virt-install `--cloud-init`)
- [ ] V5. Subir VM `vp-node-1` (Ubuntu 24.04) e validar boot + SSH interno
- [ ] V6. Portar o `veloz-node-doctor.sh` para Ubuntu e rodar dentro da VM → exit 0/2
- [ ] V7. (depois) VM `vp-cp` (control plane) e `vp-node-2` para topologia de 2 nós
- [ ] V8. Rede: bridge/NAT entre as VMs; testar conectividade CP↔nó

## FASE 0 — Portões (do plano) adaptados ao dev local
- [ ] P1. node-doctor verde na VM de nó
- [ ] P2. Docker + userns-remap + quota de projeto (XFS) funcionando na VM
- [ ] P3. Medição inicial: RSS de um container ocioso, boot time (indicativo, não densidade final)

## FASE E — Entregas (do CHECKLIST-DESENVOLVIMENTO.md, E1..E14)
> Só começam depois de F+V+0 verdes. Detalhe em `CHECKLIST-DESENVOLVIMENTO.md`.
- [ ] E1. Esqueleto control plane (API Fastify + Postgres + auth) + healthcheck
- [ ] E2. Agente do nó (Node) que conecta ao CP (WebSocket mTLS) e reporta heartbeat
- [ ] ... E3–E14 conforme o checklist principal

---

## Registro de decisões/descobertas durante o build
- 2026-08-20: SO alvo mudou para Ubuntu (ADENDO 8). Server-local validado como host KVM.
- 2026-08-20: sudo do server-local pede senha → usar `qemu:///session` para não depender de root.

## Bloqueios aguardando o dono
- (nenhum no momento)
