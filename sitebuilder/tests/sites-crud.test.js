'use strict';
const H = require('./helpers');
const { request } = H;

let app; let admin; let auth;
beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
  auth = { Authorization: `Bearer ${admin}` };
});
afterAll(H.cleanup);

describe('sites — criar, ver, editar, excluir', () => {
  test('nome obrigatório e campos inválidos', async () => {
    const r = await request(app).post('/api/sites').set(auth).send({
      name: '', email: 'x@', whatsapp: '123', cep: '00000-000', cnpj: '11.222.333/0001-82', instagram: 'perfil com espaço',
      state: 'XX', category: 'inexistente', slot_interval_min: 1, slug: 'Com Espaço',
    });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.fields).sort()).toEqual(
      ['category', 'cep', 'cnpj', 'email', 'instagram', 'name', 'slot_interval_min', 'slug', 'state', 'whatsapp'].sort(),
    );
  });

  test('normaliza máscaras: telefone, CEP, CNPJ numérico e alfanumérico, Instagram', async () => {
    const r = await request(app).post('/api/sites').set(auth).send({
      name: 'Salão da Ana & Cia', whatsapp: '(41) 99876-5432', phone: '41 3333-4444', cep: '80010000',
      cnpj: '11222333000181', instagram: 'https://instagram.com/Salao.Ana/', email: 'CONTATO@ANA.COM', state: 'PR',
    });
    expect(r.status).toBe(201);
    expect(r.body.site).toMatchObject({
      slug: 'salao-da-ana-cia', whatsapp: '5541998765432', phone: '554133334444', cep: '80010-000',
      cnpj: '11.222.333/0001-81', instagram: 'salao.ana', email: 'contato@ana.com', published: 0,
    });
    const alfa = await request(app).patch(`/api/sites/${r.body.site.id}`).set(auth).send({ cnpj: '12.ABC.345/01DE-35' });
    expect(alfa.status).toBe(200);
    expect(alfa.body.site.cnpj).toBe('12.ABC.345/01DE-35');
  });

  test('endereço (slug): automático sem duplicar, reservado e conflito', async () => {
    const a = await request(app).post('/api/sites').set(auth).send({ name: 'Studio Zen' });
    const b = await request(app).post('/api/sites').set(auth).send({ name: 'Studio Zen' });
    expect(a.body.site.slug).toBe('studio-zen');
    expect(b.body.site.slug).toBe('studio-zen-2');
    expect((await request(app).post('/api/sites').set(auth).send({ name: 'X Y', slug: 'admin' })).status).toBe(400);
    expect((await request(app).post('/api/sites').set(auth).send({ name: 'X Y', slug: 'studio-zen' })).status).toBe(409);
    expect((await request(app).patch(`/api/sites/${b.body.site.id}`).set(auth).send({ slug: 'studio-zen' })).status).toBe(409);
  });

  test('caracteres especiais e valores extremos', async () => {
    const long = 'a'.repeat(121);
    expect((await request(app).post('/api/sites').set(auth).send({ name: long })).status).toBe(400);
    const emoji = await request(app).post('/api/sites').set(auth).send({ name: 'Café ☕ & Pão — "Ñandú"', description: 'Linha 1\nLinha 2 <b>sem html</b>' });
    expect(emoji.status).toBe(201);
    expect(emoji.body.site.name).toBe('Café ☕ & Pão — "Ñandú"');
    expect(emoji.body.site.slug).toBe('cafe-pao-nandu');
    const ctrl = await request(app).post('/api/sites').set(auth).send({ name: 'Nome\u0000com\u0007controle' });
    expect(ctrl.body.site.name).toBe('Nomecomcontrole');
    expect((await request(app).post('/api/sites').set(auth).send({ name: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/sites').set(auth).send({ name: ['array'] })).status).toBe(400);
  });

  test('ler, editar parcial, limpar campo e excluir com confirmação', async () => {
    const c = await request(app).post('/api/sites').set(auth).send({ name: 'Pet Feliz', category: 'pet', city: 'Santos' });
    const id = c.body.site.id;
    const g = await request(app).get(`/api/sites/${id}`).set(auth);
    expect(g.status).toBe(200);
    expect(g.body.hours.length).toBe(6); // seg–sáb padrão
    expect(g.body.site.theme.preset).toBe('areia'); // tema padrão da categoria pet
    const p = await request(app).patch(`/api/sites/${id}`).set(auth).send({ tagline: 'Banho e tosa', city: '' });
    expect(p.body.site).toMatchObject({ tagline: 'Banho e tosa', city: null, name: 'Pet Feliz', category: 'pet' });
    expect((await request(app).patch(`/api/sites/${id}`).set(auth).send({ name: '' })).status).toBe(400);
    expect((await request(app).delete(`/api/sites/${id}`).set(auth).send({ confirm: 'errado' })).status).toBe(400);
    expect((await request(app).delete(`/api/sites/${id}`).set(auth).send({ confirm: c.body.site.slug })).status).toBe(200);
    expect((await request(app).get(`/api/sites/${id}`).set(auth)).status).toBe(404);
    expect(H.getDb().prepare('SELECT COUNT(*) AS n FROM business_hours WHERE site_id = ?').get(id).n).toBe(0); // cascata
    expect((await request(app).get('/api/sites/abc').set(auth)).status).toBe(400);
  });
});

describe('serviços', () => {
  let siteId;
  beforeAll(async () => { siteId = (await request(app).post('/api/sites').set(auth).send({ name: 'Clínica Sorriso', category: 'odontologia' })).body.site.id; });

  test('CRUD completo com validação de preço e duração', async () => {
    const bad = await request(app).post(`/api/sites/${siteId}/services`).set(auth).send({ name: 'A', duration_min: 2, price: 'abc' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields).sort()).toEqual(['duration_min', 'name', 'price']);
    const c = await request(app).post(`/api/sites/${siteId}/services`).set(auth).send({ name: 'Limpeza', duration_min: 45, price: 'R$ 1.234,56' });
    expect(c.status).toBe(201);
    expect(c.body.service).toMatchObject({ price_cents: 123456, duration_min: 45, active: 1 });
    expect((await request(app).post(`/api/sites/${siteId}/services`).set(auth).send({ name: 'limpeza', duration_min: 30, price: 0 })).status).toBe(409);
    const e = await request(app).patch(`/api/sites/${siteId}/services/${c.body.service.id}`).set(auth).send({ price: '150', active: false });
    expect(e.body.service).toMatchObject({ price_cents: 15000, active: 0, name: 'Limpeza' });
    expect((await request(app).delete(`/api/sites/${siteId}/services/${c.body.service.id}`).set(auth)).status).toBe(200);
    expect((await request(app).delete(`/api/sites/${siteId}/services/${c.body.service.id}`).set(auth)).status).toBe(404);
  });

  test('não exclui serviço com agendamento futuro (sem perda de dados)', async () => {
    const { site, service } = await H.createSite(app, admin);
    const b = await request(app).post(`/api/public/sites/${site.slug}/bookings`).send(H.bookingBody(service));
    expect(b.status).toBe(201);
    const d = await request(app).delete(`/api/sites/${site.id}/services/${service.id}`).set(auth);
    expect(d.status).toBe(409);
    expect(d.body.error).toMatch(/Desative/);
  });

  test('serviço de outro site não é acessível pelo site errado', async () => {
    const other = await H.createSite(app, admin);
    expect((await request(app).patch(`/api/sites/${siteId}/services/${other.service.id}`).set(auth).send({ name: 'Hack' })).status).toBe(404);
  });
});

describe('profissionais, horários e bloqueios', () => {
  let site; let service;
  beforeAll(async () => { ({ site, service } = await H.createSite(app, admin)); });

  test('profissional com serviços vinculados e validação', async () => {
    const other = await H.createSite(app, admin);
    expect((await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Ana', service_ids: [other.service.id] })).status).toBe(400);
    expect((await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Ana', service_ids: 'x' })).status).toBe(400);
    const p = await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Ana', title: 'Barbeira', service_ids: [service.id] });
    expect(p.status).toBe(201);
    expect(p.body.professional.service_ids).toEqual([service.id]);
    const e = await request(app).patch(`/api/sites/${site.id}/professionals/${p.body.professional.id}`).set(auth).send({ service_ids: [], bio: 'Experiente' });
    expect(e.body.professional).toMatchObject({ service_ids: [], bio: 'Experiente' });
    expect((await request(app).delete(`/api/sites/${site.id}/professionals/${p.body.professional.id}`).set(auth)).status).toBe(200);
  });

  test('horários: valida formato, ordem, sobreposição e limite', async () => {
    const put = (hours) => request(app).put(`/api/sites/${site.id}/hours`).set(auth).send({ hours });
    expect((await put([{ weekday: 1, open_time: '25:00', close_time: '26:00' }])).status).toBe(400);
    expect((await put([{ weekday: 7, open_time: '08:00', close_time: '12:00' }])).status).toBe(400);
    expect((await put([{ weekday: 1, open_time: '12:00', close_time: '08:00' }])).status).toBe(400);
    expect((await put([{ weekday: 1, open_time: '08:00', close_time: '12:00' }, { weekday: 1, open_time: '11:00', close_time: '14:00' }])).status).toBe(400);
    expect((await put(Array.from({ length: 5 }, (_, i) => ({ weekday: 2, open_time: `0${i}:00`, close_time: `0${i}:30` })))).status).toBe(400);
    const ok = await put([{ weekday: 1, open_time: '08:00', close_time: '12:00' }, { weekday: 1, open_time: '13:00', close_time: '18:00' }]);
    expect(ok.status).toBe(200);
    expect(ok.body.hours).toHaveLength(2);
    expect((await request(app).put(`/api/sites/${site.id}/hours`).set(auth).send({})).status).toBe(400);
  });

  test('bloqueios: início antes do fim e profissional do próprio site', async () => {
    const add = (b) => request(app).post(`/api/sites/${site.id}/blocks`).set(auth).send(b);
    expect((await add({ starts_at: '2030-01-02 10:00', ends_at: '2030-01-02 09:00' })).status).toBe(400);
    expect((await add({ starts_at: '2030-02-30 10:00', ends_at: '2030-03-01 09:00' })).status).toBe(400);
    expect((await add({ starts_at: '2030-01-02 10:00', ends_at: '2030-01-02 12:00', professional_id: 99999 })).status).toBe(404);
    const ok = await add({ starts_at: '2030-01-02 10:00', ends_at: '2030-01-02 12:00', reason: 'Feriado' });
    expect(ok.status).toBe(201);
    expect((await request(app).delete(`/api/sites/${site.id}/blocks/${ok.body.block.id}`).set(auth)).status).toBe(200);
    expect((await request(app).delete(`/api/sites/${site.id}/blocks/${ok.body.block.id}`).set(auth)).status).toBe(404);
  });
});

describe('upload de imagens', () => {
  let site;
  beforeAll(async () => { ({ site } = await H.createSite(app, admin)); });
  const upload = (kind, buf, type = 'image/png') => request(app).post(`/api/sites/${site.id}/images?kind=${kind}`).set(auth).set('Content-Type', type).send(buf);

  test('aceita PNG/JPG/WebP pelo conteúdo real e serve com o tipo correto', async () => {
    const r = await upload('gallery', H.PNG_1PX);
    expect(r.status).toBe(201);
    expect(r.body.image).toMatchObject({ kind: 'gallery', mime: 'image/png' });
    const img = await request(app).get(`/img/${r.body.image.id}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(img.body, H.PNG_1PX)).toBe(0); // integridade
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    expect((await upload('gallery', jpg, 'image/jpeg')).body.image.mime).toBe('image/jpeg');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(10)]);
    expect((await upload('gallery', webp, 'image/webp')).body.image.mime).toBe('image/webp');
  });

  test('recusa arquivo inválido, disfarçado, SVG e grande demais', async () => {
    expect((await upload('gallery', Buffer.from('%PDF-1.4 conteudo qualquer'), 'application/pdf')).status).toBe(415);
    expect((await upload('gallery', Buffer.from('<script>alert(1)</script>xxxxxxxx'), 'image/png')).status).toBe(415);
    expect((await upload('gallery', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml')).status).toBe(415);
    expect((await upload('gallery', Buffer.alloc(0), 'image/png')).status).toBe(415);
    const big = Buffer.concat([H.PNG_1PX, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await upload('gallery', big)).status).toBe(413);
    expect((await upload('banner', H.PNG_1PX)).status).toBe(400);
  });

  test('trocar logo apaga a anterior; excluir imagem limpa referências', async () => {
    const a = await upload('logo', H.PNG_1PX);
    const b = await upload('logo', H.PNG_1PX);
    expect((await request(app).get(`/img/${a.body.image.id}`)).status).toBe(404);
    const s = (await request(app).get(`/api/sites/${site.id}`).set(auth)).body.site;
    expect(s.logo_image_id).toBe(b.body.image.id);
    expect((await request(app).delete(`/api/sites/${site.id}/images/${b.body.image.id}`).set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/sites/${site.id}`).set(auth)).body.site.logo_image_id).toBeNull();
    expect((await request(app).get('/img/abc')).status).toBe(404);
  });

  test('galeria tem limite de 12 imagens', async () => {
    const { site: s2 } = await H.createSite(app, admin);
    for (let i = 0; i < 12; i++) await request(app).post(`/api/sites/${s2.id}/images?kind=gallery`).set(auth).set('Content-Type', 'image/png').send(H.PNG_1PX);
    const r = await request(app).post(`/api/sites/${s2.id}/images?kind=gallery`).set(auth).set('Content-Type', 'image/png').send(H.PNG_1PX);
    expect(r.status).toBe(400);
  });

  test('foto do profissional', async () => {
    const p = await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Bia' });
    const r = await request(app).post(`/api/sites/${site.id}/professionals/${p.body.professional.id}/photo`).set(auth).set('Content-Type', 'image/png').send(H.PNG_1PX);
    expect(r.status).toBe(201);
    expect(r.body.professional.photo_image_id).toBeGreaterThan(0);
  });
});

describe('tema', () => {
  test('salva tema válido, corrige contraste e ignora valores inválidos', async () => {
    const { site } = await H.createSite(app, admin);
    const r = await request(app).put(`/api/sites/${site.id}/theme`).set(auth).send({
      theme: {
        preset: 'custom', palette: { bg: '#ffffff', text: '#fefefe', primary: 'red', surface: '#ffffff', muted: '#999999', on_primary: '#ffffff', accent: '#00aa00' },
        fonts: { heading: 'Comic Sans MS', body: 'Karla' }, hero_layout: 'split', radius: 'round', background: 'url(javascript:alert(1))',
        copy: { headline: 'Olá <script>', about: 'x'.repeat(2000) },
      },
    });
    expect(r.status).toBe(200);
    const t = r.body.site.theme;
    expect(t.fonts.heading).not.toBe('Comic Sans MS');
    expect(t.fonts.body).toBe('Karla');
    expect(t.palette.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.palette.text).not.toBe('#fefefe');
    expect(['plain', 'gradient', 'grain', 'grid', 'dots']).toContain(t.background);
    expect(t.copy.about.length).toBe(900);
    expect(r.body.warnings.length).toBeGreaterThan(0);
    expect((await request(app).put(`/api/sites/${site.id}/theme`).set(auth).send({ theme: 'x' })).status).toBe(400);
    const themes = await request(app).get('/api/themes').set(auth);
    expect(themes.body.presets).toHaveLength(6);
    expect(themes.body.ai_available).toBe(false);
  });
});
