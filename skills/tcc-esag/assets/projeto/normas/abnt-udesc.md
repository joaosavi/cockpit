# Formatação do TCC de Administração na ESAG/UDESC (entrega em 2026)

Guia para montar o TCC em HTML/CSS e imprimir em PDF pelo Chromium. Levantamento feito em 03/10/2026, com as
normas e o manual vigentes nessa data. Os prazos citados são os do cronograma 2026/2; confira o do seu semestre
em `fontes/fontes-oficiais.md`.

Convenções deste guia:

- "Manual p. N" é a página impressa do Manual da BU/UDESC (10. ed. rev., 2025). No PDF, a página é N + 2.
- "NBR 14724, 5.3" é a seção da norma. Para a NBR 14724 vale a versão corrigida de 01/04/2025.
- Onde a norma pede travessão, os exemplos escrevem `&ndash;` (U+2013), o caractere que o manual usa nos
  modelos (Manual p. 30, 39, 82). Os exemplos da própria NBR 14724 alternam U+2014 e U+2013.
- Ordem de autoridade: manual da UDESC; depois as normas ABNT; depois guias de bibliotecas. Quando o
  manual diverge da ABNT, o guia registra as duas e aplica o manual.
- Os exemplos de referência e de marcação vêm em HTML (`<b>`, `<i>`), prontos para colar no documento.

## 1 Fontes consultadas

| Fonte | Versão | URL | Uso |
|---|---|---|---|
| Manual para a Elaboração de Trabalhos Acadêmicos da Udesc (BU/UDESC) | 10. ed. rev., Florianópolis, 2025; PDF gerado em 23/06/2025; 145 p. | https://www.udesc.br/arquivos/udesc/id_cpmenu/12510/Manual_atualizado_junho_2025_17507115200783_12510.pdf (cópia local: `manual-trabalhos-academicos-udesc-2025-06.pdf`) | Fonte principal |
| Página "Trabalhos acadêmicos" da BU | consultada em 03/10/2026 | https://www.udesc.br/bu/manuais | Confirma que o manual de junho de 2025 é o vigente |
| Modelo Word de TCC da BU | criado em 26/08/2020, modificado em 07/08/2025 | https://www.udesc.br/arquivos/udesc/id_cpmenu/12501/MODELO_DE_TRABALHO_DE_CONCLUSAO_DE_CURSO_EDITAVEL_26_08_2020_17545859494594_12501.docx (página: https://www.udesc.br/bu/manuais/modelo) | Distância vertical da capa e da folha de rosto; estilos |
| ABNT NBR 14724 | 4. ed., 16/12/2024, versão corrigida de 01/04/2025 (incorpora a Errata 1) | cópia da versão corrigida: https://engenhariaedesenvolvimentosustentavel.ufes.br/sites/engenhariaedesenvolvimentosustentavel.ufes.br/files/field/anexo/abnt_nbr_14724.pdf ; cópia da edição de 16/12/2024: https://tpp-uff.com.br/wp-content/uploads/2025/02/ABNT_NBR_14724_2024-1.pdf | Estrutura e regras gerais |
| ABNT NBR 10520 | 2. ed., 19/07/2023 | https://facore.ufpa.br/Documentos/TCC/10520%20CITA%C3%87%C3%95ES.pdf | Citações |
| ABNT NBR 6023 | 3. ed., 21/05/2025; cancela e substitui a 6023:2018 e incorpora a Emenda 1 de 21/05/2025 | https://bkpsitecpsnew.blob.core.windows.net/uploadsitecps/sites/149/2025/05/Referencias-NBR-6023-2025.pdf ; guia Unicamp (03/06/2025): https://www3.eco.unicamp.br/biblioteca/images/arquivos/NBR60232025Referencias.pdf | Referências |
| ABNT NBR 6024 | 2012 | https://mnpef.ect.ufrn.br/wp-content/uploads/2017/03/ABNT_NBR-6024-2012.pdf | Numeração progressiva |
| ABNT NBR 6027 | 2012 | https://gtga.unir.br/uploads/81837305/ABNT/NBR6027%20-%20Sumario.pdf | Sumário |
| ABNT NBR 6028 | 2. ed., 18/05/2021 | https://eje.tre-ba.jus.br/pluginfile.php/38310/mod_resource/content/2/NBR6028%20-%20Resumo%2C%20resenha%20e%20recens%C3%A3o.pdf | Resumo |
| IBGE, Normas de apresentação tabular | 3. ed., 1993 | https://biblioteca.ibge.gov.br/visualizacao/livros/liv23907.pdf | Tabelas |
| Biblioteca da Escola de Arquitetura da UFMG, "Principais mudanças da ABNT NBR 14724/2024" | mar. 2025 | https://sites.arq.ufmg.br/biblioteca/wp-content/uploads/2025/03/NBR-14724-2024_principais-mudan%C3%A7as-1.pdf | Mudanças 2011 para 2024 |
| SIBI PUCPR, "ABNT NBR 14.724 atualizada" | 2025 | https://www.pucpr.br/noticias/abnt-nbr-14-724-atualizada-descubra-o-que-mudou/ | Mudanças 2011 para 2024 |
| Regulamento do TCC de Administração da ESAG | PPC 2024.1, ano 2025 | https://www.udesc.br/arquivos/esag/id_cpmenu/6182/REGULAMENTO_DE_TCC_Administra__o_ESAG_Curr_culo_2024_1_2__17544901343226_6182.pdf (cópia local: `regulamento-tcc-adm-esag-2024.pdf`) | Regras do curso |
| Modelo de Estruturas do TCC (Coordenação de Estágios ESAG) | PDF de 07/08/2025 | https://www.udesc.br/arquivos/esag/id_cpmenu/6182/Modelo_de_Estruturas_do_TCC_17545830884512_6182.pdf | Composição mínima por modalidade |
| Página do TCC de Administração (Coordenação de Estágios) | consultada em 03/10/2026 | https://www.udesc.br/esag/estagios/estagiocurricular | Documentos e passos |
| Cronograma de TCC Administração Empresarial 2026/2 (v4) | 2026 | https://www.udesc.br/arquivos/esag/id_cpmenu/6182/CRONOGRAMA_da_Administra__o_empresarial_2026_2__v4_178553272612_6182.pdf | Prazos e arquivos |
| Declaração de Versão Final e Autorização para Publicação | 2025 | https://www.udesc.br/arquivos/esag/id_cpmenu/6182/Declara__o_de_Vers_o_Final_e_Autoriza__o_Para_Publica__o_17634821118225_6182.docx | Última página do PDF final |
| Instrução Normativa UDESC 002/2025 | 2025 | https://www.udesc.br/arquivos/udesc/id_cpmenu/17311/IN_002_2025_publicada_17583035296145_17311.pdf | Entrega no Repositório (remete à IN 014/2024, não lida: https://udesc.br/arquivos/udesc/id_cpmenu/17311/IN_14_2024_assinada_17307452077286_17311.pdf) |

As cópias das normas ABNT são impressões licenciadas publicadas por terceiros. Serviram só para conferir o
texto.

### Edições vigentes

