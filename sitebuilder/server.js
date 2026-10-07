// server.js — inicia o servidor da Versal Estúdio (gerador de sites com agendamento)
'use strict';

// Silencia apenas o aviso "SQLite is an experimental feature" do node:sqlite
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  return emitWarning.call(process, warning, ...args);
};

try { process.loadEnvFile?.(); } catch (_) { /* sem .env, segue com as variáveis do ambiente */ }

const { createApp } = require('./src/app');
const { getDb, getDbPath, closeDb } = require('./src/db');
const { startAutoBackup } = require('./src/services/backup');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.warn('[aviso] JWT_SECRET não definido: usando segredo aleatório guardado no banco. Defina JWT_SECRET (64+ caracteres) no ambiente.');
}

getDb();
console.log(`[db] banco em ${getDbPath()}`);

function requestLog(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path.startsWith('/assets') || req.path.startsWith('/img/')) return;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}

const app = createApp({ logger: process.env.LOG_REQUESTS === '0' ? null : requestLog });
startAutoBackup();

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => {
  console.log(`[server] Versal Estúdio rodando em http://localhost:${PORT}  (painel: /admin)`);
});

function shutdown(sig) {
  console.log(`[server] ${sig} recebido, encerrando...`);
  server.close(() => { closeDb(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
