'use strict';
const H = require('./helpers');
const fs = require('fs');
const path = require('path');
const { seed, parseHours } = require('../scripts/seed-site');
const { request } = H;

const MODEL = path.join(__dirname, '..', 'sites', 'modelo-dentista.json');
const quiet = () => {};
let app; let admin;

beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
});
afterAll(H.cleanup);

test('horários no formato amigável', () => {
  expect(parseHours({ seg: '08:00-12:00, 13:30-18:00', sab: null })).toEqual([
    { weekday: 1, open_time: '08:00', close_time: '12:00' },
    { weekday: 1, open_time: '13:30', close_time: '18:00' },
  ]);
  expect(() => parseHours({ segunda: '08:00-12:00' })).toThrow(/Dia inválido/);
  expect(() => parseHours({ seg: '8h às 12h' })).toThrow(/Faixa inválida/);
});

test('cria o site completo do modelo de dentista', async () => {
  const site = await seed(MODEL, { log: quiet });
  const auth = { Authorization: `Bearer ${admin}` };
  const d = (await request(app).get(`/api/sites/${site.id}`).set(auth)).body;
  expect(d.site).toMatchObject({ category: 'odontologia', hide_prices: 1, responsible_registration: 'CRO-PR 00000', published: 0 });
  expect(d.services.map((s) => s.name)).toEqual(['Avaliação odontológica', 'Limpeza (profilaxia)', 'Clareamento dental']);
  expect(d.professionals[0]).toMatchObject({ name: 'Dra. Nome Sobrenome', registration: 'CRO-PR 00000' });
  expect(d.hours).toHaveLength(10);
  expect(d.site.theme.fonts).toEqual({ heading: 'Instrument Serif', body: 'Figtree' });
  expect(d.site.theme.copy.cta).toBe('Agendar avaliação');
  // rascunho: não aparece publicamente
  expect((await request(app).get(`/s/${site.slug}`)).status).toBe(404);
});

test('sem --update recusa duplicar; com --update atualiza sem duplicar nem apagar', async () => {
  await expect(seed(MODEL, { log: quiet })).rejects.toThrow(/--update/);
  const spec = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  spec.site.tagline = 'Nova frase';
  spec.site.published = true;
  spec.servicos.push({ name: 'Restauração', duration_min: 40, price: '0' });
  const tmp = path.join(H.dir, 'atualizado.json');
  fs.writeFileSync(tmp, JSON.stringify(spec));
  const site = await seed(tmp, { update: true, log: quiet });
  const db = H.getDb();
  expect(db.prepare('SELECT COUNT(*) AS n FROM sites WHERE slug = ?').get(site.slug).n).toBe(1);
  expect(db.prepare('SELECT COUNT(*) AS n FROM services WHERE site_id = ?').get(site.id).n).toBe(4);
  expect(db.prepare('SELECT COUNT(*) AS n FROM professionals WHERE site_id = ?').get(site.id).n).toBe(1);
  const page = await request(app).get(`/s/${site.slug}`);
  expect(page.status).toBe(200);
  expect(page.text).toContain('Nova frase');
  expect(page.text).not.toMatch(/R\$/);
});

test('erros de dados viram mensagens claras', async () => {
  const bad = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  bad.site.slug = 'outro-modelo';
  bad.site.whatsapp = '123';
  const f1 = path.join(H.dir, 'ruim1.json');
  fs.writeFileSync(f1, JSON.stringify(bad));
  await expect(seed(f1, { log: quiet })).rejects.toThrow(/WhatsApp inválido/);

  const bad2 = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  bad2.site.slug = 'outro-modelo-2';
  bad2.profissionais[0].servicos = ['Serviço que não existe'];
  const f2 = path.join(H.dir, 'ruim2.json');
  fs.writeFileSync(f2, JSON.stringify(bad2));
  await expect(seed(f2, { log: quiet })).rejects.toThrow(/não está em "servicos"/);
});
