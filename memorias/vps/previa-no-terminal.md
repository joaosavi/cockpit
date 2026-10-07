---
name: previa-no-terminal
description: Mudança visual de terminal (statusline, cores, glifos) vai para o João como comando que ele roda no terminal dele antes de publicar
metadata:
  type: feedback
---

Antes de publicar uma mudança visual de terminal (statusline, barras, cores, ícones, painéis), mando ao João um comando que ele cola no terminal dele e vê a saída real: um `printf`/`python3 -c` curto, ou a saída do código de verdade gravada aqui, compactada (`gzip | base64`), para ele rodar com `base64 -d | gunzip`.

**Why:** a fonte e o tema do terminal são do computador dele. A captura do tmux na VPS mostra os caracteres, mas não como a fonte os desenha (em 07/10/2026 os glifos ▰▱ viraram uma cápsula borrada na fonte dele). Ele pediu esse formato porque valida mais rápido do que atualizar o plugin a cada tentativa.
**How to apply:** gerar a prévia com o código real (não uma imitação), com os casos que importam (larguras, estados), e só publicar depois do sim dele. Ver [[testar-no-pc]] e [[mods-do-agente]].
