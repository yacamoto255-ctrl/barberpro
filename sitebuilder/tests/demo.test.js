'use strict';
const H = require('./helpers');
const fs = require('fs');
const path = require('path');
const { seed } = require('../scripts/seed-site');
const { exportDemos } = require('../scripts/export-demos');
const { request } = H;

const DEMOS = path.join(__dirname, '..', 'sites', 'demos');
let app; let admin; let auth;
beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
  auth = { Authorization: `Bearer ${admin}` };
});
afterAll(H.cleanup);

describe('sites de demonstração (portfólio)', () => {
  test('todos os exemplos de sites/demos são cadastrados e abrem', async () => {
    const files = fs.readdirSync(DEMOS).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const site = await seed(path.join(DEMOS, f), { log: () => {} });
      expect(site).toMatchObject({ is_demo: 1, published: 1 });
      const page = await request(app).get(`/s/${site.slug}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain('Site de demonstração');
      expect(page.text).toContain('<meta name="robots" content="noindex">');
      // contatos fictícios não viram links clicáveis
      expect(page.text).not.toMatch(/href="(https:\/\/wa\.me|tel:|mailto:|https:\/\/instagram\.com\/(?!versal))/);
    }
  });

  test('agendamento é simulado: valida, mas não grava nem avisa ninguém', async () => {
    const db = H.getDb();
    const site = db.prepare("SELECT * FROM sites WHERE slug = 'demo-navalha-e-prosa'").get();
    const svc = db.prepare('SELECT * FROM services WHERE site_id = ? ORDER BY sort_order LIMIT 1').get(site.id);
    const before = ['bookings', 'notifications', 'message_log'].map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);

    const av = await request(app).get(`/api/public/sites/${site.slug}/days?service_id=${svc.id}`);
    const day = av.body.days.find((d) => d.available).date;
    const slots = (await request(app).get(`/api/public/sites/${site.slug}/availability?service_id=${svc.id}&date=${day}`)).body.slots;
    const body = { service_id: svc.id, date: day, time: slots[0].time, client_name: 'Visitante', client_phone: '(11) 98765-4321' };

    const ok = await request(app).post(`/api/public/sites/${site.slug}/bookings`).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ demo: true, cancel_url: null, booking: { id: null, service_name: svc.name, status: 'confirmed' } });
    // o mesmo horário continua livre, porque nada foi gravado
    expect((await request(app).post(`/api/public/sites/${site.slug}/bookings`).send(body)).status).toBe(201);
    const after = ['bookings', 'notifications', 'message_log'].map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
    expect(after).toEqual(before);

    expect((await request(app).post(`/api/public/sites/${site.slug}/bookings`).send({ ...body, client_phone: '123' })).status).toBe(400);
    expect((await request(app).post(`/api/public/sites/${site.slug}/bookings`).send({ ...body, time: '03:00' })).status).toBe(409);
  });

  test('saúde em demonstração mantém as regras: sem preço e com registro', async () => {
    const page = await request(app).get('/s/demo-clinica-aurora-odontologia');
    expect(page.text).not.toMatch(/R\$/);
    expect(page.text).toContain('CRO-PR 00000');
    const psi = await request(app).get('/s/demo-espaco-escuta-psicologia');
    expect(psi.text).toContain('CRP 07/00000');
    expect(psi.text).not.toMatch(/R\$/);
  });

  test('/exemplos lista só demonstrações publicadas', async () => {
    const real = await H.createSite(app, admin, { name: 'Negócio Real Teste' });
    const hidden = await request(app).post('/api/sites').set(auth).send({ name: 'Demo Rascunho', is_demo: true });
    const r = await request(app).get('/exemplos');
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toMatch(/default-src 'none'/);
    for (const name of ['Clínica Aurora Odontologia', 'Navalha &amp; Prosa Barbearia', 'Atelier Flor de Lis', 'Espaço Escuta Psicologia', 'Bicho Bom Pet Care']) {
      expect(r.text).toContain(name);
    }
    expect(r.text).not.toContain(real.site.name);
    expect(r.text).not.toContain(hidden.body.site.name);
    expect(r.text).toContain('instagram.com/versal.estudio');
  });

  test('exportação estática: páginas autossuficientes com agenda simulada', async () => {
    const out = path.join(H.dir, 'export');
    const files = await exportDemos(out);
    expect(files[0]).toBe('index.html');
    expect(files).toHaveLength(6);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(index).toContain('href="demo-clinica-aurora-odontologia.html"');
    for (const f of files) {
      const html = fs.readFileSync(path.join(out, f), 'utf8');
      expect(html).not.toMatch(/"\/img\/\d+"|\/assets\/booking\.js|href="\/s\//); // nada depende do servidor
    }
    const dent = fs.readFileSync(path.join(out, 'demo-clinica-aurora-odontologia.html'), 'utf8');
    expect(dent).toContain('window.__DEMO__=');
    expect(dent).toContain('href="index.html"');
    expect(dent).toMatch(/src="data:image\/png;base64,/);
    const data = JSON.parse(dent.match(/window\.__DEMO__=(.*?);<\/script>/)[1]);
    expect(data.services.every((sv) => sv.price_cents === null)).toBe(true); // preços continuam ocultos
  });
});

