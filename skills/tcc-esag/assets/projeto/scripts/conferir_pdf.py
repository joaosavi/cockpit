#!/usr/bin/env python3
"""Confere o PDF pronto contra as regras de forma do Manual da UDESC, medindo o arquivo, e não o CSS.

Uso:
    uv run --quiet --with pdfplumber --with pypdf python3 scripts/conferir_pdf.py tcc.pdf

Confere, folha por folha:
- papel A4 (Manual p. 42);
- texto, bordas e imagens dentro das margens: 3 cm à esquerda e no alto, 2 cm à direita e embaixo
  (Manual p. 42; ilustração nas margens do texto, p. 51);
- uma família de fonte só, Times New Roman ou Arial, ou equivalente métrica (Manual p. 42);
- tamanhos 12 e 10 (Manual p. 42); o expoente de nota é a única exceção;
- texto em preto (Manual p. 42): cinza é erro, menos nas linhas de marcador [PREENCHER], que são contadas à
  parte; cor é aviso, porque só ilustração pode ter cor;
- entrelinha do corpo próxima de 1,5 (Manual p. 43);
- nenhuma folha em branco;
- número da página: ausente na capa e nos pré-textuais; a partir da Introdução, em 10, no canto superior
  direito, a 2 cm das bordas, valendo a folha contada desde a folha de rosto (Manual p. 47);
- sumário e listas: cada linha é um link no PDF; o número impresso nela precisa ser a página do destino do
  link, e a seção primária precisa abrir a página no topo (Manual p. 30, 35, 45);
- notas de rodapé: chamadas e números do rodapé em sequência única, 1, 2, 3, sem recomeçar (Manual p. 44);
- marcas estruturais no PDF (PDF marcado), que o Repositório pede junto com o PDF/A (Manual p. 141).

Sai com código 1 quando acha erro, para servir de portão antes de entregar. Marcador por escrever não é erro
de forma, mas a versão final não pode ter nenhum.
"""
import re
import sys
import unicodedata
from collections import Counter

try:
    import pdfplumber
    from pypdf import PdfReader
except ImportError:
    sys.exit("pdfplumber ou pypdf não encontrado. Rode com: uv run --quiet --with pdfplumber --with pypdf python3 scripts/conferir_pdf.py tcc.pdf")

CM = 72 / 2.54
A4 = (595.28, 841.89)
TOL = 1.5  # pt
MARGEM = {"esq": 3 * CM, "dir": A4[0] - 2 * CM, "alto": 3 * CM, "baixo": A4[1] - 2 * CM}
FAMILIAS = {"TimesNewRoman": "Times", "Times-": "Times", "LiberationSerif": "Times", "Tinos": "Times",
            "Arial": "Arial", "LiberationSans": "Arial", "Arimo": "Arial", "Helvetica": "Arial"}


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def familia(nome):
    nome = nome.split("+", 1)[-1].replace(" ", "")
    return next((v for k, v in FAMILIAS.items() if k in nome), nome)


def cor(c):
    """'preto', 'cinza' ou 'cor' para a cor de preenchimento de um caractere."""
    if c is None:
        return "preto"
    v = [x for x in (c if isinstance(c, (list, tuple)) else [c]) if isinstance(x, (int, float))]
    if len(v) == 1:
        return "preto" if v[0] < 0.05 else "cinza"
    if len(v) == 3:
        if max(v) < 0.05:
            return "preto"
        return "cinza" if max(v) - min(v) < 0.02 else "cor"
    if len(v) == 4:
        return "preto" if v[3] > 0.95 and max(v[:3]) < 0.05 else "cor"
    return "preto"


def linhas(chars):
    grupos = []
    for c in sorted(chars, key=lambda c: (round(c["bottom"]), c["x0"])):
        if grupos and abs(grupos[-1][0]["bottom"] - c["bottom"]) < 2.5:
            grupos[-1].append(c)
        else:
            grupos.append([c])
    return [sorted(g, key=lambda c: c["x0"]) for g in grupos]


