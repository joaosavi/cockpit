#!/usr/bin/env bash
# Liga os arquivos deste repo no lugar onde o Claude Code procura, registra o MCP e instala o Chromium.
# Pode rodar de novo: cada passo confere o que já existe.
set -euo pipefail
R=$(cd "$(dirname "$0")" && pwd)
CONF="$HOME/.claude/settings.json"

for cmd in jq flock npx bw claude; do
  command -v "$cmd" >/dev/null || { echo "falta o comando $cmd" >&2; exit 1; }
done

mkdir -p "$HOME/.local/bin" "$HOME/.claude/hooks"
ln -sfn "$R/bin/navegador-cofre" "$HOME/.local/bin/navegador-cofre"
ln -sfn "$R/hooks/segredo.pl" "$HOME/.claude/hooks/segredo.pl"

# As skills feitas nesta máquina. As de terceiros chegam por outro caminho.
mkdir -p "$HOME/.claude/skills"
for d in "$R"/skills/*/; do
  ln -sfn "${d%/}" "$HOME/.claude/skills/$(basename "$d")"
done

# O hook de segredo nos dois lados de toda ferramenta, e o `bw` fora do alcance do Bash do agente.
[ -f "$CONF" ] || echo '{}' >"$CONF"
jq '
  .permissions.deny = ((.permissions.deny // []) + ["Bash(bw:*)"] | unique) |
  .hooks.PreToolUse = ((.hooks.PreToolUse // []) | map(select(.matcher != "Bash|Edit|Write"))
    + [{"matcher":"Bash|Edit|Write","hooks":[{"type":"command","command":"perl \"$HOME/.claude/hooks/segredo.pl\" pre"}]}]) |
  .hooks.PostToolUse = ((.hooks.PostToolUse // []) | map(select(.matcher != "*"))
    + [{"matcher":"*","hooks":[{"type":"command","command":"perl \"$HOME/.claude/hooks/segredo.pl\" post"}]}])
' "$CONF" >"$CONF.tmp" && mv "$CONF.tmp" "$CONF"

claude mcp remove -s user navegador >/dev/null 2>&1 || true
claude mcp add -s user navegador -- "$HOME/.local/bin/navegador-cofre"

# O Chromium da revisão que a versão fixa do MCP pede.
MCP=$(sed -n "s/^MCP='\(.*\)'.*/\1/p" "$R/bin/navegador-cofre")
DIR=$(dirname "$(dirname "$(readlink -f "$(npx -y -p "$MCP" which playwright-mcp)")")")
node "$DIR/../playwright/cli.js" install chromium chromium-headless-shell

[ -f "$HOME/getdemo/.env.bw-agente" ] || echo "Falta o ~/getdemo/.env.bw-agente. Copie o .env.bw-agente.example e preencha." >&2
perl "$R/hooks/segredo.pl" --teste
