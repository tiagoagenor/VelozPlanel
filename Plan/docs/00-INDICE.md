# VelozPanel — Documentação

> **Se você é o Tiago e está com pressa:** leia o `10-COMO-FUNCIONA.md`. É o único documento
> escrito para ser lido de ponta a ponta numa sentada, e explica o sistema inteiro sem jargão.

## Mapa

| Documento | Para quê | Quando ler |
|---|---|---|
| **[10-COMO-FUNCIONA.md](10-COMO-FUNCIONA.md)** | Entender o sistema inteiro: as peças, por que existem, como conversam | **Primeiro.** E de novo sempre que algo não fizer sentido |
| **[20-INSTALAR-NO-ZERO.md](20-INSTALAR-NO-ZERO.md)** | Do servidor cru até o primeiro cliente hospedado, numerado | Ao montar a plataforma, ou ao reconstruí-la depois de um desastre |
| **[30-MODULOS.md](30-MODULOS.md)** | Instalar, configurar, atualizar, remover módulo. E criar um novo | Ao ligar uma capacidade nova (banco, backup, meio de pagamento) |
| **[40-OPERACAO-DIARIA.md](40-OPERACAO-DIARIA.md)** | Runbooks: o site caiu, o nó sumiu, o disco encheu, restaurar backup, cliente não pagou, suspeita de invasão | **Quando algo dá errado.** Deixe aberto num marcador do navegador |
| **[50-GLOSSARIO.md](50-GLOSSARIO.md)** | Todo termo técnico do projeto, uma frase cada | Sempre que encontrar uma palavra estranha em qualquer documento |
| **[CHECKLIST-DESENVOLVIMENTO.md](CHECKLIST-DESENVOLVIMENTO.md)** | Itens verificáveis por entrega, com critério de aceite | Durante a construção, para saber o que já está pronto de verdade |

## Onde está o resto

| Pasta | Conteúdo |
|---|---|
| `Plan/00-BRIEFING.md` | O que o dono pediu. **Fonte de verdade.** Se um documento contradiz o briefing, o documento está errado |
| `Plan/especialistas/` | Análise técnica por área. Denso, para consulta, não para leitura corrida |
| `Plan/especialistas/08-modulos-instalacao.md` | **A especificação completa do sistema de módulos.** O `30-MODULOS.md` é a versão de bolso deste |
| `Plan/criticas/` | O que o red team achou de errado em cada ciclo. Leitura útil e desconfortável |
| `Plan/modulos/` | Especificação de cada módulo, um arquivo por módulo |
| `Plan/scripts/` | `veloz-node-doctor.sh` — o script que diz se um servidor serve |
| `Plan/hostoo/` | 36 screenshots do concorrente, que originaram o inventário de telas |

## Convenções destes documentos

- **Português do Brasil**, sem jargão desnecessário. Onde o jargão é inevitável, a palavra está no glossário.
- Bloco assim significa que a decisão ainda não foi tomada — **e ninguém deve inventar**:
  > ⚠️ PENDENTE Ciclo 3 — falta decidir X.
- Comandos aparecem em blocos de código prontos para copiar. Onde há `<algo>`, substitua.
- Todo runbook do `40` tem a mesma forma: **sintoma → diagnóstico → ação → como saber que resolveu**.

## Estado desta documentação

Escrita no **Ciclo 2** do planejamento. **Nenhuma linha de código de produção foi escrita ainda.**
Os comandos descritos aqui são a especificação do que será construído — quando o sistema existir,
esta documentação vira o manual, e cada comando precisa ser executado de verdade pelo dono ao menos
uma vez antes de valer.
