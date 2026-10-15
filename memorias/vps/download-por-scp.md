---
name: download-por-scp
description: Entregar arquivo ao João: página privada no claude.ai com botão de download; scp em /home/sv/esag/entrega só quando ele tiver ssh
metadata:
  type: feedback
---

O anexo na conversa (SendUserFile) falha, porque a sessão não está num thread de projeto. O conector do Drive só aceita o arquivo em base64 dentro da chamada, então não sobe nada de alguns MB.

Caminho padrão, aprovado pelo João em 08/10/2026: publicar uma página com o Artifact (privada, só ele abre), com os arquivos em `files` e a capacidade `downloads: true`. Um botão chama `claude.use("downloads").save({filename, data})`. Para entregar um zip, publique os arquivos soltos e monte o zip no clique com JSZip do cdnjs, porque o Artifact não aceita `.zip`, `.docx` ou `.xlsx` como arquivo publicado. PDF, imagem, CSV, JSON e texto ele aceita, com até 15 MB por arquivo. A fonte tem que estar no scratchpad ou na pasta de trabalho. Depois de publicar, apague a cópia local: a página guarda os arquivos.

Alternativa quando ele estiver num PC com ssh: copiar para `/home/sv/esag/entrega/`, com nome sem espaço e sem acento, e passar o comando scp pronto (usuário `sv`, host `getdemo-dev`).

**Why:** em 05/10/2026 ele pediu para deixar o arquivo acessível para baixar via scp. Em 08/10 ele estava sem ssh, e a página com download resolveu. Ele perguntou por que eu não tinha sugerido isso antes.

**How to apply:** em toda entrega de PDF, planilha ou zip, ofereça a página primeiro, sem esperar o anexo e o Drive falharem. Ligado a [[tcc-handoff]].
