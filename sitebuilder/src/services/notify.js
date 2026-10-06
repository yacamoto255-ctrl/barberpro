// src/services/notify.js — alertas internos e mensagens de WhatsApp sobre agendamentos
'use strict';

const { getDb } = require('../db');
const { sendWhatsApp } = require('./whatsapp');
const { formatDateTimeBR } = require('../util');

function addNotification({ siteId, bookingId = null, type, title, message }) {
  getDb().prepare('INSERT INTO notifications (site_id, booking_id, type, title, message) VALUES (?, ?, ?, ?, ?)')
    .run(siteId, bookingId, type, title, message);
}

function describe(b) {
  return `${b.service_name}${b.professional_name ? ' com ' + b.professional_name : ''} — ${formatDateTimeBR(b.starts_at)}`;
}

/**
 * Dispara WhatsApp em segundo plano (não bloqueia a resposta HTTP).
 * Retorna a Promise para quem quiser aguardar (testes).
 */
function whatsappForNewBooking(site, booking, cancelUrl) {
  const jobs = [];
  if (site.notify_whatsapp && site.whatsapp) {
    jobs.push(sendWhatsApp({
      to: site.whatsapp,
      purpose: 'business_new_booking',
      bookingId: booking.id,
      instance: site.evolution_instance,
      text: `📅 Novo agendamento — ${site.name}\n${describe(booking)}\nCliente: ${booking.client_name} (+${booking.client_phone})${booking.notes ? '\nObs.: ' + booking.notes : ''}`,
    }));
  }
  if (site.notify_client_whatsapp && booking.client_phone) {
    const addr = [site.address, site.city].filter(Boolean).join(' — ');
    jobs.push(sendWhatsApp({
      to: booking.client_phone,
      purpose: 'client_confirmation',
      bookingId: booking.id,
      instance: site.evolution_instance,
      text: `Olá, ${booking.client_name.split(' ')[0]}! Seu horário em ${site.name} está confirmado:\n${describe(booking)}${addr ? '\n📍 ' + addr : ''}${cancelUrl ? '\n\nPrecisa cancelar? ' + cancelUrl : ''}`,
    }));
  }
  return Promise.all(jobs);
}

function whatsappForCancellation(site, booking) {
  if (!(site.notify_whatsapp && site.whatsapp)) return Promise.resolve([]);
  return sendWhatsApp({
    to: site.whatsapp,
    purpose: 'business_cancellation',
    bookingId: booking.id,
    instance: site.evolution_instance,
    text: `❌ Agendamento cancelado pelo cliente — ${site.name}\n${describe(booking)}\nCliente: ${booking.client_name} (+${booking.client_phone})`,
  });
}

module.exports = { addNotification, describe, whatsappForNewBooking, whatsappForCancellation };
