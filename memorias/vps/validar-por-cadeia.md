---
name: validar-por-cadeia
description: "Para o João validar fatos ou raciocínio, usar a skill global chain-check em vez de perguntas abertas"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4c32dd06-db8b-598b-b9ec-853a38c18815
  modified: 2026-10-05T06:27:49.846Z
---

Quando precisar que o João confirme fatos ou a lógica de algo, use a skill global `chain-check`
(`~/.claude/skills/chain-check/SKILL.md`): o método inteiro está lá.

**Why:** em 05/10/2026, depois de validar elo por elo a cadeia de causas da subseção 2.3 do TCC, ele disse: "em vez
de me perguntar coisas abstratas, que eu não vou lembrar, fazer uma cadeia de linha de raciocínio pra eu validar
[...] vamos fazer mais disso". Em seguida pediu a skill genérica, no molde da `grilling`, para qualquer contexto. A
resposta dele a um elo trouxe um fato novo que uma pergunta aberta não teria trazido.

**How to apply:** em qualquer conferência de conteúdo com ele, no TCC ou fora dele, uma cadeia por resposta.
Ligado a [[texto-tcc-nao-validado]].
