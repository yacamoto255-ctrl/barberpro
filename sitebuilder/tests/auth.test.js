'use strict';
const H = require('./helpers');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../src/auth');
const { request } = H;

let app;
beforeAll(() => { app = H.makeApp(); });
afterAll(H.cleanup);

describe('configuração inicial', () => {
  test('informa que precisa de setup e valida campos', async () => {
    expect((await request(app).get('/api/auth/setup-status')).body).toEqual({ needsSetup: true });
    const empty = await request(app).post('/api/auth/setup').send({});
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.body.fields)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    const weak = await request(app).post('/api/auth/setup').send({ name: 'A Admin', email: 'a@b.com', password: 'abc' });
    expect(weak.status).toBe(400);
    expect(weak.body.fields.password).toMatch(/8 caracteres/);
    const noDigit = await request(app).post('/api/auth/setup').send({ name: 'A Admin', email: 'a@b.com', password: 'somenteletras' });
    expect(noDigit.body.fields.password).toMatch(/letras e números/);
    const badEmail = await request(app).post('/api/auth/setup').send({ name: 'A Admin', email: 'nao-e-email', password: 'Senha123' });
    expect(badEmail.body.fields.email).toBeDefined();
  });

  test('cria o primeiro admin uma única vez', async () => {
    const token = await H.setupAdmin(app);
    expect(token).toBeTruthy();
    const again = await request(app).post('/api/auth/setup').send({ ...H.ADMIN, email: 'outro@teste.com' });
    expect(again.status).toBe(409);
    expect((await request(app).get('/api/auth/setup-status')).body.needsSetup).toBe(false);
  });

  test('senha é guardada com hash bcrypt, nunca em texto', () => {
    const u = H.getDb().prepare('SELECT password_hash FROM users WHERE email = ?').get(H.ADMIN.email);
    expect(u.password_hash).toMatch(/^\$2[aby]\$/);
    expect(u.password_hash).not.toContain(H.ADMIN.password);
  });
});

