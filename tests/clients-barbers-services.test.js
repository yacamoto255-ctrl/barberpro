// tests/clients-barbers-services.test.js
'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const request   = require('supertest');
const app       = require('../server');
const { getDb } = require('../db');
const bcrypt    = require('bcryptjs');

let ownerToken, barberToken, clientToken;
let barberId, clientId;

beforeAll(() => {
  const db   = getDb();
  const hash = (p) => bcrypt.hashSync(p, 10);

  const uO = db.prepare("INSERT INTO users (name,email,password,role,phone) VALUES ('CBS Owner','cbso@t.com',?,'owner','1111')").run(hash('pw'));
  const uB = db.prepare("INSERT INTO users (name,email,password,role,phone) VALUES ('CBS Barber','cbsb@t.com',?,'barber','2222')").run(hash('pw'));
  const uC = db.prepare("INSERT INTO users (name,email,password,role,phone) VALUES ('CBS Client','cbsc@t.com',?,'client','3333')").run(hash('pw'));

  const bR = db.prepare("INSERT INTO barbers (user_id,specialty,commission_rate) VALUES (?,?,40)").run(uB.lastInsertRowid, 'Degradê');
  const cR = db.prepare("INSERT INTO clients (user_id,phone,plan,points,cashback) VALUES (?,?,?,?,?)").run(uC.lastInsertRowid, '3333', 'Prata', 500, 25);

  barberId = bR.lastInsertRowid;
  clientId = cR.lastInsertRowid;
});

beforeEach(async () => {
  const login = async (email) => (await request(app).post('/api/auth/login').send({ email, password:'pw' })).body.token;
  ownerToken  = await login('cbso@t.com');
  barberToken = await login('cbsb@t.com');
  clientToken = await login('cbsc@t.com');
});