- NBR 6023: a vigente é a de 2025, não a de 2018. O manual da UDESC já segue a de 2025 (Manual p. 15, 37,
  78). Este guia usa a de 2025. A regra de apresentação conferida na norma (6.3: espaço simples,
  alinhamento à esquerda, uma linha simples em branco entre referências) e o itálico de "In:" e "et al."
  são os mesmos que a Biblioteca de Letras da UFRJ descreve para a 2018
  (https://biblioteca.letras.ufrj.br/mudancas-na-norma-da-abnt-6023-que-orienta-a-elaboracao-de-referencias/).
- Vários blogs (fastformat, tesify, edocbrasil) afirmam que a 6023:2025 dispensa a data de acesso quando há
  DOI. O texto da norma não confirma: 6.6 e 8.13 exigem "Disponível em:" e "Acesso em:" para todo documento
  online, e o exemplo com DOI (7.7.6, exemplo 8) traz data de acesso. Mantenha a data de acesso.
- A lista completa de mudanças da 6023:2025 em relação à 2018 está não confirmada: a cópia da norma tem a
  camada de texto corrompida e nenhum guia de biblioteca consultado lista as mudanças.

### O que mudou na NBR 14724

Da edição de 2011 para a de 2024 (UFMG; PUCPR; texto da norma):

- o trabalho acadêmico não pode ser dividido em capítulos, só em seções (4.2.2);
- o verso da folha de rosto, com a ficha catalográfica, não é contado nem numerado; em formato eletrônico,
  a ficha vem logo após a folha de rosto (4.2.1.1.2, 5.3);
- a ficha segue "o código de catalogação vigente", sem citar o AACR2 (4.2.1.1.2);
- a referência de um anexo vai no próprio anexo, em nota de rodapé ou lista específica, e não na lista de
  referências (4.2.3.1);
- a epígrafe pré-textual não precisa seguir a NBR 10520; a epígrafe de abertura de seção primária segue
  (4.2.1.6);
- recomenda-se dedicatória e epígrafe do meio da mancha até a margem direita, na parte inferior (5.2.4);
- ilustração e tabela feitas pelo autor trazem na fonte "elaborado pelo próprio autor", "elaboração própria"
  ou "o próprio autor" (5.8, 5.9).

Da edição de 16/12/2024 para a versão corrigida de 01/04/2025 (Errata 1): comparei página a página o texto
da cópia UFF (16/12/2024) com o da cópia UFES (versão corrigida), no prefácio e nas p. 1 a 12 da norma.
Achei uma única mudança de texto, em 5.8: "Tipo, número de ordem, título, fonte, legenda e notas devem
acompanhar as margens da ilustração" passou a "devem respeitar as margens da ilustração". O prefácio ganhou
a frase "Esta versão corrigida da ABNT NBR 14724:2024 incorpora a Errata 1, de 01.04.2025". Não comparei a
capa e o sumário da norma, nem os desenhos dos exemplos. Nenhuma busca achou a lista oficial da errata;
qualquer outra mudança fica não confirmada.

## 2 Estrutura do TCC

Ordem dos elementos, do primeiro ao último (Manual p. 17, Quadro 1; NBR 14724, 4 e Esquema 1):

| Ordem | Elemento | No TCC de graduação da UDESC | Fonte e divergência |
|---|---|---|---|
| 1 | Capa | obrigatória | Manual p. 17-18 |
| | Lombada | não se aplica: entrega só digital | Manual p. 17 nota 1, p. 18 (IN UDESC 12/2020) |
| 2 | Folha de rosto | obrigatória | Manual p. 17, 20 |
| | Ficha de identificação da obra (ficha catalográfica) | não deve constar em trabalho de graduação | Manual p. 17 nota 2, p. 22. A NBR 14724, 4.2.1.1.2, manda incluir; vale o manual |
| 3 | Errata | opcional | Manual p. 22 |
| 4 | Folha de aprovação | opcional | Manual p. 17 nota 3, p. 23. A NBR 14724, Esquema 1 e 4.2.1.3, diz obrigatória; vale o manual |
| 5 | Dedicatória | opcional | Manual p. 24 |
| 6 | Agradecimentos | opcional | Manual p. 25 |
| 7 | Epígrafe | opcional | Manual p. 25-26 |
| 8 | Resumo na língua vernácula | obrigatório | Manual p. 26 |
| 9 | Resumo em língua estrangeira | obrigatório em todo TCC | Manual p. 28 |
| 10 | Lista de ilustrações | opcional | Manual p. 29 |
| 11 | Lista de tabelas | opcional | Manual p. 31 |
| 12 | Lista de abreviaturas e siglas | opcional | Manual p. 31 |
| 13 | Lista de símbolos | opcional | Manual p. 33 |
| 14 | Sumário | obrigatório; último pré-textual | Manual p. 33 |
| 15 | Introdução | obrigatória | Manual p. 17, 36 |
| 16 | Desenvolvimento | obrigatório | Manual p. 17, 36 |
| 17 | Conclusão | obrigatória | Manual p. 17, 37 |
| 18 | Referências | obrigatórias | Manual p. 17, 37 |
| 19 | Glossário | opcional | Manual p. 38 |
| 20 | Apêndice | opcional | Manual p. 39 |
| 21 | Anexo | opcional | Manual p. 39 |
| 22 | Índice | opcional | Manual p. 41 |
| 23 | Declaração de Versão Final e Autorização para Publicação, assinada por aluno e orientador | obrigatória na versão final depositada no Repositório, como última página do PDF | Cronograma 2026/2; página do TCC da ESAG. Exigência da ESAG, fora da ABNT |

Regras gerais da estrutura:

- No TCC de Administração da ESAG, o regulamento põe a avaliação com o orientador, que dá a nota pelo
  formulário do Anexo 1; a mínima é 7,0 (Regulamento, "Da avaliação"). Sem banca, a folha de aprovação não
  tem membros a listar. Recomendo omiti-la; se entrar, leva os elementos da folha de rosto, orientador, membros da banca
  com titulação e instituição, local e data, sem o título "Folha de aprovação" (Manual p. 23).
- Todo elemento pré-textual, toda seção primária e todo elemento pós-textual começa em página nova (Manual
  p. 42). Folha de aprovação, dedicatória e epígrafe também (Manual p. 47).
- Os nomes das seções textuais ficam a critério do autor (NBR 14724, Esquema 1, nota 1), mas a ESAG fixa a
  composição mínima por modalidade (seção 14 deste guia).
- O trabalho não pode ser dividido em capítulos; divide-se em seções numeradas (NBR 14724, 4.2.2).
- Toda obra da lista de referências precisa estar citada no texto. Obra consultada e não citada vai num
  apêndice (Manual p. 37).
- A referência de um anexo fica no próprio anexo, em nota de rodapé ou lista específica (NBR 14724, 4.2.3.1).
  O manual não trata disso.
- Ordem das listas: ilustrações (várias listas de ilustração em ordem livre), tabelas, abreviaturas e
  siglas, símbolos (Manual p. 30).
- Apêndice e anexo: título "APÊNDICE A `&ndash;` TÍTULO", "ANEXO A `&ndash;` TÍTULO", centralizado no alto
  da página, maiúsculas e negrito; letras dobradas (AA, AB) quando acabar o alfabeto; cada um em página nova
  (Manual p. 39; NBR 14724, 4.2.3.3-4.2.3.4). No texto: "(APÊNDICE A)" no fim da frase ou "o APÊNDICE A
  mostra" (Manual p. 39).
- Dedicatória: sem título, mesma fonte e espaçamento do texto (12, 1,5), justificada, recuo de 8 cm, no pé
  da página, a duas linhas de 1,5 da margem inferior (Manual p. 24, Fig. 6).
- Agradecimentos: título "AGRADECIMENTOS", mesma fonte e espaçamento do texto (Manual p. 25).
- Epígrafe: sem título, no pé da página, a duas linhas de 1,5 da margem inferior. Até três linhas: 12, 1,5,
  justificada, recuo de 1,25 cm, entre aspas, com página na chamada. Quatro linhas ou mais: 10, simples, justificada, sem
  aspas, recuo de 4 cm, com página na chamada (Manual p. 25-26, Fig. 8). Pode haver epígrafe também na
  abertura de cada seção primária (Manual p. 25).
- Errata: título "ERRATA"; referência do trabalho e tabela Folha / Linha / Onde se lê / Leia-se (Manual
  p. 22; NBR 14724, 4.2.1.2).
- Glossário: ordem alfabética; termo com inicial maiúscula, dois-pontos e espaço, definição com inicial
  maiúscula; justificado; 1,5 (Manual p. 38).

## 3 Capa

Conteúdo, nesta ordem (Manual p. 18):

1. nome da universidade com a sigla, nome do centro com a sigla, nome do curso;
2. nome do autor;
3. título;
4. subtítulo, se houver, precedido de dois-pontos;
5. número do volume, se houver mais de um;
6. cidade da universidade (cidade homônima leva a UF após vírgula: "Viçosa, MG");
7. ano de depósito (entrega).

Tipografia (Manual p. 19, Fig. 2): Arial ou Times New Roman, 12, centralizado, negrito, maiúsculas,
entrelinha 1,5. O subtítulo fica sem negrito e continua em maiúsculas. Margens de 3 cm (superior e
esquerda) e 2 cm (inferior e direita). A capa não é contada nem numerada (Manual p. 47).

Disposição, linha a linha. As linhas em branco vêm do modelo Word da BU (parágrafos 0 a 32), em entrelinha
1,5:

```html
<!-- topo da mancha (3 cm da borda) -->
UNIVERSIDADE DO ESTADO DE SANTA CATARINA &ndash; UDESC
CENTRO DE CIÊNCIAS DA ADMINISTRAÇÃO E SOCIOECONÔMICAS &ndash; ESAG
CURSO DE ADMINISTRAÇÃO EMPRESARIAL
<!-- 5 linhas em branco -->
NOME COMPLETO DO AUTOR
<!-- 6 linhas em branco -->
TÍTULO DO TRABALHO: SUBTÍTULO   <!-- subtítulo sem negrito -->
<!-- 15 linhas em branco: o restante da página -->
FLORIANÓPOLIS
2026
<!-- pé da mancha (2 cm da borda) -->
```

Todas as linhas acima ficam em negrito, menos o subtítulo. O manual não fixa medida vertical: a Figura 2 põe
o autor a cerca de um quarto da altura, o título no meio e cidade e ano encostados no pé. Em CSS, isso sai
com uma coluna flex de altura igual à mancha, cidade e ano empurrados para o fim.

Nomes do centro e do curso:

- Centro, confirmado em 05/10/2026: "Centro de Ciências da Administração e Socioeconômicas" é o título do
  site da ESAG e o nome da comunidade da ESAG no Repositório (`fontes/fontes-oficiais.md`, seção 6). O modelo
  Word da BU (07/08/2025) escreve "Escola Superior de Administração e Gerência", nome histórico, e o Regimento
  Geral de 2007 grafa "Sócio-Econômicas". O manual só diz "nome do Centro seguido da sigla" (p. 18).
- Curso, não confirmado: o PPC 2024 diz "Administração", e o diploma, "Bacharel em Administração"; o título
  do Regulamento diz "Curso de Administração", e o Anexo 1 dele, "Curso de Administração Empresarial"; o site,
  o cronograma e a coleção do Repositório dizem "Administração Empresarial". O modelo usa "Administração
  Empresarial". Confirmar com a Coordenadoria de Estágios.
- Separador: a Figura 2 usa travessão na linha da universidade e hífen na do centro. Use um só.

A NBR 14724, 4.1.1, deixa o nome da instituição opcional na capa; o manual exige universidade, centro e
curso. Vale o manual.

## 4 Folha de rosto

Conteúdo, nesta ordem (Manual p. 20; NBR 14724, 4.2.1.1.1):

1. nome do autor;
2. título;
3. subtítulo, precedido de dois-pontos;
4. número do volume, se houver;
5. natureza: tipo do trabalho, objetivo (grau pretendido), instituição a que é submetido, área de
   concentração;
6. orientador: "Prof." + titulação (Dr., Me., Esp.) + nome completo; orientadora: "Prof.ª" + titulação
   (Dra., Ma., Esp.) + nome completo;
7. coorientador, se houver, no mesmo formato;
8. cidade;
9. ano de depósito.

Tipografia (Manual p. 21, Fig. 3; p. 43, Quadro 3; NBR 14724, 5.2):

- autor, título, cidade e ano: como na capa (12, negrito, maiúsculas, centralizado, 1,5; subtítulo sem
  negrito);
- natureza e orientador: 12, sem negrito, caixa normal, espaçamento simples, justificado, recuo de 8 cm da
  margem esquerda. Com 16 cm de mancha, o bloco ocupa da metade da mancha até a margem direita, como pede a
  NBR 14724, 5.2;
- a linha do orientador vem logo abaixo da natureza, dentro do mesmo bloco, sem linha em branco (Fig. 3);
- a folha de rosto é a página 1 da contagem e não exibe número (Manual p. 47).

Disposição, linha a linha (modelo Word da BU, parágrafos 33 a 61):

```html
<!-- topo da mancha -->
NOME COMPLETO DO AUTOR
<!-- 12 linhas em branco -->
TÍTULO DO TRABALHO: SUBTÍTULO   <!-- subtítulo sem negrito -->
<!-- 3 linhas em branco -->
<div style="margin-left: 8cm; line-height: 1; text-align: justify; font-weight: normal">
Trabalho de Conclusão de Curso apresentado ao Curso de Administração Empresarial do Centro de Ciências da
Administração e Socioeconômicas, da Universidade do Estado de Santa Catarina, como requisito parcial
para obtenção do grau de Bacharel em Administração.<br>
Orientador: Prof. Dr. Nome Completo do Orientador.
</div>
<!-- 8 linhas em branco -->
FLORIANÓPOLIS
2026
```

A redação da natureza acima é proposta minha, montada sobre o modelo do manual (Fig. 3, de dissertação) e
sobre o modelo Word da BU. Nenhuma fonte traz o texto exato para TCC de graduação: não confirmado. Área de
concentração é item de pós-graduação; se a graduação precisa dela, não está confirmado.

## 5 Formatação

| Item | Regra | Fonte |
|---|---|---|
| Papel | A4 (21 cm x 29,7 cm), branco | Manual p. 42 |
| Cor | texto em preto; cor só dentro de ilustração; título, fonte e legenda da ilustração em preto | Manual p. 42 |
| Face | só anverso, porque a entrega é digital; as margens de verso da NBR 14724, 5.1, não se aplicam | Manual p. 42 |
| Margens | esquerda e superior 3 cm; direita e inferior 2 cm | Manual p. 42 |
| Família | Arial ou Times New Roman, uma só no trabalho todo. A NBR 14724 não fixa família | Manual p. 42 |
| Tamanho 12 | todo o trabalho, inclusive capa, títulos de seção e títulos de ilustração e tabela | Manual p. 42, 51, 54 |
| Tamanho 10 | citação direta com mais de três linhas, paginação, notas de rodapé, dados de catalogação, legendas e fontes de ilustrações e tabelas | Manual p. 42. A NBR 14724, 5.1, diz "menor e uniforme"; o manual fixa 10 |
| Conteúdo de tabela | 10 ou 12, igual em todas as tabelas, espaçamento simples | Manual p. 54 |
| Entrelinha 1,5 | todo o texto, inclusive resumo, abstract, sumário, listas, glossário e títulos de ilustração e tabela | Manual p. 27, 30, 34, 38, 43, 51, 54 |
| Entrelinha simples | citação longa, notas de rodapé, legendas e fontes de ilustrações e tabelas, natureza do trabalho, referências | Manual p. 43 |
| Entre referências | uma linha em branco de espaço simples | Manual p. 43, 78; NBR 6023, 6.3 |
| Alinhamento | capa, folha de rosto e folha de aprovação centralizadas; natureza justificada; indicativos de seção à esquerda; texto justificado; referências à esquerda | Manual p. 43 |
| Parágrafo | recuo de 1,25 cm na primeira linha; 0 pt antes e depois | Manual p. 43, 45 |
| Citação longa | recuo de 4 cm da margem esquerda | Manual p. 43, 66 |
| Natureza do trabalho | recuo de 8 cm da margem esquerda | Manual p. 43 |
| Linhas órfãs e viúvas | evitar (em CSS: `orphans: 2; widows: 2`) | Manual p. 43 |
| Título e texto | separados por uma linha em branco de 1,5 | Manual p. 45-46 |
| Notas de rodapé | dentro das margens; separadas do texto por um espaço simples e por filete de 5 cm a partir da margem esquerda; 10; simples; da segunda linha em diante alinhadas sob a primeira letra da primeira palavra; sem espaço entre notas; nota de referência alinhada à esquerda, nota explicativa justificada; algarismos arábicos | Manual p. 44-45; NBR 14724, 5.2.1 |
| Numeração das notas | única e consecutiva no trabalho todo, sem reiniciar por página | Manual p. 44 |
| Equações | destacadas no texto; número entre parênteses alinhado à direita, "(1)"; entrelinha maior permitida; chamada "equação (1)" | Manual p. 60; NBR 14724, 5.7 |

A NBR 10520, 8.1 e 8.2, numera as notas por capítulo ou parte; o manual, p. 44, manda numeração única no
trabalho todo, e na p. 73 repete a recomendação da norma. Numerar no trabalho todo atende às duas, porque
nenhuma permite reiniciar a cada página.

A NBR 14724, 5.2, põe os títulos das ilustrações e tabelas em espaço simples. O manual manda 1,5 ("padrão
Udesc", p. 51 e 54). Vale o manual.

Nenhuma fonte define "entrelinha 1,5" em pontos. No Word, 1,5 linha multiplica a altura natural da linha da
fonte, que em Arial e Times New Roman é cerca de 1,15 em; com 12 pt isso dá cerca de 20,7 pt (estimativa).
Em CSS, `line-height: 1.5` dá 18 pt. Escolha um valor e use em todo o trabalho.

O modelo Word da BU tem margens erradas na seção textual (superior e inferior 2,5 cm, esquerda e direita
3 cm), número de página em 12 pt e cabeçalho a 1,25 cm da borda. Não copie medidas do .docx; vale o manual.

## 6 Paginação

- A contagem começa na folha de rosto, que é a página 1. A capa não conta (Manual p. 47; NBR 14724, 5.3).
- Os pré-textuais são contados e não exibem número (NBR 14724, 5.3; Manual p. 47).
- O número aparece a partir da primeira página da Introdução (Manual p. 47).
- Formato: algarismos arábicos, fonte 10, canto superior direito, a 2 cm da borda superior, com o último
  algarismo a 2 cm da borda direita (Manual p. 47, Fig. 21; NBR 14724, 5.3).
- Apêndices e anexos continuam a numeração do texto (NBR 14724, 5.3).
- Como não há ficha catalográfica, a exceção do verso da folha de rosto não se aplica.
- Consequência para o Chromium: o número exibido é a posição da página no PDF menos 1. Se a Introdução cair
  na página 12 do PDF, ela exibe "11". Um contador `page` que começa na capa sai deslocado em uma unidade.
- Não especificado: se os 2 cm se medem até o topo do algarismo ou até a linha de base. Com margem superior
  de 3 cm, o número fica dentro da margem.
- Não confirmado: se a Declaração de Versão Final, anexada como última página, recebe número.
- O `scripts/abnt-udesc.css` mede os 2 cm até o topo da caixa do algarismo (entrelinha 1 na caixa do número).
  O `scripts/conferir_pdf.py` confere a posição com tolerância de 3 pt.

## 7 Títulos

Hierarquia (Manual p. 48-49; a regra da primária é obrigatória, as das demais o manual "sugere"):

| Nível | Exemplo | Caixa | Destaque | Página |
|---|---|---|---|---|
| Primária | `<b>1 INTRODUÇÃO</b>` | maiúsculas | negrito | sempre nova, no topo da mancha |
| Secundária | `1.1 OBJETIVOS` | maiúsculas | nenhum | na sequência do texto |
| Terciária | `<b>1.1.1 Objetivo geral</b>` | só a inicial maiúscula | negrito | na sequência do texto |
| Quaternária | `<i>1.1.1.1 Primeira etapa</i>` | só a inicial maiúscula | itálico | na sequência do texto |
| Quinária | `1.1.1.1.1 Coleta` | só a inicial maiúscula | nenhum | na sequência do texto |

- Tudo em 12 (Manual p. 42). O indicativo acompanha o destaque do título, como no sumário modelo (Manual
  p. 35, Fig. 15) e nos títulos do próprio manual.
- Indicativo em algarismos arábicos, alinhado à esquerda, separado do título por um espaço de caractere, sem
  ponto, hífen, travessão ou outro sinal depois do número: "1 INTRODUÇÃO", não "1. INTRODUÇÃO" (Manual
  p. 45, 49; NBR 6024, 4.1).
- Título com mais de uma linha: da segunda linha em diante, alinhado sob a primeira letra da primeira palavra
  (Manual p. 45, 49; NBR 14724, 5.2.2). Em CSS, recuo deslocado do tamanho do indicativo.
- Primária: começa em página nova, no topo da mancha, separada do texto seguinte por uma linha de 1,5 em
  branco, 0 pt antes e depois (Manual p. 45).
- Secundária a quinária: separadas do texto anterior e do seguinte por uma linha de 1,5 em branco, 0 pt antes
  e depois (Manual p. 45, Fig. 19).
- No máximo até a quinária; primária em inteiros a partir de 1; toda seção tem texto próprio (Manual p. 49;
  NBR 6024, 4.1).
- A hierarquia tipográfica é idêntica no texto e no sumário (NBR 14724, 5.4; NBR 6024, 4.1 j).

Títulos sem indicativo numérico: errata, agradecimentos, listas, resumo, abstract, sumário, referências,
glossário, apêndices, anexos e índice. Ficam centralizados, em maiúsculas e negrito, como a primária;
começam em página nova, no topo da mancha, e ficam separados do texto por uma linha de 1,5 em branco
(Manual p. 46-47, Fig. 20; NBR 6024, 4.1 h).

Elementos sem título: folha de aprovação, dedicatória e epígrafe. Começam em página nova e não levam a
palavra "Dedicatória" ou "Epígrafe" (Manual p. 24, 26, 47).

Alíneas (Manual p. 50; NBR 6024, 4.2): texto anterior termina em dois-pontos; letra minúscula seguida de
parêntese, "a)"; letras recuadas em relação à margem esquerda; texto começa em minúscula e termina em ponto e
vírgula, a última em ponto final; se houver subalínea, a alínea termina em dois-pontos; segunda linha
alinhada sob a primeira letra do texto da alínea. Subalínea: começa por travessão e espaço (o exemplo do
manual usa hífen), recuada em relação à alínea, mesmas regras de pontuação.

## 8 Sumário

- Título "SUMÁRIO" centralizado, maiúsculas e negrito, como as seções primárias (Manual p. 46; NBR 6027,
  6.1).
- Último elemento pré-textual (Manual p. 33; NBR 6027, 4.1).
- Entram só os elementos que vêm depois dele: seções textuais e pós-textuais. Não entram dedicatória,
  agradecimentos, epígrafe, resumo, abstract e listas (Manual p. 34; NBR 6027, 6.3).
- Mesma ordem e mesma grafia do texto (Manual p. 33).
- Indicativos alinhados à esquerda; títulos alinhados pela margem do indicativo mais extenso; REFERÊNCIAS,
  APÊNDICE A `&ndash;` ..., ANEXO A `&ndash;` ... alinhados com os títulos e sem indicativo (Manual p. 34,
  Fig. 14; NBR 6027, 5.1-5.2).
- Cada item com o destaque do seu nível no texto: primária em maiúsculas e negrito, secundária em maiúsculas,
  terciária em negrito (Manual p. 35, Fig. 15; NBR 6027, 6.2).
- Linha pontilhada até o número da página, alinhado à margem direita; o número é o da primeira página da
  seção (Manual p. 35, Fig. 15; NBR 6027, 5.4 a).
- Entrelinha 1,5; mesma família e tamanho do texto (Manual p. 34).
- Em documento eletrônico, cada item com hyperlink para a seção (NBR 6027, 5.7, recomendação). Em HTML,
  `<a href="#secao">`; o Chromium preserva os links no PDF.

## 9 Ilustrações e tabelas

### Ilustrações (figuras, quadros, gráficos, fotografias, mapas, esquemas e outras)

- Citadas no texto e inseridas o mais perto possível do trecho; no texto, remeter em frase própria ou entre
  parênteses: "(Quadro 1)", "Na Figura 2 mostram-se" (Manual p. 51).
- Dentro das margens do texto; ilustração maior que a página vai em paisagem ou em apêndice ou anexo (Manual
  p. 51).
- Uma linha de 1,5 em branco entre o texto e o título da ilustração (Manual p. 51, Fig. 22).
- Título acima: palavra designativa sem negrito, número arábico de ordem, travessão e título; 12; 1,5;
  centralizado. Exemplo: `Quadro 1 &ndash; Porcentagem de absorção de água` (Manual p. 51-52; NBR 14724,
  5.8).
- Fonte abaixo, obrigatória mesmo quando o autor fez a ilustração; 10; simples; centralizada; chamada no
  formato da NBR 10520, com página: `Fonte: Allebrandt (2018, p. 91).` (Manual p. 52).
- Ilustração adaptada: `Fonte: Adaptado de Xxxxx (ano, p. x).` (Manual p. 52).
- Ilustração do autor: informar e dar o ano entre parênteses: `Fonte: Elaborada pelo autor (2026).` ou
  `Fonte: Elaborada pela autora (2026).` (Manual p. 53; NBR 14724, 5.8).
- Legenda, notas e outras informações vêm abaixo, depois da fonte (Manual p. 53; NBR 14724, 5.8).
- Tipo, número, título, fonte, legenda e notas devem respeitar as margens da ilustração (NBR 14724, 5.8,
  versão corrigida): o texto não passa da largura da imagem. Em CSS, `figure { display: table; margin: 0
  auto } figcaption { display: table-caption }` prende o título à largura da imagem.
- Duas ou mais ilustrações na mesma página: cada uma com título, número e fonte; ilustrações relacionadas
  podem ficar sob um título e uma fonte, com identificação de cada parte (Manual p. 53).
- O documento citado na fonte entra na lista de referências (Manual p. 52).

### Diferença entre quadro e tabela

- Quadro: conteúdo textual; bordas laterais fechadas. É ilustração e entra na lista de ilustrações (Manual
  p. 51, 53).
- Tamanho e entrelinha do conteúdo do quadro: o manual não define. As listas de exceções do tamanho 10
  (p. 42) e do espaçamento simples (p. 43) não incluem quadro, então valem as regras gerais: 12 e 1,5. É o
  que o `scripts/abnt-udesc.css` usa; a pergunta está em `perguntas-orientador.md`. A tabela fica em 12 e
  espaçamento simples, o padrão que a p. 54, alínea e, admite.
- Tabela: o dado numérico é a informação central; sem bordas laterais; não é ilustração e tem lista própria
  (Manual p. 53; NBR 14724, 3.32; IBGE 4.3.3).

### Tabelas (Manual p. 53-57; IBGE 1993; NBR 14724, 5.9)

- Título acima: "Tabela", número, travessão e título; 12; 1,5; centralizado (padrão Udesc, Manual p. 54).
  O IBGE pede que o título diga natureza, abrangência geográfica e temporal dos dados, por extenso (IBGE
  4.2).
- Cabeçalho obrigatório para as colunas (Manual p. 54; IBGE 4.4).
- Conteúdo em espaçamento simples, fonte 10 ou 12, igual em todas (Manual p. 54).
- Moldura sem traços verticais nas laterais; sem traços horizontais separando as linhas de dados (Manual
  p. 54). O IBGE exige no mínimo três traços horizontais: abaixo do topo (título), abaixo do cabeçalho e
  acima do rodapé (IBGE 4.3.1). Traços verticais internos só para destacar partes (IBGE 4.3.2).
- Fonte e notas abaixo, 10, simples, centralizadas (padrão Udesc, Manual p. 54). Tabela do autor:
  "elaborada pelo próprio autor" ou equivalente (NBR 14724, 5.9).
- Preferir uma página. Se passar: repetir título e cabeçalho em cada página, com "(continua)" na primeira,
  "(continuação)" nas do meio e "(conclusão)" na última, alinhados à direita (Manual p. 54).
- O IBGE, 8.3 e, põe o rodapé (fonte e notas) só na página de conclusão e o traço inferior só na página com
  a última linha (8.3 d). O exemplo do manual (Tabela 1, p. 55-57) repete a fonte em todas as páginas. O
  manual não regula isso em texto; o guia segue o exemplo do manual.
- Sinais convencionais do IBGE (4.8.1), explicados em nota: `-` zero absoluto; `..` não se aplica; `...`
  dado não disponível; `x` dado omitido para não individualizar; `0`, `0,0` zero por arredondamento.

### Listas de ilustrações e de tabelas

- Item: designação, número, travessão, título, linha pontilhada e página. Título com mais de uma linha: a
  segunda começa sob a primeira palavra do título; entrelinha 1,5 (Manual p. 30, Fig. 10).
- Regra própria da UDESC: lista específica por tipo (Lista de quadros, Lista de gráficos) só quando houver
  cinco ou mais itens daquele tipo. Abaixo disso, uma única "Lista de ilustrações", com todos os itens na
  ordem do texto, todos designados "Figura", sem distinguir fotografia, gráfico, quadro (Manual p. 29).
  Para a lista bater com o texto, a legenda no corpo também passa a "Figura"; o manual não diz isso de
  forma expressa: não confirmado. A NBR 14724, 4.2.1.9, só recomenda lista por tipo "quando necessário".
- Lista de tabelas: "Tabela", número, travessão, título e página (Manual p. 31; NBR 14724, 4.2.1.10).

## 10 Siglas

- Na primeira menção, forma por extenso seguida da sigla entre parênteses: "Universidade do Estado de Santa
  Catarina (Udesc)"; depois, só a sigla (Manual p. 32, 58; NBR 14724, 5.6).
- Sem pontos: "IML", não "I.M.L." (Manual p. 58).
- Plural com "s" minúsculo: "CPFs" (Manual p. 58).
- Até três letras: tudo maiúsculo, "ONU", "SC" (Manual p. 58).
- Mais de três letras pronunciáveis como palavra: só a inicial maiúscula, "Udesc", "Capes", "Unesco"
  (Manual p. 59).
- Mais de três letras soletradas: tudo maiúsculo, "IPTU", "BNDES" (Manual p. 59).
- Respeitar a forma oficial e a mistura de caixas criada para diferenciar: "ECT" e não "EBCT"; "CNPq"
  (Manual p. 58-59).
- Sigla estrangeira na forma original: "GPS" (Manual p. 59).
- Lista de abreviaturas e siglas: ordem alfabética, sigla seguida da forma por extenso (Manual p. 31-32,
  Fig. 12). A NBR 14724, 4.2.1.11, recomenda lista própria para cada tipo (uma de abreviaturas, outra de
  siglas); o manual não exige.
- A IN UDESC 002/2026 fixa a afiliação "Universidade do Estado de Santa Catarina (Udesc)" e proíbe variações
  como "Fundação Universidade do Estado de Santa Catarina" (art. 2º). Vale para publicações; para a capa,
  o manual manda `UNIVERSIDADE DO ESTADO DE SANTA CATARINA &ndash; UDESC` (Fig. 2).

## 11 Citações (NBR 10520:2023 no padrão da UDESC)

Regras gerais:

- Sistema de chamada: autor-data ou numérico, um só no trabalho todo (NBR 10520, 6; Manual p. 62). O
  numérico não pode ser usado quando houver notas (NBR 10520, 6.2.2). Recomendo autor-data: o manual dá
  todos os exemplos nele, e notas de rodapé ficam livres.
- Mudança de 2023: o sobrenome vai em maiúsculas e minúsculas, dentro e fora dos parênteses: "(Silva,
  2020)", não "(SILVA, 2020)". Sigla de entidade continua em maiúsculas: "(IBGE, 2011)" (NBR 10520,
  6.1.1.1-6.1.1.2).