describe('login e sessão', () => {
  test('login correto devolve token e dados sem hash', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'ADMIN@teste.com', password: H.ADMIN.password });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    expect(r.body.user).toMatchObject({ email: H.ADMIN.email, role: 'admin' });
    expect(JSON.stringify(r.body)).not.toMatch(/password_hash|\$2[aby]\$/);
  });

  test('senha errada, e-mail inexistente e campos vazios', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: 'Errada123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'ninguem@teste.com', password: 'Senha123' })).status).toBe(401);
    const empty = await request(app).post('/api/auth/login').send({ email: '', password: '' });
    expect(empty.status).toBe(400);
    // reseta contador de falhas para os próximos testes
    H.getDb().prepare('UPDATE users SET failed_logins = 0, locked_until = NULL').run();
  });

  test('tentativas de SQL injection não autenticam', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: "' OR 1=1 --", password: 'x' });
    expect(a.status).toBe(400);
    const b = await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: "' OR '1'='1" });
    expect(b.status).toBe(401);
    const c = await request(app).post('/api/auth/login').send({ email: { $ne: '' }, password: 'x' });
    expect(c.status).toBe(400);
    H.getDb().prepare('UPDATE users SET failed_logins = 0, locked_until = NULL').run();
  });

  test('bloqueia a conta após 5 senhas erradas (força bruta)', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: `Errada${i}x` })).status).toBe(401);
    }
    const locked = await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: H.ADMIN.password });
    expect(locked.status).toBe(423);
    // expira o bloqueio
    H.getDb().prepare('UPDATE users SET locked_until = ? WHERE email = ?').run(Date.now() - 1000, H.ADMIN.email);
    expect((await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: H.ADMIN.password })).status).toBe(200);
    const actions = H.getDb().prepare("SELECT action FROM audit_logs WHERE action LIKE 'auth.%'").all().map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.login', 'auth.login_failed', 'auth.account_locked', 'auth.login_blocked']));
  });

  test('limite de requisições por IP no login (429)', async () => {
    const limited = H.makeApp({ login: H.rateLimit({ name: 'test-login', windowMs: 60_000, max: 3 }) });
    for (let i = 0; i < 3; i++) await request(limited).post('/api/auth/login').send({ email: 'x@y.com', password: 'Senha123' });
    const r = await request(limited).post('/api/auth/login').send({ email: 'x@y.com', password: 'Senha123' });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
  });

  test('/me, logout e token revogado', async () => {
    const { token } = (await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: H.ADMIN.password })).body;
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('TOKEN_REVOKED');
  });

  test('sem token, token inválido, adulterado e expirado', async () => {
    expect((await request(app).get('/api/auth/me')).body.code).toBe('NO_TOKEN');
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi')).body.code).toBe('TOKEN_INVALID');
    const forged = jwt.sign({ sub: 1, role: 'admin', jti: 'x' }, 'segredo-errado-com-mais-de-32-caracteres!!');
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).body.code).toBe('TOKEN_INVALID');
    const none = jwt.sign({ sub: 1, role: 'admin', jti: 'y' }, null, { algorithm: 'none' });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${none}`)).status).toBe(401);
    const expired = jwt.sign({ sub: 1, role: 'admin', jti: 'z', exp: Math.floor(Date.now() / 1000) - 60 }, jwtSecret());
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('TOKEN_EXPIRED');
  });

  test('token de usuário desativado ou removido é recusado', async () => {
    const adminToken = (await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: H.ADMIN.password })).body.token;
    const op = await H.createUser(app, adminToken);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${op.token}`)).status).toBe(200);
    await request(app).patch(`/api/users/${op.user.id}`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${op.token}`)).body.code).toBe('USER_INACTIVE');
    const login = await request(app).post('/api/auth/login').send({ email: op.email, password: op.password });
    expect(login.status).toBe(403);
    await request(app).delete(`/api/users/${op.user.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${op.token}`)).status).toBe(401);
  });
});

describe('senhas', () => {
  let adminToken;
  beforeAll(async () => {
    adminToken = (await request(app).post('/api/auth/login').send({ email: H.ADMIN.email, password: H.ADMIN.password })).body.token;
  });

  test('troca de senha valida a atual, invalida sessões antigas e devolve token novo', async () => {
    const op = await H.createUser(app, adminToken);
    const other = (await request(app).post('/api/auth/login').send({ email: op.email, password: op.password })).body.token;
    const auth = { Authorization: `Bearer ${op.token}` };
    expect((await request(app).post('/api/auth/change-password').set(auth).send({ current_password: 'Errada123', new_password: 'Nova12345' })).status).toBe(400);
    expect((await request(app).post('/api/auth/change-password').set(auth).send({ current_password: op.password, new_password: op.password })).status).toBe(400);
    expect((await request(app).post('/api/auth/change-password').set(auth).send({ current_password: op.password, new_password: 'curta' })).status).toBe(400);

    // garante que a troca aconteça num segundo posterior à emissão dos tokens antigos
    await new Promise((r) => setTimeout(r, 1100));
    const ok = await request(app).post('/api/auth/change-password').set(auth).send({ current_password: op.password, new_password: 'Nova12345' });
    expect(ok.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${other}`)).body.code).toBe('PASSWORD_CHANGED');
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ok.body.token}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: op.email, password: 'Nova12345' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: op.email, password: op.password })).status).toBe(401);
  });

  test('esqueci a senha responde igual para e-mail existente e inexistente', async () => {
    const a = await request(app).post('/api/auth/forgot-password').send({ email: H.ADMIN.email });
    const b = await request(app).post('/api/auth/forgot-password').send({ email: 'naoexiste@teste.com' });
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect((await request(app).post('/api/auth/forgot-password').send({ email: '' })).status).toBe(400);
  });

  test('link de redefinição funciona uma vez e expira', async () => {
    const op = await H.createUser(app, adminToken);
    const link = await request(app).post(`/api/users/${op.user.id}/reset-link`).set('Authorization', `Bearer ${adminToken}`);
    expect(link.status).toBe(200);
    const token = link.body.url.split('/').pop();
    expect((await request(app).post('/api/auth/reset-password').send({ token, new_password: 'fraca' })).status).toBe(400);
    expect((await request(app).post('/api/auth/reset-password').send({ token, new_password: 'Redef1234' })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token, new_password: 'Outra1234' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: op.email, password: 'Redef1234' })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token: 'inventado-xxxxxxxxxxxxxxxx', new_password: 'Redef1234' })).status).toBe(400);

    const link2 = await request(app).post(`/api/users/${op.user.id}/reset-link`).set('Authorization', `Bearer ${adminToken}`);
    const t2 = link2.body.url.split('/').pop();
    H.getDb().prepare('UPDATE password_resets SET expires_at = ?').run(Date.now() - 1);
    expect((await request(app).post('/api/auth/reset-password').send({ token: t2, new_password: 'Expirou123' })).status).toBe(400);
  });
});
