// src/services/whatsapp.js — envio via Evolution API v2 com reenvio automático e registro
'use strict';

const { getDb } = require('../db');
const { getSetting } = require('../settings');

const config = {
  fetch: (...args) => fetch(...args),
  retryDelaysMs: [0, 5_000, 30_000], // 3 tentativas
  timeoutMs: 15_000,
};

function evolutionConfig(instanceOverride) {
  const url = getSetting('evolution_url');
  const apikey = getSetting('evolution_apikey');
  const instance = instanceOverride || getSetting('evolution_instance');
  if (!url || !apikey || !instance) return null;
  return { url: url.replace(/\/$/, ''), apikey, instance };
}

function evolutionConfigured(instanceOverride) {
  return !!evolutionConfig(instanceOverride);
}

async function callEvolution(cfg, path, method = 'GET', body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
  try {
    const res = await config.fetch(`${cfg.url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: cfg.apikey },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function updateLog(id, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE message_log SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...Object.values(fields), id);
}

/**
 * Envia texto por WhatsApp. Nunca lança: o resultado fica em message_log.
 * Erros 5xx, 429 e de rede são reenviados; 4xx são definitivos.
 * @returns {Promise<{status:'sent'|'failed'|'skipped', attempts:number, error?:string}>}
 */
async function sendWhatsApp({ to, text, purpose, bookingId = null, instance = null }) {
  const db = getDb();
  const number = String(to || '').replace(/\D/g, '');
  const log = db.prepare(
    `INSERT INTO message_log (booking_id, recipient, purpose, status) VALUES (?, ?, ?, 'pending')`
  ).run(bookingId, number || '-', purpose);
  const logId = Number(log.lastInsertRowid);

  const cfg = evolutionConfig(instance);
  if (!cfg) {
    updateLog(logId, { status: 'skipped', last_error: 'Evolution API não configurada' });
    return { status: 'skipped', attempts: 0, error: 'Evolution API não configurada' };
  }
  if (number.length < 12) {
    updateLog(logId, { status: 'failed', last_error: 'Número inválido' });
    return { status: 'failed', attempts: 0, error: 'Número inválido' };
  }

  let lastError = '';
  for (let i = 0; i < config.retryDelaysMs.length; i++) {
    if (config.retryDelaysMs[i]) await sleep(config.retryDelaysMs[i]);
    try {
      const r = await callEvolution(cfg, `/message/sendText/${encodeURIComponent(cfg.instance)}`, 'POST', { number, text });
      if (r.ok) {
        updateLog(logId, { status: 'sent', attempts: i + 1, last_error: null });
        return { status: 'sent', attempts: i + 1 };
      }
      lastError = `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`;
      updateLog(logId, { attempts: i + 1, last_error: lastError });
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break; // erro definitivo
    } catch (e) {
      lastError = e.name === 'AbortError' ? 'Tempo esgotado' : e.message;
      updateLog(logId, { attempts: i + 1, last_error: lastError });
    }
  }
  updateLog(logId, { status: 'failed' });
  console.error(`[whatsapp] falha ao enviar (${purpose}) para ${number}: ${lastError}`);
  return { status: 'failed', attempts: config.retryDelaysMs.length, error: lastError };
}

/** Verifica se a instância está conectada */
async function testConnection(instance) {
  const cfg = evolutionConfig(instance);
  if (!cfg) return { ok: false, error: 'Preencha URL, API key e instância.' };
  try {
    const r = await callEvolution(cfg, `/instance/connectionState/${encodeURIComponent(cfg.instance)}`);
    if (!r.ok) {
      return { ok: false, error: r.status === 404 ? 'Instância não encontrada.' : r.status === 401 ? 'API key inválida.' : `HTTP ${r.status}` };
    }
    const state = r.data?.instance?.state || r.data?.state || 'desconhecido';
    return { ok: state === 'open', state, error: state === 'open' ? undefined : `Instância não conectada (estado: ${state}).` };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Tempo esgotado ao conectar.' : `Falha de conexão: ${e.message}` };
  }
}

module.exports = { sendWhatsApp, testConnection, evolutionConfigured, _config: config };
