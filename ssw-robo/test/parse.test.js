'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { num, parseSituacao, parseCubagem } = require('../src/parse');

// Texto baseado no print real da tela 101 (valores do CTRC SAO492881-4)
const LINHA = `CTRC /Subc./RPS: SAO492881-4 CONTROLADO
Qtde. de vol./pares: 3/0 Conferente coleta: 1017 CASSIO DE
Peso cálculo (Kg): 93,000 Espécie de mercadoria: 001-DIVERSOS
Peso real /Peso real orig (Kg): 93,000/93,0000 Cubagem/Cub Orig (m³): 0,0802/0,0900
Valor da Nota Fiscal: 450,00 Frete original:
Valor frete (R$): 269,73 Situação de liquidação: LIQUIDADO
ICMS/ISS (R$): 18,88 IBS/CBS (R$): 2,28`;
const CELULAS = LINHA.replace(/: /g, ':\n').replace(/ (?=[A-Z])/g, '\n\t');

test('num: formatos pt-BR', () => {
  assert.equal(num('0,0802'), 0.0802);
  assert.equal(num('1.234,56'), 1234.56);
  assert.equal(num('93,000'), 93);
  assert.equal(num(''), null);
  assert.equal(num(null), null);
  assert.equal(num('abc'), null);
});

for (const [nome, txt] of [['linha corrida', LINHA], ['célula por linha', CELULAS]]) {
  test(`parseSituacao (${nome})`, () => {
    const r = parseSituacao(txt);
    assert.equal(r.ctrc, 'SAO492881-4');
    assert.equal(r.frete, 269.73);          // NÃO pode confundir com ICMS 18,88 nem NF 450,00
    assert.equal(r.valorNF, 450);
    assert.equal(r.cubagemM3, 0.0802);
    assert.equal(r.cubagemOrigM3, 0.09);
    assert.equal(r.pesoCalculoKg, 93);
    assert.equal(r.pesoRealKg, 93);
    assert.equal(r.volumes, 3);
    assert.deepEqual(r.avisos, []);
  });
}

test('parseSituacao: texto vazio/sem campos gera avisos, não quebra', () => {
  for (const x of ['', null, undefined, 'qualquer coisa <script>alert(1)</script>']) {
    const r = parseSituacao(x);
    assert.equal(r.frete, null);
    assert.equal(r.avisos.length, 2);
  }
});

test('parseSituacao: frete com milhar', () => {
  assert.equal(parseSituacao('Valor frete (R$): 12.345,67').frete, 12345.67);
});

const POPUP_TAB = `CTRC:\tSAO492881-4\tDimensões em metros
\tAltura\tLargura\tComprim\tVezes\tTOTAL
1\t0,450\t0,270\t0,220\t3,00\t0,0802
2
3
4
5
6`;
const POPUP_CELULAS = 'CTRC: SAO492881-4\nDimensões em metros\nAltura\nLargura\nComprim\nVezes\nTOTAL\n1\n0,450\n0,270\n0,220\n3,00\n0,0802\n2\n3\n4\n5\n6';

for (const [nome, txt] of [['tabulado', POPUP_TAB], ['uma célula por linha', POPUP_CELULAS]]) {
  test(`parseCubagem (${nome})`, () => {
    const r = parseCubagem(txt);
    assert.equal(r.ctrc, 'SAO492881-4');
    assert.equal(r.linhas.length, 1);
    const l = r.linhas[0];
    assert.deepEqual([l.alturaM, l.larguraM, l.comprimentoM, l.vezes, l.totalM3], [0.45, 0.27, 0.22, 3, 0.0802]);
    assert.equal(l.calculadoM3, 0.0802);    // 0,45×0,27×0,22×3 = 0,08019 → confere com o SSW
    assert.equal(r.totalM3, 0.0802);
  });
}

test('parseCubagem: várias linhas somam, vazio não quebra', () => {
  const r = parseCubagem('TOTAL\n1 0,5 0,5 0,5 2,00 0,2500\n2 1,0 1,0 1,0 1,00 1,0000\n3');
  assert.equal(r.linhas.length, 2);
  assert.equal(r.totalM3, 1.25);
  assert.deepEqual(parseCubagem('').linhas, []);
  assert.equal(parseCubagem(null).totalM3, null);
});
