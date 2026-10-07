'use strict';
const H = require('./helpers');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/db');
const { buildUserPrompt } = require('../src/services/theme');
const { request } = H;

let app; let admin; let auth;
beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
  auth = { Authorization: `Bearer ${admin}` };
});
afterAll(H.cleanup);

describe('profissões de saúde (regras de divulgação)', () => {
  test('odontologia começa com preços ocultos; outras categorias não', async () => {
    const d = await request(app).post('/api/sites').set(auth).send({ name: 'Clínica Sorriso Teste', category: 'odontologia' });
    expect(d.body.site.hide_prices).toBe(1);
    const b = await request(app).post('/api/sites').set(auth).send({ name: 'Barbearia Teste Saúde', category: 'barbearia' });
    expect(b.body.site.hide_prices).toBe(0);
    const forced = await request(app).post('/api/sites').set(auth).send({ name: 'Dentista Com Preço', category: 'odontologia', hide_prices: false });
    expect(forced.body.site.hide_prices).toBe(0);
  });

  test('registros do conselho são validados e normalizados', async () => {
    const { site } = await H.createSite(app, admin);
    const bad = await request(app).patch(`/api/sites/${site.id}`).set(auth).send({ responsible_registration: '12345', company_registration: 'CRO' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields).sort()).toEqual(['company_registration', 'responsible_registration']);
    const ok = await request(app).patch(`/api/sites/${site.id}`).set(auth)
      .send({ responsible_name: 'Dra. Ana Souza', responsible_registration: 'cro-pr 12345', company_registration: 'CRO-PR EPAO 1234' });
    expect(ok.body.site).toMatchObject({ responsible_registration: 'CRO-PR 12345', company_registration: 'CRO-PR EPAO 1234' });
    const p = await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Dr. Bruno Lima', registration: 'abc' });
    expect(p.status).toBe(400);
    const p2 = await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Dr. Bruno Lima', registration: 'CRO-PR 23456' });
    expect(p2.body.professional.registration).toBe('CRO-PR 23456');
  });

  test('site com preços ocultos não mostra valor em lugar nenhum do público', async () => {
    const { site, service } = await H.createSite(app, admin, { category: 'odontologia', responsible_name: 'Dra. Ana Souza', responsible_registration: 'CRO-PR 12345' });
    await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Dr. Bruno Lima', title: 'Cirurgião-dentista', registration: 'CRO-PR 23456' });
    expect(H.getDb().prepare('SELECT hide_prices FROM sites WHERE id = ?').get(site.id).hide_prices).toBe(1);

    const page = await request(app).get(`/s/${site.slug}`);
    expect(page.status).toBe(200);
    expect(page.text).not.toMatch(/R\$|Consulte/);
    expect(page.text).toContain('Responsável técnico: Dra. Ana Souza — CRO-PR 12345');
    expect(page.text).toContain('CRO-PR 23456');

    const api = await request(app).get(`/api/public/sites/${site.slug}`);
    expect(api.body.services[0].price_cents).toBeNull();
    expect(api.body.professionals[0].registration).toBe('CRO-PR 23456');

    const b = await request(app).post(`/api/public/sites/${site.slug}/bookings`).send(H.bookingBody(service));
    expect(b.status).toBe(201);
    expect(b.body.booking.price_cents).toBeNull();
    const cancel = await request(app).get(new URL(b.body.cancel_url).pathname);
    expect(cancel.text).not.toMatch(/Valor|R\$/);

    // no painel o preço continua (relatório de receita)
    const rep = await request(app).get(`/api/reports/bookings?site_id=${site.id}`).set(auth);
    expect(rep.body.totals.revenue_expected_cents).toBe(5000);
  });

  test('prompt da IA proíbe preços e promessas para saúde', () => {
    const p = buildUserPrompt({ name: 'Clínica', category: 'odontologia', hide_prices: 1 }, [], '');
    expect(p).toMatch(/Do not mention prices/);
    expect(p).toMatch(/no promises or guarantees of results/);
    const plain = buildUserPrompt({ name: 'Barbearia', category: 'barbearia', hide_prices: 0 }, [], '');
    expect(plain).not.toMatch(/copy_constraints/);
  });

  test('migração adiciona as colunas novas em banco antigo sem perder dados', () => {
    const file = path.join(H.dir, 'antigo.db');
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE sites (id INTEGER PRIMARY KEY, slug TEXT, name TEXT); INSERT INTO sites (slug, name) VALUES ('velho', 'Site Velho');");
    old.exec('CREATE TABLE professionals (id INTEGER PRIMARY KEY, site_id INTEGER, name TEXT);');
    migrate(old);
    migrate(old); // idempotente
    const cols = old.prepare('PRAGMA table_info(sites)').all().map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['hide_prices', 'responsible_name', 'responsible_registration', 'company_registration']));
    expect(old.prepare('PRAGMA table_info(professionals)').all().map((c) => c.name)).toContain('registration');
    expect(old.prepare('SELECT name, hide_prices FROM sites').get()).toEqual({ name: 'Site Velho', hide_prices: 0 });
    old.close();
  });
});
