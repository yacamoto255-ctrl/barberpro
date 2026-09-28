'use strict';
// Backup manual (ou agendado via cron/Agendador de Tarefas): cópia consistente do banco com VACUUM INTO,
// seguro mesmo com o sistema em uso. Mantém os últimos N arquivos (BACKUP_KEEP, padrão 30).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');

const dir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(config.DB_PATH)) { console.error(`Banco não encontrado: ${config.DB_PATH}`); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(dir, `logiponto-${stamp}.db`);
const db = new DatabaseSync(config.DB_PATH);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
const check = new DatabaseSync(file, { readOnly: true });
const ok = check.prepare('PRAGMA integrity_check').get();
const counts = ['helpers', 'loads', 'activities', 'activity_participants', 'audit_logs'].map(t => `${t}=${check.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c}`);
check.close();
if (Object.values(ok)[0] !== 'ok') { console.error('Backup com falha de integridade!'); process.exit(1); }
const keep = Number(process.env.BACKUP_KEEP) || 30;
const old = fs.readdirSync(dir).filter(f => /^logiponto-.*\.db$/.test(f)).sort().reverse().slice(keep);
old.forEach(f => fs.rmSync(path.join(dir, f)));
console.log(`Backup OK: ${file} (${counts.join(', ')})${old.length ? ` — ${old.length} backup(s) antigo(s) removido(s)` : ''}`);
