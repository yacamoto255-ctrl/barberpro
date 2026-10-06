// src/db.js — conexão SQLite (node:sqlite) + schema
'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  email               TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  phone               TEXT,
  password_hash       TEXT    NOT NULL,
  role                TEXT    NOT NULL CHECK (role IN ('admin','operator')),
  active              INTEGER NOT NULL DEFAULT 1,
  failed_logins       INTEGER NOT NULL DEFAULT 0,
  locked_until        INTEGER,
  password_changed_at INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                  TEXT    NOT NULL UNIQUE,
  name                  TEXT    NOT NULL,
  category              TEXT    NOT NULL DEFAULT 'outro',
  tagline               TEXT,
  description           TEXT,
  phone                 TEXT,
  whatsapp              TEXT,
  email                 TEXT,
  instagram             TEXT,
  cnpj                  TEXT,
  cep                   TEXT,
  address               TEXT,
  city                  TEXT,
  state                 TEXT,
  theme_json            TEXT,
  logo_image_id         INTEGER,
  hero_image_id         INTEGER,
  published             INTEGER NOT NULL DEFAULT 0,
  booking_enabled       INTEGER NOT NULL DEFAULT 1,
  slot_interval_min     INTEGER NOT NULL DEFAULT 30,
  min_notice_min        INTEGER NOT NULL DEFAULT 60,
  max_days_ahead        INTEGER NOT NULL DEFAULT 30,
  notify_whatsapp       INTEGER NOT NULL DEFAULT 1,
  notify_client_whatsapp INTEGER NOT NULL DEFAULT 1,
  evolution_instance    TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  description  TEXT,
  duration_min INTEGER NOT NULL,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, name)
);
CREATE INDEX IF NOT EXISTS idx_services_site ON services(site_id);

CREATE TABLE IF NOT EXISTS professionals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id        INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  title          TEXT,
  bio            TEXT,
  photo_image_id INTEGER,
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_professionals_site ON professionals(site_id);

-- Sem linhas para um profissional = ele atende todos os serviços do site
CREATE TABLE IF NOT EXISTS professional_services (
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, service_id)
);

CREATE TABLE IF NOT EXISTS business_hours (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_time  TEXT    NOT NULL,
  close_time TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hours_site ON business_hours(site_id, weekday);

CREATE TABLE IF NOT EXISTS blocks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
  starts_at       TEXT    NOT NULL,
  ends_at         TEXT    NOT NULL,
  reason          TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_blocks_site ON blocks(site_id, starts_at);

CREATE TABLE IF NOT EXISTS bookings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id           INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  service_id        INTEGER REFERENCES services(id) ON DELETE SET NULL,
  professional_id   INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
  service_name      TEXT    NOT NULL,
  professional_name TEXT,
  price_cents       INTEGER NOT NULL DEFAULT 0,
  client_name       TEXT    NOT NULL,
  client_phone      TEXT    NOT NULL,
  client_email      TEXT,
  notes             TEXT,
  starts_at         TEXT    NOT NULL,
  ends_at           TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  source            TEXT    NOT NULL DEFAULT 'site' CHECK (source IN ('site','panel')),
  cancel_token_hash TEXT    UNIQUE,
  cancelled_by      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_site_time ON bookings(site_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_prof_time ON bookings(professional_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  read_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at);

CREATE TABLE IF NOT EXISTS message_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  channel     TEXT    NOT NULL DEFAULT 'whatsapp',
  recipient   TEXT    NOT NULL,
  purpose     TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('pending','sent','failed','skipped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('logo','hero','gallery','professional')),
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  data       BLOB    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_images_site ON images(site_id, kind);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  user_email TEXT,
  action     TEXT    NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT,
  ip         TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return path.join(__dirname, '..', 'data', 'sitebuilder.db');
}

let _db = null;
let _path = null;

function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA);
  return db;
}

function getDb() {
  if (!_db) {
    _path = resolveDbPath();
    _db = open(_path);
  }
  return _db;
}

function getDbPath() {
  getDb();
  return _path;
}

function closeDb() {
  if (_db) {
    try { _db.close(); } catch (_) { /* já fechado */ }
  }
  _db = null;
}

/** Executa fn dentro de uma transação (BEGIN IMMEDIATE trava escrita). */
function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(db);
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* nada a desfazer */ }
    throw e;
  }
}

module.exports = { getDb, getDbPath, closeDb, transaction, SCHEMA };
