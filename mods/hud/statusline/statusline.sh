#!/bin/sh
# Runs the hud status line with COLUMNS set to the terminal's width, less the 4 columns Claude Code
# pads the status line with. Claude Code gives the command no terminal of its own, so the width
# comes from the controlling terminal.
cols=$( (stty size </dev/tty) 2>/dev/null | cut -d' ' -f2)
case "$cols" in ''|*[!0-9]*) cols=${COLUMNS:-120} ;; esac
COLUMNS=$((cols > 24 ? cols - 4 : 20)) exec node "$(dirname "$0")/statusline.ts"
