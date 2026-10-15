---
name: fechamento-contabilidade
description: "Passo a passo do fechamento financeiro mensal para a Softcon (planilha de 3 abas pelo warehouse, página de download, rascunho no Gmail)"
metadata:
  node_type: memory
  type: project
  originSessionId: 9a18cb09-d243-5b47-b5fe-ca9dd20bafbf
  modified: 2026-10-13T18:34:03.316Z
---

Todo mês o João manda à Softcon o fechamento financeiro do mês anterior. Sai entre o dia 3 e o dia 13 (ago/2026 em 08/09, set/2026 em 13/10). Feito comigo pela primeira vez em 13/10/2026. Ele pediu para não precisar explicar de novo: siga este roteiro direto.

## 1. Atualizar o Conta Azul no warehouse

`run_source contaazul_cpgg` com `despesas`, `receitas` e `parcelas`. Espere `get_run` mostrar `parcelas` com desfecho `sucesso` (leva uns 2 min). Sem isso a parcela fica com a carga das 3h.

## 2. Tirar as três abas

Corte = último dia do mês. Colunas de toda aba: nome do cliente/fornecedor, descrição, competência, vencimento, valor.

- Contas a receber: RECEITA com competência até o corte, vencimento depois do corte e saldo aberto no corte. Vencido e perdido ficam fora. Valor positivo.
- Contas a pagar: DESPESA com competência até o corte e saldo aberto no corte, qualquer vencimento. Valor negativo.
- Pendências de documentação: DESPESA com "S/ DOC" na descrição e competência até o corte, paga ou não. Valor negativo.

Consulta (troque a data do corte nos três lugares):

```sql
with p as (select distinct on (id_origem) id_origem, payload p, apagado_na_origem_em from bronze.contaazul_parcelas order by id_origem, ingerido_em desc),
n as (select distinct on (id_origem) id_origem, coalesce(payload->'cliente'->>'nome', payload->'fornecedor'->>'nome') nome, payload->>'descricao' dl
  from (select id_origem, payload, ingerido_em from bronze.contaazul_receitas union all select id_origem, payload, ingerido_em from bronze.contaazul_despesas) u order by id_origem, ingerido_em desc),
x as (select id_origem, left(p->'evento'->>'tipo',1) t, p->>'status' st, n.nome, coalesce(n.dl, p->>'descricao') d,
    (p->'evento'->>'data_competencia')::date c, (p->>'data_vencimento')::date v, (p->'valor_composicao'->>'valor_bruto')::numeric valor,
    coalesce((select sum((b->'valor_composicao'->>'valor_bruto')::numeric) from jsonb_array_elements(p->'baixas') b where (b->>'data_pagamento')::date <= date '2026-09-30'),0) pago
  from p left join n using (id_origem) where apagado_na_origem_em is null)
select 'R' aba, st, nome, d, c, v, valor-pago aberto, id_origem from x where t='R' and c<='2026-09-30' and v>'2026-09-30' and valor-pago>0.005
union all select 'P', st, nome, d, c, v, -(valor-pago), id_origem from x where t='D' and c<='2026-09-30' and valor-pago>0.005
union all select 'S', st, nome, d, c, v, -valor, id_origem from x where t='D' and c<='2026-09-30' and d ilike '%S/ DOC%'
order by 1, 6, 7, 8
```

São uns 470 registros, mais que uma página do `execute_sql`. Para o resultado cair em arquivo, e não no contexto, embrulhe as linhas num `json_agg` numa linha só e some `repeat('x', 54000)` como coluna extra.

Fora da lista: a venda TOTVS SA (Matriz) de R$ 124.500 (Venda 4345, NFS-e 1870, competência 14/07/2026, vencimento sendo empurrado). O João mandou tirar em 13/10/2026, e ela já estava fora de agosto. As outras vendas da TOTVS entram.

Em 13/10/2026 a regra reproduziu a planilha de agosto. As diferenças que sobraram eram edições feitas no Conta Azul depois do envio. Setembro/2026 deu 231 a receber (R$ 416.717,86), 178 a pagar (R$ 489.276,14) e 60 sem documento (R$ 15.932,84).

## 3. Montar o .xlsx

openpyxl, no scratchpad. Nome do arquivo: "[GETDEMO] Fechamento Financeiro Mensal - <Mês>-<AA>.xlsx". Abas: "Visão Contas a Receber em DD.MM.AAAA", "Visão Contas a Pagar em DD.MM.AAAA" e "Pendências de Documentação em DD.MM.AAAA". Cabeçalho com fundo C0C0C0, data em dd/mm/yyyy, valor em `#,##0.00;(#,##0.00)`. Ordem: vencimento, depois valor.

Antes de entregar, aponte ao João o que mudou muito sobre o mês anterior. Em set/2026 foi a 2ª cota de IRPJ + CSLL, de R$ 136.000, no a pagar.

## 4. Entregar a planilha

O SendUserFile falha. Publique a planilha numa página (Artifact) com o .xlsx em base64 no HTML e um botão de download pela capacidade `downloads`. A página de setembro é https://claude.ai/artifact/ME3RZLdS2c3GL7HJrCMf1B: republique em cima dela com o mês novo.

O João sobe a planilha no Drive e compartilha com a Softcon. Não suba no Drive, não mexa no compartilhamento e não ofereça fazer isso (pedido dele em 13/10/2026).

## 5. Rascunho no Gmail

Crie o rascunho com `create_draft`, sem anexo e sem link da planilha. O João insere o arquivo do Drive na hora de enviar.

- Assunto: "[GETDEMO] Fechamento Financeiro - <Mês>/<AAAA>"
- Para: contabil@, fiscal@ e startup@softconsc.com.br
- Cópia: ismael@softconsc.com.br e financeiro@getdemo.com.br
- Corpo: "Prezados, boa tarde!", "Envio abaixo o fechamento financeiro do mês **MM/AAAA**.", "Seguem em anexo os seguintes relatórios:" com as três linhas (contas a receber na posição DD/MM/AAAA; contas a pagar na posição DD/MM/AAAA; relação das pendências de documentação até DD/MM/AAAA), "As informações estão presentes nas abas da planilha abaixo:", "Estamos trabalhando para recolher toda a documentação pendente.", "Fico à disposição para eventuais esclarecimentos." e "Atenciosamente,".
- Sem assinatura digitada, ver [[assinatura-gmail]].

Enviar o e-mail só com pedido dele.
