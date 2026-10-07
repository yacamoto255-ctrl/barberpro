'use strict';
const H = require('./helpers');
const fs = require('fs');
const path = require('path');
const models = require('../src/services/models');
const { COPY_LIMITS, HERO_LAYOUTS, HEADING_FONTS, BODY_FONTS } = require('../src/services/theme');
const { request } = H;

const DIR = path.join(__dirname, '..', 'sites', 'modelos');
const raw = Object.fromEntries(fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace('.json', ''), JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))]));
const ALL = models.load().niches.flatMap((n) => n.models);
const HEALTH = ['odontologia', 'psicologia'];
// Conselhos de saúde (CFO, CFP): nada de promessa de resultado, superlativo, preço ou promoção
const FORBIDDEN = /\b(melhor(es)?|garant\w*|sem dor|perfeit\w*|promo\w*|gr[aá]tis|gratuit\w*|desconto\w*|preço\w*|R\$)/i;

let app; let admin; let auth;
beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
  auth = { Authorization: `Bearer ${admin}` };
});
afterAll(H.cleanup);

describe('catálogo de modelos (sites/modelos)', () => {
  test('5 nichos × 10 modelos, ids únicos no formato nicho-NN', () => {
    expect(Object.keys(raw).sort()).toEqual(['barbearia', 'odontologia', 'pet', 'psicologia', 'salao']);
    expect(ALL).toHaveLength(50);
    expect(new Set(ALL.map((m) => m.id)).size).toBe(50);
    for (const n of models.load().niches) {
      expect(n.models.map((m) => m.id)).toEqual(Array.from({ length: 10 }, (_, i) => `${n.category}-${String(i + 1).padStart(2, '0')}`));
    }
  });

  test('todo tema passa na validação sem nenhum ajuste (contraste, fontes, layouts)', () => {
    for (const m of ALL) {
      expect({ id: m.id, warnings: m.warnings }).toEqual({ id: m.id, warnings: [] });
      expect(HEADING_FONTS[m.theme.fonts.heading]).toBeDefined();
      expect(BODY_FONTS[m.theme.fonts.body]).toBeDefined();
    }
  });

  test('variedade real por nicho: 10 fontes de título, 6 layouts, claro e escuro, 10 composições de arte', () => {
    const lum = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    for (const n of models.load().niches) {
      expect(new Set(n.models.map((m) => m.theme.fonts.heading)).size).toBe(10);
      expect(new Set(n.models.map((m) => m.theme.hero_layout))).toEqual(new Set(HERO_LAYOUTS));
      expect(new Set(n.models.map((m) => m.art.composicao)).size).toBe(10);
      expect(new Set(n.models.map((m) => m.theme.palette.bg)).size).toBe(10);
      expect(n.models.some((m) => lum(m.theme.palette.bg) < 200)).toBe(true); // ao menos um escuro
      expect(n.models.some((m) => lum(m.theme.palette.bg) > 600)).toBe(true); // ao menos um claro
    }
  });

  test('textos dentro dos limites (nada é cortado) e sem nome de cidade (servem para qualquer cliente)', () => {
    for (const [cat, doc] of Object.entries(raw)) {
      for (const m of doc.modelos) {
        for (const [k, max] of Object.entries(COPY_LIMITS)) {
          expect({ id: m.id, k, ok: (m.tema.copy[k] || '').length <= max }).toEqual({ id: m.id, k, ok: true });
          expect(m.tema.copy[k]).toBeTruthy();
        }
        const text = Object.values(m.tema.copy).join(' ');
        expect({ id: m.id, cidade: text.includes(m.negocio.city) }).toEqual({ id: m.id, cidade: false });
        expect(m.negocio.whatsapp).toMatch(/^\(\d{2}\) 90000-0000$/);
      }
      expect(cat).toBe(doc.categoria);
    }
  });

  test('saúde (CFO/CFP): preços ocultos, registro fictício do responsável e textos sóbrios', () => {
    for (const cat of HEALTH) {
      const doc = raw[cat];
      expect(doc.site.hide_prices).toBe(true);
      for (const m of doc.modelos) {
        expect(m.negocio.responsible_name).toBeTruthy();
        expect(m.negocio.responsible_registration).toMatch(cat === 'odontologia' ? new RegExp(`^CRO-${m.negocio.state} 00000$`) : /^CRP \d{2}\/00000$/);
        const text = [...Object.values(m.tema.copy), m.negocio.tagline, m.nome, m.estilo].join(' ');
        expect({ id: m.id, proibido: text.match(FORBIDDEN)?.[0] || null }).toEqual({ id: m.id, proibido: null });
      }
      for (const s of doc.servicos) expect(`${s.name} ${s.description}`).not.toMatch(FORBIDDEN);
    }
  });

  test('cada modelo tem capa ilustrada (PNG) e miniatura (JPG)', () => {
    for (const m of ALL) {
      const cover = models.imagePath(m.id, 'cover');
      const thumb = models.imagePath(m.id, 'thumb');
      expect({ id: m.id, cover: !!cover, thumb: !!thumb }).toEqual({ id: m.id, cover: true, thumb: true });
      expect(fs.readFileSync(cover).subarray(0, 4).toString('hex')).toBe('89504e47');
      expect(fs.statSync(cover).size).toBeLessThan(2 * 1024 * 1024); // cabe no limite de upload de imagem
      expect(fs.readFileSync(thumb).subarray(0, 3).toString('hex')).toBe('ffd8ff');
    }
  });

  test('getModel rejeita ids fora do formato', () => {
    for (const bad of ['', '../x', 'barbearia-1', 'BARBEARIA-01', 'barbearia-01.json', 'x'.repeat(200), null, 7]) {
      expect(models.getModel(bad)).toBeNull();
    }
    expect(models.getModel('pet-03').name).toBe('Lua Pet Spa');
  });
});

