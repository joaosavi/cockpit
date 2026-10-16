// Pagina o HTML com o Paged.js, imprime o PDF e escreve na saída padrão, em JSON, a folha em que caiu cada
// título (id sec-*), cada ilustração (ilus-*) e cada tabela (tab-*), lida do próprio layout.
// O PDF sai marcado (tagged), com as marcas estruturais que o Repositório pede (Manual p. 141), e com
// marcadores de navegação.
// Uso: node scripts/paginar.js <entrada.html> <saida.pdf>
const path = require('path');
const { pathToFileURL } = require('url');
const { abrirNavegador } = require('./navegador');

(async () => {
  const [entrada, saida] = process.argv.slice(2);
  const navegador = await abrirNavegador();
  try {
    const pagina = await navegador.newPage();
    await pagina.goto(pathToFileURL(path.resolve(entrada)).href);
    await pagina.waitForFunction(() => document.getElementById('aviso').hidden, null, { timeout: 120000 });
    const info = await pagina.evaluate(() => {
      const folhas = Array.from(document.querySelectorAll('#folhas .pagedjs_page'));
      const folha = (el) => folhas.indexOf(el.closest('.pagedjs_page')) + 1;
      const mapa = {};
      document.querySelectorAll('#folhas [id]').forEach((el) => {
        if (/^(sec|ilus|tab)-/.test(el.id) && !(el.id in mapa)) mapa[el.id] = folha(el);
      });
      const partidos = Array.from(document.querySelectorAll('#folhas .ilustracao[data-split-to]')).map((el) => {
        const t = el.querySelector('.titulo-ilus, .titulo-tab');
        return { titulo: t ? t.textContent.trim() : '?', folha: folha(el) };
      });
      return { folhas: folhas.length, mapa, partidos };
    });
    await pagina.pdf({ path: saida, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
    process.stdout.write(JSON.stringify(info) + '\n');
  } finally {
    await navegador.close();
  }
})().catch((erro) => { console.error(erro.message); process.exit(1); });
