# Tarefa: retomar sessões paradas por limite de uso

Você roda no getdemo-dev, o container LXD da VPS (host `oracle`), aberta por um timer do systemd em 05/10/2026. Esta sessão tem Remote Control, então eu acompanho e aprovo pelo celular.

## Cuidado com tokens

Esta tarefa nasceu porque a sessão anterior estourou o limite de uso. Trabalhe sem subagentes, ou com um só quando uma pesquisa exigir. Leia trechos de arquivo em vez de arquivos inteiros, e corte saída longa com head, tail e grep.

## Como a máquina está montada

- Quatro servidores do Remote Control, cada um num serviço systemd que roda um tmux:
  - `esag-rc.service`: tmux `-L esag -t esag`, pasta `~/esag`
  - `getdemo-rc.service`: tmux `-L getdemo -t getdemo`, pasta `~/getdemo`
  - `zippi-rc.service`: tmux `-L zippi -t zippi`, pasta `~/getdemo/zippi-datawarehouse`
  - `resgate-rc.service`: tmux `-L resgate -t resgate`, pasta `~/resgate`
- Os três primeiros ficam em `agentes.slice`, com teto de memória, e o resgate tem memória reservada. O comando `memoria` mostra o uso, e os limites estão na seção "Memória desta VPS" do `~/.claude/CLAUDE.md`.
- Cada sessão aberta pelo app vira um processo filho do servidor, com `--print --sdk-url https://api.anthropic.com/v1/code/sessions/cse_... --session-id cse_...`.
- Parado com Ctrl+C no tmux, o servidor traz as sessões de volta quando `claude remote-control` roda de novo na mesma pasta, por umas 4 horas. As que estavam no meio de uma tarefa voltam sozinhas.

## O que eu quero

Um job periódico na VPS, num timer do systemd no padrão dos serviços acima, que:
1. Detecta as sessões das três pastas cuja execução parou por limite de uso da conta, com a mensagem de limite e o horário em que ele volta.
2. Guarda quais foram interrompidas e quando o limite volta.
3. Depois do horário de volta, retoma cada uma mandando uma mensagem nela. Toda mensagem diz que a sessão estourou o limite de uso e pede cautela com tokens para seguir trabalhando.
4. Para a sessão que estourou o limite usando muitos subagentes, a mensagem diz isso com o número de subagentes, e pede que ela siga sem subagentes em paralelo, em vez de retomar do jeito que estava.
5. Retoma cada sessão uma vez por limite, e espera o limite voltar antes de mandar qualquer coisa.

## Como fazer

1. Investigue antes de construir, e me mostre o que achou em até 10 linhas: onde fica o histórico de cada sessão do Remote Control na máquina (procure a session id em `~/.claude/projects`), como a mensagem de limite aparece nele (procure em sessões antigas), como contar os subagentes de uma sessão no histórico, e como mandar uma mensagem para uma sessão sem eu estar no app. Um caminho possível é a ferramenta `send_later` do MCP `claude-code-remote`, que as sessões do Remote Control recebem. Abra a documentação em https://code.claude.com/docs antes de afirmar como algo funciona.
2. Me traga o desenho em uma mensagem: o que roda, de quanto em quanto tempo, onde guarda o estado, como decide que é limite e como decide que foram subagentes demais, com o número de corte e o porquê. Espere eu aprovar.
3. Construa e teste sem mexer nas sessões reais: a detecção contra históricos reais, e a retomada contra uma sessão de teste que você mesmo abre. Mostre a saída de cada teste.
4. Me peça aprovação antes de ligar o timer. Ligue só depois do meu ok, e prove com `systemctl list-timers`.
5. Atualize o guia https://claude.ai/artifact/WYPM4VGMd6SdWMvs8Abvrc com a ferramenta de artifact. Leia a versão publicada inteira antes, siga o formato que já está lá (uma seção na página de montagem que couber, uma linha no "No dia a dia", uma linha no "Problemas comuns", o bloco no pedido embutido e a fonte nova) e publique no mesmo link. Se a skill field-guide existir na máquina, siga ela, sem os revisores em subagente. Se a ferramenta de artifact não estiver disponível aqui, grave o HTML em `~/tarefas/sessoes-limite/guia.html` e me diga.

## Regras

- Peça a minha confirmação na hora antes de reiniciar `esag-rc`, `getdemo-rc` ou `resgate-rc`, e antes de matar qualquer sessão.
- Mande mensagem para sessão real só depois que eu aprovar o timer.
- Responda no formato do `~/.claude/CLAUDE.md`.

Comece pela investigação.
