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

module.exports = { ah, baseUrl, idParam, escapeHtml, formatBRL, formatDateTimeBR };
