---
name: vps-claude-devcontainer
description: O repo privado joaosavi/claude-devcontainer é o backup e a receita da VPS de agentes; separado do dotfiles (chezmoi)
metadata:
  type: project
---

Desde 06/10/2026, `joaosavi/claude-devcontainer` (clonado em `~/claude-devcontainer`) guarda tudo que monta a VPS: `CLAUDE.md` global, `settings.json`, hook `segredo.pl`, scripts de `~/.local/bin`, units do systemd, a tarefa `sessoes-limite`, a config do terminal em `shell/` (`.zshrc`, `.profile`, `.npmrc`, starship, fastfetch), o `CLAUDE.md` do resgate, as skills `tcc-esag` e `chain-check` e o guia Always-On em HTML. Os arquivos instalados são links para o repo; `settings.json` e as units entram por cópia, trazidas pelo `capturar.sh`.

O `joaosavi/dotfiles` (chezmoi) é só do terminal das máquinas locais do João e não tem nada a ver com a VPS. Em 07/10/2026 o chezmoi saiu da VPS a pedido do João: todo versionamento da VPS passa pelo `claude-devcontainer` no GitHub. A chave age do dotfiles ficou em `~/.config/age/chezmoi-dotfiles.txt`, fora do repo. Skills de terceiros vêm do pack do skills.sh (60 requisições por hora) e não entram no repo; só as que o João construiu entram.

**Why:** o João quer backup caso a VPS quebre, e corrigiu a mistura com o chezmoi.
**How to apply:** mudança em arquivo da VPS se faz no repo e se commita; rode `capturar.sh` antes de commitar. Ver [[cofre-credenciais-agentes]]. A memória do Claude Code de `~/getdemo` e `~/esag` também mora no repo, em `memorias/`, por link.

Sessão do Remote Control encerrada não volta (teste de 06/10/2026): matar o processo faz a ponte marcar "Session failed" e recusar a próxima mensagem. Arquivar pelo claude.ai encerra o processo e os MCPs dele. O `sessoes-esquecidas.timer` (de hora em hora) encerra a sessão da ponte parada há mais de 48 h. O João escolheu 48 h porque arquiva à mão o que para de usar, e o timer só pega o esquecido. Para achar processo com `pgrep -f`, use `[c]` no padrão, senão casa com o próprio shell.
