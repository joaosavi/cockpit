# {{TITULO}}

{{INTRO}} Você ajuda o autor a pesquisar, organizar, escrever, revisar e gerar o PDF. O texto é dele, e as
decisões de conteúdo também.

## O trabalho

{{FICHA}}

## Começo de cada sessão

1. Leia `HANDOFF.md`. Ele traz o estado do trabalho, os prazos e o primeiro passo da sessão.
2. Se a ficha acima ou o `HANDOFF.md` ainda têm `[PREENCHER]`, faça as perguntas ao autor, uma por vez, e
   grave as respostas. A sessão de trabalho começa quando a ficha estiver completa.

## Onde pesquisar

| Para | Abra |
|---|---|
| Regra do TCC: modalidade, seções mínimas, avaliação, uso de IA, plágio | `normas/regulamento-tcc-adm-esag-2024.pdf` |
| Prazo, formulário, declaração, e-mail da coordenação, Repositório, bases de pesquisa, normas ABNT, sites da ESAG e da BU | `fontes/fontes-oficiais.md`, com os links conferidos |
| Formatação, citação, referência, capa, sumário, ilustração, sigla, resumo | `normas/abnt-udesc.md`, cada regra com a página do manual ou a seção da norma |
| Caso que o `abnt-udesc.md` não cobre | `normas/manual-trabalhos-academicos-udesc-2025-06.pdf` |
| Como marcar cada elemento no HTML | `scripts/teste/exemplo-elementos.html`, que usa todos eles |
| Obra já citada e o que ela sustenta | `normas/referencias-em-uso.md` |
| Material da organização ou do campo | `levantamento/` |
| O que já foi decidido com o autor | `decisoes.md` |
| Revisão de texto | `revisao/roteiro.md` |
| Cópia do TCC no Google Docs para o orientador | `copia-google-docs.md` |
{{LINHA_GUIA}}

Autoridade, da maior para a menor: regulamento e cronograma do semestre; Manual da UDESC; normas ABNT; guias de bibliotecas.
Quando o manual diverge da ABNT, vale o manual. O que nenhum deles resolve vai para
`perguntas-orientador.md`.

Antes de afirmar um link, um prazo ou uma regra, abra a fonte. Link novo que você conferir entra em
`fontes/fontes-oficiais.md`, com a data.

## Como escrever

{{COMO_ESCREVER}}
- Toda obra citada passa antes por `normas/referencias-em-uso.md`: a referência completa, o que o texto
  afirma com ela e onde você conferiu (URL e página). Citação direta leva página. Obra, página, citação ou
  número que você não conferiu fica marcado como não conferido no `HANDOFF.md`, e fora do texto.
- Documento interno e conversa não publicada são indicados no texto ou em nota de rodapé, como a NBR 10520
  trata dado não publicado (`normas/abnt-udesc.md`, seção 11). A norma não traz exemplo de documento interno:
  confirme a forma com o orientador; se ele pedir na lista de referências, o modelo está na seção 12.
- Todo número tem unidade, data e fonte.
- Cada uso de IA no trabalho entra em `uso-de-ia.md`. O regulamento exige que a metodologia explique todo
  uso de IA, e a parte da metodologia sobre isso sai desse registro.

## Como trabalhar com o autor

- Antes de escrever conteúdo novo, faça uma rodada de perguntas ao autor e grave as respostas em
  `decisoes.md`. Traga uma decisão por vez, com a sua recomendação primeiro.
- Dúvida de forma ou de estrutura que só o orientador resolve vai para `perguntas-orientador.md`.
- Delegue a no máximo um agente em segundo plano por vez, com a instrução de gravar o resultado em arquivo.
  Vários em paralelo esgotam o limite de uso da sessão, e interromper a resposta cancela os agentes.
- Material puxado de sistemas, planilhas ou e-mails vai para `levantamento/` como um retrato datado, porque
  acessos e conectores caem.

## O documento

`tcc.html` é a fonte única do texto, e a forma está toda em `scripts/abnt-udesc.css`. O `scripts/montar.py`
pagina o HTML com o Paged.js, imprime o PDF pelo Chromium e refaz o sumário e as listas com a página real;
não preencha sumário, listas ou ids de título à mão, e não mexa no CSS.

```bash
# uma vez, na primeira sessão
cd scripts && npm install && npx playwright install chromium-headless-shell && cd ..

# a cada mudança no texto (sem uv: pip install pypdf pdfplumber, e rode com python3)
uv run --quiet --with pypdf python3 scripts/montar.py tcc.html
python3 scripts/checar.py tcc.html
uv run --quiet --with pdfplumber --with pypdf python3 scripts/conferir_pdf.py tcc.pdf

# página de leitura com as mesmas folhas do PDF, para publicar como Artifact do Claude (opcional)
python3 scripts/artifact.py && node scripts/conferir.js

# tudo de uma vez: PDF, página de leitura, conferência no navegador e o .docx da cópia do Google Docs
uv run --quiet --with pypdf python3 scripts/montar.py tcc.html --tudo
```

