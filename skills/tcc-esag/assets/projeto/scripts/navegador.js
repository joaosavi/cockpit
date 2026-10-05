// Abre o Chromium para paginar e conferir o TCC. Tenta, em ordem: o caminho em CHROME_PATH, o navegador
// baixado por `npx playwright install chromium-headless-shell`, o Google Chrome e o Microsoft Edge do sistema.
const { chromium } = require('playwright');

async function abrirNavegador() {
  const tentativas = [
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : null,
    {},
    { channel: 'chrome' },
    { channel: 'msedge' },
  ].filter(Boolean);
  const erros = [];
  for (const opcoes of tentativas) {
    try {
      return await chromium.launch({ ...opcoes, args: ['--no-sandbox'] });
    } catch (erro) {
      erros.push(erro.message.split('\n')[0]);
    }
  }
  throw new Error('Nenhum navegador abriu. Rode "npx playwright install chromium-headless-shell" dentro de scripts/, '
    + 'ou aponte CHROME_PATH para um Chrome instalado.\n' + erros.join('\n'));
}

module.exports = { abrirNavegador };
