# claude-devcontainer

Tudo que monta a VPS onde o Claude Code roda 24 horas: a configuração do Claude Code, os serviços do systemd, os scripts, as skills feitas aqui e o navegador que usa o cofre de senhas. O repo é o backup da máquina e a receita para montar outra.

## O que tem aqui

| pasta | o que guarda | na máquina |
| :--- | :--- | :--- |
| `claude/` | `CLAUDE.md` global, `settings.json` e `settings.local.json` | `~/.claude/` |
| `hooks/segredo.pl` | Troca o valor de segredo por `<oculto:NOME>` na saída de toda ferramenta | `~/.claude/hooks/` |
| `bin/` | Os laços do Remote Control (`getdemo-rc`, `zippi-rc`, `esag-rc`, `resgate-rc`), `memoria`, `sessoes-limite`, `sessoes-reinicio` e `navegador-cofre` | `~/.local/bin/` |
| `skills/` | As skills feitas nesta máquina. As do pack do skills.sh ficam de fora | `~/.claude/skills/` |
| `mods/` e `.claude-plugin/` | Os mods do Claude Code, um plugin por mod, no marketplace `cockpit`. Tudo dentro deles é em inglês | instalados pelo `claude plugin install` |
| `systemd/` | As slices de memória, os serviços `*-rc` com os drop-ins, os timers e o `cockpit-panel.service`, que roda o servidor do mod `panel` | `/etc/systemd/system/` |
| `needrestart/sessoes.conf` | Tira os serviços `*-rc` do reinício que o needrestart faz depois do unattended-upgrade | `/etc/needrestart/conf.d/` |
| `tarefas/sessoes-limite/` | O `retomar.py` do timer `retomar-limite`, desligado desde 07/10/2026, e o `PROMPT.md` da sessão que montou a retomada | `~/tarefas/sessoes-limite/` |
| `shell/` | O terminal da VPS: `zshrc`, `profile`, `npmrc`, `starship.toml` e o `config.jsonc` do fastfetch | `~/` e `~/.config/` |
| `resgate/CLAUDE.md` | As instruções do agente de resgate | `~/resgate/` |
| `ambientes/` | O `CLAUDE.md` de cada pasta que um serviço `*-rc` abre, como `getdemo` e `esag` | `~/<pasta>/CLAUDE.md` |
| `memorias/` | A memória automática do Claude Code de cada projeto, como `getdemo` e `esag`, e a `vps`, com o que vale para qualquer pasta. O `CLAUDE.md` global importa o índice da `vps` e diz quando salvar em cada uma | `~/.claude/projects/<projeto>/memory/`; a `vps` fica no repo |
| `docs/always-on.html` | O guia "Claude Code Always-On", exportado do claude.ai | |
| `.env.bw-agente.example` | Modelo das credenciais da conta do agente no Vaultwarden | `~/getdemo/.env.bw-agente` |

## Mude a máquina e o repo junto

Quase todo arquivo instalado é um link para este repo. Uma mudança feita na VPS já aparece no `git status`.

Três coisas entram como cópia: o `settings.json`, o `settings.local.json` e as units do systemd. O Claude Code regrava o `settings.json` inteiro e desfaz o link, e as units são do root. Antes de commitar, rode:

```sh
~/claude-devcontainer/capturar.sh
```

O script copia as três de volta para o repo e mostra o `git status`.

## Monte uma VPS nova

O guia em `docs/always-on.html` cobre a máquina: o usuário, o SSH, o Docker, o login do Claude e do GitHub. Depois dele:

1. Clone o repo e rode o instalador:

	```sh
	git clone git@github.com:joaosavi/claude-devcontainer.git ~/claude-devcontainer
	~/claude-devcontainer/install.sh
	```

	Ele cria os links, copia o `settings.json` se ainda não existir, instala os mods, registra o MCP `navegador`, instala o Chromium, instala as units com `sudo` e liga os serviços. No fim, roda o teste do hook de segredo.

2. Pelo SSH, crie as credenciais da conta do agente:

	```sh
	cp ~/claude-devcontainer/.env.bw-agente.example ~/getdemo/.env.bw-agente
	chmod 600 ~/getdemo/.env.bw-agente
	```

3. Confira os nomes de segredo que o agente recebe, sem os valores:

	```sh
	~/.local/bin/navegador-cofre --nomes
	```

## Os mods

Um mod é um plugin com código que roda dentro do Claude Code e responde a eventos: uma chamada de ferramenta, um prompt, um subagente subindo. Ele faz de forma determinística o que antes era regra no `CLAUDE.md` ou script num timer. A raiz do repo é o marketplace `cockpit`, e cada pasta em `mods/` é um plugin dele.

