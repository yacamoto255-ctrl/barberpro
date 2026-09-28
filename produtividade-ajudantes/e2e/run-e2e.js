'use strict';
/**
 * Teste ponta a ponta em navegador real (Chromium via playwright-core).
 * Simula um usuário real: login por perfil, apontamento com leitor (digitação + Enter),
 * cadastro, relatórios, permissões, logout/login e persistência. Verifica erros de console
 * (inclusive violações de CSP) e responsividade (sem rolagem horizontal) em várias resoluções.
 *
 * Uso: npm run e2e      (CHROMIUM_PATH=/caminho/do/chrome para escolher o navegador)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(__dirname, 'screenshots');
const DB = path.join(os.tmpdir(), `logiponto-e2e-${Date.now()}.db`);
const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium'].find(p => fs.existsSync(p));

let failures = 0;
const results = [];
function check(name, cond, extra = '') {
  results.push(`${cond ? '✔' : '✘'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = { ...process.env, DB_PATH: DB, PORT: String(PORT), NODE_ENV: 'development', INTEGRATION_API_KEY: 'e2e' };
  await new Promise((res, rej) => {
    const s = spawn(process.execPath, ['--no-warnings', 'scripts/seed.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' });
    s.on('exit', c => (c === 0 ? res() : rej(new Error('seed falhou'))));
  });
  const server = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => server.stdout.on('data', d => { if (String(d).includes('rodando')) r(); }));

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const consoleErrors = [];
  const newPage = async (viewport = { width: 1366, height: 800 }) => {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true, locale: 'pt-BR' });
    const page = await ctx.newPage();
    // "Failed to load resource" = respostas HTTP de erro esperadas (401/404/409 testados de propósito).
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) consoleErrors.push(`${m.text()} @ ${page.url()}`); });
    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
    return page;
  };
  const login = async (page, email, pw) => {
    await page.goto(BASE);
    await page.fill('#email', email);
    await page.fill('#password', pw);
    await page.click('#btn-login');
    await page.waitForSelector('#content h1');
  };

  try {
    // ── 1. Login inválido ───────────────────────────────────────
    let page = await newPage();
    await page.goto(BASE);
    await page.click('#btn-login');
    check('Login com campos vazios mostra erro', (await page.textContent('.form-error')).includes('Informe'));
    await page.fill('#email', 'admin@logiponto.com'); await page.fill('#password', 'errada1');
    await page.click('#btn-login');
    await page.waitForFunction(() => document.querySelector('.form-error').textContent.length > 0);
    check('Login com senha errada mostra erro', (await page.textContent('.form-error')).includes('incorretos'));

    // ── 2. OPERADOR: apontamento com leitor ─────────────────────
    await login(page, 'operador@logiponto.com', 'Operador1234');
    check('Operador cai na tela de apontamento', (await page.textContent('#content h1')).includes('Apontamento'));
    const navText = await page.textContent('#nav');
    check('Operador não vê Dashboard/Usuários no menu', !navText.includes('Dashboard') && !navText.includes('Usuários'));
    await page.goto(`${BASE}/#/dashboard`);
    await page.waitForTimeout(400);
    check('Operador é redirecionado ao tentar abrir o dashboard', (await page.textContent('#content h1')).includes('Apontamento'));

    // Seleciona carga pelo número (digitada) — pega a primeira carga aberta sem apontamentos
    const loadNumber = await page.evaluate(async () => {
      const t = JSON.parse(localStorage.getItem('logiponto.session')).token;
      const r = await fetch('/api/loads?status=ABERTA', { headers: { Authorization: `Bearer ${t}` } });
      return (await r.json()).find(l => !l.helpers_count).load_number;
    });
    await page.fill('#load-number', loadNumber);
    await page.press('#load-number', 'Enter');
    await page.waitForSelector('.load-card');
    check('Carga identificada e exibida', (await page.textContent('.load-card')).includes(loadNumber));
    check('Foco volta ao campo de leitura', await page.evaluate(() => document.activeElement.id === 'scan'));

    // Código inexistente
    await page.keyboard.type('777'); await page.keyboard.press('Enter');
    await page.waitForSelector('.scan-box.err');
    check('Código inexistente mostra erro em vermelho', (await page.textContent('#scan-result')).includes('não cadastrado'));
    // Ajudante inativo
    await page.keyboard.type('099'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#scan-result').textContent.includes('INATIVO'));
    check('Ajudante inativo é bloqueado', true);

    // Escolhe um ajudante livre
    const freeCodes = await page.evaluate(async () => {
      const t = JSON.parse(localStorage.getItem('logiponto.session')).token;
      const h = { Authorization: `Bearer ${t}` };
      const open = await (await fetch('/api/operations/open', { headers: h })).json();
      const busy = new Set(open.map(p => p.helper_barcode));
      return (await (await fetch('/api/helpers', { headers: h })).json()).filter(x => x.status === 'ATIVO' && !busy.has(x.barcode)).map(x => ({ code: x.barcode, name: x.name }));
    });
    const [h1, h2] = freeCodes;
    await page.keyboard.type(h1.code); await page.keyboard.press('Enter');
    await page.waitForSelector('.scan-box.ok');
    check(`Bipe ${h1.code} identifica ${h1.name}`, (await page.textContent('#scan-result')).includes(`${h1.name} identificado`));
    await page.click('.act-btn:has-text("Carregamento")');
    check('Botão INICIAR habilitado após carga+atividade+ajudante', await page.isEnabled('#btn-start'));
    await page.click('#btn-start');
    await page.waitForFunction(n => document.querySelector('#load-parts').textContent.includes(n), h1.name);
    check('Início registrado e listado na carga', true);

    // Segundo ajudante: confirma bipando de novo (duplo bipe)
    await page.waitForTimeout(1600);
    await page.keyboard.type(h2.code); await page.keyboard.press('Enter');
    await page.waitForSelector('.scan-box.ok');
    await page.waitForTimeout(1600); // passa o debounce de leitura duplicada
    await page.keyboard.type(h2.code); await page.keyboard.press('Enter');
    await page.waitForFunction(n => document.querySelector('#load-parts').textContent.includes(n), h2.name);
    const preview = await page.textContent('#load-parts');
    check('Segundo ajudante entrou na mesma atividade (prévia de rateio para 2)', preview.includes('Rateio (prévia)'));
    await page.screenshot({ path: path.join(SHOTS, '01-apontamento-desktop.png'), fullPage: true });

    // Bipe do ajudante ocupado mostra estado "em atividade" e duplo bipe finaliza
    await page.waitForTimeout(1600);
    await page.keyboard.type(h1.code); await page.keyboard.press('Enter');
    await page.waitForSelector('.scan-box.busy');
    check('Ajudante ocupado aparece em destaque âmbar com a atividade atual', (await page.textContent('#scan-result')).includes('Carregamento'));
    await page.waitForTimeout(1600);
    await page.keyboard.type(h1.code); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#scan-result').textContent.includes('finalizada'));
    check('Bipar novamente finaliza a atividade do ajudante', true);
    // Finaliza o segundo pelo botão da lista
    await page.click(`#load-parts button[data-name="${h2.name}"]`);
    await page.waitForFunction(() => document.querySelector('#load-parts').textContent.includes('Rateio:'));
    const rateio = await page.textContent('#load-parts');
    check('Atividade encerrada com rateio calculado', rateio.includes('FINALIZADA') && rateio.includes('Rateio:'));

    // Movimentação para praça exige praça (padrão da carga)
    await page.click('.act-btn:has-text("Movimentação para praça")');
    check('Seletor de praça aparece para Movimentação para praça', await page.isVisible('#square'));
    await page.keyboard.press('Escape');

    // Logout
    await page.click('#btn-logout');
    await page.waitForSelector('#login-form');
    check('Logout volta para o login', true);

    // ── 3. GESTOR: cadastro de ajudante, dashboard, relatórios ──
    await login(page, 'gestor@logiponto.com', 'Gestor1234');
    check('Gestor cai no dashboard', (await page.textContent('#content h1')).includes('Dashboard'));
    await page.waitForSelector('.kpi');
    check('Dashboard mostra indicadores', (await page.$$('.kpi')).length >= 9);
    await page.screenshot({ path: path.join(SHOTS, '02-dashboard-desktop.png'), fullPage: true });
    await page.selectOption('#flt_period', '7');
    await page.waitForTimeout(600);
    check('Filtro de 7 dias mostra gráfico por dia', (await page.textContent('#body')).includes('por dia'));
    await page.click('tr[data-helper]');
    await page.waitForSelector('.modal');
    check('Detalhe individual do ajudante abre', (await page.textContent('.modal')).includes('Participação por atividade'));
    await page.keyboard.press('Escape');

    await page.goto(`${BASE}/#/ajudantes`);
    await page.waitForSelector('#new');
    await page.click('#new');
    await page.click('#gen');
    await page.waitForFunction(() => document.querySelector('[name=barcode]').value.length > 0);
    const newCode = await page.inputValue('[name=barcode]');
    await page.fill('[name=name]', 'Teste E2E Silva');
    await page.fill('[name=cpf]', '52998224725');
    check('Máscara de CPF aplicada', (await page.inputValue('[name=cpf]')) === '529.982.247-25');
    await page.click('.modal-f button.btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    await page.fill('#h_q', 'Teste E2E');
    await page.waitForTimeout(600);
    check(`Ajudante criado com código gerado ${newCode}`, (await page.textContent('#body')).includes(newCode));
    // duplicado
    await page.click('#new');
    await page.fill('[name=barcode]', newCode); await page.fill('[name=name]', 'Duplicado');
    await page.click('.modal-f button.btn-primary');
    await page.waitForFunction(() => document.querySelector('.modal .form-error').textContent.length > 0);
    check('Código duplicado é recusado com mensagem', (await page.textContent('.modal .form-error')).includes('já pertence'));
    await page.keyboard.press('Escape');
    // crachá
    await page.click('button[data-badge]');
    await page.waitForSelector('.badge-card img');
    const imgOk = await page.evaluate(() => document.querySelector('.badge-card img').naturalWidth > 50);
    check('Crachá com código de barras gerado', imgOk);
    await page.screenshot({ path: path.join(SHOTS, '03-cracha.png') });
    await page.keyboard.press('Escape');

    // Relatórios: download XLSX e CSV
    await page.goto(`${BASE}/#/relatorios`);
    await page.waitForSelector('#xlsx');
    await page.selectOption('#flt_period', '7');
    await page.waitForTimeout(500);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xlsx')]);
    const xlsxPath = path.join(SHOTS, dl.suggestedFilename());
    await dl.saveAs(xlsxPath);
    check('Download XLSX', fs.statSync(xlsxPath).size > 3000, dl.suggestedFilename());
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
    const csvPath = path.join(SHOTS, dl2.suggestedFilename());
    await dl2.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    check('Download CSV com cabeçalho correto', csv.includes('Peso atribuído (kg)'), dl2.suggestedFilename());

    // Histórico e ranking
    await page.goto(`${BASE}/#/historico`);
    await page.waitForSelector('#pager');
    check('Histórico lista apontamentos', (await page.$$('#body tbody tr')).length > 0);
    await page.goto(`${BASE}/#/ranking`);
    await page.waitForSelector('.rank-pos');
    await page.selectOption('#metric', 'kg_per_hour');
    await page.waitForTimeout(400);
    check('Ranking troca de indicador', (await page.textContent('#body')).includes('Kg/hora'));
    await page.screenshot({ path: path.join(SHOTS, '04-ranking.png'), fullPage: true });
    check('Gestor não acessa Usuários', !(await page.textContent('#nav')).includes('Usuários'));

    // ── 4. ADMIN: usuários, auditoria, cadastros ────────────────
    await page.click('#btn-logout');
    await login(page, 'admin@logiponto.com', 'Admin1234');
    await page.goto(`${BASE}/#/auditoria`);
    await page.waitForSelector('#pager');
    check('Auditoria registra apontamentos e cadastros', (await page.textContent('#body')).includes('INICIAR'));
    await page.goto(`${BASE}/#/cadastros`);
    await page.waitForSelector('[data-tab="rules"]');
    await page.click('[data-tab="rules"]');
    await page.waitForTimeout(300);
    check('Regras de produtividade listadas', (await page.textContent('#body')).includes('Rateio igual'));
    await page.goto(`${BASE}/#/usuarios`);
    await page.waitForSelector('#new');
    check('Admin vê usuários', (await page.textContent('#body')).includes('operador@logiponto.com'));

    // ── 5. Persistência após novo login ─────────────────────────
    await page.click('#btn-logout');
    await login(page, 'gestor@logiponto.com', 'Gestor1234');
    await page.goto(`${BASE}/#/ajudantes`);
    await page.waitForSelector('#h_q');
    await page.fill('#h_q', 'Teste E2E');
    await page.waitForTimeout(600);
    check('Dados persistem após logout/login', (await page.textContent('#body')).includes('Teste E2E Silva'));
    await page.context().close();

    // ── 6. Responsividade ───────────────────────────────────────
    const sizes = [
      ['desktop-1920', 1920, 1080], ['desktop-1600', 1600, 900], ['desktop-1366', 1366, 768],
      ['ipad', 768, 1024], ['android-tablet', 800, 1280], ['android', 412, 915], ['iphone', 390, 844],
    ];
    for (const [name, w, h] of sizes) {
      const p = await newPage({ width: w, height: h });
      for (const [role, email, pw, routes] of [
        ['operador', 'operador@logiponto.com', 'Operador1234', ['/apontamento', '/historico']],
        ['gestor', 'gestor@logiponto.com', 'Gestor1234', ['/dashboard', '/ranking', '/relatorios', '/ajudantes', '/cargas', '/cadastros', '/auditoria']],
      ]) {
        await login(p, email, pw);
        for (const r of routes) {
          await p.goto(`${BASE}/#${r}`);
          await p.waitForSelector('#content h1');
          await p.waitForTimeout(350);
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          check(`[${name}] ${r} sem rolagem horizontal`, overflow <= 1, overflow > 1 ? `excesso ${overflow}px` : '');
          if (['/apontamento', '/dashboard'].includes(r) && ['android', 'iphone', 'ipad'].includes(name)) {
            await p.screenshot({ path: path.join(SHOTS, `05-${name}${r.replace('/', '-')}.png`), fullPage: true });
          }
        }
        if (w <= 860) {
          await p.click('#btn-menu');
          await p.waitForTimeout(250);
          check(`[${name}] menu móvel abre`, await p.evaluate(() => document.querySelector('#sidebar').classList.contains('open')));
          await p.click('.scrim', { position: { x: w - 20, y: 200 } });
          check(`[${name}] menu móvel fecha ao tocar fora`, !(await p.evaluate(() => document.querySelector('#sidebar').classList.contains('open'))));
        }
        await p.evaluate(() => localStorage.clear());
      }
      await p.context().close();
    }
  } catch (e) {
    failures++;
    results.push(`✘ ERRO NA EXECUÇÃO: ${e.stack}`);
  } finally {
    check('Nenhum erro no console do navegador (inclui violações de CSP)', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
    await browser.close();
    server.kill();
    for (const s of ['', '-wal', '-shm']) fs.rmSync(DB + s, { force: true });
  }
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures} OK, ${failures} falha(s). Capturas em ${SHOTS}`);
  process.exit(failures ? 1 : 0);
}

main();
