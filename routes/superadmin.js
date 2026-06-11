// routes/superadmin.js — Painel do Super Admin (plataforma)
'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { body, param } = require('express-validator');
const { getDb }          = require('../db');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { validate }       = require('../middleware/validate');

// Todas as rotas exigem super_admin
router.use(requireAuth, requireSuperAdmin);

/* ── GET /api/super-admin/dashboard — visão geral da plataforma ── */
router.get('/dashboard', (req, res) => {
  const db = getDb();

  const barbershops = db.prepare(`
    SELECT
      bs.id, bs.name, bs.slug, bs.plan, bs.active,
      bs.phone, bs.address, bs.created_at,
      (SELECT u.name  FROM users u WHERE u.barbershop_id = bs.id AND u.role = 'owner' LIMIT 1) AS owner_name,
      (SELECT u.email FROM users u WHERE u.barbershop_id = bs.id AND u.role = 'owner' LIMIT 1) AS owner_email,
      (SELECT COUNT(*) FROM users u WHERE u.barbershop_id = bs.id AND u.role = 'barber' AND u.active = 1) AS barbers_count,
      (SELECT COUNT(*) FROM users u WHERE u.barbershop_id = bs.id AND u.role = 'client' AND u.active = 1) AS clients_count,
      (SELECT COUNT(*) FROM appointments a WHERE a.barbershop_id = bs.id AND a.date = date('now') AND a.status NOT IN ('cancelled','no_show')) AS today_appts,
      (SELECT COUNT(*) FROM appointments a WHERE a.barbershop_id = bs.id AND strftime('%Y-%m', a.date) = strftime('%Y-%m', 'now') AND a.status = 'completed') AS month_appts,
      (SELECT COALESCE(SUM(amount),0) FROM financial_entries fe WHERE fe.barbershop_id = bs.id AND fe.type = 'income' AND strftime('%Y-%m', fe.date) = strftime('%Y-%m', 'now')) AS month_revenue
    FROM barbershops bs
    ORDER BY bs.created_at DESC
  `).all();

  const totals = {
    barbershops:    barbershops.length,
    active:         barbershops.filter(b => b.active).length,
    total_barbers:  barbershops.reduce((a, b) => a + b.barbers_count,  0),
    total_clients:  barbershops.reduce((a, b) => a + b.clients_count,  0),
    today_appts:    barbershops.reduce((a, b) => a + b.today_appts,    0),
    month_revenue:  barbershops.reduce((a, b) => a + b.month_revenue,  0),
  };

  res.json({ barbershops, totals });
});

/* ── GET /api/super-admin/barbershops — lista todas as barbearias ── */
router.get('/barbershops', (req, res) => {
  const db  = getDb();
  const rows = db.prepare(`
    SELECT bs.*,
      (SELECT u.name  FROM users u WHERE u.barbershop_id = bs.id AND u.role='owner' LIMIT 1) AS owner_name,
      (SELECT u.email FROM users u WHERE u.barbershop_id = bs.id AND u.role='owner' LIMIT 1) AS owner_email,
      (SELECT COUNT(*) FROM users u WHERE u.barbershop_id = bs.id AND u.role='barber') AS barbers_count,
      (SELECT COUNT(*) FROM users u WHERE u.barbershop_id = bs.id AND u.role='client') AS clients_count
    FROM barbershops bs ORDER BY bs.name ASC
  `).all();
  res.json(rows);
});

