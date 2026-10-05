#!/usr/bin/env python3
"""Gera o .docx que o Google Docs importa com a formatação do PDF, para a cópia que vai ao orientador.

O HTML continua sendo a fonte. Este .docx serve só para a cópia no Google Docs: o Google converte .docx com
margens, estilos, seções, cabeçalho e notas de rodapé, e perde quase tudo de um HTML.

Uso:
    python3 scripts/google_docs.py tcc.html [tcc.docx] [--paginas google-paginas.json]

--paginas troca, no sumário e nas listas, a página do PDF pela página em que o Google pôs o título. O arquivo
sai do scripts/conferir_docs.py, que lê o PDF exportado da cópia já enviada.

Rode depois do montar.py, que deixa o sumário e as listas com as páginas do PDF. O montar.py --tudo já chama
este script.

O que vem do layout, e não de regra fixa: a posição de cada linha da capa e da folha de rosto, a largura das
colunas de cada tabela e o tamanho de cada imagem saem do Paged.js, pelo scripts/medir.js. O pontilhado do
sumário é texto, porque o Google ignora a guia pontilhada do Word; a quantidade de pontos sai das larguras
da Liberation Serif, que tem as medidas da Times New Roman, em scripts/fontes/larguras.json. Usa só a
biblioteca padrão do Python.
"""
import json
import os
import re
import subprocess
import sys
import zipfile
from html import escape
from html.parser import HTMLParser

AQUI = os.path.dirname(os.path.abspath(__file__))
LARGURAS = json.load(open(os.path.join(AQUI, "fontes", "larguras.json"), encoding="utf-8"))

# Medidas. Twip: 1/20 de ponto (1 cm = 567). Tamanho de fonte do Word: meio ponto (12 pt = 24). EMU: 1/12700 pt.
CM = 567
PT = 20
EMU = 12700
LINHA = 414  # 20,7 pt: uma linha de entrelinha 1,5 em Times 12, a var(--linha) do CSS
LARGURA = 21 * CM - 3 * CM - 2 * CM  # área útil de 16 cm
FOLGA_PONTOS = 6.0  # pontos a menos no pontilhado, para a linha nunca quebrar no Google
RECUO_NOTA = round(0.35 * CM)  # expoente pendurado da nota de rodapé, como no CSS


# ---------- árvore HTML (comentários ficam de fora, como no motor) ----------
VAZIOS = {"meta", "br", "img", "hr", "link", "input"}


class No:
    def __init__(self, tag, attrs, pai=None):
        self.tag, self.attrs, self.pai, self.filhos = tag, dict(attrs), pai, []

    def classes(self):
        return set(self.attrs.get("class", "").split())

    def tem(self, classe):
        return classe in self.classes()

    def elementos(self):
        return [f for f in self.filhos if isinstance(f, No)]

    def dentro_de(self, classe):
        n = self.pai
        while n is not None:
            if n.tem(classe):
                return True
            n = n.pai
        return False


