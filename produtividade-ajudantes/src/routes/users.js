'use strict';
// Gestão de usuários (somente ADMIN). Recuperação de senha no MVP = redefinição pelo ADMIN.
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const clock = require('../utils/clock');
const audit = require('../services/audit');
const { validate, toInt } = require('../utils/validate');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { requireRole, ROLES } = require('../middleware/auth');
const { passwordPolicy } = require('./auth');

const router = express.Router();
router.use(requireRole('ADMIN'));

const COLS = 'id, name, email, role, active, last_login_at, created_at, updated_at';
const SCHEMA = {
  name: { type: 'string', required: true, max: 100, label: 'Nome' },
  email: { type: 'string', required: true, max: 120, label: 'E-mail', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, patternMsg: 'E-mail inválido.' },
  role: { type: 'enum', required: true, values: ROLES, label: 'Perfil' },
  active: { type: 'bool' },
};

function otherActiveAdmins(id) {
  return getDb().prepare(`SELECT COUNT(*) c FROM users WHERE role='ADMIN' AND active=1 AND id<>?`).get(id).c;
}

router.get('/', (req, res) => res.json(getDb().prepare(`SELECT ${COLS} FROM users ORDER BY name`).all()));

router.post('/', (req, res) => {
  const d = validate(req.body, SCHEMA);
  passwordPolicy(req.body?.password);
  d.email = d.email.toLowerCase();
  if (getDb().prepare('SELECT 1 FROM users WHERE email=?').get(d.email)) throw conflict('E-mail já cadastrado.', null, 'EMAIL_DUPLICADO');
  const ts = clock.now();
  const r = getDb().prepare(`INSERT INTO users (name,email,role,active,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(d.name, d.email, d.role, d.active ?? 1, bcrypt.hashSync(req.body.password, 10), ts, ts);
  const row = getDb().prepare(`SELECT ${COLS} FROM users WHERE id=?`).get(Number(r.lastInsertRowid));
  audit.log({ req, action: 'CRIAR', entity: 'users', entityId: row.id, after: row });
  res.status(201).json(row);
});

router.patch('/:id', (req, res) => {
  const id = toInt(req.params.id);
  const before = getDb().prepare(`SELECT ${COLS} FROM users WHERE id=?`).get(id);
  if (!before) throw notFound('Usuário não encontrado.');
  const d = validate(req.body, SCHEMA, { partial: true });
  for (const k of ['name', 'email', 'role']) if (k in d && !d[k]) throw badRequest(`${SCHEMA[k].label} é obrigatório.`);
  if (d.email) {
    d.email = d.email.toLowerCase();
    if (getDb().prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(d.email, id)) throw conflict('E-mail já cadastrado.', null, 'EMAIL_DUPLICADO');
  }
  const losingAdmin = before.role === 'ADMIN' && ((d.role && d.role !== 'ADMIN') || d.active === 0);
  if (losingAdmin && otherActiveAdmins(id) === 0) throw conflict('Não é possível remover o último administrador ativo.', null, 'ULTIMO_ADMIN');
  const cols = Object.keys(d);
  // Mudança de perfil ou inativação derruba as sessões abertas.
  const revoke = (d.role && d.role !== before.role) || d.active === 0 ? ', token_version=token_version+1' : '';
  if (cols.length) getDb().prepare(`UPDATE users SET ${cols.map(c => `${c}=?`).join(',')}${revoke}, updated_at=? WHERE id=?`).run(...cols.map(c => d[c]), clock.now(), id);
  const after = getDb().prepare(`SELECT ${COLS} FROM users WHERE id=?`).get(id);
  audit.log({ req, action: 'EDITAR', entity: 'users', entityId: id, before, after });
  res.json(after);
});

router.post('/:id/reset-password', (req, res) => {
  const id = toInt(req.params.id);
  const u = getDb().prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!u) throw notFound('Usuário não encontrado.');
  passwordPolicy(req.body?.password);
  getDb().prepare('UPDATE users SET password_hash=?, token_version=token_version+1, failed_attempts=0, locked_until=NULL, updated_at=? WHERE id=?')
    .run(bcrypt.hashSync(req.body.password, 10), clock.now(), id);
  audit.log({ req, action: 'REDEFINIR_SENHA', entity: 'users', entityId: id });
  res.json({ ok: true });
});

module.exports = router;
