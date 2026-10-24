#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { abrirNavegador, consultar } = require('./robo');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const valorFlag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const nrs = args.filter((a) => !a.startsWith('--'));

if (flag('ajuda') || flag('help')) {
  console.log(`Uso: node src/cli.js [NR ...] [opções]
  Sem NR: modo interativo (digite um NR por linha, linha vazia encerra).
  --json            saída em JSON
  --csv=arquivo     grava CSV (ex.: --csv=saida/fretes.csv)
  --fator=300       fator de cubagem kg/m³ (padrão 300)
  --debug           salva HTML/print/texto de cada consulta em ./debug
  --headless        sem janela (só funciona com sessão já logada)`);
  process.exit(0);
}

const fmt = (n, d = 2) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: 4 }));

function imprimir(r) {
  console.log('\n' + '='.repeat(60));
  console.log(`NR: ${r.nr}   CTRC: ${r.ctrc || '—'}`);
  if (r.erro) { console.log(`ERRO: ${r.erro}`); if (r.debugDir) console.log(`Debug salvo em: ${r.debugDir}`); return; }
  console.log(`Frete (R$):            ${fmt(r.frete)}`);
  console.log(`Cubagem (m³):          ${fmt(r.cubagemM3, 4)}  (orig: ${fmt(r.cubagemOrigM3, 4)})`);
  console.log(`Peso real (Kg):        ${fmt(r.pesoRealKg, 3)}`);
  console.log(`Peso cálculo SSW (Kg): ${fmt(r.pesoCalculoKg, 3)}`);
  console.log(`Peso cubado (Kg):      ${fmt(r.pesoCubadoKg, 3)}  (= m³ × ${r.fatorCubagem} kg/m³)`);
  if (r.medidas && r.medidas.length) {
    console.log('Medidas (metros):');
    console.log('  #   Altura  Largura  Comprim.  Vezes   Total m³');
    for (const m of r.medidas) {
      console.log(`  ${m.linha}   ${fmt(m.alturaM, 3)}   ${fmt(m.larguraM, 3)}    ${fmt(m.comprimentoM, 3)}    ${fmt(m.vezes)}   ${fmt(m.totalM3, 4)}`);
    }
  }
  for (const a of r.avisos) console.log(`AVISO: ${a}`);
  if (r.debugDir) console.log(`Debug salvo em: ${r.debugDir}`);
}

function csv(resultados) {
  const cab = ['nr', 'ctrc', 'frete', 'cubagem_m3', 'cubagem_orig_m3', 'peso_real_kg', 'peso_calculo_kg', 'peso_cubado_kg', 'medidas', 'erro'];
  // números com vírgula decimal para o Excel pt-BR
  const esc = (v) => `"${String(typeof v === 'number' ? String(v).replace('.', ',') : v ?? '').replace(/"/g, '""')}"`;
  const linhas = resultados.map((r) => [
    r.nr, r.ctrc, r.frete, r.cubagemM3, r.cubagemOrigM3, r.pesoRealKg, r.pesoCalculoKg, r.pesoCubadoKg,
    (r.medidas || []).map((m) => `${fmt(m.alturaM, 3)} x ${fmt(m.larguraM, 3)} x ${fmt(m.comprimentoM, 3)} x ${fmt(m.vezes)} = ${fmt(m.totalM3, 4)}`).join(' | '), r.erro,
  ].map(esc).join(';'));
  return [cab.join(';'), ...linhas].join('\n') + '\n';
}

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const perguntar = (q) => new Promise((res) => rl.question(q, res));
  const context = await abrirNavegador({ headless: flag('headless') });
  const aguardarLogin = async () => {
    console.log('\nSessão SSW não está logada. Faça login na janela do navegador e depois volte aqui.');
    await perguntar('Pressione ENTER quando estiver logado... ');
  };
  const opts = { fatorCubagem: Number(valorFlag('fator', 300)), debug: flag('debug'), aguardarLogin };
  const resultados = [];
  try {
    const lista = [...nrs];
    if (!lista.length) {
      for (;;) {
        const nr = (await perguntar('\nNR (vazio para sair): ')).trim();
        if (!nr) break;
        const r = await consultar(context, nr, opts);
        resultados.push(r); flag('json') ? console.log(JSON.stringify(r, null, 2)) : imprimir(r);
      }
    } else {
      for (const nr of lista) {
        const r = await consultar(context, nr, opts);
        resultados.push(r); flag('json') ? console.log(JSON.stringify(r, null, 2)) : imprimir(r);
      }
    }
    const arq = valorFlag('csv');
    if (arq && resultados.length) {
      fs.mkdirSync(path.dirname(path.resolve(arq)), { recursive: true });
      fs.writeFileSync(arq, '﻿' + csv(resultados));
      console.log(`\nCSV gravado em ${arq}`);
    }
  } finally {
    rl.close();
    await context.close();
  }
  process.exit(resultados.some((r) => r.erro) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
