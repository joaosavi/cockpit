---
name: resolver-de-forma-definitiva
description: "Bug e problema se resolvem na causa, de forma definitiva; gambiarra só quando o João pedir explicitamente"
metadata:
  type: feedback
---

Resolva bug e problema na causa, de forma definitiva. Correção que contorna o sintoma é gambiarra,
e só entra quando o João pedir uma explicitamente. Exemplos de gambiarra: repetir até dar certo,
aumentar um limite para o erro aparecer menos, ou um aviso no lugar de consertar.

**Why:** em 07/10/2026, a listagem de vendas da Conta Azul repetia id entre páginas, porque a
ordem padrão empata em 1.574 vendas de número 0. A correção que eu commitei relia a listagem até
os ids fecharem, e eu a recomendei mesmo depois de achar a causa e medir uma saída determinística.
Ele respondeu: "quero que voce atualize de forma que resolva o problema de forma definitiva e sem
gambiarras", e pediu para guardar a regra para sempre.

**How to apply:** depois de achar a causa, a correção que você traz e recomenda é a que remove a
causa, mesmo quando ela custa mais código. Se só existir contorno, diga isso e diga o porquê.
Nunca recomende o contorno quando a correção definitiva já está medida.
