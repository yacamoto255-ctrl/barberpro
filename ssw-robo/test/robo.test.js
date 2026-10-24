'use strict';
// Testa o fluxo do robô (campo NR -> resultado -> clique em Cubagem -> popup) contra um servidor
// local que imita as telas do SSW dos prints. NÃO substitui um teste no SSW real.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { abrirNavegador, consultar } = require('../src/robo');

const FORM = (modo) => `<!doctype html><meta charset=utf-8><title>101 - Situação do CTRC</title>
<table>
<tr><td>Nota Fiscal (série opc/número):</td><td><input id=nf></td><td><a href="#">▶</a></td></tr>
<tr><td>NR1, NR2 ou NR:</td><td><input id=nr type=text></td><td><a href="#" id=go>▶</a></td></tr>
<tr><td>CT-e/NFS-e:</td><td><input id=cte></td><td><a href="#">▶</a></td></tr>
</table>
<script>
const ir = () => { location.href = '/bin/ssw0053.44?nr=' + encodeURIComponent(document.getElementById('nr').value); };
${modo === 'botao' ? '' : "document.getElementById('nr').addEventListener('keydown', e => { if (e.key === 'Enter') ir(); });"}
document.getElementById('go').addEventListener('click', e => { e.preventDefault(); ir(); });
</script>`;

const RESULTADO = (nr) => nr === '99999999999999'
  ? '<!doctype html><meta charset=utf-8><body>Nenhum CTRC encontrado.'
  : `<!doctype html><meta charset=utf-8><body><b>Dados do CTRC:</b>
<table>
<tr><td>CTRC /Subc./RPS:</td><td>SAO492881-4</td></tr>
<tr><td>Qtde. de vol./pares:</td><td>3/0</td></tr>
<tr><td>Peso cálculo (Kg):</td><td>93,000</td></tr>
<tr><td>Peso real /Peso real orig (Kg):</td><td>93,000/93,0000</td></tr>
<tr><td><a href="#" id=cub onclick="window.open('/bin/ssw0053.cub','cub','width=500,height=300');return false">Cubagem/Cub Orig (m³):</a></td><td>0,0802/0,0900</td></tr>
<tr><td>Valor da Nota Fiscal:</td><td>450,00</td></tr>
<tr><td>Valor frete (R$):</td><td>269,73</td></tr>
<tr><td>ICMS/ISS (R$):</td><td>18,88</td></tr>
</table>`;

const POPUP = `<!doctype html><meta charset=utf-8><body>
<table><tr><td>CTRC:</td><td>SAO492881-4</td><td>Dimensões em metros</td></tr>
<tr><th>Altura</th><th>Largura</th><th>Comprim</th><th>Vezes</th><th>TOTAL</th></tr>
<tr><td>1</td><td>0,450</td><td>0,270</td><td>0,220</td><td>3,00</td><td>0,0802</td></tr>
<tr><td>2</td></tr><tr><td>3</td></tr></table>`;

let server, base;
test.before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (u.pathname === '/bin/ssw0053') return res.end(FORM());
    if (u.pathname === '/bin/ssw0053.44') return res.end(RESULTADO(u.searchParams.get('nr')));
    if (u.pathname === '/bin/ssw0053.cub') return res.end(POPUP);
    res.statusCode = 404; res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.SSW_BASE_URL = base;
});
test.after(() => server.close());

async function comNavegador(fn) {
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'ssw-robo-'));
  const ctx = await abrirNavegador({ headless: true, perfil });
  try { await fn(ctx); } finally { await ctx.close(); fs.rmSync(perfil, { recursive: true, force: true }); }
}

test('fluxo completo: preenche NR, lê frete/cubagem e medidas do popup', async () => {
  await comNavegador(async (ctx) => {
    const r = await consultar(ctx, '00246554672514', { timeoutMs: 8000 });
    assert.equal(r.erro, undefined);
    assert.equal(r.ok, true);
    assert.equal(r.ctrc, 'SAO492881-4');
    assert.equal(r.frete, 269.73);
    assert.equal(r.cubagemM3, 0.0802);
    assert.equal(r.pesoCalculoKg, 93);
    assert.equal(r.medidas.length, 1);
    assert.deepEqual([r.medidas[0].alturaM, r.medidas[0].larguraM, r.medidas[0].comprimentoM, r.medidas[0].vezes], [0.45, 0.27, 0.22, 3]);
    assert.equal(r.pesoCubadoKg, 24.06); // 0,0802 × 300
    assert.deepEqual(r.avisos, []);
  });
});

test('fallback: Enter não submete, robô clica no ▶', async () => {
  await comNavegador(async (ctx) => {
    const orig = process.env.SSW_BASE_URL;
    const s2 = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (u.pathname === '/bin/ssw0053') return res.end(FORM('botao'));
      if (u.pathname === '/bin/ssw0053.44') return res.end(RESULTADO(u.searchParams.get('nr')));
      if (u.pathname === '/bin/ssw0053.cub') return res.end(POPUP);
      res.statusCode = 404; res.end();
    });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    process.env.SSW_BASE_URL = `http://127.0.0.1:${s2.address().port}`;
    try {
      const r = await consultar(ctx, '00246554672514', { timeoutMs: 8000 });
      assert.equal(r.erro, undefined);
      assert.equal(r.frete, 269.73);
      assert.equal(r.medidas.length, 1);
    } finally { s2.close(); process.env.SSW_BASE_URL = orig; }
  });
});

test('NR inexistente: devolve erro claro e salva debug (sem travar)', async () => {
  await comNavegador(async (ctx) => {
    const r = await consultar(ctx, '99999999999999', { timeoutMs: 3000 });
    assert.equal(r.ok, false);
    assert.match(r.erro, /Tela do CTRC não apareceu/);
    assert.ok(r.debugDir);
    require('node:fs').rmSync(r.debugDir, { recursive: true, force: true });
  });
});

test('entrada inválida é rejeitada antes de abrir o SSW', async () => {
  await comNavegador(async (ctx) => {
    for (const ruim of ['', 'abc', "1'; DROP TABLE x;--", '<script>', '12']) {
      const r = await consultar(ctx, ruim, {});
      assert.match(r.erro, /NR inválido/);
    }
  });
});

test('sem login (campo ausente): pede login e falha com mensagem se continuar sem campo', async () => {
  await comNavegador(async (ctx) => {
    const orig = process.env.SSW_BASE_URL;
    const s3 = http.createServer((q, res) => { res.setHeader('content-type', 'text/html'); res.end('<body>Login SSW'); });
    await new Promise((r) => s3.listen(0, '127.0.0.1', r));
    process.env.SSW_BASE_URL = `http://127.0.0.1:${s3.address().port}`;
    let pediu = false;
    try {
      const r = await consultar(ctx, '00246554672514', { aguardarLogin: async () => { pediu = true; } });
      assert.equal(pediu, true);
      assert.match(r.erro, /Campo "NR1, NR2 ou NR" não encontrado/);
      require('node:fs').rmSync(r.debugDir, { recursive: true, force: true });
    } finally { s3.close(); process.env.SSW_BASE_URL = orig; }
  });
});
