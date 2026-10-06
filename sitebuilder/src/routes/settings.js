// src/routes/settings.js — configurações da agência, integrações e auditoria (somente admin)
'use strict';

const express = require('express');
const { getDb } = require('../db');
const { Checker, HttpError } = require('../validators');
const { requireAuth, requireRole } = require('../auth');
const { audit } = require('../audit');
const { ah } = require('../util');
const { getSetting, setSetting, maskSecret } = require('../settings');
const { testConnection, sendWhatsApp } = require('../services/whatsapp');
const theme = require('../services/theme');

function settingsOut() {
  const ak = getSetting('anthropic_api_key');
  const ek = getSetting('evolution_apikey');
  return {
    agency_name: getSetting('agency_name'),
    agency_instagram: getSetting('agency_instagram'),
    evolution_url: getSetting('evolution_url') || '',
    evolution_instance: getSetting('evolution_instance') || '',
    evolution_apikey: maskSecret(ek),
    has_evolution_apikey: !!ek,
    anthropic_api_key: maskSecret(ak),
    has_anthropic_key: !!ak,
    anthropic_key_from_env: !ak && !!process.env.ANTHROPIC_API_KEY,
    ai_model: theme.MODEL,
  };
}

module.exports = () => {
  const settings = express.Router();
  settings.use(requireAuth, requireRole('admin'));

  settings.get('/', (req, res) => res.json({ settings: settingsOut() }));

  settings.put('/', (req, res) => {
    const c = new Checker(req.body, { partial: true });
    const agencyName = c.str('agency_name', 'Nome da agência', { required: true, max: 80 });
    const agencyIg = c.instagram('agency_instagram', 'Instagram da agência');
    const evoUrl = c.str('evolution_url', 'URL da Evolution API', { max: 300 });
    const evoInstance = c.str('evolution_instance', 'Instância', { max: 80 });
    const evoKey = c.str('evolution_apikey', 'API key da Evolution', { max: 300 });
    const aiKey = c.str('anthropic_api_key', 'Chave da Anthropic', { max: 300 });
    c.done();
    if (evoUrl) {
      let u;
      try { u = new URL(evoUrl); } catch { u = null; }
      if (!u || !['http:', 'https:'].includes(u.protocol)) {
        throw new HttpError(400, 'URL da Evolution API inválida.', { fields: { evolution_url: 'Use http:// ou https://' } });
      }
    }
    if (aiKey && !aiKey.includes('••') && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(aiKey)) {
      throw new HttpError(400, 'Chave da Anthropic em formato inválido (começa com sk-ant-).', { fields: { anthropic_api_key: 'Formato inválido.' } });
    }
    const changed = [];
    const put = (k, v) => { if (v !== undefined) { setSetting(k, v || null); changed.push(k); } };
    put('agency_name', agencyName);
    put('agency_instagram', agencyIg);
    put('evolution_url', evoUrl);
    put('evolution_instance', evoInstance);
    // Campos mascarados (••••) voltam do formulário sem alteração: não sobrescreve
    if (evoKey !== undefined && !evoKey.includes('••')) put('evolution_apikey', evoKey);
    if (aiKey !== undefined && !aiKey.includes('••')) put('anthropic_api_key', aiKey);
    audit(req, 'settings.update', 'settings', null, { changed });
    res.json({ settings: settingsOut() });
  });

  settings.post('/test-whatsapp', ah(async (req, res) => {
    const c = new Checker(req.body || {});
    const to = c.phone('to', 'Número de teste');
    c.done();
    const conn = await testConnection();
    let send = null;
    if (conn.ok && to) {
      send = await sendWhatsApp({ to, text: 'Teste de conexão — Versal Estúdio ✅', purpose: 'test' });
    }
    audit(req, 'settings.test_whatsapp', 'settings', null, { ok: conn.ok, send: send?.status });
    res.json({ connection: conn, send });
  }));

  settings.get('/message-log', (req, res) => {
    res.json({ messages: getDb().prepare('SELECT * FROM message_log ORDER BY id DESC LIMIT 100').all() });
  });

  /* ── Auditoria ─────────────────────────────────────────── */
  const auditRouter = express.Router();
  auditRouter.use(requireAuth, requireRole('admin'));
  auditRouter.get('/', (req, res) => {
    const c = new Checker(req.query);
    const action = c.str('action', 'Ação', { max: 60 });
    const from = c.date('from', 'Data inicial');
    const to = c.date('to', 'Data final');
    c.done();
    const where = [];
    const params = [];
    if (action) { where.push('action LIKE ?'); params.push(`${action.replace(/[%_]/g, '')}%`); }
    if (from) { where.push('created_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('created_at <= ?'); params.push(`${to} 23:59:59`); }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const db = getDb();
    res.json({
      total: db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${sql}`).get(...params).n,
      logs: db.prepare(`SELECT * FROM audit_logs ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit),
    });
  });

  /* ── Metadados de tema (painel) ────────────────────────── */
  const themes = express.Router();
  themes.use(requireAuth, requireRole('admin', 'operator'));
  themes.get('/', (req, res) => {
    res.json({
      presets: Object.entries(theme.PRESETS).map(([id, p]) => ({ id, label: p.label, theme: theme.presetTheme(id) })),
      heading_fonts: Object.keys(theme.HEADING_FONTS),
      body_fonts: Object.keys(theme.BODY_FONTS),
      hero_layouts: theme.HERO_LAYOUTS,
      radii: theme.RADII,
      backgrounds: theme.BACKGROUNDS,
      copy_limits: theme.COPY_LIMITS,
      ai_available: !!theme.apiKey(),
    });
  });

  return { settings, audit: auditRouter, themes };
};
