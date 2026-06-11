// tests/auth.test.js
'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app     = require('../server');
const { getDb } = require('../db');
const bcrypt    = require('bcryptjs');

let ownerToken, barberToken, clientToken;

beforeAll(() => {
  const db = getDb();
  const hash = (p) => bcrypt.hashSync(p, 10);

  db.prepare("INSERT INTO users (name,email,password,role) VALUES ('Test Owner','owner@test.com',?,'owner')").run(hash('secret123'));
  db.prepare("INSERT INTO users (name,email,password,role) VALUES ('Test Barber','barber@test.com',?,'barber')").run(hash('secret123'));
  db.prepare("INSERT INTO users (name,email,password,role) VALUES ('Test Client','client@test.com',?,'client')").run(hash('secret123'));

  const bUserId = db.prepare("SELECT id FROM users WHERE email='barber@test.com'").get().id;
  db.prepare("INSERT INTO barbers (user_id, commission_rate) VALUES (?,40)").run(bUserId);
  const cUserId = db.prepare("SELECT id FROM users WHERE email='client@test.com'").get().id;
  db.prepare("INSERT INTO clients (user_id) VALUES (?)").run(cUserId);
});

describe('POST /api/auth/login', () => {
  test('valid owner credentials return token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email:'owner@test.com', password:'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('owner');
    ownerToken = res.body.token;
  });

  test('valid barber credentials return token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email:'barber@test.com', password:'secret123' });
    expect(res.status).toBe(200);
    barberToken = res.body.token;
  });

  test('valid client credentials return token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email:'client@test.com', password:'secret123' });
    expect(res.status).toBe(200);
    clientToken = res.body.token;
  });

  test('wrong password returns 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email:'owner@test.com', password:'wrong' });
    expect(res.status).toBe(401);
  });

  test('unknown email returns 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email:'nobody@test.com', password:'secret123' });
    expect(res.status).toBe(401);
  });

  test('invalid email format returns 422', async () => {
    const res = await request(app).post('/api/auth/login').send({ email:'notanemail', password:'secret123' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/auth/me', () => {
  test('returns user profile with valid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('owner@test.com');
    expect(res.body.password).toBeUndefined();
  });

  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns 401 with invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer badtoken');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  test('changes password with correct current password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ current_password:'secret123', new_password:'newpass456' });
    expect(res.status).toBe(200);
  });

  test('rejects wrong current password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${barberToken}`)
      .send({ current_password:'wrongpass', new_password:'newpass456' });
    expect(res.status).toBe(400);
  });

  test('rejects short new password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${barberToken}`)
      .send({ current_password:'secret123', new_password:'abc' });
    expect(res.status).toBe(422);
  });
});

module.exports = { getOwnerToken: () => ownerToken, getBarberToken: () => barberToken, getClientToken: () => clientToken };
