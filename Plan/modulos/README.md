# Especificações de módulo

Um arquivo por módulo, com o detalhe que não cabe no manifesto: decisões de produto, mapeamento
com a API do fornecedor, casos de erro conhecidos e o roteiro de testes.

**Antes de escrever um arquivo aqui, leia `Plan/especialistas/08-modulos-instalacao.md`** — ele define
o catálogo fechado (§1.2), o formato do `module.yaml` (§2), os contratos de capability (§3) e o
checklist de merge (§7).

## Índice

| Arquivo | Módulo | Estado |
|---|---|---|
| `pagamento.md` | `mod-pagamento-asaas`, `mod-pagamento-pix`, `mod-pagamento-fake` | ⬜ a escrever — **dono: Arquiteto (#3) + Billing (#6)**, item 7 da ordem de marcha do Ciclo 2. O contrato `payment.gateway v1` já está fechado em `08` §3.4 |
| `runtime-php.md` | `mod-runtime-php` | ⬜ a escrever — Ciclo 3 |
| `runtime-node.md` | `mod-runtime-node` | ⬜ a escrever — Ciclo 3 |
| `db-mysql.md` | `mod-db-mysql` | ⬜ a escrever — **dono: Banco de Dados (#7)**, item 10 da ordem de marcha |
| `backup.md` | `mod-backup`, `mod-storage-s3` | ⬜ a escrever — Ciclo 3. E11 é entrega inegociável |
| `ssl.md` | `mod-ssl` | ⬜ a escrever — Ciclo 3. Atenção à fila serializada de emissão (C5) |
| `node-base.md` | `mod-node-base` | ⬜ a escrever — **dono: Linux/SRE (#4)**, depende do Veredito do Conflito 1 |

## Forma de cada arquivo

1. **Para que serve** — em duas frases, sem jargão.
2. **Manifesto comentado** — o `module.yaml` real, com o porquê de cada escolha.
3. **Capability implementada** — qual contrato, qual major, o que fica de fora e por quê.
4. **Integração externa** — endpoints do fornecedor, limites de taxa, sandbox, credenciais.
5. **Casos de erro** — tabela sintoma → causa → ação (vira o `docs/runbook.md` do módulo).
6. **Testes** — o que a suíte de conformidade cobre e o que é específico deste módulo.
7. **Custo operacional** — quanto tempo por mês este módulo consome do dono.
