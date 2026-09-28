'use strict';
/**
 * Consultas de produtividade. Base: activity_allocations (crédito por ajudante por execução FINALIZADA).
 *
 * Separação obrigatória de conceitos:
 *  - Peso das CARGAS (físico, sem duplicar): soma do peso de cada carga distinta movimentada.
 *  - Peso ATRIBUÍDO (produtividade): soma dos créditos do rateio. Uma carga que passa por
 *    carregamento + arrumação + praça gera crédito em cada atividade — por isso o peso atribuído
 *    pode ser MAIOR que o peso físico. Os dois números são exibidos lado a lado.
 */
const { getDb } = require('../db');
const clock = require('../utils/clock');
const { badRequest } = require('../utils/errors');
const { toInt } = require('../utils/validate');
const { MIN_SECONDS_FOR_RATE } = require('../config');

const BASE = `
  SELECT al.id AS allocation_id, al.activity_id, al.helper_id, al.participants_count, al.share,
         al.allocated_weight_kg, al.allocated_volumes, al.worked_seconds, al.method,
         a.load_id, a.activity_type_id, a.square_id, a.started_at, a.ended_at,
         a.reference_weight_kg, a.reference_volumes, a.notes AS activity_notes,
         l.load_number, l.weight_kg AS load_weight_kg, l.volumes AS load_volumes, l.checker_id,
         h.name AS helper_name, h.barcode AS helper_barcode, h.registration AS helper_registration,
         t.name AS activity_type_name, t.color AS activity_type_color,
         s.code AS square_code, s.name AS square_name, c.name AS checker_name,
         (SELECT MIN(p.joined_at) FROM activity_participants p WHERE p.activity_id=al.activity_id AND p.helper_id=al.helper_id AND p.status='FINALIZADO') AS helper_start,
         (SELECT MAX(p.left_at)   FROM activity_participants p WHERE p.activity_id=al.activity_id AND p.helper_id=al.helper_id AND p.status='FINALIZADO') AS helper_end,
         (SELECT p.shift_id FROM activity_participants p WHERE p.activity_id=al.activity_id AND p.helper_id=al.helper_id AND p.status='FINALIZADO' ORDER BY p.joined_at LIMIT 1) AS shift_id,
         (SELECT p.team_id  FROM activity_participants p WHERE p.activity_id=al.activity_id AND p.helper_id=al.helper_id AND p.status='FINALIZADO' ORDER BY p.joined_at LIMIT 1) AS team_id
    FROM activity_allocations al
    JOIN activities a     ON a.id = al.activity_id AND a.status = 'FINALIZADA'
    JOIN loads l          ON l.id = a.load_id
    JOIN helpers h        ON h.id = al.helper_id
    JOIN activity_types t ON t.id = a.activity_type_id
    LEFT JOIN squares s   ON s.id = a.square_id
    LEFT JOIN checkers c  ON c.id = l.checker_id`;

/** Normaliza filtros vindos da query string. Padrão: hoje. */
function parseFilters(q = {}) {
  const today = clock.today();
  const f = {
    date_from: q.date_from || today,
    date_to: q.date_to || q.date_from || today,
    helper_id: toInt(q.helper_id, null),
    team_id: toInt(q.team_id, null),
    shift_id: toInt(q.shift_id, null),
    activity_type_id: toInt(q.activity_type_id, null),
    square_id: toInt(q.square_id, null),
    checker_id: toInt(q.checker_id, null),
    load_id: toInt(q.load_id, null),
    q: q.q ? String(q.q).trim().slice(0, 60) : null,
  };
  if (!clock.isValidDate(f.date_from) || !clock.isValidDate(f.date_to)) throw badRequest('Período inválido (use AAAA-MM-DD).');
  if (f.date_to < f.date_from) throw badRequest('A data final deve ser maior ou igual à inicial.');
  const days = clock.diffSeconds(f.date_from + ' 00:00:00', f.date_to + ' 00:00:00') / 86400;
  if (days > 366) throw badRequest('Período máximo de consulta: 366 dias.');
  return f;
}

