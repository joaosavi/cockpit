#!/usr/bin/env python3
"""Monta o PDF do trabalho a partir do HTML (fonte única), com sumário e listas na página real.

Tudo por código, então sumário e listas ficam sempre alinhados, mesmo que você edite o texto depois:
  1. Dá um id estável a cada título do corpo (h1 a h5 fora do bloco .pretextual) e a cada título de
     ilustração e de tabela.
  2. Pagina o HTML com o Paged.js e imprime o PDF pelo Chromium (scripts/paginar.js). O paginar.js devolve
     a folha em que cada id caiu, lida do próprio layout, e não do texto do PDF.
  3. (Re)constrói o Sumário, cada linha um link para a seção com a página real, e as listas de ilustrações
     e de tabelas.
  4. Renderiza de novo e confere. Se a paginação mudou (o sumário cresceu de página), repete até estabilizar.

Uso:
    uv run --quiet --with pypdf python3 scripts/montar.py tcc.html [tcc.pdf]
    uv run --quiet --with pypdf python3 scripts/montar.py tcc.html --render-only   só renderiza
    uv run --quiet --with pypdf python3 scripts/montar.py tcc.html --tudo          PDF, página de leitura,
                                                     conferência no navegador e o .docx da cópia do Google Docs

Requer pypdf e o Node com as dependências de scripts/ (npm install).
"""
import html as htmllib
import json
import os
import re
import subprocess
import sys
import unicodedata

try:
    from pypdf import PdfReader
except Exception:
    sys.exit("pypdf não encontrado. Rode com: uv run --quiet --with pypdf python3 scripts/montar.py tcc.html")

AQUI = os.path.dirname(os.path.abspath(__file__))


# ---------------- texto ----------------
def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def strip_tags(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()


def texto_limpo(s):
    return htmllib.unescape(strip_tags(s))


def slugify(text, usados):
    t = norm(text)
    m = re.match(r"^([\d.]+)\s", t)
    if m and m.group(1).strip("."):
        base = "sec-" + m.group(1).strip(".").replace(".", "-")
    else:
        base = "sec-" + (re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40] or "x")
    sid, i = base, 2
    while sid in usados:
        sid = f"{base}-{i}"
        i += 1
    usados.add(sid)
    return sid


