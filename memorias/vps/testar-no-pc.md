---
name: testar-no-pc
description: Ao mudar algo que o João vai testar, dar push e dizer como atualizar no PC dele
metadata:
  type: feedback
---

Sempre que eu mudar algo que o João vai testar (mods, config, scripts do `claude-devcontainer`), dou push sem perguntar e digo os comandos para ele atualizar no PC de casa.

**Why:** ele testa no PC dele, e perguntar se pode subir só atrasa o teste (pedido de 07/10/2026).
**How to apply:** depois do commit, `git push`, e fechar a resposta com os comandos de atualização no PC (para mod: `claude plugin marketplace update agent` e `claude plugin update <mod>@agent`, mais qualquer mudança no `settings.json`). Ver [[mods-do-agente]].