/* ══ CLIENTS ══════════════════════════════════════════════════ */
describe('Clients — listing & filtering', () => {
  test('owner lists all clients', async () => {
    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('barber can list clients', async () => {
    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(200);
  });

  test('client cannot list clients', async () => {
    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });

  test('search by name', async () => {
    const res = await request(app).get('/api/clients?search=CBS').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.every(c => c.name.includes('CBS'))).toBe(true);
  });

  test('filter by plan', async () => {
    const res = await request(app).get('/api/clients?plan=Prata').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    res.body.forEach(c => expect(c.plan).toBe('Prata'));
  });
});

describe('Clients — GET /me', () => {
  test('client gets own profile', async () => {
    const res = await request(app).get('/api/clients/me').set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('Prata');
    expect(res.body.points).toBe(500);
  });

  test('non-client cannot use /me', async () => {
    const res = await request(app).get('/api/clients/me').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Clients — CRUD', () => {
  let newClientId;

  test('owner creates client', async () => {
    const res = await request(app).post('/api/clients').set('Authorization', `Bearer ${ownerToken}`)
      .send({ name:'New Test Client', email:'ntc@t.com', phone:'9999', plan:'Bronze' });
    expect(res.status).toBe(201);
    newClientId = res.body.id;
  });

  test('duplicate email returns 409', async () => {
    const res = await request(app).post('/api/clients').set('Authorization', `Bearer ${ownerToken}`)
      .send({ name:'Dup', email:'ntc@t.com', phone:'9999' });
    expect(res.status).toBe(409);
  });

  test('missing name returns 422', async () => {
    const res = await request(app).post('/api/clients').set('Authorization', `Bearer ${ownerToken}`)
      .send({ email:'x@t.com' });
    expect(res.status).toBe(422);
  });

  test('barber cannot create client', async () => {
    const res = await request(app).post('/api/clients').set('Authorization', `Bearer ${barberToken}`)
      .send({ name:'X', email:'x2@t.com' });
    expect(res.status).toBe(403);
  });

  test('owner updates client', async () => {
    const res = await request(app).patch(`/api/clients/${clientId}`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ plan:'Ouro', notes:'VIP' });
    expect(res.status).toBe(200);
  });

  test('client updates own profile', async () => {
    const res = await request(app).patch(`/api/clients/${clientId}`).set('Authorization', `Bearer ${clientToken}`)
      .send({ phone:'4444-5555' });
    expect(res.status).toBe(200);
  });

  test('client cannot update another client', async () => {
    const db   = getDb();
    const uOth = db.prepare("INSERT INTO users (name,email,password,role) VALUES ('Oth','oth@t.com',?,'client')").run(bcrypt.hashSync('pw',10));
    const cOth = db.prepare("INSERT INTO clients (user_id) VALUES (?)").run(uOth.lastInsertRowid);
    const res  = await request(app).patch(`/api/clients/${cOth.lastInsertRowid}`).set('Authorization', `Bearer ${clientToken}`)
      .send({ plan:'Ouro' });
    expect(res.status).toBe(403);
  });

  test('owner deletes client', async () => {
    const res = await request(app).delete(`/api/clients/${newClientId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });

  test('barber cannot delete client', async () => {
    const res = await request(app).delete(`/api/clients/${clientId}`).set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Clients — loyalty points', () => {
  test('owner can add loyalty points', async () => {
    const res = await request(app).post(`/api/clients/${clientId}/loyalty`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ points: 100, action: 'Promoção especial' });
    expect(res.status).toBe(200);
  });

  test('owner can deduct loyalty points', async () => {
    const res = await request(app).post(`/api/clients/${clientId}/loyalty`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ points: -50, action: 'Resgate' });
    expect(res.status).toBe(200);
  });

  test('barber cannot manage loyalty points', async () => {
    const res = await request(app).post(`/api/clients/${clientId}/loyalty`).set('Authorization', `Bearer ${barberToken}`)
      .send({ points: 10, action: 'Test' });
    expect(res.status).toBe(403);
  });
});

describe('Clients — detail view with history', () => {
  test('owner can view client detail', async () => {
    const res = await request(app).get(`/api/clients/${clientId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('history');
  });

  test('returns 404 for nonexistent client', async () => {
    const res = await request(app).get('/api/clients/99999').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });
});

/* ══ BARBERS ══════════════════════════════════════════════════ */
describe('Barbers — listing', () => {
  test('owner lists all barbers', async () => {
    const res = await request(app).get('/api/barbers').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('barber sees only own profile', async () => {
    const res = await request(app).get('/api/barbers').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('filters by status', async () => {
    const res = await request(app).get('/api/barbers?status=active').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    res.body.forEach(b => expect(b.status).toBe('active'));
  });
});

describe('Barbers — CRUD', () => {
  let newBarberId;

  test('owner creates barber', async () => {
    const res = await request(app).post('/api/barbers').set('Authorization', `Bearer ${ownerToken}`)
      .send({ name:'New Barber', email:'nb@t.com', phone:'5555', specialty:'Classic', commission_rate:40 });
    expect(res.status).toBe(201);
    newBarberId = res.body.id;
  });

  test('duplicate email returns 409', async () => {
    const res = await request(app).post('/api/barbers').set('Authorization', `Bearer ${ownerToken}`)
      .send({ name:'Dup', email:'nb@t.com', commission_rate:40 });
    expect(res.status).toBe(409);
  });

  test('invalid commission_rate returns 422', async () => {
    const res = await request(app).post('/api/barbers').set('Authorization', `Bearer ${ownerToken}`)
      .send({ name:'X', email:'x99@t.com', commission_rate:150 });
    expect(res.status).toBe(422);
  });

  test('barber cannot create barber', async () => {
    const res = await request(app).post('/api/barbers').set('Authorization', `Bearer ${barberToken}`)
      .send({ name:'X', email:'xx@t.com', commission_rate:40 });
    expect(res.status).toBe(403);
  });

  test('owner updates barber', async () => {
    const res = await request(app).patch(`/api/barbers/${newBarberId}`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ commission_rate:45 });
    expect(res.status).toBe(200);
  });

  test('barber cannot change commission_rate', async () => {
    const res = await request(app).patch(`/api/barbers/${barberId}`).set('Authorization', `Bearer ${barberToken}`)
      .send({ commission_rate:50 });
    expect(res.status).toBe(403);
  });

  test('barber can update own bio', async () => {
    const res = await request(app).patch(`/api/barbers/${barberId}`).set('Authorization', `Bearer ${barberToken}`)
      .send({ bio:'Expert em cortes.' });
    expect(res.status).toBe(200);
  });

  test('owner deactivates barber', async () => {
    const res = await request(app).patch(`/api/barbers/${newBarberId}`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ status:'inactive' });
    expect(res.status).toBe(200);
  });

  test('owner deletes barber with no future appointments', async () => {
    const res = await request(app).delete(`/api/barbers/${newBarberId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });
});

describe('Barbers — schedule', () => {
  test('returns schedule for a specific day', async () => {
    const res = await request(app)
      .get(`/api/barbers/${barberId}/schedule?date=2030-01-01`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/* ══ SERVICES ══════════════════════════════════════════════════ */
describe('Services — CRUD', () => {
  let svcId;

  test('owner creates service', async () => {
    const res = await request(app).post('/api/services').set('Authorization', `Bearer ${ownerToken}`)
      .send({ name:'Test Corte', category:'Corte', duration:45, price:55, description:'Test service' });
    expect(res.status).toBe(201);
    svcId = res.body.id;
  });

  test('all roles can list services', async () => {
    for (const tok of [ownerToken, barberToken, clientToken]) {
      const res = await request(app).get('/api/services').set('Authorization', `Bearer ${tok}`);
      expect(res.status).toBe(200);
    }
  });

  test('filter active services', async () => {
    const res = await request(app).get('/api/services?active=true').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    res.body.forEach(s => expect(s.active).toBe(1));
  });

  test('get service by id', async () => {
    const res = await request(app).get(`/api/services/${svcId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test Corte');
  });

  test('barber cannot create service', async () => {
    const res = await request(app).post('/api/services').set('Authorization', `Bearer ${barberToken}`)
      .send({ name:'X', duration:30, price:50 });
    expect(res.status).toBe(403);
  });

  test('owner updates service', async () => {
    const res = await request(app).patch(`/api/services/${svcId}`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ price:60, active:0 });
    expect(res.status).toBe(200);
  });

  test('returns 404 for nonexistent service', async () => {
    const res = await request(app).get('/api/services/99999').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  test('patch returns 400 if no fields provided', async () => {
    const res = await request(app).patch(`/api/services/${svcId}`).set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('owner deletes service', async () => {
    const res = await request(app).delete(`/api/services/${svcId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });

  test('barber cannot delete service', async () => {
    const sId = (await request(app).post('/api/services').set('Authorization', `Bearer ${ownerToken}`).send({ name:'Del', duration:30, price:30 })).body.id;
    const res = await request(app).delete(`/api/services/${sId}`).set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(403);
  });
});

/* ══ SETTINGS ══════════════════════════════════════════════════ */
describe('Settings', () => {
  test('owner gets settings', async () => {
    const res = await request(app).get('/api/settings').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  test('barber cannot get settings', async () => {
    const res = await request(app).get('/api/settings').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(403);
  });

  test('owner updates settings in bulk', async () => {
    const res = await request(app).put('/api/settings').set('Authorization', `Bearer ${ownerToken}`)
      .send({ barbearia_nome:'Test Shop', horario_abertura:'08:00' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  test('owner patches single setting', async () => {
    const res = await request(app).patch('/api/settings/barbearia_nome').set('Authorization', `Bearer ${ownerToken}`)
      .send({ value:'Updated Shop' });
    expect(res.status).toBe(200);
  });

  test('patch requires value field', async () => {
    const res = await request(app).patch('/api/settings/barbearia_nome').set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('owner lists all users', async () => {
    const res = await request(app).get('/api/settings/users/all').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('owner can deactivate user', async () => {
    const db = getDb();
    const u  = db.prepare("INSERT INTO users (name,email,password,role) VALUES ('ToDeact','deact@t.com','x','client')").run();
    const res = await request(app).patch(`/api/settings/users/${u.lastInsertRowid}/active`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ active: false });
    expect(res.status).toBe(200);
  });
});

/* ══ DASHBOARD ════════════════════════════════════════════════ */
describe('Dashboard', () => {
  test('owner gets dashboard', async () => {
    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('kpis');
    expect(res.body).toHaveProperty('today_appointments');
    expect(res.body).toHaveProperty('top_services');
    expect(res.body).toHaveProperty('top_barbers');
    expect(res.body).toHaveProperty('alerts');
  });

  test('barber cannot access owner dashboard', async () => {
    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(403);
  });

  test('barber gets barber dashboard', async () => {
    const res = await request(app).get('/api/dashboard/barber').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('kpis');
    expect(res.body).toHaveProperty('today_appointments');
  });

  test('owner cannot access barber dashboard', async () => {
    const res = await request(app).get('/api/dashboard/barber').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  test('all roles can get notifications', async () => {
    for (const tok of [ownerToken, barberToken, clientToken]) {
      const res = await request(app).get('/api/dashboard/notifications').set('Authorization', `Bearer ${tok}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    }
  });

  test('owner can clear notifications', async () => {
    const db = getDb();
    const uId = db.prepare("SELECT id FROM users WHERE email='cbso@t.com'").get().id;
    db.prepare("INSERT INTO notifications (user_id,title,body,type) VALUES (?,'Test','Test body','info')").run(uId);

    const res = await request(app).delete('/api/dashboard/notifications').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);

    const after = await request(app).get('/api/dashboard/notifications').set('Authorization', `Bearer ${ownerToken}`);
    expect(after.body).toHaveLength(0);
  });
});