- Entre parênteses, autor e data juntos; em citação direta, página ou localização depois da data (NBR
  10520, 6.1.3). Na frase, a data entre parênteses (6.1.4).
- O ponto final encerra a frase, não a citação: vem depois do parêntese da chamada (NBR 10520, 5.2 e
  7.1.2). O exemplo de citação longa do manual (p. 77) tem ponto antes e depois da chamada, mas a anotação
  da mesma figura diz "ponto final somente no final da sua frase, após a chamada de autor"; vale a norma.
- "et al." e "apud" em itálico nas chamadas (Manual p. 64, 68).
- Todo documento citado entra na lista de referências (Manual p. 61).

Exemplos no formato de 2023 (todos de NBR 10520:2023 ou do manual). Nos exemplos, `<i>` marca o itálico:

```text
Direta curta (até três linhas): entre aspas duplas; aspas simples para citação dentro da citação.
  “Texto texto texto” (Silva, 2020, p. 12).
  Conforme Silva (2020, p. 12), “texto texto texto”.
  Canuto (1999, p. 15) afirma que seu trabalho “[...] surgiu de uma paixão incontrolável”.
  Fontes: NBR 10520, 7.1; Manual p. 63-64.

Dois e três autores: ponto e vírgula dentro dos parênteses; “e” na frase.
  (Souza; Santos; Matos, 2020, p. 10)
  Souza, Santos e Matos (2020, p. 10)
  Fonte: Manual p. 64.

Quatro ou mais autores: o primeiro seguido de et al., ou todos; um só critério no trabalho.
  (Maciel <i>et al.</i>, 2020, p. 12)
  (Maciel; Brum; Del Bianco; Costa, 2020, p. 10)
  Maciel, Brum, Del Bianco e Costa (2019, p. 163)
  Fontes: NBR 10520, 6.1.2; Manual p. 64, 112.

Direta longa (mais de três linhas): parágrafo próprio, recuo de 4 cm, fonte 10, espaço simples, sem aspas,
uma linha de 1,5 em branco antes e depois; chamada no fim, ponto depois do parêntese.
  A teleconferência permite ao indivíduo participar de um encontro nacional ou regional sem a
  necessidade de deixar seu local de origem. [...] um sinal de áudio pode ser emitido em um salão
  de qualquer dimensão (Nichols, 1993, p. 181).
  Fontes: NBR 10520, 7.1.1; Manual p. 66.

Indireta: sem aspas; página opcional.
  Identificaram-se diversos estudos sobre o comportamento informacional dos usuários (Gonçalves, 2019).
  Silva (2020) explica que texto texto texto.
  Fontes: NBR 10520, 7.2; Manual p. 66-67.

Citação de citação: apud; na lista de referências só a obra consultada.
  Segundo Freire (1994, p. 13 <i>apud</i> Streck; Redin; Zitkoski, 2017, p. 25), “[...] a pedagogia do oprimido [...]”.
  Pela abordagem de Boss e Krauss (2007 <i>apud</i> Bender, 2014), as tecnologias [...].
  (Cagliari, 1986, p. 104 <i>apud</i> Suassuna, 1995, p. 55)
  Fontes: NBR 10520, 7.3; Manual p. 68 (o manual recomenda evitar apud).

Supressão: [...]
  “todos são iguais perante a lei, sem distinção de qualquer natureza [...]” (Brasil, 1988, p. 5).
Interpolação, acréscimo ou comentário: [ ]
  “Agora eu quero contar as [verdadeiras] histórias da beira do cais da Bahia” (Amado, 1936, p. 5).
Ênfase: negrito, itálico ou sublinhado no trecho, e “grifo nosso” ou “grifo próprio” como último elemento
da chamada; destaque que já está no original dispensa a indicação.
  “[...] verdadeiras ameaças à sociedade” (Souto, 1916, p. 46, grifo nosso).
Tradução: “tradução nossa” ou “tradução própria” como último elemento.
  (Olin, 2003, p. 21, tradução nossa)
  Segundo Brody e Harnad (2004, slide 2, tradução nossa, grifo nosso), “o acesso aberto [...]”.
  Fontes: NBR 10520, 5.2, 7.1.5, 7.1.6; Manual p. 69-70.

Mesma autoria e mesmo ano: letras minúsculas depois do ano, sem espaço, iguais às da lista de referências.
  (Reeside, 1927a)   De acordo com Reeside (1927b)
  (Brasil, 2005a)    (Brasil, 2005b)
  Fontes: NBR 10520, 6.1.6; Manual p. 71.

Mesma autoria, anos diferentes, citadas juntas: anos em ordem cronológica, separados por vírgula.
  (Dreyfuss, 1989, 1991, 1995)   Cruz, Correa e Costa (1998, 1999, 2000)
  Fonte: NBR 10520, 6.1.7.

Vários autores juntos: ponto e vírgula; ordem alfabética recomendada.
  (Cross, 1984; Knox, 1986; Mezirow, 1991)
  Fontes: NBR 10520, 6.1.8; Manual p. 72.

Mesmo sobrenome e mesmo ano: iniciais do prenome; se persistir, prenome por extenso.
  (Barbosa, C., 1958)   (Barbosa, O., 1958)   (Barbosa, Cássio, 1965)
  Fonte: NBR 10520, 6.1.5.

Entidade como autor: nome completo ou sigla, em maiúsculas e minúsculas; sigla em maiúsculas.
  (Organização Mundial da Saúde, 2010, p. xi)
  (IBGE, 2011, p. 3)
  Conforme a Organização para Cooperação e Desenvolvimento Econômico (2015, p. 18), “[...]”.
Órgão da administração direta: pela jurisdição.
  (Brasil, 1995)   na referência: BRASIL. Ministério da Administração Federal [...]
  Fontes: NBR 10520, 6.1.1.2-6.1.1.3.

Sem autoria: primeira palavra do título e [...]; artigo ou monossílabo inicial levam a palavra seguinte.
  (Inglês, 2012, p. 7)   (Anteprojeto [...], 1987, p. 55)   (A flor [...], 1995, p. 4)
  Fonte: NBR 10520, 6.1.1.4.

Documento sem paginação: só autor e data, ou a localização que o documento tiver.
  (Santos, 2005)   (Brasil, 1998, cap. V, art. 49, inc. I)   (Krenak, 2020, local. 53)
  (Cidade [...], 2002, 9 min 41 s)
  Fontes: NBR 10520, 6.1.3 e 7.1.4; Manual p. 74-75.
```

