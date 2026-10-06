---
name: agentes-em-paralelo
description: Rodar no máximo um agente em segundo plano por vez; interromper a resposta cancela os agentes
metadata:
  type: feedback
---

Rode no máximo um agente em segundo plano por vez, e sem subagentes dentro dele.

**Why:** em 03/10/2026, dez agentes em paralelo (oito levantamentos e duas pesquisas, uma delas abrindo
mais quatro) estouraram o limite de uso da sessão em minutos, e o João pediu "use menos agentes
paralelos". No mesmo dia, uma interrupção da resposta pelo João cancelou de vez os oito agentes que
rodavam, sem retomada possível.

**How to apply:** prefira fazer você mesmo o que couber no contexto; quando delegar, um agente por vez,
com a instrução de não abrir subagentes e de gravar o resultado em arquivo. Antes de lançar agente longo,
avise que interromper a resposta cancela o trabalho dele.
