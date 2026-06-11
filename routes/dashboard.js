// routes/dashboard.js — Multi-tenant
'use strict';

const router = require('express').Router();
const { getDb }     = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

router.get('/bi', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const today = new Date().toISOString().split('T')[0];
  const month = today.slice(0, 7);
  // financial_entries filtro (tem barbershop_id diretamente)
  const feF  = bsId ? ' AND barbershop_id=?' : '';
  const bsP  = bsId ? [bsId] : [];
  // appointments filtro via JOIN com barbers/users
  const aJoin = bsId ? ' JOIN barbers br ON br.id=a.barber_id JOIN users usr ON usr.id=br.user_id AND usr.barbershop_id=?' : '';
  const aPArr = bsId ? [bsId] : [];

  // 8 KPIs avançados
  const revenue   = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='income'  AND strftime('%Y-%m',date)=?${feF}`).get(month,...bsP).v;
  const expenses  = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='expense' AND strftime('%Y-%m',date)=?${feF}`).get(month,...bsP).v;
  const appts     = db.prepare(`SELECT COUNT(*) AS n FROM appointments a${aJoin} WHERE a.status='completed' AND strftime('%Y-%m',a.date)=?`).get(...aPArr,month).n;
  const ticket    = appts > 0 ? revenue / appts : 0;

  const totalClientsMonth = db.prepare(`SELECT COUNT(DISTINCT a.client_id) AS n FROM appointments a${aJoin} WHERE strftime('%Y-%m',a.date)=? AND a.status='completed'`).get(...aPArr,month).n;
  const newClientsMonth   = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE strftime('%Y-%m',c.created_at)=?${bsId?' AND u.barbershop_id=?':''}`).get(month,...(bsId?[bsId]:[])).n;
  const returningRate     = totalClientsMonth > 0 ? Math.round((totalClientsMonth - newClientsMonth) / totalClientsMonth * 100) : 0;

  const totalClients = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE 1=1${bsId?' AND u.barbershop_id=?':''}`).get(...(bsId?[bsId]:[])).n;

  const ltv = db.prepare(`SELECT COALESCE(AVG(spent),0) AS v FROM (SELECT COALESCE(SUM(a.price),0) AS spent FROM appointments a${aJoin} WHERE a.status='completed' GROUP BY a.client_id)`).get(...aPArr).v;

  const barberRevBatch = db.prepare(`SELECT b.id, COALESCE(SUM(a.price),0) AS rev FROM barbers b LEFT JOIN appointments a ON a.barber_id=b.id AND a.status='completed' AND strftime('%Y-%m',a.date)=?${bsId?' WHERE b.user_id IN (SELECT id FROM users WHERE barbershop_id=?)':''} GROUP BY b.id`).all(month,...(bsId?[bsId]:[]));
  const revPerBarber   = barberRevBatch.length > 0 ? barberRevBatch.reduce((s,b)=>s+b.rev,0)/barberRevBatch.length : 0;

  // P&L mensal 12 meses
  const months12 = [];
  const d = new Date(); d.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const dt  = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const ym  = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    const inc = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='income'  AND strftime('%Y-%m',date)=?${feF}`).get(ym,...bsP).v;
    const exp = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='expense' AND strftime('%Y-%m',date)=?${feF}`).get(ym,...bsP).v;
    months12.push({ month: ym, label: dt.toLocaleString('pt-BR',{month:'short'}), income: inc, expenses: exp, profit: inc - exp });
  }

  // Receita por barbeiro este mês
  const revByBarber = db.prepare(`
    SELECT u.name, COALESCE(SUM(a.price),0) AS revenue
    FROM barbers b JOIN users u ON u.id=b.user_id
    LEFT JOIN appointments a ON a.barber_id=b.id AND a.status='completed' AND strftime('%Y-%m',a.date)=?
    WHERE 1=1${bsId?' AND u.barbershop_id=?':''}
    GROUP BY b.id ORDER BY revenue DESC LIMIT 6
  `).all(month,...(bsId?[bsId]:[]));

  // Evolução de clientes (6 meses)
  const clientEvol = [];
  for (let i = 5; i >= 0; i--) {
    const dt   = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const ym   = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    const novos  = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE strftime('%Y-%m',c.created_at)=?${bsId?' AND u.barbershop_id=?':''}`).get(ym,...(bsId?[bsId]:[])).n;
    const recorr = db.prepare(`SELECT COUNT(DISTINCT a.client_id) AS n FROM appointments a${aJoin} WHERE a.status='completed' AND strftime('%Y-%m',a.date)=?`).get(...aPArr,ym).n;
    const inat   = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id NOT IN (SELECT DISTINCT client_id FROM appointments WHERE date>=date('now','-30 days') AND status='completed')${bsId?' AND u.barbershop_id=?':''}`).get(...(bsId?[bsId]:[])).n;
    clientEvol.push({ label: dt.toLocaleString('pt-BR',{month:'short'}), new: novos, returning: recorr, inactive: Math.max(0,inat-novos) });
  }

  // Horários de pico
  const peakRaw   = db.prepare(`SELECT CAST(substr(a.time,1,2) AS INT) AS hour, COUNT(*) AS n FROM appointments a${aJoin} WHERE a.status='completed' GROUP BY hour ORDER BY hour`).all(...aPArr);
  const peakHours = Array.from({length:24},(_,h)=>({ hour:h, n: peakRaw.find(p=>p.hour===h)?.n||0 })).filter(h=>h.n>0);

  // Top serviços
  const topSvcs = db.prepare(`
    SELECT s.name, COUNT(*) AS n, COALESCE(SUM(a.price),0) AS revenue
    FROM appointments a JOIN services s ON s.id=a.service_id${aJoin}
    WHERE a.status='completed' AND strftime('%Y-%m',a.date)=?
    GROUP BY s.id ORDER BY revenue DESC LIMIT 6
  `).all(...aPArr,month);

  // Funil de retenção — array para o frontend iterar
  const f1 = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT a.client_id FROM appointments a${aJoin} WHERE a.status='completed' GROUP BY a.client_id HAVING COUNT(*)>=1)`).get(...aPArr).n;
  const f2 = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT a.client_id FROM appointments a${aJoin} WHERE a.status='completed' GROUP BY a.client_id HAVING COUNT(*)>=2)`).get(...aPArr).n;
  const f3 = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT a.client_id FROM appointments a${aJoin} WHERE a.status='completed' GROUP BY a.client_id HAVING COUNT(*)>=3)`).get(...aPArr).n;
  const f5 = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT a.client_id FROM appointments a${aJoin} WHERE a.status='completed' GROUP BY a.client_id HAVING COUNT(*)>=5)`).get(...aPArr).n;
  const retentionFunnel = [
    { stage:'1+ visita',   n: f1 },
    { stage:'2+ visitas',  n: f2 },
    { stage:'3+ visitas',  n: f3 },
    { stage:'5+ visitas',  n: f5 },
  ];

  // Previsão IA — cálculo robusto mês a mês
  // Usar apenas meses COMPLETOS (excluir mês corrente, que está parcial)
  const completedMonths = months12.slice(0, -1);
  const withData = completedMonths.filter(m => m.income > 0);

  // Base: último mês completo com dados reais
  const baseIncome = withData.length > 0 ? withData[withData.length - 1].income : 0;
  const recent6  = withData.slice(-6);
  let avgMonthlyGrowth = 0.05; // padrão conservador 5%
  if (recent6.length >= 2) {
    const rates = [];
    for (let i = 1; i < recent6.length; i++) {
      const prev = recent6[i - 1].income;
      const curr = recent6[i].income;
      if (prev > 0) rates.push((curr - prev) / prev);
    }
    if (rates.length > 0) {
      avgMonthlyGrowth = rates.reduce((a, b) => a + b, 0) / rates.length;
      // Limitar entre -20% e +30% para evitar projeções absurdas
      avgMonthlyGrowth = Math.max(-0.20, Math.min(0.30, avgMonthlyGrowth));
    }
  }

  // Crescimento composto (não linear)
  const forecast = [
    { month: 'Mês +1', predicted: Math.round(baseIncome * Math.pow(1 + avgMonthlyGrowth, 1)), confidence: 0.82 },
    { month: 'Mês +2', predicted: Math.round(baseIncome * Math.pow(1 + avgMonthlyGrowth, 2)), confidence: 0.72 },
    { month: 'Mês +3', predicted: Math.round(baseIncome * Math.pow(1 + avgMonthlyGrowth, 3)), confidence: 0.61 },
  ];

  res.json({
    kpis: { revenue, expenses, profit: revenue-expenses, ticket_medio: Math.round(ticket*100)/100,
      returning_rate: returningRate, total_clients: totalClients,
      ltv: Math.round(ltv*100)/100, rev_per_barber: Math.round(revPerBarber),
      revenue_growth: 0, cac: Math.round(expenses/(Math.max(newClientsMonth,1))), nps: 78 },
    monthly_pnl: months12,
    rev_by_barber: revByBarber,
    client_evolution: clientEvol,
    peak_hours: peakHours,
    top_services: topSvcs,
    retention_funnel: retentionFunnel,
    forecast,
  });
});

