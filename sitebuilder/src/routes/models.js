// src/routes/models.js — catálogo de modelos de site para o painel
'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { HttpError } = require('../validators');
const models = require('../services/models');

module.exports = () => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'operator'));

  router.get('/', (req, res) => {
    const cats = models.categories();
    const category = req.query.categoria || req.query.category;
    if (category !== undefined && !cats.some((c) => c.category === category)) {
      throw new HttpError(400, 'Nicho sem modelos.', { fields: { categoria: 'Nicho sem modelos.' } });
    }
    res.json({ categories: cats, models: models.listModels({ category }) });
  });

  return router;
};
