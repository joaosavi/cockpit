---
name: rendimento-cdb-mensal
description: Rotina mensal do João de calcular o rendimento dos CDBs do Banco Inter e lançar o ajuste no Conta Azul
metadata:
  node_type: memory
  type: project
  originSessionId: a7136309-95e3-55a1-94e2-5c73d350d2f4
  modified: 2026-10-06T18:34:08.585Z
---

Todo mês o João calcula o rendimento dos CDBs da Getdemo no Banco Inter e cria um lançamento financeiro no Conta Azul para ajustar o resultado do CDB.

## O que ele manda

Dois PDFs do Inter, emitidos no início do mês seguinte:

- Extrato de movimentação de renda fixa, com o período do mês (ex.: 01/09 a 30/09)
- Extrato de posição de renda fixa, com a posição no último dia do mês

Os PDFs chegam como upload. Não há `pdftotext` nem `pypdf` na VPS; extraia com `uvx --with pypdf python -c "..."` usando `pypdf.PdfReader(f).pages[i].extract_text()`.

## Como calcular

1. Rendimento bruto do mês: no extrato de movimentação, cada CDB tem a linha "Rendimento até esta data" no último dia do mês. Esse valor já é saldo do fim do mês menos o "Saldo até esta data" do mês anterior. Some as linhas de todos os CDBs.
2. Confira: a soma dos saldos do fim do mês tem que bater com o "Valor Bruto Total" das seções do extrato de posição (hoje são duas seções, "CDB MAIS LIMITE DE CREDITO" e "CDB LIQUIDEZ DIARIA PJ").
3. Se houve aplicação ou resgate no mês, a linha de rendimento deixa de ser só saldo final menos inicial. Confira os lançamentos do extrato antes de somar.
4. Rendimento líquido: a linha "Previsão de I.R. para resgate total" é acumulada desde a aplicação, não é do mês. O líquido exato é o "Valor Líquido Total" do fim do mês menos o do mês anterior, e isso exige o extrato de posição do mês anterior. Sem ele, estime aplicando a alíquota de IR atual de cada CDB (coluna IR/IOF da posição) sobre o rendimento do mês, e diga que é estimativa.

## Referência de setembro/2026

Sete CDBs, rendimento bruto R$ 1.205,99 sobre saldo de R$ 127.224,30 em 31/08 (0,95%). Saldo bruto em 30/09: R$ 128.430,29. Líquido estimado: R$ 968,60. Seis CDBs "Mais Limite de Crédito" a 80% do CDI e um "DI Liquidez Diária PJ" a 100% do CDI.

**Why:** o lançamento no Conta Azul ajusta o resultado financeiro do mês, e o João não quer explicar o cálculo de novo.

O lançamento no Conta Azul usa o rendimento **bruto**, para o saldo da aplicação no ERP ficar igual ao saldo bruto do extrato do Inter. O líquido (passo 4) não entra no lançamento; calcule só se ele pedir.

**How to apply:** quando ele mandar os dois extratos do Inter, calcule direto por este roteiro e entregue a tabela por CDB com o total bruto, que é o valor do lançamento. Depois do lançamento, o saldo no Conta Azul tem que bater com o "Valor Bruto Total" somado do extrato de posição.
