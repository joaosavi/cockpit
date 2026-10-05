#!/usr/bin/env python3
"""Cria um projeto de TCC de Administração da ESAG/UDESC, com a formatação pronta, para o autor só escrever.

Uso:
    python3 novo_projeto.py <pasta-nova> --modelo tcc-iv
    python3 novo_projeto.py --modelos          lista os modelos

Copia o motor de formatação (CSS, scripts, verificadores, cópia do Google Docs), as normas, os links oficiais
e os arquivos de trabalho (AGENTS.md, HANDOFF.md e os demais) para a pasta nova, e escreve o tcc.html com as
seções que a modalidade exige. Só cria em pasta nova ou vazia.
"""
import argparse
import os
import shutil
import sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJETO = os.path.join(SKILL, "assets", "projeto")
CORPOS = os.path.join(SKILL, "assets", "modelos")
sys.path.insert(0, os.path.join(PROJETO, "scripts"))
from modelos import MODELOS, NATUREZA_TCC  # noqa: E402

CAPA_CABECALHO = """    <p>Universidade do Estado de Santa Catarina &ndash; UDESC</p>
    <p>Centro de Ciências da Administração e Socioeconômicas &ndash; ESAG</p>
    <p>Curso de Administração Empresarial</p>"""

COMO_ESCREVER_IV = """- As seis seções primárias têm os nomes e a ordem do modelo da Modalidade IV: 1 Introdução, 2
  Contextualização, 3 Caracterização da organização, 4 Metodologia utilizada para o desenvolvimento da
  consultoria, 5 Desenvolvimento das etapas da consultoria, 6 Conclusões e recomendações.
- O fio: cada objetivo específico é uma ação da consultoria (estruturar, implantar, conferir, avaliar),
  vira uma etapa na seção 4, uma subseção na 5 e recebe resposta na 6. O formulário de avaliação dá nota ao
  "cumprimento das etapas previstas na metodologia e o atingimento dos objetivos esperados".
- O diagnóstico mede o antes por uma régua tirada da literatura, e os resultados medem o depois pela mesma
  régua, com as mesmas linhas.
- O antes é de antes da consultoria; dado medido durante o trabalho entra datado. Número que revela o porte
  da organização entra só com autorização dela, registrada em `decisoes.md`.
- Pessoas da organização aparecem pelo cargo. O texto separa o que o autor fez do que a equipe fez e dá
  crédito a quem propôs cada ideia."""

ARMADILHAS_TCC = """- O TCC aprovado fica público no Repositório Institucional da UDESC; escreva tudo como texto público. A
  Declaração de Versão Final permite acesso embargado por até 12 meses ou restrito, para dado sigiloso, e
  essa escolha exige também a declaração do Anexo II da IN 014/2024 (`fontes/fontes-oficiais.md`, seção 3).
- O Repositório pede PDF/A com marcas estruturais (Manual p. 141). O motor gera o PDF marcado, mas não
  PDF/A: a conversão da versão final passa por outra ferramenta e precisa manter as marcas (PDF/A de
  nível "a"). A última página do PDF final é a Declaração de Versão Final e Autorização para Publicação,
  assinada pelo autor e pelo orientador.
- A ficha de avaliação que vai no e-mail de entrega é o "{ficha}". O cronograma ainda o chama de
  "Formulário para Avaliação do Relatório de Estágio Obrigatório".
- A Declaração de Responsabilidade e Ausência de Plágio ainda fala em "Relatório Final de Estágio II".
  Pergunte à Coordenadoria de Estágios como adaptar o texto ao TCC antes de assinar.
- A página da Coordenadoria manda o TCC ao orientador com cópia à coordenação; o cronograma manda à
  coordenação com cópia ao orientador e acrescenta a Declaração. Siga o cronograma, que é mais completo.
- O nome do centro está confirmado ("Centro de Ciências da Administração e Socioeconômicas", site da ESAG
  e Repositório). O nome do curso não: o PPC diz "Administração"; o site, o cronograma e o Repositório dizem
  "Administração Empresarial", que é o que o modelo usa. A redação da natureza na folha de rosto também não
  tem modelo oficial para graduação. Confirme os dois com a Coordenadoria de Estágios.
"""

