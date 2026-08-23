# WireGuard — malha VelozPlanel

Topologia (rede `10.77.0.0/24`):

| Host        | IP WG        | Papel                                   |
|-------------|--------------|-----------------------------------------|
| 187 (hub)   | `10.77.0.1`  | plano de controle (API + MariaDB)       |
| node-local  | `10.77.0.2`  | agente Docker                           |
| node-remoto | `10.77.0.3`  | agente Docker                           |

- A API (hub) fala com cada agente em `http://10.77.0.<n>:4100`.
- Os apps dos clientes (nos nós) falam com o MariaDB em `10.77.0.1:3306`.
- Só o hub escuta a porta pública UDP `51820`; os nós conectam nele.

## 1. Instalar

```bash
sudo apt-get update && sudo apt-get install -y wireguard
```

## 2. Gerar chaves (em CADA host)

```bash
umask 077
wg genkey | tee privatekey | wg pubkey > publickey
cat privatekey   # vai no [Interface] PrivateKey do próprio host
cat publickey    # vai no [Peer] PublicKey do OUTRO lado
```

Guarde as `privatekey` fora do repositório. As `publickey` são trocadas entre
hub e nós.

## 3. Preencher os configs

- No **hub (187)**: copie `wg-hub.conf.example` → `/etc/wireguard/wg0.conf`,
  cole a private key do hub e as **public keys dos dois nós**.
- Em **cada nó**: copie `wg-node.conf.example` → `/etc/wireguard/wg0.conf`,
  ajuste `Address` (`10.77.0.2/24` no local, `10.77.0.3/24` no remoto), cole a
  private key do nó, a **public key do hub** e o `Endpoint` = IP público do 187.

Libere a porta no firewall do hub: `sudo ufw allow 51820/udp`.

## 4. Subir o túnel

```bash
sudo wg-quick up wg0        # sobe agora
sudo systemctl enable wg-quick@wg0   # sobe no boot
sudo wg show                # confere o handshake (latest handshake preenchido)
```

## 5. Testar

Do hub: `ping 10.77.0.2` e `ping 10.77.0.3`.
De um nó: `ping 10.77.0.1` e `curl http://10.77.0.1:3306` (deve conectar/rejeitar,
não dar timeout).