def texto_linha(g):
    out, ultimo = "", None
    for c in g:
        if ultimo is not None and c["x0"] - ultimo > 1.5:
            out += " "
        out += c["text"]
        ultimo = c["x1"]
    return out


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    caminho = sys.argv[1]
    erros, avisos = [], []
    pdf = pdfplumber.open(caminho)
    leitor = PdfReader(caminho)
    paginas = pdf.pages
    numero, primeira = {}, {}
    familias, tamanhos, passos = Counter(), Counter(), Counter()
    chamadas, marcadores = [], []
    marcadores_pendentes = []

    for i, p in enumerate(paginas, start=1):
        if abs(p.width - A4[0]) > 2 or abs(p.height - A4[1]) > 2:
            erros.append(f"folha {i}: papel {p.width:.0f} x {p.height:.0f} pt, e não A4")
        chars = [c for c in p.chars if c["text"].strip()]
        no_alto = [c for c in chars if c["bottom"] < MARGEM["alto"] - TOL]
        corpo = [c for c in chars if c["bottom"] >= MARGEM["alto"] - TOL]
        if no_alto:
            numero[i] = ("".join(c["text"] for c in sorted(no_alto, key=lambda c: c["x0"])).strip(), no_alto)
        if not corpo:
            erros.append(f"folha {i}: em branco")
        for c in corpo:
            if c["x0"] < MARGEM["esq"] - TOL or c["x1"] > MARGEM["dir"] + TOL or c["bottom"] > MARGEM["baixo"] + TOL:
                erros.append(f"folha {i}: \"{c['text']}\" fora das margens (x {c['x0']:.1f} a {c['x1']:.1f}, base {c['bottom']:.1f} pt)")
                break
        for o in p.rects + p.lines + p.curves + p.images:
            branco = o.get("non_stroking_color") in ((1, 1, 1), (1.0, 1.0, 1.0), [1, 1, 1], (1,), [1]) and not o.get("stroke")
            if not branco and (o["x0"] < MARGEM["esq"] - TOL or o["x1"] > MARGEM["dir"] + TOL
                               or o["top"] < MARGEM["alto"] - TOL or o["bottom"] > MARGEM["baixo"] + TOL):
                erros.append(f"folha {i}: linha, borda ou imagem fora das margens (x {o['x0']:.1f} a {o['x1']:.1f} pt)")
                break
        for c in chars:
            familias[familia(c["fontname"])] += 1
            tam = round(c["size"], 1)
            tamanhos[tam] += 1
            if not c["text"].isdecimal() and c["text"].isdigit():
                erros.append(f"folha {i}: algarismo sobrescrito Unicode \"{c['text']}\"; a chamada de nota deve sair do CSS")
                break
            if tam not in (10.0, 12.0) and not (c["text"].isdigit() and tam < 10):
                erros.append(f"folha {i}: \"{c['text']}\" em {tam} pt; o manual admite 12 e 10")
                break
        # Cinza: linha de marcador [PREENCHER: ...] conta à parte; qualquer outra linha cinza é erro (Manual p. 42).
        dentro = False
        for g in linhas([c for c in chars if cor(c.get("non_stroking_color")) == "cinza"]):
            t = texto_linha(g)
            if "[PREENCHER" in t.replace(" ", ""):
                dentro = True
            if dentro:
                marcadores_pendentes.append(i)
                if "]" in t:
                    dentro = False
            else:
                erros.append(f"folha {i}: texto cinza, fora do preto que o manual pede (p. 42); provavelmente um "
                             f"parágrafo que ficou com a classe pendente: \"{t[:50]}\"")
        if any(cor(c.get("non_stroking_color")) == "cor" for c in chars):
            avisos.append(f"folha {i}: texto colorido; só ilustração pode ter cor (Manual p. 42)")
        ls = linhas(corpo)
        primeira[i] = norm(texto_linha(ls[0])) if ls else ""
        normais = [g for g in ls if round(g[0]["size"]) == 12 and all(round(c["size"]) == 12 for c in g)]
        for a, b in zip(normais, normais[1:]):
            d = round(b[0]["bottom"] - a[0]["bottom"], 1)
            if 15 < d < 30:
                passos[round(d)] += 1
        # Notas: o filete de 5 cm separa as chamadas, acima, dos números do rodapé, abaixo.
        filete = next((o["top"] for o in p.rects + p.lines
                       if abs(o["x0"] - MARGEM["esq"]) < 2 and abs((o["x1"] - o["x0"]) - 5 * CM) < 2), None)
        for g in ls:
            nums, atual = [], ""
            for c in g:
                if c["text"].isdigit() and (c["size"] < 9 or not c["text"].isdecimal()):
                    atual += str(unicodedata.digit(c["text"]))
                elif atual:
                    nums.append(atual)
                    atual = ""
            if atual:
                nums.append(atual)
            destino = marcadores if filete is not None and g[0]["top"] > filete else chamadas
            destino.extend((i, int(n)) for n in nums)

    print("=== Fonte e entrelinha ===")
    print("  famílias: " + ", ".join(f"{f} ({n} caracteres)" for f, n in familias.most_common()))
    print("  tamanhos: " + ", ".join(f"{t} pt ({n})" for t, n in sorted(tamanhos.items())))
    if len(familias) > 1:
        erros.append("mais de uma família de fonte no PDF: " + ", ".join(familias))
    elif familias and next(iter(familias)) not in ("Times", "Arial"):
        erros.append(f"família {next(iter(familias))}: o manual pede Times New Roman ou Arial")
    fontes_pdf = {c["fontname"].split("+", 1)[-1] for p in paginas for c in p.chars[:50]}
    if any("Liberation" in f for f in fontes_pdf):
        avisos.append("o PDF usa Liberation Serif, que tem as medidas da Times New Roman. Com a Times New Roman "
                      "instalada no computador, o PDF passa a usá-la sem mudar a paginação.")
    if passos:
        passo = passos.most_common(1)[0][0]
        print(f"  entrelinha do corpo: {passo} pt entre linhas de 12 pt")
        if not 17 <= passo <= 22:
            erros.append(f"entrelinha do corpo de {passo} pt; 1,5 em fonte 12 fica entre 18 e 21 pt (Manual p. 43)")

    print("\n=== Número da página ===")
    folha_intro = next((i for i in range(1, len(paginas) + 1) if i in numero), None)
    if folha_intro is None:
        erros.append("nenhuma folha tem número de página")
    else:
        for i in range(1, len(paginas) + 1):
            achado = numero.get(i)
            if i < folha_intro:
                continue
            if not achado:
                erros.append(f"folha {i}: sem número de página")
                continue
            txt, cs = achado
            if txt != str(i - 1):
                erros.append(f"folha {i}: número \"{txt}\", mas a contagem desde a folha de rosto dá {i - 1}")
            x1, alto, tam = max(c["x1"] for c in cs), min(c["top"] for c in cs), cs[0]["size"]
            if abs(x1 - (A4[0] - 2 * CM)) > 2 or abs(alto - 2 * CM) > 3 or round(tam) != 10:
                erros.append(f"folha {i}: número a {(A4[0] - x1) / CM:.2f} cm da direita e {alto / CM:.2f} cm "
                             f"do alto, em {tam:.1f} pt; o manual pede 2 cm, 2 cm e 10 pt")
        print(f"  a numeração começa na folha {folha_intro} do PDF, que exibe o número {folha_intro - 1}")

    # Sumário e listas: os links das folhas antes da Introdução.
    print("\n=== Sumário e listas, pelos links do PDF ===")
    destinos = {k.lstrip("/"): v for k, v in leitor.named_destinations.items()}
    conferidos, primeira_secao = 0, None
    for i in range(1, (folha_intro or len(paginas) + 1)):
        pagina_pdf = leitor.pages[i - 1]
        for anotacao in pagina_pdf.get("/Annots") or []:
            a = anotacao.get_object()
            if a.get("/Subtype") != "/Link":
                continue
            nome = a.get("/Dest") or (a.get("/A") or {}).get("/D")
            if not isinstance(nome, str):
                continue
            nome = nome.lstrip("/")
            x0, y0, x1, y1 = [float(v) for v in a["/Rect"]]
            recorte = paginas[i - 1].crop((max(x0, 0), max(A4[1] - y1, 0), min(x1, A4[0]), min(A4[1] - y0, A4[1])))
            linha = (recorte.extract_text() or "").strip()
            m = re.search(r"(\d+)\s*$", linha)
            destino = destinos.get(nome)
            if destino is None:
                erros.append(f"folha {i}: a linha \"{linha[:50]}\" aponta para \"{nome}\", que não existe no PDF")
                continue
            pagina_destino = leitor.get_destination_page_number(destino)  # 0 = capa
            conferidos += 1
            if not m:
                erros.append(f"folha {i}: a linha \"{linha[:50]}\" não termina em número de página")
                continue
            if int(m.group(1)) != pagina_destino:
                erros.append(f"folha {i}: \"{linha[:60]}\" diz página {m.group(1)}, mas o destino está na "
                             f"página {pagina_destino}")
            primaria = re.match(r"^\d+\s+\D", linha) and not re.match(r"^\d+\.", linha)
            if primaria:
                if primeira_secao is None:
                    primeira_secao = pagina_destino + 1
                topo = destino.top if destino.top is not None else 0
                if abs(float(topo) - (A4[1] - MARGEM["alto"])) > 8:
                    erros.append(f"seção primária \"{linha[:50]}\" não abre a página {pagina_destino} no topo (Manual p. 45)")
    print(f"  {conferidos} linhas conferidas")
    if conferidos == 0:
        erros.append("nenhum link de sumário encontrado: rode o scripts/montar.py")
    elif folha_intro and primeira_secao and primeira_secao != folha_intro:
        erros.append(f"a primeira seção do sumário está na folha {primeira_secao}, mas a numeração começa na folha {folha_intro}")

    print("\n=== Notas de rodapé ===")
    seq_c, seq_m = [n for _, n in chamadas], [n for _, n in marcadores]
    print(f"  {len(seq_c)} chamadas no texto, {len(seq_m)} números no rodapé")
    if seq_c != list(range(1, len(seq_c) + 1)):
        erros.append(f"chamadas de nota fora de sequência: {seq_c[:20]}")
    if seq_m != seq_c:
        erros.append(f"números do rodapé ({seq_m[:20]}) não batem com as chamadas ({seq_c[:20]})")

    print("\n=== Marcas estruturais ===")
    raiz = leitor.trailer["/Root"]
    marcado = "/StructTreeRoot" in raiz and bool((raiz.get("/MarkInfo") or {}).get("/Marked"))
    print("  PDF marcado" if marcado else "  PDF sem marcas")
    if not marcado:
        erros.append("o PDF não tem marcas estruturais (tagged); o Repositório pede PDF/A com marcas (Manual p. 141)")

    print()
    for a in avisos:
        print("  AVISO: " + a)
    for e in erros:
        print("  ERRO: " + e)
    if marcadores_pendentes:
        folhas_m = sorted(set(marcadores_pendentes))
        print(f"  PENDENTE: {len(marcadores_pendentes)} linha(s) de marcador [PREENCHER] por escrever, nas folhas "
              + ", ".join(str(f) for f in folhas_m[:12]) + ("..." if len(folhas_m) > 12 else ""))
    print(f"\n{len(erros)} erro(s), {len(avisos)} aviso(s) em {len(paginas)} folhas"
          + (f"; {len(marcadores_pendentes)} linha(s) de marcador por escrever." if marcadores_pendentes else "."))
    sys.exit(1 if erros else 0)


if __name__ == "__main__":
    main()
