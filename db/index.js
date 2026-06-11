// db/index.js — SQLite connection singleton (node:sqlite built-in)
'use strict';

const path         = require('path');
const { DatabaseSync } = require('node:sqlite');
const createSchema = require('./schema');
const runMigrations = require('./migrate');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'barberpro.db');

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

module.exports = { getDb, resetDb };
