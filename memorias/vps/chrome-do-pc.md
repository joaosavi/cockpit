---
name: chrome-do-pc
description: Claude in Chrome nativo alcança o Chrome do Mac do João a partir da VPS pela ponte do claude.ai, sem túnel; sessão sem --chrome usa claude -p --chrome
metadata:
  type: reference
---

A integração nativa (`--chrome`, extensão Claude in Chrome) funciona da VPS no Chrome do Mac do João. O CLI e a extensão se encontram em `bridge.claudeusercontent.com`, pareados pela conta e organização do claude.ai. Não precisa de túnel SSH, nem de aba da extensão aberta. Testado em 15/10/2026: abriu aba, navegou e leu `example.com`. O navegador aparece como "Browser 1", macOS, não local.

Em 15/10/2026 o `bin/getdemo-rc` do `claude-devcontainer` ganhou `--chrome` no `claude remote-control`, e o push foi feito. O flag só vale depois de `sudo systemctl restart getdemo-rc.service`, e o João reinicia quando não houver agente rodando. Esse restart derruba a sessão que estiver aberta.

**How to apply:** se a sessão não tiver as ferramentas `claude-in-chrome` (confira no `/mcp` ou na lista de ferramentas), lembre o João do restart pendente. Enquanto isso, delegue a tarefa de navegador a `claude -p --chrome --permission-mode bypassPermissions "<tarefa fechada>"`, rodado no scratchpad. O João prefere a integração nativa ao Playwright para usar o Chrome dele. Ver [[cofre-credenciais-agentes]] para o MCP `navegador`, que é headless e roda na VPS.