ARMADILHAS_IV = """- Consultoria ligada à ESAG Jr., à ESAG Ventures, à Enactus ou a clube de finanças exige comprovação da
  participação do autor, autorização de uso dos dados pelas organizações e atestado do responsável pelo
  programa na ESAG (regulamento, Quadro 1, Modalidade IV).
"""



ROTEIRO_IV = """Contra os critérios do formulário da Modalidade IV:

- A pergunta promete só o que a consultoria entregou. Se algo continua manual, a pergunta e a conclusão
  dizem isso.
- Os objetivos específicos são ações da consultoria, e não ações do texto.
- Cada objetivo vira uma etapa na seção 4, uma subseção na 5 e uma resposta na 6. Nenhuma etapa aparece
  só na conclusão.
- A seção 5 segue as etapas do quadro da seção 4, na mesma ordem e com os mesmos nomes.
- A Metodologia diz por que o caminho servia ao contexto e o que cada etapa devia entregar, além de narrar
  o percurso.
- O diagnóstico liga os sintomas numa cadeia de causas, e a síntese mostra essa ligação.
- O problema está delimitado: o que entra e o que fica fora do escopo.
- A Justificativa diz o que o caso acrescenta, sem repetir o diagnóstico.
- A conclusão responde à pergunta e cobre cada objetivo, sem informação nova.
- O antes é de antes da consultoria; dado medido durante o trabalho está datado.
- Quem faz cada passo de cada processo está dito, no antes e no depois."""

PERGUNTAS_TCC = [
    "Como o texto deve se referir ao autor: \"o autor\", voz impessoal ou primeira pessoa?",
    "O nome da organização, das pessoas e os números internos podem aparecer? Que forma de autorização ele "
    "espera, já que o TCC fica público no Repositório?",
    "Documentos internos e entrevistas entram indicados no texto, em nota de rodapé, em apêndice ou numa lista "
    "de documentos consultados?",
    "Há um mínimo de referências? O regulamento não fixa nenhum.",
    "Telas de sistemas e fotografias podem entrar como figuras? Com dados borrados?",
    "A folha de aprovação entra? Ela é opcional na UDESC, e o regulamento põe a avaliação só com o orientador.",
    "Que extensão de resumo ele prefere, dentro dos 150 a 500 palavras da NBR 6028?",
    "Como descrever o uso de IA na metodologia, que o regulamento exige?",
    "Ele quer ver seções parciais antes da entrega? Em que datas?",
    "Capa e folha de rosto: o curso é \"Administração\" (PPC) ou \"Administração Empresarial\" (site e "
    "cronograma)? A redação da natureza do trabalho serve?",
    "Com menos de cinco ilustrações de um tipo, o manual chama os itens da lista de \"Figura\" (p. 29). A "
    "legenda no corpo também vira \"Figura\", ou fica o nome do tipo?",
    "O manual não define tamanho nem entrelinha do conteúdo de quadro. O modelo usa a regra geral, 12 e 1,5. "
    "Ele aceita, ou prefere outro padrão, igual em todos os quadros?",
]
PERGUNTAS_APLICADO = [
    "Quanta fundamentação teórica ele espera dentro da Contextualização, já que o formulário desta modalidade "
    "não tem critério de Fundamentação Teórica?",
    "Que nível de detalhe ele quer nas datas das etapas?",
]
PERGUNTAS_PESQUISA = [
    "Os instrumentos de coleta (questionário, roteiro de entrevista) vão em apêndice?",
    "A coleta com pessoas precisa passar por comitê de ética? Se sim, com que antecedência?",
]
PERGUNTAS_IV = [
    "Se a consultoria foi na ESAG Jr., na ESAG Ventures, na Enactus ou num clube de finanças: como entregar a "
    "comprovação de participação, a autorização de uso dos dados e o atestado que o regulamento pede?",
]


def perguntas(chave):
    lista = PERGUNTAS_TCC + (PERGUNTAS_PESQUISA if chave in ("tcc-i", "tcc-ii") else PERGUNTAS_APLICADO)
    if chave == "tcc-iv":
        lista = lista + PERGUNTAS_IV
    itens = "\n".join(f"{i}. {q}" for i, q in enumerate(lista, start=1))
    return ("# Perguntas para o orientador\n\nDúvidas que só o orientador resolve. Anote a resposta embaixo de cada "
            "uma, com a data, e mova a pergunta para \"Respondidas\".\n\n## Abertas\n\n" + itens +
            "\n\n## Respondidas\n\n(nenhuma ainda)\n")