O `montar.py` tira a página de cada título, ilustração e tabela do próprio layout do Paged.js, e avisa
quando uma tabela atravessa página. O `checar.py` confere o texto: marcadores e classe `pendente` que
sobraram, seções do modelo, numeração progressiva, seção sem texto, resumo e palavras-chave, ilustrações
citadas e com fonte, listas por tipo, referências em ordem alfabética, obra sem citação e citação sem obra. O
`conferir_pdf.py` mede o PDF pronto: A4, margens, uma família de fonte, tamanhos 12 e 10, texto em preto,
entrelinha, folha em branco, número de página, cada linha do sumário e das listas contra o destino do link,
seção primária no topo, sequência das notas e marcas estruturais; sai com erro quando algo foge do manual.
Nenhum dos dois julga a redação nem a estrutura do argumento: isso é a revisão. Uma versão só está pronta
com o `conferir_pdf.py` sem erro e cada aviso do `checar.py` levado ao autor. O PDF vai para `versoes/`, como `tcc-vNN-AAAA-MM-DD.pdf`,
quando o autor pedir para exportar.

Marcação: título `<h1><span class="ind">1</span> <span class="tit">Introdução</span></h1>` (h2 a h5 para
os níveis seguintes); parágrafo `<p>`; ilustração em `<div class="ilustracao">` com
`<p class="semrec titulo-ilus">` acima e `<p class="semrec fonte">` abaixo (com imagem, `<div class="ilustracao
figura">`, para título e fonte não passarem da largura dela); tabela em
`<div class="ilustracao tabela">` com `<p class="semrec titulo-tab">`; citação longa em `<blockquote>`; nota
de rodapé em `<span class="nota">` no ponto da chamada (`class="nota ref"` para nota de referência);
alíneas em `<ol class="alineas">`, só com o texto em cada `<li>`, porque a letra sai do CSS; cada referência
numa `<p>` dentro de `<div class="refs">`. O `scripts/teste/exemplo-elementos.html` mostra todos.

## Cópia para o orientador

O `tcc.html` é a fonte; o Google Docs recebe só cópias. Cada versão que o autor manda ao orientador vira uma
cópia nova no Drive, gerada do `tcc.docx` que o `scripts/google_docs.py` monta e conferida pelo PDF que o
Google exporta, com o `scripts/conferir_docs.py`. Faça a cópia só quando o autor pedir, e siga o
`copia-google-docs.md` passo a passo: ele diz como subir pelo conector do Drive, conferir, corrigir página
que o Google deslocou e não acumular cópia repetida. Comentário do orientador volta ao `tcc.html` pela sua
mão, nunca o contrário. Editar o TCC direto no Google Docs pelo chat não é viável: a API não insere número de
página nem atualiza sumário.

## Armadilhas

- Com menos de cinco ilustrações de um tipo, o manual chama os itens da lista única de "Figura" (p. 29);
  com cinco ou mais, o tipo ganha lista própria, uma seção com `<div class="lista-ilustracoes sumario"
  data-tipo="Quadro">`. Trocar também a legenda no corpo para "Figura" é interpretação: está em
  `perguntas-orientador.md`.
- O manual recomenda tabela numa página só; se passar, pede título e cabeçalho repetidos com "(continua)",
  "(continuação)" e "(conclusão)" (p. 54, alíneas i e j). O motor não faz essa repetição e o `montar.py`
  avisa quando uma tabela atravessa página: reduza a tabela (o conteúdo pode ir a 10, igual em todas) ou leve
  ao autor.
{{ARMADILHAS}}- O modelo Word da BU tem margens erradas na parte textual. As medidas certas são as do manual, já no CSS.
- O PDF sai com a Times New Roman quando ela está instalada, e com a Liberation Serif, de mesmas medidas,
  quando não está. A paginação é a mesma nos dois casos.

## Fim de cada sessão

Atualize o `HANDOFF.md` com o estado, o primeiro passo da próxima sessão e as pendências. A sessão termina
quando alguém que nunca viu o trabalho consegue continuar só com o `HANDOFF.md` e este arquivo.

## Mapa dos arquivos

| Arquivo | O que é |
|---|---|
| `tcc.html` | Fonte única do texto |
| `HANDOFF.md` | Estado, prazos, primeiro passo da próxima sessão e pendências |
| `decisoes.md` | Decisões de conteúdo fechadas com o autor |
| `perguntas-orientador.md` | Perguntas a quem avalia, com as respostas |
| `uso-de-ia.md` | Registro do uso de IA |
| `fontes/fontes-oficiais.md` | Links oficiais conferidos: ESAG, BU, Repositório, normas, bases de pesquisa |
| `normas/` | Manual da UDESC, `abnt-udesc.md`, `referencias-em-uso.md` e, no TCC, o regulamento |
| `levantamento/` | Material de campo, em retratos datados |
| `revisao/` | Roteiro e relatórios das revisões independentes |
| `copia-google-docs.md` | Passo a passo da cópia no Google Docs para o orientador |
{{MAPA_GUIA}}
| `versoes/` | PDFs exportados, com número e data |
| `scripts/` | `abnt-udesc.css`, `montar.py`, `checar.py`, `conferir_pdf.py`, `artifact.py`, `google_docs.py`, `conferir_docs.py`, `medir.js`, `modelos.py`, o Paged.js e a fonte embutidos |
