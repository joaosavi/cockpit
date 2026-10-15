---
name: cartao-open-finance
description: "Projeto de out/2026 para trocar o CSV da fatura do cartão por Open Finance via Pluggy na ferramenta /bi/cartao da V2, com decisões já tomadas"
metadata:
  node_type: memory
  type: project
  originSessionId: 28aefaa1-16a1-5719-9ae8-c3d720203dbc
  modified: 2026-10-14T17:36:57.284Z
---

Em 14/10/2026 o João pediu para a ferramenta `/bi/cartao` da V2 (PRD `docs/prd/cartao.md` no zippi-datawarehouse) ler a fatura por Open Finance, via Meu Pluggy (contas Inter e Itaú já conectadas, sem plano pago), em vez do CSV. Quer uma tela com o importado e o não sincronizado, revisar a classificação e sincronizar com o Conta Azul num botão. No futuro, automático.

Decidido em 14/10/2026: a transação passa a morar numa tabela do `bi2`, chave no id da Pluggy, com estado (importada, revisada, sincronizada). Isso derruba a invariante 1 do PRD ("a fatura nunca chega ao servidor").

**Why:** a tela de "sincronizado ou não" e a classificação salva antes do envio precisam de estado no servidor; e a compra em dólar muda de valor até o fechamento, então a mesma linha precisa ser atualizada, não duplicada.

Em 14/10/2026 o João escolheu enviar pela API do Conta Azul, testando antes num ambiente de teste do Conta Azul que ele vai criar (recomendei XLS; o medo dele é erro de API perto do fechamento do mês).

Em 14/10/2026: por enquanto só sincroniza lançamento de fatura fechada; o objetivo é sincronizar assim que o lançamento aparece. A proximidade do fechamento do mês não preocupa o João, porque ele já ajusta à mão para a fatura bater.

Em 14/10/2026 o João fechou o escopo da escrita: a integração cria lançamentos e, pela API, só atualiza valor (câmbio). Categoria, fornecedor, centro e o resto ele corrige na tela do Conta Azul, como faz no dia a dia.

**How to apply:** em aberto: classificação por IA para o que as regras não pegam; no Itaú, se o id da Pluggy se mantém quando a linha deixa de ser PENDING. No Inter está confirmado (fatura de out/2026: as 62 compras criadas com a fatura aberta mantiveram o id no fechamento; as 26 linhas novas do dia 10/10 eram todas IOF, que o Inter só publica no fechamento). Os ids das 4 linhas pendentes do Itaú em 14/10 estão em `~/getdemo/relatorios/pluggy-pendentes-itau-2026-10-14.json`; comparar depois do fechamento de outubro. Credenciais da Pluggy vão no cofre ([[cofre-credenciais-agentes]]). Código só numa sessão aberta no ambiente zippi-datawarehouse. Erros recorrentes de lançamento estão em [[conciliacao-cartoes]].

## O que foi medido em 14/10/2026

Credenciais em `apps/bi/.env` do zippi (`PLUGGY_*`, `CONTA_AZUL_SANDBOX_*`). Scripts de teste ficaram só no scratchpad da sessão.

- Pluggy: o item do Meu Pluggy trouxe só o Itaú (cartão e conta corrente), sem o Inter. Transações por `GET /v2/transactions` (a v1 deu 410), desde 14/06/2026. A fatura aberta vem `PENDING`, sem `billId`, com `billForecastDate`. Compra em dólar no Itaú já vem em BRL, com o IOF numa linha `TARIFA` separada. Cada parcela vem na fatura em que cai, com `installmentNumber`/`totalInstallments`, e as futuras já aparecem. Jul e ago/2026: soma das linhas = total da fatura. Set/2026: faltam R$ 1.118,30 de linha, o mesmo valor de [[conciliacao-cartoes]]
- Conta Azul app de dev: autoriza em `login.contaazul.com/#/oauth/authorize` e só passa com `scope=openid profile aws.cognito.signin.user.admin`; token em `api-v2.contaazul.com/oauth/token`, refresh de uso único que rotaciona. A produção usa outro servidor, `auth.contaazul.com/oauth2`
- `POST /v1/financeiro/eventos-financeiros/contas-a-pagar` é assíncrono: devolve protocolo, e `GET /v1/protocolo/{id}` dá o `evento_financeiro_id`. Não existe exclusão de conta a pagar pela API (405). `PATCH /v1/financeiro/eventos-financeiros/parcelas/{id}` com `versao` e `composicao_valor.valor_bruto` muda o valor, e o rateio acompanha
- A API não cria conta financeira (405). A empresa de teste só tinha a conta Mercado Pago, e ficou nela um lançamento "TESTE API - apagar" de R$ 12,34
- Inter (item separado, `PLUGGY_ITEM_ID_INTER`, cartão "CDPRO" Mastercard): 1.087 transações desde 19/09/2025; o `next` do `/v2/transactions` é query relativa e precisa ser seguido. Compra em dólar vem com `amount` em USD e `amountInAccountCurrency` em BRL; na fatura fechada o BRL é o final (jan, fev e mai a out/2026 batem ao centavo), cada linha com a própria taxa (5,32 a 5,47 em ago a out). Na fatura aberta o BRL é estimativa (taxa ~5,235 em 14/10). IOF vem em linha "iof internacional". O pagamento da fatura e a antecipação ("PAGTO DEBITO AUTOMATICO", "PAGAMENTO ON LINE") vêm com `operationType` PAGAMENTO, igual a compra: separar pela descrição. Estorno vem como PAGAMENTO negativo. Mar e abr/2026 tiveram antecipação no meio do ciclo
- Lançamento completo testado na empresa de teste em 14/10/2026: `data_competencia`, `descricao`, `contato` (UUID do fornecedor, string), `conta_financeira`, `rateio[{id_categoria, valor, rateio_centro_custo[{id_centro_custo, valor}]}]` e `condicao_pagamento.parcelas[{data_vencimento, conta_financeira, detalhe_valor}]` gravam. `fornecedor`/`id_fornecedor` são ignorados calados. A API cria pessoa (`POST /v1/pessoas`) e centro de custo (`POST /v1/centro-de-custo`). O login da empresa de teste pela tela não abre (`/app/user` dá 500), nem para o João
- Parcelado testado em 14/10/2026: um evento com N parcelas em `condicao_pagamento.parcelas`, cada uma com vencimento e valor próprios (1ª diferente das outras funciona). Soma das parcelas diferente do valor é recusada no protocolo (status ERROR). O Conta Azul prefixa a descrição com "2/6 - ". `GET /v1/financeiro/eventos-financeiros/{evento}/parcelas` lista as parcelas
- Fornecedor: `GET /v1/pessoas?busca=` filtra (nome= e termo= são ignorados). Pessoa jurídica ou física sem CNPJ/CPF é aceita. `contato` com UUID que não existe é aceito calado e o lançamento fica sem fornecedor: conferir antes de enviar
- `PATCH` da parcela muda `descricao`, `vencimento` (não `data_vencimento`) e `composicao_valor.valor_bruto`. Ignora calado categoria, centro de custo, fornecedor e conta. Não há rota de alterar ou apagar o evento (404, e DELETE da parcela dá 502). Categoria, centro e fornecedor errados só se corrigem na tela