Informação verbal (palestra, discurso, comunicação, entrevista):

- A edição de 2023 não usa mais a expressão "(informação verbal)". O dado é indicado no texto ou em nota
  (NBR 10520, 5.3; Manual p. 70):

```text
No texto: Jadir dos Santos descreveu os principais aspectos da cultura organizacional¹.
Na nota:  ¹ Discurso proferido no auditório da ABNT, em 21 de março de 2019.

No texto: O Entrevistado 5 considera as bibliotecas comunitárias como iniciativas populares¹.
Na nota:  ¹ Entrevista de pesquisa concedida em 10 de março de 2020, na cidade do Rio de Janeiro.
```

- Entrevista ou depoimento não publicado não gera referência; o nome do entrevistado pode ser omitido:
  "(Entrevistado A)" (NBR 10520, 7.1.7).

Documento interno de empresa, sem publicação:

- A NBR 10520, 5.3, trata dados de fontes "não publicadas formalmente" como a informação verbal: indicação
  no texto ou em nota. A forma abaixo aplica essa regra a um documento interno. Nenhuma norma ou guia
  consultado traz exemplo de documento interno: não confirmado.

```text
No texto: O relatório comercial interno da Empresa X registra queda de 12% nas vendas em 2025¹.
Na nota:  ¹ Relatório de desempenho comercial 2025, documento interno da Empresa X, Florianópolis,
          consultado com autorização da empresa em 10 de agosto de 2026.
```

