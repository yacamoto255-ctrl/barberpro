// src/routes/users.js — gestão da equipe da agência (somente admin)
'use strict';

const express = require('express');
const { getDb } = require('../db');
const { Checker, HttpError, defined } = require('../validators');
const { requireAuth, requireRole, hashPassword } = require('../auth');
const { audit } = require('../audit');
const { ah, idParam, baseUrl } = require('../util');
const { createResetToken, publicUser } = require('./auth');

const COLS = 'id, name, email, phone, role, active, locked_until, created_at, updated_at';

module.exports = () => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', (req, res) => {
    res.json({ users: getDb().prepare(`SELECT ${COLS} FROM users ORDER BY name`).all() });
  });

  router.post('/', ah(async (req, res) => {
    const c = new Checker(req.body);
    const data = {
      name: c.str('name', 'Nome', { required: true, min: 2, max: 120 }),
      email: c.email('email', 'E-mail', { required: true }),
      phone: c.phone('phone', 'WhatsApp'),
      role: c.oneOf('role', 'Perfil', ['admin', 'operator'], { required: true }),
    };
    const password = c.password('password', 'Senha');
    c.done();
    const db = getDb();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(data.email)) {
      throw new HttpError(409, 'Já existe um usuário com este e-mail.', { fields: { email: 'E-mail já cadastrado.' } });
    }
    const info = db.prepare(
      'INSERT INTO users (name, email, phone, role, password_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(data.name, data.email, data.phone || null, data.role, hashPassword(password));
    audit(req, 'user.create', 'user', Number(info.lastInsertRowid), { email: data.email, role: data.role });
    res.status(201).json({ user: db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(info.lastInsertRowid) });
  }));

  router.patch('/:id', ah(async (req, res) => {
    const id = idParam(req);
    const db = getDb();
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Usuário não encontrado.');

    const c = new Checker(req.body, { partial: true });
    const data = defined({
      name: c.str('name', 'Nome', { required: true, min: 2, max: 120 }),
      email: c.email('email', 'E-mail', { required: true }),
      phone: c.phone('phone', 'WhatsApp'),
      role: c.oneOf('role', 'Perfil', ['admin', 'operator']),
      active: c.bool('active', 'Ativo'),
    });
    const password = c.has('password') ? c.password('password', 'Senha') : undefined;
    c.done();

    if (data.email && data.email !== current.email
      && db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(data.email, id)) {
      throw new HttpError(409, 'Já existe um usuário com este e-mail.', { fields: { email: 'E-mail já cadastrado.' } });
    }
    const demoting = (data.role && data.role !== 'admin') || data.active === 0;
    if (current.role === 'admin' && demoting) {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(id);
      if (n === 0) throw new HttpError(400, 'Não é possível remover o último administrador ativo.');
    }
    if (id === req.user.id && data.active === 0) throw new HttpError(400, 'Você não pode desativar a própria conta.');

    if (password) {
      data.password_hash = hashPassword(password);
      data.password_changed_at = Math.floor(Date.now() / 1000);
    }
    if ('phone' in data && !data.phone) data.phone = null;
    if (data.active === 1) { data.failed_logins = 0; data.locked_until = null; }
    if (Object.keys(data).length) {
      const sets = Object.keys(data).map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE users SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(data), id);
    }
    const { password_hash, ...logged } = data;
    audit(req, 'user.update', 'user', id, { ...logged, password_changed: !!password });
    res.json({ user: db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(id) });
  }));

  router.delete('/:id', (req, res) => {
    const id = idParam(req);
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw new HttpError(404, 'Usuário não encontrado.');
    if (id === req.user.id) throw new HttpError(400, 'Você não pode excluir a própria conta.');
    if (user.role === 'admin') {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(id);
      if (n === 0) throw new HttpError(400, 'Não é possível excluir o último administrador ativo.');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit(req, 'user.delete', 'user', id, { email: user.email });
    res.json({ ok: true });
  });

  // Gera link de redefinição para o admin repassar (sem depender de e-mail)
  router.post('/:id/reset-link', (req, res) => {
    const id = idParam(req);
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw new HttpError(404, 'Usuário não encontrado.');
    const token = createResetToken(id);
    audit(req, 'user.reset_link', 'user', id);
    res.json({ url: `${baseUrl(req)}/admin/#/redefinir-senha/${token}`, expires_in_minutes: 30, user: publicUser(user) });
  });

  return router;
};
