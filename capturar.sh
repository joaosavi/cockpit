#!/usr/bin/env bash
# Traz para o repo o que não pode ser link: o settings.json, que o Claude Code regrava inteiro,
# e as units do systemd, que são do root. Rode antes de commitar, e o diff mostra o que mudou na VPS.
set -euo pipefail
R=$(cd "$(dirname "$0")" && pwd)

cp "$HOME/.claude/settings.json" "$R/claude/settings.json"
cp "$HOME/.claude/settings.local.json" "$R/claude/settings.local.json"

rm -rf "$R/systemd"
mkdir -p "$R/systemd"
for u in agentes.slice resgate.slice \
         getdemo-rc.service zippi-rc.service esag-rc.service resgate-rc.service \
         retomar-limite.service retomar-limite.timer \
         sessoes-limite.service sessoes-limite.timer \
         getdemo-faxina.service getdemo-faxina.timer \
         sessoes-esquecidas.service sessoes-esquecidas.timer \
         avaliacoes-backup.service avaliacoes-backup.timer; do
  cp "/etc/systemd/system/$u" "$R/systemd/$u"
  if [ -d "/etc/systemd/system/$u.d" ]; then
    cp -r "/etc/systemd/system/$u.d" "$R/systemd/$u.d"
  fi
done
git -C "$R" status --short
