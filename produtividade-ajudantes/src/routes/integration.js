'use strict';
// API de integração máquina-a-máquina (TMS/ERP). Autenticação por chave (X-API-Key).
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const tms = require('../integrations/tmsAdapter');
const prod = require('../services/productivity');
const { getDb } = require('../db');

const router = express.Router();

router.use((req, res, next) => {
  if (!config.INTEGRATION_API_KEY) return res.status(503).json({ error: 'Integração desabilitada (INTEGRATION_API_KEY não configurada).', code: 'DESABILITADA' });
  const got = Buffer.from(String(req.headers['x-api-key'] || ''));
  const exp = Buffer.from(config.INTEGRATION_API_KEY);
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return res.status(401).json({ error: 'Chave de integração inválida.', code: 'CHAVE_INVALIDA' });
  next();
});

const asList = (b) => (Array.isArray(b) ? b : Array.isArray(b?.items) ? b.items : null);
function batch(req, res, fn) {
  const items = asList(req.body);
  if (!items || !items.length) return res.status(400).json({ error: 'Envie uma lista de registros (array ou { items: [] }).' });
  if (items.length > 1000) return res.status(413).json({ error: 'Máximo de 1000 registros por envio.' });
  const results = fn(items);
  const failed = results.filter(r => !r.ok).length;
  res.status(failed ? 207 : 200).json({ received: items.length, failed, results });
}

router.post('/loads', (req, res) => batch(req, res, tms.upsertLoads));
router.post('/checkers', (req, res) => batch(req, res, items => tms.upsertSimple('checkers', items, ['name', 'registration'], ['name'])));
router.post('/squares', (req, res) => batch(req, res, items => tms.upsertSimple('squares', items, ['code', 'name'], ['code', 'name'])));

/** Exporta a produtividade consolidada por ajudante (para o ERP/folha/BI). */
router.get('/productivity', (req, res) => {
  const f = prod.parseFilters(req.query);
  const ext = new Map(getDb().prepare('SELECT id, external_id, registration FROM helpers').all().map(h => [h.id, h]));
  res.json({ filters: f, rows: prod.helperStats(f).map(r => ({ ...r, helper_external_id: ext.get(r.helper_id)?.external_id || null, helper_registration: ext.get(r.helper_id)?.registration || null })) });
});

module.exports = router;
