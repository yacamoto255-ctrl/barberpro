// routes/barbers.js — Multi-tenant
'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');
const { getDb }       = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');

const barberCols = `
  b.id, u.name, u.email, u.phone,
  b.specialty, b.commission_rate, b.hire_date, b.bio, b.status,
  b.user_id, u.barbershop_id,
  (SELECT COUNT(*) FROM appointments a WHERE a.barber_id=b.id AND a.status='completed') AS total_services,
  (SELECT COALESCE(SUM(a.price),0) FROM appointments a WHERE a.barber_id=b.id AND a.status='completed') AS total_revenue,
  (SELECT COUNT(*) FROM appointments a WHERE a.barber_id=b.id AND a.date=date('now') AND a.status NOT IN ('cancelled','no_show')) AS today_count
`;

router.get('/', requireAuth, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  let sql = `SELECT ${barberCols} FROM barbers b JOIN users u ON u.id=b.user_id WHERE 1=1`;
  const params = [];
  if (bsId)                        { sql += ' AND u.barbershop_id=?';  params.push(bsId); }
  if (req.user.role === 'barber')  { sql += ' AND b.user_id=?';        params.push(req.user.id); }
  if (req.query.status)            { sql += ' AND b.status=?';         params.push(req.query.status); }
  sql += ' ORDER BY u.name ASC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', requireAuth, param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const row  = db.prepare(`SELECT ${barberCols} FROM barbers b JOIN users u ON u.id=b.user_id WHERE b.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  if (bsId && row.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  if (req.user.role === 'barber' && row.user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado.' });
  const services = db.prepare(`SELECT s.* FROM services s JOIN barber_services bs ON bs.service_id=s.id WHERE bs.barber_id=?`).all(req.params.id);
  res.json({ ...row, services });
});

router.post('/', requireAuth, requireRole('owner'),
  body('name').notEmpty(), body('email').isEmail(), body('commission_rate').isFloat({ min:0, max:100 }),
  validate,
  (req, res) => {
    const db   = getDb();
    const bsId = getBsId(req) ?? null;
    if (db.prepare('SELECT id FROM users WHERE email=?').get(req.body.email))
      return res.status(409).json({ error: 'E-mail já cadastrado.' });
    const { name, email, phone, specialty, commission_rate, hire_date, bio, password } = req.body;
    const hash = require('bcryptjs').hashSync(password || '123456', 10);
    const u = db.prepare(`INSERT INTO users (barbershop_id, name, email, password, role, phone)
                          VALUES (?, ?, ?, ?, 'barber', ?)`).run(bsId, name, email, hash, phone ?? null);
    const b = db.prepare(`INSERT INTO barbers (user_id, specialty, commission_rate, hire_date, bio)
                          VALUES (?, ?, ?, ?, ?)`).run(u.lastInsertRowid, specialty ?? '', commission_rate ?? 40, hire_date ?? null, bio ?? null);
    res.status(201).json({ id: b.lastInsertRowid, message: 'Barbeiro cadastrado.' });
  }
);

router.patch('/:id', requireAuth, requireRole('owner','barber'), param('id').isInt(), validate, (req, res) => {
  const db     = getDb();
  const bsId   = getBsId(req);
  const barber = db.prepare('SELECT b.*, u.barbershop_id FROM barbers b JOIN users u ON u.id=b.user_id WHERE b.id=?').get(req.params.id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  if (bsId && barber.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  if (req.user.role === 'barber' && barber.user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado.' });
  if (req.user.role === 'barber' && (req.body.commission_rate !== undefined || req.body.status !== undefined))
    return res.status(403).json({ error: 'Barbeiros não podem alterar comissão ou status.' });

  const { name, phone, specialty, commission_rate, hire_date, bio, status, password } = req.body;
  if (name || phone || password) {
    const ups=[]; const vs=[];
    if (name)     { ups.push('name=?');     vs.push(name); }
    if (phone)    { ups.push('phone=?');    vs.push(phone); }
    if (password) {
      const hash = require('bcryptjs').hashSync(password, 10);
      ups.push('password=?'); vs.push(hash);
    }
    ups.push("updated_at=datetime('now')"); vs.push(barber.user_id);
    db.prepare(`UPDATE users SET ${ups.join(',')} WHERE id=?`).run(...vs);
  }
  const bUps=[]; const bVs=[];
  if (specialty!==undefined)       { bUps.push('specialty=?');       bVs.push(specialty); }
  if (commission_rate!==undefined) { bUps.push('commission_rate=?'); bVs.push(commission_rate); }
  if (hire_date!==undefined)       { bUps.push('hire_date=?');       bVs.push(hire_date); }
  if (bio!==undefined)             { bUps.push('bio=?');             bVs.push(bio); }
  if (status!==undefined)          { bUps.push('status=?');          bVs.push(status); }
  if (bUps.length) {
    bUps.push("updated_at=datetime('now')"); bVs.push(req.params.id);
    db.prepare(`UPDATE barbers SET ${bUps.join(',')} WHERE id=?`).run(...bVs);
  }
  res.json({ message: 'Barbeiro atualizado.' });
});

router.delete('/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db     = getDb();
  const bsId   = getBsId(req);
  const barber = db.prepare('SELECT b.*, u.barbershop_id FROM barbers b JOIN users u ON u.id=b.user_id WHERE b.id=?').get(req.params.id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  if (bsId && barber.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  const future = db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE barber_id=? AND date>=date('now') AND status NOT IN ('cancelled')`).get(req.params.id);
  if (future.n > 0) return res.status(409).json({ error: `Barbeiro tem ${future.n} agendamento(s) futuro(s).` });
  db.prepare('UPDATE appointments SET barber_id=NULL WHERE barber_id=?').run(req.params.id);
  db.prepare('DELETE FROM barber_services WHERE barber_id=?').run(req.params.id);
  db.prepare('DELETE FROM commissions WHERE barber_id=?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(barber.user_id);
  res.json({ message: 'Barbeiro excluído.' });
});

router.get('/:id/schedule', requireAuth, param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const rows = db.prepare(`
    SELECT a.id, a.time, a.end_time, a.status, a.price,
           cu.name AS client_name, s.name AS service_name
    FROM appointments a
    LEFT JOIN clients cl ON cl.id=a.client_id LEFT JOIN users cu ON cu.id=cl.user_id
    LEFT JOIN services s ON s.id=a.service_id
    WHERE a.barber_id=? AND a.date=? ORDER BY a.time ASC
  `).all(req.params.id, date);
  res.json(rows);
});

module.exports = router;
