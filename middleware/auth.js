// middleware/auth.js — JWT + RBAC + barbershop scoping
'use strict';

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'barberpro-secret-key-change-in-production';

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token não fornecido.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);

    // Super admin nunca é bloqueado por suspensão de barbearia
    if (req.user.role !== 'super_admin' && req.user.barbershop_id) {
      const { getDb } = require('../db');
      const db = getDb();
      const bs = db.prepare('SELECT active, name FROM barbershops WHERE id = ?').get(req.user.barbershop_id);
      if (bs && !bs.active) {
        return res.status(403).json({
          error: `A barbearia "${bs.name}" está suspensa. Entre em contato com o administrador do sistema.`,
          code: 'BARBERSHOP_SUSPENDED'
        });
      }
    }

    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: `Acesso restrito. Requer: ${roles.join(' ou ')}.` });
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'Apenas super_admin.' });
  next();
}

/**
 * Retorna o barbershop_id do usuário logado.
 * super_admin pode passar ?barbershop_id=X para operar numa barbearia específica.
 */
function getBsId(req) {
  if (req.user.role === 'super_admin') return req.query.barbershop_id || req.body?.barbershop_id || null;
  return req.user.barbershop_id;
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name, barbershop_id: user.barbershop_id ?? null },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { requireAuth, requireRole, requireSuperAdmin, getBsId, signToken };
