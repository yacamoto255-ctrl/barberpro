'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const clock = require('../utils/clock');
const audit = require('../services/audit');
const config = require('../config');
const { signToken, requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { badRequest } = require('../utils/errors');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: config.IS_TEST ? 1000 : 30, message: 'Muitas tentativas de login. Aguarde 15 minutos.' });

// Hash "falso" para equalizar o tempo de resposta quando o e-mail não existe.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-x', 10);

function passwordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 72 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw badRequest('A senha deve ter entre 8 e 72 caracteres, com letras e números.');
  }
}

const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });

router.post('/login', loginLimiter, (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) throw badRequest('Informe e-mail e senha.');
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const now = clock.now();
  if (user && user.locked_until && user.locked_until > now) {
    return res.status(423).json({ error: `Usuário bloqueado temporariamente por excesso de tentativas. Tente após ${user.locked_until.slice(11, 16)}.`, code: 'BLOQUEADO' });
  }
  const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.active) {
    if (user && !ok) {
      const attempts = user.failed_attempts + 1;
      const lock = attempts >= config.LOGIN_MAX_ATTEMPTS
        ? clock.toLocal(new Date(Date.now() + config.LOGIN_LOCK_MINUTES * 60000)) : null;
      db.prepare('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?').run(lock ? 0 : attempts, lock, user.id);
      audit.log({ req, user: { id: user.id, name: user.name }, action: 'LOGIN_FALHA', entity: 'users', entityId: user.id, after: { tentativas: attempts, bloqueado: !!lock } });
    }
    if (user && ok && !user.active) return res.status(403).json({ error: 'Usuário inativo. Procure o administrador.', code: 'INATIVO' });
    return res.status(401).json({ error: 'E-mail ou senha incorretos.', code: 'CREDENCIAIS' });
  }
  db.prepare('UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=? WHERE id=?').run(now, user.id);
  audit.log({ req, user, action: 'LOGIN', entity: 'users', entityId: user.id });
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

/** Logout: invalida todas as sessões do usuário (incrementa token_version). */
router.post('/logout', requireAuth, (req, res) => {
  getDb().prepare('UPDATE users SET token_version = token_version + 1 WHERE id=?').run(req.user.id);
  audit.log({ req, action: 'LOGOUT', entity: 'users', entityId: req.user.id });
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!current_password || !bcrypt.compareSync(String(current_password), u.password_hash)) throw badRequest('Senha atual incorreta.');
  passwordPolicy(new_password);
  if (current_password === new_password) throw badRequest('A nova senha deve ser diferente da atual.');
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1, updated_at=? WHERE id=?')
    .run(bcrypt.hashSync(new_password, 10), clock.now(), u.id);
  audit.log({ req, action: 'ALTERAR_SENHA', entity: 'users', entityId: u.id });
  const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  res.json({ token: signToken(fresh), user: publicUser(fresh) });
});

module.exports = { router, passwordPolicy, publicUser };
