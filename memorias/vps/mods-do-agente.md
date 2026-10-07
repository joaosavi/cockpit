---
name: mods-do-agente
description: "Frente de mods do Claude Code no claude-devcontainer; plano aprovado em 06/10/2026, o que a validação provou no Remote Control"
metadata:
  node_type: memory
  type: project
  originSessionId: 0d5283fe-2c54-5186-a208-abf840a2a0b0
  modified: 2026-10-06T21:18:31.348Z
---

Em 06/10/2026 o João aprovou trocar regra de `CLAUDE.md` e script de timer por mods (plugins com hooks em JS/TS, Claude Code 2.1.287+). Os mods moram em `~/claude-devcontainer/mods/`, com o marketplace `agente` na raiz do repo (`.claude-plugin/marketplace.json`), um plugin por mod, cada um com teste em `claude plugin test`. O João quer usar os mesmos mods no PC de casa. Desde 07/10/2026 há parte visual: faixa do `usage-limit` acima do prompt (a partir de 75%), painel do `/ram` e painel do `/audit`; os comandos continuam respondendo em texto para o Remote Control.

Em 07/10/2026 o João pediu tudo dos plugins em inglês (pastas, arquivos, código, mensagens, comandos): marketplace e pacote `agent`, mods `usage-limit` (`/limit`), `memory-guard` (`/ram`, porque `/memory` é do Claude Code) e `skill-loader`. As mensagens falam em "the user". Prontos e instalados na VPS pelo pacote `agent@agent` (plugin sem código que lista os mods em `dependencies`; o marketplace tem `autoUpdate`). No `memory-guard`, o João escolheu: o limite é o teto (`memory.max`) menos 2%, não o alto (07/10/2026; com o alto, o `agentes.slice` recusava o typecheck do zippi com as três frentes abertas). O uso conta o working set, `memory.current` menos `inactive_file` (o João pediu em 07/10/2026: o `agentes.slice` tinha 1 GB de cache inativo, e o guarda segurava o tsc por horas com 1,6 GB livres de verdade). Sem folga, roda com um processo só, depois espera até 2 min, depois recusa.

Em 07/10/2026 o João decidiu não ter mod de bloqueio: nada é recusado por perigo, o bypass continua. Não proponha bloqueio de comando ou de MCP de novo.

Em 07/10/2026 entrou o `audit` (`/audit`), que grava as chamadas MCP de escrita em `~/.local/state/mods/audit/`.

Também entraram o `loop-breaker` e o `pipefail` (põe `set -o pipefail;` em teste cortado por tail/head/grep; o `guard-bash.sh` do zippi aceita o reescrito). Em 07/10/2026 o `retomar-limite.timer` foi desligado e o `resumeOnError` do `usage-limit` passou a vir ligado.

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

O plano Team liga o guarda embutido `sec-default`, que tira os mods instalados pelo usuário dos ganchos `prompt.section`, `prompt.context`, `prompt.compose`, `skill.prompt` e `classic.*`: eles nunca disparam para mod nosso (provado em 07/10/2026 com sonda em -p e no terminal). A saída, em 07/10/2026: o `global-memory` roda como mod da organização. O arquivo `/etc/claude-code/managed-settings.json` (no repo, `claude/managed-settings.json`) declara o marketplace `agent` como pasta, liga o plugin e põe ele em `prependPlugins` antes do `sec-default@builtin`. Como o claude.ai já manda configuração gerenciada (`channelsEnabled`), o João pôs `"managedSourcesBehavior": "merge"` no painel de admin, senão o arquivo local era ignorado. Provado com log `tier prepend` e sessões em -p e Remote Control. Ele não entra no pacote `agent`. O contexto precisa injetar o índice mesmo antes da seção de memória, porque no terminal interativo o contexto vem primeiro.

Em 07/10/2026 (noite) entraram o `hud` (faixa `panel` + atividade, `/hud`), o `wtf` com opção `language` (VPS em Portuguese) e uma revisão de todos os mods: README por plugin, licença MIT, textos padronizados, padrões genéricos e o que é da VPS em `pluginConfigs` (settings.json e managed-settings.json). O `secret-guard` monta a lista em segundo plano no início da sessão. 224+ testes passando.

Pendências do João (atualizado em 07/10/2026, fim da noite):
- tirar o `segredo.pl` do `settings.json` depois de uns dias de `secret-guard` sem erro (olhar o diário e o `/mods`)
- instalar o pacote no PC de casa: `claude plugin marketplace add joaosavi/claude-devcontainer`, `claude plugin install agent@agent`, ligar autoUpdate, e conferir o `hud`
- decidir se desliga a statusline do `claude-hud`, que repete o que a faixa do `hud` mostra
- para publicar o marketplace de verdade: o repo é privado e tem memória da empresa, então os mods precisam ir para um repo público próprio, com arquivo LICENSE
- julgar cada mod pelo `/mods` e pelo `/ratings` depois de alguns dias de uso real

**Why:** regra em CLAUDE.md depende de o modelo lembrar; o mod é determinístico.
**How to apply:** mod novo entra no marketplace `agent`, em inglês, com teste. Ver [[vps-claude-devcontainer]].
