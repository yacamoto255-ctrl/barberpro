'use strict';
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config');
const { getDb } = require('../db');

const ROLES = ['ADMIN', 'GESTOR', 'OPERADOR'];

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });
}

/** Valida o token e confere no banco se o usuário continua ativo e com a mesma versão de sessão. */
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sessão não encontrada. Faça login.', code: 'SEM_TOKEN' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    const expired = e.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Sessão expirada. Faça login novamente.' : 'Token inválido.',
      code: expired ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO',
    });
  }
  const user = getDb().prepare('SELECT id,name,email,role,active,token_version FROM users WHERE id=?').get(payload.sub);
  if (!user || !user.active || user.token_version !== payload.tv) {
    return res.status(401).json({ error: 'Sessão encerrada. Faça login novamente.', code: 'SESSAO_REVOGADA' });
  }
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.', code: 'SEM_TOKEN' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Seu perfil não tem acesso a esta função.', code: 'PROIBIDO' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole, ROLES };
