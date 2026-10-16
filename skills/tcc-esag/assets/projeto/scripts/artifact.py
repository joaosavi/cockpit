#!/usr/bin/env python3
"""Monta o TCC paginado pelo Paged.js, que serve ao Artifact e ao PDF.

Pega o tcc.html, tira o estilo de tela e acrescenta o Paged.js, que monta as folhas A4 com margens,
número de página e quebras. O montar.py imprime essa mesma página em PDF (scripts/paginar.js), então a
página de leitura e o PDF têm as mesmas folhas. A fonte Liberation Serif vai embutida e entra quando a
Times New Roman não está instalada: tem as mesmas medidas, então a paginação não muda. O Artifact do Claude
bloqueia fontes de fora do Google Fonts, por isso a fonte vai dentro da página.

Uso:
    uv run --quiet scripts/artifact.py [arquivo.html]   gera artifact/index.html, com o Paged.js do unpkg
"""
import base64
import os
import pathlib
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTES = os.path.join(RAIZ, "scripts", "fontes")
SAIDA = os.path.join(RAIZ, "artifact")
PAGEDJS_CDN = "https://unpkg.com/pagedjs@0.4.3/dist/paged.min.js"
PAGEDJS_LOCAL = pathlib.Path(RAIZ, "scripts", "vendor", "paged.min.js").as_uri()


def sem_bloco(css, inicio):
    """Remove um bloco @... { ... } inteiro, respeitando chaves aninhadas."""
    i = css.find(inicio)
    while i != -1:
        j = css.index("{", i)
        nivel, k = 1, j + 1
        while nivel:
            nivel += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        css = css[:i] + css[k:]
        i = css.find(inicio)
    return css


def fonte(nome, peso, estilo):
    dados = base64.b64encode(open(os.path.join(FONTES, f"LiberationSerif-{nome}.woff2"), "rb").read()).decode()
    return (f'@font-face {{ font-family: "TCC Serif"; font-weight: {peso}; font-style: {estilo}; '
            f'src: url(data:font/woff2;base64,{dados}) format("woff2"); }}')


CSS_ABNT = os.path.join(RAIZ, "scripts", "abnt-udesc.css")


