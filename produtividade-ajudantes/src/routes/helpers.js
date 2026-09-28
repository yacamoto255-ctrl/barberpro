'use strict';
// Cadastro de ajudantes. O código de barras identifica EXCLUSIVAMENTE o ajudante.
const express = require('express');
const { getDb } = require('../db');
const clock = require('../utils/clock');
const audit = require('../services/audit');
const { validate, isCpfValid, normalizeBarcode, BARCODE_RE, toInt } = require('../utils/validate');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const SCHEMA = {
  barcode: { type: 'string', required: true, max: 32, label: 'Código de barras' },
  registration: { type: 'string', max: 30, label: 'Matrícula' },
  name: { type: 'string', required: true, max: 100, label: 'Nome' },
  cpf: { type: 'string', max: 14, label: 'CPF' },
  sector: { type: 'string', max: 60, label: 'Setor' },
  shift_id: { type: 'int', min: 1, label: 'Turno' },
  team_id: { type: 'int', min: 1, label: 'Equipe' },
  status: { type: 'enum', values: ['ATIVO', 'INATIVO'], label: 'Status' },
  admission_date: { type: 'date', label: 'Data de admissão' },
  notes: { type: 'string', max: 500, label: 'Observações' },
  external_id: { type: 'string', max: 60, label: 'ID externo' },
};

const SELECT = `SELECT h.*, s.name AS shift_name, t.name AS team_name FROM helpers h
  LEFT JOIN shifts s ON s.id=h.shift_id LEFT JOIN teams t ON t.id=h.team_id`;

function prepare(d, before) {
  if ('barcode' in d && d.barcode !== null) {
    d.barcode = normalizeBarcode(d.barcode);
    if (!BARCODE_RE.test(d.barcode)) throw badRequest('Código de barras inválido: use apenas letras, números e hífen (até 32).');
    const dup = getDb().prepare('SELECT id, name FROM helpers WHERE barcode=? AND id<>?').get(d.barcode, before?.id || 0);
    if (dup) throw conflict(`O código ${d.barcode} já pertence a ${dup.name}. Cada código é único por ajudante.`, null, 'CODIGO_DUPLICADO');
  }
  if (d.name !== undefined && d.name !== null) {
    d.name = d.name.replace(/\s+/g, ' ');
    if (d.name.length < 2) throw badRequest('Nome deve ter pelo menos 2 caracteres.');
  }
  if (d.cpf) {
    const digits = d.cpf.replace(/\D/g, '');
    if (!isCpfValid(digits)) throw badRequest('CPF inválido.');
    const dup = getDb().prepare('SELECT id FROM helpers WHERE cpf=? AND id<>?').get(digits, before?.id || 0);
    if (dup) throw conflict('CPF já cadastrado para outro ajudante.', null, 'CPF_DUPLICADO');
    d.cpf = digits;
  }
  if (d.registration) {
    const dup = getDb().prepare('SELECT id FROM helpers WHERE registration=? AND id<>?').get(d.registration, before?.id || 0);
    if (dup) throw conflict('Matrícula já cadastrada para outro ajudante.', null, 'MATRICULA_DUPLICADA');
  }
  if (d.admission_date && d.admission_date > clock.today()) throw badRequest('Data de admissão não pode ser futura.');
  if (d.shift_id && !getDb().prepare('SELECT 1 FROM shifts WHERE id=?').get(d.shift_id)) throw badRequest('Turno inexistente.');
  if (d.team_id && !getDb().prepare('SELECT 1 FROM teams WHERE id=?').get(d.team_id)) throw badRequest('Equipe inexistente.');
  return d;
}

router.get('/', requireRole('ADMIN', 'GESTOR', 'OPERADOR'), (req, res) => {
  const w = []; const p = [];
  const { q, status, shift_id, team_id, sector } = req.query;
  if (q) { w.push('(h.name LIKE ? OR h.barcode = ? OR h.registration = ?)'); p.push(`%${q}%`, normalizeBarcode(q), String(q)); }
  if (status === 'ATIVO' || status === 'INATIVO') { w.push('h.status=?'); p.push(status); }
  if (toInt(shift_id)) { w.push('h.shift_id=?'); p.push(toInt(shift_id)); }
  if (toInt(team_id)) { w.push('h.team_id=?'); p.push(toInt(team_id)); }
  if (sector) { w.push('h.sector=?'); p.push(String(sector)); }
  let rows = getDb().prepare(`${SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY h.name LIMIT 2000`).all(...p);
  // Operador vê só o necessário para o apontamento (sem CPF/observações).
  if (req.user.role === 'OPERADOR') rows = rows.map(({ id, barcode, name, status, shift_name, team_name }) => ({ id, barcode, name, status, shift_name, team_name }));
  res.json(rows);
});

