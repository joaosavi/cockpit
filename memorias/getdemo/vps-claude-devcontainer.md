---
name: vps-claude-devcontainer
description: O repo privado joaosavi/claude-devcontainer é o backup e a receita da VPS de agentes; separado do dotfiles (chezmoi)
metadata:
  type: project
---

Desde 06/10/2026, `joaosavi/claude-devcontainer` (clonado em `~/claude-devcontainer`) guarda tudo que monta a VPS: `CLAUDE.md` global, `settings.json`, hook `segredo.pl`, scripts de `~/.local/bin`, units do systemd, a tarefa `sessoes-limite`, o `CLAUDE.md` do resgate, a skill `tcc-esag` e o guia Always-On em HTML. Os arquivos instalados são links para o repo; `settings.json` e as units entram por cópia, trazidas pelo `capturar.sh`.

O `joaosavi/dotfiles` (chezmoi) é só do terminal das máquinas locais do João e não tem nada a ver com a VPS. Skills de terceiros vêm do pack do skills.sh (60 requisições por hora) e não entram no repo; só as que o João construiu entram.

**Why:** o João quer backup caso a VPS quebre, e corrigiu a mistura com o chezmoi.
**How to apply:** mudança em arquivo da VPS se faz no repo e se commita; rode `capturar.sh` antes de commitar. Ver [[cofre-credenciais-agentes]]. A memória do Claude Code de `~/getdemo` e `~/esag` também mora no repo, em `memorias/`, por link.