| mod | o que faz |
| :--- | :--- |
| `agent` | O pacote. Não tem código: instala os outros como dependência |
| `usage-limit` | Acima de 90% do limite de uso da conta, deixa subir um subagente por vez. Em 98%, para a sessão, guarda os 2% finais para o João e retoma sozinho quando a janela volta |
| `memory-guard` | Antes de typecheck, teste, build ou Playwright, confere se o comando cabe no teto de memória do grupo (`memory.max`, onde o kernel mata), menos 2%. O alto só conta para grupo sem teto. O uso é o working set: `memory.current` menos o `inactive_file` do `memory.stat`, porque o kernel solta esse cache antes de mandar memória de processo para o swap. Se não cabe, roda com um processo só, espera até 2 minutos ou recusa. Repete com um processo só o comando que morreu com exit 137, e guarda o pico de cada comando para a próxima conta |
| `skill-loader` | Entrega a skill certa junto com a ação: `typescript-best-practices` ao ler ou escrever `.ts`, `writing-for-agents` em `SKILL.md`, `AGENTS.md` e `CLAUDE.md`, `domain-modeling` em `CONTEXT.md` e ADR, `technical-writing` em README, commit e PR. Lê o `SKILL.md` do disco, porque a ferramenta Skill chamada por um mod não põe o texto na conversa |
| `loop-breaker` | Avisa o agente que ele está andando em círculo: 5 edições no mesmo arquivo enquanto um comando segue falhando, o mesmo erro 3 vezes, ou a mesma chamada 3 vezes seguidas. Não recusa nada: o aviso entra no resultado da ferramenta. Reconhece a falha pelo texto mesmo quando um `\| head` esconde o código de saída |
| `secret-guard` | O porte do `segredo.pl`: troca todo valor de segredo por `<hidden:NOME>` no resultado de qualquer ferramenta, MCP e subagente inclusive, e devolve o valor real quando o agente escreve o placeholder num `.env`. Lê as mesmas fontes do Perl. Roda junto com o `segredo.pl` até o Perl sair do `settings.json` |
| `collision-guard` | Avisa quando outra sessão desta máquina editou o mesmo arquivo e ainda não commitou, e segura uma vez o `git add -A`, `commit -a`, `stash`, `checkout` ou `reset --hard` que levaria junto a edição da outra. Rodar o mesmo comando de novo em 2 min libera |
| `pipefail` | Põe `set -o pipefail;` na frente de um comando que corta a saída de teste, typecheck ou lint com `tail`, `head` ou `grep`. Sem isso, o teste reprovado sai com 0. O `guard-bash.sh` do zippi aceita o comando reescrito, então o agente não perde a rodada |
| `global-memory` | A memória que vale para a VPS inteira, em `memorias/vps/`: reescreve a seção de memória do system prompt para as duas pastas, com a regra de onde salvar cada tipo, e põe o índice global no contexto de toda sessão. Numa conta Team, o guarda embutido barra mod de usuário nesses ganchos, então ele roda como mod da organização: `claude/managed-settings.json` vai para `/etc/claude-code/`, e o painel de admin do claude.ai tem `"managedSourcesBehavior": "merge"`. Fica fora do pacote `cockpit` |
| `panel` | Uma página web local, em `127.0.0.1:7777`, com um card por sessão do Claude Code da máquina: estado (Working, Waiting for you, Blocked, Done, Idle, Ended), o que a sessão espera de você com as opções, a ferramenta rodando agora, o que foi feito, o próximo passo, contexto usado, link para a sessão no claude.ai e o comando do tmux. O servidor é `mods/panel/server/panel.py`, só biblioteca padrão do Python. Os fatos vêm de `~/.claude/sessions/*.json` e dos transcripts; o resumo vem de `claude -p` (`sonnet` por padrão) quando você aperta Refresh, quando a sessão fica ociosa depois de um turno, e a cada 5 min para sessão que mudou. O mod sobe o servidor quando a sessão começa e ele não responde (opção `autostart`), e o `/panel` dá o endereço e o túnel `ssh -N -L 7777:127.0.0.1:7777 <host>`. Opções: `port`, `model` (`sonnet`, `haiku`, `opus`), `refreshMinutes`, `autostart`. Na VPS o `autostart` fica em `false`, porque quem roda o servidor é a unit `cockpit-panel.service`. Estado em `~/.local/state/mods/panel/`: `summaries/<sessão>.json` e um diário do servidor por dia |
| `hud` | Um painel com modelo, projeto e branch, contexto, limites e folga de memória, e durante o turno a ferramenta e os subagentes em andamento. O `/hud` abre a visão completa. Opções: `band` (`panel`, `line` ou `off`), `activity`, `memory`. Na VPS o painel fica embaixo do prompt pela statusline `mods/hud/statusline/statusline.sh`, com `band` em `off`, e a faixa de cima mostra só a atividade do turno |
| `spinner-status` | Troca a dica embaixo do spinner por uma linha do Haiku: onde a sessão está, alternando a cada 15 s com uma dica dos mods que serve ao momento. Uma chamada por turno, em segundo plano, lendo só os 3 últimos prompts e o texto do agente entre eles (até 3.000 caracteres, uns 500 tokens de entrada). Opções: `mode` (`mixed`, `tips` sem chamada de modelo, `summary`) e `model`. O texto do mod é em inglês, e a linha do Haiku sai na língua em que o usuário escreve. A dica nativa sai com `"spinnerTipsEnabled": false` no `settings.json` |

