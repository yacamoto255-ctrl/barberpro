'use strict';
const H = require('./helpers');
const { request } = H;

let app; let admin; let op; let siteId;
beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
  op = (await H.createUser(app, admin, { role: 'operator' })).token;
  siteId = (await H.createSite(app, admin)).site.id;
});
afterAll(H.cleanup);

const as = (token) => ({ Authorization: `Bearer ${token}` });

// [método, rota, corpo]
const ADMIN_ONLY = [
  ['get', '/api/users'], ['post', '/api/users', {}], ['get', '/api/settings'], ['put', '/api/settings', {}],
  ['get', '/api/audit'], ['get', '/api/backups'], ['post', '/api/backups'], ['get', '/api/settings/message-log'],
];
const STAFF = [
  ['get', '/api/sites'], ['get', '/api/bookings'], ['get', '/api/dashboard'], ['get', '/api/notifications'],
  ['get', '/api/reports/bookings'], ['get', '/api/themes'],
];

describe('rotas protegidas exigem login', () => {
  test.each([...ADMIN_ONLY, ...STAFF, ['get', '/api/sites/1'], ['delete', '/api/sites/1']])('%s %s sem token → 401', async (...row) => {
    const [m, url, body] = row;
    const r = await request(app)[m](url).send(body);
    expect(r.status).toBe(401);
  });
});

describe('operador', () => {
  test.each(ADMIN_ONLY)('%s %s → 403', async (...row) => {
    const [m, url, body] = row;
    const r = await request(app)[m](url).set(as(op)).send(body);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN');
  });

  test.each(STAFF)('%s %s → 200', async (...row) => {
    const [m, url] = row;
    expect((await request(app)[m](url).set(as(op))).status).toBe(200);
  });

  test('pode criar e editar site, mas não excluir', async () => {
    const c = await request(app).post('/api/sites').set(as(op)).send({ name: 'Site do Operador' });
    expect(c.status).toBe(201);
    expect((await request(app).patch(`/api/sites/${c.body.site.id}`).set(as(op)).send({ tagline: 'Olá' })).status).toBe(200);
    expect((await request(app).delete(`/api/sites/${c.body.site.id}`).set(as(op)).send({ confirm: c.body.site.slug })).status).toBe(403);
  });

  test('não pode excluir agendamento definitivamente', async () => {
    const svc = H.getDb().prepare('SELECT * FROM services WHERE site_id = ?').get(siteId);
    const site = H.getDb().prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    const b = await request(app).post(`/api/public/sites/${site.slug}/bookings`).send(H.bookingBody(svc));
    expect(b.status).toBe(201);
    expect((await request(app).delete(`/api/bookings/${b.body.booking.id}`).set(as(op))).status).toBe(403);
    expect((await request(app).delete(`/api/bookings/${b.body.booking.id}`).set(as(admin))).status).toBe(200);
  });
});

describe('administrador', () => {
  test.each([...ADMIN_ONLY.filter(([m]) => m === 'get'), ...STAFF])('%s %s → 200', async (...row) => {
    const [m, url] = row;
    expect((await request(app)[m](url).set(as(admin))).status).toBe(200);
  });

  test('mudança de perfil vale na hora (sem esperar o token expirar)', async () => {
    const u = await H.createUser(app, admin, { role: 'operator' });
    expect((await request(app).get('/api/users').set(as(u.token))).status).toBe(403);
    await request(app).patch(`/api/users/${u.user.id}`).set(as(admin)).send({ role: 'admin' });
    expect((await request(app).get('/api/users').set(as(u.token))).status).toBe(200);
    await request(app).patch(`/api/users/${u.user.id}`).set(as(admin)).send({ role: 'operator' });
    expect((await request(app).get('/api/users').set(as(u.token))).status).toBe(403);
  });

  test('não remove o último admin nem a própria conta', async () => {
    const me = (await request(app).get('/api/auth/me').set(as(admin))).body.user;
    expect((await request(app).delete(`/api/users/${me.id}`).set(as(admin))).status).toBe(400);
    expect((await request(app).patch(`/api/users/${me.id}`).set(as(admin)).send({ role: 'operator' })).status).toBe(400);
    expect((await request(app).patch(`/api/users/${me.id}`).set(as(admin)).send({ active: false })).status).toBe(400);
  });

  test('CRUD de usuários valida dados e duplicidade', async () => {
    const bad = await request(app).post('/api/users').set(as(admin)).send({ name: 'X', email: 'ruim', password: '1', role: 'chefe' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['name', 'email', 'password', 'role']));
    const ok = await request(app).post('/api/users').set(as(admin)).send({ name: 'Fulana', email: 'fulana@teste.com', password: 'Senha123', role: 'operator', phone: '(21) 99999-1234' });
    expect(ok.status).toBe(201);
    expect(ok.body.user.phone).toBe('5521999991234');
    expect(JSON.stringify(ok.body)).not.toMatch(/password/);
    const dup = await request(app).post('/api/users').set(as(admin)).send({ name: 'Fulana 2', email: 'FULANA@teste.com', password: 'Senha123', role: 'operator' });
    expect(dup.status).toBe(409);
    const list = await request(app).get('/api/users').set(as(admin));
    expect(JSON.stringify(list.body)).not.toMatch(/password_hash|\$2[aby]\$/);
    const edit = await request(app).patch(`/api/users/${ok.body.user.id}`).set(as(admin)).send({ name: 'Fulana Silva' });
    expect(edit.body.user.name).toBe('Fulana Silva');
    expect((await request(app).delete(`/api/users/${ok.body.user.id}`).set(as(admin))).status).toBe(200);
    expect((await request(app).delete(`/api/users/${ok.body.user.id}`).set(as(admin))).status).toBe(404);
  });
});

describe('visitante (cliente final)', () => {
  test('acessa só o site publicado e a API pública', async () => {
    const site = H.getDb().prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    expect((await request(app).get(`/s/${site.slug}`)).status).toBe(200);
    expect((await request(app).get(`/api/public/sites/${site.slug}`)).status).toBe(200);
    await request(app).patch(`/api/sites/${siteId}`).set(as(admin)).send({ published: false });
    expect((await request(app).get(`/s/${site.slug}`)).status).toBe(404);
    expect((await request(app).get(`/api/public/sites/${site.slug}`)).status).toBe(404);
    const preview = await request(app).get(`/api/sites/${siteId}/preview-link`).set(as(op));
    expect((await request(app).get(preview.body.url)).status).toBe(200);
    expect((await request(app).get(`/s/${site.slug}?preview=token-falso`)).status).toBe(404);
    await request(app).patch(`/api/sites/${siteId}`).set(as(admin)).send({ published: true });
  });
});
