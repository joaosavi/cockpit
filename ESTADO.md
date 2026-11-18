# Estado

## Em andamento

- Recall do global-memory (1.11.0, 18/11/2026): cada pedido de pessoa busca no ai-memory e injeta até
  3 páginas, teto de 4.000 tokens. Nos 8 casos reais de 18/11, 11 das 13 páginas esperadas entram, e
  todo caso traz ao menos uma. Na VPS lê do disco (120 a 340 ms); no PC e no Mac busca pelo gateway MCP
  (1,9 a 2,5 s no Mac), com o projeto da pasta (1.12.0). Aberto: a página que não divide palavra com o pedido ("balancete" contra
  "fechamento") fica de fora; no gateway cada chamada abre sessão própria (0,5 s).

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

- Página grande entra pelo resumo (1.11.0, 18/11): o texto antes do primeiro subtítulo, até 800
  tokens. Página inteira só quando sobra lugar para o resumo das de baixo. Por quê: a sdoc-documentos
  (6.031 tokens) entrava cortada e tomava o teto sozinha. Escolhido o corte em vez de dividir a página,
  por não mexer no wiki (recomendação do coordenador).
- Recall pelo gateway sem wiki local (1.11.0, 18/11): opção `gatewayCommand`, que no PC e no Mac é o
  `gateway-mcp chamar` do harness. Por quê: o código vai para o Mac, onde não há servidor do ai-memory.

- Projeto da sessão pelo `.ai-memory.toml` e pelo `projectsFile` (1.12.0, 18/11): o mesmo arquivo
  que o ai-memory lê e o projects.json da Demerzel, a pasta mais funda primeiro, até 3 projetos. Por quê:
  no Mac a pasta de memória não é link para o wiki, e o agente do getdemo ficava só com o `_global`.

## Armadilhas

- Teste de mod roda isolado (18/11/2026): importa só arquivos do mod e `claude-code`. `node:fs`,
  `Bun`, `process` e `fetch` não existem lá, então estado real da máquina se prova por `claude -p
  --plugin-dir` e pelo diário, nunca na suíte.
- O repo não traz os tipos do `claude-code` (`.claude-plugin/types` não existe): sem `tsc`, a prova de
  tipo é o runner do `claude plugin test`.
- `memory_query` com `global=true` é só FTS; a busca híbrida (vetor, grafo) só roda com
  `workspace` e `project` (ai-memory 3.5.0).
