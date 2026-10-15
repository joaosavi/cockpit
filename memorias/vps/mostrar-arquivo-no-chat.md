---
name: mostrar-arquivo-no-chat
description: O João não abre arquivo da VPS pelo PC; plano, prompt e .md que ele precisa revisar vão impressos no chat
metadata:
  type: feedback
---

Quando um plano, um prompt ou um `.md` precisa da revisão do João, imprima o conteúdo na resposta. Citar só o caminho não serve: ele não lê os arquivos da VPS pelo PC.

**Why:** em 13/10/2026, depois de várias respostas que apontavam para `hubspot/planos/...`, ele pediu "você precisa printar aqui pra mim os planos e .md". Ele estava montando o VS Code por SSH para ter acesso à árvore, mas até isso funcionar o chat é o único caminho.

**How to apply:** imprima o trecho que ele precisa decidir ou colar. O caminho vai junto, como referência. Arquivo longo demais para o chat vai por página privada com download, ver [[download-por-scp]].
