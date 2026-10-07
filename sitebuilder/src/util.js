// src/util.js — utilitários compartilhados
'use strict';

const { HttpError } = require('./validators');

/** Envolve handlers async para que erros caiam no handler central */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function idParam(req, name = 'id') {
  const raw = String(req.params[name] ?? '');
  const n = Number(raw);
  if (!/^\d{1,15}$/.test(raw) || n <= 0) throw new HttpError(400, 'Identificador inválido.');
  return n;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "2026-10-07 14:30" -> "07/10/2026 14:30" */
function formatDateTimeBR(s) {
  if (!s) return '';
  const [d, t] = s.split(' ');
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}${t ? ' ' + t : ''}`;
}

const DAYS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, 'sáb': 6 };

/** Horários em JSON (sites/*.json): {"seg": "08:00-12:00, 13:30-18:00", "dom": null} -> [{weekday, open_time, close_time}] */
function parseHours(hours) {
  const out = [];
  for (const [day, value] of Object.entries(hours || {})) {
    const wd = DAYS[day.toLowerCase()];
    if (wd === undefined) throw new Error(`Dia inválido em "horarios": ${day} (use dom, seg, ter, qua, qui, sex, sab)`);
    if (!value) continue;
    for (const range of String(value).split(',').map((r) => r.trim()).filter(Boolean)) {
      const m = range.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
      if (!m) throw new Error(`Faixa inválida em "horarios.${day}": "${range}" (use 08:00-12:00)`);
      out.push({ weekday: wd, open_time: m[1], close_time: m[2] });
    }
  }
  return out;
}

module.exports = { ah, baseUrl, idParam, escapeHtml, formatBRL, formatDateTimeBR, parseHours };
