// routes/appointments.js — Multi-tenant
'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');
const { getDb }       = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');
const { triggerAutomation } = require('../services/whatsapp');

const apptCols = `
  a.id, a.date, a.time, a.end_time, a.status, a.price, a.notes,
  cu.name  AS client_name,  cu.phone AS client_phone,
  bu.name  AS barber_name,
  s.name   AS service_name, s.duration, s.category,
  a.client_id, a.barber_id, a.service_id, a.barbershop_id,
  a.created_at
`;

router.get('/', requireAuth, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const { date, barber_id, client_id, status, from, to } = req.query;

  let sql = `
    SELECT ${apptCols}
    FROM appointments a
    LEFT JOIN clients  cl ON cl.id = a.client_id
    LEFT JOIN users    cu ON cu.id = cl.user_id
    LEFT JOIN barbers  b  ON b.id  = a.barber_id
    LEFT JOIN users    bu ON bu.id = b.user_id
    LEFT JOIN services s  ON s.id  = a.service_id
    WHERE 1=1
  `;
  const params = [];

  if (bsId) { sql += ' AND a.barbershop_id=?'; params.push(bsId); }

  if (req.user.role === 'barber') {
    const barber = db.prepare('SELECT id FROM barbers WHERE user_id=?').get(req.user.id);
    if (!barber) return res.json([]);
    sql += ' AND a.barber_id=?'; params.push(barber.id);
  }
  if (req.user.role === 'client') {
    const client = db.prepare('SELECT id FROM clients WHERE user_id=?').get(req.user.id);
    if (!client) return res.json([]);
    sql += ' AND a.client_id=?'; params.push(client.id);
  }

  if (date)      { sql += ' AND a.date=?';     params.push(date); }
  if (barber_id && req.user.role !== 'client' && req.user.role !== 'barber')
                 { sql += ' AND a.barber_id=?'; params.push(barber_id); }
  if (client_id && req.user.role !== 'client')
                 { sql += ' AND a.client_id=?'; params.push(client_id); }
  if (status)    { sql += ' AND a.status=?';   params.push(status); }
  if (from)      { sql += ' AND a.date>=?';    params.push(from); }
  if (to)        { sql += ' AND a.date<=?';    params.push(to); }
  sql += ' ORDER BY a.date ASC, a.time ASC';
  res.json(db.prepare(sql).all(...params));
});

