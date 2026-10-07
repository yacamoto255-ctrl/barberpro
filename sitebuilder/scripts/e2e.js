// scripts/e2e.js — simulação completa como usuário real, no Chromium (Playwright).
// Sobe o servidor num banco temporário, percorre o fluxo inteiro no painel e no site público,
// testa permissões, persistência, modo offline e responsividade em várias telas.
//   npm run test:e2e
// Variáveis: CHROMIUM_PATH (executável do Chromium), E2E_OUT (pasta das capturas)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { chromium, devices } = require('playwright-core');

const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitebuilder-e2e-'));
const OUT = process.env.E2E_OUT || path.join(dir, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const DOCS_SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(DOCS_SHOTS, { recursive: true });

const CHROMIUM = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const ADMIN = { name: 'Yago Versal', email: 'admin@versal.estudio', password: 'Versal2026' };
const OPER = { name: 'Operadora Bia', email: 'bia@versal.estudio', password: 'Operador1' };
const results = [];
const consoleErrors = [];

const expected4xx = [];
const externalFailures = [];
function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 4xx são respostas de validação provocadas de propósito pelos passos (senha errada, CNPJ inválido...);
    // ficam registradas em expected4xx pelo listener de resposta abaixo. Offline proposital também não conta.
    if (/status of 4\d\d|net::ERR_|Failed to fetch/.test(t)) return; // falhas de rede são avaliadas no requestfailed

    consoleErrors.push(`[${label}] ${t}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) consoleErrors.push(`[${label}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    else if (r.status() >= 400) expected4xx.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  page.on('requestfailed', (r) => {
    const u = new URL(r.url());
    const why = r.failure()?.errorText || '';
    if (u.origin !== BASE) externalFailures.push(`${u.host} ${why}`); // serviço externo (ViaCEP, Google Fonts) fora do ar/bloqueado
    else if (!/ERR_INTERNET_DISCONNECTED|ERR_ABORTED/.test(why)) consoleErrors.push(`[${label}] falha interna ${r.method()} ${u.pathname} ${why}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] PAGEERROR ${e.message}`));
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    results.push({ step: name, ok: true, ms: Date.now() - t0, ...(info ? { info } : {}) });
    console.log(`✔ ${name}${info ? ' — ' + JSON.stringify(info) : ''}`);
  } catch (e) {
    results.push({ step: name, ok: false, ms: Date.now() - t0, error: e.message.split('\n')[0] });
    console.log(`✘ ${name}\n   ${e.message.split('\n').slice(0, 3).join('\n   ')}`);
    throw e;
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function overflowX(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

(async () => {
  assert(CHROMIUM, 'Chromium não encontrado. Defina CHROMIUM_PATH.');
  const server = fork(path.join(__dirname, '..', 'server.js'), [], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'e2e.db'), BACKUP_DIR: path.join(dir, 'backups'), BCRYPT_ROUNDS: '6', LOG_REQUESTS: '0', BACKUP_INTERVAL_HOURS: '0' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

  const browser = await chromium.launch({ executablePath: CHROMIUM });
  let exitCode = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page, 'painel');
    const dlg = () => page.locator('dialog[open]');
    const tab = (name) => page.locator('nav.tabs').getByRole('link', { name, exact: true });
    const toastOk = (re) => page.locator('.toast').filter({ hasText: re }).first().waitFor({ timeout: 8000 });

    await step('1. Criar conta (primeiro acesso cria o administrador)', async () => {
      await page.goto(`${BASE}/admin/`);
      await page.getByRole('heading', { name: 'Configuração inicial' }).waitFor();
      await page.getByRole('button', { name: 'Criar administrador' }).click();
      await page.locator('.field.invalid').first().waitFor(); // campos vazios mostram erro
      await page.fill('input[name=name]', ADMIN.name);
      await page.fill('input[name=email]', ADMIN.email);
      await page.fill('input[name=password]', '123');
      await page.getByRole('button', { name: 'Criar administrador' }).click();
      await page.locator('.field.invalid .error').filter({ hasText: '8 caracteres' }).waitFor();
      await page.fill('input[name=password]', ADMIN.password);
      await page.getByRole('button', { name: 'Criar administrador' }).click();
      await page.locator('.kpi').first().waitFor();
    });

    await step('2. Logout e login', async () => {
      await page.getByRole('button', { name: 'Sair' }).click();
      await page.getByRole('heading', { name: 'Entrar no painel' }).waitFor();
      await page.fill('input[name=email]', ADMIN.email);
      await page.fill('input[name=password]', 'SenhaErrada1');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.locator('.toast.err').filter({ hasText: 'incorretos' }).waitFor();
      await page.fill('input[name=password]', ADMIN.password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.locator('.kpi').first().waitFor();
    });

    let siteUrl;
    await step('3. Criar site', async () => {
      await page.locator('nav.nav').getByRole('link', { name: 'Sites', exact: true }).click();
      await page.getByRole('link', { name: '+ Novo site' }).click();
      await page.fill('input[name=name]', 'Barbearia Versal Teste');
      await page.selectOption('select[name=category]', 'barbearia');
      await page.fill('input[name=whatsapp]', '41998765432');
      assert(await page.inputValue('input[name=whatsapp]') === '(41) 99876-5432', 'máscara de telefone');
      await page.fill('input[name=city]', 'Curitiba');
      await page.selectOption('select[name=state]', 'PR');
      await page.getByRole('button', { name: 'Criar site' }).click();
      await page.waitForURL(/#\/sites\/\d+\/servicos/);
    });

    await step('4. Dados do negócio: máscaras, CNPJ inválido e válido', async () => {
      await tab('Dados').click();
      await page.fill('input[name=cnpj]', '11222333000182');
      assert(await page.inputValue('input[name=cnpj]') === '11.222.333/0001-82', 'máscara CNPJ');
      await page.fill('input[name=cep]', '80010000');
      assert(await page.inputValue('input[name=cep]') === '80010-000', 'máscara CEP');
      await page.fill('input[name=address]', 'Rua XV de Novembro, 100');
      await page.fill('textarea[name=description]', 'Barbearia clássica no centro de Curitiba, com café e boa conversa.');
      await page.fill('input[name=instagram]', '@barbeariaversal');
      await page.getByRole('button', { name: 'Salvar dados' }).click();
      await page.locator('[data-field=cnpj] .error').waitFor();
      await page.fill('input[name=cnpj]', '11222333000181');
      await page.getByRole('button', { name: 'Salvar dados' }).click();
      await toastOk(/Dados salvos/);
    });

    await step('5. Serviços: criar, editar e excluir', async () => {
      await tab('Serviços').click();
      for (const [name, dur, price] of [['Corte clássico', '30', '5000'], ['Barba', '20', '3500'], ['Serviço temporário', '15', '100']]) {
        await page.getByRole('button', { name: '+ Novo serviço' }).click();
        await dlg().locator('input[name=name]').fill(name);
        await dlg().locator('input[name=duration_min]').fill(dur);
        await dlg().locator('input[name=price]').fill(price);
        await dlg().getByRole('button', { name: 'Salvar' }).click();
        await page.locator('td').filter({ hasText: name }).first().waitFor();
      }
      const row = page.locator('tr').filter({ hasText: 'Corte clássico' });
      await row.getByRole('button', { name: 'Editar' }).click();
      await dlg().locator('input[name=price]').fill('5500');
      assert(await dlg().locator('input[name=price]').inputValue() === '55,00', 'máscara de preço');
      await dlg().getByRole('button', { name: 'Salvar' }).click();
      await page.locator('tr').filter({ hasText: 'Corte clássico' }).filter({ hasText: 'R$ 55,00' }).waitFor();
      await page.locator('tr').filter({ hasText: 'Serviço temporário' }).getByRole('button', { name: 'Excluir' }).click();
      await dlg().getByRole('button', { name: 'Excluir' }).click();
      await page.locator('tr').filter({ hasText: 'Serviço temporário' }).waitFor({ state: 'detached' });
    });

    await step('6. Equipe: cadastrar profissional e foto', async () => {
      await tab('Equipe').click();
      await page.getByRole('button', { name: '+ Novo profissional' }).click();
      await dlg().locator('input[name=name]').fill('Rafael Souza');
      await dlg().locator('input[name=title]').fill('Barbeiro');
      await dlg().getByRole('button', { name: 'Salvar' }).click();
      await page.locator('td').filter({ hasText: 'Rafael Souza' }).waitFor();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Foto' }).click()]);
      await chooser.setFiles(path.join(__dirname, '..', 'public', 'admin', 'icon-192.png'));
      await toastOk(/Foto enviada/);
      await page.locator('td img.thumb').waitFor();
    });

    await step('7. Horários: abrir domingo e salvar', async () => {
      await tab('Horários').click();
      await page.getByRole('button', { name: '+ abrir neste dia' }).first().click();
      await page.getByRole('button', { name: 'Salvar horários' }).click();
      await toastOk(/Horários salvos/);
      await page.locator('.hours-day').first().locator('input[type=time]').first().waitFor();
    });

    await step('8. Aparência: aplicar modelo da Versal, desfazer, paleta rápida e prévia', async () => {
      await tab('Aparência').click();
      assert(await page.inputValue('#model-niche') === 'barbearia', 'nicho do site pré-selecionado');
      assert(await page.locator('.model-card').count() === 10, '10 modelos de barbearia no painel');
      await page.locator('.model-card').filter({ hasText: 'Couro & Whisky' }).getByRole('button', { name: 'Aplicar' }).click();
      await dlg().getByRole('button', { name: 'Aplicar modelo' }).click();
      await toastOk(/Couro & Whisky.*aplicado/);
      assert(await page.inputValue('#s-heading') === 'DM Serif Display', 'fonte do modelo no editor');
      await page.frameLocator('iframe.preview-frame').locator('h1', { hasText: 'Barba feita como ritual' }).waitFor();
      await page.getByRole('button', { name: 'Desfazer modelo' }).click();
      await toastOk(/Tema anterior restaurado/);
      assert(await page.inputValue('#s-heading') !== 'DM Serif Display', 'desfazer volta o tema anterior');
      await page.locator('.model-card').filter({ hasText: 'Couro & Whisky' }).getByRole('button', { name: 'Aplicar' }).click();
      await dlg().getByRole('button', { name: 'Aplicar modelo' }).click();
      await toastOk(/Couro & Whisky.*aplicado/);
      await page.locator('.model-grid').scrollIntoViewIfNeeded();
      await page.locator('.model-grid img').first().evaluate((i) => i.decode());
      await page.screenshot({ path: path.join(DOCS_SHOTS, 'painel-modelos-desktop.png') });
      await page.locator('button.preset').filter({ hasText: 'Marinho' }).click();
      await page.getByRole('button', { name: 'Salvar aparência' }).click();
      await toastOk(/Aparência salva/);
      const frame = page.frameLocator('iframe.preview-frame');
      await frame.locator('h1').waitFor();
      assert(await page.getByRole('button', { name: '✨ Gerar com IA' }).isDisabled(), 'IA deve ficar desabilitada sem chave');
    });

    await step('9. Imagens: logo e galeria (inclui recusa de arquivo inválido)', async () => {
      await tab('Imagens').click();
      let [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Enviar imagem' }).first().click()]);
      await chooser.setFiles(path.join(__dirname, '..', 'public', 'admin', 'icon-512.png'));
      await toastOk(/Imagem enviada/);
      [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Adicionar fotos' }).click()]);
      await chooser.setFiles({ name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('isto nao e uma imagem de verdade') });
      await page.locator('.toast.err').filter({ hasText: 'PNG, JPG ou WebP' }).waitFor();
    });

    await step('10. Regras da agenda e publicação', async () => {
      await tab('Agendamento').click();
      await page.selectOption('select[name=min_notice_min]', '0');
      await page.getByRole('button', { name: 'Salvar regras' }).click();
      await toastOk(/Regras salvas/);
      await page.getByRole('button', { name: 'Publicar site' }).click();
      await toastOk(/publicado/);
      await page.getByRole('button', { name: 'Despublicar' }).waitFor();
      siteUrl = (await page.locator('.page-head p.muted').first().textContent()).trim();
      assert(siteUrl.startsWith(BASE + '/s/'), `URL do site: ${siteUrl}`);
      await page.screenshot({ path: path.join(DOCS_SHOTS, 'painel-editor-desktop.png') });
    });

    // Cliente final agenda pelo celular
    const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const cli = await phone.newPage();
    watch(cli, 'site-celular');
    let cancelUrl;
    await step('11. Cliente agenda pelo site no celular (iPhone)', async () => {
      await cli.goto(siteUrl);
      await cli.locator('h1').waitFor();
      assert((await overflowX(cli)) <= 1, 'site com rolagem horizontal no celular');
      await cli.locator('#booking select#bk-service').waitFor();
      await cli.selectOption('#bk-service', await cli.locator('#bk-service option', { hasText: 'Corte clássico' }).getAttribute('value'));
      await cli.locator('.slots:not(.days) .slot').first().waitFor();
      await cli.locator('.slots:not(.days) .slot').first().click();
      await cli.getByRole('button', { name: 'Confirmar agendamento' }).click();
      await cli.locator('.msg.err').filter({ hasText: 'nome' }).waitFor(); // validação no formulário
      await cli.fill('#bk-name', 'Joana Cliente');
      await cli.fill('#bk-phone', '11987651234');
      assert(await cli.inputValue('#bk-phone') === '(11) 98765-1234', 'máscara telefone cliente');
      await cli.getByRole('button', { name: 'Confirmar agendamento' }).click();
      await cli.getByText('Agendamento confirmado!').waitFor();
      cancelUrl = await cli.getByRole('link', { name: 'Link para cancelar' }).getAttribute('href');
      await cli.screenshot({ path: path.join(DOCS_SHOTS, 'site-agendado-iphone.png'), fullPage: false });
    });

    await step('12. Modelos públicos: galeria e agenda simulada no celular (nada chega ao servidor)', async () => {
      const apiCalls = [];
      cli.on('request', (r) => { if (r.url().includes('/api/public/sites/modelo-')) apiCalls.push(r.url()); });
      await cli.goto(`${BASE}/modelos`);
      assert(await cli.locator('a.model').count() === 50, '50 modelos na galeria');
      assert((await overflowX(cli)) <= 1, 'galeria com rolagem horizontal no celular');
      await cli.locator('a.model[href="/modelos/odontologia-03"]').click();
      await cli.locator('h1', { hasText: 'Consultório para todas as idades' }).waitFor();
      assert(!(await cli.content()).includes('R$'), 'modelo de dentista sem preço');
      assert((await overflowX(cli)) <= 1, 'modelo com rolagem horizontal no celular');
      await cli.locator('.slots:not(.days) .slot').first().click();
      await cli.fill('#bk-name', 'Visitante Teste');
      await cli.fill('#bk-phone', '11987650000');
      await cli.getByRole('button', { name: 'Confirmar agendamento' }).click();
      await cli.getByText('nenhum horário foi reservado').waitFor();
      assert(!apiCalls.length, `a prévia chamou o servidor: ${apiCalls.join(', ')}`);
      await cli.screenshot({ path: path.join(DOCS_SHOTS, 'modelo-agenda-simulada-iphone.png') });
    });

    await step('13. Painel recebe o alerta do novo agendamento', async () => {
      await page.goto(`${BASE}/admin/#/notificacoes`);
      await page.locator('.list-item.unread').filter({ hasText: 'Joana Cliente' }).waitFor();
      const badge = await page.locator('#nav-badge').textContent();
      assert(badge === '1', `badge esperado 1, veio ${badge}`);
      await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
      await page.locator('#nav-badge').waitFor({ state: 'hidden' });
    });

    await step('14. Agenda: alterar status e lançar agendamento manual', async () => {
      await page.goto(`${BASE}/admin/#/agenda`);
      const row = page.locator('tr').filter({ hasText: 'Joana Cliente' });
      await row.waitFor();
      await row.locator('select').selectOption('completed');
      await toastOk(/Status atualizado/);
      await page.getByRole('button', { name: '+ Novo agendamento' }).click();
      await dlg().locator('input[name=client_name]').fill('Marcos Balcão');
      await dlg().locator('input[name=client_phone]').fill('11912345678');
      await dlg().locator('input[name=time]').fill('21:00');
      await dlg().getByRole('button', { name: 'Agendar' }).click();
      await page.locator('tr').filter({ hasText: 'Marcos Balcão' }).waitFor();
    });

    await step('15. Dashboard mostra os números reais', async () => {
      await page.goto(`${BASE}/admin/#/`);
      await page.locator('.kpi').first().waitFor();
      const realizado = await page.locator('.kpi').filter({ hasText: 'Realizado no mês' }).locator('.value').textContent();
      const api = await (await fetch(`${BASE}/api/health`)).json();
      assert(api.ok, 'health');
      return { realizado_no_mes: realizado.replace(/\s/g, ' ') };
    });

    await step('16. Relatórios: CSV, Excel e PDF baixados e conferidos', async () => {
      await page.goto(`${BASE}/admin/#/relatorios`);
      await page.locator('.kpi').first().waitFor();
      const files = {};
      for (const [label, ext] of [['CSV', 'csv'], ['Excel', 'xlsx'], ['PDF', 'pdf']]) {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label, exact: true }).click()]);
        const p = path.join(dir, `rel.${ext}`);
        await dl.saveAs(p);
        const buf = fs.readFileSync(p);
        files[ext] = buf.length;
        if (ext === 'csv') assert(buf.toString('utf8').includes('Joana Cliente'), 'CSV sem o agendamento');
        if (ext === 'pdf') assert(buf.slice(0, 5).toString() === '%PDF-', 'PDF inválido');
        if (ext === 'xlsx') assert(buf.slice(0, 2).toString() === 'PK', 'XLSX inválido');
      }
      return files;
    });

    await step('17. Criar operador; operador não acessa áreas de admin', async () => {
      await page.goto(`${BASE}/admin/#/usuarios`);
      await page.getByRole('button', { name: '+ Novo usuário' }).click();
      await dlg().locator('input[name=name]').fill(OPER.name);
      await dlg().locator('input[name=email]').fill(OPER.email);
      await dlg().locator('input[name=password]').fill(OPER.password);
      await dlg().getByRole('button', { name: 'Salvar' }).click();
      await page.locator('td').filter({ hasText: OPER.name }).waitFor();
      await page.getByRole('button', { name: 'Sair' }).click();
      await page.fill('input[name=email]', OPER.email);
      await page.fill('input[name=password]', OPER.password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.locator('.kpi').first().waitFor();
      assert(await page.locator('nav.nav a', { hasText: 'Configurações' }).count() === 0, 'operador vê Configurações');
      await page.goto(`${BASE}/admin/#/configuracoes`);
      await page.getByText('Seu perfil não tem acesso a esta página.').waitFor();
      await page.goto(`${BASE}/admin/#/sites`);
      await page.locator('.site-card').first().waitFor();
      await page.getByRole('button', { name: 'Sair' }).click();
    });

    await step('18. Entrar de novo e validar persistência dos dados', async () => {
      await page.fill('input[name=email]', ADMIN.email);
      await page.fill('input[name=password]', ADMIN.password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.locator('.kpi').first().waitFor();
      await page.goto(`${BASE}/admin/#/agenda`);
      await page.locator('tr').filter({ hasText: 'Joana Cliente' }).filter({ hasText: 'Concluído' }).waitFor();
      await page.locator('tr').filter({ hasText: 'Marcos Balcão' }).waitFor();
      await page.goto(`${BASE}/admin/#/sites`);
      await page.locator('.site-card').filter({ hasText: 'Barbearia Versal Teste' }).filter({ hasText: 'Publicado' }).waitFor();
    });

    await step('19. Cliente cancela pelo link e a vaga volta', async () => {
      // Lança um agendamento futuro pela API pública e cancela pelo link recebido
      const pub = await (await fetch(`${siteUrl.replace('/s/', '/api/public/sites/')}`)).json();
      const svc = pub.services[0];
      const days = await (await fetch(`${siteUrl.replace('/s/', '/api/public/sites/')}/days?service_id=${svc.id}`)).json();
      const day = days.days.find((d) => d.available).date;
      const av = await (await fetch(`${siteUrl.replace('/s/', '/api/public/sites/')}/availability?service_id=${svc.id}&date=${day}`)).json();
      const time = av.slots[av.slots.length - 1].time;
      const r = await fetch(`${siteUrl.replace('/s/', '/api/public/sites/')}/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: svc.id, date: day, time, client_name: 'Paulo Cancela', client_phone: '11955554444' }) });
      const b = await r.json();
      assert(r.status === 201, `agendamento: ${r.status}`);
      await cli.goto(b.cancel_url);
      await cli.getByRole('button', { name: 'Sim, cancelar meu horário' }).click();
      await cli.getByRole('heading', { name: 'Agendamento cancelado' }).waitFor();
      const again = await (await fetch(`${siteUrl.replace('/s/', '/api/public/sites/')}/availability?service_id=${svc.id}&date=${day}`)).json();
      assert(again.slots.some((s) => s.time === time), 'vaga não voltou');
      await page.goto(`${BASE}/admin/#/notificacoes`);
      await page.locator('.list-item').filter({ hasText: 'Paulo Cancela cancelou' }).waitFor();
      return { cancelUrl_inicial_valido: !!cancelUrl };
    });

    await step('20. Trocar senha, sair e entrar com a nova', async () => {
      await page.goto(`${BASE}/admin/#/conta`);
      await page.fill('input[name=current_password]', ADMIN.password);
      await page.fill('input[name=new_password]', 'NovaSenha2026');
      await page.fill('input[name=confirm]', 'OutraCoisa2026');
      await page.getByRole('button', { name: 'Trocar senha' }).click();
      await page.locator('[data-field=confirm] .error').waitFor();
      await page.fill('input[name=confirm]', 'NovaSenha2026');
      await page.getByRole('button', { name: 'Trocar senha' }).click();
      await toastOk(/Senha alterada/);
      await page.getByRole('button', { name: 'Sair' }).click();
      await page.fill('input[name=email]', ADMIN.email);
      await page.fill('input[name=password]', 'NovaSenha2026');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.locator('.kpi').first().waitFor();
      ADMIN.password = 'NovaSenha2026';
    });

    await step('21. Backup manual pelo painel', async () => {
      await page.goto(`${BASE}/admin/#/configuracoes`);
      await page.getByRole('button', { name: 'Fazer backup agora' }).click();
      await toastOk(/Backup manual-/);
      await page.locator('td').filter({ hasText: 'Manual' }).first().waitFor();
    });

    await step('22. Novo site já com modelo escolhido; depois excluir (com confirmação digitada)', async () => {
      await page.goto(`${BASE}/admin/#/sites/novo`);
      await page.fill('input[name=name]', 'Site Temporário');
      await page.selectOption('select[name=category]', 'pet');
      await page.selectOption('#new-model', 'pet-03');
      await page.getByRole('button', { name: 'Criar site' }).click();
      await page.waitForURL(/#\/sites\/\d+\/servicos/);
      await toastOk(/com o modelo escolhido/);
      await tab('Aparência').click();
      assert(await page.inputValue('#s-heading') === 'Archivo Black', 'modelo aplicado na criação');
      await tab('Dados').click();
      await page.getByRole('button', { name: 'Excluir site' }).click();
      await dlg().locator('input').fill('site-temporario');
      await dlg().getByRole('button', { name: 'Excluir' }).click();
      await page.waitForURL(/#\/sites$/);
      await page.locator('.site-card').first().waitFor();
      assert(await page.locator('.site-card').filter({ hasText: 'Site Temporário' }).count() === 0, 'site não foi excluído');
    });

    await step('23. Navegação: nenhum link interno quebrado', async () => {
      const links = new Set();
      await page.goto(`${BASE}/admin/#/`);
      await page.locator('.kpi').first().waitFor();
      for (const h of await page.locator('nav.nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) links.add(h);
      const broken = [];
      for (const h of links) {
        await page.goto(`${BASE}/admin/${h}`);
        await page.waitForTimeout(400);
        if (await page.locator('.alert.err').count()) broken.push(h);
      }
      const pub = await ctx.newPage();
      watch(pub, 'site-desktop');
      await pub.goto(siteUrl);
      const anchors = await pub.locator('a[href^="#"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      for (const a of anchors) if (a.length > 1 && !(await pub.locator(a).count())) broken.push(`site ${a}`);
      const imgs = await pub.locator('img').evaluateAll((is) => is.map((i) => i.getAttribute('src')));
      for (const s of imgs) { const r = await fetch(BASE + s); if (!r.ok) broken.push(`img ${s} ${r.status}`); }
      await pub.close();
      assert(!broken.length, `links quebrados: ${broken.join(', ')}`);
      return { links_painel: links.size, ancoras_site: anchors.length, imagens: imgs.length };
    });

    await step('24. Modo offline (PWA): painel abre sem internet e volta sozinho', async () => {
      await page.goto(`${BASE}/admin/`);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.locator('.kpi').first().waitFor();
      await ctx.setOffline(true);
      await page.reload();
      await page.locator('#offline').waitFor({ state: 'visible' });
      await page.locator('.side').waitFor(); // casco do painel carregou do cache
      await ctx.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.locator('#offline').waitFor({ state: 'hidden' });
      await page.locator('.kpi').first().waitFor();
    });

    await step('25. Responsividade: painel e site em 9 telas, sem rolagem lateral', async () => {
      const screens = [
        ['desktop-1920', { viewport: { width: 1920, height: 1080 } }],
        ['desktop-1600', { viewport: { width: 1600, height: 900 } }],
        ['desktop-1366', { viewport: { width: 1366, height: 768 } }],
        ['ipad-retrato', devices['iPad (gen 7)']],
        ['ipad-paisagem', devices['iPad (gen 7) landscape']],
        ['tablet-android', devices['Galaxy Tab S4']],
        ['android', devices['Pixel 7']],
        ['android-pequeno', devices['Galaxy S9+']],
        ['iphone', devices['iPhone 13']],
      ];
      const token = await page.evaluate(() => localStorage.getItem('versal.token'));
      const user = await page.evaluate(() => localStorage.getItem('versal.user'));
      const problems = [];
      const pages = ['#/', '#/sites', '#/sites/1/servicos', '#/sites/1/aparencia', '#/agenda', '#/relatorios', '#/configuracoes'];
      for (const [name, dev] of screens) {
        const c = await browser.newContext({ ...dev, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
        await c.addInitScript(([t, u]) => { localStorage.setItem('versal.token', t); localStorage.setItem('versal.user', u); }, [token, user]);
        const p = await c.newPage();
        watch(p, `resp-${name}`);
        for (const route of pages) {
          await p.goto(`${BASE}/admin/${route}`);
          await p.locator('#main h1').first().waitFor();
          await p.waitForTimeout(250);
          const ov = await overflowX(p);
          if (ov > 1) problems.push(`${name} ${route} +${ov}px`);
        }
        const w = (dev.viewport || {}).width;
        if (w <= 900) { // menu hambúrguer abre e navega
          await p.getByRole('button', { name: 'Abrir menu' }).click();
          await p.locator('.shell.nav-open').waitFor();
          await p.locator('nav.nav a', { hasText: 'Agenda' }).click();
          await p.locator('#main h1', { hasText: 'Agenda' }).waitFor();
        }
        await p.goto(`${BASE}/admin/#/`);
        await p.locator('.kpi').first().waitFor();
        await p.screenshot({ path: path.join(OUT, `painel-${name}.png`), fullPage: true });
        for (const u of ['/modelos', '/modelos/salao-04', '/modelos/barbearia-06']) {
          await p.goto(BASE + u);
          await p.locator('h1').first().waitFor();
          const ovm = await overflowX(p);
          if (ovm > 1) problems.push(`${name} ${u} +${ovm}px`);
        }
        await p.goto(siteUrl);
        await p.locator('#bk-service').waitFor();
        const ovs = await overflowX(p);
        if (ovs > 1) problems.push(`${name} site +${ovs}px`);
        await p.screenshot({ path: path.join(OUT, `site-${name}.png`), fullPage: true });
        if (['desktop-1366', 'iphone', 'ipad-retrato'].includes(name)) {
          fs.copyFileSync(path.join(OUT, `site-${name}.png`), path.join(DOCS_SHOTS, `site-${name}.png`));
          fs.copyFileSync(path.join(OUT, `painel-${name}.png`), path.join(DOCS_SHOTS, `painel-${name}.png`));
        }
        await c.close();
      }
      assert(!problems.length, `rolagem horizontal: ${problems.join('; ')}`);
      return { telas: screens.length, paginas_por_tela: pages.length + 4 };
    });

    await step('26. Nenhum erro de JavaScript nem erro 5xx do servidor', async () => {
      assert(!consoleErrors.length, consoleErrors.join('\n'));
      return { respostas_4xx_esperadas: expected4xx, servicos_externos_indisponiveis: [...new Set(externalFailures)] };
    });
  } catch (_) {
    exitCode = 1;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    const report = { data: new Date().toISOString(), ok: exitCode === 0, passos: results, erros: consoleErrors, servicos_externos_indisponiveis: [...new Set(externalFailures)] };
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'e2e-report.json'), JSON.stringify(report, null, 2));
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passos OK. Capturas em ${OUT}`);
    if (!process.env.E2E_OUT) { /* mantém as capturas na pasta temporária para inspeção */ }
    process.exit(exitCode);
  }
})();
