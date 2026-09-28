'use strict';
// Registro de auditoria (tabela somente-inserção protegida por trigger).
const { getDb } = require('../db');
const clock = require('../utils/clock');

const SENSITIVE = new Set(['password', 'password_hash', 'token_version', 'failed_attempts', 'locked_until']);

function clean(obj) {
  if (!obj) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!SENSITIVE.has(k)) out[k] = v;
  return out;
}

// Normaliza para comparação (objetos do node:sqlite não têm protótipo => usar JSON).
const norm = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

/** Guarda apenas os campos que mudaram (valor anterior x novo valor). */
function diff(before, after) {
  const b = clean(before) || {};
  const a = clean(after) || {};
  const oldV = {}, newV = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (k === 'updated_at' || k === 'created_at') continue;
    if (norm(b[k]) !== norm(a[k])) { oldV[k] = b[k] ?? null; newV[k] = a[k] ?? null; }
  }
  return { oldV, newV, changed: Object.keys(newV).length > 0 };
}

function log({ req, user, action, entity, entityId, before, after, reason }) {
  const u = user || req?.user || null;
  let oldValues = clean(before), newValues = clean(after);
  if (before && after) {
    const d = diff(before, after);
    if (!d.changed && !reason) return; // nada mudou
    oldValues = d.oldV; newValues = d.newV;
  }
  getDb().prepare(`INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,old_values,new_values,reason,ip,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    u?.id ?? null, u?.name ?? null, action, entity, entityId ?? null,
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    reason ?? null, req?.ip ?? null, clock.now());
}

module.exports = { log, diff };
