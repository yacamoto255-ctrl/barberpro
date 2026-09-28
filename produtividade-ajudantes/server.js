'use strict';
try { process.loadEnvFile?.(); } catch (_) { /* .env é opcional */ }
const config = require('./src/config');
const { createApp } = require('./src/app');
const { getDb, close } = require('./src/db');

getDb(); // aplica migrações
const count = getDb().prepare('SELECT COUNT(*) c FROM users').get().c;
if (!count) console.warn('[AVISO] Banco sem usuários. Rode "npm run seed" para carregar dados de demonstração.');

const server = createApp().listen(config.PORT, () => {
  console.log(`LogiPonto rodando em http://localhost:${config.PORT} (fuso ${config.APP_TZ}, banco ${config.DB_PATH})`);
});

function shutdown() {
  server.close(() => { close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
