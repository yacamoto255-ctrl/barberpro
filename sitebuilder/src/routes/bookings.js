// src/routes/bookings.js — agenda no painel (lista, lançamento manual, status, remarcação)
'use strict';

const express = require('express');
const { getDb } = require('../db');
const { Checker, HttpError } = require('../validators');
const { requireAuth, requireRole } = require('../auth');
const { audit } = require('../audit');
const { ah, idParam, baseUrl } = require('../util');
const { createBooking, rescheduleBooking } = require('../services/bookings');
const { isFree } = require('../services/slots');
const { whatsappForNewBooking } = require('../services/notify');

const STATUSES = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'];

function getSite(id) {
  const s = getDb().prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!s) throw new HttpError(404, 'Site não encontrado.', { fields: { site_id: 'Site inválido.' } });
  return s;
}

function getBooking(id) {
  const b = getDb().prepare(
    'SELECT b.*, s.name AS site_name, s.slug AS site_slug FROM bookings b JOIN sites s ON s.id = b.site_id WHERE b.id = ?'
  ).get(id);
  if (!b) throw new HttpError(404, 'Agendamento não encontrado.');
  const { cancel_token_hash, ...rest } = b;
  return rest;
}

/** Filtros comuns da lista e dos relatórios */
function buildFilter(q) {
  const c = new Checker(q);
  const f = {
    site_id: c.int('site_id', 'Site', { min: 1 }),
    from: c.date('from', 'Data inicial'),
    to: c.date('to', 'Data final'),
    status: c.oneOf('status', 'Status', STATUSES),
    professional_id: c.int('professional_id', 'Profissional', { min: 1 }),
    service_id: c.int('service_id', 'Serviço', { min: 1 }),
    q: c.str('q', 'Busca', { max: 80 }),
  };
  c.done();
  if (f.from && f.to && f.from > f.to) throw new HttpError(400, 'A data inicial deve ser antes da final.');
  const where = [];
  const params = [];
  if (f.site_id) { where.push('b.site_id = ?'); params.push(f.site_id); }
  if (f.from) { where.push('b.starts_at >= ?'); params.push(`${f.from} 00:00`); }
  if (f.to) { where.push('b.starts_at <= ?'); params.push(`${f.to} 23:59`); }
  if (f.status) { where.push('b.status = ?'); params.push(f.status); }
  if (f.professional_id) { where.push('b.professional_id = ?'); params.push(f.professional_id); }
  if (f.service_id) { where.push('b.service_id = ?'); params.push(f.service_id); }
  if (f.q) {
    const digits = f.q.replace(/\D/g, '');
    const like = `%${f.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    if (digits.length >= 4) {
      where.push("(b.client_name LIKE ? ESCAPE '\\' OR b.client_phone LIKE ?)");
      params.push(like, `%${digits}%`);
    } else {
      where.push("b.client_name LIKE ? ESCAPE '\\'");
      params.push(like);
    }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params, filters: f };
}

module.exports = () => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'operator'));

  router.get('/', (req, res) => {
    const { sql, params } = buildFilter(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const db = getDb();
    const total = db.prepare(`SELECT COUNT(*) AS n FROM bookings b ${sql}`).get(...params).n;
    const order = req.query.order === 'desc' ? 'DESC' : 'ASC';
    const rows = db.prepare(`
      SELECT b.id, b.site_id, s.name AS site_name, b.service_id, b.service_name, b.professional_id, b.professional_name,
             b.price_cents, b.client_name, b.client_phone, b.client_email, b.notes, b.starts_at, b.ends_at,
             b.status, b.source, b.cancelled_by, b.created_at, b.updated_at
      FROM bookings b JOIN sites s ON s.id = b.site_id ${sql}
      ORDER BY b.starts_at ${order}, b.id LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ bookings: rows, total, page, limit });
  });

  router.get('/:id', (req, res) => {
    res.json({ booking: getBooking(idParam(req)) });
  });

  router.post('/', ah(async (req, res) => {
    const c = new Checker(req.body);
    const siteId = c.int('site_id', 'Site', { required: true, min: 1 });
    const serviceId = c.int('service_id', 'Serviço', { required: true, min: 1 });
    const professionalId = c.int('professional_id', 'Profissional', { min: 1 });
    const date = c.date('date', 'Data', { required: true });
    const time = c.time('time', 'Horário', { required: true });
    const client = {
      name: c.str('client_name', 'Nome do cliente', { required: true, min: 2, max: 120 }),
      phone: c.phone('client_phone', 'WhatsApp do cliente', { required: true }),
      email: c.email('client_email', 'E-mail do cliente') || null,
    };
    const notes = c.str('notes', 'Observações', { max: 500 });
    const status = c.oneOf('status', 'Status', ['pending', 'confirmed']) || 'confirmed';
    const notify = c.bool('notify_client', 'Avisar cliente');
    c.done();
    const site = getSite(siteId);
    const { booking, cancelToken } = createBooking({
      site, serviceId, professionalId: professionalId || null, date, time, client, notes, source: 'panel', status,
    });
    audit(req, 'booking.create', 'booking', booking.id, { site_id: site.id, starts_at: booking.starts_at });
    if (notify) {
      whatsappForNewBooking({ ...site, notify_whatsapp: 0 }, booking, `${baseUrl(req)}/s/${site.slug}/cancelar/${cancelToken}`);
    }
    res.status(201).json({ booking: getBooking(booking.id) });
  }));

  router.patch('/:id', ah(async (req, res) => {
    const id = idParam(req);
    const db = getDb();
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) throw new HttpError(404, 'Agendamento não encontrado.');
    const site = getSite(booking.site_id);

    const c = new Checker(req.body, { partial: true });
    const status = c.oneOf('status', 'Status', STATUSES);
    const notes = c.str('notes', 'Observações', { max: 500 });
    const date = c.date('date', 'Data');
    const time = c.time('time', 'Horário');
    const professionalId = c.int('professional_id', 'Profissional', { min: 1 });
    const serviceId = c.int('service_id', 'Serviço', { min: 1 });
    c.done();
    if ((date && !time) || (!date && time)) throw new HttpError(400, 'Para remarcar, informe data e horário.');

    let current = booking;
    if (date || professionalId || serviceId) {
      current = rescheduleBooking(site, booking, {
        date: date || booking.starts_at.slice(0, 10),
        time: time || booking.starts_at.slice(11),
        professionalId: professionalId || null,
        serviceId: serviceId || null,
      });
    }
    if (status && status !== current.status) {
      const reactivating = ['pending', 'confirmed'].includes(status) && !['pending', 'confirmed'].includes(current.status);
      if (reactivating && !isFree(site.id, current.professional_id, current.starts_at, current.ends_at, current.id)) {
        throw new HttpError(409, 'Não é possível reativar: o horário já foi ocupado.', { code: 'SLOT_TAKEN' });
      }
      db.prepare(`UPDATE bookings SET status = ?, cancelled_by = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(status, status === 'cancelled' ? 'panel' : null, id);
    }
    if (notes !== undefined) db.prepare(`UPDATE bookings SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(notes || null, id);
    audit(req, 'booking.update', 'booking', id, { status, date, time, professionalId, serviceId, notes_changed: notes !== undefined });
    res.json({ booking: getBooking(id) });
  }));

  // Exclusão definitiva (lançamento errado). Para o dia a dia, use o status "cancelado".
  router.delete('/:id', requireRole('admin'), (req, res) => {
    const id = idParam(req);
    const b = getBooking(id);
    getDb().prepare('DELETE FROM bookings WHERE id = ?').run(id);
    audit(req, 'booking.delete', 'booking', id, { site_id: b.site_id, client: b.client_name, starts_at: b.starts_at });
    res.json({ ok: true });
  });

  return router;
};

module.exports.buildFilter = buildFilter;
module.exports.STATUSES = STATUSES;
