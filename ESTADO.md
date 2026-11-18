# Estado

## Em andamento

- Recall do global-memory (1.10.0, 18/11/2026): cada pedido de pessoa busca no ai-memory e injeta até 3
  páginas inteiras, teto de 4.000 tokens. Nos 8 casos reais de 18/11, 10 das 13 páginas esperadas
  entraram e todo caso trouxe ao menos uma; 120 a 226 ms por pedido. Abertos: a página que não divide
  palavra com o pedido ("balancete" contra "fechamento") fica de fora, e uma página de 6.000 tokens
  (sdoc-documentos) entra cortada e ocupa o teto sozinha. PC e Mac não têm o servidor do ai-memory, e lá
  o recall fica parado (sem `wikiDir`).

## Decisões

- Recall sem modelo (18/11): FTS global com peso 2, busca do projeto (FTS, entidade, grafo e vetor) com
  peso 0,5 pela posição, palavra do pedido no nome ou na linha do índice com peso 1, corte em 60% do
  primeiro. Por quê: a busca fundida sozinha pôs uma página esperada em 1º em 2 de 8 casos, e o vetor
  local (all-MiniLM-L6-v2) é inglês; a FTS com o pedido limpo de enchimento acertou os ditados. O Haiku
  ficou de fora porque a busca sem modelo não errou muito (todo caso com ao menos uma página certa).
- Tokens estimados a 2 caracteres por token (18/11): o count_tokens deu 2,11 em 8 páginas em português.
  Com 3 o teto estourava uns 40%.
- Aviso de índice em 22.000 caracteres e linha em 200 (18/11): o core corta em 25.000, e 22.000 deixa
  umas 12 linhas de crescimento antes do aviso. Em 20.000 o `_global` (20.298) já nascia avisando.

- Texto do recall como sugestão (1.10.1, 18/11, pedido do João): o bloco diz que as páginas são
  palpite do hook, que ele erra e deixa página de fora, e manda o agente buscar com `memory_query` sem
  se limitar ao que veio. Por quê: página que o hook não trouxe não pode parecer inexistente.

## Armadilhas

- Teste de mod roda isolado (18/11/2026): importa só arquivos do mod e `claude-code`. `node:fs`,
  `Bun`, `process` e `fetch` não existem lá, então estado real da máquina se prova por `claude -p
  --plugin-dir` e pelo diário, nunca na suíte.
- O repo não traz os tipos do `claude-code` (`.claude-plugin/types` não existe): sem `tsc`, a prova de
  tipo é o runner do `claude plugin test`.
- `memory_query` com `global=true` é só FTS; a busca híbrida (vetor, grafo) só roda com
  `workspace` e `project` (ai-memory 3.5.0).
