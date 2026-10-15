---
name: sessoes-combinam-a-vez
description: Duas sessões na mesma VPS combinam por SendMessage a vez de rodar push, typecheck e suíte de teste
metadata:
  type: feedback
---

Quando outra sessão do Claude trabalha ao mesmo tempo na máquina, combine com ela por SendMessage a vez
do trabalho pesado: push com pre-push, typecheck e suíte de teste. Antes de rodar, mande "vou rodar X",
e no fim mande "liberado". Se a outra estiver no pesado, espere o "liberado" dela, e peça um aviso
quando ela ficar ociosa com `notify_when_idle`.

**Why:** em 15/10/2026, a sessão do refactor e a das telas do zippi-datawarehouse rodavam pre-push e
typecheck juntas, e um teste estourou o tempo de 30 s sob a carga. O João pediu para pausar e disse:
"se alinha ai com o outro agente, pra quando ele terminar ele te avisar e tal, pra voces nao ficarem
disputando".

Quando o João dá prioridade a uma sessão, a outra pausa o pesado no próximo ponto seguro e só
retoma no "liberado". Em 15/10/2026 ele deu prioridade total à sessão do cartão sobre a do refactor:
"tu tem prioridade total sobre o refactor... pode pedir pra ele parar la... eu quero ja ver isso
pronto".

**How to apply:** no começo do trabalho pesado, confira com `ListAgents` se existe outra sessão local
e combine a vez com ela. Isso se soma ao [[agentes-em-paralelo]] e ao teto de memória da VPS.
