// src/settings.js — configurações globais da agência (chave/valor)
'use strict';

const { getDb } = require('./db');

// Chaves que nunca saem da API em texto puro
const SECRET_KEYS = new Set(['anthropic_api_key', 'evolution_apikey', 'jwt_secret']);

const PUBLIC_DEFAULTS = {
  agency_name: 'Versal Estúdio',
  agency_instagram: 'versal.estudio',
};

function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value !== null && row.value !== '') return row.value;
  if (fallback !== null) return fallback;
  return PUBLIC_DEFAULTS[key] ?? null;
}

function setSetting(key, value) {
  getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value === undefined ? null : value);
}

function maskSecret(v) {
  if (!v) return '';
  return v.length <= 8 ? '••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

module.exports = { getSetting, setSetting, maskSecret, SECRET_KEYS, PUBLIC_DEFAULTS };