DECISOES_IV = """
## Específicas da consultoria

<!-- O período da consultoria; a régua do diagnóstico (a obra que define o estado bom); os processos de antes
     e de depois, passo a passo; quem propôs cada ideia. -->
"""



def roteiro_criterios(chave, modelo):
    if chave == "tcc-iv":
        return ROTEIRO_IV
    itens = "\n".join(f"- {c}" for c in modelo["criterios"])
    return (f"Contra os critérios do \"{modelo['ficha']}\", cada um com o trecho do texto onde ganha nota:\n\n"
            f"{itens}\n- A conclusão responde à pergunta e cobre cada objetivo, sem informação nova.")


def ficha(chave):
    linhas = ["Autor", "Tema, em uma frase"]
    if chave == "tcc-iv":
        linhas += ["Organização atendida", "Posição do autor na organização (consultor externo, estagiário, funcionário)",
                   "Consultoria ligada à ESAG Jr., ESAG Ventures, Enactus ou clube de finanças (sim ou não)"]
    linhas += ["Orientador", "Semestre de entrega"]
    return "\n".join(f"- {l}: [PREENCHER]" for l in linhas)


def como_escrever(chave, modelo):
    if chave == "tcc-iv":
        return COMO_ESCREVER_IV
    secoes = ", ".join(f"{i} {nome}" for i, (nome, _) in enumerate(modelo["secoes"], start=1))
    criterios = "\n".join(f"  {i}. {c}" for i, c in enumerate(modelo["criterios"], start=1))
    return (f"- As seções primárias têm os nomes e a ordem do modelo do regulamento: {secoes}. O título de cada\n"
            f"  uma é o do regulamento; as subseções são livres.\n"
            f"- O orientador avalia pelo \"{modelo['ficha']}\", com nota de 0 a 10 em cada critério, e a média é a\n"
            f"  nota final, mínima 7,0:\n{criterios}\n"
            "- O fio: cada objetivo específico recebe resposta na conclusão, e cada etapa prometida no método aparece\n"
            "  no desenvolvimento.")


def preencher(texto, valores):
    for k, v in valores.items():
        # Marcador vazio sozinho na linha some com a linha, para não partir uma tabela ao meio.
        texto = texto.replace("{{" + k + "}}\n", v + "\n" if v else "").replace("{{" + k + "}}", v)
    if "{{" in texto:
        sys.exit("Marcador sem valor no modelo: " + texto[texto.index("{{"):texto.index("{{") + 40])
    return texto


def corpo_generico(modelo):
    partes = ["<!-- ===================== CORPO ===================== -->",
              "<!-- As seções primárias e os nomes delas são os do modelo. Mantenha. -->", ""]
    for i, (nome, _) in enumerate(modelo["secoes"], start=1):
        partes.append(f'<h1><span class="ind">{i}</span> <span class="tit">{nome}</span></h1>\n')
        if i == 1:
            partes.append('<p class="pendente">[PREENCHER: o tema, o problema ou a pergunta, o objetivo e a '
                          'justificativa.]</p>\n')
        else:
            partes.append(f'<p class="pendente">[PREENCHER: texto da seção {nome.lower()}.]</p>\n')
    return "\n".join(partes) + "\n"


