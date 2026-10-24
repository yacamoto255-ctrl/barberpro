'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { parseSituacao, parseCubagem } = require('./parse');

const BASE = () => process.env.SSW_BASE_URL || 'https://sistema.ssw.inf.br';
const LABEL_NR = "contains(normalize-space(text()),'NR1, NR2 ou NR')";
const XP_CAMPO_NR = `xpath=(//*[${LABEL_NR}]/following::input[not(@type='hidden')])[1]`;
const XP_BOTAO_NR = `xpath=(//*[${LABEL_NR}]/following::*[self::a or self::img or self::button or self::input[@type='image' or @type='button' or @type='submit']])[1]`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrirNavegador({ headless = false, perfil = path.join(__dirname, '..', '.perfil') } = {}) {
  return chromium.launchPersistentContext(perfil, { headless, viewport: { width: 1280, height: 900 } });
}

// Procura um texto em todas as abas/popups e todos os frames. Devolve { page, frame, texto }.
async function esperarTexto(context, regex, timeoutMs) {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    for (const page of context.pages()) {
      for (const frame of page.frames()) {
        try {
          const texto = await frame.locator('body').innerText({ timeout: 1500 });
          if (regex.test(texto)) return { page, frame, texto };
        } catch (_) { /* frame navegando */ }
      }
    }
    await sleep(300);
  }
  return null;
}

async function acharCampoNR(page, timeoutMs) {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    for (const frame of page.frames()) {
      const campo = frame.locator(XP_CAMPO_NR).first();
      if (await campo.count().catch(() => 0)) return { frame, campo };
    }
    await sleep(300);
  }
  return null;
}

async function dump(context, nr, motivo, dir = path.join(__dirname, '..', 'debug')) {
  const pasta = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${String(nr).replace(/\W/g, '')}`);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'motivo.txt'), motivo || '');
  let i = 0;
  for (const page of context.pages()) {
    i++;
    await page.screenshot({ path: path.join(pasta, `aba${i}.png`), fullPage: true }).catch(() => {});
    let j = 0;
    for (const frame of page.frames()) {
      j++;
      const html = await frame.content().catch(() => '');
      const txt = await frame.locator('body').innerText({ timeout: 1500 }).catch(() => '');
      fs.writeFileSync(path.join(pasta, `aba${i}-frame${j}.html`), html);
      fs.writeFileSync(path.join(pasta, `aba${i}-frame${j}.txt`), txt);
    }
  }
  return pasta;
}

// Abre a opção 101 e garante que o campo NR está disponível (pede login manual se preciso).
async function prepararTela101(context, { aguardarLogin } = {}) {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${BASE()}/bin/ssw0053`, { waitUntil: 'domcontentloaded' });
  let achou = await acharCampoNR(page, 6000);
  if (!achou && aguardarLogin) {
    await aguardarLogin();
    await page.goto(`${BASE()}/bin/ssw0053`, { waitUntil: 'domcontentloaded' });
    achou = await acharCampoNR(page, 8000);
  }
  if (!achou) throw new Error('Campo "NR1, NR2 ou NR" não encontrado (sessão sem login ou tela diferente do esperado).');
  return page;
}

async function consultar(context, nr, opts = {}) {
  const { fatorCubagem = 300, timeoutMs = 25000, debug = false, aguardarLogin } = opts;
  const valor = String(nr).trim();
  const resultado = { nr: valor, ok: false, avisos: [] };
  if (!/^\d{6,}$/.test(valor)) {
    resultado.erro = `NR inválido: "${valor}" (esperado só dígitos, mínimo 6).`;
    return resultado;
  }
  try {
    const page = await prepararTela101(context, { aguardarLogin });
    const { campo } = await acharCampoNR(page, 3000);
    await campo.click();
    await campo.fill(valor);
    await campo.press('Enter');

    let res = await esperarTexto(context, /Dados do CTRC/i, 5000);
    if (!res) { // Enter não submeteu: clica no ▶ da linha
      for (const frame of page.frames()) {
        const botao = frame.locator(XP_BOTAO_NR).first();
        if (await botao.count().catch(() => 0)) { await botao.click().catch(() => {}); break; }
      }
      res = await esperarTexto(context, /Dados do CTRC/i, timeoutMs);
    }
    if (!res) throw new Error('Tela do CTRC não apareceu (NR inexistente no período pesquisado ou tela diferente).');

    Object.assign(resultado, parseSituacao(res.texto));
    resultado.avisos = [...resultado.avisos];

    // Clica em "Cubagem" para abrir as medidas
    const popupP = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
    const link = res.frame.getByText(/Cubagem\s*\/\s*Cub\s*Orig/i).first();
    if (await link.count()) {
      await link.click();
      await popupP;
      const cub = await esperarTexto(context, /Dimens[õo]es em metros/i, 15000);
      if (cub) {
        const med = parseCubagem(cub.texto);
        resultado.medidas = med.linhas;
        resultado.cubagemTotalMedidasM3 = med.totalM3;
        for (const l of med.linhas) {
          if (Math.abs(l.calculadoM3 - l.totalM3) > 0.0001) {
            resultado.avisos.push(`Linha ${l.linha}: A×L×C×vezes=${l.calculadoM3} difere do TOTAL ${l.totalM3} exibido no SSW.`);
          }
        }
        if (!med.linhas.length) resultado.avisos.push('Popup de cubagem abriu mas nenhuma medida foi lida.');
        if (cub.page !== res.page) await cub.page.close().catch(() => {});
      } else {
        resultado.avisos.push('Não consegui abrir o detalhe de cubagem (medidas).');
      }
    } else {
      resultado.avisos.push('Link "Cubagem" não encontrado na tela.');
    }

    const m3 = resultado.cubagemM3 ?? resultado.cubagemTotalMedidasM3;
    if (m3 != null) {
      resultado.fatorCubagem = fatorCubagem;
      resultado.pesoCubadoKg = Math.round(m3 * fatorCubagem * 1000) / 1000;
    }
    resultado.ok = resultado.frete != null;
    if (debug) resultado.debugDir = await dump(context, valor, 'debug solicitado');
  } catch (e) {
    resultado.erro = e.message;
    resultado.debugDir = await dump(context, valor, e.stack || e.message).catch(() => undefined);
  }
  // fecha abas extras (popups) mantendo a principal
  for (const p of context.pages().slice(1)) await p.close().catch(() => {});
  return resultado;
}

module.exports = { abrirNavegador, consultar, esperarTexto };
