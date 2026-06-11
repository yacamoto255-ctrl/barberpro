// routes/clients.js — Multi-tenant
'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');
const { getDb }       = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');

const clientCols = `
  c.id, u.name, u.email, u.phone, u.avatar,
  c.birthdate, c.points, c.cashback, c.plan, c.notes,
  c.user_id, u.barbershop_id, c.created_at, c.updated_at,
  (SELECT COUNT(*) FROM appointments a WHERE a.client_id=c.id AND a.status IN ('completed','confirmed')) AS total_visits,
  (SELECT COALESCE(SUM(a.price),0) FROM appointments a WHERE a.client_id=c.id AND a.status='completed') AS total_spent,
  CAST((julianday('now') - julianday(
    (SELECT MAX(a.date) FROM appointments a WHERE a.client_id=c.id)
  )) AS INTEGER) AS days_since_last_visit,
  (SELECT MAX(a.date) FROM appointments a WHERE a.client_id=c.id) AS last_visit,
  (SELECT ub.name FROM appointments a JOIN barbers b ON b.id=a.barber_id JOIN users ub ON ub.id=b.user_id WHERE a.client_id=c.id ORDER BY a.date DESC LIMIT 1) AS last_barber,
  (SELECT s.name FROM appointments a JOIN services s ON s.id=a.service_id WHERE a.client_id=c.id ORDER BY a.date DESC LIMIT 1) AS last_service
`;

router.get('/', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  let sql = `SELECT ${clientCols} FROM clients c JOIN users u ON u.id=c.user_id WHERE 1=1`;
  const params = [];
  if (bsId)            { sql += ' AND u.barbershop_id=?'; params.push(bsId); }
  if (req.query.search) {
    sql += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
    params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
  }
  if (req.query.plan)     { sql += ' AND c.plan=?';  params.push(req.query.plan); }
  sql += ' ORDER BY u.name ASC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/me', requireAuth, requireRole('client'), (req, res) => {
  const db  = getDb();
  const row = db.prepare(`SELECT ${clientCols} FROM clients c JOIN users u ON u.id=c.user_id WHERE c.user_id=?`).get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Perfil não encontrado.' });
  const history = db.prepare(`
    SELECT a.id, a.date, a.time, a.status, a.price,
           s.name AS service_name, u2.name AS barber_name
    FROM appointments a
    LEFT JOIN services s ON s.id=a.service_id
    LEFT JOIN barbers b ON b.id=a.barber_id LEFT JOIN users u2 ON u2.id=b.user_id
    WHERE a.client_id=? ORDER BY a.date DESC, a.time DESC LIMIT 20
  `).all(row.id);
  res.json({ ...row, history });
});

router.get('/:id', requireAuth, param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const row  = db.prepare(`SELECT ${clientCols} FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
  if (bsId && row.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  if (req.user.role === 'client' && row.user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado.' });
  const history = db.prepare(`
    SELECT a.id, a.date, a.time, a.status, a.price,
           s.name AS service_name, u2.name AS barber_name
    FROM appointments a
    LEFT JOIN services s ON s.id=a.service_id
    LEFT JOIN barbers b ON b.id=a.barber_id LEFT JOIN users u2 ON u2.id=b.user_id
    WHERE a.client_id=? ORDER BY a.date DESC, a.time DESC LIMIT 20
  `).all(req.params.id);
  res.json({ ...row, history });
});

router.post('/', requireAuth, requireRole('owner'),
  body('name').notEmpty(), body('email').isEmail(), body('password').optional().isLength({ min:6 }),
  validate,
  (req, res) => {
    const db   = getDb();
    const bsId = getBsId(req) ?? null;
    if (db.prepare('SELECT id FROM users WHERE email=?').get(req.body.email))
      return res.status(409).json({ error: 'E-mail já cadastrado.' });
    const { name, email, phone, birthdate, plan, notes, password } = req.body;
    const hash = require('bcryptjs').hashSync(password || '123456', 10);
    const u  = db.prepare(`INSERT INTO users (barbershop_id, name, email, password, role, phone) VALUES (?, ?, ?, ?, 'client', ?)`).run(bsId, name, email, hash, phone ?? null);
    const cl = db.prepare(`INSERT INTO clients (user_id, birthdate, plan, notes) VALUES (?, ?, ?, ?)`).run(u.lastInsertRowid, birthdate ?? null, plan ?? 'Bronze', notes ?? null);
    res.status(201).json({ id: cl.lastInsertRowid, message: 'Cliente cadastrado.' });
  }
);

router.patch('/:id', requireAuth, param('id').isInt(), validate, (req, res) => {
  const db     = getDb();
  const bsId   = getBsId(req);
  const client = db.prepare('SELECT c.*, u.barbershop_id FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  if (bsId && client.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  if (req.user.role === 'client' && client.user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado.' });

  const { name, phone, birthdate, plan, notes } = req.body;
  if (name || phone) {
    const ups=[]; const vs=[];
    if (name)  { ups.push('name=?');  vs.push(name); }
    if (phone) { ups.push('phone=?'); vs.push(phone); }
    ups.push("updated_at=datetime('now')"); vs.push(client.user_id);
    db.prepare(`UPDATE users SET ${ups.join(',')} WHERE id=?`).run(...vs);
  }
  const cUps=[]; const cVs=[];
  if (birthdate!==undefined) { cUps.push('birthdate=?'); cVs.push(birthdate); }
  if (plan)    { cUps.push('plan=?');    cVs.push(plan); }
  if (notes!==undefined) { cUps.push('notes=?'); cVs.push(notes); }
  if (cUps.length) {
    cUps.push("updated_at=datetime('now')"); cVs.push(req.params.id);
    db.prepare(`UPDATE clients SET ${cUps.join(',')} WHERE id=?`).run(...cVs);
  }
  res.json({ message: 'Cliente atualizado.' });
});

router.delete('/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db     = getDb();
  const bsId   = getBsId(req);
  const client = db.prepare('SELECT c.id, c.user_id, u.barbershop_id FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  if (bsId && client.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  db.prepare('DELETE FROM loyalty_transactions WHERE client_id=?').run(client.id);
  db.prepare('DELETE FROM appointments WHERE client_id=?').run(client.id);
  db.prepare('DELETE FROM clients WHERE id=?').run(client.id);
  db.prepare('DELETE FROM users WHERE id=?').run(client.user_id);
  res.json({ message: 'Cliente excluído.' });
});

router.post('/:id/loyalty', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db  = getDb();
  const { points, action } = req.body;
  if (!points || !action) return res.status(400).json({ error: 'points e action obrigatórios.' });
  db.prepare("UPDATE clients SET points=points+?, updated_at=datetime('now') WHERE id=?").run(points, req.params.id);
  db.prepare("INSERT INTO loyalty_transactions (client_id, points, action) VALUES (?, ?, ?)").run(req.params.id, points, action);
  res.json({ message: `${points > 0 ? '+' : ''}${points} pontos aplicados.` });
});

module.exports = router;
