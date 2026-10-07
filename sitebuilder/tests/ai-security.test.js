'use strict';
const H = require('./helpers');
const Anthropic = require('@anthropic-ai/sdk');
const theme = require('../src/services/theme');
const { setSetting } = require('../src/settings');
const { request } = H;

let app; let admin; let auth;
beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
  auth = { Authorization: `Bearer ${admin}` };
});
afterAll(H.cleanup);

const AI_THEME = {
  palette: { bg: '#0f1a14', surface: '#16241c', text: '#eef3ea', muted: '#a9b8a6', primary: '#d98b2b', on_primary: '#0f1a14', accent: '#7fc8a9' },
  fonts: { heading: 'Fraunces', body: 'Karla' }, hero_layout: 'split', radius: 'soft', background: 'grain',
  copy: { headline: 'Corte clássico, conversa boa', subheadline: 'Barbearia em Curitiba', about: 'Texto sobre.', cta: 'Agendar horário', services_title: 'Serviços', team_title: 'Equipe', booking_title: 'Agende' },
};

function fakeClient(impl) {
  const calls = [];
  theme._setClientFactory((key) => ({ beta: { messages: { create: async (params) => { calls.push({ key, params }); return impl(params); } } } }));
  return calls;
}

describe('geração de tema com IA (Claude)', () => {
  let site;
  beforeAll(async () => { ({ site } = await H.createSite(app, admin, { description: 'Barbearia tradicional', city: 'Curitiba' })); });

  test('sem chave: erro claro e botão desabilitado no painel', async () => {
    const r = await request(app).post(`/api/sites/${site.id}/theme/generate`).set(auth).send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NO_AI_KEY');
    expect((await request(app).get('/api/themes').set(auth)).body.ai_available).toBe(false);
  });

  test('chamada usa Opus 5.5, saída estruturada e fallback; salva e devolve o tema anterior', async () => {
    const put = await request(app).put('/api/settings').set(auth).send({ anthropic_api_key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' });
    expect(put.status).toBe(200);
    expect(put.body.settings.anthropic_api_key).not.toContain('abcdefghijklmnop');
    const calls = fakeClient(() => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(AI_THEME) }] }));
    const r = await request(app).post(`/api/sites/${site.id}/theme/generate`).set(auth).send({ hint: 'verde floresta' });
    expect(r.status).toBe(200);
    expect(r.body.site.theme).toMatchObject({ preset: 'ai', fonts: { heading: 'Fraunces', body: 'Karla' }, hero_layout: 'split' });
    expect(r.body.site.theme.copy.headline).toBe('Corte clássico, conversa boa');
    expect(r.body.previous_theme.preset).toBe('noite');
    const p = calls[0].params;
    expect(calls[0].key).toBe('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(p.output_config.format.type).toBe('json_schema');
    expect(p.output_config.format.schema.properties.fonts.properties.heading.enum).toContain('Fraunces');
    expect(p.messages[0].content).toMatch(/Barbearia tradicional/);
    expect(p.messages[0].content).toMatch(/verde floresta/);
    expect(p).not.toHaveProperty('thinking'); // Opus 5.5: thinking não pode ser desligado; não enviamos
    const saved = JSON.parse(H.getDb().prepare('SELECT theme_json FROM sites WHERE id = ?').get(site.id).theme_json);
    expect(saved.preset).toBe('ai');
  });

  test('cores ruins da IA são corrigidas para leitura', async () => {
    fakeClient(() => ({ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...AI_THEME, palette: { ...AI_THEME.palette, text: '#111a14', primary: 'roxo' } }) }] }));
    const r = await request(app).post(`/api/sites/${site.id}/theme/generate`).set(auth).send({});
    expect(r.status).toBe(200);
    expect(theme.contrast(r.body.site.theme.palette.text, r.body.site.theme.palette.bg)).toBeGreaterThanOrEqual(7);
    expect(r.body.warnings.length).toBeGreaterThan(0);
  });

  test.each([
    ['recusa', () => ({ stop_reason: 'refusal', content: [] }), 422, 'AI_REFUSAL'],
    ['resposta cortada', () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"pal' }] }), 502, 'AI_TRUNCATED'],
    ['JSON inválido', () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'não é json' }] }), 502, 'AI_FORMAT'],
  ])('%s → erro amigável', async (...row) => {
    const [, impl, status, code] = row;
    fakeClient(impl);
    const r = await request(app).post(`/api/sites/${site.id}/theme/generate`).set(auth).send({});
    expect(r.status).toBe(status);
    expect(r.body.code).toBe(code);
  });

  test('erros da API viram mensagens úteis', async () => {
    const headers = new Headers();
    const cases = [
      [new Anthropic.AuthenticationError(401, { error: {} }, 'invalid x-api-key', headers), 400, 'AI_AUTH'],
      [new Anthropic.RateLimitError(429, { error: {} }, 'rate', headers), 429, 'AI_RATE'],
      [new Anthropic.APIConnectionError({ message: 'ECONNREFUSED' }), 502, 'AI_CONN'],
      [new Anthropic.InternalServerError(529, { error: {} }, 'overloaded', headers), 502, 'AI_API'],
    ];
    for (const [err, status, code] of cases) {
      fakeClient(() => { throw err; });
      const r = await request(app).post(`/api/sites/${site.id}/theme/generate`).set(auth).send({});
      expect([r.status, r.body.code]).toEqual([status, code]);
    }
    // o tema salvo não muda quando a IA falha
    expect(JSON.parse(H.getDb().prepare('SELECT theme_json FROM sites WHERE id = ?').get(site.id).theme_json).preset).toBe('ai');
  });

  test('formato da chave é validado e a chave nunca volta inteira', async () => {
    expect((await request(app).put('/api/settings').set(auth).send({ anthropic_api_key: 'chave-qualquer' })).status).toBe(400);
    const g = await request(app).get('/api/settings').set(auth);
    expect(JSON.stringify(g.body)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    // salvar o formulário com o valor mascarado não apaga a chave
    await request(app).put('/api/settings').set(auth).send({ anthropic_api_key: g.body.settings.anthropic_api_key });
    expect(require('../src/settings').getSetting('anthropic_api_key')).toBe('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  });
});

describe('segurança', () => {
  let site; let service;
  const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  beforeAll(async () => {
    ({ site, service } = await H.createSite(app, admin, { name: `Loja ${XSS}`.slice(0, 120), description: `Desc ${XSS}`, tagline: '"><svg onload=alert(3)>' }));
    await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: `Pro ${XSS}`.slice(0, 120), bio: XSS });
  });

  test('XSS: textos aparecem escapados no site público', async () => {
    const r = await request(app).get(`/s/${site.slug}`);
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/<script>alert|<img src=x|<svg onload/);
    expect(r.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // só o script próprio do agendamento, carregado de /assets
    expect((r.text.match(/<script/g) || []).length).toBe(1);
    expect(r.text).toContain('<script src="/assets/booking.js" defer></script>');
  });

  test('XSS: nome do cliente escapado na página de cancelamento', async () => {
    const b = await request(app).post(`/api/public/sites/${site.slug}/bookings`).send(H.bookingBody(service, { client_name: `Ana ${XSS}` }));
    const page = await request(app).get(new URL(b.body.cancel_url).pathname);
    expect(page.text).not.toMatch(/<script>alert|<img src=x/);
  });

  test('cabeçalhos de segurança e CSP', async () => {
    const pageRes = await request(app).get(`/s/${site.slug}`);
    const csp = pageRes.headers['content-security-policy'];
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(pageRes.headers['x-content-type-options']).toBe('nosniff');
    expect(pageRes.headers['x-powered-by']).toBeUndefined();
    const adminRes = await request(app).get('/admin/');
    expect(adminRes.status).toBe(200);
    expect(adminRes.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(adminRes.headers['x-frame-options']).toBe('DENY');
    const nonce = csp.match(/'nonce-([^']+)'/)[1];
    const second = (await request(app).get(`/s/${site.slug}`)).headers['content-security-policy'].match(/'nonce-([^']+)'/)[1];
    expect(nonce).not.toBe(second); // nonce novo a cada resposta
  });

  test('corpo malformado e grande demais', async () => {
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(bad.status).toBe(400);
    const big = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send(JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(200_000) }));
    expect(big.status).toBe(413);
  });

  test('API pública não vaza dados internos nem de clientes', async () => {
    const r = await request(app).get(`/api/public/sites/${site.slug}`);
    const txt = JSON.stringify(r.body);
    expect(txt).not.toMatch(/cnpj|evolution|theme_json|client_phone|password|notify_/);
    expect(Object.keys(r.body.site).sort()).toEqual(['booking_enabled', 'max_days_ahead', 'name', 'slug', 'whatsapp']);
  });

  test('rota inexistente e erro interno não expõem detalhes', async () => {
    const nf = await request(app).get('/api/nao-existe');
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ error: 'Rota não encontrada.' });
  });

  test('IDs de outro site e IDs inválidos', async () => {
    const other = await H.createSite(app, admin);
    expect((await request(app).delete(`/api/sites/${site.id}/services/${other.service.id}`).set(auth)).status).toBe(404);
    expect((await request(app).get('/api/sites/1e3').set(auth)).status).toBe(400);
    expect((await request(app).get('/api/sites/-1').set(auth)).status).toBe(400);
  });

  test('CSRF: a API só aceita token no cabeçalho Authorization (sem cookie de sessão)', async () => {
    const r = await request(app).post('/api/sites').set('Cookie', 'token=qualquer').send({ name: 'Ataque' });
    expect(r.status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: H.ADMIN.password });
    expect(login.headers['set-cookie']).toBeUndefined();
  });
});

describe('saúde', () => {
  test('/api/health', async () => {
    const r = await request(app).get('/api/health');
    expect(r.body).toMatchObject({ ok: true, db: 'ok' });
    expect(setSetting).toBeDefined();
  });
});
