// src/services/bookings.js — criação, remarcação e cancelamento com checagem de conflito
'use strict';

const crypto = require('crypto');
const { getDb, transaction } = require('../db');
const { HttpError } = require('../validators');
const { sha256 } = require('../auth');
const {
  availability, isFree, addMinutes, eligibleProfessionals, siteHasActiveProfessionals, nowLocal,
} = require('./slots');
const { addNotification, describe } = require('./notify');

function loadService(siteId, serviceId, { requireActive = true } = {}) {
  const svc = getDb().prepare('SELECT * FROM services WHERE id = ? AND site_id = ?').get(serviceId, siteId);
  if (!svc || (requireActive && !svc.active)) throw new HttpError(404, 'Serviço não encontrado.', { fields: { service_id: 'Serviço indisponível.' } });
  return svc;
}

function professionalName(id) {
  if (!id) return null;
  return getDb().prepare('SELECT name FROM professionals WHERE id = ?').get(id)?.name || null;
}

/**
 * Escolhe o profissional e valida o horário. Tudo roda dentro da transação do chamador,
 * então dois pedidos simultâneos para o mesmo horário nunca passam juntos.
 */
function resolveSlot(site, svc, date, time, professionalId, source, excludeBookingId = 0) {
  const start = `${date} ${time}`;
  const end = addMinutes(start, svc.duration_min);
  const hasTeam = siteHasActiveProfessionals(site.id);

  if (professionalId && !hasTeam) throw new HttpError(400, 'Profissional inválido.');
  if (professionalId) {
    const ok = eligibleProfessionals(site.id, svc.id).some((p) => p.id === professionalId);
    if (!ok) throw new HttpError(400, 'Este profissional não atende o serviço escolhido.', { fields: { professional_id: 'Profissional inválido.' } });
  }

  if (source === 'site') {
    // Pelo site só vale um horário que a própria agenda oferece (expediente, antecedência, bloqueios, conflitos)
    const { slots } = availability(site, svc, date, professionalId || null);
    const slot = slots.find((s) => s.time === time);
    if (!slot) throw new HttpError(409, 'Este horário acabou de ficar indisponível. Escolha outro.', { code: 'SLOT_TAKEN' });
    const pid = professionalId || (hasTeam ? slot.professional_ids[0] : null);
    return { start, end, pid };
  }

  // Painel: pode marcar fora do expediente, mas nunca em cima de outro agendamento ou bloqueio
  let pid = professionalId || null;
  if (!pid && hasTeam) {
    pid = eligibleProfessionals(site.id, svc.id).map((p) => p.id)
      .find((id) => isFree(site.id, id, start, end, excludeBookingId)) || null;
    if (!pid) throw new HttpError(409, 'Nenhum profissional livre neste horário.', { code: 'SLOT_TAKEN' });
  }
  if (!isFree(site.id, pid, start, end, excludeBookingId)) {
    throw new HttpError(409, 'Conflito: já existe agendamento ou bloqueio neste horário.', { code: 'SLOT_TAKEN' });
  }
  return { start, end, pid };
}

/**
 * @returns {{ booking: object, cancelToken: string }}
 */
function createBooking({ site, serviceId, professionalId = null, date, time, client, notes = null, source = 'site', status = 'confirmed' }) {
  return transaction((db) => {
    const svc = loadService(site.id, serviceId, { requireActive: source === 'site' });
    const { start, end, pid } = resolveSlot(site, svc, date, time, professionalId, source);

    const dup = db.prepare(
      `SELECT 1 FROM bookings WHERE site_id = ? AND client_phone = ? AND starts_at = ? AND status IN ('pending','confirmed')`
    ).get(site.id, client.phone, start);
    if (dup) throw new HttpError(409, 'Já existe um agendamento seu neste horário.', { code: 'DUPLICATE' });

    const cancelToken = crypto.randomBytes(24).toString('base64url');
    const info = db.prepare(`
      INSERT INTO bookings (site_id, service_id, professional_id, service_name, professional_name, price_cents,
        client_name, client_phone, client_email, notes, starts_at, ends_at, status, source, cancel_token_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      site.id, svc.id, pid, svc.name, professionalName(pid), svc.price_cents,
      client.name, client.phone, client.email || null, notes || null, start, end, status, source, sha256(cancelToken),
    );
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
    addNotification({
      siteId: site.id, bookingId: booking.id, type: 'new_booking',
      title: `Novo agendamento — ${site.name}`,
      message: `${booking.client_name}: ${describe(booking)}${source === 'panel' ? ' (lançado no painel)' : ''}`,
    });
    return { booking, cancelToken };
  });
}

function rescheduleBooking(site, booking, { date, time, professionalId, serviceId }) {
  return transaction((db) => {
    const svc = loadService(site.id, serviceId || booking.service_id, { requireActive: false });
    const { start, end, pid } = resolveSlot(site, svc, date, time, professionalId ?? booking.professional_id, 'panel', booking.id);
    db.prepare(`UPDATE bookings SET service_id = ?, service_name = ?, price_cents = ?, professional_id = ?, professional_name = ?,
      starts_at = ?, ends_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(svc.id, svc.name, serviceId ? svc.price_cents : booking.price_cents, pid, professionalName(pid), start, end, booking.id);
    return db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  });
}

function findByCancelToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return getDb().prepare('SELECT * FROM bookings WHERE cancel_token_hash = ?').get(sha256(token)) || null;
}

function cancelByClient(site, booking) {
  if (!['pending', 'confirmed'].includes(booking.status)) throw new HttpError(409, 'Este agendamento já não está ativo.');
  if (booking.starts_at <= nowLocal()) throw new HttpError(409, 'Não é possível cancelar um horário que já passou.');
  const db = getDb();
  db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_by = 'client', updated_at = datetime('now') WHERE id = ?`).run(booking.id);
  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  addNotification({
    siteId: site.id, bookingId: booking.id, type: 'booking_cancelled',
    title: `Cancelamento — ${site.name}`,
    message: `${booking.client_name} cancelou: ${describe(booking)}`,
  });
  return updated;
}

module.exports = { createBooking, rescheduleBooking, findByCancelToken, cancelByClient, loadService };
