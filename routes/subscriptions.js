'use strict';
const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

// Planos
router.get('/plans', requireAuth, (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  res.json(db.prepare('SELECT * FROM subscription_plans WHERE barbershop_id=? ORDER BY price').all(bsId));
});

router.post('/plans', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { name, price, benefits, discount_pct, loyalty_mult } = req.body;
  const r = db.prepare('INSERT INTO subscription_plans (barbershop_id,name,price,benefits,discount_pct,loyalty_mult) VALUES (?,?,?,?,?,?)')
    .run(bsId, name, price||0, JSON.stringify(benefits||[]), discount_pct||0, loyalty_mult||1);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/plans/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { name, price, benefits, discount_pct, loyalty_mult, active } = req.body;
  db.prepare('UPDATE subscription_plans SET name=?,price=?,benefits=?,discount_pct=?,loyalty_mult=?,active=? WHERE id=? AND barbershop_id=?')
    .run(name, price, JSON.stringify(benefits||[]), discount_pct||0, loyalty_mult||1, active===false?0:1, req.params.id, bsId);
  res.json({ message: 'Plano atualizado.' });
});

router.delete('/plans/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  db.prepare('DELETE FROM subscription_plans WHERE id=? AND barbershop_id=?').run(req.params.id, bsId);
  res.json({ message: 'Plano excluído.' });
});

// Assinaturas
router.get('/', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { status } = req.query;
  let sql = `SELECT s.*, u.name client_name, u.phone client_phone, u.email client_email,
    p.name plan_name, p.price plan_price,
    CAST(julianday(s.next_billing) - julianday('now') AS INTEGER) days_to_billing
    FROM subscriptions s
    JOIN clients c ON s.client_id = c.id JOIN users u ON c.user_id = u.id
    JOIN subscription_plans p ON s.plan_id = p.id
    WHERE s.barbershop_id=?`;
  const params = [bsId];
  if (status) { sql += ' AND s.status=?'; params.push(status); }
  sql += ' ORDER BY s.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/stats', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const active = db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE barbershop_id=? AND status=?').get(bsId,'active').n;
  const mrr = db.prepare(`SELECT SUM(p.price) mrr FROM subscriptions s JOIN subscription_plans p ON s.plan_id=p.id WHERE s.barbershop_id=? AND s.status='active'`).get(bsId).mrr || 0;
  const byPlan = db.prepare(`SELECT p.name, COUNT(*) cnt FROM subscriptions s JOIN subscription_plans p ON s.plan_id=p.id WHERE s.barbershop_id=? AND s.status='active' GROUP BY p.name`).all(bsId);
  const churn = db.prepare(`SELECT COUNT(*) n FROM subscriptions WHERE barbershop_id=? AND status='canceled' AND canceled_at >= date('now','-30 days')`).get(bsId).n;
  res.json({ active, mrr, byPlan, churn });
});

router.post('/', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { client_id, plan_id, start_date } = req.body;
  if (!client_id || !plan_id) return res.status(400).json({ error: 'client_id e plan_id são obrigatórios.' });
  const start = start_date || new Date().toISOString().split('T')[0];
  const nextBilling = new Date(start); nextBilling.setMonth(nextBilling.getMonth()+1);
  const r = db.prepare('INSERT INTO subscriptions (barbershop_id,client_id,plan_id,start_date,next_billing) VALUES (?,?,?,?,?)')
    .run(bsId, client_id, plan_id, start, nextBilling.toISOString().split('T')[0]);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.patch('/:id/cancel', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  db.prepare("UPDATE subscriptions SET status='canceled', canceled_at=datetime('now') WHERE id=? AND barbershop_id=?").run(req.params.id, bsId);
  res.json({ message: 'Assinatura cancelada.' });
});

module.exports = router;