- Se o orientador pedir o documento na lista de referências, ver o modelo da seção 12. Para consultorias
  com organizações ligadas à ESAG (ESAG Jr., ESAG Ventures, Enactus, clubes de finanças), o Modelo de
  Estruturas exige autorização de uso dos dados atestada pela organização e pelo responsável do programa.

Documento em elaboração: mencionar o fato e dar os dados em nota (NBR 10520, 5.4).

Notas de referência: no sistema autor-data, use notas só como explicativas. As expressões Id., Ibid., op.
cit., loc. cit., passim, Cf. e et seq. só valem em notas e na mesma página da citação a que se referem; apud
pode ir no texto (NBR 10520, 8.1.2.2 e 8.1.3).

## 12 Referências (NBR 6023:2025 no padrão da UDESC)

Regras gerais:

- Lista única, no fim do trabalho, em ordem alfabética (Manual p. 37, 78; NBR 6023, 9.1).
- Espaço simples, alinhadas à esquerda, separadas entre si por uma linha em branco de espaço simples. Sem
  recuo deslocado (Manual p. 78, Fig. 23; NBR 6023, 6.3).
- Título com destaque (negrito ou itálico), o mesmo em todas. O subtítulo e a pontuação não recebem destaque.
  Obra sem autoria entra pelo título, com a primeira palavra em maiúsculas (incluído artigo ou monossílabo
  inicial), e esse título não leva destaque (Manual p. 79, 119; NBR 6023, 6.7). Recomendo negrito, o
  destaque de todos os exemplos do manual.
