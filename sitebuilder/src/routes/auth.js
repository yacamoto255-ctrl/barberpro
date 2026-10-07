// src/routes/auth.js — setup inicial, login, logout, sessão e senhas
'use strict';

const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { Checker, HttpError } = require('../validators');
const {
  hashPassword, verifyPassword, signToken, sha256, requireAuth, revokeToken,
} = require('../auth');
const { audit } = require('../audit');
const { ah, baseUrl } = require('../util');
const { sendWhatsApp, evolutionConfigured } = require('../services/whatsapp');

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
// hash real (gerado uma vez) para equalizar o tempo de resposta quando o e-mail não existe
let dummyHash = null;
const getDummyHash = () => (dummyHash ||= hashPassword(crypto.randomBytes(16).toString('hex')));

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone || null };
}

function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  getDb().prepare(
    'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(userId, sha256(token), Date.now() + RESET_TTL_MS);
  return token;
}

module.exports = (limits) => {
  const router = express.Router();

  router.get('/setup-status', (req, res) => {
    const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM users').get();
    res.json({ needsSetup: n === 0 });
  });

  // Cria o primeiro administrador. Só funciona com o banco sem usuários.
  router.post('/setup', limits.login, ah(async (req, res) => {
    const db = getDb();
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
      throw new HttpError(409, 'O sistema já foi configurado.');
    }
    if (process.env.SETUP_TOKEN && req.body?.setup_token !== process.env.SETUP_TOKEN) {
      throw new HttpError(403, 'Código de instalação inválido.');
    }
    const c = new Checker(req.body);
    const name = c.str('name', 'Nome', { required: true, max: 120, min: 2 });
    const email = c.email('email', 'E-mail', { required: true });
    const password = c.password('password', 'Senha');
    c.done();
    const info = db.prepare(
      `INSERT INTO users (name, email, password_hash, role, password_changed_at) VALUES (?, ?, ?, 'admin', 0)`
    ).run(name, email, hashPassword(password));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    req.user = user;
    audit(req, 'setup.admin_created', 'user', user.id);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }));

  router.post('/login', limits.login, ah(async (req, res) => {
    const c = new Checker(req.body);
    const email = c.email('email', 'E-mail', { required: true });
    const password = c.str('password', 'Senha', { required: true, max: 128 });
    c.done();

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const now = Date.now();

    if (user && user.locked_until && user.locked_until > now) {
      const min = Math.ceil((user.locked_until - now) / 60000);
      audit({ ...req, user: { id: user.id, email } }, 'auth.login_blocked', 'user', user.id);
      throw new HttpError(423, `Conta bloqueada por excesso de tentativas. Tente novamente em ${min} min.`);
    }

    const ok = verifyPassword(password, user ? user.password_hash : getDummyHash());
    if (!user || !ok) {
      if (user) {
        const failed = user.failed_logins + 1;
        const lock = failed >= MAX_FAILED ? now + LOCK_MS : null;
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
          .run(lock ? 0 : failed, lock, user.id);
        audit({ ...req, user: { id: user.id, email } }, lock ? 'auth.account_locked' : 'auth.login_failed', 'user', user.id);
      } else {
        audit(req, 'auth.login_failed', 'user', null, { email });
      }
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    if (!user.active) throw new HttpError(403, 'Usuário desativado. Fale com o administrador.');

    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
    req.user = user;
    audit(req, 'auth.login', 'user', user.id);
    res.json({ token: signToken(user), user: publicUser(user) });
  }));

  router.post('/logout', requireAuth, (req, res) => {
    revokeToken(req.token.jti, req.token.exp);
    audit(req, 'auth.logout', 'user', req.user.id);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    const u = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(u) });
  });

  router.post('/change-password', requireAuth, ah(async (req, res) => {
    const c = new Checker(req.body);
    const current = c.str('current_password', 'Senha atual', { required: true, max: 128 });
    const next = c.password('new_password', 'Nova senha');
    c.done();
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(current, user.password_hash)) throw new HttpError(400, 'Senha atual incorreta.', { fields: { current_password: 'Senha atual incorreta.' } });
    if (verifyPassword(next, user.password_hash)) throw new HttpError(400, 'A nova senha deve ser diferente da atual.', { fields: { new_password: 'A nova senha deve ser diferente da atual.' } });

    const nowSec = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(hashPassword(next), nowSec, user.id);
    revokeToken(req.token.jti, req.token.exp);
    audit(req, 'auth.password_changed', 'user', user.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json({ token: signToken(fresh), user: publicUser(fresh) });
  }));

  // Resposta sempre igual, exista ou não o e-mail (não revela contas)
  router.post('/forgot-password', limits.login, ah(async (req, res) => {
    const c = new Checker(req.body);
    const email = c.email('email', 'E-mail', { required: true });
    c.done();
    const generic = {
      ok: true,
      message: 'Se o e-mail estiver cadastrado e tiver WhatsApp vinculado, você receberá um link. Caso contrário, peça ao administrador um link de redefinição.',
    };
    const user = getDb().prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (!user) return res.json(generic);

    const token = createResetToken(user.id);
    const link = `${baseUrl(req)}/admin/#/redefinir-senha/${token}`;
    audit({ ...req, user: { id: user.id, email } }, 'auth.reset_requested', 'user', user.id);
    if (user.phone && evolutionConfigured()) {
      sendWhatsApp({
        to: user.phone,
        text: `Versal Estúdio — redefinição de senha.\nAbra o link em até 30 minutos:\n${link}\nSe não foi você, ignore esta mensagem.`,
        purpose: 'password_reset',
      });
    } else if (!['production', 'test'].includes(process.env.NODE_ENV)) {
      console.log(`[dev] link de redefinição para ${email}: ${link}`);
    }
    res.json(generic);
  }));

  router.post('/reset-password', limits.login, ah(async (req, res) => {
    const c = new Checker(req.body);
    const token = c.str('token', 'Código', { required: true, max: 200 });
    const password = c.password('new_password', 'Nova senha');
    c.done();
    const db = getDb();
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(token));
    if (!row || row.used_at || row.expires_at < Date.now()) {
      throw new HttpError(400, 'Link de redefinição inválido ou expirado. Solicite um novo.');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    db.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL,
       updated_at = datetime('now') WHERE id = ?`
    ).run(hashPassword(password), nowSec, row.user_id);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(Date.now(), row.user_id);
    audit({ ...req, user: { id: row.user_id } }, 'auth.password_reset', 'user', row.user_id);
    res.json({ ok: true, message: 'Senha redefinida. Faça login com a nova senha.' });
  }));

  return router;
};

module.exports.createResetToken = createResetToken;
module.exports.publicUser = publicUser;
