// src/app.js — monta o app Express (exportado separado do listen para os testes)
'use strict';

const path = require('path');
const express = require('express');
const { getDb } = require('./db');
const { HttpError } = require('./validators');
const { rateLimit } = require('./rateLimit');

const IS_PROD = process.env.NODE_ENV === 'production';
const envInt = (k, d) => (process.env[k] !== undefined ? Number(process.env[k]) : d);

function defaultLimits() {
  return {
    login: rateLimit({ name: 'login', windowMs: 15 * 60_000, max: envInt('RATE_LIMIT_LOGIN', 20), message: 'Muitas tentativas. Aguarde 15 minutos.' }),
    publicWrite: rateLimit({ name: 'pubw', windowMs: 60 * 60_000, max: envInt('RATE_LIMIT_PUBLIC_WRITE', 15), message: 'Muitos agendamentos seguidos. Tente mais tarde ou chame no WhatsApp.' }),
    publicRead: rateLimit({ name: 'pubr', windowMs: 60_000, max: envInt('RATE_LIMIT_PUBLIC_READ', 300) }),
    ai: rateLimit({ name: 'ai', windowMs: 10 * 60_000, max: envInt('RATE_LIMIT_AI', 10), message: 'Muitas gerações com IA. Aguarde alguns minutos.' }),
  };
}

function createApp({ limits = defaultLimits(), logger = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (IS_PROD || process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  if (logger) app.use(logger);

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));

  /* ── Público ───────────────────────────────────────────── */
  const pub = require('./routes/public')(limits);
  app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets'), { maxAge: IS_PROD ? '1h' : 0 }));
  app.use(pub.pages);
  app.use('/api/public', pub.api);

  /* ── Painel ────────────────────────────────────────────── */
  app.use('/admin', (req, res, next) => {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
      "connect-src 'self' https://viacep.com.br", "frame-src 'self'", "font-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
    ].join('; '));
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  }, express.static(path.join(__dirname, '..', 'public', 'admin'), { maxAge: 0, index: 'index.html' }));
  app.get('/', (req, res) => res.redirect('/admin/'));

  /* ── API autenticada ───────────────────────────────────── */
  const st = require('./routes/settings')();
  app.use('/api/auth', require('./routes/auth')(limits));
  app.use('/api/users', require('./routes/users')());
  app.use('/api/sites', require('./routes/sites')(limits));
  app.use('/api/bookings', require('./routes/bookings')());
  app.use('/api/notifications', require('./routes/notifications')());
  app.use('/api/dashboard', require('./routes/dashboard')());
  app.use('/api/reports', require('./routes/reports')());
  app.use('/api/settings', st.settings);
  app.use('/api/audit', st.audit);
  app.use('/api/themes', st.themes);
  app.use('/api/backups', require('./routes/backups')());

  app.get('/api/health', (req, res) => {
    try {
      getDb().prepare('SELECT 1').get();
      res.json({ ok: true, db: 'ok', uptime_s: Math.round(process.uptime()) });
    } catch (e) {
      res.status(503).json({ ok: false, db: 'erro' });
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo ou conteúdo muito grande. Imagens: até 2 MB.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Conteúdo da requisição inválido.' });
    console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ error: 'Erro interno. Tente novamente; se persistir, avise o suporte.' });
  });

  return app;
}

module.exports = { createApp, defaultLimits };
