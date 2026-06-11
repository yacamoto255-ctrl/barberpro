// db/index.js — SQLite connection singleton (node:sqlite built-in)
'use strict';

const path         = require('path');
const fs           = require('fs');
const { DatabaseSync } = require('node:sqlite');
const createSchema = require('./schema');
const runMigrations = require('./migrate');

function resolveDbPath() {
  const envPath = process.env.DB_PATH;
  if (envPath) {
    // Ensure parent directory exists
    const dir = path.dirname(envPath);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch(_) {}
    }
    // Test if the path is writable
    try {
      fs.accessSync(dir, fs.constants.W_OK);
      return envPath;
    } catch(_) {
      console.warn(`[DB] Cannot write to ${dir}, falling back to app directory`);
    }
  }
  return path.join(__dirname, '..', 'barberpro.db');
}

const DB_PATH = resolveDbPath();
console.log(`[DB] Using database at: ${DB_PATH}`);

let _db;

function getDb() {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    createSchema(_db);
    // Migrations only run on real DB (not :memory: test DBs)
    if (DB_PATH !== ':memory:') {
      runMigrations(_db);
    }
  }
  return _db;
}

function resetDb() { _db = null; }

module.exports = { getDb, resetDb, DB_PATH };