/* GET /api/appointments/slots/available — MUST be before /:id */
router.get('/slots/available', requireAuth, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const { barber_id, service_id, date } = req.query;
  if (!barber_id || !service_id || !date)
    return res.status(400).json({ error: 'barber_id, service_id e date são obrigatórios.' });

  const service = db.prepare('SELECT duration FROM services WHERE id=?').get(service_id);
  if (!service) return res.status(404).json({ error: 'Serviço não encontrado.' });

  // Use barbershop-scoped settings
  let settingsRows;
  if (bsId) {
    settingsRows = db.prepare('SELECT key, value FROM settings WHERE barbershop_id=? AND key IN (?,?,?)').all(bsId,'horario_abertura','horario_fechamento','intervalo_agenda');
  } else {
    settingsRows = db.prepare('SELECT key, value FROM settings WHERE key IN (?,?,?) LIMIT 3').all('horario_abertura','horario_fechamento','intervalo_agenda');
  }
  const cfg   = Object.fromEntries(settingsRows.map(s => [s.key, s.value]));
  const open  = cfg.horario_abertura   || '09:00';
  const close = cfg.horario_fechamento || '20:00';
  const slot  = parseInt(cfg.intervalo_agenda || '30');

  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const openMin  = oh * 60 + om;
  const closeMin = ch * 60 + cm;

  const booked = db.prepare(`
    SELECT time, end_time FROM appointments
    WHERE barber_id=? AND date=? AND status NOT IN ('cancelled','no_show')
  `).all(barber_id, date);

  const slots = [];
  for (let t = openMin; t + service.duration <= closeMin; t += slot) {
    const tStr   = `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
    const endStr = `${String(Math.floor((t+service.duration)/60)).padStart(2,'0')}:${String((t+service.duration)%60).padStart(2,'0')}`;
    const busy   = booked.some(b => !(endStr <= b.time || tStr >= b.end_time));
    slots.push({ time: tStr, end_time: endStr, available: !busy });
  }
  res.json(slots);
});

router.get('/:id', requireAuth, param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const appt = db.prepare(`SELECT ${apptCols}
    FROM appointments a
    LEFT JOIN clients  cl ON cl.id = a.client_id
    LEFT JOIN users    cu ON cu.id = cl.user_id
    LEFT JOIN barbers  b  ON b.id  = a.barber_id
    LEFT JOIN users    bu ON bu.id = b.user_id
    LEFT JOIN services s  ON s.id  = a.service_id
    WHERE a.id=?`).get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (bsId && appt.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  if (req.user.role === 'barber') {
    const barber = db.prepare('SELECT id FROM barbers WHERE user_id=?').get(req.user.id);
    if (!barber || appt.barber_id !== barber.id) return res.status(403).json({ error: 'Acesso negado.' });
  }
  if (req.user.role === 'client') {
    const client = db.prepare('SELECT id FROM clients WHERE user_id=?').get(req.user.id);
    if (!client || appt.client_id !== client.id) return res.status(403).json({ error: 'Acesso negado.' });
  }
  res.json(appt);
});

router.post('/',
  requireAuth,
  body('client_id').isInt(), body('barber_id').isInt(), body('service_id').isInt(),
  body('date').isDate(), body('time').matches(/^\d{2}:\d{2}$/),
  validate,
  (req, res) => {
    const db   = getDb();
    const bsId = getBsId(req) ?? null;
    const { client_id, barber_id, service_id, date, time, notes } = req.body;

    const service = db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(service_id);
    if (!service) return res.status(400).json({ error: 'Serviço não encontrado ou inativo.' });
    const barber  = db.prepare("SELECT * FROM barbers WHERE id=? AND status='active'").get(barber_id);
    if (!barber)  return res.status(400).json({ error: 'Barbeiro não encontrado ou inativo.' });

    const [h, m] = time.split(':').map(Number);
    const endMin  = h * 60 + m + service.duration;
    const end_time = `${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`;

    const conflict = db.prepare(`
      SELECT id FROM appointments
      WHERE barber_id=? AND date=? AND status NOT IN ('cancelled','no_show')
        AND NOT (end_time<=? OR time>=?)
    `).get(barber_id, date, time, end_time);
    if (conflict) return res.status(409).json({ error: 'Horário já ocupado para este barbeiro.' });

    const result = db.prepare(`
      INSERT INTO appointments (barbershop_id, client_id, barber_id, service_id, date, time, end_time, status, price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(bsId, client_id, barber_id, service_id, date, time, end_time, req.body.price ?? service.price, notes ?? null);

    const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(client_id);
    if (cl) {
      const pts = Math.floor(service.price * 0.1);
      if (pts > 0) {
        db.prepare("UPDATE clients SET points=points+?, updated_at=datetime('now') WHERE id=?").run(pts, client_id);
        db.prepare("INSERT INTO loyalty_transactions (client_id, points, action, appointment_id) VALUES (?,?,?,?)").run(client_id, pts, 'Agendamento', result.lastInsertRowid);
      }
    }
    const newId = result.lastInsertRowid;
    // Automação: lembrete 24h antes
    triggerAutomation(db, bsId, 'reminder_24h', {
      client_id:    client_id,
      barber_name:  db.prepare('SELECT name FROM users WHERE id=(SELECT user_id FROM barbers WHERE id=?)').get(barber_id)?.name || '',
      service_name: service.name,
      date, time,
    });
    res.status(201).json({ id: newId, message: 'Agendamento criado com sucesso.' });
  }
);

router.patch('/:id', requireAuth, param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (bsId && appt.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });

  if (req.user.role === 'client') {
    const client = db.prepare('SELECT id FROM clients WHERE user_id=?').get(req.user.id);
    if (!client || appt.client_id !== client.id) return res.status(403).json({ error: 'Acesso negado.' });
    if (req.body.status && req.body.status !== 'cancelled') return res.status(403).json({ error: 'Clientes só podem cancelar.' });
  }

  const allowed = ['status','date','time','barber_id','service_id','notes','price'];
  const updates=[]; const vals=[];
  allowed.forEach(k => { if (req.body[k] !== undefined) { updates.push(`${k}=?`); vals.push(req.body[k]); } });
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  updates.push("updated_at=datetime('now')"); vals.push(req.params.id);
  db.prepare(`UPDATE appointments SET ${updates.join(',')} WHERE id=?`).run(...vals);

  // financial entry + WA automation on completion (once only)
  if (req.body.status === 'completed' && appt.status !== 'completed') {
    const fc = db.prepare("SELECT id FROM financial_categories WHERE barbershop_id=? AND name='Serviços' LIMIT 1").get(appt.barbershop_id);
    db.prepare(`INSERT INTO financial_entries (barbershop_id, type, category_id, description, amount, date, payment_method)
      VALUES (?, 'income', ?, ?, ?, ?, 'cash')`
    ).run(appt.barbershop_id, fc?.id ?? null, `Serviço - Agend. #${appt.id}`, appt.price, appt.date);
    // Automação: mensagem pós-atendimento
    const barberUser = db.prepare('SELECT name FROM users WHERE id=(SELECT user_id FROM barbers WHERE id=?)').get(appt.barber_id);
    const svc        = db.prepare('SELECT name FROM services WHERE id=?').get(appt.service_id);
    triggerAutomation(db, appt.barbershop_id, 'after_appointment', {
      client_id:    appt.client_id,
      barber_name:  barberUser?.name || '',
      service_name: svc?.name || '',
      date:         appt.date,
      time:         appt.time,
    });
  }
  res.json({ message: 'Agendamento atualizado.' });
});

router.delete('/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const appt = db.prepare('SELECT id, barbershop_id FROM appointments WHERE id=?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (bsId && appt.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  db.prepare('DELETE FROM appointments WHERE id=?').run(req.params.id);
  res.json({ message: 'Agendamento excluído.' });
});

module.exports = router;
