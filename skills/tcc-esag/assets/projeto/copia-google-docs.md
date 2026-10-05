# Cópia do Google Docs para o orientador

O `tcc.html` continua a fonte do TCC. A cópia no Google Docs serve para o orientador ler e comentar, e nada
volta dela para o HTML sozinho. Editar o TCC direto num Google Doc pelo chat não é viável: a API do Docs não
insere número de página nem atualiza sumário, e cada edição exige posição exata no documento inteiro.

Faça a cópia só quando o autor pedir, uma por versão enviada, numa pasta do Drive combinada com ele, com o
nome "TCC vNN (dd/mm/aaaa)". Grave o id da pasta no `HANDOFF.md`. O processo não acumula documento repetido:
quando uma cópia nova substitui uma que falhou na conferência, a anterior vai para a lixeira.

O que precisa estar ligado: o conector do Google Drive, no Claude.

## Passos

1. Rode `uv run --quiet --with pypdf python3 scripts/montar.py tcc.html --tudo`. Ele gera o PDF, a página de
   leitura e o `tcc.docx`.
2. Suba o `tcc.docx` com o `create_file` do Drive: `contentMimeType`
   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `parentId` da pasta, `title` com
   o nome da versão e o arquivo em `base64Content`. O Drive converte em Google Doc. O conector só recebe o
   arquivo dentro da chamada: imprima `base64 -w0 tcc.docx` (em duas metades, com `head -c` e `tail -c`, se
   passar de uns 40 mil caracteres) e copie sem alterar nada. Suba sempre o `.docx`: o HTML direto chega ao
   Google em papel Carta, sem margens, sem capa e sem número de página.
3. Exporte a cópia com `download_file_content` e `exportMimeType: "application/pdf"`. O resultado fica salvo
   num arquivo, e a mensagem da ferramenta diz onde.
4. Rode `uv run --quiet --with pypdf python3 scripts/conferir_docs.py <arquivo salvo>`. A cópia está pronta
   quando ele disser "todas as páginas certas".
5. Se ele listar páginas erradas, rode `python3 scripts/google_docs.py tcc.html --paginas google-paginas.json`,
   suba esse `.docx` como cópia nova, exporte e confira de novo com `--paginas google-paginas.json`. Quando a
   nova passar, mande a anterior para a lixeira com `trash_file`.
6. Mande o link da cópia ao autor.

O passo 5 existe porque o Google quebra as linhas um pouco diferente do Chromium (ele não usa kerning), e um
título pode cair uma página antes ou depois do PDF. Num TCC de 31 folhas, 45 das 46 linhas do sumário e da
lista de quadros bateram de primeira.

## O que a cópia traz

Papel A4, margens, capa e folha de rosto nas posições do PDF, títulos com os estilos Título 1 a 5 do Google,
número de página a partir da Introdução contando da folha de rosto, sumário e listas com o pontilhado em texto
(o Google ignora a guia pontilhada do Word), alíneas e subalíneas, quadros fechados, tabelas no padrão IBGE,
imagens com título e fonte na largura delas, notas de rodapé nativas e citações longas. Os marcadores
`[PREENCHER]` saem cinza, como no PDF.

## Comentários e edições

Os comentários do orientador saem com o `read_file_content` do Drive e `includeComments: true`. Leve cada
mudança para o `tcc.html`, que é a fonte. Edição pequena feita à mão na cópia é do autor, e o que mudar de
texto ali também entra no `tcc.html`.
