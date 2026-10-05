# claude-devcontainer

O agente do Claude Code entra em site com as senhas do cofre sem ver as senhas, e nenhum valor de segredo chega ao transcript.

## O que tem aqui

| arquivo | o que faz | vai para |
| :--- | :--- | :--- |
| `bin/navegador-cofre` | Lê os logins da organização "Agente Getdemo" no Vaultwarden e abre o Playwright MCP com eles | `~/.local/bin/navegador-cofre` |
| `hooks/segredo.pl` | Troca o valor de segredo por `<oculto:NOME>` na saída de toda ferramenta | `~/.claude/hooks/segredo.pl` |
| `install.sh` | Cria os links, ajusta o `settings.json`, registra o MCP e instala o Chromium | |
| `skills/tcc-esag/` | A skill do TCC da ESAG, feita nesta máquina | `~/.claude/skills/tcc-esag` |
| `.env.bw-agente.example` | Modelo das credenciais da conta do agente | `~/getdemo/.env.bw-agente` |

Os arquivos instalados são links para este repo. Edite aqui, e a próxima sessão já usa a versão nova.

## Como o navegador usa o cofre

1. O `navegador-cofre` destrava o cofre com a conta do agente, lê os logins da organização e trava o cofre de novo.
2. Ele grava um arquivo em `/dev/shm`, com um nome por domínio: `LOGIN_CONTAAZUL_COM_USER` e `LOGIN_CONTAAZUL_COM_PASSWORD`. O arquivo é apagado em 90 s.
3. Ele abre o `@playwright/mcp` com `--secrets` apontando para esse arquivo.
4. O agente digita o nome do segredo. O Playwright troca o nome pelo valor dentro do navegador e mascara o valor em tudo que devolve.

O PayPal fica fora do arquivo e bloqueado no navegador por `--blocked-origins`.

## Instale numa máquina nova

Pré-requisitos: `bw` (`npm i -g @bitwarden/cli`), `jq`, `flock`, Node com `npx`, `perl` e `claude`.

1. Clone o repo e rode o instalador:

	```sh
	git clone git@github.com:joaosavi/claude-devcontainer.git ~/claude-devcontainer
	~/claude-devcontainer/install.sh
	```

2. Pelo SSH, copie o modelo e preencha as credenciais da conta do agente:

	```sh
	cp ~/claude-devcontainer/.env.bw-agente.example ~/getdemo/.env.bw-agente
	chmod 600 ~/getdemo/.env.bw-agente
	```

3. Confira os nomes que o agente vai receber, sem os valores:

	```sh
	~/.local/bin/navegador-cofre --nomes
	```

4. Abra uma sessão nova do Claude Code. O MCP `navegador` leva cerca de 16 s para partir.

O instalador termina rodando `segredo.pl --teste`, que prova o hook com segredos falsos.

## Limites conhecidos

- O `browser_evaluate` devolve sem máscara qualquer transformação do valor, como o tamanho ou o valor separado por espaços.
- A máscara troca por valor. Dois logins com o mesmo usuário aparecem com o nome de um deles.
- O usuário que roda as sessões lê o `.env.bw-agente` e tem sudo. O conjunto evita vazamento por acidente e não segura um agente que queira a senha.