def gerar(fonte_html, pagedjs):
    """Devolve a página (sem doctype, html, head e body) que pagina o trabalho com o Paged.js indicado.

    A forma vem do scripts/abnt-udesc.css; um <style> no próprio .html, se houver, entra depois dele."""
    css = open(CSS_ABNT, encoding="utf-8").read()
    extra = re.search(r"<style>(.*?)</style>", fonte_html, re.S)
    if extra:
        css += "\n" + extra.group(1)
    corpo = re.search(r"<body>(.*?)</body>", fonte_html, re.S).group(1)
    titulo = re.search(r"<title>(.*?)</title>", fonte_html, re.S)
    titulo = titulo.group(1).strip() if titulo else "TCC"
    css = sem_bloco(css, "@media screen")
    faces = "\n".join([fonte("Regular", 400, "normal"), fonte("Bold", 700, "normal"),
                       fonte("Italic", 400, "italic"), fonte("BoldItalic", 700, "italic")])

    return f"""<title>{titulo}</title>
<style>
  /* Tela: a mesa cinza com as folhas A4 brancas em coluna, como num leitor de PDF. A folha é branca nos dois temas. */
  :root {{ --mesa: #e4e6e9; --papel: #ffffff; --sombra: rgba(24, 32, 44, 0.18); --aviso: #4b5563; --lh: 1.725; --lh1: 1.15; --linha: 20.7pt; }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{ --mesa: #1a1d21; --papel: #ffffff; --sombra: rgba(0, 0, 0, 0.6); --aviso: #a3acb8; color-scheme: dark; }}
  }}
  :root[data-theme="dark"] {{ --mesa: #1a1d21; --papel: #ffffff; --sombra: rgba(0, 0, 0, 0.6); --aviso: #a3acb8; color-scheme: dark; }}
{faces}
  #folhas .pagedjs_page {{ font-family: "Times New Roman", "TCC Serif", "Liberation Serif", serif; font-size: 12pt; line-height: var(--lh); color: #000; text-align: justify; }}
  /* ABNT: a contagem começa na folha de rosto, então a folha da capa não soma no contador do Paged.js. */
  #folhas .pagedjs_page.pagedjs_capa_page {{ --pagedjs-page-counter-increment: 0; }}
  /* O Paged.js justifica a última linha de todo bloco que continua na folha seguinte. Isso serve ao parágrafo
     partido, mas os contêineres passam a regra aos títulos e itens de dentro, que ficariam espalhados. */
  #folhas div[data-split-to], #folhas section[data-split-to], #folhas table[data-split-to],
  #folhas tbody[data-split-to], #folhas tr[data-split-to], #folhas ol[data-split-to] {{ text-align-last: auto; }}
  @media screen {{
    html, body {{ background: var(--mesa); }}
    body {{ padding-inline: 16px; }}
    #folhas .pagedjs_pages {{ display: flex; flex-direction: column; align-items: center; gap: 20px; padding-block: 20px 56px; }}
    #folhas .pagedjs_page {{ background: var(--papel); box-shadow: 0 1px 3px var(--sombra), 0 12px 32px var(--sombra); }}
    #aviso {{ margin: 40px auto; max-width: 32rem; text-align: center; font: 15px/1.5 system-ui, sans-serif; color: var(--aviso); }}
  }}
  @media print {{
    html, body {{ background: #fff; }}
    body {{ margin: 0; padding: 0; }}
    #aviso {{ display: none; }}
    #folhas .pagedjs_pages {{ display: block; padding: 0; zoom: 1 !important; }}
  }}
</style>
<p id="aviso">Montando as folhas do documento…</p>
<div id="folhas"></div>
<template id="conteudo">
{corpo}
</template>
<script type="text/plain" id="estilo-tcc">
{css}
</script>
<script src="{pagedjs}"></script>
<script>
  // Encolhe as folhas para caber na largura do celular, sem rolagem lateral.
  function ajustarFolhas() {{
    var folhas = document.querySelector("#folhas .pagedjs_pages");
    var folha = document.querySelector("#folhas .pagedjs_page");
    if (!folhas || !folha) return;
    folhas.style.zoom = 1;
    var largura = folha.getBoundingClientRect().width;
    var disponivel = document.documentElement.clientWidth - 32;
    folhas.style.zoom = Math.min(1, disponivel / largura);
  }}
  var aviso = document.getElementById("aviso");
  try {{
    var conteudo = document.getElementById("conteudo").content;
    var estilo = document.getElementById("estilo-tcc").textContent;
    new PagedModule.Previewer()
      .preview(conteudo, [{{ "tcc.css": estilo }}], document.getElementById("folhas"))
      .then(function () {{ aviso.hidden = true; ajustarFolhas(); }})
      .catch(function () {{ aviso.textContent = "Não foi possível montar as folhas. Recarregue a página."; }});
  }} catch (erro) {{
    aviso.textContent = "Não foi possível montar as folhas. Recarregue a página.";
  }}
  window.addEventListener("resize", ajustarFolhas);
</script>
"""


def documento_padrao():
    """O .html do trabalho na raiz do projeto: o que tem a meta "modelo" (tcc.html ou trabalho.html)."""
    candidatos = [f for f in sorted(os.listdir(RAIZ)) if f.endswith(".html")]
    for f in candidatos:
        if '<meta name="modelo"' in open(os.path.join(RAIZ, f), encoding="utf-8").read():
            return os.path.join(RAIZ, f)
    return os.path.join(RAIZ, "tcc.html")


def main():
    caminho = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else documento_padrao()
    fonte_html = open(caminho, encoding="utf-8").read()
    pagina = gerar(fonte_html, PAGEDJS_CDN)
    os.makedirs(SAIDA, exist_ok=True)
    open(os.path.join(SAIDA, "index.html"), "w", encoding="utf-8").write(pagina)
    print(f"{len(pagina) // 1024} KB em {SAIDA}/index.html, a partir de {os.path.basename(caminho)}")


if __name__ == "__main__":
    main()