def documento(chave, modelo):
    if chave == "tcc-iv":
        corpo = open(os.path.join(CORPOS, "corpo-tcc-iv.html"), encoding="utf-8").read()
    else:
        corpo = corpo_generico(modelo)
    natureza = NATUREZA_TCC
    quem = "Orientador: [PREENCHER: Prof. Dr. Nome Completo, ou Prof.ª Dra. para orientadora]."
    abstract = """
<section>
<h1 class="pre">Abstract</h1>
<p class="semrec resumo pendente">[PREENCHER: tradução do resumo para o inglês, com a mesma formatação.]</p>
<p class="semrec palavras-chave"><strong>Keywords:</strong> [PREENCHER: as palavras-chave em inglês].</p>
</section>
"""
    secao_lista = """<section class="listas">
<h1 class="pre">Lista de ilustrações</h1>
<div class="lista-ilustracoes sumario">
</div>
</section>"""
    regra_lista = """Com menos de cinco ilustrações de um tipo, o manual chama os itens da lista única de "Figura" (p. 29). A partir de
     cinco do mesmo tipo, esse tipo ganha lista própria: uma seção igual, com data-tipo="Quadro" no div."""
    if chave == "tcc-iv":
        lista_ilus = f"<!-- {regra_lista} -->\n{secao_lista}"
    else:
        lista_ilus = (f"<!-- Lista de ilustrações: tire esta seção do comentário quando o texto tiver a primeira ilustração.\n"
                      f"     {regra_lista}\n{secao_lista} -->")
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="modelo" content="{chave}">
<title>TCC [PREENCHER: sobrenome] - [PREENCHER: tema curto]</title>
<!-- A formatação está toda em scripts/abnt-udesc.css. Este arquivo guarda só o texto. -->
<link rel="stylesheet" href="scripts/abnt-udesc.css">
</head>
<body>

<!-- Modelo: {modelo['nome']}.
     Troque cada marcador PREENCHER pelo texto do seu trabalho. O scripts/checar.py lista os que faltam.
     Não preencha o Sumário nem as listas à mão, e não ponha id nos títulos: o scripts/montar.py faz isso.
     O scripts/teste/exemplo-elementos.html mostra como marcar cada elemento. -->

<!-- ===================== CAPA ===================== -->
<section class="capa">
  <div>
{CAPA_CABECALHO}
  </div>
  <p class="autor">[PREENCHER: nome completo do autor]</p>
  <p class="titulo">[PREENCHER: título do trabalho]: <span class="sub">[PREENCHER: subtítulo]</span></p>
  <div class="local"><p>Florianópolis</p><p>[PREENCHER: ano da entrega]</p></div>
</section>

<!-- ===================== FOLHA DE ROSTO ===================== -->
<section class="rosto">
  <p class="autor">[PREENCHER: nome completo do autor]</p>
  <p class="titulo">[PREENCHER: título do trabalho]: <span class="sub">[PREENCHER: subtítulo]</span></p>
  <div class="natureza">
    <p>{natureza}</p>
    <p>{quem}</p>
  </div>
  <div class="local"><p>Florianópolis</p><p>[PREENCHER: ano da entrega]</p></div>
</section>

<!-- ============ PRÉ-TEXTUAIS ============ -->
<div class="pretextual">

<section>
<h1 class="pre">Resumo</h1>
<p class="semrec resumo pendente">[PREENCHER: escreva por último, com o texto fechado. De 150 a 500 palavras, parágrafo único, voz ativa e terceira pessoa. Abra com o tema; traga a natureza do trabalho, o objetivo, o método, os resultados e as conclusões.]</p>
<p class="semrec palavras-chave"><strong>Palavras-chave:</strong> [PREENCHER: de três a cinco palavras-chave em minúsculas, separadas por ponto e vírgula, com ponto final].</p>
</section>
{abstract}
{lista_ilus}

<!-- Lista de tabelas: quando o corpo tiver tabela, crie aqui uma seção igual à Lista de ilustrações, com o
     título "Lista de tabelas" e o bloco div de classe "lista-tabelas sumario". -->

<!-- Opcional. Só siglas que aparecem no texto, em ordem alfabética. Apague a seção se não houver siglas. -->
<section class="listas">
<h1 class="pre">Lista de abreviaturas e siglas</h1>
<table class="siglas">
  <tr><td>Esag</td><td>Centro de Ciências da Administração e Socioeconômicas</td></tr>
  <tr><td>Udesc</td><td>Universidade do Estado de Santa Catarina</td></tr>
</table>
</section>

<section>
<h1 class="pre">Sumário</h1>
<div class="sumario">
</div>
</section>

</div><!-- /pretextual -->

{corpo}
<h1 class="pre">Referências</h1>
<div class="refs">
<p class="pendente">[PREENCHER: uma &lt;p&gt; por obra, em ordem alfabética, no padrão da NBR 6023:2025 (modelos em normas/abnt-udesc.md, seção 12). Toda obra daqui precisa estar citada no texto. Exemplo de livro: GIL, Antônio Carlos. <b>Como elaborar projetos de pesquisa</b>. 4. ed. São Paulo: Atlas, 2002.]</p>
</div>

