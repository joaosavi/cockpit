---
name: financeiro-faturamento-regras
description: "Prazos e regras operacionais do faturamento no Conta Azul (NF, renegociação, upsell, cobrança de atraso), com o caso Indexmed de out/2026"
metadata:
  node_type: memory
  type: project
  originSessionId: 4a010eec-8eda-522e-a8de-6410b1129323
  modified: 2026-10-13T14:27:23.501Z
---

Regras do faturamento de clientes no Conta Azul, explicadas pelo João em 13/10/2026.

## Prazos

- A NF costuma ser emitida 30 dias antes do vencimento, mas isso varia de contrato para contrato. Ex.: a Indexmed com vencimento em 21/11 é emitida em 21/10. Antes de afirmar a data de emissão de um caso, confira no Conta Azul.
- NF só cancela dentro da competência em que foi emitida. Passou o mês, a nota fica. Antes de propor cancelar uma fatura, conferir o mês de emissão da NF.
- Cobrança de atraso sai por e-mail com o assunto "[GETDEMO] Fatura em Atraso - <CLIENTE>". Ela leva o link da fatura, a chave PIX (CNPJ) para pagar sem juros e multa, e um prazo final de 20 dias após o vencimento.

## Regras

- Para juntar dois boletos sem mexer nas notas, use a renegociação do Conta Azul. Ela gera um boleto único e as NFs continuam separadas.
- Para corrigir valor de fatura com NF já emitida fora da competência, ajuste uma fatura seguinte, nunca a nota emitida.
- Upsell faturado à parte (vencimento próprio) e depois unificado ao contrato principal: conte as parcelas. O total cobrado do upsell tem que dar os meses do contrato. A fatura avulsa que já foi emitida soma com a primeira unificada, e uma das duas tem que sair.

## Caso Indexmed, out/2026

Upsell de R$ 899 por 12 meses, fechado em 06/05/2026, com vencimento no dia 07. O contrato principal é de R$ 2.080, com vencimento no dia 21. Unificado em 15/09 para R$ 2.979, de 21/10/2026 a 21/05/2027. A fatura avulsa de 07/10 ficou e daria 13 cobranças de 899. Decisão de 13/10: as NFs de setembro ficam. A NF que seria emitida em 21/10 (vencimento 21/11) foi antecipada e sai em R$ 2.080, para que, somada à de R$ 899, dê o valor do contrato. A fatura de 07/10, vencida, foi renegociada sem juros junto com ela, num boleto único de R$ 2.979 em 21/11. A de 21/10 continua em R$ 2.979.

Regra geral que sai daqui: o valor a corrigir sai da próxima NF ainda não emitida (antecipando a emissão se preciso), e a fatura vencida é renegociada para o mesmo vencimento. Assim cada nota bate com o caixa e ninguém recolhe imposto sobre valor não recebido.

Link da fatura para e-mail de cobrança: com boleto, a URL está em `bronze.contaazul_parcelas.payload->'solicitacoes_cobrancas'[].url` (faturas.contaazul.com). Sem boleto (Starian/Softplan paga por transferência), o link é `https://app.contaazul.com/pub/#/invoice/v2/<id da venda>`, com o id de `bronze.contaazul_vendas_detalhes.id_origem`. Conferido em 13/10/2026.
