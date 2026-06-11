// routes/financial.js — Multi-tenant
'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');
const { getDb }       = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');

/* ── CATEGORIES ─────────────────────────────────────────────── */
router.get('/categories', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  let sql    = 'SELECT * FROM financial_categories WHERE 1=1';
  const params = [];
  if (bsId)            { sql += ' AND barbershop_id=?'; params.push(bsId); }
  if (req.query.type)  { sql += ' AND type=?';          params.push(req.query.type); }
  res.json(db.prepare(sql).all(...params));
});

router.post('/categories',
  requireAuth, requireRole('owner'),
  body('name').notEmpty(), body('type').isIn(['income','expense']),
  validate,
  (req, res) => {
    const db   = getDb();
    const bsId = getBsId(req) ?? null;
    const r = db.prepare('INSERT INTO financial_categories (barbershop_id, name, type, color) VALUES (?,?,?,?)').run(bsId, req.body.name, req.body.type, req.body.color || '#6366f1');
    res.status(201).json({ id: r.lastInsertRowid });
  }
);

/* ── ENTRIES ────────────────────────────────────────────────── */
router.get('/entries', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const { type, from, to, category_id, payment_method } = req.query;
  let sql = `SELECT e.*, fc.name AS category_name, fc.color AS category_color
    FROM financial_entries e
    LEFT JOIN financial_categories fc ON fc.id = e.category_id
    WHERE 1=1`;
  const params = [];
  if (bsId)           { sql += ' AND e.barbershop_id=?';    params.push(bsId); }
  if (type)           { sql += ' AND e.type=?';             params.push(type); }
  if (from)           { sql += ' AND e.date>=?';            params.push(from); }
  if (to)             { sql += ' AND e.date<=?';            params.push(to); }
  if (category_id)    { sql += ' AND e.category_id=?';      params.push(category_id); }
  if (payment_method) { sql += ' AND e.payment_method=?';   params.push(payment_method); }
  sql += ' ORDER BY e.date DESC, e.id DESC';
  if (req.query.limit) sql += ` LIMIT ${parseInt(req.query.limit)}`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/entries/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const row  = db.prepare(`SELECT e.*, fc.name AS category_name FROM financial_entries e LEFT JOIN financial_categories fc ON fc.id=e.category_id WHERE e.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  if (bsId && row.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  res.json(row);
});

router.post('/entries',
  requireAuth, requireRole('owner'),
  body('type').isIn(['income','expense']), body('description').notEmpty(),
  body('amount').isFloat({ min:0.01 }), body('date').isDate(),
  validate,
  (req, res) => {
    const db   = getDb();
    const bsId = getBsId(req) ?? null;
    const { type, category_id, description, amount, date, payment_method, notes, recurrent } = req.body;
    const r = db.prepare(`INSERT INTO financial_entries (barbershop_id, type, category_id, description, amount, date, payment_method, notes, recurrent)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(bsId, type, category_id ?? null, description, amount, date, payment_method ?? 'cash', notes ?? null, recurrent ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid, message: 'Lançamento criado.' });
  }
);

