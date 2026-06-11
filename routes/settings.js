// routes/settings.js — Multi-tenant (composite PK: barbershop_id + key)
'use strict';

const router = require('express').Router();
const { getDb }       = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

router.get('/', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req) ?? null;
  const rows = bsId
    ? db.prepare('SELECT key, value FROM settings WHERE barbershop_id=?').all(bsId)
    : db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req) ?? null;
  const data = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Body inválido.' });
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (barbershop_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))");
  db.exec('BEGIN');
  try {
    Object.entries(data).forEach(([k, v]) => upsert.run(bsId, k, String(v)));
    db.exec('COMMIT');
  } catch(e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ message: 'Configurações salvas.', count: Object.keys(data).length });
});

router.patch('/:key', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req) ?? null;
  if (req.body.value === undefined) return res.status(400).json({ error: 'value é obrigatório.' });
  db.prepare("INSERT OR REPLACE INTO settings (barbershop_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(bsId, req.params.key, String(req.body.value));
  res.json({ message: 'Configuração atualizada.' });
});

router.get('/users/all', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  let sql = "SELECT id, name, email, role, phone, active, created_at FROM users WHERE role != 'super_admin'";
  const params = [];
  if (bsId) { sql += ' AND barbershop_id=?'; params.push(bsId); }
  sql += ' ORDER BY role, name';
  res.json(db.prepare(sql).all(...params));
});

router.patch('/users/:id', requireAuth, (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  // Only owner or the user themselves can update
  if (req.user.role !== 'owner' && req.user.id !== +req.params.id) return res.status(403).json({ error: 'Acesso negado.' });
  if (bsId && target.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  const { name, email, phone } = req.body;
  const fields = []; const vals = [];
  if (name)  { fields.push('name=?');  vals.push(name); }
  if (email) { fields.push('email=?'); vals.push(email); }
  if (phone !== undefined) { fields.push('phone=?'); vals.push(phone); }
  if (!fields.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  vals.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(',')}, updated_at=datetime('now') WHERE id=?`).run(...vals);
  res.json(db.prepare('SELECT id,name,email,role,phone,avatar FROM users WHERE id=?').get(req.params.id));
});

router.patch('/users/:id/active', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const { active } = req.body;
  if (active === undefined) return res.status(400).json({ error: 'active é obrigatório.' });
  // Prevent changing users outside the barbershop
  if (bsId) {
    const u = db.prepare('SELECT barbershop_id FROM users WHERE id=?').get(req.params.id);
    if (!u || u.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  }
  db.prepare("UPDATE users SET active=?, updated_at=datetime('now') WHERE id=?").run(active ? 1 : 0, req.params.id);
  res.json({ message: active ? 'Usuário ativado.' : 'Usuário desativado.' });
});

module.exports = router;
