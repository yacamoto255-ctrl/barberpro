'use strict';
const H = require('./helpers');
const { setSetting } = require('../src/settings');
const { availability, addDays, nowLocal } = require('../src/services/slots');
const { request } = H;

let app; let admin; let auth;
beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
  auth = { Authorization: `Bearer ${admin}` };
});
afterAll(H.cleanup);

const book = (slug, body) => request(app).post(`/api/public/sites/${slug}/bookings`).send(body);
const dbSite = (id) => H.getDb().prepare('SELECT * FROM sites WHERE id = ?').get(id);

describe('horários disponíveis', () => {
  test('respeita expediente, duração, intervalo e faixa de almoço', async () => {
    const { site, service } = await H.createSite(app, admin);
    await request(app).put(`/api/sites/${site.id}/hours`).set(auth).send({ hours: Array.from({ length: 7 }, (_, wd) => [
      { weekday: wd, open_time: '09:00', close_time: '12:00' }, { weekday: wd, open_time: '13:00', close_time: '14:00' }]).flat() });
    await request(app).patch(`/api/sites/${site.id}/services/${service.id}`).set(auth).send({ duration_min: 60 });
    const r = await request(app).get(`/api/public/sites/${site.slug}/availability?service_id=${service.id}&date=${H.futureDate(3)}`);
    expect(r.status).toBe(200);
    expect(r.body.slots.map((s) => s.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '13:00']);
  });

  test('dia fechado, data passada, além do limite e data inválida', async () => {
    const { site, service } = await H.createSite(app, admin);
    await request(app).put(`/api/sites/${site.id}/hours`).set(auth).send({ hours: [] });
    const q = (d) => request(app).get(`/api/public/sites/${site.slug}/availability?service_id=${service.id}&date=${d}`);
    expect((await q(H.futureDate(2))).body.reason).toMatch(/Fechado/);
    expect((await q(addDays(nowLocal().slice(0, 10), -1))).body.reason).toMatch(/passado/);
    expect((await q(H.futureDate(400))).body.reason).toMatch(/dias/);
    expect((await q('2026-02-30')).status).toBe(400);
    expect((await request(app).get(`/api/public/sites/${site.slug}/availability?date=${H.futureDate(2)}`)).status).toBe(400);
  });

  test('antecedência mínima corta horários de hoje', () => {
    const site = { id: 0, max_days_ahead: 30, min_notice_min: 120, slot_interval_min: 30 };
    // usa o motor direto com "agora" fixo, sem depender do relógio
    const { site: s } = { site };
    const db = H.getDb();
    const id = Number(db.prepare("INSERT INTO sites (slug, name) VALUES ('antecedencia', 'Antecedência')").run().lastInsertRowid);
    for (let wd = 0; wd < 7; wd++) db.prepare("INSERT INTO business_hours (site_id, weekday, open_time, close_time) VALUES (?, ?, '08:00', '12:00')").run(id, wd);
    const svc = { id: Number(db.prepare("INSERT INTO services (site_id, name, duration_min) VALUES (?, 'X', 30)").run(id).lastInsertRowid), duration_min: 30 };
    const r = availability({ ...s, id }, svc, '2030-05-10', null, { now: '2030-05-10 09:10' });
    expect(r.slots[0].time).toBe('11:30'); // 09:10 + 2h = 11:10 → próximo horário 11:30
  });

  test('bloqueio do negócio e de um profissional', async () => {
    const { site, service } = await H.createSite(app, admin);
    const p1 = (await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'P1' })).body.professional;
    const p2 = (await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'P2' })).body.professional;
    const d = H.futureDate(4);
    await request(app).post(`/api/sites/${site.id}/blocks`).set(auth).send({ starts_at: `${d} 08:00`, ends_at: `${d} 10:00` });
    await request(app).post(`/api/sites/${site.id}/blocks`).set(auth).send({ starts_at: `${d} 10:00`, ends_at: `${d} 11:00`, professional_id: p1.id });
    const r = await request(app).get(`/api/public/sites/${site.slug}/availability?service_id=${service.id}&date=${d}`);
    const map = Object.fromEntries(r.body.slots.map((s) => [s.time, s.professional_ids]));
    expect(map['09:30']).toBeUndefined();
    expect(map['10:00']).toEqual([p2.id]);
    expect(map['11:00']).toEqual([p1.id, p2.id]);
  });

  test('profissional só aparece para serviços que atende', async () => {
    const { site, service } = await H.createSite(app, admin);
    const other = (await request(app).post(`/api/sites/${site.id}/services`).set(auth).send({ name: 'Barba', duration_min: 20, price: 30 })).body.service;
    const p = (await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Só barba', service_ids: [other.id] })).body.professional;
    const r = await request(app).get(`/api/public/sites/${site.slug}/availability?service_id=${service.id}&date=${H.futureDate(2)}`);
    expect(r.body.slots).toEqual([]);
    expect(r.body.reason).toMatch(/Nenhum profissional/);
    const r2 = await request(app).get(`/api/public/sites/${site.slug}/availability?service_id=${other.id}&date=${H.futureDate(2)}&professional_id=${p.id}`);
    expect(r2.body.slots.length).toBeGreaterThan(0);
    const days = await request(app).get(`/api/public/sites/${site.slug}/days?service_id=${other.id}`);
    expect(days.body.days).toHaveLength(14);
    expect(days.body.has_more).toBe(true);
  });
});

