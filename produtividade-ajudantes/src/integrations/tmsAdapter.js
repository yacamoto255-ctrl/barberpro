'use strict';
/**
 * PONTO DE INTEGRAÇÃO COM O SISTEMA DA TRANSPORTADORA (TMS/ERP)
 * ---------------------------------------------------------------
 * Hoje as cargas, conferentes e praças são cadastrados manualmente ou vêm de dados de demonstração.
 * Quando a integração for feita, existem dois caminhos (ambos já preparados):
 *
 * 1) PUSH (recomendado): o TMS chama a API deste sistema:
 *      POST /api/integration/loads     (cabeçalho X-API-Key)
 *      POST /api/integration/checkers
 *      POST /api/integration/squares
 *    O registro é identificado por external_id (id no TMS) => reenvio não duplica (upsert idempotente).
 *
 * 2) PULL: este sistema busca periodicamente no TMS. Implemente fetchLoads() abaixo com o
 *    cliente HTTP/banco do TMS e chame upsertLoads() com o resultado (ex.: agendado a cada 5 min).
 *
 * Mapeamento esperado de uma carga:
 *   { external_id, load_number, weight_kg, volumes, load_date (AAAA-MM-DD),
 *     checker_external_id?, square_code?, status? ('ABERTA'|'CONCLUIDA'|'CANCELADA') }
 */
const { getDb, tx } = require('../db');
const clock = require('../utils/clock');
const audit = require('../services/audit');

async function fetchLoads(/* { since } */) {
  // TODO(integração): substituir pela chamada real ao TMS/ERP.
  throw new Error('Integração com o TMS ainda não configurada.');
}

function upsertByExternal(table, row, keyCols) {
  const db = getDb();
  const ts = clock.now();
  const existing = db.prepare(`SELECT * FROM ${table} WHERE external_id=?`).get(row.external_id);
  if (existing) {
    const cols = keyCols.filter(c => row[c] !== undefined);
    db.prepare(`UPDATE ${table} SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=? WHERE id=?`).run(...cols.map(c => row[c]), ts, existing.id);
    const after = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(existing.id);
    audit.log({ user: { id: null, name: 'INTEGRACAO' }, action: 'EDITAR', entity: table, entityId: existing.id, before: existing, after });
    return { id: existing.id, action: 'updated' };
  }
  const cols = ['external_id', ...keyCols.filter(c => row[c] !== undefined)];
  const r = db.prepare(`INSERT INTO ${table} (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')},?,?)`)
    .run(...cols.map(c => row[c]), ts, ts);
  audit.log({ user: { id: null, name: 'INTEGRACAO' }, action: 'CRIAR', entity: table, entityId: Number(r.lastInsertRowid), after: row });
  return { id: Number(r.lastInsertRowid), action: 'created' };
}

function validateLoad(l) {
  const errs = [];
  if (!l || typeof l !== 'object') return ['registro inválido'];
  if (!l.external_id) errs.push('external_id obrigatório');
  if (!l.load_number || !/^[A-Za-z0-9./-]{1,30}$/.test(String(l.load_number))) errs.push('load_number inválido');
  if (!(Number(l.weight_kg) >= 0)) errs.push('weight_kg inválido');
  if (!Number.isInteger(Number(l.volumes)) || Number(l.volumes) < 0) errs.push('volumes inválido');
  if (!clock.isValidDate(l.load_date)) errs.push('load_date inválido');
  if (l.status && !['ABERTA', 'CONCLUIDA', 'CANCELADA'].includes(l.status)) errs.push('status inválido');
  return errs;
}

/** Upsert em lote. Retorna o resultado por item (não aborta o lote inteiro por um item ruim). */
function upsertLoads(items) {
  const db = getDb();
  return items.map((l, i) => {
    const errors = validateLoad(l);
    if (errors.length) return { index: i, external_id: l?.external_id, ok: false, errors };
    try {
      return tx(() => {
        const checker = l.checker_external_id ? db.prepare('SELECT id FROM checkers WHERE external_id=?').get(String(l.checker_external_id)) : null;
        const square = l.square_code ? db.prepare('SELECT id FROM squares WHERE code=?').get(String(l.square_code)) : null;
        const row = {
          external_id: String(l.external_id), load_number: String(l.load_number).toUpperCase(),
          weight_kg: Number(l.weight_kg), volumes: Number(l.volumes), load_date: l.load_date,
          checker_id: checker ? checker.id : undefined, square_id: square ? square.id : undefined,
          status: l.status, source: 'INTEGRACAO',
        };
        const r = upsertByExternal('loads', row, ['load_number', 'weight_kg', 'volumes', 'load_date', 'checker_id', 'square_id', 'status', 'source']);
        return { index: i, external_id: row.external_id, ok: true, ...r };
      });
    } catch (e) {
      return { index: i, external_id: l.external_id, ok: false, errors: [String(e.message).includes('UNIQUE') ? 'load_number já existe com outro external_id' : 'erro ao gravar'] };
    }
  });
}

function upsertSimple(table, items, cols, required) {
  return items.map((it, i) => {
    const missing = ['external_id', ...required].filter(k => !it || it[k] === undefined || it[k] === null || it[k] === '');
    if (missing.length) return { index: i, ok: false, errors: missing.map(m => `${m} obrigatório`) };
    try {
      const row = Object.fromEntries(['external_id', ...cols].filter(c => it[c] !== undefined).map(c => [c, String(it[c])]));
      return { index: i, ok: true, ...tx(() => upsertByExternal(table, row, cols)) };
    } catch (e) {
      return { index: i, ok: false, errors: ['erro ao gravar (valor duplicado?)'] };
    }
  });
}

module.exports = { fetchLoads, upsertLoads, upsertSimple };
