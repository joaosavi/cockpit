---
name: conversor-google-docs
description: O TCC vai ao orientador como cópia no Google Docs gerada do HTML; a fonte continua o tcc.html
metadata:
  node_type: memory
  type: project
  originSessionId: 6ce14b94-c4d5-51aa-b959-5da8ef729c41
  modified: 2026-10-05T01:18:49.316Z
---

Em 05/10/2026 o João pediu um estudo sobre migrar a fonte do TCC para um Google Doc editado pelo chat. A
conclusão foi que não vale: a API do Docs não insere número de página nem atualiza sumário, a sessão só
tinha o conector do Drive (que cria arquivo e não edita), e cada edição exigiria posição exata no documento
inteiro. Pela regra que o próprio João deu, ficou a opção 1: o `tcc.html` segue como fonte, e cada versão
enviada ao orientador vira uma cópia no Google Docs.

O processo está em `tcc/copia-google-docs.md`, e o código em `tcc/scripts/google_docs.py`, `medir.js` e
`conferir_docs.py`. A cópia nasce de um `.docx`, porque o HTML direto chega ao Google sem a ABNT. O Google
não usa kerning e às vezes põe um título uma página antes do PDF, por isso o conferidor existe.

**Why:** o João não quer documento repetido acumulando no Drive, e quer a cópia fiel ao PDF.

**How to apply:** para a cópia de uma versão, siga `tcc/copia-google-docs.md`. O João levou para outra
sessão a ideia de juntar tudo numa skill de TCC; o conversor deve entrar nela. Ligado a [[tcc-handoff]].
