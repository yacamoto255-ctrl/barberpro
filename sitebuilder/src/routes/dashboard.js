// src/routes/dashboard.js — indicadores do painel (calculados direto do banco)
'use strict';

const express = require('express');
const { getDb } = require('../db');
const { Checker } = require('../validators');
const { requireAuth, requireRole } = require('../auth');
const { nowLocal, addDays } = require('../services/slots');

module.exports = () => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'operator'));

  router.get('/', (req, res) => {
    const c = new Checker(req.query);
    const siteId = c.int('site_id', 'Site', { min: 1 });
    c.done();
    const db = getDb();
    const now = nowLocal();
    const today = now.slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const nextMonthStart = addDays(`${today.slice(0, 7)}-28`, 4).slice(0, 7) + '-01';
    const s = siteId ? 'AND site_id = ?' : '';
    const sp = siteId ? [siteId] : [];

    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const cards = {
      sites_total: one('SELECT COUNT(*) AS n FROM sites').n,
      sites_published: one('SELECT COUNT(*) AS n FROM sites WHERE published = 1').n,
      today_bookings: one(`SELECT COUNT(*) AS n FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status IN ('pending','confirmed','completed') ${s}`,
        `${today} 00:00`, `${addDays(today, 1)} 00:00`, ...sp).n,
      next7_bookings: one(`SELECT COUNT(*) AS n FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status IN ('pending','confirmed') ${s}`,
        now, `${addDays(today, 8)} 00:00`, ...sp).n,
      month_bookings: one(`SELECT COUNT(*) AS n FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status <> 'cancelled' ${s}`,
        `${monthStart} 00:00`, `${nextMonthStart} 00:00`, ...sp).n,
      month_cancelled: one(`SELECT COUNT(*) AS n FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status = 'cancelled' ${s}`,
        `${monthStart} 00:00`, `${nextMonthStart} 00:00`, ...sp).n,
      month_revenue_done: one(`SELECT COALESCE(SUM(price_cents),0) AS n FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status = 'completed' ${s}`,
        `${monthStart} 00:00`, `${nextMonthStart} 00:00`, ...sp).n,
      month_revenue_expected: one(`SELECT COALESCE(SUM(price_cents),0) AS n FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status IN ('pending','confirmed','completed') ${s}`,
        `${monthStart} 00:00`, `${nextMonthStart} 00:00`, ...sp).n,
      unread_notifications: one('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').n,
    };

    // Agendamentos ativos por dia: hoje + 13 dias
    const counts = db.prepare(`SELECT substr(starts_at, 1, 10) AS d, COUNT(*) AS n FROM bookings
      WHERE starts_at >= ? AND starts_at < ? AND status IN ('pending','confirmed','completed') ${s} GROUP BY d`)
      .all(`${today} 00:00`, `${addDays(today, 14)} 00:00`, ...sp);
    const map = Object.fromEntries(counts.map((r) => [r.d, r.n]));
    const daily = Array.from({ length: 14 }, (_, i) => { const d = addDays(today, i); return { date: d, count: map[d] || 0 }; });

    const topServices = db.prepare(`SELECT service_name AS name, COUNT(*) AS count, COALESCE(SUM(price_cents),0) AS revenue_cents
      FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status <> 'cancelled' ${s}
      GROUP BY service_name ORDER BY count DESC LIMIT 5`).all(`${monthStart} 00:00`, `${nextMonthStart} 00:00`, ...sp);

    const upcoming = db.prepare(`SELECT b.id, b.starts_at, b.client_name, b.service_name, b.professional_name, b.status, s.name AS site_name
      FROM bookings b JOIN sites s ON s.id = b.site_id
      WHERE b.starts_at >= ? AND b.status IN ('pending','confirmed') ${siteId ? 'AND b.site_id = ?' : ''}
      ORDER BY b.starts_at LIMIT 8`).all(now, ...sp);

    res.json({ generated_at: now, cards, daily, top_services: topServices, upcoming });
  });

  return router;
};