/** Sugere o próximo código numérico livre (ex.: 011) para "gerar código". */
router.get('/next-code', requireRole('ADMIN', 'GESTOR'), (req, res) => {
  const codes = getDb().prepare(`SELECT barcode FROM helpers WHERE barcode GLOB '[0-9]*'`).all()
    .map(r => r.barcode).filter(c => /^\d+$/.test(c));
  const max = codes.reduce((m, c) => Math.max(m, Number(c)), 0);
  const width = Math.max(3, ...codes.map(c => c.length));
  res.json({ code: String(max + 1).padStart(width, '0') });
});

router.get('/sectors', requireRole('ADMIN', 'GESTOR'), (req, res) => {
  res.json(getDb().prepare(`SELECT DISTINCT sector FROM helpers WHERE sector IS NOT NULL AND sector<>'' ORDER BY sector`).all().map(r => r.sector));
});

router.get('/:id', requireRole('ADMIN', 'GESTOR'), (req, res) => {
  const row = getDb().prepare(`${SELECT} WHERE h.id=?`).get(toInt(req.params.id));
  if (!row) throw notFound('Ajudante não encontrado.');
  res.json(row);
});

router.post('/', requireRole('ADMIN', 'GESTOR'), (req, res) => {
  const d = prepare(validate(req.body, SCHEMA), null);
  if (!d.status) d.status = 'ATIVO';
  const ts = clock.now();
  const cols = Object.keys(d);
  const r = getDb().prepare(`INSERT INTO helpers (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')},?,?)`)
    .run(...cols.map(c => d[c]), ts, ts);
  const row = getDb().prepare(`${SELECT} WHERE h.id=?`).get(Number(r.lastInsertRowid));
  audit.log({ req, action: 'CRIAR', entity: 'helpers', entityId: row.id, after: row });
  res.status(201).json(row);
});

function update(req, res) {
  const id = toInt(req.params.id);
  const before = getDb().prepare('SELECT * FROM helpers WHERE id=?').get(id);
  if (!before) throw notFound('Ajudante não encontrado.');
  const d = prepare(validate(req.body, SCHEMA, { partial: true }), before);
  for (const k of ['barcode', 'name']) if (k in d && !d[k]) throw badRequest(`${SCHEMA[k].label} é obrigatório.`);
  if ('status' in d && !d.status) delete d.status;
  if (d.status === 'INATIVO') {
    const open = getDb().prepare(`SELECT COUNT(*) c FROM activity_participants WHERE helper_id=? AND status='ATIVO'`).get(id).c;
    if (open) throw conflict('Ajudante está com atividade em andamento. Finalize antes de inativar.', null, 'EM_ATIVIDADE');
  }
  const cols = Object.keys(d);
  if (cols.length) {
    getDb().prepare(`UPDATE helpers SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=? WHERE id=?`).run(...cols.map(c => d[c]), clock.now(), id);
  }
  const after = getDb().prepare('SELECT * FROM helpers WHERE id=?').get(id);
  const action = before.status !== after.status ? (after.status === 'ATIVO' ? 'ATIVAR' : 'INATIVAR') : 'EDITAR';
  audit.log({ req, action, entity: 'helpers', entityId: id, before, after, reason: req.body?.reason });
  res.json(getDb().prepare(`${SELECT} WHERE h.id=?`).get(id));
}
router.put('/:id', requireRole('ADMIN', 'GESTOR'), update);
router.patch('/:id', requireRole('ADMIN', 'GESTOR'), update);

/** Exclusão física apenas para cadastro sem nenhum apontamento (ex.: cadastrado por engano). */
router.delete('/:id', requireRole('ADMIN'), (req, res) => {
  const id = toInt(req.params.id);
  const before = getDb().prepare('SELECT * FROM helpers WHERE id=?').get(id);
  if (!before) throw notFound('Ajudante não encontrado.');
  const used = getDb().prepare('SELECT COUNT(*) c FROM activity_participants WHERE helper_id=?').get(id).c;
  if (used) throw conflict('Ajudante possui apontamentos e não pode ser excluído. Use INATIVAR para preservar o histórico.', null, 'EM_USO');
  getDb().prepare('DELETE FROM helpers WHERE id=?').run(id);
  audit.log({ req, action: 'EXCLUIR', entity: 'helpers', entityId: id, before });
  res.status(204).end();
});

module.exports = router;
