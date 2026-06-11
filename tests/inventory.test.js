// tests/inventory.test.js
'use strict';

process.env.DB_PATH = ':memory:';

const request   = require('supertest');
const app       = require('../server');
const { getDb } = require('../db');
const bcrypt    = require('bcryptjs');

let ownerToken, barberToken;
let itemId;

beforeAll(async () => {
  const db   = getDb();
  const hash = (p) => bcrypt.hashSync(p, 10);
  db.prepare("INSERT INTO users (name,email,password,role) VALUES ('IOwner','inv_o@t.com',?,'owner')").run(hash('pw'));
  db.prepare("INSERT INTO users (name,email,password,role) VALUES ('IBarber','inv_b@t.com',?,'barber')").run(hash('pw'));
  const bId = db.prepare("SELECT id FROM users WHERE email='inv_b@t.com'").get().id;
  db.prepare("INSERT INTO barbers (user_id,commission_rate) VALUES (?,40)").run(bId);

  db.prepare("INSERT INTO financial_categories (name,type,color) VALUES ('Produtos/Estoque','expense','#eab308')").run();
});

beforeEach(async () => {
  const login = async (email) => (await request(app).post('/api/auth/login').send({ email, password:'pw' })).body.token;
  ownerToken  = await login('inv_o@t.com');
  barberToken = await login('inv_b@t.com');
});

describe('Inventory CRUD', () => {
  test('owner creates item', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name:'Pomada Matte', category:'Finalizadores', qty:20, min_qty:5, unit:'un', unit_cost:28.50, supplier:'ProBarber' });
    expect(res.status).toBe(201);
    itemId = res.body.id;
  });

  test('barber cannot create item', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${barberToken}`)
      .send({ name:'Test', qty:1, unit_cost:10 });
    expect(res.status).toBe(403);
  });

  test('owner lists inventory', async () => {
    const res = await request(app).get('/api/inventory').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('barber can list inventory (read)', async () => {
    const res = await request(app).get('/api/inventory').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(200);
  });

  test('filters low stock items', async () => {
    // Create item with qty below min
    await request(app).post('/api/inventory').set('Authorization', `Bearer ${ownerToken}`)
      .send({ name:'Low Stock Item', qty:2, min_qty:10, unit_cost:5 });
    const res = await request(app).get('/api/inventory?low_stock=true').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    res.body.forEach(i => expect(i.qty).toBeLessThanOrEqual(i.min_qty));
  });

  test('owner updates item', async () => {
    const res = await request(app).patch(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`).send({ unit_cost: 30 });
    expect(res.status).toBe(200);
  });
});

describe('Inventory movements', () => {
  test('owner adds stock (in)', async () => {
    const res = await request(app)
      .post(`/api/inventory/${itemId}/movement`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type:'in', qty:10, reason:'Reposição' });
    expect(res.status).toBe(200);
    expect(res.body.new_qty).toBe(30);
  });

  test('barber removes stock (out)', async () => {
    const res = await request(app)
      .post(`/api/inventory/${itemId}/movement`)
      .set('Authorization', `Bearer ${barberToken}`)
      .send({ type:'out', qty:5, reason:'Uso em serviço' });
    expect(res.status).toBe(200);
    expect(res.body.new_qty).toBe(25);
  });

  test('rejects out movement if insufficient stock', async () => {
    const res = await request(app)
      .post(`/api/inventory/${itemId}/movement`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type:'out', qty:9999 });
    expect(res.status).toBe(400);
  });

  test('gets item with movement history', async () => {
    const res = await request(app).get(`/api/inventory/${itemId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.movements).toBeDefined();
    expect(res.body.movements.length).toBeGreaterThan(0);
  });
});

describe('Inventory stats', () => {
  test('returns stats', async () => {
    const res = await request(app).get('/api/inventory/stats').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_items');
    expect(res.body).toHaveProperty('total_value');
    expect(res.body).toHaveProperty('low_stock_count');
  });
});
