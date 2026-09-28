'use strict';
// Cargas. No MVP são cadastradas manualmente (ou via API de integração).
// INTEGRAÇÃO FUTURA: o TMS/ERP enviará as cargas para POST /api/integration/loads.
const express = require('express');
const { getDb } = require('../db');
const clock = require('../utils/clock');
const audit = require('../services/audit');
const ops = require('../services/operations');
const { validate, toInt } = require('../utils/validate');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const SCHEMA = {
  load_number: { type: 'string', required: true, max: 30, label: 'Número da carga' },
  weight_kg: { type: 'number', required: true, min: 0, max: 100000, label: 'Peso (kg)' },
  volumes: { type: 'int', required: true, min: 0, max: 100000, label: 'Volumes' },
  checker_id: { type: 'int', min: 1, label: 'Conferente' },
  square_id: { type: 'int', min: 1, label: 'Praça' },
  load_date: { type: 'date', required: true, label: 'Data' },
  status: { type: 'enum', values: ['ABERTA', 'CONCLUIDA', 'CANCELADA'], label: 'Status' },
  notes: { type: 'string', max: 500, label: 'Observações' },
};

const SELECT = `SELECT l.*, c.name AS checker_name, s.code AS square_code, s.name AS square_name,
   (SELECT COUNT(DISTINCT p.helper_id) FROM activity_participants p JOIN activities a ON a.id=p.activity_id
     WHERE a.load_id=l.id AND p.status<>'CANCELADO') AS helpers_count,
   (SELECT COUNT(*) FROM activity_participants p JOIN activities a ON a.id=p.activity_id
     WHERE a.load_id=l.id AND p.status='ATIVO') AS active_count
  FROM loads l LEFT JOIN checkers c ON c.id=l.checker_id LEFT JOIN squares s ON s.id=l.square_id`;

function prepare(d, before) {
  if (d.load_number) {
    d.load_number = d.load_number.toUpperCase();
    if (!/^[A-Z0-9./-]{1,30}$/.test(d.load_number)) throw badRequest('Número da carga inválido (letras, números, ".", "/" ou "-").');
  }
  if (d.checker_id && !getDb().prepare('SELECT 1 FROM checkers WHERE id=?').get(d.checker_id)) throw badRequest('Conferente inexistente.');
  if (d.square_id && !getDb().prepare('SELECT 1 FROM squares WHERE id=?').get(d.square_id)) throw badRequest('Praça inexistente.');
  if (before && ('weight_kg' in d || 'volumes' in d)) {
    const acts = getDb().prepare(`SELECT COUNT(*) c FROM activities WHERE load_id=? AND status<>'CANCELADA'`).get(before.id).c;
    if (acts && ((d.weight_kg ?? before.weight_kg) !== before.weight_kg || (d.volumes ?? before.volumes) !== before.volumes)) {
      if (!d._reason) throw badRequest('Esta carga já possui atividades. Informe o motivo da alteração de peso/volumes (campo "reason").');
    }
  }
  delete d._reason;
  return d;
}

router.get('/', requireRole('ADMIN', 'GESTOR', 'OPERADOR'), (req, res) => {
  const w = []; const p = [];
  const { q, status, date_from, date_to } = req.query;
  if (q) { w.push('l.load_number LIKE ?'); p.push(`%${String(q).toUpperCase()}%`); }
  if (['ABERTA', 'CONCLUIDA', 'CANCELADA'].includes(status)) { w.push('l.status=?'); p.push(status); }
  if (date_from) { w.push('l.load_date>=?'); p.push(date_from); }
  if (date_to) { w.push('l.load_date<=?'); p.push(date_to); }
  res.json(getDb().prepare(`${SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY l.load_date DESC, l.load_number LIMIT 500`).all(...p));
});

/** Busca a carga pelo número (usado na leitura/digitação no apontamento). */
router.get('/by-number/:number', requireRole('ADMIN', 'GESTOR', 'OPERADOR'), (req, res) => {
  const row = getDb().prepare(`${SELECT} WHERE l.load_number=?`).get(String(req.params.number).trim().toUpperCase());
  if (!row) throw notFound(`Carga ${req.params.number} não encontrada.`);
  res.json(row);
});

