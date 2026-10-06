---
name: conciliacao-cartoes
description: "Conciliação mensal das faturas de cartão Inter e Itaú contra o Conta Azul, com a pendência do estorno Antares"
metadata:
  node_type: memory
  type: project
  originSessionId: a7136309-95e3-55a1-94e2-5c73d350d2f4
  modified: 2026-10-06T19:57:46.305Z
---

O João confere todo mês as faturas dos dois cartões contra o que está lançado no Conta Azul. O roteiro está na skill `conciliacao-inter-erp`, sincronizada em `~/.claude/skills/synced/.../conciliacao-inter-erp/SKILL.md`. O banco é a fonte da verdade.

## Os arquivos

- Inter: CSV `fatura-inter.csv`, valores como `-R$ 12,44` com espaço não separável. A linha "Total" já desconta o `PAGTO DEBITO AUTOMATICO`, então o total de despesas é o Total menos esse crédito. Vencimento dia 10.
- Itaú: CSV `Fatura_Empresas_AAAA_MM.csv`, portador Vitor Oliveira, colunas `C/D` e `Parcelas`. Créditos (estorno e pagamento) vêm com `C`. Vencimento dia 25, pago por débito automático.

## O lado do Conta Azul

Rode `run_source contaazul_cpgg` com os streams `despesas`, `parcelas`, `contas_financeiras` e `transferencias` antes de comparar, porque o João lança no dia. Leia de `bronze.contaazul_parcelas`, a última versão por `id_origem`, filtrando `payload->'conta_financeira'->>'banco'` (`INTER` ou `ITAU`), o tipo `CARTAO_CREDITO` e `data_vencimento` da fatura. Valor em `valor_composicao.valor_bruto`, com sinal negativo quando `evento.tipo` é `RECEITA` (estorno).

## Erros que se repetem

- compra em dólar lançada com o valor em dólar, sem converter (ClickUp e Twilio em out/2026)
- câmbio do dia da compra em vez do fechamento (HubSpot, StreamYard)
- centavos de parcelamento, que se repetem nas parcelas futuras do mesmo lançamento

## Regra de centavos do parcelamento no Inter

Conferido em 06/10/2026 com 12 faturas do Inter (set/2025 a set/2026), cuja soma no Conta Azul bate com o pagamento ao centavo. O Inter divide o total pelo número de parcelas, trunca no centavo e joga a sobra na parcela 1. Da 2 em diante o valor é fixo. Ex.: GRABR 6.235,86 em 12x = 519,71 e 11 de 519,65. O erro no Conta Azul é a parcela futura ficar com o valor da 1ª. Exceção rara de 1 centavo (Gol 178,51/178,50 alternando, Fairmont 3ª parcela). O Itaú não segue a regra: Passagem Azul foi 352,40 na 1ª e 243,83 na 2ª.

## Itaú ago e set/2026: diferença que se anula

A fatura de agosto no Conta Azul ficou R$ 1.118,30 acima do pagamento e a de setembro R$ 1.118,30 abaixo. Somadas, batem. O saldo do cartão Itaú no Conta Azul está certo. Em 06/10 eu atribuí a diferença de setembro a um estorno Antares "parcelado" e o João decidiu tratar como crédito antecipado; essa leitura estava errada, porque olhei só setembro. Não há crédito antecipado a acompanhar.

**How to apply:** ao conciliar, confira a soma de faturas consecutivas contra os pagamentos antes de explicar uma diferença de um mês só.
