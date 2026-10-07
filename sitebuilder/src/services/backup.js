// src/services/backup.js — backup (manual e automático) e restauração do banco SQLite
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { getDb, getDbPath, closeDb } = require('../db');
const { HttpError } = require('../validators');

const NAME_RE = /^(manual|auto|pre-restore|upload)-\d{8}-\d{6}(-\d+)?\.db$/;
const REQUIRED_TABLES = ['users', 'sites', 'services', 'bookings', 'settings'];

function backupDir() {
  const dir = process.env.BACKUP_DIR || path.join(path.dirname(getDbPath() === ':memory:' ? path.join(__dirname, '..', '..', 'data', 'x') : getDbPath()), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function uniqueName(kind) {
  const dir = backupDir();
  let name = `${kind}-${stamp()}.db`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${kind}-${stamp()}-${i}.db`;
  return name;
}

function info(name) {
  const st = fs.statSync(path.join(backupDir(), name));
  return { name, size: st.size, created_at: st.mtime.toISOString(), kind: name.split('-')[0] };
}

/** Cria cópia consistente com VACUUM INTO (funciona com o banco em uso) */
function createBackup(kind = 'manual') {
  const name = uniqueName(kind);
  const file = path.join(backupDir(), name);
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return info(name);
}

function listBackups() {
  return fs.readdirSync(backupDir()).filter((n) => NAME_RE.test(n)).map(info)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.name.localeCompare(a.name));
}

function resolveBackup(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new HttpError(400, 'Nome de backup inválido.');
  const file = path.join(backupDir(), name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Backup não encontrado.');
  return file;
}

/** Confere se o arquivo é um banco SQLite íntegro com as tabelas do sistema */
function verifyFile(file) {
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(16);
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString('latin1') !== 'SQLite format 3\u0000') throw new HttpError(400, 'O arquivo não é um banco SQLite.');
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const ok = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(ok)[0] !== 'ok') throw new HttpError(400, 'O backup está corrompido.');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length) throw new HttpError(400, `O backup não é deste sistema (faltam tabelas: ${missing.join(', ')}).`);
    return {
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      sites: db.prepare('SELECT COUNT(*) AS n FROM sites').get().n,
      bookings: db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,
    };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, `Não foi possível ler o backup: ${e.message}`);
  } finally {
    try { db?.close(); } catch (_) { /* já fechado */ }
  }
}

/**
 * Restaura um backup. Antes, salva o estado atual como "pre-restore" para permitir voltar atrás.
 */
function restoreBackup(name) {
  const src = resolveBackup(name);
  const counts = verifyFile(src);
  const dbPath = getDbPath();
  if (dbPath === ':memory:') throw new HttpError(400, 'Restauração indisponível com banco em memória.');
  const safety = createBackup('pre-restore');
  closeDb();
  for (const ext of ['-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (_) { /* não existe */ }
  }
  fs.copyFileSync(src, dbPath);
  getDb(); // reabre e garante o schema
  return { restored: name, safety_backup: safety.name, counts };
}

function saveUploadedBackup(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100) throw new HttpError(400, 'Arquivo vazio ou inválido.');
  const name = uniqueName('upload');
  const file = path.join(backupDir(), name);
  fs.writeFileSync(file, buf);
  try {
    verifyFile(file);
  } catch (e) {
    fs.unlinkSync(file);
    throw e;
  }
  return info(name);
}

function deleteBackup(name) {
  fs.unlinkSync(resolveBackup(name));
}

/** Remove backups automáticos antigos, mantendo os `keep` mais recentes */
function pruneAuto(keep) {
  const autos = listBackups().filter((b) => b.kind === 'auto');
  for (const b of autos.slice(keep)) fs.unlinkSync(path.join(backupDir(), b.name));
}

function startAutoBackup({ hours = Number(process.env.BACKUP_INTERVAL_HOURS) || 24, keep = Number(process.env.BACKUP_KEEP) || 14 } = {}) {
  if (hours <= 0) return null;
  const run = () => {
    try {
      const b = createBackup('auto');
      pruneAuto(keep);
      console.log(`[backup] automático criado: ${b.name} (${b.size} bytes)`);
    } catch (e) {
      console.error('[backup] falha no backup automático:', e.message);
    }
  };
  const timer = setInterval(run, hours * 3_600_000);
  timer.unref();
  return { timer, run };
}

module.exports = {
  createBackup, listBackups, resolveBackup, restoreBackup, saveUploadedBackup, deleteBackup, verifyFile,
  pruneAuto, startAutoBackup, backupDir,
};
