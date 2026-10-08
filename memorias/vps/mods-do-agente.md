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

Em 07/10/2026 (noite) entraram o `hud` (faixa `panel` + atividade, `/hud`), o `wtf` e uma revisão de todos os mods: README por plugin, licença MIT, textos padronizados, padrões genéricos e o que é da VPS em `pluginConfigs` (settings.json e managed-settings.json). O `secret-guard` monta a lista em segundo plano no início da sessão. 224+ testes passando.

Pendências do João (atualizado em 07/10/2026, noite):
- tirar o `segredo.pl` do `settings.json` depois de uns dias de `secret-guard` sem erro (olhar o diário e o `/mods`)
- no PC de casa: atualizar o pacote `agent`, ligar autoUpdate dos marketplaces `agent` e `mattpocock`, e rodar a skill `agent:setup`
- a faixa de cima e o `/hud` ainda usam o desenho antigo do `hud`; só importa para quem não usa a statusline
- para publicar o marketplace de verdade: o repo é privado e tem memória da empresa, então os mods precisam ir para um repo público próprio, com arquivo LICENSE
- julgar cada mod pelo `/mods` e pelo `/ratings` depois de alguns dias de uso real

Decisões de interface de 07/10/2026 (noite), todas aprovadas pelo João com prévia:
- `hud`: o painel mora embaixo do prompt, na statusline `mods/hud/statusline/statusline.sh` (mod não desenha embaixo do prompt; `$.ui.status` é uma linha com `⚠ hud:`). Quatro estilos na opção `style`: `refined` (padrão), `blocks`, `minimal`, `compact`; cada um tira campos da direita quando a tela é estreita. Git com ↑ ↓ + ● ? e PR do `gh` em cache de 1 min; `icons` `nerd` (padrão) ou `unicode`. Barras em pontos (`bar: dots`) e cor `barColor: gradient` (arco-íris por posição); `solid` e `tone` são alternativas. `refreshInterval: 5` na statusline. A faixa de cima (`band: off`) só mostra aviso de outro mod; tempo, ferramenta, subagentes e erros saíram porque o Claude Code já mostra. O Claude Code pinta de cinza o texto sem cor, por isso nomes em negrito.
- `/wtf`: estado em código (`WAITING`) e resumo em negrito na mesma linha, `→ you:` só quando há pedido (o modelo escreve `You: -` quando não há), opções recuadas com espaço inseparável (o Claude Code apaga linhas em branco do texto de comando), rodapé em citação. O texto de comando só aparece quando o turno acaba, então no meio do turno abre um painel (Ink, quebra dentro da borda); botão nativo `r: re-run`.
- `spinner-status` (era `tip` até 08/10/2026): linha embaixo do spinner com rótulo `Now:` ou `Mods:`; `spinnerTipsEnabled: false`.
- Texto fixo dos mods só em inglês, sem tradução; o que o Haiku escreve segue o `language` do Claude Code, e sem ele a língua da conversa.
- Autocompact: `autoCompactWindow: 733000` (compacta em 700K, 70% do 1M; `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` não mudou nada no `/context`). Handoff como mod foi descartado: o compact nativo já resume em seções.
- Skills: as do Matt Pocock vêm do plugin `mattpocock-skills@mattpocock`; o `skill-loader` carrega dentro dele as 5 que usa (duplicadas com as do Matt de propósito). O pack do skills.sh ficou com arena, git-guardrails-claude-code, setup-pre-commit, setup-ts-deep-modules, architect, archify, humanizer, field-guide, chain-check.

Em 07/10/2026 o João fixou a regra de idioma: todo texto fixo dos mods (rótulos, nomes, mensagens, catálogos) é só em inglês, sem tabela em português nem opção `language`. O que o modelo escreve (Haiku no `/wtf` e no `tip`) sai na língua do setting `language` do Claude Code, lido por `$.settings.read()`, e sem ele na língua em que o usuário escreve. Em 08/10/2026 o João reconfirmou: traduzir os ~75 rótulos custaria manutenção a cada texto novo e quebraria a largura da statusline. A marca "(recommended)" do `/wtf` é fixada no código, porque o Haiku traduzia às vezes. Não mantenha duas línguas no repo.

Em 08/10/2026 o João pediu ao `usage-limit`: retomar quando a janela volta continua o padrão, mas com opção para desligar (hoje só o `resumeOnError` desliga, e só o caso do erro de 100%); e, na pausa, guardar o trabalho com commit sem push (o zippi está em produção e push na `main` iria para o ar). Ideia tirada do limit-parking (soonavi/claude-mods). No mesmo dia ele mandou manter o `/wtf` como está, sem trocar por mod de terceiro nem mudar o nome.

**Why:** regra em CLAUDE.md depende de o modelo lembrar; o mod é determinístico.
Nomes (08/10/2026, aprovados pelo João): substantivo mais papel, como `secret-guard`; `/wtf` fica, porque a gíria é da comunidade. Mods novos avaliados com os transcripts da VPS (08/10/2026): `output-trim` e `paste-to-file` não compensam (teste, typecheck, lint e build são 2,8% dos 8 M de caracteres de Bash, média de 497 por saída de teste, porque o vitest fora de TTY já sai compacto e o agente usa `| tail`; o maior prompt colado tem 11 mil caracteres). `collision-guard` tem caso: 11 pares de sessões editaram o mesmo repo com menos de 30 min de distância em 8 dias, 5 no mesmo arquivo. O Edit nativo já recusa arquivo mudado desde a leitura, então o risco que sobra é git (`add -A`, commit, checkout) levando a edição da outra sessão. Descartados: `style-guard` (estilo de resposta é individual) e typecheck em segundo plano (gasta RAM para adiantar um erro que o agente acha antes do commit). A pré-compactação existe no Claude Code atrás de flags do servidor (`tengu_gleaming_fair`), desligada aqui; mod não dispara.

**How to apply:** mod novo entra no marketplace `agent`, em inglês, com teste. Ver [[vps-claude-devcontainer]].
