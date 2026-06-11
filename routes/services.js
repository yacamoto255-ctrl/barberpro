// routes/services.js — Multi-tenant
'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');
const { getDb }       = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');

router.get('/', requireAuth, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  let sql    = 'SELECT * FROM services WHERE 1=1';
  const params = [];
  if (bsId)                       { sql += ' AND barbershop_id=?';  params.push(bsId); }
  if (req.query.active !== undefined) { sql += ' AND active=?'; params.push(req.query.active === 'true' ? 1 : 0); }
  if (req.query.category)         { sql += ' AND category=?'; params.push(req.query.category); }
  sql += ' ORDER BY category ASC, name ASC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', requireAuth, param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const svc  = db.prepare('SELECT * FROM services WHERE id=?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Serviço não encontrado.' });
  if (bsId && svc.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  res.json(svc);
});

router.post('/',
  requireAuth, requireRole('owner'),
  body('name').notEmpty(), body('price').isFloat({ min:0 }), body('duration').isInt({ min:5 }),
  validate,
  (req, res) => {
    const db   = getDb();
    const bsId = getBsId(req) ?? null;
    const { name, category, duration, price, description } = req.body;
    const r = db.prepare('INSERT INTO services (barbershop_id, name, category, duration, price, description) VALUES (?,?,?,?,?,?)').run(bsId, name, category ?? 'Corte', duration, price, description ?? null);
    res.status(201).json({ id: r.lastInsertRowid, message: 'Serviço criado.' });
  }
);

router.patch('/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const svc  = db.prepare('SELECT id, barbershop_id FROM services WHERE id=?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Serviço não encontrado.' });
  if (bsId && svc.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  const allowed = ['name','category','duration','price','description','active'];
  const ups=[]; const vs=[];
  allowed.forEach(k => { if (req.body[k] !== undefined) { ups.push(`${k}=?`); vs.push(req.body[k]); } });
  if (!ups.length) return res.status(400).json({ error: 'Nenhum campo.' });
  ups.push("updated_at=datetime('now')"); vs.push(req.params.id);
  db.prepare(`UPDATE services SET ${ups.join(',')} WHERE id=?`).run(...vs);
  res.json({ message: 'Serviço atualizado.' });
});

router.delete('/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const svc  = db.prepare('SELECT id, barbershop_id FROM services WHERE id=?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Serviço não encontrado.' });
  if (bsId && svc.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  // Limpa dependências antes de excluir
  db.prepare('DELETE FROM barber_services WHERE service_id=?').run(req.params.id);
  db.prepare('UPDATE appointments SET service_id=NULL WHERE service_id=?').run(req.params.id);
  db.prepare('DELETE FROM services WHERE id=?').run(req.params.id);
  res.json({ message: 'Serviço excluído.' });
});

module.exports = router;
