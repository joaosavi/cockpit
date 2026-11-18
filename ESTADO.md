# Estado

## Em andamento

- Mod `recall` (1.13.0, 18/11/2026), no lugar do global-memory: cada pedido de pessoa busca no
  ai-memory e injeta até 3 páginas, teto de 4.000 tokens, como sugestão do hook. O resto da memória é
  o nativo do ai-memory (perfil, brief, handoff). Nos 8 casos reais de 18/11, 11 das 13 páginas
  esperadas entram sem o índice, igual à 1.12.0 com o índice. Busca pelo `ai-memory call` (na VPS e,
  pelo túnel da 49374, no PC e no Mac), com o gateway de reserva. Aberto: a página que não divide
  palavra com o pedido ("balancete" contra "fechamento") fica de fora.

## Decisões

- Recall sem modelo (18/11): FTS global com peso 2, busca do projeto (FTS, entidade, grafo e vetor) com
  peso 0,5 pela posição, palavra do pedido no nome do arquivo ou no título com peso 1, corte em 60% do
  primeiro. Por quê: a busca fundida sozinha pôs uma página esperada em 1º em 2 de 8 casos, e o vetor
  local (all-MiniLM-L6-v2) é inglês; a FTS com o pedido limpo de enchimento acertou os ditados. O Haiku
  ficou de fora porque a busca sem modelo não errou muito (todo caso com ao menos uma página certa).
- Tokens estimados a 2 caracteres por token (18/11): o count_tokens deu 2,11 em 8 páginas em português.
  Com 3 o teto estourava uns 40%.
- Texto do recall como sugestão (1.10.1, 18/11, pedido do João): o bloco diz que as páginas são
  palpite do hook, que ele erra e deixa página de fora, e manda o agente buscar com `memory_query` sem
  se limitar ao que veio. Por quê: página que o hook não trouxe não pode parecer inexistente.
- Página grande entra pelo resumo (1.11.0, 18/11): o texto antes do primeiro subtítulo, até 800
  tokens. Página inteira só quando sobra lugar para o resumo das de baixo. Por quê: a sdoc-documentos
  (6.031 tokens) entrava cortada e tomava o teto sozinha.
- Projeto da sessão pelo `.ai-memory.toml` e pelo `projectsFile` (1.12.0, 18/11): a pasta mais funda
  primeiro, até 3 projetos.
- O nativo no lugar do global-memory (1.13.0, 18/11, João: "vamos usar oq o ai-memory faz"): o índice
  injetado, a seção de memória reescrita e a guarda do índice saíram. Ficou só o recall, que o
  ai-memory 3.5.0 não tem (o `UserPromptSubmit` dele só devolve o resumo depois de compactar, o aviso
  de caixa e o brief da troca de projeto). O título curto que só o índice tinha foi para o frontmatter
  de 148 páginas antes de o índice sair: sem ele, os 8 casos caíam de 11 para 10 de 13.
- Busca pelo `ai-memory call` com o gateway de reserva (1.13.0): o túnel do container leva a 49374, e o
  CLI usa o token do servidor; o gateway entra só quando o CLI falha.

## Armadilhas

- Teste de mod roda isolado (18/11/2026): importa só arquivos do mod e `claude-code`. `node:fs`,
  `Bun`, `process` e `fetch` não existem lá, então estado real da máquina se prova por `claude -p
  --plugin-dir` e pelo diário, nunca na suíte.
- O repo não traz os tipos do `claude-code` (`.claude-plugin/types` não existe): sem `tsc`, a prova de
  tipo é o runner do `claude plugin test`.
- `memory_query` com `global=true` é só FTS; a busca híbrida (vetor, grafo) só roda com
  `workspace` e `project` (ai-memory 3.5.0).
- O título da página pesa no recall (18/11/2026): página com título igual ao nome do arquivo perde o
  pedido que usa uma palavra só do título escrito à mão (regras-ferramentas e "Telegram").
