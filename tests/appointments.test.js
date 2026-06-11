// tests/appointments.test.js
'use strict';

process.env.DB_PATH = ':memory:';

const request   = require('supertest');
const app       = require('../server');
const { getDb } = require('../db');
const bcrypt    = require('bcryptjs');

let ownerToken, barberToken, clientToken;
let barberId, clientId, serviceId;

beforeAll(() => {
  const db   = getDb();
  const hash = (p) => bcrypt.hashSync(p, 10);

  const uO = db.prepare("INSERT INTO users (name,email,password,role) VALUES ('O','o2@t.com',?,'owner')").run(hash('pw'));
  const uB = db.prepare("INSERT INTO users (name,email,password,role) VALUES ('B','b2@t.com',?,'barber')").run(hash('pw'));
  const uC = db.prepare("INSERT INTO users (name,email,password,role) VALUES ('C','c2@t.com',?,'client')").run(hash('pw'));

  const bRow = db.prepare("INSERT INTO barbers (user_id,commission_rate) VALUES (?,40)").run(uB.lastInsertRowid);
  const cRow = db.prepare("INSERT INTO clients (user_id) VALUES (?)").run(uC.lastInsertRowid);
  const sRow = db.prepare("INSERT INTO services (name,category,duration,price) VALUES ('Corte','Corte',45,55)").run();

  barberId  = bRow.lastInsertRowid;
  clientId  = cRow.lastInsertRowid;
  serviceId = sRow.lastInsertRowid;
});

beforeEach(async () => {
  const login = async (email) => (await request(app).post('/api/auth/login').send({ email, password:'pw' })).body.token;
  ownerToken  = await login('o2@t.com');
  barberToken = await login('b2@t.com');
  clientToken = await login('c2@t.com');
});

describe('POST /api/appointments', () => {
  test('owner creates appointment', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ client_id: clientId, barber_id: barberId, service_id: serviceId, date:'2030-01-10', time:'10:00' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  test('rejects double-booking (conflict)', async () => {
    await request(app).post('/api/appointments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ client_id: clientId, barber_id: barberId, service_id: serviceId, date:'2030-01-15', time:'09:00' });

    const res = await request(app).post('/api/appointments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ client_id: clientId, barber_id: barberId, service_id: serviceId, date:'2030-01-15', time:'09:20' });
    expect(res.status).toBe(409);
  });

  test('rejects inactive service', async () => {
    const db  = getDb();
    const sId = db.prepare("INSERT INTO services (name,duration,price,active) VALUES ('Inativo',30,30,0)").run().lastInsertRowid;
    const res = await request(app).post('/api/appointments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ client_id: clientId, barber_id: barberId, service_id: sId, date:'2030-02-01', time:'10:00' });
    expect(res.status).toBe(400);
  });

  test('rejects missing required fields', async () => {
    const res = await request(app).post('/api/appointments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ date:'2030-01-20' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/appointments', () => {
  test('owner sees all appointments', async () => {
    const res = await request(app).get('/api/appointments').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('barber sees only own appointments', async () => {
    const res = await request(app).get('/api/appointments').set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(200);
    res.body.forEach(a => expect(a.barber_id).toBe(barberId));
  });

  test('filters by date', async () => {
    const res = await request(app).get('/api/appointments?date=2030-01-10').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    res.body.forEach(a => expect(a.date).toBe('2030-01-10'));
  });

  test('requires auth', async () => {
    expect((await request(app).get('/api/appointments')).status).toBe(401);
  });
});

describe('PATCH /api/appointments/:id', () => {
  let apptId;
  beforeAll(async () => {
    const db = getDb();
    apptId = db.prepare("INSERT INTO appointments (client_id,barber_id,service_id,date,time,end_time,status,price) VALUES (?,?,?,'2030-03-01','11:00','11:45','pending',55)").run(clientId, barberId, serviceId).lastInsertRowid;
  });

  test('owner can confirm appointment', async () => {
    const res = await request(app).patch(`/api/appointments/${apptId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status:'confirmed' });
    expect(res.status).toBe(200);
  });

  test('client can only cancel own appointment', async () => {
    const res = await request(app).patch(`/api/appointments/${apptId}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status:'cancelled' });
    expect(res.status).toBe(200);
  });

  test('returns 404 for nonexistent', async () => {
    const res = await request(app).patch('/api/appointments/99999')
      .set('Authorization', `Bearer ${ownerToken}`).send({ status:'confirmed' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/appointments/:id', () => {
  test('owner can delete appointment', async () => {
    const db   = getDb();
    const id   = db.prepare("INSERT INTO appointments (client_id,barber_id,service_id,date,time,end_time,status,price) VALUES (?,?,?,'2030-04-01','14:00','14:45','pending',55)").run(clientId, barberId, serviceId).lastInsertRowid;
    const res  = await request(app).delete(`/api/appointments/${id}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });

  test('barber cannot delete', async () => {
    const db   = getDb();
    const id   = db.prepare("INSERT INTO appointments (client_id,barber_id,service_id,date,time,end_time,status,price) VALUES (?,?,?,'2030-04-02','14:00','14:45','pending',55)").run(clientId, barberId, serviceId).lastInsertRowid;
    const res  = await request(app).delete(`/api/appointments/${id}`).set('Authorization', `Bearer ${barberToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/appointments/slots/available', () => {
  test('returns available time slots', async () => {
    const res = await request(app)
      .get(`/api/appointments/slots/available?barber_id=${barberId}&service_id=${serviceId}&date=2030-05-01`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('time');
    expect(res.body[0]).toHaveProperty('available');
  });
});
