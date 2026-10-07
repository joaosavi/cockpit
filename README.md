# claude-devcontainer

Tudo que monta a VPS onde o Claude Code roda 24 horas: a configuração do Claude Code, os serviços do systemd, os scripts, as skills feitas aqui e o navegador que usa o cofre de senhas. O repo é o backup da máquina e a receita para montar outra.

## O que tem aqui

| pasta | o que guarda | na máquina |
| :--- | :--- | :--- |
| `claude/` | `CLAUDE.md` global, `settings.json` e `settings.local.json` | `~/.claude/` |
| `hooks/segredo.pl` | Troca o valor de segredo por `<oculto:NOME>` na saída de toda ferramenta | `~/.claude/hooks/` |
| `bin/` | Os laços do Remote Control (`getdemo-rc`, `zippi-rc`, `esag-rc`, `resgate-rc`), `memoria`, `sessoes-limite`, `navegador-cofre` e `avaliacoes-backup`, que envia o dataset do mod `rating` para o repo privado `joaosavi/agent-ratings` depois de passar pelo filtro de segredos | `~/.local/bin/` |
| `skills/` | As skills feitas nesta máquina. As do pack do skills.sh ficam de fora | `~/.claude/skills/` |
| `mods/` e `.claude-plugin/` | Os mods do Claude Code, um plugin por mod, no marketplace `agent`. Tudo dentro deles é em inglês | instalados pelo `claude plugin install` |
| `systemd/` | As slices de memória, os serviços `*-rc` com os drop-ins e os timers | `/etc/systemd/system/` |
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

Um mod é um plugin com código que roda dentro do Claude Code e responde a eventos: uma chamada de ferramenta, um prompt, um subagente subindo. Ele faz de forma determinística o que antes era regra no `CLAUDE.md` ou script num timer. A raiz do repo é o marketplace `agent`, e cada pasta em `mods/` é um plugin dele.

| mod | o que faz |
| :--- | :--- |
| `agent` | O pacote. Não tem código: instala os outros como dependência |
| `usage-limit` | Acima de 90% do limite de uso da conta, deixa subir um subagente por vez. Em 98%, para a sessão, guarda os 2% finais para o João e retoma sozinho quando a janela volta |
| `memory-guard` | Antes de typecheck, teste, build ou Playwright, confere se o comando cabe no teto de memória do grupo (`memory.max`, onde o kernel mata), menos 2%. O alto só conta para grupo sem teto. O uso é o working set: `memory.current` menos o `inactive_file` do `memory.stat`, porque o kernel solta esse cache antes de mandar memória de processo para o swap. Se não cabe, roda com um processo só, espera até 2 minutos ou recusa. Repete com um processo só o comando que morreu com exit 137, e guarda o pico de cada comando para a próxima conta |
| `skill-loader` | Entrega a skill certa junto com a ação: `typescript-best-practices` ao ler ou escrever `.ts`, `writing-for-agents` em `SKILL.md`, `AGENTS.md` e `CLAUDE.md`, `domain-modeling` em `CONTEXT.md` e ADR, `technical-writing` em README, commit e PR. Lê o `SKILL.md` do disco, porque a ferramenta Skill chamada por um mod não põe o texto na conversa |
| `audit` | Grava toda chamada MCP de escrita (Slack, Gmail, HubSpot, Notion, Calendar, Drive) num arquivo por dia em `~/.local/state/mods/audit/`, sem recusar nada, e guarda 30 dias. Na dúvida entre leitura e escrita, grava |
| `loop-breaker` | Avisa o agente que ele está andando em círculo: 5 edições no mesmo arquivo enquanto um comando segue falhando, o mesmo erro 3 vezes, ou a mesma chamada 3 vezes seguidas. Não recusa nada: o aviso entra no resultado da ferramenta. Reconhece a falha pelo texto mesmo quando um `\| head` esconde o código de saída |
| `secret-guard` | O porte do `segredo.pl`: troca todo valor de segredo por `<hidden:NOME>` no resultado de qualquer ferramenta, MCP e subagente inclusive, e devolve o valor real quando o agente escreve o placeholder num `.env`. Lê as mesmas fontes do Perl. Roda junto com o `segredo.pl` até o Perl sair do `settings.json` |
| `pipefail` | Põe `set -o pipefail;` na frente de um comando que corta a saída de teste, typecheck ou lint com `tail`, `head` ou `grep`. Sem isso, o teste reprovado sai com 0. O `guard-bash.sh` do zippi aceita o comando reescrito, então o agente não perde a rodada |
| `mod-report` | O `/mods [dias]` soma os diários de todos os mods: quantas vezes cada um agiu, quanto tempo gastou por chamada de ferramenta, e uma seção de atenção com o que pode estar atrapalhando (mod acima de 20 ms por chamada, comando recusado por memória, escrita refeita por skill, aviso de laço, pausa por limite) |
| `global-memory` | A memória que vale para a VPS inteira, em `memorias/vps/`: reescreve a seção de memória do system prompt para as duas pastas, com a regra de onde salvar cada tipo, e põe o índice global no contexto de toda sessão. Numa conta Team, o guarda embutido barra mod de usuário nesses ganchos, então ele roda como mod da organização: `claude/managed-settings.json` vai para `/etc/claude-code/`, e o painel de admin do claude.ai tem `"managedSourcesBehavior": "merge"`. Fica fora do pacote `agent` |
| `wtf` | O `/wtf [pergunta]` responde em poucas linhas onde a sessão está e o que o agente espera de você, sem interromper o turno. Usa `$.model.fork`, que relê a sessão sem gravar no histórico. A resposta em texto entra no contexto do agente principal |

