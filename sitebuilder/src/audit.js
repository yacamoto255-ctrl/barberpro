// src/audit.js — trilha de auditoria (login, alterações, exclusões)
'use strict';

const { getDb } = require('./db');
const { clientIp } = require('./rateLimit');

function audit(req, action, entity = null, entityId = null, details = null) {
  try {
    getDb().prepare(
      `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req?.user?.id ?? null,
      req?.user?.email ?? null,
      action,
      entity,
      entityId ?? null,
      details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 4000),
      req ? clientIp(req) : null,
    );
  } catch (e) {
    // Auditoria nunca derruba a requisição, mas o erro fica no log do servidor
    console.error('[audit] falha ao registrar:', e.message);
  }
}

module.exports = { audit };
