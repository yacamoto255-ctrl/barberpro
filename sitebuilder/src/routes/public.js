// src/routes/public.js — páginas e API públicas (visitantes, sem login)
'use strict';

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { Checker, HttpError, isValidDate } = require('../validators');
const { jwtSecret } = require('../auth');
const { ah, baseUrl, escapeHtml: e, formatBRL, formatDateTimeBR } = require('../util');
const { availability, addDays, nowLocal } = require('../services/slots');
const { createBooking, findByCancelToken, cancelByClient, loadService } = require('../services/bookings');
const { whatsappForNewBooking, whatsappForCancellation } = require('../services/notify');
const { renderSite, renderMessagePage } = require('../render/site');
const { siteOut } = require('./sites');

function siteCsp(nonce) {
  return [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

function previewToken(siteId) {
  return jwt.sign({ preview_site: siteId }, jwtSecret(), { expiresIn: '2h', algorithm: 'HS256' });
}

function canPreview(token, siteId) {
  if (!token) return false;
  try { return jwt.verify(String(token), jwtSecret(), { algorithms: ['HS256'] }).preview_site === siteId; } catch { return false; }
}

/** Site publicado com agendamento ativo, ou 404 */
function publicSite(slug, { forBooking = false } = {}) {
  const site = getDb().prepare('SELECT * FROM sites WHERE slug = ? AND published = 1').get(String(slug || '').toLowerCase());
  if (!site) throw new HttpError(404, 'Site não encontrado.');
  if (forBooking && !site.booking_enabled) throw new HttpError(403, 'Este negócio não está recebendo agendamentos online.');
  return site;
}

function siteData(site) {
  const db = getDb();
  return {
    services: db.prepare('SELECT * FROM services WHERE site_id = ? ORDER BY sort_order, name').all(site.id),
    professionals: db.prepare('SELECT * FROM professionals WHERE site_id = ? ORDER BY sort_order, name').all(site.id),
    hours: db.prepare('SELECT weekday, open_time, close_time FROM business_hours WHERE site_id = ? ORDER BY weekday, open_time').all(site.id),
    gallery: db.prepare("SELECT id FROM images WHERE site_id = ? AND kind = 'gallery' ORDER BY id").all(site.id),
  };
}

function sendHtml(res, status, html, nonce) {
  res.status(status)
    .set('Content-Security-Policy', siteCsp(nonce))
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(html);
}

module.exports = (limits) => {
  const pages = express.Router();
  const api = express.Router();

  /* ── Páginas ───────────────────────────────────────────── */
  pages.get('/s/:slug', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    const slug = String(req.params.slug || '').toLowerCase();
    const site = getDb().prepare('SELECT * FROM sites WHERE slug = ?').get(slug);
    const preview = site && !site.published && canPreview(req.query.preview, site.id);
    if (!site || (!site.published && !preview)) {
      return sendHtml(res, 404, renderMessagePage({ title: 'Site não encontrado', body: '<p>Confira o endereço digitado.</p>', nonce }), nonce);
    }
    const { theme } = siteOut(site);
    const html = renderSite({ site, theme, ...siteData(site), nonce, preview, base: baseUrl(req) });
    sendHtml(res, 200, html, nonce);
  });

  function cancelPage(req, res, { done = false, error = null } = {}) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const site = getDb().prepare('SELECT * FROM sites WHERE slug = ?').get(String(req.params.slug || '').toLowerCase());
    const booking = site ? findByCancelToken(req.params.token) : null;
    if (!site || !booking || booking.site_id !== site.id) {
      return sendHtml(res, 404, renderMessagePage({ title: 'Link inválido', body: '<p>Este link de cancelamento não existe ou já expirou.</p>', nonce }), nonce);
    }
    const { theme } = siteOut(site);
    const details = `<dl><dt>Serviço</dt><dd>${e(booking.service_name)}</dd>
      ${booking.professional_name ? `<dt>Com</dt><dd>${e(booking.professional_name)}</dd>` : ''}
      <dt>Quando</dt><dd>${e(formatDateTimeBR(booking.starts_at))}</dd>
      ${site.hide_prices ? '' : `<dt>Valor</dt><dd>${booking.price_cents ? formatBRL(booking.price_cents) : '—'}</dd>`}</dl>`;
    const active = ['pending', 'confirmed'].includes(booking.status) && booking.starts_at > nowLocal();
    let title; let body; let actions = '';
    if (error) { title = 'Não foi possível cancelar'; body = `<p>${e(error)}</p>${details}`; }
    else if (done || booking.status === 'cancelled') { title = 'Agendamento cancelado'; body = `<p>Pronto, seu horário foi cancelado.</p>${details}`; }
    else if (!active) { title = 'Agendamento encerrado'; body = `<p>Este horário já passou ou não está mais ativo.</p>${details}`; }
    else {
      title = `Cancelar horário em ${site.name}?`;
      body = `<p>Confira os dados abaixo.</p>${details}`;
      actions = `<form method="post"><button type="submit">Sim, cancelar meu horário</button></form>`;
    }
    sendHtml(res, error ? 409 : 200, renderMessagePage({ title, body, site, nonce, theme, actionsHtml: actions }), nonce);
  }

  pages.get('/s/:slug/cancelar/:token', (req, res) => cancelPage(req, res));

  pages.post('/s/:slug/cancelar/:token', limits.publicWrite, (req, res) => {
    const site = getDb().prepare('SELECT * FROM sites WHERE slug = ?').get(String(req.params.slug || '').toLowerCase());
    const booking = site ? findByCancelToken(req.params.token) : null;
    if (!site || !booking || booking.site_id !== site.id) return cancelPage(req, res);
    try {
      const updated = cancelByClient(site, booking);
      whatsappForCancellation(site, updated);
      return cancelPage(req, res, { done: true });
    } catch (err) {
      if (err instanceof HttpError) return cancelPage(req, res, { error: err.message });
      throw err;
    }
  });

  pages.get('/img/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
    const img = getDb().prepare('SELECT mime, data, size, created_at FROM images WHERE id = ?').get(id);
    if (!img) return res.status(404).end();
    res.set('Content-Type', img.mime)
      .set('Content-Length', String(img.size))
      .set('Cache-Control', 'public, max-age=86400')
      .set('Content-Security-Policy', "default-src 'none'")
      .send(Buffer.from(img.data));
  });

  /* ── API pública ───────────────────────────────────────── */
  api.get('/sites/:slug', (req, res) => {
    const site = publicSite(req.params.slug);
    const db = getDb();
    const services = db.prepare(
      'SELECT id, name, description, duration_min, price_cents FROM services WHERE site_id = ? AND active = 1 ORDER BY sort_order, name'
    ).all(site.id).map((sv) => (site.hide_prices ? { ...sv, price_cents: null } : sv));
    const professionals = db.prepare(
      'SELECT id, name, title, registration, photo_image_id FROM professionals WHERE site_id = ? AND active = 1 ORDER BY sort_order, name'
    ).all(site.id).map((p) => ({
      ...p,
      service_ids: db.prepare('SELECT service_id FROM professional_services WHERE professional_id = ?').all(p.id).map((r) => r.service_id),
    }));
    res.json({
      site: { name: site.name, slug: site.slug, booking_enabled: !!site.booking_enabled, max_days_ahead: site.max_days_ahead, whatsapp: site.whatsapp },
      services, professionals, today: nowLocal().slice(0, 10),
    });
  });

  function readSlotQuery(req, site) {
    const c = new Checker(req.query);
    const serviceId = c.int('service_id', 'Serviço', { required: true, min: 1 });
    const professionalId = c.int('professional_id', 'Profissional', { min: 1 });
    c.done();
    return { svc: loadService(site.id, serviceId), professionalId: professionalId || null };
  }

  // Próximos dias com indicação de vaga (até 14 por chamada)
  api.get('/sites/:slug/days', limits.publicRead, (req, res) => {
    const site = publicSite(req.params.slug, { forBooking: true });
    const { svc, professionalId } = readSlotQuery(req, site);
    const today = nowLocal().slice(0, 10);
    let from = isValidDate(req.query.from) && req.query.from > today ? req.query.from : today;
    const last = addDays(today, site.max_days_ahead);
    const days = [];
    for (let i = 0; i < 14 && from <= last; i++, from = addDays(from, 1)) {
      days.push({ date: from, available: availability(site, svc, from, professionalId).slots.length > 0 });
    }
    res.json({ days, has_more: from <= last, next_from: from <= last ? from : null });
  });

  api.get('/sites/:slug/availability', limits.publicRead, (req, res) => {
    const site = publicSite(req.params.slug, { forBooking: true });
    const { svc, professionalId } = readSlotQuery(req, site);
    if (!isValidDate(req.query.date)) throw new HttpError(400, 'Data inválida.', { fields: { date: 'Data inválida.' } });
    const r = availability(site, svc, req.query.date, professionalId);
    res.json({ date: req.query.date, service_id: svc.id, slots: r.slots, reason: r.reason || null });
  });

  api.post('/sites/:slug/bookings', limits.publicWrite, ah(async (req, res) => {
    const site = publicSite(req.params.slug, { forBooking: true });
    // Honeypot: robôs preenchem o campo escondido "website"
    if (req.body && typeof req.body.website === 'string' && req.body.website.trim() !== '') {
      throw new HttpError(400, 'Não foi possível concluir o agendamento.');
    }
    const c = new Checker(req.body);
    const serviceId = c.int('service_id', 'Serviço', { required: true, min: 1 });
    const professionalId = c.int('professional_id', 'Profissional', { min: 1 });
    const date = c.date('date', 'Data', { required: true });
    const time = c.time('time', 'Horário', { required: true });
    const client = {
      name: c.str('client_name', 'Nome', { required: true, min: 2, max: 120 }),
      phone: c.phone('client_phone', 'WhatsApp', { required: true }),
      email: c.email('client_email', 'E-mail') || null,
    };
    const notes = c.str('notes', 'Observações', { max: 500 });
    c.done();
    if (!/\p{L}/u.test(client.name)) throw new HttpError(400, 'Informe um nome válido.', { fields: { client_name: 'Nome inválido.' } });

    const { booking, cancelToken } = createBooking({
      site, serviceId, professionalId: professionalId || null, date, time, client, notes, source: 'site',
    });
    const cancelUrl = `${baseUrl(req)}/s/${site.slug}/cancelar/${cancelToken}`;
    whatsappForNewBooking(site, booking, cancelUrl);
    res.status(201).json({
      booking: {
        id: booking.id, service_name: booking.service_name, professional_name: booking.professional_name,
        starts_at: booking.starts_at, ends_at: booking.ends_at, price_cents: site.hide_prices ? null : booking.price_cents, status: booking.status,
      },
      cancel_url: cancelUrl,
    });
  }));

  return { pages, api };
};

module.exports.previewToken = previewToken;
