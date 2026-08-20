# Pesquisa de apoio — DNS / ACME / Anycast / Cloudflare (coletada 20/08/2026)

> Material bruto verificado para o especialista de Multi-região & Domínios (doc 12). Itens sem
> fonte primária marcados [NÃO VERIFICADO].

## Let's Encrypt rate limits (página 05/08/2026)
- 50 certificados / domínio registrado / 7 dias — GLOBAL, **override sob pedido**.
- New Orders/conta: 300/3h (override sob pedido). Duplicado: 5/7d (sem override).
- **ARI: renovações via ARI são ISENTAS de todos os rate limits.** Usar cliente com ARI.
- Perfis: `classic` 90d (default), `tlsserver` 45d GA (recomendado p/ automação), `shortlived` ~6,7d GA + certs para IP.
- **PSL NÃO serve para furar limite** — vedado explicitamente pelas guidelines do PSL. Caminho correto: pedir override para `veloz.app`.

## DNS-01 e wildcard
- Wildcard exige DNS-01. Delegação por CNAME é suportada oficialmente.
- **acme-dns** (joohoi/acme-dns): delega só o TXT `_acme-challenge` sem entregar a zona do cliente — melhor postura de segurança.
- lego: `--dns pdns` e `--dns cloudflare`. acme.sh: `dns_pdns`, `dns_cf`.

## PowerDNS Authoritative 2026
- Estável **5.1.3**; pacotes Debian 12/13; Docker `powerdns/pdns-auth-51`.
- HTTP API `X-API-Key`, base `/api/v1`, registros via **PATCH em rrsets**.
- Replicação **native** (MySQL InnoDB / PostgreSQL) é a mais simples p/ painel — master SQL é a verdade.

## Anycast p/ operador pequeno
- ASN próprio: LACNIC US$500 único; /24 alugado ~US$90-128/mês; Vultr aceita BGP. Só compensa acima de milhares de zonas.
- **Alternativa recomendada: PowerDNS próprio (2 nós) + Hurricane Electric (dns.he.net) como secundário anycast GRÁTIS** (ns2-ns5 anycast, slave via AXFR do seu PowerDNS, suporta TSIG). Cobre 90% do valor do anycast a custo zero.
- Cloudflare Secondary DNS: só Enterprise.

## Cloudflare
- Free: DNS anycast ilimitado, 7 PoPs no Brasil (SP, RJ, POA, Curitiba, Fortaleza, Salvador, Brasília).
- **Cloudflare for SaaS / Custom Hostnames**: 100 grátis, depois **US$0,10/hostname/mês** (era US$2), cap 50.000. Sem wildcard custom hostname fora do Enterprise.
- Restrição de servir vídeo/arquivos grandes migrou p/ Service-Specific Terms (CDN) — risco p/ hospedagem cujos clientes sirvam mídia pesada.
- Token mínimo p/ ACME: Zone → DNS → Edit nas zonas específicas.
- **CDN não compensa origin nos EUA para app dinâmica** (PHP/MySQL): RTT de origin permanece ~120-180ms. Para BR, origin em SP é a decisão de maior impacto. Ganho do CDN é no TLS/TCP terminando no PoP BR e em estático cacheável.

## Decisões acionáveis
1. Não usar PSL; pedir override de rate limit para `veloz.app`.
2. Cliente ACME com ARI (lego).
3. Perfil `tlsserver` (45d) como default.
4. PowerDNS 5.1.3 + replicação native + acme-dns para delegar TXT.
5. HE.net grátis como secundário anycast em vez de anycast próprio.
6. Cloudflare for SaaS US$0,10/hostname como caminho de custom hostname (ciente do limite de mídia).