<!-- Na versão final depositada no Repositório, a última página do PDF é a Declaração de Versão Final e
     Autorização para Publicação, assinada pelo autor e pelo orientador. Ela entra no PDF, e não neste HTML. -->

</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("destino", nargs="?")
    ap.add_argument("--modelo", default="tcc-iv", choices=[k for k in sorted(MODELOS) if k.startswith("tcc")])
    ap.add_argument("--modelos", action="store_true", help="lista os modelos e sai")
    a = ap.parse_args()
    if a.modelos or not a.destino:
        for k in sorted(MODELOS):
            if k.startswith("tcc"):
                print(f"  {k:16s} {MODELOS[k]['nome']}")
        return
    chave, modelo = a.modelo, MODELOS[a.modelo]
    destino = os.path.abspath(a.destino)
    if os.path.exists(destino) and os.listdir(destino):
        sys.exit(f"{destino} já existe e não está vazia. Escolha uma pasta nova; nada foi copiado.")
    shutil.copytree(PROJETO, destino, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
    consultoria = chave == "tcc-iv"
    if not consultoria:
        # O guia de leitura do autor trata da consultoria; nas outras modalidades ele confundiria.
        os.remove(os.path.join(destino, "GUIA.md"))

    titulo = ("TCC de consultoria da ESAG/UDESC" if consultoria else
              f"TCC de Administração da ESAG/UDESC: {modelo['nome'].split(': ', 1)[-1]}")
    intro = ("Este repositório é um TCC do curso de Administração da ESAG/UDESC na Modalidade IV, Consultoria: o "
             "relato de como o autor resolveu um problema real de uma organização." if consultoria else
             f"Este repositório é um {modelo['nome']}. O regulamento define a modalidade assim: {modelo['descricao']}")
    valores = {
        "TITULO": titulo,
        "INTRO": intro,
        "FICHA": ficha(chave),
        "COMO_ESCREVER": como_escrever(chave, modelo),
        "ARMADILHAS": ARMADILHAS_TCC.format(ficha=modelo["ficha"]) + (ARMADILHAS_IV if consultoria else ""),
        "MODELO_NOME": modelo["nome"],
        "ROTEIRO_CRITERIOS": roteiro_criterios(chave, modelo),
        "LINHA_GUIA": ("| Guia para o autor ler: regras, método, formatação e checklist da consultoria | `GUIA.md` |"
                       if consultoria else ""),
        "MAPA_GUIA": "| `GUIA.md` | Guia de leitura do autor sobre o TCC de consultoria |" if consultoria else "",
        "README_GUIA": ("- `GUIA.md`: o guia de leitura do TCC de consultoria, com regras, prazos, método e checklist."
                        if consultoria else ""),
    }
    open(os.path.join(destino, "perguntas-orientador.md"), "w", encoding="utf-8").write(perguntas(chave))
    if consultoria:
        with open(os.path.join(destino, "decisoes.md"), "a", encoding="utf-8") as f:
            f.write(DECISOES_IV)
    for nome in ("AGENTS.md", "README.md", "HANDOFF.md", "uso-de-ia.md", os.path.join("revisao", "roteiro.md")):
        caminho = os.path.join(destino, nome)
        open(caminho, "w", encoding="utf-8").write(preencher(open(caminho, encoding="utf-8").read(), valores))
    open(os.path.join(destino, "tcc.html"), "w", encoding="utf-8").write(documento(chave, modelo))
    print(f"Projeto criado em {destino}")
    print(f"Modelo: {modelo['nome']}")
    print("Próximos passos, dentro da pasta:")
    print("  cd scripts && npm install && npx playwright install chromium-headless-shell && cd ..")
    print("  uv run --quiet --with pypdf python3 scripts/montar.py tcc.html")
    print("  python3 scripts/checar.py tcc.html")
    print("  uv run --quiet --with pdfplumber --with pypdf python3 scripts/conferir_pdf.py tcc.pdf")


if __name__ == "__main__":
    main()
