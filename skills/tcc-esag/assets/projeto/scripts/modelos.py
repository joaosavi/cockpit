"""Modelos de documento: seções primárias obrigatórias e critérios de avaliação.

Fonte: Regulamento do TCC de Administração da ESAG/UDESC (PPC 2024.1, em vigor desde 2025/2), Quadro 1
(modalidades e composição mínima) e Anexo 1 (formulários de avaliação). Os textos entre aspas são
transcrições literais.

Cada seção é (título que entra no documento, variantes aceitas pelo checar.py). As variantes estão sem
acento e em minúsculas; uma variante que termina em "*" aceita qualquer título que comece por ela.
"""

CRITERIOS_PESQUISA = [
    "Exposição e compreensão do assunto: \"considere a capacidade de compreensão do acadêmico em relação ao "
    "problema do trabalho (natureza, conteúdo, limites e interdependência com outros fatores)\"",
    "Fundamentação Teórica: \"considere o conhecimento teórico da área tema e o cumprimento das leituras "
    "sugeridas pelo professor orientador para o desenvolvimento do TCC\"",
    "Procedimentos Metodológicos: \"verifique o atendimento às normas e procedimentos metodológicos "
    "estabelecidos\"",
    "Descrição dos dados: \"considere a capacidade criativa, articulada e sequencial na descrição dos dados\"",
    "Análise dos dados: \"considere a capacidade de análise, interpretação e de articulação dos dados, diante "
    "dos fundamentos teóricos e empíricos relacionados com o tema da pesquisa\"",
]

CRITERIOS_APLICADO = [
    "Exposição e compreensão do assunto: \"considere a capacidade de compreensão do acadêmico em relação ao "
    "problema do trabalho (natureza, conteúdo, limites e interdependência com outros fatores)\"",
    "Contextualização: \"considere a capacidade de descrever a situação-problema e/ou oportunidades "
    "identificadas, seu diagnóstico e as relações entre os elementos envolvidos\"",
    "Metodologia escolhida para o desenvolvimento do trabalho: \"considere a adequação da metodologia "
    "escolhida com o contexto encontrado, de forma a esclarecer as atividades e entregas a serem realizadas, "
    "bem como os resultados previstos\"",
    "Desenvolvimento das etapas: \"considere o cumprimento das etapas previstas na metodologia e o atingimento "
    "dos objetivos esperados\"",
]

CONCLUSOES = ("Conclusões e recomendações", ["conclusoes", "recomendacoes", "conclusoes e recomendacoes",
                                              "conclusoes e/ou recomendacoes"])
SECOES_PESQUISA = [
    ("Introdução", ["introducao"]),
    ("Fundamentação teórica", ["fundamentacao teorica"]),
    ("Procedimentos metodológicos", ["procedimentos metodologicos"]),
    ("Descrição e análise dos dados", ["descricao e analise dos dados"]),
    CONCLUSOES,
]

NATUREZA_TCC = ("Trabalho de Conclusão de Curso apresentado ao Curso de Administração Empresarial do Centro de "
                "Ciências da Administração e Socioeconômicas, da Universidade do Estado de Santa Catarina, como "
                "requisito parcial para a obtenção do grau de Bacharel em Administração.")

