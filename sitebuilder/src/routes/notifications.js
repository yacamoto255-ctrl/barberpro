// src/routes/notifications.js — alertas internos do painel
'use strict';

const express = require('express');
const { getDb } = require('../db');
const { HttpError } = require('../validators');
const { requireAuth, requireRole } = require('../auth');
const { idParam } = require('../util');

module.exports = () => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'operator'));

  const unread = () => getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get().n;

  router.get('/', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const onlyUnread = req.query.unread === '1';
    const rows = getDb().prepare(`
      SELECT n.*, s.name AS site_name FROM notifications n LEFT JOIN sites s ON s.id = n.site_id
      ${onlyUnread ? 'WHERE n.read_at IS NULL' : ''}
      ORDER BY n.id DESC LIMIT ?`).all(limit);
    res.json({ notifications: rows, unread: unread() });
  });

  router.get('/count', (req, res) => res.json({ unread: unread() }));

  router.post('/read-all', (req, res) => {
    getDb().prepare("UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL").run();
    res.json({ unread: 0 });
  });

  router.post('/:id/read', (req, res) => {
    const r = getDb().prepare("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ?").run(idParam(req));
    if (!r.changes) throw new HttpError(404, 'Notificação não encontrada.');
    res.json({ unread: unread() });
  });

  return router;
};
