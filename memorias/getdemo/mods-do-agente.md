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

Em 07/10/2026 o João pediu tudo dos plugins em inglês (pastas, arquivos, código, mensagens, comandos): marketplace e pacote `agent`, mods `usage-limit` (`/limit`), `memory-guard` (`/ram`, porque `/memory` é do Claude Code) e `skill-loader`. As mensagens falam em "the user". Prontos e instalados na VPS pelo pacote `agent@agent` (plugin sem código que lista os mods em `dependencies`; o marketplace tem `autoUpdate`). No `memory-guard`, o João escolheu: sem folga, roda com um processo só, depois espera até 2 min, depois recusa.

Em 07/10/2026 o João decidiu não ter mod de bloqueio: nada é recusado por perigo, o bypass continua. Não proponha bloqueio de comando ou de MCP de novo.

Em 07/10/2026 entrou o `audit` (`/audit`), que grava as chamadas MCP de escrita em `~/.local/state/mods/audit/`.

Também entrou o `loop-breaker`.

O `secret-guard` (porte do `segredo.pl`, placeholder `<hidden:NOME>`, aceita `<oculto:NOME>` no restore) entrou em 07/10/2026 rodando junto com o Perl. O Perl roda antes do mod, então comparar os dois lado a lado não prova nada: a prova foi a sessão isolada (`CLAUDE_CONFIG_DIR` próprio, sem os hooks, segredos falsos), com zero vazamento. Erro de hook no mod fecha a saída com `deny`. Falta decidir quando tirar o Perl do `settings.json`.

No mod `usage-limit`, o João escolheu: em 98% a sessão pausa e retoma sozinha quando a janela volta; um prompt dele (terminal, Remote Control ou `claude -p`) ganha um turno sem subagente; prompt automático fica guardado para a retomada.

O que a validação provou numa sessão de Remote Control:
- `$.prompt.submit` retoma sessão parada e aparece no claude.ai e no celular
- `$.ui.log` e o `text` do `turn.complete` só aparecem no terminal
- `$.ui.ask` vira AskUserQuestion: chegou no claude.ai do PC, não abriu no celular. Use prazo e caia para pergunta no chat
- `$.session.surfaces()` lista só `terminal`; o mod não sabe se o João está no claude.ai
- o resultado que o `tool.call` vê já passou pelo `segredo.pl`; o resultado reescrito pelo mod é o que vai para o transcript em disco
- o percentual de limite só chega depois da primeira resposta da sessão; por isso o mod `usage-limit` guarda a leitura em `$.store`, compartilhada entre sessões
- funções que recebem `$` precisam ficar no topo do arquivo, e não podem vir de outro arquivo, ou o `claude plugin validate` reprova. Por isso cada mod é um arquivo de hooks, e os mods ficam separados
- `$.tool.call({ tool: 'Skill' })` responde "Launching skill" mas não põe o texto da skill na conversa; o mod `skill-loader` lê o `SKILL.md` do disco e entrega no `context` do resultado ou no texto da recusa
- um hook só pode rodar 10 s de código próprio, e o `$.clock.sleep` conta; esperar dentro de `$.process.run(['sleep', '5'])` não conta

**Why:** regra em CLAUDE.md depende de o modelo lembrar; o mod é determinístico.
**How to apply:** mod novo entra no marketplace `agent`, em inglês, com teste. Ver [[vps-claude-devcontainer]].
