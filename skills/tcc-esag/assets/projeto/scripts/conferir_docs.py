#!/usr/bin/env python3
"""Confere a cópia do Google Docs contra o PDF do motor, pelo PDF que o Google exporta.

Uso:
    uv run --quiet --with pypdf scripts/conferir_docs.py <exportacao> [tcc.html] [--paginas google-paginas.json]

<exportacao> é o PDF exportado do Google Doc: o .pdf, ou o JSON que a ferramenta do Drive
(download_file_content com exportMimeType application/pdf) salva, com o PDF em base64 no campo "content".

Mostra o número de folhas dos dois PDFs e quantas folhas começam e terminam com as mesmas palavras, e confere
se cada linha do sumário e das listas da cópia aponta a página em que o Google pôs o título. O Google quebra as
linhas um pouco diferente do Chromium (não usa kerning), e um título pode cair uma página antes ou depois.
Quando alguma página está errada, grava google-paginas.json ao lado do .html; o google_docs.py --paginas gera
a cópia com essas páginas. Passe --paginas aqui também ao conferir uma cópia gerada assim.
"""
import base64
import json
import os
import re
import sys
import unicodedata

from pypdf import PdfReader

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import google_docs  # noqa: E402


def ler_pdf(caminho):
    """Aceita o .pdf ou o JSON salvo pela ferramenta do Drive."""
    if caminho.endswith(".pdf"):
        return caminho
    dados = json.load(open(caminho, encoding="utf-8"))
    if isinstance(dados, list):  # resultado salvo como lista de blocos de texto
        dados = json.loads(next(b["text"] for b in dados if b.get("type") == "text"))
    destino = os.path.splitext(caminho)[0] + ".pdf"
    open(destino, "wb").write(base64.b64decode(dados["content"]))
    return destino


def normal(txt):
    txt = unicodedata.normalize("NFKD", txt)
    txt = "".join(c for c in txt if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", txt).strip().lower()


def palavras(pagina):
    return [p for p in (pagina.extract_text() or "").split() if not re.fullmatch(r"\.{2,}", p)]


def entradas(html):
    """Linhas do sumário e das listas: (texto procurado no corpo, página impressa no HTML, tipo, nível)."""
    a = google_docs.Arvore()
    a.feed(html)
    out = []
    for div in google_docs.todos(a.raiz, lambda n: n.tem("sumario")):
        lista = div.tem("lista-ilustracoes") or div.tem("lista-tabelas")
        for item in div.elementos():
            tit = google_docs.texto(google_docs.achar(item, lambda n: n.tem("tit")))
            ind = google_docs.texto(google_docs.achar(item, lambda n: n.tem("ind")))
            pg = google_docs.texto(google_docs.achar(item, lambda n: n.tem("pg")))
            nivel = next((c[1:] for c in item.classes() if re.fullmatch(r"n\d", c)), "0")
            out.append(((ind + " " + tit).strip(), int(pg) if pg.isdigit() else None,
                        "lista" if lista else "titulo", nivel))
    return out


def main():
    argv = sys.argv[1:]
    usadas = None
    if "--paginas" in argv:
        k = argv.index("--paginas")
        usadas = json.load(open(argv[k + 1], encoding="utf-8"))
        del argv[k:k + 2]
    if not argv:
        print(__doc__)
        sys.exit(1)
    google = PdfReader(ler_pdf(argv[0]))
    html_path = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(AQUI), "tcc.html")
    oficial = PdfReader(os.path.splitext(html_path)[0] + ".pdf")
    html = open(html_path, encoding="utf-8").read()

    print(f"Folhas: PDF {len(oficial.pages)}, Google {len(google.pages)}")
    iguais = sum(palavras(a)[:4] == palavras(b)[:4] and palavras(a)[-3:] == palavras(b)[-3:]
                 for a, b in zip(oficial.pages, google.pages))
    print(f"Folhas que começam e terminam com as mesmas palavras: {iguais} de {len(oficial.pages)}")

    # A busca começa na folha que abre com a primeira seção primária, depois do sumário inteiro, e segue em
    # ordem: cada título depois do anterior, e seção primária só no começo da folha. A capa não conta na
    # numeração, então o índice da folha (a capa é o 0) já é a página impressa.
    # O número da página, no cabeçalho, vem antes do texto da folha na extração: sai da frente.
    textos = [re.sub(r"^\d+ ", "", normal(p.extract_text() or "")) for p in google.pages]
    linhas = entradas(html)
    titulos = [e for e in linhas if e[2] == "titulo"]
    if not titulos:
        sys.exit("O HTML não tem sumário preenchido: rode o montar.py antes.")
    primeira = normal(titulos[0][0])[:40]
    corpo = next((i for i, t in enumerate(textos) if t.startswith(primeira)), None)
    if corpo is None:
        sys.exit(f"Não achei no PDF do Google a folha que abre com \"{titulos[0][0]}\".")

    def acha(alvo, inicio, topo):
        chave = normal(alvo)[:60]
        for i in range(inicio, len(textos)):
            if (textos[i].startswith(chave[:40]) if topo else chave in textos[i]):
                return i
        return None

    paginas, ultimo_titulo, ultimo_item = {}, corpo, corpo
    for alvo, _, tipo, nivel in linhas:
        if tipo == "lista":
            paginas[alvo] = acha(alvo, ultimo_item, False)
            ultimo_item = paginas[alvo] or ultimo_item
        else:
            primaria = nivel == "1" or not re.match(r"^\d", alvo)
            paginas[alvo] = acha(alvo, ultimo_titulo, primaria)
            ultimo_titulo = paginas[alvo] or ultimo_titulo

    # A cópia mostra as páginas do PDF, ou as do google-paginas.json quando foi gerada com --paginas.
    mostradas = {alvo: (usadas or {}).get(alvo, pg) for alvo, pg, _, _ in linhas}
    erradas = [(alvo, mostradas[alvo], g) for alvo, g in paginas.items() if g != mostradas[alvo]]
    if not erradas:
        print(f"Sumário e listas da cópia: todas as páginas certas ({len(paginas)} linhas).")
        return
    print(f"Sumário e listas da cópia: {len(erradas)} de {len(paginas)} páginas erradas.")
    for alvo, mostrada, g in erradas:
        print(f"  {alvo[:60]:<60} na cópia {mostrada}, no Google {g if g is not None else 'não achado'}")
    destino = os.path.join(os.path.dirname(os.path.abspath(html_path)), "google-paginas.json")
    json.dump(paginas, open(destino, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Páginas do Google gravadas em {destino}. Gere a cópia com --paginas e suba de novo.")
    sys.exit(1)


if __name__ == "__main__":
    main()