router.get('/:id', requireRole('ADMIN', 'GESTOR', 'OPERADOR'), (req, res) => {
  const row = getDb().prepare(`${SELECT} WHERE l.id=?`).get(toInt(req.params.id));
  if (!row) throw notFound('Carga não encontrada.');
  res.json(row);
});

/** Detalhe operacional: execuções, participantes e rateio (prévia se em andamento). */
router.get('/:id/activities', requireRole('ADMIN', 'GESTOR', 'OPERADOR'), (req, res) => {
  const id = toInt(req.params.id);
  if (!getDb().prepare('SELECT 1 FROM loads WHERE id=?').get(id)) throw notFound('Carga não encontrada.');
  res.json(ops.activitiesOfLoad(id));
});

router.post('/', requireRole('ADMIN', 'GESTOR'), (req, res) => {
  const d = prepare(validate(req.body, SCHEMA), null);
  d.status = d.status || 'ABERTA';
  const ts = clock.now();
  const cols = Object.keys(d);
  const r = getDb().prepare(`INSERT INTO loads (${cols.join(',')}, source, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, 'MANUAL', ?, ?)`)
    .run(...cols.map(c => d[c]), ts, ts);
  const row = getDb().prepare(`${SELECT} WHERE l.id=?`).get(Number(r.lastInsertRowid));
  audit.log({ req, action: 'CRIAR', entity: 'loads', entityId: row.id, after: row });
  res.status(201).json(row);
});

function update(req, res) {
  const id = toInt(req.params.id);
  const before = getDb().prepare('SELECT * FROM loads WHERE id=?').get(id);
  if (!before) throw notFound('Carga não encontrada.');
  const d = validate(req.body, SCHEMA, { partial: true });
  for (const k of ['load_number', 'weight_kg', 'volumes', 'load_date', 'status']) if (k in d && d[k] === null) throw badRequest(`${SCHEMA[k].label} é obrigatório.`);
  d._reason = req.body?.reason;
  prepare(d, before);
  if (d.status && d.status !== 'ABERTA') {
    const open = getDb().prepare(`SELECT COUNT(*) c FROM activities WHERE load_id=? AND status='EM_ANDAMENTO'`).get(id).c;
    if (open) throw conflict('Existem atividades em andamento nesta carga. Finalize-as antes.', null, 'EM_ANDAMENTO');
  }
  const cols = Object.keys(d);
  if (cols.length) getDb().prepare(`UPDATE loads SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=? WHERE id=?`).run(...cols.map(c => d[c]), clock.now(), id);
  const after = getDb().prepare('SELECT * FROM loads WHERE id=?').get(id);
  audit.log({ req, action: 'EDITAR', entity: 'loads', entityId: id, before, after, reason: req.body?.reason });
  // Observação: alterar o peso da carga NÃO altera o peso de referência de atividades já registradas
  // (histórico estável). Para refletir, o gestor usa "Recalcular" com motivo.
  res.json(getDb().prepare(`${SELECT} WHERE l.id=?`).get(id));
}
router.put('/:id', requireRole('ADMIN', 'GESTOR'), update);
router.patch('/:id', requireRole('ADMIN', 'GESTOR'), update);

router.delete('/:id', requireRole('ADMIN', 'GESTOR'), (req, res) => {
  const id = toInt(req.params.id);
  const before = getDb().prepare('SELECT * FROM loads WHERE id=?').get(id);
  if (!before) throw notFound('Carga não encontrada.');
  const used = getDb().prepare('SELECT COUNT(*) c FROM activities WHERE load_id=?').get(id).c;
  if (used) throw conflict('Carga possui atividades registradas. Altere o status para CANCELADA em vez de excluir.', null, 'EM_USO');
  getDb().prepare('DELETE FROM loads WHERE id=?').run(id);
  audit.log({ req, action: 'EXCLUIR', entity: 'loads', entityId: id, before });
  res.status(204).end();
});

module.exports = router;
