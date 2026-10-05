# {{TITULO}}

Projeto do {{MODELO_NOME}}, no padrão do Manual de Trabalhos Acadêmicos da UDESC, para escrever com o
Claude Code. A forma já está pronta: capa, folha de rosto, margens, fonte, títulos, sumário com a página real,
listas, notas de rodapé, citações e referências. O autor escreve só o texto, no `tcc.html`.

## Comece

Você precisa do Claude Code, do Node.js 20 ou mais novo e do Python 3 com `uv` ou `pip`. Abra um terminal na
pasta, rode `claude` e peça:

```text
Leia o AGENTS.md e o HANDOFF.md e siga o primeiro passo.
```

Na primeira sessão, o Claude instala o que falta, gera o PDF do modelo e faz as perguntas da ficha do
trabalho, uma por vez.

## Gere e confira o PDF sem o Claude

```bash
cd scripts && npm install && npx playwright install chromium-headless-shell && cd ..
uv run --quiet --with pypdf python3 scripts/montar.py tcc.html
python3 scripts/checar.py tcc.html
uv run --quiet --with pdfplumber --with pypdf python3 scripts/conferir_pdf.py tcc.pdf
```

Sem `uv`, rode `pip install pypdf pdfplumber` uma vez e use `python3` direto. O `checar.py` confere o texto;
o `conferir_pdf.py` mede o PDF pronto e sai com erro quando algo foge do manual. Se o navegador baixado não
abrir, o `scripts/navegador.js` tenta o Google Chrome e o Microsoft Edge instalados; para outro navegador,
aponte a variável `CHROME_PATH` para o executável.

## Onde está cada coisa

- `AGENTS.md`: as instruções que o agente lê em toda sessão. O `CLAUDE.md` aponta para ele.
- `fontes/fontes-oficiais.md`: os sites da ESAG, da BU e do Repositório, os formulários, o cronograma, as
  normas e as bases de pesquisa, com a data em que cada link foi conferido.
- `normas/abnt-udesc.md`: as regras de formatação, citação e referência, cada uma com a página do manual.
- `scripts/abnt-udesc.css`: a formatação inteira, com a regra e a página do manual ao lado de cada bloco.
- `scripts/teste/exemplo-elementos.html`: um documento com todos os elementos, para consultar a marcação.
- `revisao/roteiro.md`: o pedido e a lista da revisão independente.
- `copia-google-docs.md`: o passo a passo da cópia no Google Docs que vai ao orientador.
{{README_GUIA}}

O PDF sai marcado, mas não em PDF/A, e o Repositório Institucional pede PDF/A com marcas estruturais na versão
final do TCC: converta o PDF final com outra ferramenta que mantenha as marcas. As cópias em `normas/` foram baixadas em outubro de 2026: o regulamento é de agosto de 2025 e o
manual, de junho de 2025. Antes de entregar, confira nos links de `fontes/fontes-oficiais.md` se há
versão nova.
