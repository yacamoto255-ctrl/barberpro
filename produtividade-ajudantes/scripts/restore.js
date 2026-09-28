'use strict';
// Restauração: npm run restore -- backups/logiponto-AAAA-....db
// PARE o servidor antes. O banco atual é preservado como .antes-da-restauracao.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('Informe o arquivo de backup: npm run restore -- <arquivo.db>'); process.exit(1); }
const test = new DatabaseSync(src, { readOnly: true });
const ok = Object.values(test.prepare('PRAGMA integrity_check').get())[0] === 'ok';
const hasSchema = !!test.prepare(`SELECT 1 FROM sqlite_master WHERE name='activity_participants'`).get();
test.close();
if (!ok || !hasSchema) { console.error('Arquivo inválido ou corrompido. Restauração cancelada.'); process.exit(1); }
if (fs.existsSync(config.DB_PATH)) fs.copyFileSync(config.DB_PATH, `${config.DB_PATH}.antes-da-restauracao`);
for (const s of ['-wal', '-shm']) fs.rmSync(config.DB_PATH + s, { force: true });
fs.copyFileSync(src, config.DB_PATH);
console.log(`Restaurado ${src} -> ${config.DB_PATH}. Inicie o servidor novamente.`);
