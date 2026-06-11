// db/schema.js — SQLite schema (multi-tenant SaaS)
'use strict';

module.exports = function createSchema(db) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`

    /* ── BARBERSHOPS (tenant root) ──────────────────────────── */
    CREATE TABLE IF NOT EXISTS barbershops (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      slug       TEXT    UNIQUE,
      phone      TEXT,
      address    TEXT,
      plan       TEXT    NOT NULL DEFAULT 'basic' CHECK(plan IN ('basic','pro','enterprise')),
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── USERS ─────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS users (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      barbershop_id  INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      name           TEXT    NOT NULL,
      email          TEXT    NOT NULL UNIQUE,
      password       TEXT    NOT NULL,
      role           TEXT    NOT NULL CHECK(role IN ('super_admin','owner','barber','client')),
      avatar         TEXT,
      phone          TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── BARBERS ────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS barbers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      specialty       TEXT,
      commission_rate REAL    NOT NULL DEFAULT 40.0,
      hire_date       TEXT,
      bio             TEXT,
      status          TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── CLIENTS ────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS clients (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone       TEXT,
      birthdate   TEXT,
      points      INTEGER NOT NULL DEFAULT 0,
      cashback    REAL    NOT NULL DEFAULT 0,
      plan        TEXT    NOT NULL DEFAULT 'Bronze' CHECK(plan IN ('Bronze','Prata','Ouro')),
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── SERVICES ───────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS services (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      barbershop_id  INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      name           TEXT    NOT NULL,
      category       TEXT    NOT NULL DEFAULT 'Corte',
      duration       INTEGER NOT NULL DEFAULT 30,
      price          REAL    NOT NULL,
      description    TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── APPOINTMENTS ───────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS appointments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      barbershop_id  INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      client_id      INTEGER REFERENCES clients(id),
      barber_id      INTEGER REFERENCES barbers(id),
      service_id     INTEGER REFERENCES services(id),
      date           TEXT    NOT NULL,
      time           TEXT    NOT NULL,
      end_time       TEXT,
      status         TEXT    NOT NULL DEFAULT 'pending'
                             CHECK(status IN ('pending','confirmed','cancelled','completed','no_show')),
      price          REAL,
      notes          TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── FINANCIAL CATEGORIES ───────────────────────────────── */
    CREATE TABLE IF NOT EXISTS financial_categories (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      barbershop_id  INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      name           TEXT    NOT NULL,
      type           TEXT    NOT NULL CHECK(type IN ('income','expense')),
      color          TEXT    NOT NULL DEFAULT '#6366f1'
    );

    /* ── FINANCIAL ENTRIES ──────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS financial_entries (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      barbershop_id  INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      type           TEXT    NOT NULL CHECK(type IN ('income','expense')),
      category_id    INTEGER REFERENCES financial_categories(id),
      description    TEXT    NOT NULL,
      amount         REAL    NOT NULL,
      date           TEXT    NOT NULL,
      payment_method TEXT    NOT NULL DEFAULT 'cash'
                             CHECK(payment_method IN ('cash','pix','credit','debit','transfer')),
      appointment_id INTEGER REFERENCES appointments(id),
      recurrent      INTEGER NOT NULL DEFAULT 0,
      notes          TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── COMMISSIONS ────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS commissions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      barber_id         INTEGER NOT NULL REFERENCES barbers(id),
      period_start      TEXT    NOT NULL,
      period_end        TEXT    NOT NULL,
      gross_amount      REAL    NOT NULL DEFAULT 0,
      commission_rate   REAL    NOT NULL DEFAULT 40,
      commission_amount REAL    NOT NULL DEFAULT 0,
      services_count    INTEGER NOT NULL DEFAULT 0,
      paid              INTEGER NOT NULL DEFAULT 0,
      paid_at           TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── INVENTORY ──────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS inventory (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      barbershop_id  INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      name           TEXT    NOT NULL,
      category       TEXT    NOT NULL,
      qty            REAL    NOT NULL DEFAULT 0,
      min_qty        REAL    NOT NULL DEFAULT 5,
      unit           TEXT    NOT NULL DEFAULT 'un',
      unit_cost      REAL    NOT NULL DEFAULT 0,
      supplier       TEXT,
      sku            TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── INVENTORY MOVEMENTS ────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL REFERENCES inventory(id),
      type       TEXT    NOT NULL CHECK(type IN ('in','out','adjustment')),
      qty        REAL    NOT NULL,
      reason     TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── LOYALTY TRANSACTIONS ───────────────────────────────── */
    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id      INTEGER NOT NULL REFERENCES clients(id),
      points         INTEGER NOT NULL,
      action         TEXT    NOT NULL,
      appointment_id INTEGER REFERENCES appointments(id),
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── NOTIFICATIONS ──────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      title      TEXT    NOT NULL,
      body       TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'info'
                         CHECK(type IN ('info','success','warning','error')),
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── SETTINGS ───────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS settings (
      barbershop_id INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      key           TEXT    NOT NULL,
      value         TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (barbershop_id, key)
    );

    /* ── SCHEDULE BLOCKS ───────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      barbershop_id  INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      barber_id      INTEGER REFERENCES barbers(id)     ON DELETE CASCADE,
      title          TEXT    NOT NULL,
      start_date     TEXT    NOT NULL,
      end_date       TEXT    NOT NULL,
      start_time     TEXT,
      end_time       TEXT,
      repeat_type    TEXT    NOT NULL DEFAULT 'none',
      color          TEXT    NOT NULL DEFAULT '#6366f1',
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── CAIXA (sessões e movimentações) ───────────────────── */
    CREATE TABLE IF NOT EXISTS cash_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      barbershop_id   INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      opened_by       INTEGER REFERENCES users(id),
      opened_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      closed_at       TEXT,
      initial_balance REAL    NOT NULL DEFAULT 0,
      final_balance   REAL,
      notes           TEXT,
      status          TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed'))
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
      barbershop_id   INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
      type            TEXT    NOT NULL CHECK(type IN ('income','expense')),
      description     TEXT    NOT NULL,
      amount          REAL    NOT NULL,
      payment_method  TEXT    NOT NULL DEFAULT 'pix' CHECK(payment_method IN ('pix','credit','debit','cash','transfer')),
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    /* ── BARBER SERVICES (many-to-many) ─────────────────────── */
    CREATE TABLE IF NOT EXISTS barber_services (
      barber_id  INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      PRIMARY KEY (barber_id, service_id)
    );

    /* ── INDEXES ────────────────────────────────────────────── */
    CREATE INDEX IF NOT EXISTS idx_users_barbershop      ON users(barbershop_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_bs       ON appointments(barbershop_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(date);
    CREATE INDEX IF NOT EXISTS idx_appointments_barber   ON appointments(barber_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_client   ON appointments(client_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_status   ON appointments(status);
    CREATE INDEX IF NOT EXISTS idx_financial_bs          ON financial_entries(barbershop_id);
    CREATE INDEX IF NOT EXISTS idx_financial_date        ON financial_entries(date);
    CREATE INDEX IF NOT EXISTS idx_financial_type        ON financial_entries(type);
    CREATE INDEX IF NOT EXISTS idx_inventory_bs          ON inventory(barbershop_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_services_bs           ON services(barbershop_id);
  `);
};