# ---------------- render (Paged.js + Chromium) ----------------
def render(html_path, pdf_path):
    """Pagina o HTML, imprime o PDF e devolve {"folhas": n, "mapa": {id: folha}, "partidos": [...]}."""
    sys.path.insert(0, AQUI)
    import artifact
    html_abs, pdf_abs = os.path.abspath(html_path), os.path.abspath(pdf_path)
    pagina = artifact.gerar(open(html_abs, encoding="utf-8").read(), artifact.PAGEDJS_LOCAL)
    tmp = os.path.join(os.path.dirname(html_abs), ".paginar.html")
    open(tmp, "w", encoding="utf-8").write(
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body>' + pagina + "</body></html>")
    if os.path.exists(pdf_abs):
        os.remove(pdf_abs)
    try:
        saida = subprocess.run(["node", os.path.join(AQUI, "paginar.js"), tmp, pdf_abs], check=True, timeout=300,
                               capture_output=True, text=True)
    except subprocess.CalledProcessError as erro:
        sys.exit("Falha ao paginar o PDF com o Paged.js:\n" + (erro.stderr or erro.stdout))
    finally:
        os.remove(tmp)
    if not os.path.exists(pdf_abs):
        sys.exit("Falha ao paginar o PDF com o Paged.js.")
    return json.loads(saida.stdout.strip().splitlines()[-1])


# ---------------- comentários ----------------
COMENTARIO_RE = re.compile(r"<!--.*?-->", re.S)


def mascarar(html):
    """O HTML com o miolo de cada comentário trocado por espaços: as posições não mudam, e nada que está em
    comentário (uma seção desativada, um exemplo) entra no sumário, nas listas ou nos ids."""
    return COMENTARIO_RE.sub(lambda c: " " * len(c.group(0)), html)


# ---------------- títulos ----------------
HEAD_RE = re.compile(r'<(h[1-5])\b([^>]*)>(.*?)</\1>', re.S | re.I)
ILUS_RE = re.compile(r'<p class="semrec (titulo-ilus|titulo-tab)"(?: id="[^"]*")?>(.*?)</p>', re.S)


def pretextual_span(html):
    m = re.search(r'<div class="pretextual">.*?</div>\s*<!--\s*/pretextual\s*-->', html, re.S)
    return (m.start(), m.end()) if m else (-1, -1)


def em_comentario(html):
    spans = [(c.start(), c.end()) for c in COMENTARIO_RE.finditer(html)]
    return lambda pos: any(a <= pos < b for a, b in spans)


def add_ids(html):
    ps, pe = pretextual_span(html)
    usados = set()
    comentado = em_comentario(html)

    def repl(m):
        if ps <= m.start() < pe or comentado(m.start()):
            return m.group(0)
        tag, attrs, inner = m.group(1), m.group(2), m.group(3)
        if not strip_tags(inner):
            return m.group(0)
        sid = slugify(texto_limpo(inner), usados)
        attrs = re.sub(r'\s*id="[^"]*"', "", attrs) + f' id="{sid}"'
        return f"<{tag}{attrs}>{inner}</{tag}>"

    html = HEAD_RE.sub(repl, html)
    comentado = em_comentario(html)
    contagem = {"titulo-ilus": 0, "titulo-tab": 0}

    def repl_ilus(m):
        if comentado(m.start()):
            return m.group(0)
        classe = m.group(1)
        contagem[classe] += 1
        prefixo = "ilus" if classe == "titulo-ilus" else "tab"
        return f'<p class="semrec {classe}" id="{prefixo}-{contagem[classe]}">{m.group(2)}</p>'

    return ILUS_RE.sub(repl_ilus, html)


def headings(html):
    """(tag, id, texto) dos títulos do corpo, na ordem do documento."""
    ps, pe = pretextual_span(html)
    out = []
    for m in HEAD_RE.finditer(mascarar(html)):
        if ps <= m.start() < pe:
            continue
        inner = strip_tags(m.group(3))
        if not inner:
            continue
        idm = re.search(r'id="([^"]+)"', m.group(2))
        out.append((m.group(1).lower(), idm.group(1) if idm else "", inner))
    return out


def capa_offset(html):
    """A contagem começa na folha de rosto (Manual p. 47), então a capa não entra no número."""
    return 1 if 'class="capa"' in html else 0


def pagina_de(sid, mapa, html):
    folha = mapa.get(sid)
    return folha - capa_offset(html) if folha else None


def build_toc(html, mapa):
    heads = headings(html)
    # Manual p. 34: os títulos alinham pela margem do indicativo mais extenso. Largura estimada em Times 12:
    # algarismo 6 pt, ponto 3 pt, mais um espaço de 6 pt.
    inds = [re.match(r"^(\d+(?:\.\d+)*)\s", t).group(1) for _, _, t in heads if re.match(r"^\d+(?:\.\d+)*\s", t)]
    largura = max((sum(6 if ch.isdigit() else 3 for ch in i) + 6 for i in inds), default=24) / 72 * 2.54
    linhas, faltou = [], []
    for tag, sid, texto in heads:
        pg = pagina_de(sid, mapa, html)
        if pg is None:
            faltou.append(texto)
        m = re.match(r"^(\d+(?:\.\d+)*)\s+(.*)$", texto)
        ind, tit = (m.group(1), m.group(2)) if m else ("", texto)
        linhas.append(f'  <a class="item n{tag[1]}" href="#{sid}"><span class="ind" style="width: {largura:.2f}cm">{ind}</span>'
                      f'<span class="tit">{tit}<span class="fill"></span></span><span class="pg">{pg or "?"}</span></a>')
    return "\n".join(linhas), faltou


# ---------------- listas ----------------
LISTA_RE = re.compile(r'(<div class="(lista-ilustracoes|lista-tabelas) sumario"(?: data-tipo="([^"]*)")?>)(.*?)(</div>)', re.S)


def itens(html):
    """(classe, id, texto, tipo) de cada título de ilustração e de tabela, na ordem do texto."""
    out = []
    for m in re.finditer(r'<p class="semrec (titulo-ilus|titulo-tab)" id="([^"]+)">(.*?)</p>', mascarar(html), re.S):
        texto = texto_limpo(m.group(3))
        out.append((m.group(1), m.group(2), texto, texto.split(" ", 1)[0]))
    return out


def build_listas(html, mapa):
    """Conteúdo de cada bloco de lista, na ordem em que os blocos aparecem.

    Lista com data-tipo="Quadro" recebe só os itens cuja designação é "Quadro". A lista de ilustrações sem
    data-tipo recebe as ilustrações dos tipos que não têm lista própria (Manual p. 29). A lista de tabelas
    recebe as tabelas."""
    blocos = [(m.group(2), m.group(3)) for m in LISTA_RE.finditer(mascarar(html))]
    tipos_proprios = {t for c, t in blocos if c == "lista-ilustracoes" and t}
    conteudos = []
    for classe, tipo in blocos:
        linhas = []
        for c, sid, texto, desig in itens(html):
            if classe == "lista-tabelas":
                entra = c == "titulo-tab"
            elif tipo:
                entra = c == "titulo-ilus" and desig == tipo
            else:
                entra = c == "titulo-ilus" and desig not in tipos_proprios
            if not entra:
                continue
            pg = pagina_de(sid, mapa, html)
            # Manual p. 30: a segunda linha do título começa sob a primeira palavra do título.
            d, _, tit = texto.partition(" – ")
            ind, tit = (d + " –", tit) if tit else ("", texto)
            linhas.append(f'  <a class="item n0" href="#{sid}"><span class="ind">{htmllib.escape(ind)}</span>'
                          f'<span class="tit">{htmllib.escape(tit)}<span class="fill"></span></span>'
                          f'<span class="pg">{pg or "?"}</span></a>')
        conteudos.append("\n".join(linhas))
    return conteudos


def inject(html, toc_html, listas):
    """Troca o miolo do sumário e de cada lista, nas posições achadas no HTML sem comentários."""
    alvos = []
    toc = re.search(r'<div class="sumario">(.*?)</div>', mascarar(html), re.S)
    if toc:
        alvos.append((toc.start(1), toc.end(1), toc_html))
    alvos += [(m.start(4), m.end(4), l) for m, l in zip(LISTA_RE.finditer(mascarar(html)), listas)]
    for ini, fim, novo in sorted(alvos, reverse=True):
        html = html[:ini] + "\n" + novo + "\n" + html[fim:]
    return html


def estado(html):
    sem = mascarar(html)
    toc = re.search(r'<div class="sumario">(.*?)</div>', sem, re.S)
    return [html[toc.start(1):toc.end(1)].strip() if toc else ""] + \
        [html[m.start(4):m.end(4)].strip() for m in LISTA_RE.finditer(sem)]


# ---------------- principal ----------------
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(1)
    html_path = args[0]
    pdf_path = args[1] if len(args) > 1 else os.path.splitext(html_path)[0] + ".pdf"
    html = open(html_path, encoding="utf-8").read()

    if "--render-only" in flags:
        info = render(html_path, pdf_path)
        print(f"PDF: {pdf_path}  ({info['folhas']} folhas)")
        return

    html = add_ids(html)
    open(html_path, "w", encoding="utf-8").write(html)

    estavel, faltou, info = False, [], None
    for _ in range(5):
        info = render(html_path, pdf_path)
        toc_html, faltou = build_toc(html, info["mapa"])
        listas = build_listas(html, info["mapa"])
        if estado(html) == [toc_html.strip()] + [l.strip() for l in listas]:
            estavel = True
            break
        html = inject(html, toc_html, listas)
        open(html_path, "w", encoding="utf-8").write(html)
    if not estavel:
        info = render(html_path, pdf_path)
    n = len(PdfReader(pdf_path).pages)

    print(f"PDF: {pdf_path}  ({n} folhas)")
    print("Sumário:")
    for tag, sid, texto in headings(html):
        pg = pagina_de(sid, info["mapa"], html)
        print(f"  {str(pg or '?'):>3}  {htmllib.unescape(texto)}")
    lista_itens = itens(html)
    if lista_itens:
        print("Ilustrações e tabelas:")
        for _, sid, texto, _ in lista_itens:
            print(f"  {str(pagina_de(sid, info['mapa'], html) or '?'):>3}  {texto}")
    if faltou:
        print("\nATENÇÃO: títulos sem página no layout (confira a marcação):")
        for f in faltou:
            print("  -", htmllib.unescape(f))
    for p in info.get("partidos", []):
        print(f"\nATENÇÃO: \"{p['titulo']}\" atravessa a folha {p['folha']} do PDF. O manual recomenda tabela numa página "
              "só e, se passar, título e cabeçalho repetidos com (continua), (continuação) e (conclusão) (p. 54, "
              "alíneas i e j). O motor não repete título e cabeçalho: reduza a tabela ou leve ao autor.")
    print("\nSumário e listas alinhados pelo layout." if estavel else
          "\nAviso: a paginação não estabilizou em 5 voltas; rode de novo.")
    if "--tudo" in flags:
        tudo(html_path)


def tudo(html_path):
    """Depois do PDF: a página de leitura, a conferência dela no navegador e o .docx da cópia do Google Docs."""
    sys.path.insert(0, AQUI)
    import artifact
    import google_docs
    print("\n--- Página de leitura (artifact/index.html)")
    sys.argv = [sys.argv[0], html_path]
    artifact.main()
    print("\n--- Conferência da página no navegador", flush=True)
    subprocess.run(["node", os.path.join(AQUI, "conferir.js")], check=True, timeout=600)
    print("\n--- Cópia do Google Docs")
    # As páginas do Google medidas numa versão anterior não valem para o texto novo.
    antigas = os.path.join(os.path.dirname(os.path.abspath(html_path)), "google-paginas.json")
    if os.path.exists(antigas):
        os.remove(antigas)
    docx = google_docs.gerar(html_path)
    print(f"DOCX: {docx}  ({os.path.getsize(docx) // 1024} KB)")
    print("\nPara a cópia do orientador, siga o copia-google-docs.md: subir o .docx no Drive, exportar e conferir.")


if __name__ == "__main__":
    main()
