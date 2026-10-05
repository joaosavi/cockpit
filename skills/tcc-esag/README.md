# tcc-esag: o TCC de Administração da ESAG/UDESC no Claude Code

Skill do Claude Code que monta o projeto do seu TCC de Administração da ESAG/UDESC com a formatação da UDESC
pronta e conferida. Você escreve o conteúdo; capa, folha de rosto, margens, fonte, títulos, sumário com a página
real, listas, notas de rodapé, citações, referências, o PDF e a cópia no Google Docs para o orientador saem
prontos. O projeto também traz as instruções que o Claude segue em cada sessão, o regulamento, o Manual da
UDESC, os links oficiais da ESAG e da BU conferidos e um roteiro de revisão.

Serve às seis variantes de TCC do regulamento (pesquisa com dados primários, pesquisa com dados secundários,
plano, projeto, consultoria e inovação). A consultoria tem o modelo mais completo e um guia de leitura
(`assets/projeto/GUIA.md`).

## Instale

Você precisa de:

- Claude Code, com uma conta do Claude que dê acesso a ele;
- Node.js 20 ou mais novo;
- Python 3, com `uv` ou `pip`;
- o conector do Google Drive ligado no Claude, só se quiser a cópia do Google Docs para o orientador.

Copie esta pasta, com o nome `tcc-esag`, para a pasta de skills do Claude Code no seu usuário:

- macOS e Linux: `~/.claude/skills/tcc-esag`
- Windows: `%USERPROFILE%\.claude\skills\tcc-esag`

Abra uma sessão nova do Claude Code depois de copiar. A skill aparece com o nome `tcc-esag`.

## Comece o seu TCC

1. Abra o Claude Code na pasta onde você guarda os trabalhos da faculdade.
2. Peça: "Use a skill tcc-esag para criar meu TCC de consultoria na pasta tcc". Troque "consultoria" pela sua
   modalidade.
3. Abra o Claude Code de novo, dentro da pasta criada, e peça: "Leia o AGENTS.md e o HANDOFF.md e siga o
   primeiro passo."

Na primeira sessão, o Claude instala o que falta, gera o PDF do modelo e faz as perguntas da ficha do TCC, uma
por vez. Nas seguintes, basta pedir: "Leia o HANDOFF.md e siga o primeiro passo."

## O que fica de fora

- O PDF sai marcado para acessibilidade, mas não em PDF/A. O Repositório da UDESC pede PDF/A na versão final:
  converta com uma ferramenta que mantenha as marcas.
- Tabela que passa de uma página não repete título e cabeçalho sozinha; o script avisa quando isso acontece.
- Artigo científico tem formatação própria no manual e não tem modelo aqui.

As regras de formatação, com a página do manual de cada uma, estão em `assets/projeto/normas/abnt-udesc.md`.
Os links oficiais, com a data em que foram conferidos, estão em `assets/projeto/fontes/fontes-oficiais.md`.
Regulamento, cronograma e formulários mudam a cada semestre: antes de entregar, confira nos links se há
versão nova.
