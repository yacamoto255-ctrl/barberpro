'use strict';

// "1.234,56" -> 1234.56 | "0,0802" -> 0.0802
function num(s) {
  if (s == null || String(s).trim() === '') return null;
  const n = Number(String(s).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const NUM = '([\\d.]*\\d,\\d+)';
const PAR = `${NUM}(?:\\s*/\\s*${NUM})?`; // "a" ou "a/b"

function pick(text, re) {
  const m = text.match(re);
  return m ? m : null;
}

// Tela 101 (resultado). \s* aceita espaço, tab ou quebra de linha entre rótulo e valor.
function parseSituacao(text) {
  const t = String(text || '').replace(/ /g, ' ');
  const avisos = [];

  const ctrc = pick(t, /CTRC\s*\/\s*Subc\.?\s*\/\s*RPS\s*:?\s*([A-Z]{3}\d+-\d)/i);
  const frete = pick(t, new RegExp(`Valor\\s+frete\\s*\\(R\\$\\)\\s*:?\\s*${NUM}`, 'i'));
  const cub = pick(t, new RegExp(`Cubagem\\s*/\\s*Cub\\s*Orig\\s*\\(m[³3]\\)\\s*:?\\s*${PAR}`, 'i'));
  const pCalc = pick(t, new RegExp(`Peso\\s+c[aá]lculo\\s*\\(Kg\\)\\s*:?\\s*${NUM}`, 'i'));
  const pReal = pick(t, new RegExp(`Peso\\s+real\\s*/\\s*Peso\\s+real\\s+orig\\s*\\(Kg\\)\\s*:?\\s*${PAR}`, 'i'));
  const vNF = pick(t, new RegExp(`Valor\\s+da\\s+Nota\\s+Fiscal\\s*:?\\s*${NUM}`, 'i'));
  const vol = pick(t, /Qtde\.?\s+de\s+vol\.?\s*\/\s*pares\s*:?\s*(\d+)\s*\/\s*(\d+)/i);

  const r = {
    ctrc: ctrc ? ctrc[1] : null,
    frete: frete ? num(frete[1]) : null,
    cubagemM3: cub ? num(cub[1]) : null,
    cubagemOrigM3: cub && cub[2] ? num(cub[2]) : null,
    pesoCalculoKg: pCalc ? num(pCalc[1]) : null,
    pesoRealKg: pReal ? num(pReal[1]) : null,
    pesoRealOrigKg: pReal && pReal[2] ? num(pReal[2]) : null,
    valorNF: vNF ? num(vNF[1]) : null,
    volumes: vol ? Number(vol[1]) : null,
  };
  if (r.frete == null) avisos.push('Valor do frete não encontrado na tela.');
  if (r.cubagemM3 == null) avisos.push('Cubagem não encontrada na tela.');
  return { ...r, avisos };
}

// Popup de cubagem: linhas "n altura largura comprimento vezes total" (medidas em metros)
function parseCubagem(text) {
  const t = String(text || '').replace(/ /g, ' ');
  const ctrc = pick(t, /CTRC\s*:\s*([A-Z]{3}\d+-\d)/i);
  const idx = t.search(/TOTAL/i);
  const tokens = (idx >= 0 ? t.slice(idx + 5) : t).split(/\s+/).filter(Boolean);

  const dec = /^\d+,\d+$/;
  const linhas = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^\d{1,2}$/.test(tokens[i]) && tokens.slice(i + 1, i + 6).length === 5 &&
        tokens.slice(i + 1, i + 6).every((x) => dec.test(x))) {
      const [a, l, c, v, tot] = tokens.slice(i + 1, i + 6).map(num);
      linhas.push({
        linha: Number(tokens[i]),
        alturaM: a, larguraM: l, comprimentoM: c, vezes: v, totalM3: tot,
        // conferência: a×l×c×vezes deve bater com o TOTAL exibido pelo SSW
        calculadoM3: Math.round(a * l * c * v * 10000) / 10000,
      });
      i += 5;
    }
  }
  const totalM3 = linhas.length ? Math.round(linhas.reduce((s, x) => s + x.totalM3, 0) * 10000) / 10000 : null;
  return { ctrc: ctrc ? ctrc[1] : null, linhas, totalM3 };
}

module.exports = { num, parseSituacao, parseCubagem };