class Arvore(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.raiz = No("#doc", {})
        self.atual = self.raiz

    def handle_starttag(self, tag, attrs):
        no = No(tag, attrs, self.atual)
        self.atual.filhos.append(no)
        if tag not in VAZIOS:
            self.atual = no

    def handle_endtag(self, tag):
        n = self.atual
        while n is not self.raiz and n.tag != tag:
            n = n.pai
        if n is not self.raiz:
            self.atual = n.pai

    def handle_data(self, data):
        self.atual.filhos.append(data)


def achar(no, pred):
    for f in no.elementos():
        if pred(f):
            return f
        r = achar(f, pred)
        if r:
            return r
    return None


def todos(no, pred):
    out = []
    for f in no.elementos():
        if pred(f):
            out.append(f)
        out.extend(todos(f, pred))
    return out


# ---------- texto ----------
NOTA = "\x00nota:"  # marca, dentro de um trecho, o lugar da chamada de uma nota de rodapé


class Notas:
    """As notas de rodapé do documento, na ordem em que aparecem; cada span.nota vira uma nota do Word."""

    def __init__(self):
        self.lista, self.vistas = [], {}

    def registrar(self, no):
        if id(no) not in self.vistas:
            self.lista.append(no)
            self.vistas[id(no)] = len(self.lista)
        return self.vistas[id(no)]


NOTAS = Notas()


def trechos(no, negrito=False, italico=False, maiusc=False, pular=("ul", "ol")):
    """Lista de (texto, negrito, itálico) do conteúdo inline de um nó, com o espaço do HTML colapsado.

    Uma nota de rodapé vira um trecho de marca, e listas aninhadas (subalíneas) ficam de fora."""
    out = []
    for f in no.filhos:
        if isinstance(f, str):
            t = re.sub(r"\s+", " ", f)
            out.append((t.upper() if maiusc else t, negrito, italico))
        elif f.tag == "br":
            out.append(("\n", negrito, italico))
        elif f.tag == "span" and f.tem("nota"):
            out.append((NOTA + str(NOTAS.registrar(f)), False, False))
        elif f.tag in pular:
            continue
        else:
            b = (negrito or f.tag in ("strong", "b")) and not f.tem("sub")
            i = italico or f.tag in ("em", "i")
            out.extend(trechos(f, b, i, maiusc, pular))
    while out and not out[0][0].strip():
        out.pop(0)
    while out and not out[-1][0].strip():
        out.pop()
    if out and not out[0][0].startswith(NOTA):
        out[0] = (out[0][0].lstrip(), *out[0][1:])
    if out and not out[-1][0].startswith(NOTA):
        out[-1] = (out[-1][0].rstrip(), *out[-1][1:])
    return out


def texto(no, maiusc=False):
    return "".join(t for t, _, _ in trechos(no, maiusc=maiusc) if not t.startswith(NOTA)) if no is not None else ""


def largura_pt(txt, negrito=False, italico=False, tam=12):
    nome = ("Bold" if negrito else "") + ("Italic" if italico else "") or "Regular"
    tabela = LARGURAS[nome]
    return sum(tabela.get(c, 500) for c in txt) * tam / 1000


def letra(k):
    """Letra da alínea: a, b, ..., z, aa, ab (Manual p. 50: letras dobradas quando o alfabeto acaba)."""
    base = "abcdefghijklmnopqrstuvwxyz"
    return base[k] if k < 26 else base[k // 26 - 1] + base[k % 26]


# ---------- XML do Word ----------
def r_xml(txt, negrito=False, italico=False, tam=None, cor=None, link=False):
    if txt.startswith(NOTA):
        n = txt[len(NOTA):]
        return f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="{n}"/></w:r>'
    rpr = ("<w:b/>" if negrito else "") + ("<w:i/>" if italico else "")
    if cor or link:
        rpr += f'<w:color w:val="{cor or "000000"}"/>'
    if tam:
        rpr += f'<w:sz w:val="{tam}"/><w:szCs w:val="{tam}"/>'
    if link:
        rpr += '<w:u w:val="none"/>'
    rpr = f"<w:rPr>{rpr}</w:rPr>" if rpr else ""
    xml = ""
    for k, linha in enumerate(txt.split("\n")):
        if k:
            xml += f"<w:r>{rpr}<w:br/></w:r>"
        for j, parte in enumerate(linha.split("\t")):
            if j:
                xml += f"<w:r>{rpr}<w:tab/></w:r>"
            if parte:
                xml += f'<w:r>{rpr}<w:t xml:space="preserve">{escape(parte, quote=False)}</w:t></w:r>'
    return xml


def runs_xml(rs, tam=None, cor=None, link=False):
    return "".join(r_xml(t, b, i, tam, cor, link) for t, b, i in rs)


def espaco(antes=0, depois=0, simples=False):
    linha = ' w:line="240" w:lineRule="auto"' if simples else ""
    return f'<w:spacing w:before="{antes}" w:after="{depois}"{linha}/>'


SEM_RECUO = '<w:ind w:firstLine="0"/>'
CENTRO = '<w:jc w:val="center"/>'
ESQUERDA = '<w:jc w:val="left"/>'
JUSTIFICADO = '<w:jc w:val="both"/>'


def recuo(esquerda=0, pendente=0, direita=0):
    d = f' w:right="{direita}"' if direita else ""
    if pendente:
        return f'<w:ind w:left="{esquerda}"{d} w:hanging="{pendente}"/>'
    return f'<w:ind w:left="{esquerda}"{d} w:firstLine="0"/>'


def guias(*esquerda, direita=None):
    """Guias à esquerda nas posições dadas e, se pedida, uma guia à direita."""
    xml = "".join(f'<w:tab w:val="left" w:pos="{p}"/>' for p in esquerda if p)
    if direita:
        xml += f'<w:tab w:val="right" w:pos="{direita}"/>'
    return f"<w:tabs>{xml}</w:tabs>" if xml else ""


def largura_css(no, padrao_cm):
    """Largura em twips de um style="width: 1.23cm" do HTML (a coluna do indicativo no sumário)."""
    m = re.search(r"width:\s*([\d.]+)cm", no.attrs.get("style", "")) if no is not None else None
    return round(float(m.group(1)) * CM) if m else round(padrao_cm * CM)


class Documento:
    """Monta o corpo do document.xml em ordem, com as margens verticais colapsadas como no CSS."""

    def __init__(self, medidas, base, paginas=None):
        self.medidas = medidas
        self.base = base  # pasta do .html, para achar as imagens
        self.paginas = paginas or {}
        self.xml = []
        self.depois = 0  # espaço depois do último parágrafo, em twips
        self.tabela = 0
        self.imagem = 0
        self.imagens = []  # (nome no pacote, bytes)
        self.marcador = 0

    def p(self, conteudo, antes=0, depois=0, simples=False, quebra=False, colapsa=True, manter=False,
          tabs="", ind="", jc="", estilo=None):
        # O CSS colapsa a margem de baixo de um bloco com a de cima do seguinte e fica com a maior; o Word
        # e o Google somam as duas. Por isso o espaço antes desconta o que o parágrafo anterior já deu.
        if colapsa and not quebra:
            antes = max(0, antes - self.depois)
        # Os filhos do w:pPr seguem a ordem do esquema do Word.
        ppr = (f'<w:pStyle w:val="{estilo}"/>' if estilo else "") + ("<w:keepNext/>" if manter else "")
        ppr += ("<w:pageBreakBefore/>" if quebra else "") + tabs + espaco(antes, depois, simples) + ind + jc
        self.xml.append(f"<w:p><w:pPr>{ppr}</w:pPr>{conteudo}</w:p>")
        self.depois = depois

    def fecha_secao(self, sect):
        """Põe a quebra de seção no último parágrafo, sem parágrafo vazio que empurraria uma folha a mais."""
        self.xml[-1] = self.xml[-1].replace("</w:pPr>", sect + "</w:pPr>", 1)

    # --- capa e folha de rosto: posição medida no Paged.js ---
    def folha(self, secao, medidas, capa):
        ps = todos(secao, lambda n: n.tag == "p")
        if len(ps) != len(medidas):
            sys.exit(f"medir.js achou {len(medidas)} parágrafos e o HTML tem {len(ps)} em {secao.attrs.get('class')}")
        vaos = [m["topo"] - (medidas[k - 1]["base"] if k else 0) for k, m in enumerate(medidas)]
        local = next(k for k, p in enumerate(ps) if p.dentro_de("local"))
        for k, (p, vao) in enumerate(zip(ps, vaos)):
            # Tira 6 pt do vão que empurra o local e o ano para o pé da folha (margin-top: auto): a soma
            # dos arredondamentos não pode passar da área útil, ou o ano cairia na folha seguinte.
            antes = max(0, round((vao - (6 if k == local else 0)) * PT))
            if p.dentro_de("natureza"):
                self.p(runs_xml(trechos(p)), antes=antes, simples=True, colapsa=False,
                       ind=recuo(8 * CM), jc=JUSTIFICADO)
            else:
                negrito = capa or any(p.dentro_de(c) or p.tem(c) for c in ("autor", "titulo", "local"))
                # Em maiúsculas e negrito como no CSS, menos o subtítulo (span.sub), que sai sem negrito.
                self.p(runs_xml(trechos_sub(p, negrito)), antes=antes, colapsa=False, ind=SEM_RECUO, jc=CENTRO)

    # --- pré-textuais ---
    def titulo_pre(self, h):
        self.p(r_xml(texto(h, maiusc=True), negrito=True), depois=LINHA, quebra=True, manter=True,
               ind=SEM_RECUO, jc=CENTRO)

    def quebrar(self, txt, negrito, italico, largura):
        """Quebra o título em linhas pela largura da fonte."""
        linhas, atual = [], ""
        for palavra in txt.split(" "):
            tenta = (atual + " " + palavra).strip()
            if atual and largura_pt(tenta, negrito, italico) > largura:
                linhas.append(atual)
                atual = palavra
            else:
                atual = tenta
        linhas.append(atual)
        return linhas

    def sumario(self, div, lista):
        """Sumário ou lista: indicativo, título inteiro, pontilhado e a página na margem direita.

        O título longo quebra em linhas que deixam 1 cm livre à direita e alinham sob a primeira letra do
        título (no sumário) ou da primeira palavra do título (nas listas, Manual p. 30); o pontilhado preenche
        o resto da última linha. O Google ignora a guia pontilhada do Word, por isso os pontos são texto,
        contados pela largura da fonte com uma folga de 6 pt.
        """
        for a in div.elementos():
            nivel = next((c[1:] for c in a.classes() if re.fullmatch(r"n\d", c)), "0")
            negrito, italico = nivel in ("1", "3"), nivel == "4"
            no_ind = achar(a, lambda n: n.tem("ind"))
            ind_html = texto(no_ind)
            tit_html = texto(achar(a, lambda n: n.tem("tit")))
            tit = tit_html.upper() if nivel in ("1", "2") else tit_html
            ind = ind_html.upper() if nivel in ("1", "2") else ind_html
            if lista:
                rec = round((largura_pt(ind_html + " ") + 0.3 * 12) * PT) if ind_html else 0
            else:
                rec = largura_css(no_ind, 1.3)
            disponivel = (LARGURA - rec) / PT
            pg = texto(achar(a, lambda n: n.tem("pg")))
            pg = str(self.paginas.get((ind_html + " " + tit_html).strip(), pg))
            linhas = self.quebrar(tit, negrito, italico, disponivel - CM / PT)
            vao = (disponivel - largura_pt(linhas[-1] + " ", negrito, italico)
                   - largura_pt(pg, negrito, italico) - FOLGA_PONTOS)
            pontos = "." * max(3, int(vao // largura_pt(".")))
            ancora = ancora_de(a.attrs.get("href", ""))
            link = ancora is not None
            rs = [(ind + "\t", negrito, italico)] if rec else []
            rs.append(("\n".join(linhas) + " ", negrito, italico))
            corpo = runs_xml(rs, link=link) + r_xml(pontos, link=link) + r_xml("\t" + pg, negrito, italico, link=link)
            if link:
                corpo = f'<w:hyperlink w:anchor="{ancora}">{corpo}</w:hyperlink>'
            self.p(corpo, tabs=guias(rec, direita=LARGURA), ind=recuo(rec, rec), jc=ESQUERDA)

    # --- tabelas ---
    def tab(self, t, tipo):
        """tipo: "siglas", "quadro" (bordas fechadas, 12 e 1,5) ou "tabela" (IBGE: fios em cima, sob o
        cabeçalho e no fim; 12 e simples)."""
        larg = self.medidas["tabelas"][self.tabela]
        self.tabela += 1
        linhas = todos(t, lambda n: n.tag == "tr")
        fio = 'w:val="single" w:sz="6" w:space="0" w:color="000000"'
        sem = 'w:val="nil"'
        if tipo == "siglas":
            tw = [round(w * PT) for w in larg]
            bordas = "".join(f"<w:{b} {sem}/>" for b in ("top", "left", "bottom", "right", "insideH", "insideV"))
            margem = ('<w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>'
                      '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="240" w:type="dxa"/>')
        else:
            # A tabela ocupa a largura útil; as colunas mantêm a proporção que o navegador calculou.
            tw = [round(w * LARGURA / sum(larg)) for w in larg]
            tw[-1] = LARGURA - sum(tw[:-1])
            if tipo == "quadro":
                bordas = "".join(f"<w:{x} {fio}/>" for x in ("top", "left", "bottom", "right", "insideH", "insideV"))
            else:
                bordas = (f"<w:top {fio}/><w:left {sem}/><w:bottom {fio}/><w:right {sem}/>"
                          f"<w:insideH {sem}/><w:insideV {sem}/>")
            margem = ('<w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
                      '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>')
        xml = [f'<w:tbl><w:tblPr><w:tblW w:w="{sum(tw)}" w:type="dxa"/><w:tblBorders>{bordas}</w:tblBorders>'
               f'<w:tblLayout w:type="fixed"/><w:tblCellMar>{margem}</w:tblCellMar></w:tblPr>'
               "<w:tblGrid>" + "".join(f'<w:gridCol w:w="{w}"/>' for w in tw) + "</w:tblGrid>"]
        for k, tr in enumerate(linhas):
            cabecalho = any(c.tag == "th" for c in tr.elementos())
            xml.append("<w:tr><w:trPr><w:cantSplit/>" + ("<w:tblHeader/>" if cabecalho else "") + "</w:trPr>")
            # break-inside: avoid na ilustração: cada linha segura a seguinte na mesma folha.
            manter = "<w:keepNext/>" if tipo != "siglas" and k < len(linhas) - 1 else ""
            for j, c in enumerate(tr.elementos()):
                tcpr = f'<w:tcW w:w="{tw[j]}" w:type="dxa"/>'
                if tipo == "tabela" and cabecalho:
                    tcpr += f"<w:tcBorders><w:bottom {fio}/></w:tcBorders>"
                if tipo == "siglas":
                    par = f"<w:p><w:pPr>{espaco()}{SEM_RECUO}{ESQUERDA}</w:pPr>{runs_xml(trechos(c))}</w:p>"
                else:
                    par = (f"<w:p><w:pPr>{manter}{espaco(simples=tipo == 'tabela')}{SEM_RECUO}{ESQUERDA}</w:pPr>"
                           f'{runs_xml(trechos(c, negrito=c.tag == "th"))}</w:p>')
                xml.append(f"<w:tc><w:tcPr>{tcpr}</w:tcPr>{par}</w:tc>")
            xml.append("</w:tr>")
        xml.append("</w:tbl>")
        self.xml.append("".join(xml))
        self.depois = 0

    # --- imagem ---
    def img(self, no):
        medida = self.medidas["imagens"][self.imagem]
        self.imagem += 1
        caminho = os.path.join(self.base, no.attrs.get("src", ""))
        if not os.path.exists(caminho):
            sys.exit(f"imagem não encontrada: {caminho}")
        ext = os.path.splitext(caminho)[1].lower().lstrip(".").replace("jpg", "jpeg")
        nome = f"imagem{self.imagem}.{ext}"
        self.imagens.append((nome, open(caminho, "rb").read()))
        cx, cy = round(medida["largura"] * EMU), round(medida["altura"] * EMU)
        alt = escape(no.attrs.get("alt", ""), quote=True)
        k = self.imagem
        desenho = (
            f'<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
            f'<wp:docPr id="{k}" name="Imagem {k}" descr="{alt}"/>'
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:nvPicPr><pic:cNvPr id="{k}" name="{nome}" descr="{alt}"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="rIdImagem{k}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>'
            "</wp:inline></w:drawing></w:r>")
        self.p(desenho, simples=True, manter=True, ind=SEM_RECUO, jc=CENTRO)
        return round(medida["largura"] * PT)

    # --- corpo ---
    def titulo(self, h):
        nivel = int(h.tag[1])
        ind, tit = achar(h, lambda n: n.tem("ind")), achar(h, lambda n: n.tem("tit"))
        ancora = ancora_de("#" + h.attrs["id"]) if h.attrs.get("id") else None
        if ind is None:  # Referências e apêndices: sem indicativo, centralizados, e entram no sumário
            corpo, tabs, ind_xml, jc = runs_xml(trechos(h, negrito=True, maiusc=True)), "", SEM_RECUO, CENTRO
        else:
            negrito, italico = nivel in (1, 3), nivel == 4
            ind_txt = texto(ind)
            # O indicativo e o título ficam lado a lado, com 0,3em entre eles, e a segunda linha do título
            # alinha sob a primeira letra do título (display: flex no CSS).
            rec = round((largura_pt(ind_txt, negrito, italico) + 0.3 * 12) * PT)
            rs = [(ind_txt + "\t", negrito, italico)] + trechos(tit, negrito, italico, maiusc=nivel <= 2)
            corpo, tabs, ind_xml, jc = runs_xml(rs), guias(rec), recuo(rec, rec), ESQUERDA
        if ancora:
            self.marcador += 1
            corpo = f'<w:bookmarkStart w:id="{self.marcador}" w:name="{ancora}"/>{corpo}<w:bookmarkEnd w:id="{self.marcador}"/>'
        self.p(corpo, antes=0 if nivel == 1 else LINHA, depois=LINHA, quebra=nivel == 1, manter=True,
               tabs=tabs, ind=ind_xml, jc=jc, estilo=f"Heading{nivel}")

    def paragrafo(self, f):
        pendente = f.tem("pendente")
        semrec = f.tem("semrec") or f.tem("resumo") or f.tem("palavras-chave")
        self.p(runs_xml(trechos(f, italico=pendente), cor="555555" if pendente else None),
               antes=LINHA if f.tem("palavras-chave") else 0, ind=SEM_RECUO if semrec else "")

    def alineas(self, ol):
        """Alíneas (Manual p. 50): a letra sai do CSS no PDF e aqui do conversor; texto a 1,85 cm, letra a
        1,25 cm. Subalíneas: travessão e espaço, recuadas em relação à alínea."""
        for k, li in enumerate(ol.elementos()):
            self.p(runs_xml([(letra(k) + ")\t", False, False)] + trechos(li)), tabs=guias(round(1.85 * CM)),
                   ind=recuo(round(1.85 * CM), round(0.6 * CM)))
            for sub in li.elementos():
                if sub.tag == "ul" and sub.tem("subalineas"):
                    for s in sub.elementos():
                        self.p(runs_xml([("–\t", False, False)] + trechos(s)), tabs=guias(round(2.35 * CM)),
                               ind=recuo(round(2.35 * CM), round(0.5 * CM)))

    def corpo(self, nos):
        for f in nos:
            if f.tag in ("h1", "h2", "h3", "h4", "h5"):
                self.titulo(f)
            elif f.tag == "p":
                self.paragrafo(f)
            elif f.tag == "ol" and f.tem("alineas"):
                self.alineas(f)
            elif f.tag == "blockquote":
                self.p(runs_xml(trechos(f), tam=20), antes=LINHA, depois=LINHA, simples=True, ind=recuo(4 * CM))
            elif f.tag == "div" and f.tem("ilustracao"):
                self.ilustracao(f)
            elif f.tag == "div" and f.tem("refs"):
                for p in f.elementos():
                    self.p(runs_xml(trechos(p)), depois=276, simples=True, ind=SEM_RECUO, jc=ESQUERDA)
            elif f.tag in ("section", "div"):
                self.corpo(f.elementos())

    def ilustracao(self, div):
        filhos = div.elementos()
        tipo = "tabela" if div.tem("tabela") else "quadro"
        # Imagem: título e fonte respeitam as margens da ilustração (NBR 14724, 5.8), então os parágrafos
        # ganham recuo dos dois lados até a largura da imagem.
        lados = 0
        if div.tem("figura"):
            imgs = [g for g in filhos if g.tag == "img"]
            if imgs:
                medida = self.medidas["imagens"][self.imagem]
                lados = max(0, round((LARGURA - medida["largura"] * PT) / 2))
        for k, g in enumerate(filhos):
            if g.tag == "table":
                self.tab(g, tipo)
            elif g.tag == "img":
                self.img(g)
            elif g.tem("titulo-ilus") or g.tem("titulo-tab"):
                self.p(runs_xml(trechos(g)), antes=LINHA if k == 0 else 0, manter=True,
                       ind=recuo(lados, direita=lados) if lados else SEM_RECUO, jc=CENTRO)
            elif g.tem("fonte"):
                fim = k == len(filhos) - 1
                self.p(runs_xml(trechos(g), tam=20), antes=60, depois=LINHA if fim else 0, simples=True,
                       ind=recuo(lados, direita=lados) if lados else SEM_RECUO, jc=CENTRO)

    def pretextuais(self, div):
        for sec in div.elementos():
            for g in sec.elementos():
                if g.tag == "h1":
                    self.titulo_pre(g)
                elif g.tag == "p":
                    self.paragrafo(g)
                elif g.tag == "div" and g.tem("sumario"):
                    self.sumario(g, lista=g.tem("lista-ilustracoes") or g.tem("lista-tabelas"))
                elif g.tag == "table":
                    self.tab(g, "siglas" if g.tem("siglas") else "quadro")


def trechos_sub(p, negrito):
    """Trechos da linha de capa ou de folha de rosto, com o span.sub (subtítulo) sem negrito."""
    out = []
    for f in p.filhos:
        if isinstance(f, str):
            out.append((re.sub(r"\s+", " ", f).upper() if negrito else re.sub(r"\s+", " ", f), negrito, False))
        elif f.tag == "span" and f.tem("sub"):
            out.extend((t, False, i) for t, _, i in trechos(f, maiusc=negrito))
        else:
            out.extend(trechos(f, negrito, False, maiusc=negrito))
    while out and not out[0][0].strip():
        out.pop(0)
    while out and not out[-1][0].strip():
        out.pop()
    if out:
        out[0] = (out[0][0].lstrip(), *out[0][1:])
        out[-1] = (out[-1][0].rstrip(), *out[-1][1:])
    return out


def ancora_de(href):
    """O Word só aceita letra, número e sublinhado no nome do marcador: #sec-1-2 vira sec_1_2."""
    nome = href.lstrip("#").replace("-", "_")
    return nome if re.fullmatch(r"[A-Za-z]\w*", nome) else None


def sect(cabecalho, inicio=None):
    pg = f'<w:pgNumType w:start="{inicio}"/>' if inicio is not None else ""
    return (f'<w:sectPr><w:headerReference w:type="default" r:id="{cabecalho}"/><w:type w:val="nextPage"/>'
            '<w:pgSz w:w="11906" w:h="16838"/>'
            f'<w:pgMar w:top="{3 * CM}" w:right="{2 * CM}" w:bottom="{2 * CM}" w:left="{3 * CM}" '
            f'w:header="{2 * CM}" w:footer="{CM}" w:gutter="0"/>{pg}</w:sectPr>')


def nota_xml(n, no):
    """Uma nota de rodapé (Manual p. 44): 10 pt, espaçamento simples, expoente pendurado; a nota de
    referência (classe "ref") alinha à esquerda, a explicativa justifica."""
    jc = ESQUERDA if no.tem("ref") else JUSTIFICADO
    return (f'<w:footnote w:id="{n}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/>'
            f'<w:tabs><w:tab w:val="left" w:pos="{RECUO_NOTA}"/></w:tabs>{jc}</w:pPr>'
            '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>'
            f'<w:r><w:tab/></w:r>{runs_xml(trechos(no))}</w:p></w:footnote>')


def montar_corpo(html, medidas, base, paginas=None):
    global NOTAS
    NOTAS = Notas()
    a = Arvore()
    a.feed(html)
    body = achar(a.raiz, lambda n: n.tag == "body")
    doc = Documento(medidas, base, paginas)
    corpo = []
    for f in body.elementos():
        if f.tem("capa"):
            doc.folha(f, medidas["capa"], capa=True)
            doc.fecha_secao(sect("rIdVazio"))  # 1: capa, sem número e fora da contagem
        elif f.tem("rosto"):
            doc.folha(f, medidas["rosto"], capa=False)
        elif f.tem("pretextual"):
            doc.pretextuais(f)
            doc.fecha_secao(sect("rIdVazio", inicio=1))  # 2: a contagem começa na folha de rosto
        else:
            corpo.append(f)
    doc.corpo(corpo)  # 3: corpo, com o número da página
    if doc.tabela != len(medidas["tabelas"]):
        sys.exit(f"medir.js achou {len(medidas['tabelas'])} tabelas e o conversor usou {doc.tabela}")
    if doc.imagem != len(medidas["imagens"]):
        sys.exit(f"medir.js achou {len(medidas['imagens'])} imagens e o conversor usou {doc.imagem}")
    notas = "".join(nota_xml(k, no) for k, no in enumerate(NOTAS.lista, start=1))
    return "".join(doc.xml), notas, doc.imagens


# ---------- pacote .docx ----------
NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
NS_DOC = NS + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
TIMES = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>'
P10 = '<w:sz w:val="20"/><w:szCs w:val="20"/>'


def estilo_titulo(nivel, rpr):
    # Os títulos usam os estilos Título 1 a 5 do Google, que alimentam o esquema lateral.
    return (f'<w:style w:type="paragraph" w:styleId="Heading{nivel}"><w:name w:val="heading {nivel}"/>'
            f'<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
            f'<w:pPr><w:keepNext/>{SEM_RECUO}<w:jc w:val="left"/><w:outlineLvl w:val="{nivel - 1}"/></w:pPr>'
            f"<w:rPr>{rpr}</w:rPr></w:style>")


ESTILOS = XML + f"""<w:styles {NS}>
<w:docDefaults><w:rPrDefault><w:rPr>{TIMES}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr>{espaco()}</w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>
<w:pPr><w:widowControl/><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="{round(1.25 * CM)}"/><w:jc w:val="both"/></w:pPr>
<w:rPr>{TIMES}<w:color w:val="000000"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
{estilo_titulo(1, "<w:b/>")}
{estilo_titulo(2, "")}
{estilo_titulo(3, "<w:b/>")}
{estilo_titulo(4, "<w:i/>")}
{estilo_titulo(5, "")}
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/>
<w:pPr>{espaco(simples=True)}{SEM_RECUO}<w:jc w:val="right"/></w:pPr><w:rPr>{P10}</w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/>
<w:pPr>{espaco(simples=True)}<w:ind w:left="{RECUO_NOTA}" w:hanging="{RECUO_NOTA}"/><w:jc w:val="both"/></w:pPr><w:rPr>{P10}</w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
</w:styles>"""

CAMPO = lambda tipo: f'<w:r><w:rPr>{P10}</w:rPr><w:fldChar w:fldCharType="{tipo}"/></w:r>'
CABECALHO_NUMERO = XML + (
    f'<w:hdr {NS}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>{CAMPO("begin")}'
    f'<w:r><w:rPr>{P10}</w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>{CAMPO("separate")}'
    f'<w:r><w:rPr>{P10}</w:rPr><w:t>1</w:t></w:r>{CAMPO("end")}</w:p></w:hdr>')
CABECALHO_VAZIO = XML + f'<w:hdr {NS}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p></w:hdr>'
CONFIG = XML + (f'<w:settings {NS}><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>'
                '<w:defaultTabStop w:val="709"/><w:characterSpacingControl w:val="doNotCompress"/></w:settings>')
SEPARADORES = ('<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>'
               '</w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>'
               '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" '
               'w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>')


def tipos(imagens):
    exts = sorted({nome.rsplit(".", 1)[1] for nome, _ in imagens})
    padrao = "".join(f'<Default Extension="{e}" ContentType="image/{e}"/>' for e in exts)
    return XML + f"""<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{padrao}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>"""


RELACOES = XML + """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""


def relacoes_doc(imagens):
    imgs = "".join(f'<Relationship Id="rIdImagem{k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                   f'relationships/image" Target="media/{nome}"/>' for k, (nome, _) in enumerate(imagens, start=1))
    return XML + f"""<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
<Relationship Id="rIdNumero" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdVazio" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>{imgs}
</Relationships>"""


def medir(html_path):
    """Roda o scripts/medir.js na mesma página paginada que vira PDF e Artifact."""
    sys.path.insert(0, AQUI)
    import artifact
    html_abs = os.path.abspath(html_path)
    pagina = artifact.gerar(open(html_abs, encoding="utf-8").read(), artifact.PAGEDJS_LOCAL)
    tmp = os.path.join(os.path.dirname(html_abs), ".medir.html")
    open(tmp, "w", encoding="utf-8").write(
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body>' + pagina + "</body></html>")
    try:
        saida = subprocess.run(["node", os.path.join(AQUI, "medir.js"), tmp],
                               capture_output=True, text=True, check=True, timeout=300).stdout
    finally:
        os.remove(tmp)
    return json.loads(saida)


def gerar(html_path, docx_path=None, paginas_path=None):
    docx_path = docx_path or os.path.splitext(html_path)[0] + ".docx"
    html = open(html_path, encoding="utf-8").read()
    paginas = json.load(open(paginas_path, encoding="utf-8")) if paginas_path else None
    base = os.path.dirname(os.path.abspath(html_path))
    corpo, notas, imagens = montar_corpo(html, medir(html_path), base, paginas)
    documento = XML + f"<w:document {NS_DOC}><w:body>{corpo}{sect('rIdNumero')}</w:body></w:document>"
    with zipfile.ZipFile(docx_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("[Content_Types].xml", tipos(imagens))
        z.writestr("_rels/.rels", RELACOES)
        z.writestr("word/_rels/document.xml.rels", relacoes_doc(imagens))
        z.writestr("word/document.xml", documento)
        z.writestr("word/styles.xml", ESTILOS)
        z.writestr("word/settings.xml", CONFIG)
        z.writestr("word/footnotes.xml", XML + f"<w:footnotes {NS}>{SEPARADORES}{notas}</w:footnotes>")
        z.writestr("word/header1.xml", CABECALHO_NUMERO)
        z.writestr("word/header2.xml", CABECALHO_VAZIO)
        for nome, dados in imagens:
            z.writestr(f"word/media/{nome}", dados)
    return docx_path


def main():
    argv = sys.argv[1:]
    paginas = None
    if "--paginas" in argv:
        k = argv.index("--paginas")
        paginas = argv[k + 1]
        del argv[k:k + 2]
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(1)
    destino = gerar(args[0], args[1] if len(args) > 1 else None, paginas)
    print(f"DOCX: {destino}  ({os.path.getsize(destino) // 1024} KB)")


if __name__ == "__main__":
    main()
