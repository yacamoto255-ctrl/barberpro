// tests/helpers.js — cada arquivo de teste roda com um banco SQLite próprio em pasta temporária
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite is an experimental') ? undefined : emitWarning.call(process, w, ...a));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitebuilder-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.BACKUP_DIR = path.join(dir, 'backups');
process.env.BCRYPT_ROUNDS = '4';
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SETUP_TOKEN;

const request = require('supertest');
const { createApp } = require('../src/app');
const { getDb, closeDb } = require('../src/db');
const { rateLimit, resetRateLimits } = require('../src/rateLimit');
const whatsapp = require('../src/services/whatsapp');
const { nowLocal, addDays } = require('../src/services/slots');

// Limites altos por padrão; os testes de limite criam um app próprio
const off = (req, res, next) => next();
function makeApp(limits = {}) {
  return createApp({ limits: { login: off, publicWrite: off, publicRead: off, ai: off, ...limits } });
}

// Sem espera entre tentativas de WhatsApp nos testes
whatsapp._config.retryDelaysMs = [0, 0, 0];
whatsapp._config.fetch = async () => { throw new Error('fetch não mockado no teste'); };

const ADMIN = { name: 'Admin Teste', email: 'admin@teste.com', password: 'Senha123' };

async function setupAdmin(app) {
  const r = await request(app).post('/api/auth/setup').send(ADMIN);
  if (r.status !== 201) throw new Error(`setup falhou: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

async function createUser(app, adminToken, { role = 'operator', email = `op${Date.now()}${Math.random().toString(36).slice(2, 6)}@teste.com`, password = 'Senha123', name = 'Operador' } = {}) {
  const r = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({ name, email, password, role });
  if (r.status !== 201) throw new Error(`createUser falhou: ${r.status} ${JSON.stringify(r.body)}`);
  const l = await request(app).post('/api/auth/login').send({ email, password });
  return { user: r.body.user, token: l.body.token, email, password };
}

/** Site publicado, aberto todos os dias 08–20, sem antecedência mínima */
async function createSite(app, token, extra = {}) {
  const auth = { Authorization: `Bearer ${token}` };
  const s = await request(app).post('/api/sites').set(auth).send({
    name: `Negócio ${Math.random().toString(36).slice(2, 7)}`, category: 'barbearia', published: true,
    whatsapp: '(11) 98765-4321', min_notice_min: 0, slot_interval_min: 30, ...extra,
  });
  if (s.status !== 201) throw new Error(`createSite falhou: ${s.status} ${JSON.stringify(s.body)}`);
  const site = s.body.site;
  const hours = Array.from({ length: 7 }, (_, wd) => ({ weekday: wd, open_time: '08:00', close_time: '20:00' }));
  await request(app).put(`/api/sites/${site.id}/hours`).set(auth).send({ hours });
  const svc = await request(app).post(`/api/sites/${site.id}/services`).set(auth).send({ name: 'Corte', duration_min: 30, price: '50,00' });
  return { site, service: svc.body.service, auth };
}

const futureDate = (days = 2) => addDays(nowLocal().slice(0, 10), days);

function bookingBody(service, overrides = {}) {
  return {
    service_id: service.id, date: futureDate(2), time: '10:00',
    client_name: 'Cliente Teste', client_phone: '(11) 91234-5678', ...overrides,
  };
}

/** PNG 1x1 válido */
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5b0000000049454e44ae426082',
  'hex',
);

function cleanup() {
  closeDb();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

module.exports = {
  request, makeApp, getDb, closeDb, rateLimit, resetRateLimits, whatsapp, setupAdmin, createUser, createSite,
  futureDate, bookingBody, PNG_1PX, ADMIN, cleanup, dir, nowLocal, addDays,
};