describe('agendar pelo site', () => {
  test('cria, impede conflito e não expõe dados de outros clientes', async () => {
    const { site, service } = await H.createSite(app, admin);
    const ok = await book(site.slug, H.bookingBody(service, { client_email: 'cli@teste.com', notes: 'Primeira vez' }));
    expect(ok.status).toBe(201);
    expect(ok.body.booking).toMatchObject({ service_name: 'Corte', price_cents: 5000, status: 'confirmed' });
    expect(ok.body.cancel_url).toMatch(/\/cancelar\//);
    const saved = H.getDb().prepare('SELECT * FROM bookings WHERE id = ?').get(ok.body.booking.id);
    expect(saved).toMatchObject({ client_phone: '5511912345678', client_email: 'cli@teste.com', source: 'site', ends_at: saved.starts_at.replace('10:00', '10:30') });
    expect(saved.cancel_token_hash).not.toBe(ok.body.cancel_url.split('/').pop()); // só o hash fica no banco

    const conflict = await book(site.slug, H.bookingBody(service, { client_phone: '11 98888-7777', client_name: 'Outro' }));
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('SLOT_TAKEN');
    const avail = await request(app).get(`/api/public/sites/${site.slug}/availability?service_id=${service.id}&date=${H.futureDate(2)}`);
    expect(avail.body.slots.map((s) => s.time)).not.toContain('10:00');
    expect(JSON.stringify(avail.body)).not.toMatch(/Cliente Teste|5511912345678/);
    const n = H.getDb().prepare("SELECT * FROM notifications WHERE booking_id = ? AND type = 'new_booking'").get(ok.body.booking.id);
    expect(n.message).toMatch(/Cliente Teste/);
  });

  test('10 pedidos simultâneos no mesmo horário: só 1 entra', async () => {
    const { site, service } = await H.createSite(app, admin);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => book(site.slug, H.bookingBody(service, {
      time: '15:00', client_name: `Pessoa ${i}`, client_phone: `11 9${String(i).padStart(4, '0')}-1234`,
    }))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(H.getDb().prepare("SELECT COUNT(*) AS n FROM bookings WHERE site_id = ? AND starts_at LIKE '% 15:00'").get(site.id).n).toBe(1);
  });

  test('"sem preferência" distribui entre profissionais e recusa quando todos estão ocupados', async () => {
    const { site, service } = await H.createSite(app, admin);
    expect((await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Ana' })).status).toBe(201);
    expect((await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Beto' })).status).toBe(201);
    const a = await book(site.slug, H.bookingBody(service, { time: '11:00', client_phone: '11 91111-1111' }));
    const b = await book(site.slug, H.bookingBody(service, { time: '11:00', client_phone: '11 92222-2222' }));
    const c = await book(site.slug, H.bookingBody(service, { time: '11:00', client_phone: '11 93333-3333' }));
    expect([a.status, b.status, c.status]).toEqual([201, 201, 409]);
    expect(new Set([a.body.booking.professional_name, b.body.booking.professional_name])).toEqual(new Set(['Ana', 'Beto']));
  });

  test('mesmo cliente não marca duas vezes no mesmo horário', async () => {
    const { site, service } = await H.createSite(app, admin);
    expect((await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Ana' })).status).toBe(201);
    expect((await request(app).post(`/api/sites/${site.id}/professionals`).set(auth).send({ name: 'Beto' })).status).toBe(201);
    expect((await book(site.slug, H.bookingBody(service, { time: '12:00' }))).status).toBe(201);
    const dup = await book(site.slug, H.bookingBody(service, { time: '12:00' }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE');
  });

  test('validações do formulário público', async () => {
    const { site, service } = await H.createSite(app, admin);
    const bad = await book(site.slug, { service_id: service.id, date: 'amanhã', time: '9h', client_name: '', client_phone: '123', client_email: 'x@' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields).sort()).toEqual(['client_email', 'client_name', 'client_phone', 'date', 'time']);
    expect((await book(site.slug, H.bookingBody(service, { client_name: '12345' }))).status).toBe(400);
    expect((await book(site.slug, H.bookingBody(service, { time: '10:07' }))).status).toBe(409); // fora da grade
    expect((await book(site.slug, H.bookingBody(service, { time: '22:00' }))).status).toBe(409); // fora do expediente
    expect((await book(site.slug, H.bookingBody(service, { service_id: 99999 }))).status).toBe(404);
    expect((await book(site.slug, H.bookingBody(service, { website: 'http://spam' }))).status).toBe(400); // honeypot
    expect((await book('nao-existe', H.bookingBody(service))).status).toBe(404);
  });

  test('site despublicado ou com agenda desligada não aceita', async () => {
    const { site, service } = await H.createSite(app, admin);
    await request(app).patch(`/api/sites/${site.id}`).set(auth).send({ booking_enabled: false });
    expect((await book(site.slug, H.bookingBody(service))).status).toBe(403);
    await request(app).patch(`/api/sites/${site.id}`).set(auth).send({ booking_enabled: true, published: false });
    expect((await book(site.slug, H.bookingBody(service))).status).toBe(404);
  });

  test('limite de agendamentos por IP (anti-spam)', async () => {
    const limited = H.makeApp({ publicWrite: H.rateLimit({ name: 'test-pubw', windowMs: 60_000, max: 2 }) });
    const { site, service } = await H.createSite(app, admin);
    const r = [];
    for (let i = 0; i < 3; i++) r.push((await request(limited).post(`/api/public/sites/${site.slug}/bookings`).send(H.bookingBody(service, { time: `1${i}:30`, client_phone: `11 9777${i}-0000` }))).status);
    expect(r).toEqual([201, 201, 429]);
  });
});

describe('cancelamento pelo cliente', () => {
  test('link mostra o horário, cancela uma vez e libera a vaga', async () => {
    const { site, service } = await H.createSite(app, admin);
    const ok = await book(site.slug, H.bookingBody(service, { time: '16:00' }));
    const path = new URL(ok.body.cancel_url).pathname;
    const page = await request(app).get(path);
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/Sim, cancelar meu horário/);
    const done = await request(app).post(path);
    expect(done.status).toBe(200);
    expect(done.text).toMatch(/Agendamento cancelado/);
    expect(H.getDb().prepare('SELECT status, cancelled_by FROM bookings WHERE id = ?').get(ok.body.booking.id)).toEqual({ status: 'cancelled', cancelled_by: 'client' });
    const again = await request(app).post(path);
    expect(again.status).toBe(409);
    expect((await book(site.slug, H.bookingBody(service, { time: '16:00', client_phone: '11 95555-5555' }))).status).toBe(201);
    expect(H.getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'booking_cancelled' AND booking_id = ?").get(ok.body.booking.id).n).toBe(1);
    expect((await request(app).get(`/s/${site.slug}/cancelar/token-inventado-1234567890`)).status).toBe(404);
  });
});

describe('agenda no painel', () => {
  let site; let service;
  beforeAll(async () => { ({ site, service } = await H.createSite(app, admin)); });
  const panelBook = (b) => request(app).post('/api/bookings').set(auth).send({ site_id: site.id, service_id: service.id, client_name: 'Balcão', client_phone: '11 94444-4444', ...b });

  test('lança fora do expediente, mas nunca em conflito', async () => {
    const d = H.futureDate(5);
    const late = await panelBook({ date: d, time: '21:00' });
    expect(late.status).toBe(201);
    expect(late.body.booking.source).toBe('panel');
    expect((await panelBook({ date: d, time: '21:15', client_phone: '11 96666-6666' })).status).toBe(409);
    expect((await panelBook({ date: d, time: '21:30', client_phone: '11 96666-6666' })).status).toBe(201);
  });

  test('lista com filtros, busca e paginação', async () => {
    const all = await request(app).get(`/api/bookings?site_id=${site.id}`).set(auth);
    expect(all.body.total).toBe(2);
    const q = await request(app).get(`/api/bookings?site_id=${site.id}&q=96666`).set(auth);
    expect(q.body.total).toBe(1);
    const inj = await request(app).get(`/api/bookings?q=${encodeURIComponent("' OR 1=1 --")}`).set(auth);
    expect(inj.status).toBe(200);
    expect(inj.body.total).toBe(0);
    const pct = await request(app).get('/api/bookings?q=%25').set(auth);
    expect(pct.body.total).toBe(0);
    expect((await request(app).get('/api/bookings?from=2030-01-10&to=2030-01-01').set(auth)).status).toBe(400);
    expect((await request(app).get('/api/bookings?status=xyz').set(auth)).status).toBe(400);
    const page = await request(app).get(`/api/bookings?site_id=${site.id}&limit=1&page=2`).set(auth);
    expect(page.body.bookings).toHaveLength(1);
  });

  test('status, remarcação e reativação com checagem de conflito', async () => {
    const d = H.futureDate(6);
    const a = (await panelBook({ date: d, time: '10:00' })).body.booking;
    const b = (await panelBook({ date: d, time: '11:00', client_phone: '11 97777-1111' })).body.booking;
    expect((await request(app).patch(`/api/bookings/${b.id}`).set(auth).send({ date: d, time: '10:00' })).status).toBe(409);
    expect((await request(app).patch(`/api/bookings/${b.id}`).set(auth).send({ date: d })).status).toBe(400);
    expect((await request(app).patch(`/api/bookings/${a.id}`).set(auth).send({ status: 'cancelled' })).body.booking.status).toBe('cancelled');
    const moved = await request(app).patch(`/api/bookings/${b.id}`).set(auth).send({ date: d, time: '10:00' });
    expect(moved.status).toBe(200);
    expect(moved.body.booking.starts_at).toBe(`${d} 10:00`);
    const react = await request(app).patch(`/api/bookings/${a.id}`).set(auth).send({ status: 'confirmed' });
    expect(react.status).toBe(409);
    expect((await request(app).patch(`/api/bookings/${b.id}`).set(auth).send({ status: 'completed', notes: 'Pago no Pix' })).body.booking).toMatchObject({ status: 'completed', notes: 'Pago no Pix' });
    expect((await request(app).patch(`/api/bookings/${b.id}`).set(auth).send({ status: 'xyz' })).status).toBe(400);
    expect((await request(app).get('/api/bookings/999999').set(auth)).status).toBe(404);
  });
});

describe('WhatsApp (Evolution API)', () => {
  const calls = [];
  beforeAll(() => {
    setSetting('evolution_url', 'https://evo.teste');
    setSetting('evolution_apikey', 'chave-evo');
    setSetting('evolution_instance', 'agencia');
  });
  afterAll(() => { H.whatsapp._config.fetch = async () => { throw new Error('sem mock'); }; });
  const settle = () => new Promise((r) => setTimeout(r, 50));

  test('envia aviso ao negócio e confirmação ao cliente', async () => {
    H.whatsapp._config.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), apikey: opts.headers.apikey }); return new Response('{"key":{"id":"1"}}', { status: 201 }); };
    const { site, service } = await H.createSite(app, admin, { address: 'Rua A, 10', city: 'São Paulo' });
    const r = await book(site.slug, H.bookingBody(service, { time: '17:00' }));
    await settle();
    expect(r.status).toBe(201);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://evo.teste/message/sendText/agencia');
    expect(calls[0].apikey).toBe('chave-evo');
    expect(calls[0].body.number).toBe('5511987654321');
    expect(calls[0].body.text).toMatch(/Novo agendamento/);
    expect(calls[1].body.number).toBe('5511912345678');
    expect(calls[1].body.text).toMatch(/cancelar/);
    expect(calls[1].body.text).toContain(new URL(r.body.cancel_url).pathname);
    const logs = H.getDb().prepare('SELECT status, attempts FROM message_log WHERE booking_id = ?').all(r.body.booking.id);
    expect(logs).toEqual([{ status: 'sent', attempts: 1 }, { status: 'sent', attempts: 1 }]);
  });

  test('erro 500/rede é reenviado (3 tentativas) e registrado; 4xx não repete', async () => {
    let n = 0;
    H.whatsapp._config.fetch = async () => { n++; if (n === 1) throw new Error('ECONNRESET'); return new Response('erro', { status: 503 }); };
    const r1 = await H.whatsapp.sendWhatsApp({ to: '5511912345678', text: 'oi', purpose: 'test' });
    expect(r1).toMatchObject({ status: 'failed', attempts: 3 });
    expect(n).toBe(3);
    n = 0;
    H.whatsapp._config.fetch = async () => { n++; return n < 3 ? new Response('x', { status: 500 }) : new Response('{}', { status: 200 }); };
    expect(await H.whatsapp.sendWhatsApp({ to: '5511912345678', text: 'oi', purpose: 'test' })).toEqual({ status: 'sent', attempts: 3 });
    n = 0;
    H.whatsapp._config.fetch = async () => { n++; return new Response('{"error":"bad number"}', { status: 400 }); };
    expect((await H.whatsapp.sendWhatsApp({ to: '5511912345678', text: 'oi', purpose: 'test' })).status).toBe('failed');
    expect(n).toBe(1);
    expect((await H.whatsapp.sendWhatsApp({ to: '123', text: 'oi', purpose: 'test' })).status).toBe('failed');
  });

  test('falha do WhatsApp não impede o agendamento', async () => {
    H.whatsapp._config.fetch = async () => { throw new Error('fora do ar'); };
    const { site, service } = await H.createSite(app, admin);
    expect((await book(site.slug, H.bookingBody(service, { time: '18:00' }))).status).toBe(201);
  });

  test('sem configuração: mensagem fica como "não enviada"', async () => {
    setSetting('evolution_url', null);
    expect((await H.whatsapp.sendWhatsApp({ to: '5511912345678', text: 'oi', purpose: 'test' })).status).toBe('skipped');
  });

  test('teste de conexão pelo painel', async () => {
    setSetting('evolution_url', 'https://evo.teste');
    H.whatsapp._config.fetch = async () => new Response('{"instance":{"state":"open"}}', { status: 200 });
    const ok = await request(app).post('/api/settings/test-whatsapp').set(auth).send({});
    expect(ok.body.connection).toMatchObject({ ok: true, state: 'open' });
    H.whatsapp._config.fetch = async () => new Response('{}', { status: 404 });
    const nf = await request(app).post('/api/settings/test-whatsapp').set(auth).send({});
    expect(nf.body.connection).toMatchObject({ ok: false, error: 'Instância não encontrada.' });
  });
});
