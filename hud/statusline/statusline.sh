#!/bin/sh
# Runs the hud status line. Claude Code sets COLUMNS to the terminal's width; the script gets that
# width less the 4 columns Claude Code pads the status line with, in HUD_WIDTH. Without COLUMNS, the
# controlling terminal's width, then 120. Where there is no POSIX shell, run `node statusline.ts`.
cols=${COLUMNS:-}
case "$cols" in ''|*[!0-9]*) cols=$( (stty size </dev/tty) 2>/dev/null | cut -d' ' -f2) ;; esac
case "$cols" in ''|*[!0-9]*) cols=120 ;; esac
HUD_WIDTH=$((cols > 24 ? cols - 4 : 20)) exec node "$(dirname "$0")/statusline.ts"
