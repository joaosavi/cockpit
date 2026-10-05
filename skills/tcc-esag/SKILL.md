---
name: tcc-esag
description: >-
  Kit completo do TCC de Administração da ESAG/UDESC: cria o projeto do TCC com a formatação ABNT da UDESC
  pronta e conferida, as instruções para o agente, as normas, os links oficiais da ESAG e da BU, o roteiro de
  revisão e a cópia no Google Docs para o orientador. Use para começar um TCC da ESAG em qualquer modalidade
  (pesquisa, plano, projeto, consultoria, inovação), para gerar ou conferir o PDF ou a cópia do Google Docs
  de um TCC criado por esta skill, ou para atualizar o motor de formatação de um projeto desses.
---

# TCC de Administração da ESAG/UDESC

Esta skill cria a pasta de projeto do TCC. A forma já está resolvida e conferida: o CSS implementa o Manual de
Trabalhos Acadêmicos da BU/UDESC (10. ed. rev., jun. 2025), os scripts geram o PDF com sumário e listas na
página real, dois verificadores conferem o texto e o PDF pronto, e um conversor gera a cópia do Google Docs
que vai ao orientador. O autor escreve só o conteúdo, no `tcc.html`. O projeto traz um `AGENTS.md` que
governa as sessões seguintes, os links oficiais conferidos e, na consultoria, um guia de leitura para o autor.

## Começar um TCC

1. Defina a modalidade com o autor:

   | Chave | Modalidade |
   |---|---|
   | `tcc-i` | I: pesquisa com dados primários |
   | `tcc-ii` | II: pesquisa com dados secundários |
   | `tcc-iii-plano` | III: plano |
   | `tcc-iii-projeto` | III: projeto |
   | `tcc-iv` | IV: consultoria |
   | `tcc-v` | V: novos produtos, serviços e protótipos |

   As seções de cada uma são as da composição mínima do regulamento do curso; as listas estão em
   `assets/projeto/scripts/modelos.py`. A consultoria (`tcc-iv`) tem o modelo mais completo, com orientação
   dentro de cada seção, o `GUIA.md` e um roteiro de revisão próprio.
2. Crie o projeto numa pasta nova (o script recusa pasta que exista e não esteja vazia):

   ```bash
   python3 <pasta-desta-skill>/scripts/novo_projeto.py <pasta-nova> --modelo <chave>
   ```

3. Dentro da pasta nova, instale as dependências e gere o PDF do modelo:

   ```bash
   cd scripts && npm install && npx playwright install chromium-headless-shell && cd ..
   uv run --quiet --with pypdf python3 scripts/montar.py tcc.html
   uv run --quiet --with pdfplumber --with pypdf python3 scripts/conferir_pdf.py tcc.pdf
   ```

   O passo termina com o PDF gerado e o `conferir_pdf.py` com zero erro; as linhas de marcador `[PREENCHER]`
   aparecem contadas à parte.
4. Leia o `AGENTS.md` do projeto e siga-o a partir daqui: ele manda completar a ficha do TCC com o autor, uma
   pergunta por vez, e diz onde pesquisar, como escrever, como revisar e como fazer a cópia do orientador.

O projeto precisa de Node.js 20 ou mais novo e de Python 3 com `uv` ou `pip`. A cópia do Google Docs precisa do
conector do Google Drive ligado no Claude.

## Trabalhar num projeto que já existe

Se a pasta tem `AGENTS.md` e `scripts/abnt-udesc.css`, ela saiu desta skill: siga o `AGENTS.md` dela.

Para levar a um projeto antigo uma correção do motor, copie por cima o conteúdo de `assets/projeto/scripts/`
(sem `node_modules` nem `__pycache__`), o `assets/projeto/normas/abnt-udesc.md` e o
`assets/projeto/copia-google-docs.md`. Os arquivos do autor (`tcc.html`, `HANDOFF.md`, `decisoes.md`,
`levantamento/` e os demais) ficam como estão. Depois rode o `montar.py` e o `conferir_pdf.py`, e mostre ao
autor quantas páginas o PDF tinha e quantas tem.

## Regras do motor

- A forma vive só no `scripts/abnt-udesc.css`, com a regra e a página do manual ao lado de cada bloco. O texto
  vive no `tcc.html`. Mudança no CSS exige a regra e a fonte em `normas/abnt-udesc.md`.
- O `montar.py` dá id aos títulos, às ilustrações e às tabelas, lê a folha de cada um no layout do Paged.js e
  refaz sumário e listas a cada execução. Sumário e listas nunca se editam à mão. Lista própria de um tipo de
  ilustração é um bloco `<div class="lista-ilustracoes sumario" data-tipo="Quadro">`. Com `--tudo`, ele gera
  também a página de leitura e o `tcc.docx` da cópia do Google Docs.
- O `checar.py` confere o texto: marcadores e classe `pendente`, seções da modalidade, numeração progressiva,
  seção sem texto, resumo, ilustrações citadas e com fonte, listas por tipo, ordem e cruzamento das
  referências. O `conferir_pdf.py` mede o PDF: A4, margens, família e tamanhos de fonte, texto em preto,
  entrelinha, folha em branco, número de página, cada linha do sumário e das listas contra o destino do link,
  seção primária no topo, sequência das notas e marcas estruturais; sai com código 1 quando acha erro. Nenhum
  dos dois julga redação nem argumento. Uma versão só vai ao autor como pronta com o `conferir_pdf.py` em zero
  erro, sem marcador por escrever.
- A cópia do Google Docs sai do `google_docs.py` (A4, margens, capa, títulos 1 a 5, número de página,
  sumário com pontilhado em texto, alíneas, quadros, tabelas IBGE, imagens, notas de rodapé) e se confere
  com o `conferir_docs.py` sobre o PDF que o Google exporta. O passo a passo é o `copia-google-docs.md`.
- O motor não repete título e cabeçalho de tabela que passa de uma página (o manual pede, p. 54); o
  `montar.py` avisa quando isso acontece.
- O `scripts/teste/exemplo-elementos.html` usa todos os elementos (cinco níveis de título, alíneas,
  subalíneas, citação longa, notas, quadro, imagem, tabela, referências, apêndice). Depois de mexer no motor,
  gere esse exemplo no lugar e rode o `checar.py` e o `conferir_pdf.py` nele: os dois têm de dar zero.

As regras de formatação com fonte estão em `assets/projeto/normas/abnt-udesc.md`; os links oficiais da ESAG,
da BU e do Repositório, conferidos, em `assets/projeto/fontes/fontes-oficiais.md`.
