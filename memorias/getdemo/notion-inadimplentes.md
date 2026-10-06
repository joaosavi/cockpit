---
name: notion-inadimplentes
description: Banco Inadimplentes do Notion do Financeiro e o recorte que dá o número de inadimplência da Direx
metadata:
  node_type: memory
  type: reference
  originSessionId: b4fd48b7-7705-5636-9512-b62f35f89820
  modified: 2026-10-05T16:50:54.938Z
---

Banco "Inadimplentes" no Notion do Financeiro: https://app.notion.com/p/2774ffea6538814a981cec230680ede2, data source collection://2774ffea-6538-81e0-af00-000b2a9083eb. Um n8n sincroniza do Conta Azul.

O número que o João leva para a Direx ([[direx-secao-financeiro]]) bate com este recorte, conferido em 05/10/2026 contra a ata de 28/09:
- Inadimplência ("em cobrança"): soma de Total na view Pendentes (view://36e4ffea-6538-8060-9d84-000caecef359), que filtra Status Pipeline em cobrança, promessa, cartão rejeitado, transferência não localizada ou mais de 30 dias, com Dias em atraso maior que 3. Consulte em modo view, porque Dias em atraso é fórmula e não entra no SQL.
- Negativados e perdas: linhas com Status Pipeline = Negativado.
- Silent Echo tem Status da Cobrança PERDIDO mas fica nos vencidos, como na ata de 28/09.
