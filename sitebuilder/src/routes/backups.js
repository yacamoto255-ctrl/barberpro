// src/routes/backups.js — backup e restauração (somente admin)
'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { audit } = require('../audit');
const { resetSecretCache } = require('../auth');
const backup = require('../services/backup');

module.exports = () => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', (req, res) => res.json({ backups: backup.listBackups() }));

  router.post('/', (req, res) => {
    const b = backup.createBackup('manual');
    audit(req, 'backup.create', 'backup', null, b);
    res.status(201).json({ backup: b });
  });

  router.post('/upload', express.raw({ type: () => true, limit: '200mb' }), (req, res) => {
    const b = backup.saveUploadedBackup(req.body);
    audit(req, 'backup.upload', 'backup', null, b);
    res.status(201).json({ backup: b });
  });

  router.get('/:name/download', (req, res) => {
    const file = backup.resolveBackup(req.params.name);
    audit(req, 'backup.download', 'backup', null, { name: req.params.name });
    res.download(file, req.params.name);
  });

  router.post('/:name/restore', (req, res) => {
    const actor = { ...req };
    const result = backup.restoreBackup(req.params.name);
    resetSecretCache(); // o segredo do JWT pode ter vindo no backup
    audit(actor, 'backup.restore', 'backup', null, result);
    res.json(result);
  });

  router.delete('/:name', (req, res) => {
    backup.deleteBackup(req.params.name);
    audit(req, 'backup.delete', 'backup', null, { name: req.params.name });
    res.json({ ok: true });
  });

  return router;
};