MODELOS = {
    "tcc-i": {
        "nome": "TCC de Administração, Modalidade I: pesquisa com dados primários",
        "descricao": "\"A pesquisa utiliza métodos de planejamento, coleta de dados primários, tratamento dos "
                     "dados, análise e conclusões em qualquer área da administração.\"",
        "secoes": SECOES_PESQUISA,
        "criterios": CRITERIOS_PESQUISA,
        "ficha": "Formulário para Avaliação, Modalidades I e II",
    },
    "tcc-ii": {
        "nome": "TCC de Administração, Modalidade II: pesquisa com dados secundários",
        "descricao": "\"A pesquisa utiliza a coleta, o tratamento e a análise de dados secundários (científicos "
                     "e não científicos) em qualquer área da administração.\"",
        "secoes": SECOES_PESQUISA,
        "criterios": CRITERIOS_PESQUISA,
        "ficha": "Formulário para Avaliação, Modalidades I e II",
    },
    "tcc-iii-plano": {
        "nome": "TCC de Administração, Modalidade III: plano",
        "descricao": "\"O plano reúne informações sobre as características, condições e necessidades do futuro "
                     "empreendimento com o objetivo de analisar sua potencialidade e sua viabilidade, "
                     "facilitando sua implementação.\"",
        "secoes": [
            ("Introdução", ["introducao"]),
            ("Contextualização", ["contextualizacao"]),
            ("Metodologia utilizada para o desenvolvimento do plano de negócios",
             ["metodologia utilizada para o desenvolvimento do plano de negocios"]),
            ("Desenvolvimento das etapas do plano de negócios", ["desenvolvimento das etapas do plano de negocios"]),
            ("Conclusões", ["conclusoes"]),
        ],
        "criterios": CRITERIOS_APLICADO,
        "ficha": "Formulário para Avaliação, Modalidades III e IV",
    },
    "tcc-iii-projeto": {
        "nome": "TCC de Administração, Modalidade III: projeto",
        "descricao": "\"O projeto é de caráter temporário e reúne dados e informações do contexto interno e "
                     "externo relevantes para o desenvolvimento das etapas do projeto.\"",
        "secoes": [
            ("Introdução", ["introducao"]),
            ("Contextualização", ["contextualizacao"]),
            ("Metodologia utilizada para o desenvolvimento do projeto",
             ["metodologia utilizada para o desenvolvimento do projeto"]),
            ("Desenvolvimento das etapas do projeto", ["desenvolvimento das etapas do projeto"]),
            ("Conclusões", ["conclusoes"]),
        ],
        "criterios": CRITERIOS_APLICADO,
        "ficha": "Formulário para Avaliação, Modalidades III e IV",
    },
    "tcc-iv": {
        "nome": "TCC de Administração, Modalidade IV: consultoria",
        "descricao": "\"A consultoria se caracteriza pela solução de problemas e/ou alavancar oportunidades "
                     "internas e externas nas organizações e/ou comunidades.\"",
        "secoes": [
            ("Introdução", ["introducao"]),
            ("Contextualização", ["contextualizacao"]),
            ("Caracterização da organização", ["caracterizacao da organizacao", "caracterizacao da comunidade",
                                               "caracterizacao da organizacao/comunidade"]),
            ("Metodologia utilizada para o desenvolvimento da consultoria",
             ["metodologia utilizada para o desenvolvimento da consultoria"]),
            ("Desenvolvimento das etapas da consultoria", ["desenvolvimento das etapas da consultoria"]),
            CONCLUSOES,
        ],
        "criterios": CRITERIOS_APLICADO,
        "ficha": "Formulário para Avaliação, Modalidades III e IV",
    },
    "tcc-v": {
        "nome": "TCC de Administração, Modalidade V: novos produtos, serviços e protótipos (inovação)",
        "descricao": "\"Envolve o desenvolvimento de produtos/serviços; softwares e aplicativos para fins "
                     "diversos.\"",
        # O regulamento escreve a terceira seção como "Metodologia utilizada para o desenvolvimento de
        # Desenvolvimento", texto truncado. O título abaixo completa com o objeto da seção seguinte; confirme
        # com o orientador. O checar.py aceita qualquer título que comece por "Metodologia utilizada para o
        # desenvolvimento".
        "secoes": [
            ("Introdução", ["introducao"]),
            ("Contextualização", ["contextualizacao"]),
            ("Metodologia utilizada para o desenvolvimento da inovação",
             ["metodologia utilizada para o desenvolvimento*"]),
            ("Desenvolvimento das etapas da inovação", ["desenvolvimento das etapas da inovacao"]),
            CONCLUSOES,
        ],
        "criterios": CRITERIOS_APLICADO,
        # O cabeçalho dessa ficha cobre também a Modalidade V.
        "ficha": "Formulário para Avaliação, Modalidades III e IV",
    },
    # Modelo interno do scripts/teste/exemplo-elementos.html, que testa o motor; não serve para criar projeto.
    "exemplo": {
        "nome": "documento de exemplo dos elementos (teste do motor)",
        "descricao": "",
        "secoes": [
            ("Introdução", ["introducao"]),
            ("Desenvolvimento", ["*"]),
            ("Conclusão", ["conclusao", "conclusoes"]),
        ],
        "criterios": [],
        "ficha": "",
        "fonte": "exemplo do motor",
    },
}

for _m in MODELOS.values():
    _m.setdefault("fonte", "regulamento do TCC, composição mínima")


def secao_confere(titulo_normalizado, variantes):
    for v in variantes:
        if v == "*" or (v.endswith("*") and titulo_normalizado.startswith(v[:-1])) or titulo_normalizado == v:
            return True
    return False
