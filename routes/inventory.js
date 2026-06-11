// routes/inventory.js — Multi-tenant
'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');
const { getDb }       = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');

router.get('/', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  let sql    = 'SELECT *, (qty <= min_qty) AS low_stock FROM inventory WHERE 1=1';
  const params = [];
  if (bsId)                       { sql += ' AND barbershop_id=?'; params.push(bsId); }
  if (req.query.low_stock==='true') { sql += ' AND qty<=min_qty'; }
  if (req.query.category)         { sql += ' AND category=?'; params.push(req.query.category); }
  if (req.query.search)           { sql += ' AND name LIKE ?'; params.push(`%${req.query.search}%`); }
  sql += ' ORDER BY category ASC, name ASC';
  res.json(db.prepare(sql).all(...params));
});

/* categories — MUST come before /:id */
router.get('/categories', requireAuth, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  let sql    = 'SELECT DISTINCT category FROM inventory WHERE 1=1';
  const params = [];
  if (bsId) { sql += ' AND barbershop_id=?'; params.push(bsId); }
  sql += ' ORDER BY category';
  res.json(db.prepare(sql).all(...params).map(r => r.category));
});

/* stats — MUST come before /:id */
router.get('/stats', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const bsFilter = bsId ? ' AND barbershop_id=?' : '';
  const bsP      = bsId ? [bsId] : [];
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_items,
      SUM(CASE WHEN qty<=min_qty THEN 1 ELSE 0 END) AS low_stock_count,
      COALESCE(SUM(qty*unit_cost),0) AS total_value,
      COUNT(DISTINCT category) AS categories
    FROM inventory WHERE active=1${bsFilter}
  `).get(...bsP);
  res.json(stats);
});

router.get('/:id', requireAuth, param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const item = db.prepare('SELECT * FROM inventory WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (bsId && item.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  const movements = db.prepare('SELECT * FROM inventory_movements WHERE item_id=? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  res.json({ ...item, movements });
});

router.post('/',
  requireAuth, requireRole('owner'),
  body('name').notEmpty(), body('qty').isFloat({ min:0 }), body('unit_cost').isFloat({ min:0 }),
  validate,
  (req, res) => {
    const db   = getDb();
    const bsId = getBsId(req) ?? null;
    const { name, category, qty, min_qty, unit, unit_cost, supplier, sku } = req.body;
    const r = db.prepare('INSERT INTO inventory (barbershop_id, name, category, qty, min_qty, unit, unit_cost, supplier, sku) VALUES (?,?,?,?,?,?,?,?,?)').run(bsId, name, category ?? 'Geral', qty ?? 0, min_qty ?? 5, unit ?? 'un', unit_cost, supplier ?? null, sku ?? null);
    if (qty > 0) db.prepare("INSERT INTO inventory_movements (item_id, type, qty, reason) VALUES (?,?,?,?)").run(r.lastInsertRowid, 'in', qty, 'Estoque inicial');
    res.status(201).json({ id: r.lastInsertRowid, message: 'Item cadastrado.' });
  }
);

router.patch('/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const item = db.prepare('SELECT id, barbershop_id FROM inventory WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (bsId && item.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  const allowed = ['name','category','min_qty','unit','unit_cost','supplier','sku','active'];
  const ups=[]; const vs=[];
  allowed.forEach(k => { if (req.body[k] !== undefined) { ups.push(`${k}=?`); vs.push(req.body[k]); } });
  if (!ups.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  ups.push("updated_at=datetime('now')"); vs.push(req.params.id);
  db.prepare(`UPDATE inventory SET ${ups.join(',')} WHERE id=?`).run(...vs);
  res.json({ message: 'Item atualizado.' });
});

router.delete('/:id', requireAuth, requireRole('owner'), param('id').isInt(), validate, (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const item = db.prepare('SELECT id, barbershop_id FROM inventory WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (bsId && item.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });
  // Deleta movimentos primeiro (FK sem cascade)
  db.prepare('DELETE FROM inventory_movements WHERE item_id=?').run(req.params.id);
  db.prepare('DELETE FROM inventory WHERE id=?').run(req.params.id);
  res.json({ message: 'Item excluído.' });
});

router.post('/:id/movement',
  requireAuth, requireRole('owner','barber'),
  param('id').isInt(), body('type').isIn(['in','out','adjustment']), body('qty').isFloat({ min:0.01 }),
  validate,
  (req, res) => {
    const db   = getDb();
    const bsId = getBsId(req);
    const item = db.prepare('SELECT * FROM inventory WHERE id=?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
    if (bsId && item.barbershop_id !== +bsId) return res.status(403).json({ error: 'Acesso negado.' });

    const { type, qty, reason } = req.body;
    let newQty = item.qty;
    if (type === 'in')          newQty += qty;
    else if (type === 'out')    newQty -= qty;
    else if (type === 'adjustment') newQty = qty;
    if (newQty < 0) return res.status(400).json({ error: 'Estoque insuficiente.' });

    db.prepare("UPDATE inventory SET qty=?, updated_at=datetime('now') WHERE id=?").run(newQty, req.params.id);
    db.prepare("INSERT INTO inventory_movements (item_id, type, qty, reason) VALUES (?,?,?,?)").run(req.params.id, type, qty, reason ?? null);

    if (type === 'in') {
      const fc = bsId
        ? db.prepare("SELECT id FROM financial_categories WHERE barbershop_id=? AND name='Produtos/Estoque' LIMIT 1").get(bsId)
        : db.prepare("SELECT id FROM financial_categories WHERE name='Produtos/Estoque' LIMIT 1").get();
      db.prepare(`INSERT INTO financial_entries (barbershop_id, type, category_id, description, amount, date, payment_method)
        VALUES (?,'expense',?,?,?,date('now'),'pix')`
      ).run(item.barbershop_id, fc?.id ?? null, `Reposição: ${item.name} (${qty} ${item.unit})`, qty * item.unit_cost);
    }
    res.json({ message: `Estoque atualizado. Novo saldo: ${newQty} ${item.unit}.`, new_qty: newQty });
  }
);

module.exports = router;
