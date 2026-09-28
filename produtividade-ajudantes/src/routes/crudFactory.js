'use strict';
// Fábrica de rotas CRUD para cadastros simples (equipes, turnos, conferentes, praças...).
// Toda escrita gera auditoria. Exclusão física só é permitida se o registro não estiver em uso.
const express = require('express');
const { getDb } = require('../db');
const clock = require('../utils/clock');
const audit = require('../services/audit');
const { validate, toInt } = require('../utils/validate');
const { notFound, conflict } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');

function crud({ table, schema, search = ['name'], orderBy = 'name', read = ['ADMIN', 'GESTOR', 'OPERADOR'], write = ['ADMIN', 'GESTOR'], prepare, select }) {
  const router = express.Router();
  const selectSql = select || `SELECT * FROM ${table}`;
  const getOne = (id) => getDb().prepare(`SELECT * FROM (${selectSql}) x WHERE id = ?`).get(id);

  router.get('/', requireRole(...read), (req, res) => {
    const w = []; const p = [];
    if (req.query.q) { w.push('(' + search.map(c => `${c} LIKE ?`).join(' OR ') + ')'); search.forEach(() => p.push(`%${req.query.q}%`)); }
    if (req.query.active === '1' || req.query.active === '0') { w.push('active = ?'); p.push(Number(req.query.active)); }
    const sql = `SELECT * FROM (${selectSql}) x ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${orderBy} LIMIT 1000`;
    res.json(getDb().prepare(sql).all(...p));
  });

  router.get('/:id', requireRole(...read), (req, res) => {
    const row = getOne(toInt(req.params.id));
    if (!row) throw notFound();
    res.json(row);
  });

  router.post('/', requireRole(...write), (req, res) => {
    let data = validate(req.body, schema);
    if (prepare) data = prepare(data, null);
    const ts = clock.now();
    const cols = Object.keys(data);
    const r = getDb().prepare(`INSERT INTO ${table} (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, ?, ?)`)
      .run(...cols.map(c => data[c]), ts, ts);
    const row = getOne(Number(r.lastInsertRowid));
    audit.log({ req, action: 'CRIAR', entity: table, entityId: row.id, after: row });
    res.status(201).json(row);
  });

  const update = (req, res) => {
    const id = toInt(req.params.id);
    const before = getDb().prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!before) throw notFound();
    let data = validate(req.body, schema, { partial: true });
    if (prepare) data = prepare(data, before);
    const cols = Object.keys(data);
    if (cols.length) {
      getDb().prepare(`UPDATE ${table} SET ${cols.map(c => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`)
        .run(...cols.map(c => data[c]), clock.now(), id);
    }
    const after = getDb().prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    const action = 'active' in data && before.active !== after.active ? (after.active ? 'ATIVAR' : 'INATIVAR') : 'EDITAR';
    audit.log({ req, action, entity: table, entityId: id, before, after });
    res.json(getOne(id));
  };
  router.put('/:id', requireRole(...write), update);
  router.patch('/:id', requireRole(...write), update);

  router.delete('/:id', requireRole(...write), (req, res) => {
    const id = toInt(req.params.id);
    const before = getDb().prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!before) throw notFound();
    try {
      getDb().prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    } catch (e) {
      if (String(e.message).includes('FOREIGN KEY')) throw conflict('Registro em uso por outros cadastros/apontamentos. Inative em vez de excluir.', null, 'EM_USO');
      throw e;
    }
    audit.log({ req, action: 'EXCLUIR', entity: table, entityId: id, before });
    res.status(204).end();
  });

  return router;
}

module.exports = { crud };
