#!/usr/bin/env bash
# Monta numa VPS nova o que este repo guarda: a configuração do Claude Code, os scripts, as skills
# feitas aqui, as units do systemd e o navegador com cofre. Pode rodar de novo.
set -euo pipefail
R=$(cd "$(dirname "$0")" && pwd)

for cmd in jq flock npx bw claude tmux python3 perl; do
  command -v "$cmd" >/dev/null || { echo "falta o comando $cmd" >&2; exit 1; }
done

link() { mkdir -p "$(dirname "$2")"; ln -sfn "$1" "$2"; }

# Os arquivos que o repo guarda como fonte: a cópia instalada é um link para cá.
link "$R/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
link "$R/hooks/segredo.pl" "$HOME/.claude/hooks/segredo.pl"
for f in "$R"/bin/*; do link "$f" "$HOME/.local/bin/$(basename "$f")"; done
for d in "$R"/skills/*/; do link "${d%/}" "$HOME/.claude/skills/$(basename "$d")"; done
link "$R/tarefas/sessoes-limite/PROMPT.md" "$HOME/tarefas/sessoes-limite/PROMPT.md"
link "$R/tarefas/sessoes-limite/retomar.py" "$HOME/tarefas/sessoes-limite/retomar.py"
link "$R/resgate/CLAUDE.md" "$HOME/resgate/CLAUDE.md"
for d in "$R"/ambientes/*/; do link "${d}CLAUDE.md" "$HOME/$(basename "$d")/CLAUDE.md"; done

# A memória de cada projeto mora em ~/.claude/projects/<pasta com / trocado por ->/memory.
for d in "$R"/memorias/*/; do
  p="$HOME/.claude/projects/$(printf '%s' "$HOME/$(basename "$d")" | tr '/' '-')/memory"
  if [ -d "$p" ] && [ ! -L "$p" ]; then
    echo "$p já existe e não é link. Junte com ${d%/} à mão." >&2
  else
    link "${d%/}" "$p"
  fi
done

# O Claude Code regrava o settings.json inteiro, e um link viraria arquivo comum na primeira
# gravação. Por isso ele entra como cópia, só quando ainda não existe. O capturar.sh traz de volta.
for f in settings.json settings.local.json; do
  [ -f "$HOME/.claude/$f" ] || cp "$R/claude/$f" "$HOME/.claude/$f"
done

# Os mods do repo: o marketplace `agente` aponta para esta pasta, e o pacote `agente` instala cada mod.
claude plugin marketplace add "$R" >/dev/null 2>&1 || claude plugin marketplace update agente
claude plugin install agente@agente

claude mcp remove -s user navegador >/dev/null 2>&1 || true
claude mcp add -s user navegador -- "$HOME/.local/bin/navegador-cofre"

# O Chromium da revisão que a versão fixa do MCP pede.
MCP=$(sed -n "s/^MCP='\(.*\)'.*/\1/p" "$R/bin/navegador-cofre")
DIR=$(dirname "$(dirname "$(readlink -f "$(npx -y -p "$MCP" which playwright-mcp)")")")
node "$DIR/../playwright/cli.js" install chromium chromium-headless-shell

# As units são do root e entram como cópia.
sudo cp -r "$R"/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now getdemo-rc.service zippi-rc.service esag-rc.service resgate-rc.service \
  retomar-limite.timer getdemo-faxina.timer sessoes-esquecidas.timer

[ -f "$HOME/getdemo/.env.bw-agente" ] || echo "Falta o ~/getdemo/.env.bw-agente. Copie o .env.bw-agente.example e preencha." >&2
perl "$R/hooks/segredo.pl" --teste
