// routes/scheduleBlocks.js — Bloqueios de agenda
'use strict';

const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

// Lista bloqueios do dia (+ recorrentes)
router.get('/', requireAuth, (req, res) => {
  const db    = getDb();
  const bsId  = getBsId(req);
  const date  = req.query.date || new Date().toISOString().split('T')[0];
  const dow   = ['sun','mon','tue','wed','thu','fri','sat'][new Date(date + 'T12:00:00').getDay()];

  const bsF  = bsId ? ' AND (sb.barbershop_id=? OR sb.barbershop_id IS NULL)' : '';
  const bsPa = bsId ? [bsId] : [];

  // Bloqueios que cobrem esta data (diretos ou recorrentes semanais/diários)
  const rows = db.prepare(`
    SELECT sb.*, u.name AS barber_name
    FROM schedule_blocks sb
    LEFT JOIN barbers b  ON b.id=sb.barber_id
    LEFT JOIN users   u  ON u.id=b.user_id
    WHERE (
      (sb.repeat_type='none'    AND sb.start_date<=? AND sb.end_date>=?)
   OR (sb.repeat_type='daily')
   OR (sb.repeat_type='weekly' AND strftime('%w',sb.start_date)=strftime('%w',?))
    )${bsF}
    ORDER BY sb.start_time ASC
  `).all(date, date, date, ...bsPa);

  res.json(rows);
});

// Criar bloqueio
router.post('/', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req) ?? null;
  const { barber_id, title, start_date, end_date, start_time, end_time, repeat_type='none', color='#6366f1' } = req.body;
  if (!title || !start_date || !end_date) return res.status(400).json({ error: 'Campos obrigatórios: title, start_date, end_date' });
  const r = db.prepare(`INSERT INTO schedule_blocks (barbershop_id,barber_id,title,start_date,end_date,start_time,end_time,repeat_type,color)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(bsId, barber_id||null, title, start_date, end_date, start_time||null, end_time||null, repeat_type, color);
  res.status(201).json({ id: r.lastInsertRowid });
});

// Deletar bloqueio
router.delete('/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM schedule_blocks WHERE id=?').run(req.params.id);
  res.json({ message: 'Bloqueio removido.' });
});

module.exports = router;