- Autor pessoa: último sobrenome em maiúsculas, prenomes por extenso ou abreviados, um só critério na lista;
  autores separados por ponto e vírgula e espaço (Manual p. 112; NBR 6023, 8.1.1).
- Até três autores, todos. Quatro ou mais: todos, ou o primeiro seguido de *et al.* (Manual p. 112, que
  cita a NBR 6023:2025; o guia Unicamp de 2025 transcreve a mesma regra da 6023:2018, 8.1.1.2).
- Entidade: nome por extenso ou sigla, em maiúsculas; órgão da administração direta precedido da jurisdição,
  "BRASIL. Ministério da Educação." (Manual p. 116-117).
- "In:" e "et al." em itálico; "[S. l.]", "[s. n.]" e "[S. l.: s. n.]" em itálico, entre colchetes, quando
  faltam local ou editora (Manual p. 88, 111, 124-125; NBR 6023, 7.7.6 e 7.20).
- Edição só a partir da segunda: "2. ed." (guia Unicamp, p. 7).
- Documento online: "Disponível em:" e "Acesso em:" no fim, sempre; DOI antes, quando houver: "DOI:
  https://doi.org/..." (NBR 6023, 6.6, 7.7.6, 8.13; Manual p. 88).
- Meses abreviados (jan., fev., mar., abr., maio, jun., jul., ago., set., out., nov., dez.) (Manual p. 127,
  Quadro 5).