Cada mod grava um diário por sessão em `~/.local/state/mods/<mod>/`, com uma linha de resumo no fim da sessão (chamadas vistas, ações, tempo gasto nos hooks). Os comandos são `/limit`, `/ram` e `/audit [quantidade] [filtro]`, e respondem em texto em qualquer lugar, Remote Control inclusive. No terminal e no app Desktop há também a parte visual: o `usage-limit` desenha uma faixa acima do prompt com as barras de 5 h e de 7 dias a partir de 75% (opção `bandFrom`), o `/ram` abre um painel com a barra de cada grupo que se atualiza a cada 2 s, e o `/audit` abre um painel com as últimas chamadas e os botões `m` (mais) e `r` (atualizar).

O `retomar-limite.timer` foi desligado em 07/10/2026. A sessão que ainda bater 100% é retomada pelo próprio `usage-limit`, pela opção `resumeOnError`, ligada por padrão.

Para mudar um mod:

1. Edite o código e rode os testes na pasta dele:

	```sh
	claude plugin validate ~/claude-devcontainer/mods/usage-limit
	claude plugin test ~/claude-devcontainer/mods/usage-limit
	```

2. Suba o `version` no `.claude-plugin/plugin.json` do mod. Sem a versão nova, o Claude Code mantém a cópia antiga.
3. Para um mod novo, inclua o nome dele no `dependencies` de `mods/agent/.claude-plugin/plugin.json`, suba o `version` do `agent` e registre o mod no `.claude-plugin/marketplace.json`. Para instalar na hora, sem esperar a atualização automática, rode `claude plugin install agent@agent`. O `claude plugin update` sozinho atualiza o pacote mas não instala a dependência nova.

O marketplace `agent` tem atualização automática ligada no `settings.json`. Depois da mudança, a primeira sessão que abre atualiza a cópia instalada e instala a dependência que entrou, e as sessões abertas a partir daí carregam a versão nova. As sessões abertas continuam com a versão antiga até um `/reload-plugins` ou até reabrir.

Para usar os mods em outra máquina, adicione o repo como marketplace e instale o pacote:

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install agent@agent
```

Na outra máquina, ligue a atualização automática do marketplace `agent` no `/plugin`, aba **Marketplaces**. Desinstalar o pacote deixa os mods instalados, e o `claude plugin prune` remove os que sobraram.

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
