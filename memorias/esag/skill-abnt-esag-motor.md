---
name: skill-abnt-esag-motor
description: A skill tcc-esag (antes abnt-esag) é o kit do TCC da ESAG com motor ABNT verificado e cópia do Google Docs; o kit de consultoria sai dela
metadata:
  node_type: memory
  type: project
  originSessionId: 3e08d5aa-bc7a-564d-b389-74620096b191
  modified: 2026-10-05T01:41:24.192Z
---

Em 05/10/2026 a skill global `abnt-esag` virou `tcc-esag`, só de TCC, a pedido do João, para compartilhar.
`scripts/novo_projeto.py <pasta> --modelo tcc-iv` (ou tcc-i, tcc-ii, tcc-iii-plano, tcc-iii-projeto, tcc-v)
copia `assets/projeto/`: CSS único `abnt-udesc.css`, `montar.py` (com `--tudo`), `checar.py`,
`conferir_pdf.py`, `google_docs.py`, `conferir_docs.py`, `medir.js`, normas, links oficiais conferidos,
`AGENTS.md`, `copia-google-docs.md` e, na consultoria, o `GUIA.md`. A versão antiga está em
`~/.claude/skills/bkp/abnt-esag-antes-2026-10-05`. `/home/sv/esag/kit-tcc-consultoria` é a saída do tcc-iv,
para o João passar a um amigo; não é um trabalho dele. Os zips estão em `/home/sv/esag/tcc-esag-skill.zip`
e `/home/sv/esag/kit-tcc-consultoria.zip`. O guia para o amigo é o Claude Doc
https://claude.ai/code/artifact/03bfe899-cd9c-425f-b038-09eafbbf4200, exportado também como `GUIA.md`.

O conversor do Google Docs veio da sessão do TCC (`tcc/scripts/google_docs.py`) e foi portado ao motor novo
com alíneas geradas, imagem, tabela IBGE, h5 e notas de rodapé nativas; o teste com o exemplo dos elementos
passou no Google (12 de 12 linhas de sumário certas). O Doc de teste ficou no Drive do João, sem apagar.

**Why:** a skill e o kit têm de ser a mesma coisa; corrigir só um deles faz os dois divergirem.

**How to apply:** mudança no motor se faz em `~/.claude/skills/tcc-esag/assets/projeto/` e o kit se regenera
com o `novo_projeto.py`. Depois de mexer no motor, gere `scripts/teste/exemplo-elementos.html` e rode o
`checar.py` e o `conferir_pdf.py` nele. O TCC do João em `tcc/` usa o motor antigo e tem dois desvios que o
novo corrige: número de página 0,13 cm abaixo dos 2 cm e conteúdo de quadro em 10 pt. Portar muda a paginação
dele, então só com o aval do João. Ver [[tcc-handoff]].
