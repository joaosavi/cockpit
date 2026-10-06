---
name: mods-do-agente
description: "Frente de mods do Claude Code no claude-devcontainer; plano aprovado em 06/10/2026, o que a validação provou no Remote Control"
metadata:
  node_type: memory
  type: project
  originSessionId: 0d5283fe-2c54-5186-a208-abf840a2a0b0
  modified: 2026-10-06T21:18:31.348Z
---

Em 06/10/2026 o João aprovou trocar regra de `CLAUDE.md` e script de timer por mods (plugins com hooks em JS/TS, Claude Code 2.1.287+). Os mods moram em `~/claude-devcontainer/mods/`, com o marketplace `agente` na raiz do repo (`.claude-plugin/marketplace.json`), um plugin por mod, cada um com teste em `claude plugin test`. O João quer usar os mesmos mods no PC de casa, então cada mod tem versão visual para o terminal.

Prontos e instalados na VPS: `limite` e `memoria`, pelo pacote `agente` (plugin sem código que lista os mods em `dependencies`; o marketplace tem `autoUpdate`). No `memoria`, o João escolheu: sem folga, roda com um processo só, depois espera até 2 min, depois recusa.

A ordem que falta: skills na hora certa (troca a seção "Skills que você carrega na hora" do CLAUDE.md global), bloqueio explícito de comando perigoso nos sistemas da empresa (o bypass continua; a lista ainda é decisão do João), auditoria de chamada MCP de escrita, freio de laço, e o `segredo.pl` portado para mod (rodam juntos até o mod passar nos casos do `--teste`).

No mod limite, o João escolheu: em 98% a sessão pausa e retoma sozinha quando a janela volta; um prompt dele (terminal, Remote Control ou `claude -p`) ganha um turno sem subagente; prompt automático fica guardado para a retomada.

O que a validação provou numa sessão de Remote Control:
- `$.prompt.submit` retoma sessão parada e aparece no claude.ai e no celular
- `$.ui.log` e o `text` do `turn.complete` só aparecem no terminal
- `$.ui.ask` vira AskUserQuestion: chegou no claude.ai do PC, não abriu no celular. Use prazo e caia para pergunta no chat
- `$.session.surfaces()` lista só `terminal`; o mod não sabe se o João está no claude.ai
- o resultado que o `tool.call` vê já passou pelo `segredo.pl`; o resultado reescrito pelo mod é o que vai para o transcript em disco
- o percentual de limite só chega depois da primeira resposta da sessão; por isso o mod limite guarda a leitura em `$.store`, compartilhada entre sessões
- funções que recebem `$` precisam ficar no topo do arquivo, e não podem vir de outro arquivo, ou o `claude plugin validate` reprova. Por isso cada mod é um arquivo de hooks, e os mods ficam separados
- um hook só pode rodar 10 s de código próprio, e o `$.clock.sleep` conta; esperar dentro de `$.process.run(['sleep', '5'])` não conta

**Why:** regra em CLAUDE.md depende de o modelo lembrar; o mod é determinístico.
**How to apply:** mod novo entra no marketplace `agente`, com teste. Ver [[vps-claude-devcontainer]].