router.patch('/entries/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const row  = db.prepare('SELECT id, barbershop_id FROM financial_entries WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  if (bsId && row.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  const allowed = ['type','category_id','description','amount','date','payment_method','notes'];
  const ups=[]; const vs=[];
  allowed.forEach(k => { if (req.body[k] !== undefined) { ups.push(`${k}=?`); vs.push(req.body[k]); } });
  if (!ups.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  ups.push("updated_at=datetime('now')"); vs.push(req.params.id);
  db.prepare(`UPDATE financial_entries SET ${ups.join(',')} WHERE id=?`).run(...vs);
  res.json({ message: 'Lançamento atualizado.' });
});

router.delete('/entries/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const row  = db.prepare('SELECT id, barbershop_id FROM financial_entries WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  if (bsId && row.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  db.prepare('DELETE FROM financial_entries WHERE id=?').run(req.params.id);
  res.json({ message: 'Lançamento excluído.' });
});

/* ── DASHBOARD KPIs ──────────────────────────────────────────── */
router.get('/dashboard', requireAuth, requireRole('owner'), (req, res) => {
  const db    = getDb();
  const bsId  = getBsId(req);
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const bsFilter = bsId ? ' AND barbershop_id=?' : '';
  const bsP      = bsId ? [bsId] : [];

  const income  = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM financial_entries WHERE type='income'  AND strftime('%Y-%m',date)=?${bsFilter}`).get(month, ...bsP).total;
  const expense = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM financial_entries WHERE type='expense' AND strftime('%Y-%m',date)=?${bsFilter}`).get(month, ...bsP).total;

  const [y, m] = month.split('-').map(Number);
  const prev   = m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
  const prevIncome  = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM financial_entries WHERE type='income'  AND strftime('%Y-%m',date)=?${bsFilter}`).get(prev, ...bsP).total;
  const prevExpense = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM financial_entries WHERE type='expense' AND strftime('%Y-%m',date)=?${bsFilter}`).get(prev, ...bsP).total;

  const byCat = bsId
    ? db.prepare(`SELECT fc.name, fc.color, fc.type, COALESCE(SUM(e.amount),0) AS total FROM financial_categories fc LEFT JOIN financial_entries e ON e.category_id=fc.id AND strftime('%Y-%m',e.date)=? WHERE fc.barbershop_id=? GROUP BY fc.id ORDER BY total DESC`).all(month, bsId)
    : db.prepare(`SELECT fc.name, fc.color, fc.type, COALESCE(SUM(e.amount),0) AS total FROM financial_categories fc LEFT JOIN financial_entries e ON e.category_id=fc.id AND strftime('%Y-%m',e.date)=? GROUP BY fc.id ORDER BY total DESC`).all(month);

  const daily = db.prepare(`
    SELECT date,
      COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
    FROM financial_entries
    WHERE date >= date('now','-30 days')${bsFilter}
    GROUP BY date ORDER BY date ASC
  `).all(...bsP);

  const appts = db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE strftime('%Y-%m',date)=? AND status='completed'${bsId?' AND barbershop_id=?':''}`).get(month, ...(bsId ? [bsId] : [])).n;

  res.json({
    month, income, expense, profit: income - expense,
    margin: income > 0 ? ((income - expense) / income * 100) : 0,
    prev_income: prevIncome, prev_expense: prevExpense, prev_profit: prevIncome - prevExpense,
    income_growth: prevIncome > 0 ? ((income - prevIncome) / prevIncome * 100) : 0,
    appts,
    ticket_medio: appts > 0 ? income / appts : 0,
    by_category: byCat, daily,
  });
});

/* ── DRE ─────────────────────────────────────────────────────── */
router.get('/dre', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const year = req.query.year || new Date().getFullYear();
  const bsFilter = bsId ? ' AND barbershop_id=?' : '';
  const bsP      = bsId ? [bsId] : [];

  const rows = db.prepare(`
    SELECT strftime('%m',date) AS month,
      COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
    FROM financial_entries
    WHERE strftime('%Y',date)=?${bsFilter}
    GROUP BY month ORDER BY month ASC
  `).all(String(year), ...bsP);

  const months = Array.from({ length: 12 }, (_, i) => {
    const mo    = String(i + 1).padStart(2, '0');
    const found = rows.find(r => r.month === mo);
    return found ? { ...found, profit: found.income - found.expense } : { month: mo, income: 0, expense: 0, profit: 0 };
  });
  const totals = months.reduce((acc, r) => ({ income: acc.income+r.income, expense: acc.expense+r.expense, profit: acc.profit+r.profit }), { income:0, expense:0, profit:0 });
  res.json({ year, months, totals });
});

/* ── COMMISSIONS ─────────────────────────────────────────────── */
router.get('/commissions', requireAuth, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const { from, to, barber_id } = req.query;

  let bId = barber_id;
  if (req.user.role === 'barber') {
    const b = db.prepare('SELECT id FROM barbers WHERE user_id=?').get(req.user.id);
    if (!b) return res.json([]);
    bId = b.id;
  }

  const f = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const t = to   || new Date().toISOString().split('T')[0];

  let sql = `
    SELECT b.id AS barber_id, u.name AS barber_name, b.commission_rate,
      COUNT(a.id) AS services_count,
      COALESCE(SUM(a.price),0) AS gross_amount,
      COALESCE(SUM(a.price * b.commission_rate/100),0) AS commission_amount,
      COALESCE(SUM(a.price * (1-b.commission_rate/100)),0) AS barbearia_amount
    FROM barbers b JOIN users u ON u.id=b.user_id
    LEFT JOIN appointments a ON a.barber_id=b.id AND a.date BETWEEN ? AND ? AND a.status='completed'
    WHERE b.status='active'
  `;
  const params = [f, t];
  if (bsId) { sql += ' AND u.barbershop_id=?'; params.push(bsId); }
  if (bId)  { sql += ' AND b.id=?';            params.push(bId); }
  sql += ' GROUP BY b.id ORDER BY gross_amount DESC';
  res.json(db.prepare(sql).all(...params));
});

router.patch('/commissions/:barber_id/pay', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from e to são obrigatórios.' });

  const barber = db.prepare(`
    SELECT b.id, u.name, b.commission_rate,
      COALESCE(SUM(a.price),0) AS gross,
      COALESCE(SUM(a.price * b.commission_rate/100),0) AS commission
    FROM barbers b JOIN users u ON u.id=b.user_id
    LEFT JOIN appointments a ON a.barber_id=b.id AND a.date BETWEEN ? AND ? AND a.status='completed'
    WHERE b.id=? GROUP BY b.id
  `).get(from, to, req.params.barber_id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });

  db.prepare(`INSERT INTO commissions (barber_id, period_start, period_end, gross_amount, commission_rate, commission_amount, services_count, paid, paid_at)
    SELECT ?, ?, ?, ?, commission_rate, ?, COUNT(a.id), 1, datetime('now')
    FROM barbers b LEFT JOIN appointments a ON a.barber_id=b.id AND a.date BETWEEN ? AND ? AND a.status='completed'
    WHERE b.id=?`).run(req.params.barber_id, from, to, barber.gross, barber.commission, from, to, req.params.barber_id);

  const fc = bsId
    ? db.prepare("SELECT id FROM financial_categories WHERE barbershop_id=? AND name='Salários' LIMIT 1").get(bsId)
    : db.prepare("SELECT id FROM financial_categories WHERE name='Salários' LIMIT 1").get();

  db.prepare(`INSERT INTO financial_entries (barbershop_id, type, category_id, description, amount, date, payment_method)
    VALUES (?, 'expense', ?, ?, ?, date('now'), 'transfer')`
  ).run(bsId ?? null, fc?.id ?? null, `Comissão ${barber.name} (${from} a ${to})`, barber.commission);

  res.json({ message: `Comissão de R$ ${barber.commission.toFixed(2)} paga para ${barber.name}.` });
});

module.exports = router;