router.get('/', requireAuth, requireRole('owner'), (req, res) => {
  const db    = getDb();
  const bsId  = getBsId(req);
  const today = new Date().toISOString().split('T')[0];
  const month = today.slice(0, 7);

  // bsF uses table-qualified column to avoid "ambiguous column name"
  const aF  = bsId ? ' AND a.barbershop_id=?'  : '';   // appointments alias
  const feF = bsId ? ' AND barbershop_id=?'     : '';   // single-table queries
  const bsP = bsId ? [bsId] : [];

  const todayAppts = db.prepare(`
    SELECT a.id, a.time, a.end_time, a.status, a.price,
           cu.name AS client_name, bu.name AS barber_name,
           s.name  AS service_name, s.category
    FROM appointments a
    LEFT JOIN clients  cl ON cl.id = a.client_id
    LEFT JOIN users    cu ON cu.id = cl.user_id
    LEFT JOIN barbers  b  ON b.id  = a.barber_id
    LEFT JOIN users    bu ON bu.id = b.user_id
    LEFT JOIN services s  ON s.id  = a.service_id
    WHERE a.date=? AND a.status NOT IN ('cancelled','no_show')${aF}
    ORDER BY a.time ASC
  `).all(today, ...bsP);

  const revenue     = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='income'  AND strftime('%Y-%m',date)=?${feF}`).get(month, ...bsP).v;
  const expenses    = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='expense' AND strftime('%Y-%m',date)=?${feF}`).get(month, ...bsP).v;
  const appts_month = db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE strftime('%Y-%m',date)=? AND status='completed'${feF}`).get(month, ...bsP).n;
  const new_clients = db.prepare(`
    SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id
    WHERE strftime('%Y-%m',c.created_at)=?${bsId ? ' AND u.barbershop_id=?' : ''}
  `).get(month, ...(bsId ? [bsId] : [])).n;
  const cancelRate  = db.prepare(`
    SELECT CAST(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS REAL)/MAX(COUNT(*),1)*100 AS rate
    FROM appointments WHERE strftime('%Y-%m',date)=?${feF}
  `).get(month, ...bsP).rate;

  const [y, m] = month.split('-').map(Number);
  const prev   = m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
  const prevRevenue = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='income' AND strftime('%Y-%m',date)=?${feF}`).get(prev, ...bsP).v;

  const topServices = db.prepare(`
    SELECT s.name, COUNT(*) AS n, COALESCE(SUM(a.price),0) AS revenue
    FROM appointments a JOIN services s ON s.id=a.service_id
    WHERE a.status='completed' AND strftime('%Y-%m',a.date)=?${aF}
    GROUP BY s.id ORDER BY n DESC LIMIT 5
  `).all(month, ...bsP);

  const topBarbers = db.prepare(`
    SELECT u.name, COUNT(*) AS n, COALESCE(SUM(a.price),0) AS revenue, AVG(a.price) AS avg_ticket
    FROM appointments a JOIN barbers b ON b.id=a.barber_id JOIN users u ON u.id=b.user_id
    WHERE a.status='completed' AND strftime('%Y-%m',a.date)=?${aF}
    GROUP BY b.id ORDER BY revenue DESC LIMIT 5
  `).all(month, ...bsP);

  const weekly = db.prepare(`
    SELECT date, COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income
    FROM financial_entries
    WHERE date >= date('now','-6 days')${feF}
    GROUP BY date ORDER BY date ASC
  `).all(...bsP);

  const lowStock    = bsId
    ? db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE qty<=min_qty AND active=1 AND barbershop_id=?').get(bsId).n
    : db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE qty<=min_qty AND active=1').get().n;
  const pendingAppt = db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE status='pending' AND date=?${feF}`).get(today, ...bsP).n;

  // Today's revenue
  const todayRevenue = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='income' AND date=?${feF}`).get(today,...bsP).v;

  // Active clients (visited in last 90 days)
  const activeClients = db.prepare(`
    SELECT COUNT(DISTINCT c.id) AS n FROM clients c JOIN users u ON u.id=c.user_id
    JOIN appointments a ON a.client_id=c.id
    WHERE a.date >= date('now','-90 days') AND a.status='completed'${bsId?' AND u.barbershop_id=?':''}
  `).get(...(bsId?[bsId]:[])).n;
  const newClientsMonth = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE strftime('%Y-%m',c.created_at)=?${bsId?' AND u.barbershop_id=?':''}`).get(month,...(bsId?[bsId]:[])).n;

  // Payment methods today
  const payMethods = db.prepare(`
    SELECT payment_method, COALESCE(SUM(amount),0) AS total
    FROM financial_entries WHERE type='income' AND date=?${feF}
    GROUP BY payment_method
  `).all(today,...bsP);

  // Inactive client segments
  const inact15  = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id NOT IN (SELECT DISTINCT client_id FROM appointments WHERE date>=date('now','-15 days') AND client_id IS NOT NULL) ${bsId?'AND u.barbershop_id=?':''}`).get(...(bsId?[bsId]:[])).n;
  const inact30  = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id NOT IN (SELECT DISTINCT client_id FROM appointments WHERE date>=date('now','-30 days') AND client_id IS NOT NULL) ${bsId?'AND u.barbershop_id=?':''}`).get(...(bsId?[bsId]:[])).n;
  const inact60  = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id NOT IN (SELECT DISTINCT client_id FROM appointments WHERE date>=date('now','-60 days') AND client_id IS NOT NULL) ${bsId?'AND u.barbershop_id=?':''}`).get(...(bsId?[bsId]:[])).n;
  const inact90  = db.prepare(`SELECT COUNT(*) AS n FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id NOT IN (SELECT DISTINCT client_id FROM appointments WHERE date>=date('now','-90 days') AND client_id IS NOT NULL) ${bsId?'AND u.barbershop_id=?':''}`).get(...(bsId?[bsId]:[])).n;

  // Monthly revenue (6 months for chart)
  const monthly6 = [];
  const d6 = new Date(); d6.setDate(1);
  for (let i=5; i>=0; i--) {
    const dt = new Date(d6.getFullYear(), d6.getMonth()-i, 1);
    const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    const inc = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='income' AND strftime('%Y-%m',date)=?${feF}`).get(ym,...bsP).v;
    monthly6.push({ label: dt.toLocaleString('pt-BR',{month:'short'}), income: inc });
  }

  // Services distribution (donut)
  const svcDist = db.prepare(`
    SELECT s.category AS name, COUNT(*) AS n, COALESCE(SUM(a.price),0) AS revenue
    FROM appointments a JOIN services s ON s.id=a.service_id
    WHERE a.status='completed' AND strftime('%Y-%m',a.date)=?${aF}
    GROUP BY s.category ORDER BY revenue DESC LIMIT 6
  `).all(month,...bsP);

  res.json({
    today,
    today_appointments: todayAppts,
    kpis: {
      revenue, expenses, profit: revenue - expenses,
      today_revenue: todayRevenue,
      today_appts: todayAppts.length,
      today_pending: pendingAppt,
      appts_month, new_clients: newClientsMonth,
      active_clients: activeClients,
      cancel_rate: Math.round((cancelRate||0) * 10) / 10,
      ticket_medio: appts_month > 0 ? revenue / appts_month : 0,
      revenue_growth: prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue * 100) : 0,
    },
    top_services: topServices,
    top_barbers:  topBarbers,
    weekly_revenue: weekly,
    monthly_revenue: monthly6,
    services_distribution: svcDist,
    payment_methods: payMethods,
    inactive_clients: { d15: inact15, d30: inact30, d60: inact60, d90: inact90 },
    alerts: { low_stock: lowStock, pending_appointments: pendingAppt },
  });
});

router.get('/barber', requireAuth, requireRole('barber'), (req, res) => {
  const db     = getDb();
  const barber = db.prepare('SELECT * FROM barbers WHERE user_id=?').get(req.user.id);
  if (!barber) return res.status(404).json({ error: 'Perfil de barbeiro não encontrado.' });

  const today = new Date().toISOString().split('T')[0];
  const month = today.slice(0, 7);

  const todayAppts = db.prepare(`
    SELECT a.id, a.time, a.end_time, a.status, a.price,
           cu.name AS client_name, s.name AS service_name
    FROM appointments a
    LEFT JOIN clients cl ON cl.id=a.client_id LEFT JOIN users cu ON cu.id=cl.user_id
    LEFT JOIN services s ON s.id=a.service_id
    WHERE a.barber_id=? AND a.date=? AND a.status NOT IN ('cancelled','no_show')
    ORDER BY a.time ASC
  `).all(barber.id, today);

  const monthRevenue = db.prepare(`SELECT COALESCE(SUM(price),0) AS v FROM appointments WHERE barber_id=? AND status='completed' AND strftime('%Y-%m',date)=?`).get(barber.id, month).v;
  const myCommission = monthRevenue * barber.commission_rate / 100;
  const monthCount   = db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE barber_id=? AND status='completed' AND strftime('%Y-%m',date)=?`).get(barber.id, month).n;

  res.json({
    barber_id: barber.id,
    commission_rate: barber.commission_rate,
    today_appointments: todayAppts,
    kpis: { month_revenue: monthRevenue, my_commission: myCommission, month_count: monthCount, today_count: todayAppts.length },
  });
});

router.get('/notifications', requireAuth, (req, res) => {
  const rows = getDb().prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
  res.json(rows);
});

router.patch('/notifications/:id/read', requireAuth, (req, res) => {
  getDb().prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ message: 'Marcado como lido.' });
});

router.delete('/notifications', requireAuth, (req, res) => {
  getDb().prepare('DELETE FROM notifications WHERE user_id=?').run(req.user.id);
  res.json({ message: 'Notificações limpas.' });
});

module.exports = router;
