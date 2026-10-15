---
name: mapa-hubspot-getdemo
description: Onde está o mapa do HubSpot da Getdemo (fluxo do deal à Conta, workflows, propriedades calculadas), para consultar ou reaproveitar em outro projeto
metadata:
  type: reference
---

O mapeamento do HubSpot da Getdemo (conta 39834446) fica em `~/getdemo/hubspot/`:

- `mapa/fluxo-do-deal-a-conta.md`: o fluxo inteiro, do Lead à Conta, com venda, Win, implantação,
  renovação, churn, Downsell e suporte, e a lista de gambiarras e falhas.
- `auditoria/2026-10-13-workflows.md`: os 105 workflows, com a definição de cada um ação por ação.
  É a única fonte das definições de workflow de deal, ticket e Conta, porque a API pública não as
  abre.
- `auditoria/2026-10-13-calculadas.md`: as 40 propriedades calculadas, com autor, uso e
  preenchimento.
- `auditoria/2026-10-08-itens-de-linha.md`: propriedades, somas da Conta e histórico de quem grava
  cada campo.
- `CLAUDE.md` da pasta: como ler e escrever no HubSpot com segurança.

O retrato é de outubro de 2026. Antes de usar como fato, confira com o HubSpot, porque o time mexe
nele sem um responsável de RevOps. Ligado a [[hubspot-itens-de-linha]].