describe('páginas públicas dos modelos', () => {
  test('/modelos lista os 50 modelos por nicho, com CSP', async () => {
    const r = await request(app).get('/modelos');
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(r.text.match(/class="model"/g)).toHaveLength(50);
    for (const m of ALL) expect(r.text).toContain(`href="/modelos/${m.id}"`);
    for (const id of ['barbearia', 'odontologia', 'pet', 'psicologia', 'salao']) expect(r.text).toContain(`id="${id}"`);
    expect(r.text).toContain('instagram.com/versal.estudio');
    expect(r.text).toMatch(/fictícios/);
  });

  test('cada prévia abre com faixa de modelo, noindex, contatos sem link e agenda simulada', async () => {
    for (const m of ALL) {
      const r = await request(app).get(`/modelos/${m.id}`);
      expect(r.status).toBe(200);
      expect(r.text).toContain('<meta name="robots" content="noindex">');
      expect(r.text).toContain(`Modelo “${m.name.replace(/&/g, '&amp;')}”`);
      expect(r.text).toContain('href="/modelos"');
      expect(r.text).not.toMatch(/href="(https:\/\/wa\.me|tel:|mailto:)/);
      expect(r.text).toContain('<script src="/assets/demo-shim.js"></script>');
      const data = JSON.parse(r.text.match(/<script type="application\/json" id="demo-data">(.*?)<\/script>/s)[1]);
      expect(data.site.slug).toBe(`modelo-${m.id}`);
      expect(data.services.length).toBeGreaterThan(3);
      expect(Object.keys(data.hours).length).toBeGreaterThan(3);
      if (HEALTH.includes(m.category)) {
        expect(r.text).not.toMatch(/R\$/);
        expect(data.services.every((s) => s.price_cents === null)).toBe(true);
        expect(r.text).toContain(m.business.responsible_registration);
        expect(data.professionals.every((p) => p.registration === m.business.responsible_registration)).toBe(true);
      } else {
        expect(r.text).toMatch(/R\$/);
      }
      if (['split', 'split_left', 'banner', 'stacked'].includes(m.theme.hero_layout)) expect(r.text).toContain(`src="/modelos/img/${m.id}.png"`);
    }
  });

  test('dados do JSON da agenda não quebram o HTML (sem "<" cru)', async () => {
    const r = await request(app).get('/modelos/barbearia-01');
    const block = r.text.match(/<script type="application\/json" id="demo-data">(.*?)<\/script>/s)[1];
    expect(block).not.toContain('<');
  });

  test('modelo inexistente: 404', async () => {
    expect((await request(app).get('/modelos/barbearia-99')).status).toBe(404);
    expect((await request(app).get('/modelos/nada')).status).toBe(404);
  });

  test('imagens: capa PNG e miniatura JPG; nomes fora do padrão dão 404', async () => {
    const png = await request(app).get('/modelos/img/salao-02.png');
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.body.subarray(0, 4).toString('hex')).toBe('89504e47');
    const jpg = await request(app).get('/modelos/img/thumbs/salao-02.jpg');
    expect(jpg.status).toBe(200);
    expect(jpg.headers['content-type']).toBe('image/jpeg');
    for (const bad of ['/modelos/img/..%2Fsalao.json', '/modelos/img/salao.json', '/modelos/img/salao-99.png', '/modelos/img/thumbs/salao-02.png', '/modelos/img/salao-02.jpg']) {
      expect((await request(app).get(bad)).status).toBe(404);
    }
  });
});

