// Confere o artifact/index.html no navegador, em tempo real: quantas folhas o Paged.js montou, se os
// títulos sem número ficaram centralizados e se há rolagem lateral. Use antes de publicar a página.
// O modo de tempo virtual do navegador sem tela trava o Paged.js; por isso a conferência roda em tempo real.
// Uso: node scripts/conferir.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { abrirNavegador } = require('./navegador');

(async () => {
  const raiz = path.resolve(__dirname, '..');
  const pagina = fs.readFileSync(path.join(raiz, 'artifact', 'index.html'), 'utf8')
    .replace('https://unpkg.com/pagedjs@0.4.3/dist/paged.min.js', pathToFileURL(path.join(raiz, 'scripts', 'vendor', 'paged.min.js')).href);
  const tmp = path.join(raiz, '.conferir.html');
  fs.writeFileSync(tmp, '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + pagina + '</body></html>');
  const navegador = await abrirNavegador();
  try {
    for (const [nome, largura] of [['computador', 1100], ['celular', 412]]) {
      const p = await navegador.newPage({ viewport: { width: largura, height: 1200 } });
      await p.goto(pathToFileURL(tmp).href);
      await p.waitForFunction(() => document.getElementById('aviso').hidden, null, { timeout: 120000 });
      const r = await p.evaluate(() => ({
        folhas: document.querySelectorAll('#folhas .pagedjs_page').length,
        titulosTortos: Array.from(document.querySelectorAll('#folhas h1.pre')).filter(h => getComputedStyle(h).textAlignLast === 'justify').map(h => h.innerText),
        rolagemLateral: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      console.log(nome + ':', JSON.stringify(r));
      await p.close();
    }
  } finally {
    await navegador.close();
    fs.unlinkSync(tmp);
  }
})().catch((erro) => { console.error(erro.message); process.exit(1); });
