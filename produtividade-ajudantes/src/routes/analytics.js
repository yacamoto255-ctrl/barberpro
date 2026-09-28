'use strict';
// Dashboard, ranking, relatórios exportáveis, histórico e auditoria.
const express = require('express');
const prod = require('../services/productivity');
const { toCsv, toXlsx } = require('../services/exporter');
const { getDb } = require('../db');
const clock = require('../utils/clock');
const { requireRole } = require('../middleware/auth');
const { toInt } = require('../utils/validate');
const { badRequest } = require('../utils/errors');

const router = express.Router();
const MGMT = requireRole('ADMIN', 'GESTOR');

router.get('/dashboard', MGMT, (req, res) => res.json(prod.dashboard(prod.parseFilters(req.query))));

router.get('/dashboard/ranking', MGMT, (req, res) => {
  const metric = req.query.metric || 'kg';
  res.json({ metric, label: prod.RANK_METRICS[metric], rows: prod.ranking(prod.parseFilters(req.query), metric) });
});

router.get('/history', requireRole('ADMIN', 'GESTOR', 'OPERADOR'), (req, res) => {
  // Operador consulta apenas o dia atual (conferência do próprio turno).
  if (req.user.role === 'OPERADOR') { req.query.date_from = clock.today(); req.query.date_to = clock.today(); }
  res.json(prod.history(req.query));
});

const hms = s => {
  if (s === null || s === undefined) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const INDIVIDUAL_COLS = [
  { key: 'date', header: 'Data', width: 12 },
  { key: 'helper_name', header: 'Ajudante', width: 24 },
  { key: 'helper_barcode', header: 'Código', width: 10 },
  { key: 'load_number', header: 'Carga', width: 12 },
  { key: 'activity', header: 'Atividade', width: 24 },
  { key: 'square', header: 'Praça', width: 18 },
  { key: 'load_weight_kg', header: 'Peso da carga (kg)', decimals: 2, width: 16 },
  { key: 'reference_weight_kg', header: 'Peso de referência (kg)', decimals: 2, width: 18 },
  { key: 'load_volumes', header: 'Volumes da carga', decimals: 0, width: 14 },
  { key: 'reference_volumes', header: 'Volumes de referência', decimals: 0, width: 16 },
  { key: 'start', header: 'Hora inicial', width: 11 },
  { key: 'end', header: 'Hora final', width: 11 },
  { key: 'duration', header: 'Duração (hh:mm)', width: 13 },
  { key: 'participants_count', header: 'Nº ajudantes na atividade', decimals: 0, width: 18 },
  { key: 'method', header: 'Regra de rateio', width: 20 },
  { key: 'allocated_weight_kg', header: 'Peso atribuído (kg)', decimals: 2, width: 16 },
  { key: 'allocated_volumes', header: 'Volumes atribuídos', decimals: 2, width: 16 },
  { key: 'checker', header: 'Conferente', width: 20 },
  { key: 'notes', header: 'Observação', width: 30 },
];

const CONSOLIDATED_COLS = [
  { key: 'helper_name', header: 'Ajudante', width: 24 },
  { key: 'helper_barcode', header: 'Código', width: 10 },
  { key: 'loads', header: 'Total de cargas', decimals: 0 },
  { key: 'volumes', header: 'Total de volumes (atribuídos)', decimals: 2, width: 22 },
  { key: 'kg', header: 'Total de kg (atribuídos)', decimals: 2, width: 20 },
  { key: 'activities', header: 'Total de atividades', decimals: 0, width: 16 },
  { key: 'time', header: 'Tempo total (hh:mm)', width: 16 },
  { key: 'kg_per_hour', header: 'Kg/hora', decimals: 2 },
  { key: 'volumes_per_hour', header: 'Volumes/hora', decimals: 2 },
];

const NOTE = 'Peso atribuído = peso de referência da atividade rateado entre os ajudantes pela regra vigente. Não representa peso carregado fisicamente por uma pessoa.';

async function sendReport(req, res, kind) {
  const f = prod.parseFilters(req.query);
  const format = req.query.format || 'json';
  let rows, cols, title;
  if (kind === 'individual') {
    rows = prod.individualRows(f).map(r => ({ ...r, duration: hms(r.duration_seconds) }));
    cols = INDIVIDUAL_COLS; title = 'Relatorio individual';
  } else {
    rows = prod.helperStats(f).map(r => ({ ...r, time: hms(r.seconds) }));
    cols = CONSOLIDATED_COLS; title = 'Relatorio consolidado';
  }
  if (format === 'json') return res.json({ filters: f, note: NOTE, rows });
  const fname = `${kind}_${f.date_from}_a_${f.date_to}`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`);
    return res.send(toCsv(cols, rows));
  }
  if (format === 'xlsx') {
    const buf = await toXlsx(title, cols, rows, [`LogiPonto — ${title}`, `Período: ${f.date_from} a ${f.date_to}`, NOTE]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return res.send(Buffer.from(buf));
  }
  throw badRequest('Formato inválido (json, csv ou xlsx).');
}

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.get('/reports/individual', MGMT, wrap((req, res) => sendReport(req, res, 'individual')));
router.get('/reports/consolidated', MGMT, wrap((req, res) => sendReport(req, res, 'consolidated')));

router.get('/audit', MGMT, (req, res) => {
  const w = []; const p = [];
  const { entity, action, user_id, entity_id, date_from, date_to } = req.query;
  if (entity) { w.push('entity=?'); p.push(String(entity)); }
  if (action) { w.push('action=?'); p.push(String(action)); }
  if (toInt(user_id)) { w.push('user_id=?'); p.push(toInt(user_id)); }
  if (toInt(entity_id)) { w.push('entity_id=?'); p.push(toInt(entity_id)); }
  if (date_from && clock.isValidDate(date_from)) { w.push('created_at>=?'); p.push(date_from + ' 00:00:00'); }
  if (date_to && clock.isValidDate(date_to)) { w.push('created_at<?'); p.push(clock.addDays(date_to, 1) + ' 00:00:00'); }
  const page = Math.max(1, toInt(req.query.page, 1));
  const size = Math.min(200, Math.max(10, toInt(req.query.page_size, 50)));
  const whereSql = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${whereSql}`).get(...p).c;
  const rows = db.prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, size, (page - 1) * size);
  res.json({ total, page, page_size: size, rows });
});

module.exports = router;