describe('API de modelos e "Aplicar modelo" no painel', () => {
  test('GET /api/models exige login; admin e operador podem listar e filtrar por nicho', async () => {
    expect((await request(app).get('/api/models')).status).toBe(401);
    const all = await request(app).get('/api/models').set(auth);
    expect(all.status).toBe(200);
    expect(all.body.models).toHaveLength(50);
    expect(all.body.categories.map((c) => c.count)).toEqual([10, 10, 10, 10, 10]);
    expect(all.body.models[0]).toMatchObject({ id: 'barbearia-01', preview_url: '/modelos/barbearia-01', cover_url: '/modelos/img/barbearia-01.png', thumb_url: '/modelos/img/thumbs/barbearia-01.jpg' });
    const op = await H.createUser(app, admin);
    const pet = await request(app).get('/api/models?categoria=pet').set('Authorization', `Bearer ${op.token}`);
    expect(pet.status).toBe(200);
    expect(pet.body.models.map((m) => m.category)).toEqual(Array(10).fill('pet'));
    expect((await request(app).get('/api/models?categoria=fitness').set(auth)).status).toBe(400);
  });

  test('aplicar modelo completo: tema, textos e capa (substitui a antiga), com auditoria', async () => {
    const { site } = await H.createSite(app, admin, { name: 'Barbearia Real' });
    await request(app).post(`/api/sites/${site.id}/images?kind=hero`).set(auth).set('Content-Type', 'image/png').send(H.PNG_1PX);
    const oldHero = H.getDb().prepare('SELECT hero_image_id FROM sites WHERE id = ?').get(site.id).hero_image_id;
    expect(oldHero).toBeTruthy();

    const r = await request(app).post(`/api/sites/${site.id}/apply-model`).set(auth).send({ model_id: 'barbearia-04' });
    expect(r.status).toBe(200);
    const m = models.getModel('barbearia-04');
    expect(r.body.site.theme).toMatchObject({ palette: m.theme.palette, fonts: m.theme.fonts, hero_layout: 'split_left', copy: m.theme.copy, preset: 'custom' });
    expect(r.body.warnings).toEqual([]);
    expect(r.body.previous_theme.fonts).not.toEqual(m.theme.fonts);
    expect(r.body.site.hero_image_id).not.toBe(oldHero);
    const db = H.getDb();
    expect(db.prepare('SELECT 1 FROM images WHERE id = ?').get(oldHero)).toBeUndefined();
    const img = db.prepare('SELECT mime, size FROM images WHERE id = ?').get(r.body.site.hero_image_id);
    expect(img).toMatchObject({ mime: 'image/png', size: fs.statSync(models.imagePath('barbearia-04')).size });
    const log = db.prepare("SELECT * FROM audit_logs WHERE action = 'site.apply_model' ORDER BY id DESC LIMIT 1").get();
    expect(JSON.parse(log.details)).toEqual({ model_id: 'barbearia-04', copy: true, cover: true });

    // o site público já sai com o visual e a capa do modelo
    const page = await request(app).get(`/s/${site.slug}`);
    expect(page.text).toContain('DM Serif Display');
    expect(page.text).toContain('Barba feita como ritual');
    expect(page.text).toContain(`src="/img/${r.body.site.hero_image_id}"`);
  });

  test('sem textos e sem capa: só o visual muda', async () => {
    const { site } = await H.createSite(app, admin, { name: 'Barbearia Só Visual' });
    await request(app).put(`/api/sites/${site.id}/theme`).set(auth).send({ theme: { ...site.theme, copy: { ...site.theme.copy, headline: 'Meu título próprio' } } });
    const r = await request(app).post(`/api/sites/${site.id}/apply-model`).set(auth).send({ model_id: 'barbearia-08', copy: false, cover: false });
    expect(r.status).toBe(200);
    expect(r.body.site.theme.fonts).toEqual(models.getModel('barbearia-08').theme.fonts);
    expect(r.body.site.theme.copy.headline).toBe('Meu título próprio');
    expect(r.body.site.hero_image_id).toBeNull();
  });

  test('modelo de outro nicho avisa para revisar os textos', async () => {
    const { site } = await H.createSite(app, admin, { name: 'Clínica Real', category: 'odontologia' });
    const r = await request(app).post(`/api/sites/${site.id}/apply-model`).set(auth).send({ model_id: 'pet-05' });
    expect(r.status).toBe(200);
    expect(r.body.warnings.join(' ')).toMatch(/pet shop.*Revise/);
    expect(r.body.site.hide_prices).toBe(1); // a regra de saúde do site continua valendo
  });

  test('entradas inválidas', async () => {
    const { site } = await H.createSite(app, admin);
    const url = `/api/sites/${site.id}/apply-model`;
    expect((await request(app).post(url).set(auth).send({})).status).toBe(400);
    expect((await request(app).post(url).set(auth).send({ model_id: 'barbearia-77' })).status).toBe(404);
    expect((await request(app).post(url).set(auth).send({ model_id: '../../etc/passwd' })).status).toBe(404);
    expect((await request(app).post(url).set(auth).send({ model_id: 'pet-01', copy: 'talvez' })).status).toBe(400);
    expect((await request(app).post('/api/sites/999999/apply-model').set(auth).send({ model_id: 'pet-01' })).status).toBe(404);
    expect((await request(app).post(url).send({ model_id: 'pet-01' })).status).toBe(401);
  });
});
