---
name: zag-reembolsos
description: Zag (admin.zagapp.com.br) é onde o time lança reembolso; como entrar pelo navegador do cofre e ler tudo pela API
metadata:
  node_type: memory
  type: reference
  originSessionId: 078e8a1a-5888-5ef3-8ceb-e7f5b62ae941
  modified: 2026-10-08T14:55:28.515Z
---

O Zag guarda os reembolsos de despesa do time. Login no MCP `navegador` com `ADMIN_ZAGAPP_COM_BR_USER` e `ADMIN_ZAGAPP_COM_BR_PASSWORD`; cai direto em `/refunds`, filtrado no mês corrente.

A tela só mostra um mês por vez e um modal de plano bloqueia os cliques. Mais rápido ler pela API: `browser_evaluate` com `fetch` POST em `https://beta-api.zagapp.com.br/admin/graphql`, header `authorization` = o hex de 32 caracteres dentro de `localStorage.data`. Query `allZagviewRefunds(first:100, createdAt_Gte, createdAt_Lte, user_In:[], status_In:[], category_In:[], project_In:[])`, paginando com `after`.

Status numérico, conferido contra o `sumValues` em 08/10/2026: 1 pendente, 2 aprovado sem pagar, 3 rejeitado, 4 pago.

Em 08/10/2026 havia 36 lançamentos de fev/2026 (R$ 2.738,86) aprovados e nunca marcados como pagos; perguntei ao João se foram pagos fora do Zag.