/** Monta o WHERE sobre a BASE. Datas filtram pelo início da execução. */
function where(f) {
  const w = ['started_at >= ?', 'started_at < ?'];
  const p = [f.date_from + ' 00:00:00', clock.addDays(f.date_to, 1) + ' 00:00:00'];
  const eq = { helper_id: 'helper_id', team_id: 'team_id', shift_id: 'shift_id', activity_type_id: 'activity_type_id', square_id: 'square_id', checker_id: 'checker_id', load_id: 'load_id' };
  for (const [k, col] of Object.entries(eq)) if (f[k]) { w.push(`${col} = ?`); p.push(f[k]); }
  if (f.q) {
    w.push('(helper_name LIKE ? OR helper_barcode = ? OR load_number LIKE ?)');
    p.push(`%${f.q}%`, f.q.toUpperCase(), `%${f.q}%`);
  }
  return { sql: w.join(' AND '), params: p };
}

function filtered(f) {
  const { sql, params } = where(f);
  return { sql: `SELECT * FROM (${BASE}) b WHERE ${sql}`, params };
}

// Taxas por hora só com tempo mínimo apontado (evita kg/h distorcido por apontamentos de segundos).
const rate = (v, secs) => (secs >= MIN_SECONDS_FOR_RATE ? Math.round((v / (secs / 3600)) * 100) / 100 : null);
const r2 = v => Math.round((v || 0) * 100) / 100;

function helperStats(f) {
  const { sql, params } = filtered(f);
  const rows = getDb().prepare(`
    SELECT helper_id, helper_name, helper_barcode,
           SUM(allocated_weight_kg) AS kg, SUM(allocated_volumes) AS volumes,
           COUNT(DISTINCT load_id) AS loads, COUNT(DISTINCT activity_id) AS activities,
           SUM(worked_seconds) AS seconds
      FROM (${sql}) x GROUP BY helper_id ORDER BY kg DESC`).all(...params);
  return rows.map(r => ({
    ...r, kg: r2(r.kg), volumes: r2(r.volumes),
    kg_per_hour: rate(r.kg, r.seconds), volumes_per_hour: rate(r.volumes, r.seconds),
  }));
}

const RANK_METRICS = {
  kg: 'Kg atribuídos', volumes: 'Volumes atribuídos', loads: 'Cargas', activities: 'Atividades',
  kg_per_hour: 'Kg/hora', volumes_per_hour: 'Volumes/hora', seconds: 'Tempo em atividade',
};

function ranking(f, metric = 'kg') {
  if (!RANK_METRICS[metric]) throw badRequest('Indicador de ranking inválido.');
  return helperStats(f)
    .sort((a, b) => (b[metric] ?? -1) - (a[metric] ?? -1))
    .map((r, i) => ({ position: i + 1, ...r }));
}

