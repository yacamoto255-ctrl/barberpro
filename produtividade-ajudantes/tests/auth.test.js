'use strict';
const jwt = require('jsonwebtoken');
const { app, request, loginAll, tokens, getDb } = require('./_fixture');
const config = require('../src/config');

beforeAll(loginAll);

describe('Login', () => {
  test('credenciais corretas retornam token e perfil', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'GESTOR@t.com ', password: 'Senha1234' });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('GESTOR');
    expect(r.body.user.password_hash).toBeUndefined();
  });
  test('senha errada => 401 com mensagem genérica', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'admin@t.com', password: 'errada123' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('E-mail ou senha incorretos.');
  });
  test('e-mail inexistente => mesma mensagem (não revela usuários)', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'naoexiste@t.com', password: 'x1234567' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('E-mail ou senha incorretos.');
  });
  test('campos vazios => 400', async () => {
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: '', password: '' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: ['a'], password: {} })).status).toBe(400);
  });
  test('SQL injection no e-mail não autentica', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: "' OR 1=1 --", password: "' OR '1'='1" });
    expect(r.status).toBe(401);
  });
  test('usuário inativo => 403', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'inativo@t.com', password: 'Senha1234' });
    expect(r.status).toBe(403);
  });
  test('força bruta: bloqueia após 5 tentativas (423), mesmo com a senha certa', async () => {
    const db = getDb();
    db.prepare(`INSERT INTO users (name,email,password_hash,role,created_at,updated_at) SELECT 'Alvo','alvo@t.com',password_hash,'OPERADOR',created_at,updated_at FROM users WHERE email='admin@t.com'`).run();
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: 'alvo@t.com', password: 'errada999' });
    const r = await request(app).post('/api/auth/login').send({ email: 'alvo@t.com', password: 'Senha1234' });
    expect(r.status).toBe(423);
    const logs = db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action='LOGIN_FALHA'`).get().c;
    expect(logs).toBeGreaterThanOrEqual(5);
  });
});

describe('Tokens e sessão', () => {
  test('sem token => 401', async () => {
    const r = await request(app).get('/api/helpers');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SEM_TOKEN');
  });
  test('token inválido/adulterado => 401', async () => {
    const r = await request(app).get('/api/helpers').set('Authorization', 'Bearer abc.def.ghi');
    expect(r.body.code).toBe('TOKEN_INVALIDO');
    const forged = jwt.sign({ sub: 1, role: 'ADMIN', tv: 0 }, 'segredo-errado');
    expect((await request(app).get('/api/helpers').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });
  test('algoritmo "none" é rejeitado', async () => {
    const none = jwt.sign({ sub: 1, role: 'ADMIN', tv: 0 }, '', { algorithm: 'none' });
    expect((await request(app).get('/api/helpers').set('Authorization', `Bearer ${none}`)).status).toBe(401);
  });
  test('token expirado => 401 TOKEN_EXPIRADO', async () => {
    const exp = jwt.sign({ sub: 1, role: 'ADMIN', tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, config.JWT_SECRET);
    const r = await request(app).get('/api/helpers').set('Authorization', `Bearer ${exp}`);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('TOKEN_EXPIRADO');
  });
  test('/me retorna o usuário logado', async () => {
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokens.operador}`);
    expect(r.body.user.role).toBe('OPERADOR');
  });
  test('logout invalida o token', async () => {
    const t = (await request(app).post('/api/auth/login').send({ email: 'op@t.com', password: 'Senha1234' })).body.token;
    expect((await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${t}`)).status).toBe(200);
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SESSAO_REVOGADA');
  });
});

describe('Alteração e redefinição de senha', () => {
  test('fluxo completo de alteração', async () => {
    const t = (await request(app).post('/api/auth/login').send({ email: 'gestor@t.com', password: 'Senha1234' })).body.token;
    const auth = { Authorization: `Bearer ${t}` };
    expect((await request(app).post('/api/auth/change-password').set(auth).send({ current_password: 'errada', new_password: 'Nova12345' })).status).toBe(400);
    expect((await request(app).post('/api/auth/change-password').set(auth).send({ current_password: 'Senha1234', new_password: 'curta1' })).status).toBe(400);
    expect((await request(app).post('/api/auth/change-password').set(auth).send({ current_password: 'Senha1234', new_password: 'somenteletras' })).status).toBe(400);
    const ok = await request(app).post('/api/auth/change-password').set(auth).send({ current_password: 'Senha1234', new_password: 'Nova12345' });
    expect(ok.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(401); // token antigo revogado
    expect((await request(app).post('/api/auth/login').send({ email: 'gestor@t.com', password: 'Nova12345' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'gestor@t.com', password: 'Senha1234' })).status).toBe(401);
  });
  test('ADMIN redefine senha de outro usuário (recuperação no MVP)', async () => {
    const id = getDb().prepare(`SELECT id FROM users WHERE email='op@t.com'`).get().id;
    const r = await request(app).post(`/api/users/${id}/reset-password`).set('Authorization', `Bearer ${tokens.admin}`).send({ password: 'Reset12345' });
    expect(r.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'op@t.com', password: 'Reset12345' })).status).toBe(200);
  });
});
