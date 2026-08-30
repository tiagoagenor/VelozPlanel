# VelozPlanel — Produto VPS (KVM): FASE 0 (hardening do host)

Runbook do endurecimento do nó **antes** de codar/expor a feature VPS. Alvo: `sp-local`
(`server-local@10.100.0.3`, Ubuntu 22.04, iptables-nft, libvirt 8.0). Plano completo em
`~/.claude/plans/vamos-criar-isso-no-vast-nautilus.md`.

> **v1 = piloto** (só VPS suas/confiáveis). Mesmo assim, estes itens são baratos e corretos
> e devem entrar antes da primeira VM de tenant.

## Ordem de aplicação (e risco)

| # | Passo | Arquivo | Risco | Reversível |
|---|---|---|---|---|
| 1 | Isolamento nft dos tenants | `nftables-vp-kvm.nft` | **Baixo** — só afeta `saddr 192.168.100.0/22`; não derruba sua sessão | `nft delete table inet vp_kvm` |
| 2 | Nested virt OFF + `host-model` | `modprobe-vp-kvm.conf` | Baixo — fazer sem VMs rodando | remover arquivo, recarregar módulo |
| 3 | KSM OFF | `ksm-off.service` | Baixo | `systemctl disable` |
| 4 | Hardening libvirt `qemu.conf` | `qemu-hardening.conf` | **Médio** — testar 1 VM após restart do libvirtd | restaurar backup do qemu.conf |
| 5 | Cortar superfície (Samba/Cockpit/SSH→mesh) | manual (abaixo) | **ALTO — risco de lockout** | ver notas |
| 6 | Limpeza de órfãos (AppArmor/virbr0) | manual (abaixo) | Baixo | — |

## 1) Isolamento nft (aplicar primeiro)

```bash
sudo nft -f deploy/vps/nftables-vp-kvm.nft
sudo nft list table inet vp_kvm         # conferir
```
Persistência: incluir em `/etc/nftables.d/` (com include no `/etc/nftables.conf`) ou via
systemd — ver `nft-vp-kvm.service` nesta pasta. **Prova de que sobrevive** ao Docker/libvirt:
```bash
sudo systemctl restart docker && sudo systemctl restart libvirtd
sudo nft list table inet vp_kvm | grep -c drop   # regras intactas
```

## 2) Nested OFF + CPU host-model
```bash
sudo cp deploy/vps/modprobe-vp-kvm.conf /etc/modprobe.d/vp-kvm.conf
sudo modprobe -r kvm_intel && sudo modprobe kvm_intel
cat /sys/module/kvm_intel/parameters/nested    # -> N
```
(CPU `host-model` é escolhido no XML da VM pelo `kvm.ts`, não aqui.)

## 3) KSM OFF
```bash
sudo cp deploy/vps/ksm-off.service /etc/systemd/system/ksm-off.service
sudo systemctl daemon-reload && sudo systemctl enable --now ksm-off.service
cat /sys/kernel/mm/ksm/run                       # -> 0
```

## 4) Hardening do libvirt
```bash
sudo cp /etc/libvirt/qemu.conf /etc/libvirt/qemu.conf.bak.$(date +%s)   # (data via shell, não no plano)
# aplicar as chaves de deploy/vps/qemu-hardening.conf ao /etc/libvirt/qemu.conf
sudo systemctl restart libvirtd
# TESTE: subir e derrubar 1 VM de teste; conferir confinamento:
sudo aa-status | grep libvirt
```

## 5) Cortar superfície pré-existente — ⚠️ RISCO DE LOCKOUT (confirmar antes)

Hoje escutam em `0.0.0.0` (todas as interfaces): SSH 22, Samba 139/445, Cockpit 9090.
Numa máquina exposta por port-forward, isso é superfície demais ao lado de VMs root.

- **Samba**: em `/etc/samba/smb.conf`, `interfaces = 10.100.0.3 127.0.0.1` + `bind interfaces only = yes`.
- **Cockpit**: `systemctl edit cockpit.socket` → `ListenStream=10.100.0.3:9090`.
- **SSH do host**: restringir à mesh **sem se trancar** — manter uma 2ª via (Tailscale ou
  console físico) ativa antes de aplicar `ListenAddress 10.100.0.3` no `sshd_config`.

> **Não aplicar o passo 5 sem uma via de acesso alternativa comprovada.** É o único passo
> capaz de te trancar fora do servidor.

## 6) Limpeza de órfãos (destroy antigo deixou lixo)
```bash
# perfis AppArmor libvirt-<uuid> de VMs que não existem mais:
ls /etc/apparmor.d/libvirt/ | grep '^libvirt-'          # inspecionar
# remover só os que não correspondem a nenhum domínio em `virsh list --all`
# virbr0/dnsmasq zumbi:
sudo virsh net-list --all
# (o kvm.ts passará a fazer esse reaper automaticamente no destroy)
```

## Verificação da FASE 0
- De uma VM de teste na faixa de tenant: `22/2222/2223/4100/9090/139/445/28548` do host,
  `192.168.2.x`, `10.100.0.x` e o IP de outro tenant **inalcançáveis**; SMTP :25 bloqueado.
- `docker ps` inalterado; geestao/mongo de pé; `nft list table inet vp_kvm` intacto após restart.
- `nested` = N; `ksm/run` = 0; libvirt confinando VMs.