function dashboard(f) {
  const db = getDb();
  const { sql, params } = filtered(f);

  const totals = db.prepare(`
    SELECT COUNT(DISTINCT activity_id) AS activities, COUNT(DISTINCT load_id) AS loads,
           COUNT(DISTINCT helper_id) AS helpers_with_activity,
           COALESCE(SUM(allocated_weight_kg),0) AS allocated_kg, COALESCE(SUM(allocated_volumes),0) AS allocated_volumes,
           COALESCE(SUM(worked_seconds),0) AS seconds
      FROM (${sql}) x`).get(...params);
  const physical = db.prepare(`SELECT COALESCE(SUM(weight_kg),0) AS kg, COALESCE(SUM(volumes),0) AS volumes
      FROM loads WHERE id IN (SELECT load_id FROM (${sql}) x)`).get(...params);

  const hw = ["status='ATIVO'"]; const hp = [];
  if (f.team_id) { hw.push('team_id=?'); hp.push(f.team_id); }
  if (f.shift_id) { hw.push('shift_id=?'); hp.push(f.shift_id); }
  const activeHelpers = db.prepare(`SELECT COUNT(*) c FROM helpers WHERE ${hw.join(' AND ')}`).get(...hp).c;
  const inProgress = db.prepare(`SELECT COUNT(*) c FROM activity_participants WHERE status='ATIVO'`).get().c;

  const byType = db.prepare(`SELECT activity_type_id AS id, activity_type_name AS name, activity_type_color AS color,
      COUNT(DISTINCT activity_id) AS activities, COUNT(DISTINCT load_id) AS loads, COUNT(DISTINCT helper_id) AS helpers,
      SUM(allocated_weight_kg) AS kg, SUM(allocated_volumes) AS volumes, SUM(worked_seconds) AS seconds
      FROM (${sql}) x GROUP BY activity_type_id ORDER BY kg DESC`).all(...params)
    .map(r => ({ ...r, kg: r2(r.kg), volumes: r2(r.volumes), kg_per_hour: rate(r.kg, r.seconds) }));

  const bySquare = db.prepare(`SELECT square_id AS id, square_code AS code, square_name AS name,
      COUNT(DISTINCT activity_id) AS activities, COUNT(DISTINCT load_id) AS loads,
      SUM(allocated_weight_kg) AS kg, SUM(allocated_volumes) AS volumes, SUM(worked_seconds) AS seconds
      FROM (${sql}) x WHERE square_id IS NOT NULL GROUP BY square_id ORDER BY kg DESC`).all(...params)
    .map(r => ({ ...r, kg: r2(r.kg), volumes: r2(r.volumes) }));

  const byHour = db.prepare(`SELECT substr(started_at,12,2) AS hour, SUM(allocated_weight_kg) AS kg, SUM(allocated_volumes) AS volumes
      FROM (${sql}) x GROUP BY hour ORDER BY hour`).all(...params).map(r => ({ ...r, kg: r2(r.kg), volumes: r2(r.volumes) }));

  const byDay = db.prepare(`SELECT substr(started_at,1,10) AS day, SUM(allocated_weight_kg) AS kg, SUM(allocated_volumes) AS volumes,
      COUNT(DISTINCT load_id) AS loads FROM (${sql}) x GROUP BY day ORDER BY day`).all(...params)
    .map(r => ({ ...r, kg: r2(r.kg), volumes: r2(r.volumes) }));

  // Matriz ajudante x atividade: responde "quantas cargas ele ajudou a carregar / arrumar / levar à praça".
  const helperType = db.prepare(`SELECT helper_id, activity_type_id, activity_type_name AS type_name,
      COUNT(DISTINCT load_id) AS loads, SUM(allocated_weight_kg) AS kg, SUM(allocated_volumes) AS volumes, SUM(worked_seconds) AS seconds
      FROM (${sql}) x GROUP BY helper_id, activity_type_id`).all(...params)
    .map(r => ({ ...r, kg: r2(r.kg), volumes: r2(r.volumes) }));

  return {
    filters: f,
    totals: {
      active_helpers: activeHelpers,
      helpers_with_activity: totals.helpers_with_activity,
      loads: totals.loads,
      physical_kg: r2(physical.kg),
      physical_volumes: physical.volumes,
      allocated_kg: r2(totals.allocated_kg),
      allocated_volumes: r2(totals.allocated_volumes),
      activities: totals.activities,
      seconds: totals.seconds,
      kg_per_hour: rate(totals.allocated_kg, totals.seconds),
      volumes_per_hour: rate(totals.allocated_volumes, totals.seconds),
      in_progress_now: inProgress,
    },
    helpers: helperStats(f),
    by_type: byType,
    by_square: bySquare,
    by_hour: byHour,
    by_day: byDay,
    helper_type: helperType,
  };
}

