'use strict';
const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

router.get('/', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  res.json(db.prepare('SELECT * FROM suppliers WHERE barbershop_id=? AND active=1 ORDER BY name').all(bsId));
});

router.post('/', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { name, contact, phone, email, discount_pct, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const r = db.prepare('INSERT INTO suppliers (barbershop_id,name,contact,phone,email,discount_pct,notes) VALUES (?,?,?,?,?,?,?)')
    .run(bsId, name, contact||null, phone||null, email||null, discount_pct||0, notes||null);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { name, contact, phone, email, discount_pct, notes } = req.body;
  db.prepare('UPDATE suppliers SET name=?,contact=?,phone=?,email=?,discount_pct=?,notes=? WHERE id=? AND barbershop_id=?')
    .run(name, contact||null, phone||null, email||null, discount_pct||0, notes||null, req.params.id, bsId);
  res.json({ message: 'Fornecedor atualizado.' });
});

router.delete('/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  db.prepare('UPDATE suppliers SET active=0 WHERE id=? AND barbershop_id=?').run(req.params.id, bsId);
  res.json({ message: 'Fornecedor removido.' });
});

// Sugestões de compra baseadas em itens abaixo do mínimo
router.get('/suggestions', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const items = db.prepare(`
    SELECT id, name, category, qty quantity, min_qty min_quantity, unit_cost cost_price,
      (min_qty * 2 - qty) needed,
      (min_qty * 2 - qty) * unit_cost estimated_cost
    FROM inventory
    WHERE barbershop_id=? AND qty <= min_qty
    ORDER BY (min_qty - qty) DESC`).all(bsId);
  const suppliers = db.prepare('SELECT * FROM suppliers WHERE barbershop_id=? AND active=1 ORDER BY name').all(bsId);
  res.json({ items, suppliers, total_estimated: items.reduce((s,i)=>s+(i.estimated_cost||0),0) });
});

// Pedidos de compra
router.get('/orders', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const orders = db.prepare(`
    SELECT po.*, s.name supplier_name
    FROM purchase_orders po JOIN suppliers s ON po.supplier_id=s.id
    WHERE po.barbershop_id=? ORDER BY po.created_at DESC LIMIT 50`).all(bsId);
  for (const o of orders) {
    o.items = db.prepare('SELECT poi.*, i.name item_name_orig FROM purchase_order_items poi LEFT JOIN inventory i ON poi.inventory_id=i.id WHERE poi.order_id=?').all(o.id);
  }
  res.json(orders);
});

router.post('/orders', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { supplier_id, items, notes } = req.body;
  if (!supplier_id || !items?.length) return res.status(400).json({ error: 'supplier_id e items são obrigatórios.' });
  const total = items.reduce((s,i)=>s+(i.quantity*i.unit_cost),0);
  const r = db.prepare('INSERT INTO purchase_orders (barbershop_id,supplier_id,total,notes) VALUES (?,?,?,?)').run(bsId, supplier_id, total, notes||null);
  const insItem = db.prepare('INSERT INTO purchase_order_items (order_id,inventory_id,item_name,quantity,unit_cost) VALUES (?,?,?,?,?)');
  for (const it of items) insItem.run(r.lastInsertRowid, it.inventory_id||null, it.item_name||'Item', it.quantity, it.unit_cost||0);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.patch('/orders/:id/receive', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=? AND barbershop_id=?').get(req.params.id, bsId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.status === 'received') return res.status(400).json({ error: 'Pedido já recebido.' });
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').all(order.id);
  db.exec('BEGIN');
  try {
    for (const it of items) {
      if (it.inventory_id) {
        db.prepare("UPDATE inventory SET qty=qty+?, updated_at=datetime('now') WHERE id=?").run(it.quantity, it.inventory_id);
        db.prepare("INSERT INTO inventory_movements (item_id,type,qty,reason,created_at) VALUES (?,?,?,?,datetime('now'))").run(it.inventory_id,'in',it.quantity,`Pedido #${order.id}`);
      }
    }
    db.prepare("UPDATE purchase_orders SET status='received', received_at=datetime('now') WHERE id=?").run(order.id);
    // Lança despesa
    const cat = db.prepare("SELECT id FROM financial_categories WHERE barbershop_id=? AND type='expense' LIMIT 1").get(bsId);
    if (cat) {
      db.prepare("INSERT INTO financial_entries (barbershop_id,type,description,amount,category_id,payment_method,date) VALUES (?,?,?,?,?,?,date('now'))")
        .run(bsId,'expense',`Pedido de compra #${order.id}`,order.total,cat.id,'transfer');
    }
    db.exec('COMMIT');
    res.json({ message: 'Pedido recebido e estoque atualizado.' });
  } catch(e) { db.exec('ROLLBACK'); throw e; }
});

module.exports = router;
