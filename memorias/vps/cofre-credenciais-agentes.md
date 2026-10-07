---
name: cofre-credenciais-agentes
description: "João quer dar credenciais aos agentes sem vazar, custo zero, partindo do Bitwarden que já guarda as senhas da Getdemo"
metadata:
  node_type: memory
  type: project
  originSessionId: 451e3013-beb9-5549-b029-76c0f7988751
  modified: 2026-10-05T17:55:35.493Z
---

Em 2026-10-05 o João pediu pesquisa de um gerenciador de senhas para agentes. Restrições dele: não gastar dinheiro, usar algo pronto, aproveitar o Bitwarden onde já estão todas as senhas da Getdemo.

O que a pesquisa achou na VPS: os segredos do `zippi-datawarehouse` estão em 6 arquivos `.env` em texto puro (37 variáveis, 14 delas URLs de Postgres), e o usuário `sv` que roda as sessões tem sudo sem senha e grupo docker. Por isso nenhum cofre local isola o segredo de um agente enganado.

Recomendação entregue na primeira resposta: Bitwarden Secrets Manager. Depois o João pediu projeto open source simples, sem precisar de Bitwarden, e a recomendação passou a ser o fnox (jdx/fnox, age local, `fnox exec`). Varlock e psst ficaram como alternativas.

Já existe o hook global `~/.claude/hooks/segredo.pl` (02/10/2026), que troca valor de segredo por `<oculto:NOME>` na saída de toda ferramenta. Em 05/10 o `GITHUB_TOKEN` e o `BETTER_AUTH_SECRET` vazados em 02/10 ainda eram os valores em uso, sem rotação.

**Why:** a decisão do nível de proteção ficou com o João; a próxima sessão precisa saber o que já foi pesquisado.
**How to apply:** antes de pesquisar de novo, pergunte o que ele decidiu. A migração dos `.env` é código do `zippi-datawarehouse` e roda na sessão daquele ambiente.

Montado em 05/10/2026: Vaultwarden em https://pwvault.zippitech.online, conta do agente `joao.savi@getdemo.com.br`, organização "Agente Getdemo". Credenciais da conta em `~/getdemo/.env.bw-agente` (o João preenche pelo SSH). O MCP `navegador` (user scope) roda `~/.local/bin/navegador-cofre`, que monta o arquivo de senhas do Playwright em /dev/shm e apaga em 90 s; o nome é o domínio, ex. `LOGIN_CONTAAZUL_COM_PASSWORD`. PayPal fica fora (filtro no script). Amazon sai do cofre (o João tira o login); o hook que pedia permissão foi apagado em 05/10. `Bash(bw:*)` negado, plugin playwright desligado.

Testado em 05/10/2026 à noite: o wrapper ganhou versão fixa `@playwright/mcp@0.0.83`, Chromium headless (revisão 1247 em `~/.cache/ms-playwright`), `--isolated`, `--output-dir` fora do projeto, PayPal bloqueado também por `--blocked-origins`, `flock` em volta do `bw` e saída com erro se o cofre voltar vazio. Partida leva 16 s; o segredo continua digitável depois que o arquivo em /dev/shm some. Limites achados: `browser_evaluate` devolve qualquer transformação do valor sem máscara (o tamanho apareceu). O hook da Amazon com `ask` não segurava nada em sessão remota em bypass, por isso saiu.

Versionado no repo privado `joaosavi/claude-devcontainer`, clonado em `~/claude-devcontainer` (ver [[vps-claude-devcontainer]]). O `navegador-cofre` e o `segredo.pl` instalados são links para o repo, então mudança se faz lá e se commita. `install.sh` refaz tudo numa máquina nova.
