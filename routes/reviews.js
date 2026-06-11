'use strict';
const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

router.get('/', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { barber_id, rating, limit = 50, offset = 0 } = req.query;
  let sql = `SELECT r.*, uc.name client_name, ub.name barber_name, s.name service_name
    FROM reviews r
    LEFT JOIN clients  c  ON r.client_id  = c.id
    LEFT JOIN users    uc ON c.user_id    = uc.id
    LEFT JOIN barbers  b  ON r.barber_id  = b.id
    LEFT JOIN users    ub ON b.user_id    = ub.id
    LEFT JOIN services s  ON r.service_id = s.id
    WHERE r.barbershop_id=?`;
  const params = [bsId];
  if (barber_id) { sql += ' AND r.barber_id=?'; params.push(barber_id); }
  if (rating)    { sql += ' AND r.rating=?';    params.push(rating); }
  sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  res.json(db.prepare(sql).all(...params));
});

router.get('/stats', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const overall = db.prepare('SELECT AVG(rating) avg, COUNT(*) total FROM reviews WHERE barbershop_id=?').get(bsId);
  const byBarber = db.prepare(`
    SELECT u.name barber_name, b.id barber_id, AVG(r.rating) avg, COUNT(*) total
    FROM reviews r JOIN barbers b ON r.barber_id=b.id JOIN users u ON b.user_id=u.id
    WHERE r.barbershop_id=? GROUP BY r.barber_id ORDER BY avg DESC`).all(bsId);
  const dist = db.prepare('SELECT rating, COUNT(*) cnt FROM reviews WHERE barbershop_id=? GROUP BY rating ORDER BY rating DESC').all(bsId);
  res.json({ overall, byBarber, distribution: dist });
});

router.post('/', requireAuth, (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { appointment_id, client_id, barber_id, service_id, rating, comment } = req.body;
  if (!client_id || !barber_id || !rating) return res.status(400).json({ error: 'Campos obrigatórios: client_id, barber_id, rating.' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating deve ser entre 1 e 5.' });
  const r = db.prepare('INSERT INTO reviews (barbershop_id,appointment_id,client_id,barber_id,service_id,rating,comment) VALUES (?,?,?,?,?,?,?)')
    .run(bsId, appointment_id||null, client_id, barber_id, service_id||null, rating, comment||null);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.delete('/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  db.prepare('DELETE FROM reviews WHERE id=? AND barbershop_id=?').run(req.params.id, bsId);
  res.json({ message: 'Avaliação excluída.' });
});

module.exports = router;