/** Relatório individual: 1 linha por ajudante por execução. */
function individualRows(f) {
  const { sql, params } = filtered(f);
  return getDb().prepare(`${sql} ORDER BY started_at, helper_name`).all(...params).map(r => ({
    date: r.helper_start ? r.helper_start.slice(0, 10) : r.started_at.slice(0, 10),
    helper_name: r.helper_name,
    helper_barcode: r.helper_barcode,
    load_number: r.load_number,
    activity: r.activity_type_name,
    square: r.square_code ? `${r.square_code} - ${r.square_name}` : '',
    load_weight_kg: r.load_weight_kg,
    reference_weight_kg: r.reference_weight_kg,
    load_volumes: r.load_volumes,
    reference_volumes: r.reference_volumes,
    start: r.helper_start ? r.helper_start.slice(11, 16) : '',
    end: r.helper_end ? r.helper_end.slice(11, 16) : '',
    duration_seconds: r.worked_seconds,
    participants_count: r.participants_count,
    method: r.method,
    allocated_weight_kg: r.allocated_weight_kg,
    allocated_volumes: r.allocated_volumes,
    checker: r.checker_name || '',
    notes: r.activity_notes || '',
  }));
}

/** Histórico de apontamentos (segmentos), incluindo em andamento e cancelados. */
function history(q = {}) {
  const f = parseFilters(q);
  const page = Math.max(1, toInt(q.page, 1));
  const pageSize = Math.min(200, Math.max(10, toInt(q.page_size, 50)));
  const w = ['p.joined_at >= ?', 'p.joined_at < ?'];
  const params = [f.date_from + ' 00:00:00', clock.addDays(f.date_to, 1) + ' 00:00:00'];
  const map = { helper_id: 'p.helper_id', team_id: 'p.team_id', shift_id: 'p.shift_id', activity_type_id: 'a.activity_type_id', square_id: 'a.square_id', checker_id: 'l.checker_id', load_id: 'a.load_id' };
  for (const [k, col] of Object.entries(map)) if (f[k]) { w.push(`${col} = ?`); params.push(f[k]); }
  if (q.status && ['ATIVO', 'FINALIZADO', 'CANCELADO'].includes(q.status)) { w.push('p.status = ?'); params.push(q.status); }
  if (f.q) { w.push('(h.name LIKE ? OR h.barcode = ? OR l.load_number LIKE ?)'); params.push(`%${f.q}%`, f.q.toUpperCase(), `%${f.q}%`); }
  const from = `FROM activity_participants p
      JOIN helpers h ON h.id=p.helper_id JOIN activities a ON a.id=p.activity_id
      JOIN activity_types t ON t.id=a.activity_type_id JOIN loads l ON l.id=a.load_id
      LEFT JOIN squares s ON s.id=a.square_id LEFT JOIN checkers c ON c.id=l.checker_id
      LEFT JOIN activity_allocations al ON al.activity_id=p.activity_id AND al.helper_id=p.helper_id
      LEFT JOIN users u ON u.id=p.started_by
      WHERE ${w.join(' AND ')}`;
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) c ${from}`).get(...params).c;
  const rows = db.prepare(`SELECT p.id, p.activity_id, p.joined_at, p.left_at, p.duration_seconds, p.status, p.cancel_reason,
      h.id AS helper_id, h.name AS helper_name, h.barcode AS helper_barcode,
      l.id AS load_id, l.load_number, l.weight_kg AS load_weight_kg, l.volumes AS load_volumes,
      t.name AS activity_type_name, t.color AS activity_type_color, a.status AS activity_status,
      a.reference_weight_kg, a.reference_volumes,
      s.code AS square_code, s.name AS square_name, c.name AS checker_name, u.name AS started_by_name,
      al.allocated_weight_kg, al.allocated_volumes, al.participants_count
      ${from} ORDER BY p.joined_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return { total, page, page_size: pageSize, rows };
}

module.exports = { parseFilters, dashboard, ranking, helperStats, individualRows, history, RANK_METRICS };
