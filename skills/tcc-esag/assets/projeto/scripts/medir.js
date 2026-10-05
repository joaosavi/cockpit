// Mede no layout do Paged.js o que o .docx da cópia do Google Docs precisa copiar: a posição de cada
// parágrafo da capa e da folha de rosto, a largura das colunas de cada tabela e o tamanho de cada imagem.
// Imprime JSON, com as medidas em pontos.
// Uso: node scripts/medir.js <pagina-paginada.html>
const path = require('path');
const { abrirNavegador } = require('./navegador');

(async () => {
  const [entrada] = process.argv.slice(2);
  const navegador = await abrirNavegador();
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1400, height: 1200 } });
    await pagina.goto('file://' + path.resolve(entrada));
    await pagina.waitForFunction(() => document.getElementById('aviso').hidden, null, { timeout: 120000 });
    const medidas = await pagina.evaluate(() => {
      // A área útil da folha tem 16 cm; a razão converte o pixel da tela em ponto, com ou sem zoom.
      const area = document.querySelector('#folhas .pagedjs_area').getBoundingClientRect();
      const pt = (16 / 2.54 * 72) / area.width;
      const blocos = (seletor) => {
        const secao = document.querySelector('#folhas section' + seletor);
        if (!secao) return [];
        const topo = secao.getBoundingClientRect().top;
        return Array.from(secao.querySelectorAll('p')).map((p) => {
          const r = p.getBoundingClientRect();
          return { topo: (r.top - topo) * pt, base: (r.bottom - topo) * pt };
        });
      };
      const tabelas = Array.from(document.querySelectorAll('#folhas table:not([data-split-from])')).map((t) => {
        const linha = t.querySelector('tr');
        return Array.from(linha.children).map((c) => c.getBoundingClientRect().width * pt);
      });
      const imagens = Array.from(document.querySelectorAll('#folhas .ilustracao img')).map((i) => {
        const r = i.getBoundingClientRect();
        return { largura: r.width * pt, altura: r.height * pt };
      });
      return { capa: blocos('.capa'), rosto: blocos('.rosto'), tabelas, imagens };
    });
    process.stdout.write(JSON.stringify(medidas));
  } finally {
    await navegador.close();
  }
})().catch((erro) => { console.error(erro.message); process.exit(1); });
