'use strict';
const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

router.get('/', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const month = req.query.month || new Date().toISOString().slice(0,7);
  const goal = db.prepare('SELECT * FROM goals WHERE barbershop_id=? AND month=?').get(bsId, month) || { month, revenue_goal:0, appointments_goal:0, new_clients_goal:0, avg_rating_goal:4.5 };
  const barberGoals = db.prepare(`
    SELECT bg.*, u.name barber_name FROM barber_goals bg
    JOIN barbers b ON bg.barber_id=b.id JOIN users u ON b.user_id=u.id
    WHERE bg.barbershop_id=? AND bg.month=?`).all(bsId, month);
  // Dados reais do mês
  const [y, m] = month.split('-');
  const startDate = `${month}-01`;
  const endDate = `${month}-${new Date(y,m,0).getDate()}`;
  const real = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) revenue,
      (SELECT COUNT(*) FROM appointments WHERE barbershop_id=? AND status='completed' AND date BETWEEN ? AND ?) appointments,
      (SELECT COUNT(*) FROM users WHERE barbershop_id=? AND role='client' AND date(created_at) BETWEEN ? AND ?) new_clients,
      (SELECT AVG(rating) FROM reviews WHERE barbershop_id=? AND date(created_at) BETWEEN ? AND ?) avg_rating
    FROM financial_entries WHERE barbershop_id=? AND date BETWEEN ? AND ?
  `).get(bsId,startDate,endDate, bsId,startDate,endDate, bsId,startDate,endDate, bsId,startDate,endDate);
  // Progresso por barbeiro
  const barberReal = db.prepare(`
    SELECT a.barber_id, u.name barber_name,
      SUM(a.price) revenue, COUNT(*) appointments
    FROM appointments a JOIN barbers b ON a.barber_id=b.id JOIN users u ON b.user_id=u.id
    WHERE a.barbershop_id=? AND a.status='completed' AND a.date BETWEEN ? AND ?
    GROUP BY a.barber_id`).all(bsId, startDate, endDate);
  // Conquistas
  const achievements = computeAchievements(db, bsId, month, startDate, endDate, real);
  res.json({ goal, barberGoals, real, barberReal, achievements, month });
});

router.put('/', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { month, revenue_goal, appointments_goal, new_clients_goal, avg_rating_goal } = req.body;
  if (!month) return res.status(400).json({ error: 'month é obrigatório (YYYY-MM).' });
  db.prepare(`INSERT INTO goals (barbershop_id,month,revenue_goal,appointments_goal,new_clients_goal,avg_rating_goal)
    VALUES (?,?,?,?,?,?) ON CONFLICT(barbershop_id,month) DO UPDATE SET
    revenue_goal=excluded.revenue_goal, appointments_goal=excluded.appointments_goal,
    new_clients_goal=excluded.new_clients_goal, avg_rating_goal=excluded.avg_rating_goal`)
    .run(bsId, month, revenue_goal||0, appointments_goal||0, new_clients_goal||0, avg_rating_goal||4.5);
  res.json({ message: 'Meta salva.' });
});

router.put('/barber', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { barber_id, month, revenue_goal, appointments_goal } = req.body;
  if (!barber_id || !month) return res.status(400).json({ error: 'barber_id e month são obrigatórios.' });
  db.prepare(`INSERT INTO barber_goals (barbershop_id,barber_id,month,revenue_goal,appointments_goal)
    VALUES (?,?,?,?,?) ON CONFLICT(barbershop_id,barber_id,month) DO UPDATE SET
    revenue_goal=excluded.revenue_goal, appointments_goal=excluded.appointments_goal`)
    .run(bsId, barber_id, month, revenue_goal||0, appointments_goal||0);
  res.json({ message: 'Meta do barbeiro salva.' });
});

function computeAchievements(db, bsId, month, startDate, endDate, real) {
  const all = [];
  // Top barbeiro da semana
  const topBarber = db.prepare(`SELECT u.name, COUNT(*) n FROM appointments a JOIN barbers b ON a.barber_id=b.id JOIN users u ON b.user_id=u.id WHERE a.barbershop_id=? AND a.status='completed' AND a.date >= date('now','-7 days') GROUP BY a.barber_id ORDER BY n DESC LIMIT 1`).get(bsId);
  if (topBarber) all.push({ id:'top_barber_week', title:'⭐ Top Barbeiro', desc:`${topBarber.name} — ${topBarber.n} atendimentos esta semana`, unlocked:true });
  // Média 5 estrelas
  const avg5 = db.prepare('SELECT AVG(rating) avg FROM reviews WHERE barbershop_id=?').get(bsId);
  all.push({ id:'avg_5stars', title:'🌟 Avaliação Perfeita', desc:'Manter média 4.8+', unlocked: (avg5?.avg||0) >= 4.8 });
  // Meta batida
  const goal = db.prepare('SELECT * FROM goals WHERE barbershop_id=? AND month=?').get(bsId, month);
  if (goal) all.push({ id:'goal_hit', title:'🎯 Meta Batida!', desc:`Faturamento: ${goal.revenue_goal > 0 ? Math.round((real.revenue/goal.revenue_goal)*100) : 0}%`, unlocked: real.revenue >= goal.revenue_goal && goal.revenue_goal > 0 });
  // 100 atendimentos acumulados
  const total100 = db.prepare('SELECT COUNT(*) n FROM appointments WHERE barbershop_id=? AND status=?').get(bsId,'completed');
  all.push({ id:'100_appts', title:'💯 100 Atendimentos', desc:`${total100.n} atendimentos concluídos`, unlocked: total100.n >= 100 });
  // 10 atendimentos no mês
  all.push({ id:'10_month', title:'✂️ 10 no Mês', desc:`${real.appointments} atendimentos este mês`, unlocked: real.appointments >= 10 });
  return all;
}

module.exports = router;
