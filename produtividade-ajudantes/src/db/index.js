'use strict';
// Conexão SQLite (módulo nativo node:sqlite — sem dependência compilada).
// Para produção com vários servidores, trocar por PostgreSQL mantendo as consultas.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { runMigrations } = require('./migrations');

let db;

function open(dbPath = config.DB_PATH) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new DatabaseSync(dbPath);
  conn.exec('PRAGMA foreign_keys = ON;');
  conn.exec('PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') conn.exec('PRAGMA journal_mode = WAL;');
  runMigrations(conn);
  return conn;
}

function getDb() {
  if (!db) db = open();
  return db;
}

function close() {
  if (db) { db.close(); db = null; }
}

/** Executa fn dentro de uma transação (BEGIN IMMEDIATE evita corrida entre dois bipes). */
function tx(fn) {
  const conn = getDb();
  if (conn.isTransaction) return fn(conn);
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (e) {
    conn.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { getDb, close, tx, open };