/* ── GET /api/super-admin/barbershops/:id — detalhes de uma barbearia ── */
router.get('/barbershops/:id', param('id').isInt(), validate, (req, res) => {
  const db = getDb();
  const bs = db.prepare('SELECT * FROM barbershops WHERE id = ?').get(req.params.id);
  if (!bs) return res.status(404).json({ error: 'Barbearia não encontrada.' });

  const users = db.prepare(`
    SELECT id, name, email, role, phone, active, created_at
    FROM users WHERE barbershop_id = ? ORDER BY role, name
  `).all(req.params.id);

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM appointments WHERE barbershop_id=? AND status='completed') AS total_appts,
      (SELECT COALESCE(SUM(amount),0) FROM financial_entries WHERE barbershop_id=? AND type='income') AS total_revenue,
      (SELECT COUNT(*) FROM inventory WHERE barbershop_id=?) AS inventory_items
  `).get(req.params.id, req.params.id, req.params.id);

  res.json({ ...bs, users, stats });
});

/* ── POST /api/super-admin/barbershops — cria nova barbearia + dono ── */
router.post('/barbershops',
  body('barbershop_name').notEmpty().withMessage('Nome da barbearia obrigatório.'),
  body('owner_name').notEmpty().withMessage('Nome do dono obrigatório.'),
  body('owner_email').isEmail().withMessage('E-mail inválido.'),
  body('owner_password').isLength({ min: 6 }).withMessage('Senha mínimo 6 caracteres.'),
  validate,
  (req, res) => {
    const db = getDb();
    const { barbershop_name, owner_name, owner_email, owner_password, phone, address, plan } = req.body;

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(owner_email))
      return res.status(409).json({ error: 'E-mail já cadastrado.' });

    // Cria barbearia
    const slug = barbershop_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const bs = db.prepare(`INSERT INTO barbershops (name, slug, phone, address, plan)
                           VALUES (?, ?, ?, ?, ?)`)
                 .run(barbershop_name, slug || null, phone || null, address || null, plan || 'basic');
    const bsId = bs.lastInsertRowid;

    // Cria dono
    const hash = bcrypt.hashSync(owner_password, 10);
    const u = db.prepare(`INSERT INTO users (barbershop_id, name, email, password, role)
                          VALUES (?, ?, ?, ?, 'owner')`)
               .run(bsId, owner_name, owner_email, hash);

    // Categorias financeiras padrão
    [['Serviços','income','#22c55e'],['Salários','expense','#ef4444'],
     ['Aluguel','expense','#f97316'],['Marketing','expense','#ec4899'],
     ['Utilidades','expense','#14b8a6'],['Produtos/Estoque','expense','#eab308']]
      .forEach(([name,type,color]) =>
        db.prepare('INSERT INTO financial_categories (barbershop_id, name, type, color) VALUES (?,?,?,?)').run(bsId,name,type,color));

    // Configurações padrão
    [['barbearia_nome',barbershop_name],['horario_abertura','09:00'],['horario_fechamento','20:00'],
     ['intervalo_agenda','30'],['fidelidade_pontos_por_real','10'],['fidelidade_cashback_pct','5']]
      .forEach(([k,v]) =>
        db.prepare('INSERT OR REPLACE INTO settings (barbershop_id, key, value) VALUES (?,?,?)').run(bsId,k,v));

    // Notificação de boas-vindas
    db.prepare(`INSERT INTO notifications (user_id, title, body, type)
                VALUES (?, 'Bem-vindo ao BarberPro!', 'Sua barbearia foi criada. Configure em Configurações.', 'success')`)
      .run(u.lastInsertRowid);

    res.status(201).json({ id: bsId, message: `Barbearia "${barbershop_name}" criada com sucesso.` });
  }
);

/* ── PATCH /api/super-admin/barbershops/:id — edita barbearia ── */
router.patch('/barbershops/:id', param('id').isInt(), validate, (req, res) => {
  const db = getDb();
  const bs = db.prepare('SELECT id FROM barbershops WHERE id = ?').get(req.params.id);
  if (!bs) return res.status(404).json({ error: 'Barbearia não encontrada.' });

  const allowed = ['name','phone','address','plan','active'];
  const ups = []; const vs = [];
  allowed.forEach(k => { if (req.body[k] !== undefined) { ups.push(`${k} = ?`); vs.push(req.body[k]); } });
  if (!ups.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  ups.push("updated_at = datetime('now')"); vs.push(req.params.id);
  db.prepare(`UPDATE barbershops SET ${ups.join(', ')} WHERE id = ?`).run(...vs);
  res.json({ message: 'Barbearia atualizada.' });
});

/* ── DELETE /api/super-admin/barbershops/:id — exclui barbearia ── */
router.delete('/barbershops/:id', param('id').isInt(), validate, (req, res) => {
  const db = getDb();
  const bs = db.prepare('SELECT * FROM barbershops WHERE id = ?').get(req.params.id);
  if (!bs) return res.status(404).json({ error: 'Barbearia não encontrada.' });

  const id = req.params.id;

  // Desabilita FKs para fazer cascata manual na ordem correta
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');

    // 1. Registros que dependem de appointments/clients/barbers
    db.prepare(`DELETE FROM loyalty_transactions WHERE client_id IN
      (SELECT c.id FROM clients c JOIN users u ON u.id=c.user_id WHERE u.barbershop_id=?)`).run(id);

    // 2. Movements que dependem de inventory
    db.prepare(`DELETE FROM inventory_movements WHERE item_id IN
      (SELECT id FROM inventory WHERE barbershop_id=?)`).run(id);

    // 3. Appointments (dependem de clients, barbers, services — todos desta barbearia)
    db.prepare('DELETE FROM appointments WHERE barbershop_id=?').run(id);

    // 4. Commissions que dependem de barbers
    db.prepare(`DELETE FROM commissions WHERE barber_id IN
      (SELECT b.id FROM barbers b JOIN users u ON u.id=b.user_id WHERE u.barbershop_id=?)`).run(id);

    // 5. Notificações dos usuários desta barbearia
    db.prepare(`DELETE FROM notifications WHERE user_id IN
      (SELECT id FROM users WHERE barbershop_id=?)`).run(id);

    // 6. Lançamentos e categorias financeiras
    db.prepare('DELETE FROM financial_entries WHERE barbershop_id=?').run(id);
    db.prepare('DELETE FROM financial_categories WHERE barbershop_id=?').run(id);

    // 7. Estoque
    db.prepare('DELETE FROM inventory WHERE barbershop_id=?').run(id);

    // 8. Configurações
    db.prepare('DELETE FROM settings WHERE barbershop_id=?').run(id);

    // 9. Serviços (barber_services dependem deles)
    db.prepare(`DELETE FROM barber_services WHERE service_id IN
      (SELECT id FROM services WHERE barbershop_id=?)`).run(id);
    db.prepare('DELETE FROM services WHERE barbershop_id=?').run(id);

    // 10. Clients e barbers (dependem de users)
    db.prepare(`DELETE FROM clients WHERE user_id IN
      (SELECT id FROM users WHERE barbershop_id=?)`).run(id);
    db.prepare(`DELETE FROM barbers WHERE user_id IN
      (SELECT id FROM users WHERE barbershop_id=?)`).run(id);

    // 11. Usuários
    db.prepare('DELETE FROM users WHERE barbershop_id=?').run(id);

    // 12. Por fim, a barbearia
    db.prepare('DELETE FROM barbershops WHERE id=?').run(id);

    db.exec('COMMIT');
  } catch(e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }

  res.json({ message: `Barbearia "${bs.name}" excluída com sucesso.` });
});

/* ── PATCH /api/super-admin/barbershops/:id/toggle — ativa/desativa ── */
router.patch('/barbershops/:id/toggle', param('id').isInt(), validate, (req, res) => {
  const db = getDb();
  const bs = db.prepare('SELECT id, active FROM barbershops WHERE id = ?').get(req.params.id);
  if (!bs) return res.status(404).json({ error: 'Barbearia não encontrada.' });

  const newActive = bs.active ? 0 : 1;
  db.prepare("UPDATE barbershops SET active = ?, updated_at = datetime('now') WHERE id = ?").run(newActive, req.params.id);
  // Desativa/reativa todos os usuários da barbearia
  db.prepare("UPDATE users SET active = ? WHERE barbershop_id = ?").run(newActive, req.params.id);
  res.json({ message: `Barbearia ${newActive ? 'ativada' : 'desativada'}.`, active: newActive });
});

/* ── GET /api/super-admin/logins — últimos logins (simplificado via users) ── */
router.get('/activity', (req, res) => {
  const db = getDb();
  // Retorna usuários ativos por barbearia com contagem
  const activity = db.prepare(`
    SELECT
      bs.id AS barbershop_id, bs.name AS barbershop_name,
      COUNT(DISTINCT CASE WHEN u.role='barber' AND u.active=1 THEN u.id END) AS active_barbers,
      COUNT(DISTINCT CASE WHEN u.role='client' AND u.active=1 THEN u.id END) AS active_clients,
      COUNT(DISTINCT CASE WHEN u.role='owner'  AND u.active=1 THEN u.id END) AS active_owners,
      (SELECT COUNT(*) FROM appointments a WHERE a.barbershop_id=bs.id AND a.date=date('now') AND a.status NOT IN ('cancelled','no_show')) AS today_appts,
      (SELECT COUNT(*) FROM appointments a WHERE a.barbershop_id=bs.id AND a.date >= date('now','-7 days') AND a.status='completed') AS week_appts
    FROM barbershops bs
    LEFT JOIN users u ON u.barbershop_id = bs.id
    GROUP BY bs.id
    ORDER BY bs.name
  `).all();
  res.json(activity);
});

module.exports = router;
