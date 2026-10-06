// src/auth.js — JWT, senhas e controle de acesso por perfil
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const { getSetting, setSetting } = require('./settings');

const TOKEN_TTL = process.env.TOKEN_TTL || '8h';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

let cachedSecret = null;

/**
 * Segredo do JWT: variável JWT_SECRET (recomendado em produção) ou, se ausente,
 * um segredo aleatório de 64 bytes gerado uma vez e guardado no banco.
 */
function jwtSecret() {
  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET deve ter ao menos 32 caracteres.');
    return process.env.JWT_SECRET;
  }
  if (cachedSecret) return cachedSecret;
  let s = getSetting('jwt_secret');
  if (!s) {
    s = crypto.randomBytes(64).toString('hex');
    setSetting('jwt_secret', s);
  }
  cachedSecret = s;
  return s;
}

function resetSecretCache() { cachedSecret = null; }

function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || !hash) return false;
  return bcrypt.compareSync(plain, hash);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email, jti: crypto.randomUUID() },
    jwtSecret(),
    { expiresIn: TOKEN_TTL, algorithm: 'HS256' },
  );
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Faça login para continuar.', code: 'NO_TOKEN' });

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Sessão inválida. Entre novamente.', code: 'TOKEN_INVALID' });
  }

  const db = getDb();
  if (db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(payload.jti)) {
    return res.status(401).json({ error: 'Sessão encerrada. Entre novamente.', code: 'TOKEN_REVOKED' });
  }
  const user = db.prepare(
    'SELECT id, name, email, role, active, password_changed_at FROM users WHERE id = ?'
  ).get(payload.sub);
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Usuário inativo ou removido.', code: 'USER_INACTIVE' });
  }
  if (payload.iat < user.password_changed_at) {
    return res.status(401).json({ error: 'A senha foi alterada. Entre novamente.', code: 'PASSWORD_CHANGED' });
  }

  // O perfil vem do banco (mudança de perfil vale na hora, sem esperar o token expirar)
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  req.token = { jti: payload.jti, exp: payload.exp };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.', code: 'FORBIDDEN' });
    }
    next();
  };
}

function revokeToken(jti, exp) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, exp);
  // limpeza dos já expirados
  db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
}

module.exports = {
  jwtSecret, resetSecretCache, hashPassword, verifyPassword, signToken, sha256,
  requireAuth, requireRole, revokeToken, TOKEN_TTL,
};
