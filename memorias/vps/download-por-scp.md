---
name: download-por-scp
description: O João baixa arquivos do container getdemo-dev pelo PC via scp; deixe o arquivo em /home/sv/esag/entrega e dê o comando
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4e07bc4d-9ce5-5c4c-9594-5c155f2d1d39
  modified: 2026-10-05T02:46:35.426Z
---

O João não abre arquivos direto no container `getdemo-dev`: ele baixa pelo PC, via ssh/scp. O anexo de
arquivo na conversa também falha, porque a sessão não está num thread de projeto. Para entregar um arquivo,
copie para `/home/sv/esag/entrega/`, com nome sem espaço e sem acento, e passe o caminho completo e um
comando scp pronto (usuário `sv`, host `getdemo-dev`).

**Why:** em 05/10/2026 ele pediu: "só deixe num lugar acessível aí pra eu baixar via comando daqui".

**How to apply:** em qualquer entrega de PDF, docx ou zip. Ligado a [[tcc-handoff]].