Os mods estão em inglês e com padrões genéricos, prontos para outro usuário instalar. O que é desta VPS fica nas opções: `pluginConfigs` no `claude/settings.json` (pasta dos `.env` do `secret-guard`, fuso, scripts extras do `pipefail`, layout do `hud`) e no `claude/managed-settings.json` (pasta da memória global). Cada plugin tem o próprio README em `mods/<mod>/README.md`.

Cada mod grava um diário por sessão em `~/.local/state/mods/<mod>/`, com uma linha de resumo no fim da sessão (chamadas vistas, ações, tempo gasto nos hooks). Os comandos são `/limit`, `/ram`, `/panel` e `/hud`, e respondem em texto em qualquer lugar, Remote Control inclusive. No terminal e no app Desktop há também a parte visual: o `usage-limit` desenha uma faixa acima do prompt com as barras de 5 h e de 7 dias a partir de 75% (opção `bandFrom`), e o `/ram` abre um painel com a barra de cada grupo que se atualiza a cada 2 s.

O `retomar-limite.timer` foi desligado em 07/10/2026. A sessão que ainda bater 100% é retomada pelo próprio `usage-limit`, pela opção `resume`, ligada por padrão.

O `sessoes-reinicio.timer` roda às 07:40 UTC, depois do unattended-upgrade. Quando um serviço `*-rc` está com biblioteca do sistema apagada, ele reinicia o serviço e retoma cada sessão aberta pelo id. A sessão que caiu no meio de um turno recebe uma mensagem para seguir. O `sessoes-reinicio --simular` lista o que ele faria, e o `--teste` prova a volta numa sessão descartável.

Para mudar um mod:

1. Edite o código e rode os testes na pasta dele:

	```sh
	claude plugin validate ~/claude-devcontainer/mods/usage-limit
	claude plugin test ~/claude-devcontainer/mods/usage-limit
	```

2. Suba o `version` no `.claude-plugin/plugin.json` do mod. Sem a versão nova, o Claude Code mantém a cópia antiga.
3. Para um mod novo, inclua o nome dele no `dependencies` de `mods/cockpit/.claude-plugin/plugin.json`, suba o `version` do `cockpit` e registre o mod no `.claude-plugin/marketplace.json`. Para instalar na hora, sem esperar a atualização automática, rode `claude plugin install cockpit@cockpit`. O `claude plugin update` sozinho atualiza o pacote mas não instala a dependência nova.

O marketplace `cockpit` tem atualização automática ligada no `settings.json`. Depois da mudança, a primeira sessão que abre atualiza a cópia instalada e instala a dependência que entrou, e as sessões abertas a partir daí carregam a versão nova. As sessões abertas continuam com a versão antiga até um `/reload-plugins` ou até reabrir.

Para usar os mods em outra máquina, adicione o repo como marketplace e instale o pacote:

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install cockpit@cockpit
```

Na outra máquina, ligue a atualização automática do marketplace `cockpit` no `/plugin`, aba **Marketplaces**. Desinstalar o pacote deixa os mods instalados, e o `claude plugin prune` remove os que sobraram.

## Fica fora do git

As credenciais do Claude Code e do GitHub, o `~/.secrets` e todo `.env`. Cada máquina faz os próprios logins. A memória dos projetos entra, e ela tem dado de empresa: o repo precisa continuar privado.

## Como o navegador usa o cofre

1. O `navegador-cofre` destrava o Vaultwarden com a conta do agente, lê os logins da organização "Agente Getdemo" e trava o cofre de novo.
2. Ele grava em `/dev/shm` um arquivo com um nome por domínio, como `LOGIN_CONTAAZUL_COM_PASSWORD`, e apaga o arquivo em 90 s.
3. Ele abre o `@playwright/mcp` com `--secrets` apontando para esse arquivo.
4. O agente digita o nome do segredo. O Playwright troca o nome pelo valor dentro do navegador e mascara o valor em tudo que devolve.

O PayPal fica fora do arquivo e bloqueado no navegador.

Limites conhecidos:

- O `browser_evaluate` devolve sem máscara qualquer transformação do valor, como o tamanho.
- A máscara troca por valor. Dois logins com o mesmo usuário aparecem com o nome de um deles.
- O usuário que roda as sessões lê o `.env.bw-agente` e tem sudo. O conjunto evita vazamento por acidente e não segura um agente que queira a senha.
