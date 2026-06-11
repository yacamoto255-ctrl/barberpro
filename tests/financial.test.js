// tests/financial.test.js
'use strict';

process.env.DB_PATH = ':memory:';

const request   = require('supertest');
const app       = require('../server');
const { getDb } = require('../db');
const bcrypt    = require('bcryptjs');

let ownerToken, barberToken;

beforeAll(async () => {
  const db   = getDb();
  const hash = (p) => bcrypt.hashSync(p, 10);
  db.prepare("INSERT INTO users (name,email,password,role) VALUES ('Owner','fin_owner@t.com',?,'owner')").run(hash('pw'));
  db.prepare("INSERT INTO users (name,email,password,role) VALUES ('Barber','fin_barber@t.com',?,'barber')").run(hash('pw'));
  const bId = db.prepare("SELECT id FROM users WHERE email='fin_barber@t.com'").get().id;
  db.prepare("INSERT INTO barbers (user_id,commission_rate) VALUES (?,40)").run(bId);

  // Seed categories
  db.prepare("INSERT INTO financial_categories (name,type,color) VALUES ('Serviços','income','#22c55e')").run();
  db.prepare("INSERT INTO financial_categories (name,type,color) VALUES ('Aluguel','expense','#ef4444')").run();
});

beforeEach(async () => {
  const login = async (email) => (await request(app).post('/api/auth/login').send({ email, password:'pw' })).body.token;
  ownerToken  = await login('fin_owner@t.com');
  barberToken = await login('fin_barber@t.com');
});

describe('Financial entries CRUD', () => {
  let entryId;

  test('owner creates income entry', async () => {
    const res = await request(app)
      .post('/api/financial/entries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type:'income', description:'Venda serviços', amount:500, date:'2026-06-01', payment_method:'pix' });
    expect(res.status).toBe(201);
    entryId = res.body.id;
  });

  test('owner creates expense entry', async () => {
    const res = await request(app)
      .post('/api/financial/entries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type:'expense', description:'Aluguel', amount:3500, date:'2026-06-05', payment_method:'transfer' });
    expect(res.status).toBe(201);
  });

  test('rejects invalid amount', async () => {
    const res = await request(app)
      .post('/api/financial/entries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type:'income', description:'Test', amount:-100, date:'2026-06-01' });
    expect(res.status).toBe(422);
  });

  test('barber cannot create entries', async () => {
    const res = await request(app)
      .post('/api/financial/entries')
      .set('Authorization', `Bearer ${barberToken}`)
      .send({ type:'income', description:'Test', amount:100, date:'2026-06-01' });
    expect(res.status).toBe(403);
  });

  test('owner lists entries', async () => {
    const res = await request(app).get('/api/financial/entries').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('filters by type', async () => {
    const res = await request(app).get('/api/financial/entries?type=income').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    res.body.forEach(e => expect(e.type).toBe('income'));
  });

  test('owner updates entry', async () => {
    const res = await request(app)
      .patch(`/api/financial/entries/${entryId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount: 600 });
    expect(res.status).toBe(200);
  });

  test('owner deletes entry', async () => {
    const id  = (await request(app).post('/api/financial/entries').set('Authorization', `Bearer ${ownerToken}`).send({ type:'expense', description:'Delete test', amount:10, date:'2026-06-10' })).body.id;
    const res = await request(app).delete(`/api/financial/entries/${id}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });
});

describe('Financial dashboard', () => {
  test('returns KPIs for current month', async () => {
    const res = await request(app).get('/api/financial/dashboard').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('income');
    expect(res.body).toHaveProperty('expense');
    expect(res.body).toHaveProperty('profit');
    expect(res.body).toHaveProperty('by_category');
    expect(res.body).toHaveProperty('daily');
  });

  test('barber cannot access financial dashboard', async () => {
    const res = await request(app).get('/api/financial/dashboard').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(403);
  });
});

describe('DRE', () => {
  test('returns 12-month breakdown', async () => {
    const res = await request(app).get('/api/financial/dre?year=2026').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(12);
    expect(res.body.totals).toHaveProperty('income');
  });
});

describe('Commissions', () => {
  test('owner sees all barbers commissions', async () => {
    const res = await request(app).get('/api/financial/commissions').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('barber sees only own commission', async () => {
    const res = await request(app).get('/api/financial/commissions').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(1);
  });
});
