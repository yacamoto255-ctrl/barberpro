'use strict';
const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

function parsePeriod(period, from, to) {
  const now = new Date();
  if (period === 'today')   { const d = now.toISOString().split('T')[0]; return [d,d]; }
  if (period === 'week')    { const d=new Date(now); d.setDate(d.getDate()-7); return [d.toISOString().split('T')[0], now.toISOString().split('T')[0]]; }
  if (period === 'month')   { return [`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, now.toISOString().split('T')[0]]; }
  if (period === 'custom' && from && to) return [from, to];
  // default: current month
  return [`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, now.toISOString().split('T')[0]];
}

router.get('/revenue', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const [from, to] = parsePeriod(req.query.period, req.query.from, req.query.to);
  const { barber_id } = req.query;
  let apptSql = `SELECT a.date, a.price, uc.name client_name, s.name service_name, ub.name barber_name, a.status
    FROM appointments a
    LEFT JOIN services s ON a.service_id=s.id
    LEFT JOIN barbers b ON a.barber_id=b.id LEFT JOIN users ub ON b.user_id=ub.id
    LEFT JOIN clients c ON a.client_id=c.id LEFT JOIN users uc ON c.user_id=uc.id
    WHERE a.barbershop_id=? AND a.status='completed' AND a.date BETWEEN ? AND ?`;
  const params = [bsId, from, to];
  if (barber_id) { apptSql += ' AND a.barber_id=?'; params.push(barber_id); }
  apptSql += ' ORDER BY a.date DESC, a.time DESC';
  const rows = db.prepare(apptSql).all(...params);
  const total = rows.reduce((s,r)=>s+(r.price||0),0);
  const byDay = {};
  for (const r of rows) { byDay[r.date] = (byDay[r.date]||0) + (r.price||0); }
  res.json({ rows, total, byDay: Object.entries(byDay).map(([date,v])=>({date,value:v})).sort((a,b)=>a.date.localeCompare(b.date)), period:{from,to} });
});

router.get('/appointments', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const [from, to] = parsePeriod(req.query.period, req.query.from, req.query.to);
  const { barber_id } = req.query;
  let sql = `SELECT a.date, a.time, uc.name client_name, s.name service_name, ub.name barber_name, a.status, a.price
    FROM appointments a
    LEFT JOIN services s ON a.service_id=s.id
    LEFT JOIN barbers b ON a.barber_id=b.id LEFT JOIN users ub ON b.user_id=ub.id
    LEFT JOIN clients c ON a.client_id=c.id LEFT JOIN users uc ON c.user_id=uc.id
    WHERE a.barbershop_id=? AND a.date BETWEEN ? AND ?`;
  const params = [bsId, from, to];
  if (barber_id) { sql += ' AND a.barber_id=?'; params.push(barber_id); }
  sql += ' ORDER BY a.date DESC, a.time';
  const rows = db.prepare(sql).all(...params);
  const byStatus = rows.reduce((acc,r)=>{ acc[r.status]=(acc[r.status]||0)+1; return acc; },{});
  res.json({ rows, total: rows.length, byStatus, period:{from,to} });
});

router.get('/commissions', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const [from, to] = parsePeriod(req.query.period, req.query.from, req.query.to);
  const { barber_id } = req.query;
  let sql = `SELECT c.*, u.name barber_name FROM commissions c
    JOIN barbers b ON c.barber_id=b.id JOIN users u ON b.user_id=u.id
    WHERE u.barbershop_id=? AND c.period_start >= ? AND c.period_end <= ?`;
  const params = [bsId, from, to];
  if (barber_id) { sql += ' AND c.barber_id=?'; params.push(barber_id); }
  sql += ' ORDER BY u.name, c.period_start DESC';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((s,r)=>s+(r.commission_amount||0),0);
  res.json({ rows, total, period:{from,to} });
});

router.get('/clients', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const [from, to] = parsePeriod(req.query.period, req.query.from, req.query.to);
  const rows = db.prepare(`
    SELECT u.name, u.phone, u.email, u.created_at,
      COUNT(a.id) visits, COALESCE(SUM(a.price),0) total_spent,
      MAX(a.date) last_visit
    FROM clients c JOIN users u ON c.user_id=u.id
    LEFT JOIN appointments a ON a.client_id=c.id AND a.status='completed' AND a.date BETWEEN ? AND ?
    WHERE u.barbershop_id=?
    GROUP BY c.id ORDER BY total_spent DESC`).all(from, to, bsId);
  res.json({ rows, total: rows.length, period:{from,to} });
});

router.get('/inventory', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const rows = db.prepare(`
    SELECT i.name, i.category, i.qty quantity, i.min_qty min_quantity, i.unit_cost cost_price,
      (i.qty*i.unit_cost) stock_value,
      CASE WHEN i.qty<=0 THEN 'Sem estoque' WHEN i.qty<=i.min_qty THEN 'Crítico' ELSE 'OK' END status
    FROM inventory i WHERE i.barbershop_id=? ORDER BY i.category, i.name`).all(bsId);
  const totalValue = rows.reduce((s,r)=>s+(r.stock_value||0),0);
  const critical = rows.filter(r=>r.status!=='OK').length;
  res.json({ rows, totalValue, critical, total: rows.length });
});

module.exports = router;
