#!/usr/bin/env python3
"""Checagem do texto do trabalho a partir do HTML (a fonte única), contra o regulamento e o Manual da UDESC.

Uso:
    python3 scripts/checar.py tcc.html

Confere:
- marcadores [PREENCHER] e parágrafos com a classe "pendente" que sobraram (saem cinza no PDF);
- as seções primárias do modelo (meta "modelo" no <head>), na ordem e com os nomes do regulamento;
- numeração progressiva de todos os níveis e seção sem texto próprio (NBR 6024; Manual p. 49);
- resumo (150 a 500 palavras) e palavras-chave (três a cinco) (Manual p. 27); abstract no TCC (p. 28);
- ilustrações e tabelas: citação no texto, linha de fonte, listas por tipo (Manual p. 29-30, 51-54);
- referências: ordem alfabética, obra da lista sem citação e citação sem obra na lista (Manual p. 61, 78);
- chamadas no formato antigo "(SOBRENOME, ano)", que a NBR 10520:2023 trocou por "(Sobrenome, ano)".

Avisos são para conferir, e não decidem nada sozinhos.
"""
import os
import re
import sys
import unicodedata
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from modelos import MODELOS, secao_confere  # noqa: E402


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def texto(s):
    s = re.sub(r"(?s)<!--.*?-->", "", s)
    s = re.sub(r'(?s)<span class="nota[^"]*">.*?</span>', "", s)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).replace("&ndash;", "–").replace("&amp;", "&").strip()


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    html = open(sys.argv[1], encoding="utf-8").read()
    avisos = 0

    def aviso(msg):
        nonlocal avisos
        avisos += 1
        print("  AVISO: " + msg)

    m_modelo = re.search(r'<meta name="modelo" content="([^"]+)"', html)
    chave_modelo = m_modelo.group(1) if m_modelo else "tcc-iv"
    modelo = MODELOS.get(chave_modelo)
    tcc = chave_modelo.startswith("tcc")

    print("=== Marcadores ===")
    linhas = [(i + 1, l.strip()) for i, l in enumerate(html.splitlines()) if "[PREENCHER" in l]
    pendentes = len(re.findall(r'class="[^"]*\bpendente\b', re.sub(r"(?s)<!--.*?-->", "", html)))
    if linhas:
        aviso(f"{len(linhas)} linhas ainda têm [PREENCHER]. As primeiras:")
        for n, l in linhas[:5]:
            print(f"    linha {n}: {texto(l)[:90]}")
    if pendentes:
        aviso(f"{pendentes} elemento(s) com a classe \"pendente\", que sai cinza e em itálico no PDF. Depois de escrever "
              "o texto, tire a classe.")
    if not linhas and not pendentes:
        print("  nenhum")
    if not m_modelo:
        aviso("o <head> não tem <meta name=\"modelo\">; conferi como TCC da Modalidade IV.")

    m_pre = re.search(r"</div>\s*<!--\s*/pretextual\s*-->", html)
    pre = re.sub(r"(?s)<!--.*?-->", "", html[:m_pre.start()]) if m_pre else ""
    corpo = re.sub(r"(?s)<!--.*?-->", "", html[m_pre.end():] if m_pre else html)
    refs_m = re.search(r'(?s)<div class="refs">(.*?)</div>', corpo)
    corpo_sem_refs = corpo[:refs_m.start()] if refs_m else corpo
    texto_corpo = texto(corpo_sem_refs)

    print(f"\n=== Seções ({modelo['nome'] if modelo else chave_modelo}) ===")
    titulos = []
    for m in re.finditer(r'(?is)<h([1-5])\b([^>]*)>(.*?)</h\1>', corpo):
        if 'class="pre"' in m.group(2):
            continue
        t = texto(m.group(3))
        mi = re.match(r"^(\d+(?:\.\d+)*)\s+(.*)$", t)
        titulos.append((int(m.group(1)), mi.group(1) if mi else "", mi.group(2) if mi else t, m.start(), m.end()))
    primarias = [(ind, tit) for nivel, ind, tit, _, _ in titulos if nivel == 1]
    for ind, tit in primarias:
        print(f"  {ind} {tit}")
    # Numeração progressiva: cada título é o anterior do mesmo nível mais 1, sob o pai certo (NBR 6024).
    contador = []
    for nivel, ind, tit, _, _ in titulos:
        contador = contador[:nivel] + [0] * (nivel - len(contador[:nivel]))
        contador[nivel - 1] += 1
        esperado = ".".join(str(n) for n in contador[:nivel])
        if ind != esperado:
            aviso(f"o título \"{ind} {tit}\" deveria ter o indicativo {esperado} (numeração progressiva, NBR 6024).")
            contador = [int(x) for x in ind.split(".")] if re.fullmatch(r"\d+(\.\d+)*", ind or "") else contador
    # Toda seção tem texto próprio (Manual p. 49, alínea d).
    for (_, ind, tit, _, fim), proximo in zip(titulos, titulos[1:] + [None]):
        trecho = corpo[fim:proximo[3]] if proximo else corpo[fim:fim + 2000]
        if not texto(trecho):
            aviso(f"a seção \"{ind} {tit}\" não tem texto próprio antes do próximo título (Manual p. 49).")
    if modelo:
        esperadas = modelo["secoes"]
        flexivel = any(v == "*" for _, vs in esperadas for v in vs)
        if flexivel:
            pares = [(primarias[0], esperadas[0]), (primarias[-1], esperadas[-1])] if primarias else []
            if len(primarias) < len(esperadas):
                aviso(f"o corpo tem {len(primarias)} seções primárias; o mínimo é introdução, desenvolvimento e conclusão.")
        else:
            pares = list(zip(primarias, esperadas))
            if len(primarias) != len(esperadas):
                aviso(f"o corpo tem {len(primarias)} seções primárias; o modelo pede {len(esperadas)}.")
        for (ind, tit), (nome, variantes) in pares:
            if not secao_confere(norm(tit), variantes):
                aviso(f"a seção \"{ind} {tit}\" deveria ser \"{nome}\" ({modelo['fonte']}).")
    else:
        aviso(f"modelo \"{chave_modelo}\" desconhecido; as seções não foram conferidas.")

    print("\n=== Resumo e palavras-chave ===")
    for nome, rotulo, obrigatorio in (("Resumo", "Palavras-chave", True), ("Abstract", "Keywords", tcc)):
        m = re.search(r'(?is)<h1[^>]*>\s*%s\s*</h1>(.*?)</section>' % nome, html)
        if not m:
            if obrigatorio:
                aviso(f"{nome} não encontrado" + (" (obrigatório no TCC, Manual p. 28)." if nome == "Abstract" else "."))
            continue
        partes = re.split(r"(?i)%s:" % rotulo, m.group(1))
        n = len(texto(partes[0]).split()) if "[PREENCHER" not in partes[0] else 0
        print(f"  {nome}: {n} palavras" + ("" if n else " (por escrever)"))
        if n and not 150 <= n <= 500:
            aviso(f"{nome} com {n} palavras; o trabalho acadêmico pede de 150 a 500 (Manual p. 27).")
        if len(partes) > 1 and "[PREENCHER" not in partes[1]:
            chaves = [c for c in texto(partes[1]).rstrip(".").split(";") if c.strip()]
            print(f"  {rotulo}: {len(chaves)}")
            if not 3 <= len(chaves) <= 5:
                aviso(f"{rotulo} pede de três a cinco termos (Manual p. 27).")

    print("\n=== Ilustrações e tabelas ===")
    ilus = [texto(t) for t in re.findall(r'(?s)<p class="semrec titulo-ilus"[^>]*>(.*?)</p>', corpo)]
    tabs = [texto(t) for t in re.findall(r'(?s)<p class="semrec titulo-tab"[^>]*>(.*?)</p>', corpo)]
    tipos = Counter(t.split(" ", 1)[0] for t in ilus if t)
    print(f"  {len(ilus)} ilustrações ({', '.join(f'{q} {t}' for t, q in tipos.items()) or 'nenhuma'}), {len(tabs)} tabelas")
    listas = [(m.group(1), m.group(2)) for m in
              re.finditer(r'<div class="(lista-ilustracoes|lista-tabelas) sumario"(?: data-tipo="([^"]*)")?>', pre)]
    proprios = {t for c, t in listas if c == "lista-ilustracoes" and t}
    for tipo, qtd in tipos.items():
        if tipo != "Figura" and qtd < 5 and tipo not in proprios:
            aviso(f"{qtd} ilustração(ões) do tipo \"{tipo}\". O manual manda chamar de \"Figura\" os itens da lista única "
                  "quando há menos de cinco do tipo (p. 29); trocar também a legenda no corpo é interpretação, confirme "
                  "com o orientador.")
        if qtd >= 5 and tipo != "Figura" and tipo not in proprios:
            aviso(f"{qtd} do tipo \"{tipo}\": com cinco ou mais, o tipo ganha lista própria (Manual p. 29). Crie uma "
                  f"seção com <div class=\"lista-ilustracoes sumario\" data-tipo=\"{tipo}\">.")
    for tipo in proprios:
        if not tipos.get(tipo):
            aviso(f"existe lista própria para \"{tipo}\", mas nenhuma ilustração desse tipo.")
    if ilus and not any(c == "lista-ilustracoes" and not t for c, t in listas) and set(tipos) - proprios:
        aviso("há ilustrações sem lista: falta a seção \"Lista de ilustrações\".")
    if not set(tipos) - proprios and any(c == "lista-ilustracoes" and not t for c, t in listas):
        aviso("a \"Lista de ilustrações\" vai sair vazia: apague a seção.")
    if tabs and not any(c == "lista-tabelas" for c, _ in listas):
        aviso("há tabelas e falta a seção \"Lista de tabelas\" (Manual p. 31).")
    if not tabs and any(c == "lista-tabelas" for c, _ in listas):
        aviso("a \"Lista de tabelas\" vai sair vazia: apague a seção.")
    for bloco in re.findall(r'(?s)<div class="ilustracao[^"]*">(.*?)</div>', corpo):
        if 'class="semrec fonte"' not in bloco:
            t = re.search(r'titulo-(?:ilus|tab)"[^>]*>(.*?)</p>', bloco, re.S)
            aviso(f"sem linha de fonte, que é obrigatória (Manual p. 52, 54): {texto(t.group(1)) if t else '?'}")
    sem_titulos = texto(re.sub(r'(?s)<p class="semrec titulo-(?:ilus|tab)"[^>]*>.*?</p>', " ", corpo_sem_refs))
    for t in ilus + tabs:
        m = re.match(r"^(\S+ \d+)\b", t)
        if m and not re.search(r"\b%s\b" % re.escape(m.group(1)), sem_titulos):
            aviso(f"\"{m.group(1)}\" não é citada no texto (Manual p. 51).")

    print("\n=== Referências ===")
    siglas = {texto(s) for s in re.findall(r"<tr><td>(.*?)</td>", pre)}
    texto_refs = ""
    if not refs_m:
        aviso("bloco de referências (div.refs) não encontrado.")
    else:
        entradas = [texto(e) for e in re.findall(r"(?s)<p[^>]*>(.*?)</p>", refs_m.group(1))]
        entradas = [e for e in entradas if e and "[PREENCHER" not in e]
        texto_refs = " ".join(entradas)
        print(f"  {len(entradas)} referências")
        chaves = [norm(e) for e in entradas]
        if chaves != sorted(chaves):
            fora = next(e for e, a, b in zip(entradas[1:], chaves, chaves[1:]) if b < a)
            aviso(f"referências fora da ordem alfabética, a partir de: {fora[:60]} (Manual p. 78).")
        for e in entradas:
            autor = re.split(r"[,.]", e, maxsplit=1)[0].strip()
            busca = autor.split()[-1] if autor.isupper() and " " in autor and len(autor.split()) <= 2 else autor
            if busca and not re.search(r"\b%s\b" % re.escape(norm(busca)), norm(texto_corpo)):
                aviso(f"não achei \"{busca.title()}\" no texto. Toda obra da lista precisa estar citada: {e[:70]}")
    # Citação sem obra na lista: "(Silva, 2020)", "(Souza; Santos, 2019, p. 3)" e "Silva (2020)".
    citados = set()
    for grupo in re.findall(r"\(([^()]*?\b\d{4}[a-z]?\b[^()]*)\)", texto_corpo):
        for parte in grupo.split(";"):
            m = re.match(r"\s*([A-ZÀ-Ý][\wÀ-ÿ'’-]+)", parte)
            if m and re.search(r"\d{4}", grupo):
                citados.add(m.group(1))
    citados |= set(re.findall(r"\b([A-ZÀ-Ý][a-zà-ÿ'’-]+)(?: et al\.)? \(\d{4}", texto_corpo))
    ignorar = {"Fonte", "Figura", "Quadro", "Tabela", "Lei", "Decreto", "Art", "In", "Apud", "Disponível", "Acesso"}
    for nome in sorted(citados - ignorar):
        if not re.search(r"\b%s\b" % re.escape(norm(nome)), norm(texto_refs)) and nome not in siglas:
            aviso(f"\"{nome}\" aparece numa chamada de citação e não está na lista de referências (Manual p. 61).")

    print("\n=== Chamadas no formato antigo ===")
    antigas = set(re.findall(r"\(([A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}(?: [A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,})*)(?:;|,) ?(?:\d{4}|et al)", texto_corpo))
    antigas = {a for a in antigas if a != "PREENCHER" and a not in siglas and not re.search(r"\b%s\b" % a, texto_refs)}
    if antigas:
        aviso("chamadas em maiúsculas: " + ", ".join(sorted(antigas)[:8]) + ". Desde a NBR 10520:2023 o sobrenome vai "
              "em maiúsculas e minúsculas, \"(Silva, 2020)\"; sigla de entidade continua em maiúsculas.")
    else:
        print("  nenhuma")

    print(f"\n{avisos} aviso(s).")


if __name__ == "__main__":
    main()
