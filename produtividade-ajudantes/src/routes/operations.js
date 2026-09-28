'use strict';
// Apontamento operacional (chão de operação).
const express = require('express');
const ops = require('../services/operations');
const { requireRole } = require('../middleware/auth');
const { toInt } = require('../utils/validate');
const { badRequest } = require('../utils/errors');

const router = express.Router();
const ALL = requireRole('ADMIN', 'GESTOR', 'OPERADOR');

router.post('/identify', ALL, (req, res) => res.json(ops.identify(req.body?.barcode)));

router.post('/start', ALL, (req, res) => {
  const b = req.body || {};
  if (!b.barcode && !toInt(b.helper_id)) throw badRequest('Bipe o código do ajudante.');
  if (!toInt(b.load_id)) throw badRequest('Selecione a carga.');
  if (!toInt(b.activity_type_id)) throw badRequest('Selecione a atividade.');
  const result = ops.start({
    barcode: b.barcode, helper_id: toInt(b.helper_id), load_id: toInt(b.load_id),
    activity_type_id: toInt(b.activity_type_id), square_id: toInt(b.square_id, null) || null,
    reference_weight_kg: b.reference_weight_kg, reference_volumes: b.reference_volumes,
    switch: b.switch === true,
  }, req);
  res.status(201).json(result);
});

router.get('/open', ALL, (req, res) => res.json(ops.listOpen({ loadId: toInt(req.query.load_id, null) })));

router.post('/participants/:id/finish', ALL, (req, res) => res.json(ops.finish(toInt(req.params.id), req)));
router.post('/participants/:id/cancel', ALL, (req, res) => res.json(ops.cancel(toInt(req.params.id), req.body?.reason, req)));
router.patch('/participants/:id', requireRole('ADMIN', 'GESTOR'), (req, res) => res.json(ops.correct(toInt(req.params.id), req.body || {}, req)));

router.post('/activities/:id/finish', ALL, (req, res) => res.json(ops.finishActivity(toInt(req.params.id), req)));
router.post('/activities/:id/recalculate', requireRole('ADMIN'), (req, res) => res.json(ops.reapplyRule(toInt(req.params.id), req.body?.reason, req)));

module.exports = router;
