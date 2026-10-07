// src/services/slots.js — cálculo de horários livres e checagem de conflitos
'use strict';

const { getDb } = require('../db');

const TZ = process.env.BUSINESS_TZ || 'America/Sao_Paulo';
const ACTIVE = "('pending','confirmed')";

/** Data/hora atual no fuso do negócio: "YYYY-MM-DD HH:MM" */
function nowLocal(tz = TZ, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function toDate(s) {
  const [d, t = '00:00'] = s.split(' ');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, dd, h, mi));
}

function fmt(dt) {
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}

/** Soma minutos a "YYYY-MM-DD HH:MM" (aritmética de relógio local) */
function addMinutes(s, min) {
  return fmt(new Date(toDate(s).getTime() + min * 60000));
}

function addDays(dateStr, days) {
  return addMinutes(`${dateStr} 00:00`, days * 1440).slice(0, 10);
}

function weekdayOf(dateStr) {
  return toDate(dateStr).getUTCDay();
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/** Profissionais ativos que fazem o serviço (sem vínculo cadastrado = faz todos) */
function eligibleProfessionals(siteId, serviceId) {
  return getDb().prepare(`
    SELECT p.* FROM professionals p
    WHERE p.site_id = ? AND p.active = 1
      AND (NOT EXISTS (SELECT 1 FROM professional_services ps WHERE ps.professional_id = p.id)
           OR EXISTS (SELECT 1 FROM professional_services ps WHERE ps.professional_id = p.id AND ps.service_id = ?))
    ORDER BY p.sort_order, p.name`).all(siteId, serviceId);
}

function siteHasActiveProfessionals(siteId) {
  return !!getDb().prepare('SELECT 1 FROM professionals WHERE site_id = ? AND active = 1').get(siteId);
}

function busyIntervals(siteId, dayStart, dayEnd, excludeBookingId = 0) {
  const db = getDb();
  const bookings = db.prepare(
    `SELECT id, professional_id, starts_at, ends_at FROM bookings
     WHERE site_id = ? AND status IN ${ACTIVE} AND starts_at < ? AND ends_at > ? AND id <> ?`
  ).all(siteId, dayEnd, dayStart, excludeBookingId);
  const blocks = db.prepare(
    'SELECT professional_id, starts_at, ends_at FROM blocks WHERE site_id = ? AND starts_at < ? AND ends_at > ?'
  ).all(siteId, dayEnd, dayStart);
  return { bookings, blocks };
}

/** O recurso (profissional ou o próprio negócio quando pid = null) está livre no intervalo? */
function resourceFree(busy, pid, start, end) {
  for (const b of busy.blocks) {
    if ((b.professional_id === null || b.professional_id === pid) && overlaps(start, end, b.starts_at, b.ends_at)) return false;
  }
  for (const b of busy.bookings) {
    if (b.professional_id === pid && overlaps(start, end, b.starts_at, b.ends_at)) return false;
  }
  return true;
}

/**
 * Horários disponíveis para um serviço numa data.
 * @returns {{ slots: Array<{time:string, professional_ids:number[]}>, reason?: string }}
 */
function availability(site, service, date, professionalId = null, { now = nowLocal() } = {}) {
  const today = now.slice(0, 10);
  if (date < today) return { slots: [], reason: 'Data no passado.' };
  if (date > addDays(today, site.max_days_ahead)) return { slots: [], reason: `Agenda aberta até ${site.max_days_ahead} dias à frente.` };

  const db = getDb();
  const hours = db.prepare('SELECT open_time, close_time FROM business_hours WHERE site_id = ? AND weekday = ? ORDER BY open_time')
    .all(site.id, weekdayOf(date));
  if (!hours.length) return { slots: [], reason: 'Fechado neste dia.' };

  let resources; // lista de ids de profissional, ou [null] quando o negócio não tem equipe
  if (siteHasActiveProfessionals(site.id)) {
    const eligible = eligibleProfessionals(site.id, service.id).map((p) => p.id);
    resources = professionalId ? eligible.filter((id) => id === professionalId) : eligible;
    if (!resources.length) return { slots: [], reason: 'Nenhum profissional disponível para este serviço.' };
  } else {
    resources = [null];
  }

  const earliest = addMinutes(now, site.min_notice_min);
  const busy = busyIntervals(site.id, `${date} 00:00`, `${addDays(date, 1)} 00:00`);
  const slots = [];
  for (const h of hours) {
    let start = `${date} ${h.open_time}`;
    const close = `${date} ${h.close_time}`;
    while (addMinutes(start, service.duration_min) <= close) {
      const end = addMinutes(start, service.duration_min);
      if (start >= earliest) {
        const free = resources.filter((pid) => resourceFree(busy, pid, start, end));
        if (free.length) slots.push({ time: start.slice(11), professional_ids: free.filter((x) => x !== null) });
      }
      start = addMinutes(start, site.slot_interval_min);
    }
  }
  return { slots };
}

/** Checagem de conflito pontual (usada também por agendamentos criados no painel) */
function isFree(siteId, professionalId, start, end, excludeBookingId = 0) {
  const busy = busyIntervals(siteId, start, end, excludeBookingId);
  return resourceFree(busy, professionalId ?? null, start, end);
}

module.exports = {
  TZ, nowLocal, addMinutes, addDays, weekdayOf, overlaps, availability, isFree,
  eligibleProfessionals, siteHasActiveProfessionals,
};