- Notas complementares, como "Documento interno.", vão no fim, em português e sem destaque (NBR 6023,
  8.11.3; Manual p. 132).

Modelos:

```html
<!-- Livro (Manual p. 79) -->
GIL, Antônio Carlos. <b>Como elaborar projetos de pesquisa</b>. 4. ed. São Paulo: Atlas, 2002.

<!-- Livro com subtítulo (NBR 6023:2025, 7.1.1, exemplo 2) -->
BAUMAN, Zygmunt. <b>Globalização</b>: as conseqüências humanas. Rio de Janeiro: Jorge Zahar, 1999.

<!-- Livro com quatro ou mais autores (Manual p. 80) -->
TAYLOR, Robert <i>et al.</i> <b>Reabilitação e fisioterapia na prática de pequenos animais</b>. São Paulo: Roca, 2008.

<!-- Capítulo de livro (Manual p. 83; o exemplo do manual omite o ponto depois do segundo "Agatti") -->
LÜDORF, Sílvia Maria Agatti. O projeto de pesquisa. <i>In</i>: LÜDORF, Sílvia Maria Agatti. <b>Metodologia da pesquisa</b>: do projeto ao trabalho de conclusão de curso. 2. ed. Curitiba: Appris, 2017. p. 40-45.

<!-- Artigo de periódico impresso (Manual p. 88) -->
PIZARRO, D. C. <i>et al.</i> O discurso dos ingressantes nos cursos de Biblioteconomia de Santa Catarina: suas motivações para a escolha do curso. <b>Revista ACB</b>, Florianópolis, v. 20, n. 3, p. 423-438, set./dez. 2015.

<!-- Artigo online com DOI (Manual p. 88) -->
CUNHA, Murilo Bastos da. Das bibliotecas convencionais às digitais: diferenças e convergências. <b>Perspectivas em Ciência da Informação</b>, Belo Horizonte, v. 13, n. 1, p. 2-17, abr./jun. 2008. DOI: https://doi.org/10.1590/S1413-99362008000100002. Disponível em: http://www.scielo.br/pdf/pci/v13n1/v13n1a02.pdf. Acesso em: 9 abr. 2020.

<!-- Artigo online com número eletrônico no lugar de páginas (NBR 6023:2025, 7.7.6, exemplo 8) -->
MOURA, L. R.; TORRES, L. M.; CADETE, M. M. M.; CUNHA, C. F. Fatores associados aos comportamentos de risco à saúde entre adolescentes brasileiros: uma revisão integrativa. <b>Revista da Escola de Enfermagem da USP</b>, São Paulo, v. 52, e03304, 2018. DOI: https://doi.org/10.1590/S1980-220X2017020403304. Disponível em: https://www.scielo.br/j/reeusp/a/JvyjzY4B4b7f9P5TLyLpPFK/abstract/?lang=pt. Acesso em: 7 abr. 2023.

<!-- Site institucional (Manual p. 111) -->
UDESC. <b>Biblioteca Universitária</b>. Florianópolis: UDESC, c2016. Disponível em: https://www.udesc.br/bu. Acesso em: 9 abr. 2020.

<!-- Matéria em site de notícias (NBR 6023:2025, 7.20, exemplo 10) -->
VELOSO, N.; PIMENTEL, J. Brasil teve 5 ataques com mortes em escolas em 2022 e 2023. <b>Poder 360</b>, 6 abr. 2023. Disponível em: https://www.poder360.com.br/brasil/brasil-teve-5-ataques-com-mortes-em-escolas-em-2022-e-2023/. Acesso em: 23 abr. 2024.

<!-- Documento institucional ou de empresa (Manual p. 116-118) -->
PETROBRAS. <b>Biocombustíveis</b>: 50 perguntas e respostas sobre este novo mercado. Rio de Janeiro: PETROBRAS, 2007.
BRASIL. Ministério da Educação. <b>Educação profissional</b>. Brasília, DF: IBS, 2000.
UNIVERSIDADE DO ESTADO DE SANTA CATARINA. <b>Estrutura organizacional</b>. Florianópolis: UDESC, c2016. Disponível em: https://www.udesc.br/sobre/organograma. Acesso em: 26 maio 2020.

<!-- Legislação online: destaque na epígrafe (Manual p. 97) -->
BRASIL. <b>Lei nº 11.899, de 8 de janeiro de 2009</b>. Institui o Dia Nacional da Leitura e a Semana Nacional da Leitura e da Literatura. Brasília, DF: Presidência da República, 2009. Disponível em: http://www.planalto.gov.br/ccivil_03/_Ato2007-2010/2009/Lei/L11899.htm. Acesso em: 15 dez. 2018.

<!-- Legislação publicada no Diário Oficial: destaque no título do diário (NBR 6023:2025, 7.11.1, exemplo 3) -->
BRASIL. Lei nº 10.406, de 10 de janeiro de 2002. Institui o Código Civil. <b>Diário Oficial da União</b>: seção 1, Brasília, DF, ano 139, n. 8, p. 1-74, 11 jan. 2002.

<!-- Constituição (Manual p. 97) -->
BRASIL. [Constituição (1988)]. <b>Constituição da República Federativa do Brasil de 1988</b>. Brasília, DF: Presidência da República, 1988. Disponível em: http://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm. Acesso em: 11 dez. 2018.

<!-- Trabalho acadêmico: TCC (Manual p. 82; NBR 6023:2025, 7.1.2) -->
SABADIN, Karina. <b>Avaliação da conservação de bebida isotônica elaborada com conservante e diferentes estabilizantes</b>. 2019. Trabalho de Conclusão de Curso (Bacharelado em Engenharia de Alimentos) &ndash; Centro de Educação Superior do Oeste, Universidade do Estado de Santa Catarina, Pinhalzinho, 2019.

<!-- Trabalho acadêmico online: dissertação (Manual p. 83) -->
NASCIMENTO, A. L. do. <b>Características físico-químicas e microbiológicas de queijo colonial artesanal de leite cru obtido de vacas jerseys suplementadas com óleos essenciais</b>. 2024. Dissertação (Pós-Graduação Acadêmico em Zootecnia) &ndash; Centro de Educação Superior do Oeste, Universidade do Estado de Santa Catarina, Chapecó, 2024. Disponível em: https://repositorio.udesc.br/handle/UDESC/1219. Acesso em: 17 jun. 2025.

<!-- Norma técnica (Manual p. 116) -->
ASSOCIAÇÃO BRASILEIRA DE NORMAS TÉCNICAS. <b>ABNT NBR 14724</b>: informação e documentação: trabalhos acadêmicos: apresentação. Rio de Janeiro: ABNT, 2024.

<!-- Obra sem autoria: título sem destaque (Manual p. 119) -->
DIAGNÓSTICO médico computadorizado. Curitiba: Conselho Regional de Medicina, 2016.

<!-- Documento interno sem publicação: modelo montado com NBR 6023:2025, 7.1.1 e 8.11.3; não confirmado -->
EMPRESA X. <b>Relatório de desempenho comercial 2025</b>. Florianópolis: Empresa X, 2025. Documento interno.
```

