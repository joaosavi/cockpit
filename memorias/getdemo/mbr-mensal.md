---
name: mbr-mensal
description: "Como o João monta o MBR (apresentação mensal de resultados): sempre o arquivo do deck de agosto com o DATA trocado, nunca um deck refeito"
metadata:
  node_type: memory
  type: project
  originSessionId: 3d5d8d91-44e6-5c85-a093-ac3455c67180
  modified: 2026-10-05T18:57:29.062Z
---

Todo mês o João monta o MBR, a apresentação de resultados do mês fechado, e revisa com o chefe.

- O formato é o deck de agosto/26, feito no Claude Design (projeto `claude.ai/design/p/2e230e5d-9c25-4b35-8821-68fc8c6c1584`). Cópia local em `zippi-datawarehouse/tmp/dormir/mbr/`; o arquivo apresentado é `MBR Agosto 2026 - Apresentacao.html`, que usa `deck-stage.js`.
- Esse HTML é um modelo: todo número sai do objeto `const DATA = {...}` entre `MBR_DATA_START` e `MBR_DATA_END`. O mês novo é o mesmo arquivo com o DATA trocado e os títulos "Ago/26" virando o mês novo. O script que fez setembro está em `relatorios/mbr-build-setembro.py`, com os ajustes que o modelo pedia (Net MRR negativo na cascata e na capa, "vs. jul" fixo, curva do MRR vinda do warehouse).
- Setembro/26 saiu em 05/10/2026: https://claude.ai/artifact/4e4X51QVxHF3E5BNWAJNjj, com cópia em `relatorios/MBR-Setembro-2026.html`.
- Os números saem da tela MBR da V2 (`apps/bi/src/mbr/`): o `mbrFrom` rodado sobre a gold, com o SQL de `mbrDealsQuery` e `monthlyQuery` executado no conector Warehouse Getdemo. O conector recusa o schema `bi2`, então as metas vêm da planilha "[GETDEMO] Meta x Forecast x Realizado - 2026" (abas Projetado - 2026 e Quotas).
- O slide Financeiro sai do banco Inadimplentes do Notion ([[notion-inadimplentes]]), lido por visão (`mode: view`), porque a cota de SQL do Notion do workspace acaba rápido. Saldo em cobrança: soma de Total na visão Pendentes no dia. Recebido e atraso médio: na visão Pipeline, faturas com Data de Pagamento no mês e depois do Vencimento. E-mails de cobrança: o n8n envia da conta do João com a etiqueta "Inadimplentes" do Gmail (`label:inadimplentes from:me`), e a visão Pipeline do Notion perde parte deles. Setembro/26 ficou com saldo de R$ 29.645, R$ 22.185 recebidos em 16 faturas, 12,4 dias de atraso médio e 38 e-mails em 25 faturas, validados pelo João em 05/10. A gold (`gold.contas_a_receber_comercial` com `gold.baixas`) dá números parecidos e serve de conferência.
- O warehouse não calcula CAC nem CAC payback. Esses dois e os slides de "Ações e entregas" ficam "[a preencher]" até as áreas mandarem o conteúdo.

**Why:** em 05/10/2026 eu refiz o deck no formato Slides do claude.ai, com fonte maior e layout próprio, e o João recusou: o MBR tem que ser idêntico ao de agosto, só com os números do mês.

**How to apply:** nunca redesenhe o MBR. Pegue o HTML do mês anterior, troque o DATA e os títulos, renderize no Playwright para conferir, e publique. Ver [[direx-secao-financeiro]] para a rotina semanal.
