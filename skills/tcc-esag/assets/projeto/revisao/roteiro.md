# Roteiro da revisão independente

Quem escreveu o texto não enxerga os próprios furos. Por isso cada revisão roda num agente novo (subagente
ou sessão nova), que lê o `tcc.html` sem ter participado da escrita, grava o relatório em
`revisao/revisao-vN.md` e não edita o `tcc.html`. O autor decide quais achados aceitar, e só então o texto
muda.

Rode uma revisão quando um bloco de seções fica pronto e outra antes da entrega.

## Pedido para o agente revisor

Copie, troque N e as seções:

```text
Revise as seções [X a Y] do tcc.html deste repositório, um trabalho da ESAG/UDESC no modelo
{{MODELO_NOME}}. Leia antes AGENTS.md, decisoes.md, normas/referencias-em-uso.md, o
material de levantamento/ e revisao/roteiro.md. Aplique cada item da lista do roteiro, sem exceção.
Confira cada fato do texto contra levantamento/ e cada afirmação de obra contra
normas/referencias-em-uso.md. Não edite o tcc.html. Grave em revisao/revisao-vN.md os achados numerados,
do mais grave ao menos grave, cada um com: o trecho (seção e as primeiras palavras), o problema, por que
importa (o critério do formulário ou a regra, com a fonte) e a correção sugerida. Termine com a contagem
de achados por gravidade.
```

## Lista da revisão

Cada item nasceu de um achado real em revisões de TCC.

{{ROTEIRO_CRITERIOS}}

Contra os fatos:

- Cada fato confere com `levantamento/`; cada afirmação de obra confere com o que a obra diz, sem ir além
  da fonte.
- Cada número tem unidade, data e fonte, e nenhum revela dado sigiloso sem autorização.
- O texto diz quem fez o trabalho e dá crédito a quem propôs cada ideia, sem apagar colegas.
- Cada termo central (cliente, contrato, o nome de cada indicador) tem uma definição só, usada sempre do
  mesmo jeito.

Contra as normas (`normas/abnt-udesc.md`):

- Chamadas no padrão autor-data de 2023, "(Silva, 2020, p. 12)"; citação direta com página.
- Toda obra citada está nas referências e toda referência está citada.
- Documento interno e conversa indicados no texto ou em nota, sem entrar nas referências.
- Siglas por extenso na primeira menção.
- Ilustrações citadas no texto e perto do trecho, com título acima e fonte abaixo, e a regra dos cinco
  itens por tipo.

Contra a redação:

- Frases de efeito no fim do parágrafo, frases que só anunciam o que vem, repetições entre seções.
- Hedges e verbos que diminuem o papel do autor ("ajudou a", "contribuiu para") onde ele fez.
- Registro formal, voz definida em `decisoes.md`, sem cara de texto gerado.
- Termos estrangeiros com o mesmo destaque em todo o texto. O manual não regula; é convenção de redação.

Depois que o autor decidir, marque no relatório quais achados foram aceitos e aplicados.