Trabalho acadêmico: elementos são autor, título, subtítulo, ano de depósito, tipo do trabalho, grau e curso
entre parênteses, vinculação acadêmica, local e data da defesa (NBR 6023, 7.1.2). Os exemplos do manual
põem o centro antes da universidade (p. 82).

## 13 Resumo e abstract

Resumo na língua vernácula (Manual p. 26-28; NBR 6028:2021, 4.1):

- Extensão: 150 a 500 palavras (NBR 6028, 4.1.8 a; Manual p. 27).
- Parágrafo único, sem recuo na primeira linha, sem enumeração de tópicos (NBR 6028, 4.1.2; Manual p. 26).
- Começa com frase que apresenta o tema principal; traz natureza do trabalho, objetivo, método, resultados e
  conclusões; resumo informativo (Manual p. 26; NBR 6028, 4.1.3).
- Voz e pessoa: o manual pede voz ativa e, de preferência, terceira pessoa do singular (p. 27); a NBR 6028,
  4.1.4, só diz "convém usar o verbo na terceira pessoa". Vale o manual.
- Evitar: frases negativas, abreviaturas, fórmulas, diagramas, quadros, equações, símbolos e contrações fora
  do uso comum, repetição literal de trechos do trabalho (Manual p. 27; NBR 6028, 3.3).
- No TCC, a referência do trabalho não vem antes do resumo; só entra quando o resumo é publicado à parte
  (Manual p. 27-28).
- Título "RESUMO" centralizado no alto da página, maiúsculas e negrito; uma linha de 1,5 em branco; texto
  justificado em 1,5; uma linha de 1,5 em branco; palavras-chave (Manual p. 27-28, Fig. 9).
- Palavras-chave: logo abaixo do resumo; a expressão "Palavras-chave:" em negrito, com inicial maiúscula;
  as palavras em minúsculas, salvo nomes próprios e científicos; separadas por ponto e vírgula; ponto final
  no fim; de três a cinco (Manual p. 27; NBR 6028, 4.1.7). A Figura 9 do manual mostra as palavras com
  inicial maiúscula, contra o próprio texto; vale o texto.

```html
<p class="palavras-chave"><b>Palavras-chave:</b> gestão comercial; funil de vendas; pequenas empresas; Santa Catarina.</p>
```

Resumo em língua estrangeira (Manual p. 28; NBR 14724, 4.2.1.8):

- Obrigatório em todo TCC; versão do resumo para idioma de divulgação internacional, em página própria, com a
  mesma formatação do resumo.
- Título "ABSTRACT" e expressão "Keywords:" para o inglês: convenção de uso, não confirmada no manual, que
  não traz modelo de abstract.

## 14 Modelo ESAG

A ESAG não publica modelo de formatação próprio. O site da Coordenação de Estágios remete ao manual da BU, e
a BU oferece o modelo Word e um pacote LaTeX (https://www.udesc.br/arquivos/udesc/id_cpmenu/12501/PacotesBasicos_17278041300861_12501.zip,
não aberto). O que a ESAG exige:

- Seguir o Manual de Trabalhos Acadêmicos da UDESC, formato A4 (Regulamento, "Do formato do TCC"; Modelo de
  Estruturas).
- Composição mínima por modalidade (Modelo de Estruturas, Quadro 1):

| Modalidade | Seções mínimas |
|---|---|
| I: pesquisa com dados primários | Introdução; Fundamentação Teórica; Procedimentos Metodológicos; Descrição e Análise dos Dados; Conclusões e/ou Recomendações |
| II: pesquisa com dados secundários | as mesmas da modalidade I |
| III: planos e projetos | Plano: Introdução; Contextualização; Metodologia utilizada para o desenvolvimento do Plano de Negócios; Desenvolvimento das Etapas do Plano de Negócios; Conclusões. Projeto: Introdução; Contextualização; Metodologia utilizada para o desenvolvimento do Projeto; Desenvolvimento das Etapas do Projeto; Conclusões |
| IV: consultoria | Introdução; Contextualização; Caracterização da organização/comunidade; Metodologia utilizada para o desenvolvimento da Consultoria; Desenvolvimento das etapas da consultoria; Conclusões e/ou Recomendações |
| V (numerada "VI" no PDF): novos produtos, serviços e protótipos | Introdução; Contextualização; Metodologia utilizada para o desenvolvimento; Desenvolvimento das etapas da Inovação; Conclusões e/ou Recomendações |

- O Modelo de Estruturas pula de IV para VI; o formulário de avaliação chama a mesma modalidade de V.
- Uso de inteligência artificial: permitido de forma ética, e todo uso deve ser explicado na parte
  metodológica (Regulamento, "Do formato do TCC").
- Avaliação só pelo orientador, pelos critérios do formulário (modalidades I e II: exposição do assunto,
  fundamentação teórica, procedimentos metodológicos, descrição dos dados, análise dos dados); nota mínima
  7,0 (Regulamento, Anexo 1).
- Plágio comprovado reprova sem recurso (Regulamento, "Do plágio").
- Cronograma 2026/2: até 16/11, enviar a cest.esag@udesc.br, com cópia ao orientador, o TCC em PDF
  (arquivo "Nome do aluno(a)_TCC ADM"), o formulário de avaliação em Word e a Declaração de Responsabilidade
  e Ausência de Plágio. Até 10/12, depositar no Repositório Institucional a versão final aprovada em PDF, com
  a Declaração de Versão Final e Autorização para Publicação, assinada por aluno e orientador, como última
  página.
- Formato do arquivo no Repositório: PDF/A com marcas estruturais do documento, para acessibilidade (IN UDESC
  002/2025, art. 4º; Manual p. 141). O `scripts/paginar.js` gera o PDF marcado pelo Chromium (opção
  `tagged` do Playwright), mas não PDF/A; a conversão para PDF/A fica para outra ferramenta, que precisa
  manter as marcas (PDF/A de nível "a"). O `scripts/conferir_pdf.py` acusa PDF sem marcas.
