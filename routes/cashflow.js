// routes/cashflow.js — Fluxo de Caixa
'use strict';

const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

/* ── GET / — sessão ativa (ou última fechada hoje) ──────────── */
router.get('/', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const today = new Date().toISOString().split('T')[0];

  const bsF = bsId ? ' AND cs.barbershop_id=?' : '';
  const bsP = bsId ? [bsId] : [];

  // Sessão aberta
  let session = db.prepare(`
    SELECT cs.*, u.name AS opened_by_name
    FROM cash_sessions cs LEFT JOIN users u ON u.id=cs.opened_by
    WHERE cs.status='open'${bsF} ORDER BY cs.opened_at DESC LIMIT 1
  `).get(...bsP);

  // Fallback: última fechada hoje
  if (!session) {
    session = db.prepare(`
      SELECT cs.*, u.name AS opened_by_name
      FROM cash_sessions cs LEFT JOIN users u ON u.id=cs.opened_by
      WHERE date(cs.opened_at)=?${bsF} ORDER BY cs.opened_at DESC LIMIT 1
    `).get(today, ...bsP);
  }

  if (!session) return res.json({ session: null, movements: [], summary: null });

  const movements = db.prepare(`
    SELECT * FROM cash_movements
    WHERE session_id=?
    ORDER BY created_at ASC
  `).all(session.id);

  // Sumário por método
  const methodTotals = { pix:0, credit:0, debit:0, cash:0, transfer:0 };
  let totalIncome = 0, totalExpense = 0;
  for (const m of movements) {
    if (m.type === 'income') {
      totalIncome += m.amount;
      methodTotals[m.payment_method] = (methodTotals[m.payment_method]||0) + m.amount;
    } else {
      totalExpense += m.amount;
    }
  }
  const balance = session.initial_balance + totalIncome - totalExpense;

  res.json({
    session,
    movements,
    summary: {
      initial_balance: session.initial_balance,
      total_income: totalIncome,
      total_expense: totalExpense,
      balance,
      by_method: methodTotals,
    },
  });
});

/* ── POST /open — abrir caixa ───────────────────────────────── */
router.post('/open', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req) ?? null;

  // Verificar se já tem sessão aberta
  const open = bsId
    ? db.prepare('SELECT id FROM cash_sessions WHERE status=? AND barbershop_id=? LIMIT 1').get('open', bsId)
    : db.prepare('SELECT id FROM cash_sessions WHERE status=? LIMIT 1').get('open');
  if (open) return res.status(409).json({ error: 'Já existe um caixa aberto.' });

  const initial_balance = parseFloat(req.body.initial_balance) || 0;
  const r = db.prepare(`
    INSERT INTO cash_sessions (barbershop_id, opened_by, initial_balance, status)
    VALUES (?, ?, ?, 'open')
  `).run(bsId, req.user.id, initial_balance);

  res.status(201).json({ id: r.lastInsertRowid, message: 'Caixa aberto.' });
});

/* ── POST /close — fechar caixa ─────────────────────────────── */
router.post('/close', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);

  const session = bsId
    ? db.prepare('SELECT * FROM cash_sessions WHERE status=? AND barbershop_id=? LIMIT 1').get('open', bsId)
    : db.prepare('SELECT * FROM cash_sessions WHERE status=? LIMIT 1').get('open');
  if (!session) return res.status(404).json({ error: 'Nenhum caixa aberto.' });

  // Calcular saldo final
  const movs = db.prepare('SELECT type, amount FROM cash_movements WHERE session_id=?').all(session.id);
  let inc = 0, exp = 0;
  movs.forEach(m => m.type==='income' ? (inc+=m.amount) : (exp+=m.amount));
  const final_balance = session.initial_balance + inc - exp;

  db.prepare(`
    UPDATE cash_sessions SET status='closed', closed_at=datetime('now'), final_balance=?, notes=? WHERE id=?
  `).run(final_balance, req.body.notes || null, session.id);

  res.json({ message: 'Caixa fechado.', final_balance });
});

/* ── POST /movements — registrar movimentação ───────────────── */
router.post('/movements', requireAuth, requireRole('owner','barber'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);

  const session = bsId
    ? db.prepare('SELECT * FROM cash_sessions WHERE status=? AND barbershop_id=? LIMIT 1').get('open', bsId)
    : db.prepare('SELECT * FROM cash_sessions WHERE status=? LIMIT 1').get('open');
  if (!session) return res.status(404).json({ error: 'Nenhum caixa aberto. Abra o caixa primeiro.' });

  const { type, description, amount, payment_method='pix' } = req.body;
  if (!type || !description || !amount) return res.status(400).json({ error: 'type, description e amount são obrigatórios.' });

  const today = new Date().toISOString().split('T')[0];
  const amt   = parseFloat(amount);

  // Inserir no cash_movements
  const r = db.prepare(`
    INSERT INTO cash_movements (session_id, barbershop_id, type, description, amount, payment_method)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(session.id, bsId ?? null, type, description, amt, payment_method);

  // ── Espelhar em financial_entries para o dashboard ver ──────
  // Busca ou cria categoria "Caixa" para o tipo
  const catName = type === 'income' ? 'Caixa - Receitas' : 'Caixa - Despesas';
  const catColor = type === 'income' ? '#22c55e' : '#ef4444';
  let cat = bsId
    ? db.prepare('SELECT id FROM financial_categories WHERE barbershop_id=? AND name=? LIMIT 1').get(bsId, catName)
    : db.prepare('SELECT id FROM financial_categories WHERE name=? LIMIT 1').get(catName);
  if (!cat) {
    const cr = db.prepare('INSERT INTO financial_categories (barbershop_id,name,type,color) VALUES (?,?,?,?)')
      .run(bsId ?? null, catName, type, catColor);
    cat = { id: cr.lastInsertRowid };
  }
  const fe = db.prepare(`
    INSERT INTO financial_entries (barbershop_id, type, category_id, description, amount, date, payment_method, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bsId ?? null, type, cat.id, description, amt, today, payment_method, `cash_movement_id:${r.lastInsertRowid}`);

  res.status(201).json({ id: r.lastInsertRowid, fe_id: fe.lastInsertRowid, message: 'Movimentação registrada.' });
});

/* ── DELETE /movements/:id ──────────────────────────────────── */
router.delete('/movements/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb();
  const id = req.params.id;
  // Remove o espelho em financial_entries (identificado via notes)
  db.prepare("DELETE FROM financial_entries WHERE notes LIKE ?").run(`cash_movement_id:${id}`);
  db.prepare('DELETE FROM cash_movements WHERE id=?').run(id);
  res.json({ message: 'Movimentação removida.' });
});

/* ── GET /history — histórico de sessões ───────────────────── */
router.get('/history', requireAuth, requireRole('owner'), (req, res) => {
  const db   = getDb();
  const bsId = getBsId(req);
  const bsF  = bsId ? ' WHERE cs.barbershop_id=?' : '';
  const bsP  = bsId ? [bsId] : [];
  const rows = db.prepare(`
    SELECT cs.*, u.name AS opened_by_name,
      (SELECT COUNT(*) FROM cash_movements cm WHERE cm.session_id=cs.id) AS movements_count
    FROM cash_sessions cs LEFT JOIN users u ON u.id=cs.opened_by
    ${bsF} ORDER BY cs.opened_at DESC LIMIT 30
  `).all(...bsP);
  res.json(rows);
});

module.exports = router;
