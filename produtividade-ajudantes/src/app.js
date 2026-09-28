'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const { getDb } = require('./db');
const { requireAuth, requireRole } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/errorHandler');
const clock = require('./utils/clock');
const { METHODS } = require('./domain/allocation');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Cabeçalhos de segurança (CSP sem scripts inline => mitiga XSS)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (config.IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  if (!config.IS_TEST) {
    app.use('/api', (req, res, next) => {
      const t = Date.now();
      res.on('finish', () => console.log(`${clock.now()} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`));
      next();
    });
  }
  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: config.IS_TEST || process.env.LOADTEST_NO_LIMIT ? 1e9 : 600 }));

  app.get('/api/health', (req, res) => {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', time: clock.now(), tz: config.APP_TZ });
  });

  app.use('/api/auth', require('./routes/auth').router);
  app.use('/api/integration', require('./routes/integration'));

  // Tudo abaixo exige login
  app.use('/api', requireAuth);

  const catalogs = require('./routes/catalogs');
  const cfg = require('./routes/config');
  app.use('/api/users', require('./routes/users'));
  app.use('/api/helpers', require('./routes/helpers'));
  app.use('/api/loads', require('./routes/loads'));
  app.use('/api/teams', catalogs.teams);
  app.use('/api/shifts', catalogs.shifts);
  app.use('/api/checkers', catalogs.checkers);
  app.use('/api/squares', catalogs.squares);
  app.use('/api/activity-types', cfg.activityTypes);
  app.use('/api/rules', cfg.rules);
  app.use('/api/operations', require('./routes/operations'));
  app.use('/api', require('./routes/analytics'));

  // Listas para os seletores das telas (todas as funções)
  app.get('/api/meta', requireRole('ADMIN', 'GESTOR', 'OPERADOR'), (req, res) => {
    const db = getDb();
    res.json({
      today: clock.today(),
      now: clock.now(),
      activity_types: db.prepare('SELECT id, code, name, description, requires_square, color FROM activity_types WHERE active=1 ORDER BY sort_order, name').all(),
      squares: db.prepare('SELECT id, code, name FROM squares WHERE active=1 ORDER BY code').all(),
      shifts: db.prepare('SELECT id, name, start_time, end_time FROM shifts WHERE active=1 ORDER BY start_time').all(),
      teams: db.prepare('SELECT id, name FROM teams WHERE active=1 ORDER BY name').all(),
      checkers: db.prepare('SELECT id, name FROM checkers WHERE active=1 ORDER BY name').all(),
      methods: METHODS,
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.', code: 'ROTA' }));

  // Front-end estático (SPA sem build)
  const jsbarcode = require.resolve('jsbarcode/dist/JsBarcode.all.min.js');
  app.get('/vendor/jsbarcode.min.js', (req, res) => res.sendFile(jsbarcode));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.IS_PROD ? '1h' : 0 }));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
